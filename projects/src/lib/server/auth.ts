import {
  randomBytes,
  scrypt as scryptCb,
  timingSafeEqual,
  createHash,
  type ScryptOptions,
} from 'node:crypto';
import { cookies } from 'next/headers';
import { query, queryOne, execute } from '@/storage/database/db';

/**
 * 服务端认证。
 *
 * 修正的旧设计：
 *   1. 旧版密码明文存库（dealers/stores/employees/persons 四张表各有 password 列），
 *      且比对在浏览器里完成（login/page.tsx），并存在 admin/123456 硬编码后门。
 *      现在：scrypt 加盐哈希存 accounts 表，服务端校验，无后门。
 *   2. 旧版登录后只往 localStorage 写一个用户名，任何人都能改。
 *      现在：httpOnly + SameSite=Lax 会话 Cookie，token 只存 SHA-256 哈希。
 */

/**
 * scrypt 的 Promise 包装。
 * 不用 promisify：Node 的 scrypt 是多重重载（带/不带 options），
 * promisify 会挑中「3 参数」那个签名，导致传 options 时类型报错。
 */
const scrypt = (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: ScryptOptions
): Promise<Buffer> =>
  new Promise<Buffer>((resolve, reject) => {
    scryptCb(password, salt, keylen, options, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });

export const SESSION_COOKIE = 'dn_session';
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 小时

/** 初始密码：可通过环境变量覆盖。首次登录强制修改。 */
export const DEFAULT_INITIAL_PASSWORD = process.env.DEFAULT_INITIAL_PASSWORD || 'wi15afvb';

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LEN = 64;

export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(16);
  const dk = (await scrypt(plain.normalize('NFKC'), salt, KEY_LEN, {
    N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: 64 * 1024 * 1024,
  })) as Buffer;
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('base64')}$${dk.toString('base64')}`;
}

export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  if (!stored) return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltB64, hashB64] = parts;
  try {
    const salt = Buffer.from(saltB64, 'base64');
    const expected = Buffer.from(hashB64, 'base64');
    const dk = (await scrypt(plain.normalize('NFKC'), salt, expected.length, {
      N: Number(n), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024,
    })) as Buffer;
    return dk.length === expected.length && timingSafeEqual(dk, expected);
  } catch {
    return false;
  }
}

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

export interface AuthAccount {
  id: string;
  username: string;
  displayName: string;
  subjectType: 'person' | 'dealer' | 'store' | 'employee' | 'admin';
  subjectId: string | null;
  mustChangePassword: boolean;
}

interface AccountDbRow {
  id: string;
  username: string;
  password_hash: string;
  display_name: string;
  subject_type: string;
  subject_id: string | null;
  must_change_password: boolean;
  enabled: boolean;
  failed_attempts: number;
  locked_until: Date | string | null;
}

export type LoginResult =
  | { ok: true; account: AuthAccount; token: string }
  | { ok: false; reason: 'invalid' | 'disabled' | 'locked' };

const MAX_FAILED = 8;
const LOCK_MS = 10 * 60 * 1000;

export async function login(
  username: string,
  password: string,
  ip?: string | null,
  userAgent?: string | null
): Promise<LoginResult> {
  const row = await queryOne<AccountDbRow>(
    `SELECT id, username, password_hash, display_name, subject_type, subject_id,
            must_change_password, enabled, failed_attempts, locked_until
       FROM accounts WHERE lower(username) = lower($1)`,
    [username.trim()]
  );
  if (!row) return { ok: false, reason: 'invalid' };

  if (row.locked_until && new Date(row.locked_until).getTime() > Date.now()) {
    return { ok: false, reason: 'locked' };
  }
  if (!row.enabled) return { ok: false, reason: 'disabled' };

  const ok = await verifyPassword(password, row.password_hash);
  if (!ok) {
    // 注意：不要把同一个参数既放进 SET（被列类型推成 integer）又放进裸比较
    // （两个未定类型参与比较时，PG 会把运算符解析成 text >= text → 报
    //  "inconsistent types deduced for parameter"）。这里改用 failed_attempts + 1。
    await execute(
      `UPDATE accounts
          SET failed_attempts = failed_attempts + 1,
              locked_until = CASE
                WHEN failed_attempts + 1 >= $2 THEN now() + ($3 || ' seconds')::interval
                ELSE locked_until END
        WHERE id = $1`,
      [row.id, MAX_FAILED, String(Math.ceil(LOCK_MS / 1000))]
    );
    return { ok: false, reason: 'invalid' };
  }

  await execute(
    `UPDATE accounts SET failed_attempts = 0, locked_until = NULL, last_login_at = now() WHERE id = $1`,
    [row.id]
  );

  const token = randomBytes(32).toString('base64url');
  await execute(
    `INSERT INTO sessions (token_hash, account_id, expires_at, ip, user_agent)
     VALUES ($1, $2, now() + ($3 || ' milliseconds')::interval, $4, $5)`,
    [sha256(token), row.id, String(SESSION_TTL_MS), ip ?? null, userAgent ?? null]
  );

  return {
    ok: true,
    token,
    account: {
      id: row.id,
      username: row.username,
      displayName: row.display_name,
      subjectType: row.subject_type as AuthAccount['subjectType'],
      subjectId: row.subject_id,
      mustChangePassword: row.must_change_password,
    },
  };
}

export async function destroySession(token: string): Promise<void> {
  if (!token) return;
  await execute(`DELETE FROM sessions WHERE token_hash = $1`, [sha256(token)]);
}

export async function resolveToken(token: string | undefined | null): Promise<AuthAccount | null> {
  if (!token) return null;
  const row = await queryOne<AccountDbRow & { account_id: string }>(
    `SELECT a.id, a.username, a.display_name, a.subject_type, a.subject_id,
            a.must_change_password, a.enabled, s.token_hash
       FROM sessions s JOIN accounts a ON a.id = s.account_id
      WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [sha256(token)]
  );
  if (!row || !row.enabled) return null;
  // 顺带刷新活跃时间（失败不影响鉴权结果）
  execute(`UPDATE sessions SET last_seen_at = now() WHERE token_hash = $1`, [sha256(token)]).catch(() => {});
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    subjectType: row.subject_type as AuthAccount['subjectType'],
    subjectId: row.subject_id,
    mustChangePassword: row.must_change_password,
  };
}

/** 在 Route Handler / Server Component 中取当前登录账号 */
export async function currentAccount(): Promise<AuthAccount | null> {
  const store = await cookies();
  return resolveToken(store.get(SESSION_COOKIE)?.value);
}

/** 强制鉴权：未登录抛 401 语义错误，由调用方转成响应 */
export class UnauthorizedError extends Error {
  constructor() {
    super('未登录或会话已过期');
    this.name = 'UnauthorizedError';
  }
}

export async function requireAccount(): Promise<AuthAccount> {
  const acc = await currentAccount();
  if (!acc) throw new UnauthorizedError();
  return acc;
}

export async function changePassword(
  accountId: string,
  oldPassword: string,
  newPassword: string
): Promise<{ ok: true } | { ok: false; reason: 'invalid' | 'weak' }> {
  const row = await queryOne<{ password_hash: string }>(
    `SELECT password_hash FROM accounts WHERE id = $1`,
    [accountId]
  );
  if (!row) return { ok: false, reason: 'invalid' };
  if (!(await verifyPassword(oldPassword, row.password_hash))) {
    return { ok: false, reason: 'invalid' };
  }
  if (!isPasswordStrong(newPassword)) {
    return { ok: false, reason: 'weak' };
  }
  await execute(
    `UPDATE accounts SET password_hash = $2, must_change_password = false WHERE id = $1`,
    [accountId, await hashPassword(newPassword)]
  );
  // 改密后踢掉其它会话
  await execute(`DELETE FROM sessions WHERE account_id = $1`, [accountId]);
  return { ok: true };
}

/** 清理过期会话（可由定时任务或每次登录时调用） */
export async function purgeExpiredSessions(): Promise<void> {
  await execute(`DELETE FROM sessions WHERE expires_at < now()`);
}

export async function listAccounts() {
  return query<{
    id: string;
    username: string;
    display_name: string;
    subject_type: string;
    subject_id: string | null;
    enabled: boolean;
    must_change_password: boolean;
    last_login_at: Date | null;
  }>(
    `SELECT id, username, display_name, subject_type, subject_id, enabled,
            must_change_password, last_login_at
       FROM accounts ORDER BY subject_type, username`
  );
}

/**
 * 管理员重置密码。
 *   resetPassword(id)                  → 回到初始密码（DEFAULT_INITIAL_PASSWORD）
 *   resetPassword(id, 'SomePwd123')    → 设为指定密码
 * 两种情况都强制该用户下次登录修改密码，并作废其现有会话。
 */
export async function resetPassword(accountId: string, newPassword?: string): Promise<void> {
  const pwd = newPassword?.trim() ? newPassword.trim() : DEFAULT_INITIAL_PASSWORD;
  await execute(
    `UPDATE accounts SET password_hash = $2, must_change_password = true,
            failed_attempts = 0, locked_until = NULL, updated_at = now() WHERE id = $1`,
    [accountId, await hashPassword(pwd)]
  );
  await execute(`DELETE FROM sessions WHERE account_id = $1`, [accountId]);
}

/** 密码强度规则（与 changePassword 一致），供接口层复用 */
export function isPasswordStrong(pw: string): boolean {
  return pw.length >= 8 && /[A-Za-z]/.test(pw) && /[0-9]/.test(pw);
}
