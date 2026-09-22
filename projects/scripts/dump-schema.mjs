#!/usr/bin/env node
/**
 * 从**实际部署的数据库**反向导出表结构文档（docs/DB_SCHEMA.md）。
 *
 * 之所以要导出而不是手写：手写文档会随时间漂移，而这份文档是排查问题时
 * 唯一的权威参考。导出源为 information_schema / pg_catalog，与线上完全一致。
 *
 * 用法：node scripts/dump-schema.mjs [输出路径]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT = process.argv[2] || path.join(ROOT, 'docs', 'DB_SCHEMA.md');

// 复用 .env.local 里的连接串，避免两处配置不一致
function loadDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const f = path.join(ROOT, '.env.local');
  if (fs.existsSync(f)) {
    const m = fs.readFileSync(f, 'utf8').match(/^\s*DATABASE_URL\s*=\s*(.+)\s*$/m);
    if (m) return m[1].trim().replace(/^["']|["']$/g, '');
  }
  throw new Error('未找到 DATABASE_URL（环境变量或 .env.local）');
}

const TYPE_LABEL = {
  'character varying': 'varchar',
  'timestamp with time zone': 'timestamptz',
  'timestamp without time zone': 'timestamp',
  'double precision': 'double',
  'character': 'char',
};

const shortType = (t, len, prec, scale) => {
  if (t === 'numeric' && prec) return `numeric(${prec},${scale})`;
  const label = TYPE_LABEL[t] ?? t;
  if (len && ['varchar', 'char'].includes(label)) return `${label}(${len})`;
  return label;
};

async function main() {
  const client = new pg.Client({ connectionString: loadDatabaseUrl() });
  await client.connect();

  const { rows: cols } = await client.query(`
    SELECT c.table_name, c.column_name, c.data_type, c.character_maximum_length AS len,
           c.numeric_precision AS prec, c.numeric_scale AS scale,
           c.is_nullable, c.column_default
      FROM information_schema.columns c
      JOIN information_schema.tables t
        ON t.table_schema = c.table_schema AND t.table_name = c.table_name
     WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE'
     ORDER BY c.table_name, c.ordinal_position`);

  const { rows: pks } = await client.query(`
    SELECT tc.table_name, tc.constraint_name, kcu.column_name, kcu.ordinal_position
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
     WHERE tc.table_schema = 'public' AND tc.constraint_type = 'PRIMARY KEY'
     ORDER BY tc.table_name, kcu.ordinal_position`);

  const { rows: fks } = await client.query(`
    SELECT tc.table_name, kcu.column_name,
           ccu.table_name AS ref_table, ccu.column_name AS ref_column,
           rc.delete_rule
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = tc.constraint_name
      JOIN information_schema.referential_constraints rc
        ON rc.constraint_name = tc.constraint_name
     WHERE tc.table_schema = 'public' AND tc.constraint_type = 'FOREIGN KEY'
     ORDER BY tc.table_name, kcu.column_name`);

  const { rows: idx } = await client.query(`
    SELECT tablename, indexname, indexdef FROM pg_indexes
     WHERE schemaname = 'public' ORDER BY tablename, indexname`);

  const { rows: checks } = await client.query(`
    SELECT rel.relname AS table_name, con.conname, pg_get_constraintdef(con.oid) AS def
      FROM pg_constraint con JOIN pg_class rel ON rel.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = rel.relnamespace
     WHERE n.nspname = 'public' AND con.contype = 'c'
     ORDER BY rel.relname, con.conname`);

  // 表/列注释（objsubid = 0 为表注释，> 0 为列注释）
  const { rows: cmtRows } = await client.query(`
    SELECT c.relname AS table_name, d.objsubid, a.attname AS column_name, d.description
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_description d ON d.objoid = c.oid
      LEFT JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = d.objsubid AND d.objsubid > 0
     WHERE n.nspname = 'public' AND c.relkind = 'r'`);

  const { rows: trigs } = await client.query(`
    SELECT c.relname AS table_name, t.tgname
      FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND NOT t.tgisinternal
     ORDER BY c.relname`);

  await client.end();

  const tables = [...new Set(cols.map((c) => c.table_name))];
  const group = (arr, key) => arr.reduce((m, r) => ((m[r[key]] ??= []).push(r), m), {});
  const byTableCols = group(cols, 'table_name');
  const byTablePk = group(pks, 'table_name');
  const byTableFk = group(fks, 'table_name');
  const byTableIdx = group(idx, 'tablename');
  const byTableCheck = group(checks, 'table_name');
  const byTableTrig = group(trigs, 'table_name');
  const commentOf = Object.fromEntries(cmtRows.filter((c) => c.objsubid === 0).map((c) => [c.table_name, c.description]));
  const colCommentOf = {};
  for (const c of cmtRows) {
    if (c.objsubid > 0 && c.column_name) colCommentOf[`${c.table_name}.${c.column_name}`] = c.description;
  }

  const L = [];
  L.push('# 数据库表结构（自动导出，请勿手改）');
  L.push('');
  L.push('> 项目：店牛预警平台（warn_platform）');
  L.push('> 数据库：PostgreSQL 16');
  L.push(`> 本文由 \`node scripts/dump-schema.mjs\` 从实际库导出，共 **${tables.length}** 张表。`);
  L.push('> 表结构以 `db/migrations/*.sql` 为准，改动请新增迁移文件后重新生成本文。');
  L.push('');

  L.push('## 总览');
  L.push('');
  L.push('| # | 表名 | 主键 | 外键数 | 说明 |');
  L.push('|---|------|------|--------|------|');
  tables.forEach((t, i) => {
    const pk = (byTablePk[t] ?? []).map((r) => r.column_name).join(', ') || '—';
    const fk = (byTableFk[t] ?? []).length;
    const cmt = (commentOf[t] ?? '').replace(/\|/g, '\\|');
    L.push(`| ${i + 1} | \`${t}\` | \`${pk}\` | ${fk} | ${cmt} |`);
  });
  L.push('');

  L.push('## 表结构明细');
  L.push('');
  for (const t of tables) {
    L.push(`### \`${t}\``);
    if (commentOf[t]) L.push('', `> ${commentOf[t]}`);
    L.push('');
    L.push('| 列 | 类型 | 可空 | 默认 | 说明 |');
    L.push('|----|------|------|------|------|');
    for (const c of byTableCols[t]) {
      const def = (c.column_default ?? '').replace(/\|/g, '\\|');
      const cmt = (colCommentOf[`${t}.${c.column_name}`] ?? '').replace(/\|/g, '\\|');
      L.push(
        `| \`${c.column_name}\` | ${shortType(c.data_type, c.len, c.prec, c.scale)} | ${
          c.is_nullable === 'YES' ? '是' : '否'
        } | ${def ? `\`${def}\`` : '—'} | ${cmt} |`
      );
    }
    const fksT = byTableFk[t] ?? [];
    if (fksT.length) {
      L.push('', '**外键**', '');
      L.push('| 列 | 引用 | 删除行为 |');
      L.push('|----|------|----------|');
      for (const f of fksT) L.push(`| \`${f.column_name}\` | \`${f.ref_table}.${f.ref_column}\` | ${f.delete_rule} |`);
    }
    const cks = byTableCheck[t] ?? [];
    if (cks.length) {
      L.push('', '**CHECK 约束**', '');
      for (const c of cks) L.push(`- \`${c.conname}\`：${c.def.replace(/\n/g, ' ')}`);
    }
    const ix = byTableIdx[t] ?? [];
    if (ix.length) {
      L.push('', '**索引**', '');
      for (const i of ix) L.push(`- \`${i.indexname}\`：${i.indexdef.replace(/^CREATE (UNIQUE )?INDEX \S+ ON /, '')}`);
    }
    const tg = byTableTrig[t] ?? [];
    if (tg.length) {
      L.push('', `**触发器**：${tg.map((x) => `\`${x.tgname}\``).join('、')}`);
    }
    L.push('');
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, L.join('\n'), 'utf8');
  console.log(`已导出 ${tables.length} 张表的结构 → ${path.relative(ROOT, OUT)}`);
}

main().catch((e) => {
  console.error('导出失败:', e.message);
  process.exit(1);
});
