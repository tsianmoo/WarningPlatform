#!/usr/bin/env node
/**
 * 重置管理员密码为初始密码，并清除其全部会话。
 *
 * 适用场景：忘记密码、或交接时需要收回旧密码。
 * 重置后下次登录会强制要求修改密码。
 *
 * 用法：
 *   node scripts/reset-admin.mjs
 * 指定密码 / 账号：
 *   ADMIN_PASSWORD='NewPass123' ADMIN_USERNAME=admin node scripts/reset-admin.mjs
 * 不强制下次改密（把重置后的密码当作日常密码）：
 *   node scripts/reset-admin.mjs --no-force-change
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

const adminUsername = process.env.ADMIN_USERNAME || 'admin';
const newPassword = process.env.ADMIN_PASSWORD || process.env.DEFAULT_INITIAL_PASSWORD || '123456';
// 默认重置后强制改密；加 --no-force-change 可让它成为一个可直接长期使用的密码
const keepAsIs = process.argv.includes('--no-force-change');

const client = new pg.Client({ connectionString: DATABASE_URL });

try {
  await client.connect();
  const found = await client.query(
    `SELECT id FROM accounts WHERE lower(username) = lower($1) AND subject_type = 'admin'`,
    [adminUsername]
  );
  if (found.rowCount === 0) {
    console.error(`✗ 未找到管理员账号 ${adminUsername}。请先运行 node scripts/seed.mjs。`);
    process.exit(1);
  }
  const id = found.rows[0].id;

  await client.query('BEGIN');
  await client.query(
    `UPDATE accounts
        SET password_hash = $2, must_change_password = $3,
            failed_attempts = 0, locked_until = NULL, updated_at = now()
      WHERE id = $1`,
    [id, await hashPassword(newPassword), !keepAsIs]
  );
  // 密码重置后旧会话一律作废
  await client.query('DELETE FROM sessions WHERE account_id = $1', [id]);
  await client.query('COMMIT');

  console.log('✓ 管理员密码已重置');
  console.log(`    账号：${adminUsername}`);
  console.log(`    密码：${newPassword}`);
  console.log(
    keepAsIs
      ? '    可直接用该密码登录（未开启强制改密）；原有会话已全部失效。'
      : '    下次登录会强制要求修改密码；原有会话已全部失效。'
  );
} catch (err) {
  await client.query('ROLLBACK').catch(() => {});
  console.error('\n✗ 重置失败：', err.message);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
