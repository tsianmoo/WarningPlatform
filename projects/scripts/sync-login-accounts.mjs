#!/usr/bin/env node
/**
 * 补齐 / 校正业务登录账号（经销商前缀 J、店仓/员工用编号、人员用账号名）。
 *
 * 背景两个历史问题：
 *   1. 经销商编号与店仓编号共用一套编码（如 3940001 两边都有），
 *      而 accounts.username 有唯一索引 → 先同步的那一类把账号名占掉，
 *      另一类根本建不出账号。本库实测 753 个店仓因此没有登录账号，
 *      店仓用户拿编号登录时登进的是同编号的经销商账号（权限自然全错）。
 *      → 现在经销商账号统一为「J + 编号」，两类不再冲突。
 *   2. 该档案曾被删除或同步失败时，账号可能从未创建。
 *
 * 本脚本幂等地做三件事：
 *   a. 把已有经销商账号改名为「J + 编号」（目标名被占用则跳过并报告）
 *   b. 为缺账号的经销商/店仓/员工/人员补建账号
 *   c. 报告统计（补建数量、跳过的冲突）
 * 命名规则与 src/lib/server/repo.ts 的 ensureAccounts 一致。
 *
 * 用法：
 *   node scripts/sync-login-accounts.mjs            # 执行
 *   node scripts/sync-login-accounts.mjs --dry-run  # 只报告不写库
 */
import { randomBytes, scrypt as scryptCb } from 'node:crypto';
import { promisify } from 'node:util';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
loadEnv({ path: join(ROOT, '.env.local'), quiet: true });
loadEnv({ path: join(ROOT, '.env'), quiet: true });

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('✗ 未找到 DATABASE_URL。请先创建 .env.local。');
  process.exit(1);
}

const DRY_RUN = process.argv.includes('--dry-run');
const INIT_PWD = process.env.DEFAULT_INITIAL_PASSWORD || '123456';
const DEALER_PREFIX = 'J';

const scrypt = promisify(scryptCb);
const N = 16384, R = 8, P = 1, KEY_LEN = 64;

/** 与 src/lib/server/auth.ts 的 hashPassword 保持一致的格式 */
async function hashPassword(plain) {
  const salt = randomBytes(16);
  const dk = await scrypt(plain.normalize('NFKC'), salt, KEY_LEN, { N, r: R, p: P, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${dk.toString('base64')}`;
}

/** 经销商登录账号 = J + 编号（已带前缀则原样返回，幂等） */
const dealerLoginName = (code) => {
  const c = String(code ?? '').trim();
  if (!c) return '';
  return c.toUpperCase().startsWith(DEALER_PREFIX) ? c : DEALER_PREFIX + c;
};

/** 业务主体 → 账号命名 + 来源 SQL（顺序：id、username、display_name、subject_id、档案初始密码） */
const QUERIES = {
  dealer: `
    SELECT 'acct_dealer_' || d.id AS account_id,
           '${DEALER_PREFIX}' || btrim(d.code) AS username,
           d.name AS display_name,
           d.id AS subject_id,
           d.password AS archive_pwd
      FROM dealers d
     WHERE d.deleted_at IS NULL AND d.code IS NOT NULL AND btrim(d.code) <> ''`,
  store: `
    SELECT 'acct_store_' || s.id AS account_id,
           btrim(s.code) AS username,
           s.name AS display_name,
           s.id AS subject_id,
           s.password AS archive_pwd
      FROM stores s
     WHERE s.deleted_at IS NULL AND s.code IS NOT NULL AND btrim(s.code) <> ''`,
  employee: `
    SELECT 'acct_employee_' || e.id AS account_id,
           btrim(e.code) AS username,
           e.name AS display_name,
           e.id AS subject_id,
           e.password AS archive_pwd
      FROM employees e
     WHERE e.deleted_at IS NULL AND e.code IS NOT NULL AND btrim(e.code) <> ''`,
  person: `
    SELECT 'acct_person_' || p.id AS account_id,
           COALESCE(NULLIF(btrim(p.username), ''), btrim(p.name)) AS username,
           p.name AS display_name,
           p.id AS subject_id,
           p.password AS archive_pwd
      FROM persons p
     WHERE p.deleted_at IS NULL`,
};

const client = new pg.Client({ connectionString: DATABASE_URL });
const stats = { renamed: 0, created: 0, skipped: [] };

try {
  await client.connect();
  if (!DRY_RUN) await client.query('BEGIN');

  // ---------- a. 经销商账号改名：编号 → J+编号 ----------
  const renamed = DRY_RUN
    ? await client.query(
        `SELECT count(*)::int AS n
           FROM accounts a JOIN dealers d ON d.id = a.subject_id
          WHERE a.subject_type = 'dealer' AND d.code IS NOT NULL AND btrim(d.code) <> ''
            AND upper(a.username) <> upper('${DEALER_PREFIX}' || btrim(d.code))`
      )
    : await client.query(
    `UPDATE accounts a
        SET username = '${DEALER_PREFIX}' || btrim(d.code)
       FROM dealers d
      WHERE a.subject_type = 'dealer'
        AND a.subject_id = d.id
        AND d.code IS NOT NULL
        AND btrim(d.code) <> ''
        AND upper(a.username) <> upper('${DEALER_PREFIX}' || btrim(d.code))
        AND NOT EXISTS (
          SELECT 1 FROM accounts b
           WHERE lower(b.username) = lower('${DEALER_PREFIX}' || btrim(d.code))
             AND b.id <> a.id
        )
      RETURNING a.username`
  );
  stats.renamed = DRY_RUN ? Number(renamed.rows[0]?.n ?? 0) : renamed.rowCount;

  // ---------- b. 补建缺失账号 ----------
  const accounts = await client.query(
    'SELECT id, lower(username) AS username FROM accounts'
  );
  const byId = new Map(accounts.rows.map((r) => [r.id, r.username]));
  // 同一次运行内也要去重：一个用户名只能建一个账号
  const taken = new Set(accounts.rows.map((r) => r.username));

  for (const [type, sql] of Object.entries(QUERIES)) {
    const rows = (await client.query(sql)).rows;
    const pwdCache = new Map();
    for (const r of rows) {
      const username = String(r.username ?? '').trim();
      if (!username) { stats.skipped.push(`${type} ${r.subject_id}: 无可用账号名`); continue; }
      if (byId.has(r.account_id)) continue; // 账号已存在（改名逻辑不覆盖用户自定账号名）
      if (taken.has(username.toLowerCase())) {
        stats.skipped.push(`${type} ${username}（账号名已被其它主体占用）`);
        continue;
      }
      const archivePwd = String(r.archive_pwd ?? '').trim();
      const pwd = archivePwd || INIT_PWD;
      if (!pwdCache.has(pwd)) pwdCache.set(pwd, await hashPassword(pwd));
      if (!DRY_RUN) {
        await client.query(
          `INSERT INTO accounts (id, username, password_hash, display_name, subject_type,
                                 subject_id, must_change_password, enabled)
           VALUES ($1, $2, $3, $4, $5, $6, false, true)
           ON CONFLICT (id) DO NOTHING`,
          [r.account_id, username, pwdCache.get(pwd), r.display_name ?? '', type, r.subject_id]
        );
      }
      taken.add(username.toLowerCase());
      stats.created += 1;
    }
  }

  if (!DRY_RUN) await client.query('COMMIT');

  console.log(`\n${DRY_RUN ? '[dry-run] ' : ''}账号校正完成：`);
  console.log(`  经销商账号改名（编号 → ${DEALER_PREFIX}+编号）：${stats.renamed}`);
  console.log(`  补建缺失账号：${stats.created}（初始密码 ${INIT_PWD}）`);
  if (stats.skipped.length > 0) {
    console.log(`  跳过 ${stats.skipped.length} 条：`);
    for (const s of stats.skipped.slice(0, 20)) console.log(`    - ${s}`);
    if (stats.skipped.length > 20) console.log(`    … 其余 ${stats.skipped.length - 20} 条省略`);
  }
} catch (err) {
  if (!DRY_RUN) await client.query('ROLLBACK').catch(() => {});
  console.error('\n✗ 执行失败：', err.message);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
