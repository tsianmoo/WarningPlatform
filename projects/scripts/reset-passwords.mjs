#!/usr/bin/env node
/**
 * 批量重置业务账号（经销商/店仓/员工/人员）的登录密码。
 *
 * 背景：管理员在人事管理/店仓管理等页面建档时以为初始密码是 123456，
 * 但历史账号实际使用系统默认密码创建，导致「明明设了密码却登录不上」。
 * 本脚本把所有（或指定）非管理员账号统一重置为初始密码并清除锁定。
 *
 * 用法：
 *   node scripts/reset-passwords.mjs                     # 重置全部非 admin 账号
 *   node scripts/reset-passwords.mjs --type person       # 只重置某类：person/store/dealer/employee
 *   node scripts/reset-passwords.mjs --username 666666   # 只重置指定账号
 *   INITIAL_PASSWORD='abc12345' node scripts/reset-passwords.mjs
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

const scrypt = promisify(scryptCb);
const N = 16384, R = 8, P = 1, KEY_LEN = 64;

/** 与 src/lib/server/auth.ts 的 hashPassword 保持完全一致的格式 */
async function hashPassword(plain) {
  const salt = randomBytes(16);
  const dk = await scrypt(plain.normalize('NFKC'), salt, KEY_LEN, { N, r: R, p: P, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${dk.toString('base64')}`;
}

const newPassword = process.env.INITIAL_PASSWORD || process.env.DEFAULT_INITIAL_PASSWORD || '123456';
const argOf = (flag) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const subjectType = argOf('--type');
const username = argOf('--username');

const client = new pg.Client({ connectionString: DATABASE_URL });

try {
  await client.connect();
  const cond = [`subject_type <> 'admin'`];
  const params = [];
  if (subjectType) { params.push(subjectType); cond.push(`subject_type = $${params.length}`); }
  if (username) { params.push(username); cond.push(`lower(username) = lower($${params.length})`); }
  const where = cond.join(' AND ');

  const found = await client.query(`SELECT id, username FROM accounts WHERE ${where} ORDER BY username`, params);
  if (found.rowCount === 0) {
    console.log('没有匹配的账号，未做任何修改。');
    process.exit(0);
  }

  await client.query('BEGIN');
  await client.query(
    `UPDATE accounts
        SET password_hash = $1, must_change_password = false,
            failed_attempts = 0, locked_until = NULL, updated_at = now()
      WHERE ${where}`,
    [await hashPassword(newPassword), ...params]
  );
  // 重置后作废这些账号的全部会话
  await client.query(
    `DELETE FROM sessions WHERE account_id IN (SELECT id FROM accounts WHERE ${where})`,
    params
  );
  await client.query('COMMIT');

  console.log(`✓ 已重置 ${found.rowCount} 个账号的登录密码`);
  console.log(`    密码统一为：${newPassword}`);
  if (found.rowCount <= 20) {
    for (const r of found.rows) console.log(`    - ${r.username}`);
  }
} catch (err) {
  await client.query('ROLLBACK').catch(() => {});
  console.error('\n✗ 重置失败：', err.message);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
