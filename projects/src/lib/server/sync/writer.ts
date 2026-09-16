import { getDriver } from '@/lib/server/sync/driver';
import { toConnCfg } from '@/lib/server/sync/driver';
import { qualIdent, ident, val, mapColumnType } from '@/lib/server/sync/dialects';
import type { Driver } from '@/lib/server/sync/driver';
import { sanitizeError } from '@/lib/server/sync/tool';
import { resolveBuiltin } from '@/lib/server/sync/cron';
import type { DatasetField, SyncDataset, SyncInstance, SyncTask, DataSource } from '@/lib/sync/types';

export type LogFn = (level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR', msg: string) => void;

/** 目标表名渲染（支持 ${TODAY}/${yyyyMM} 等日期分表变量） */
export function renderTargetTable(tpl: string): string {
  return tpl.replace(/\$\{([^}]+)\}/g, (_, k: string) => {
    const up = k.toUpperCase();
    if (up === 'TODAY') return resolveBuiltin('TODAY');
    if (up === 'YESTERDAY') return resolveBuiltin('YESTERDAY');
    if (up === 'NOW') return resolveBuiltin('NOW');
    if (up === 'YYYYMM') return resolveBuiltin('YYYYMM');
    return k;
  });
}

/** 数据集字段 → 目标列（迁移映射后的目标列名 + 类型） */
export function targetColumns(task: SyncTask, dataset: SyncDataset, tgtType: string): Array<{ src: string; tgt: string; jdbcType: string; precision: number }> {
  const map = new Map<string, { tgt?: string; ignore?: boolean; constValue?: string }>();
  (task.fieldMappings || []).forEach((m) => map.set(m.src, m));
  const cols: Array<{ src: string; tgt: string; jdbcType: string; precision: number }> = [];
  for (const f of dataset.fields || []) {
    const m = map.get(f.name);
    const tgt = m?.tgt || f.name;
    if (m?.ignore) continue;
    cols.push({ src: f.name, tgt, jdbcType: f.jdbcType, precision: f.precision });
  }
  return cols;
}

/** 确保目标表存在；不存在按数据集字段自动建表，新字段自动加列 */
export async function ensureTargetTable(inst: SyncInstance, task: SyncTask, tgtDs: DataSource, dataset: SyncDataset): Promise<void> {
  const resolvedTable = renderTargetTable(task.targetTable);
  const driver = await getDriver(tgtDs.type);
  const cfg = toConnCfg(tgtDs);
  const cols = targetColumns(task, dataset, tgtDs.type);
  const tableIdent = qualIdent(task.targetSchema, resolvedTable, tgtDs.type);

  let existingCols: string[] = [];
  try {
    const lc = await driver.listColumns(cfg, task.targetSchema, resolvedTable);
    existingCols = lc.map((c) => c.name.toLowerCase());
  } catch {
    existingCols = [];
  }

  if (existingCols.length === 0) {
    if (!task.autoCreateTable) {
      throw new Error(`目标表 ${tableIdent} 不存在且未开启「自动建表」`);
    }
    const ddl = buildCreateTable(task, cols, resolvedTable);
    await driver.exec(cfg, ddl);
    log(inst, 'INFO', `已自动建表：${tableIdent}`);
    return;
  }

  // 自动加列
  if (task.autoAddColumn) {
    for (const c of cols) {
      if (!existingCols.includes(c.tgt.toLowerCase())) {
        const ct = mapColumnType(c.jdbcType, { precision: c.precision }, tgtDs.type);
        const sql = `ALTER TABLE ${tableIdent} ADD (${ident(c.tgt, tgtDs.type)} ${ct})`;
        try {
          await driver.exec(cfg, sql);
          log(inst, 'INFO', `自动加列：${c.tgt} ${ct}`);
        } catch (e) {
          log(inst, 'WARN', `加列失败 ${c.tgt}: ${sanitizeError(e)}`);
        }
      }
    }
  }
}

function buildCreateTable(task: SyncTask, cols: ReturnType<typeof targetColumns>, table: string): string {
  const defs = cols.map((c) => `  ${ident(c.tgt)} ${mapColumnType(c.jdbcType, { precision: c.precision })}`);
  if (task.bizKeys?.length) {
    defs.push(`  CONSTRAINT PK_${table}_sync PRIMARY KEY (${task.bizKeys.map((k) => ident(k)).join(', ')})`);
  }
  return `CREATE TABLE ${ident(table)} (\n${defs.join(',\n')}\n)`;
}

/** 行转换：字段映射（改名/忽略/常量/系统字段）+ 清理 */
export function transformRows(inst: SyncInstance, task: SyncTask, rows: Record<string, unknown>[]): Record<string, unknown>[] {
  const map = new Map<string, { tgt?: string; ignore?: boolean; constValue?: string; isSystem?: boolean }>();
  (task.fieldMappings || []).forEach((m) => map.set(m.src, m));
  const batchId = `b${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
  const out: Record<string, unknown>[] = [];
  for (const r of rows) {
    const t: Record<string, unknown> = {};
    let included = false;
    for (const [src, v] of Object.entries(r)) {
      const m = map.get(src);
      if (m?.ignore) continue;
      const tgt = m?.tgt || src;
      t[tgt] = clean(v, task, src);
      included = true;
    }
    // 常量字段与系统字段
    for (const m of task.fieldMappings || []) {
      if (m.isSystem && !m.ignore) {
        t[m.tgt] = systemValue(m.src);
        included = true;
      } else if (m.constValue != null && !m.isSystem && !m.ignore) {
        t[m.tgt] = m.constValue;
        included = true;
      }
    }
    if (included) out.push(t);
  }
  return out;
}

function systemValue(src: string): unknown {
  switch (src.replace(/^_/, '')) {
    case 'sync_time':
      return new Date();
    case 'sync_batch_id':
      return `b${Date.now()}`;
    case 'source_table':
      return '${source}';
    case 'op':
      return 'upsert';
    default:
      return '${' + src + '}';
  }
}

function clean(v: unknown, task: SyncTask, _col: string): unknown {
  if (v == null) return v;
  if (typeof v === 'string' && task.typeTrim) v = v.trim();
  return v;
}

/** 取本批增量字段实际最大值（用于水位线） */
export function incrementOf(task: SyncTask, rows: Record<string, unknown>[]): number | string | null {
  if ((task.incrementalMode !== 'timestamp' && task.incrementalMode !== 'autoincrement') || !task.incrementalField) return null;
  let max: number | string | null = null;
  for (const r of rows) {
    const v = r[task.incrementalField];
    if (v == null) continue;
    const num = typeof v === 'number' ? v : typeof v === 'string' && !isNaN(Number(v)) ? Number(v) : NaN;
    if (!isNaN(num)) {
      if (max == null || num > Number(max)) max = num;
    } else {
      const s = v instanceof Date ? v.getTime() : String(v);
      if (max == null || s > String(max)) max = s;
    }
  }
  return max;
}

/** 批量写入目标（按写入策略） */
export async function writeBatch(
  inst: SyncInstance,
  task: SyncTask,
  tgtDs: DataSource,
  driver: Driver,
  rows: Record<string, unknown>[]
): Promise<{ writes: number; updates: number }> {
  if (!rows.length) return { writes: 0, updates: 0 };
  const resolvedTable = renderTargetTable(task.targetTable);
  const cols = Object.keys(rows[0]).filter((c) => rows[0][c] !== undefined);
  if (!cols.length) return { writes: 0, updates: 0 };
  const cfg = toConnCfg(tgtDs);
  const q = qualIdent(task.targetSchema, resolvedTable, tgtDs.type);
  const strategy = task.writeStrategy;

  let sql = '';
  switch (strategy) {
    case 'INSERT_IGNORE':
    case 'APPEND': {
      sql = buildMultiInsert(cols, rows, q);
      break;
    }
    case 'OVERWRITE': {
      sql = buildMultiInsert(cols, rows, q);
      break;
    }
    case 'UPSERT': {
      if (!task.bizKeys?.length) throw new Error('UPSERT 必须配置业务主键 bizKeys');
      sql = buildOracleMerge(cols, rows, q, task.bizKeys);
      break;
    }
    case 'TEMP_SWAP': {
      sql = buildMultiInsert(cols, rows, q);
      break;
    }
    default:
      throw new Error('未知写入策略');
  }
  const r = await driver.exec(cfg, sql);
  if (strategy === 'UPSERT') return { writes: 0, updates: rows.length };
  return { writes: r.rowsAffected || rows.length, updates: 0 };
}

function buildMultiInsert(cols: string[], rows: Record<string, unknown>[], q: string): string {
  const idents = cols.map((c) => ident(c)).join(', ');
  const selects = rows
    .map((r) => cols.map((c) => val(r[c])).join(', '))
    .map((vs) => `SELECT ${vs} FROM DUAL`)
    .join(' UNION ALL ');
  return `INSERT INTO ${q} (${idents})\n${selects}`;
}

function buildOracleMerge(cols: string[], rows: Record<string, unknown>[], q: string, keys: string[]): string {
  const allCols = cols;
  const idents = allCols.map((c) => ident(c));
  const selectItems = rows
    .map((r) => allCols.map((c) => `${val(r[c])} AS ${ident(c)}`).join(', '))
    .map((si) => `SELECT ${si} FROM DUAL`)
    .join(' UNION ALL ');
  const onCond = keys.map((k) => `t.${ident(k)} = s.${ident(k)}`).join(' AND ');
  const updateCols = allCols.filter((c) => !keys.includes(c));
  const setClause = updateCols.map((c) => `${ident(c)} = s.${ident(c)}`).join(', ');
  const insertCols = idents.join(', ');
  const insertVals = allCols.map((c) => `s.${ident(c)}`).join(', ');
  return `MERGE INTO ${q} t\nUSING (${selectItems}) s\nON (${onCond})\nWHEN MATCHED THEN UPDATE SET ${setClause}\nWHEN NOT MATCHED THEN INSERT (${insertCols}) VALUES (${insertVals})`;
}

/** 批次失败降级：单条写入定位脏数据 */
export async function fallbackRows(
  inst: SyncInstance,
  task: SyncTask,
  tgtDs: DataSource,
  driver: Driver,
  rows: Record<string, unknown>[],
  batchErr: string
): Promise<number> {
  let failed = 0;
  const resolvedTable = renderTargetTable(task.targetTable);
  const cfg = toConnCfg(tgtDs);
  const q = qualIdent(task.targetSchema, resolvedTable, tgtDs.type);
  for (const r of rows) {
    const cols = Object.keys(r).filter((c) => r[c] !== undefined);
    try {
      await driver.exec(cfg, buildMultiInsert(cols, [r], q));
    } catch (e) {
      failed++;
      if (inst.dirtySample.length < 100) {
        inst.dirtySample.push({ row: r, error: sanitizeError(e), at: Date.now() });
        log(inst, 'ERROR', `脏数据#${inst.dirtySample.length}（${batchErr}）：` + sanitizeError(e));
      }
    }
  }
  return failed;
}

export function log(inst: SyncInstance, level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR', msg: string): void {
  inst.log.push({ level, msg, at: Date.now() });
  if (inst.log.length > 3000) inst.log.splice(0, inst.log.length - 3000);
}