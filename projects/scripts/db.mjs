#!/usr/bin/env node
/**
 * 数据库迁移工具。
 *
 * 旧版完全没有迁移机制：表结构靠 src/lib/server/sync/sync-store.ts 里的
 * ensureSchema() 在首次请求时字符串拼 SQL 创建，改结构只能人肉在控制台点。
 * 现在统一为 db/migrations/*.sql + schema_migrations 版本表。
 *
 * 用法：
 *   node scripts/db.mjs migrate    应用所有未执行的迁移
 *   node scripts/db.mjs status     查看迁移状态
 *   node scripts/db.mjs reset      清空整个 schema（危险，需二次确认参数 --yes）
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const MIGRATIONS_DIR = join(ROOT, 'db', 'migrations');

loadEnv({ path: join(ROOT, '.env.local'), quiet: true });
loadEnv({ path: join(ROOT, '.env'), quiet: true });

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('✗ 未找到 DATABASE_URL。请先创建 .env.local 并写入 DATABASE_URL。');
  process.exit(1);
}

const command = process.argv[2] || 'migrate';

const client = new pg.Client({ connectionString: DATABASE_URL });

function migrationFiles() {
  if (!existsSync(MIGRATIONS_DIR)) return [];
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

async function ensureMigrationTable() {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

async function appliedVersions() {
  const r = await client.query('SELECT version FROM schema_migrations');
  return new Set(r.rows.map((x) => x.version));
}

async function migrate() {
  await ensureMigrationTable();
  const done = await appliedVersions();
  const files = migrationFiles();
  let count = 0;

  for (const file of files) {
    const version = file.replace(/\.sql$/, '');
    if (done.has(version)) {
      console.log(`· 跳过 ${file}（已应用）`);
      continue;
    }
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    process.stdout.write(`→ 应用 ${file} ... `);
    try {
      await client.query('BEGIN');
      await client.query(sql);
      // 迁移文件自身也会 INSERT schema_migrations，这里兜底保证记录存在
      await client.query(
        'INSERT INTO schema_migrations (version) VALUES ($1) ON CONFLICT (version) DO NOTHING',
        [version]
      );
      await client.query('COMMIT');
      console.log('完成');
      count += 1;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      console.log('失败');
      throw err;
    }
  }
  console.log(count === 0 ? '\n数据库已是最新状态。' : `\n已应用 ${count} 个迁移。`);
}

async function status() {
  await ensureMigrationTable();
  const done = await appliedVersions();
  const files = migrationFiles();
  console.log('迁移状态：');
  for (const f of files) {
    const v = f.replace(/\.sql$/, '');
    console.log(`  ${done.has(v) ? '[已应用]' : '[待应用]'} ${f}`);
  }
  const t = await client.query(
    `SELECT count(*)::int AS n FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`
  );
  console.log(`\npublic 下现有表数量：${t.rows[0].n}`);
}

async function reset() {
  if (!process.argv.includes('--yes')) {
    console.error('✗ reset 会删除 public 下所有对象。确认请追加 --yes 参数。');
    process.exit(1);
  }
  console.log('→ 删除 public schema 并重建 ...');
  await client.query('DROP SCHEMA public CASCADE');
  await client.query('CREATE SCHEMA public');
  console.log('完成。请重新执行 migrate。');
}

try {
  await client.connect();
  if (command === 'migrate') await migrate();
  else if (command === 'status') await status();
  else if (command === 'reset') await reset();
  else {
    console.error(`未知命令：${command}。可用：migrate | status | reset`);
    process.exit(1);
  }
} catch (err) {
  console.error('\n✗ 执行失败：', err.message);
  if (err.detail) console.error('  详情：', err.detail);
  if (err.hint) console.error('  提示：', err.hint);
  if (err.position) console.error('  位置：', err.position);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
