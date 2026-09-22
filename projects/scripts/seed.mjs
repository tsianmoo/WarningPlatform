#!/usr/bin/env node
/**
 * 初始化数据。
 *
 * 旧版没有任何初始化流程：登录校验在浏览器里完成，
 * 且存在 admin/123456 硬编码后门，密码明文散落在四张业务表。
 * 现在统一创建 accounts 记录（scrypt 加盐哈希），并强制首次登录改密。
 *
 * 用法：
 *   node scripts/seed.mjs
 * 可通过环境变量覆盖初始密码：
 *   ADMIN_PASSWORD=xxx node scripts/seed.mjs
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

const adminPassword = process.env.ADMIN_PASSWORD || process.env.DEFAULT_INITIAL_PASSWORD || 'wi15afvb';
const adminUsername = process.env.ADMIN_USERNAME || 'admin';

const client = new pg.Client({ connectionString: DATABASE_URL });

try {
  await client.connect();

  const exists = await client.query('SELECT id FROM accounts WHERE lower(username) = lower($1)', [adminUsername]);
  if (exists.rowCount > 0) {
    console.log(`· 管理员账号 ${adminUsername} 已存在，跳过创建。`);
    console.log('  （如需重置密码：node scripts/reset-admin.mjs）');
  } else {
    await client.query(
      `INSERT INTO accounts (id, username, password_hash, display_name, subject_type, subject_id,
                             must_change_password, enabled)
       VALUES ($1, $2, $3, $4, 'admin', NULL, true, true)`,
      ['acct_admin_root', adminUsername, await hashPassword(adminPassword), '系统管理员']
    );
    console.log('✓ 已创建管理员账号');
    console.log(`    账号：${adminUsername}`);
    console.log(`    初始密码：${adminPassword}`);
    console.log('    首次登录会强制要求修改密码。');
  }

  // 健康检查表留一条记录，便于部署自检
  const hc = await client.query('SELECT count(*)::int AS n FROM health_check');
  if (hc.rows[0].n === 0) {
    await client.query('INSERT INTO health_check (updated_at) VALUES (now())');
    console.log('✓ 已写入 health_check 初始记录');
  }
  console.log('\n初始化完成。');
} catch (err) {
  console.error('\n✗ 初始化失败：', err.message);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
