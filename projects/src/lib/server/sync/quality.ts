import { getDriver } from '@/lib/server/sync/driver';
import { toConnCfg } from '@/lib/server/sync/driver';
import { qualIdent } from '@/lib/server/sync/dialects';
import { sanitizeError } from '@/lib/server/sync/tool';
import { renderTargetTable } from '@/lib/server/sync/writer';
import type { DataSource, QualityResult, SyncDataset, SyncInstance, SyncTask } from '@/lib/sync/types';

/** 执行任务配置的质量校验规则 */
export async function runQualityChecks(
  inst: SyncInstance,
  task: SyncTask,
  tgtDs: DataSource,
  dataset: SyncDataset
): Promise<QualityResult[]> {
  const results: QualityResult[] = [];
  const enabled = (task.qualityChecks || []).filter((q) => q.enabled);
  if (!enabled.length) return results;
  const driver = await getDriver(tgtDs.type);
  const cfg = toConnCfg(tgtDs);
  const table = qualIdent(task.targetSchema, renderTargetTable(task.targetTable), tgtDs.type);

  for (const q of enabled) {
    try {
      results.push(await runOne(q, driver, cfg, table, inst));
    } catch (e) {
      results.push({ checkId: q.id, label: q.label, pass: false, detail: '校验执行异常：' + sanitizeError(e) });
    }
  }
  return results;
}

async function runOne(
  q: SyncTask['qualityChecks'][0],
  driver: Awaited<ReturnType<typeof getDriver>>,
  cfg: ReturnType<typeof toConnCfg>,
  table: string,
  inst: SyncInstance
): Promise<QualityResult> {
  switch (q.type) {
    case 'row_count': {
      const r = await driver.query(cfg, `SELECT COUNT(1) AS C FROM ${table}`, { fetchSize: 1, maxRows: 1 });
      const rows = Number(r.rows?.[0]?.C ?? 0);
      const expect = inst.writeRows;
      const gapRatio = expect === 0 ? 0 : Math.abs(rows - expect) / Math.max(expect, 1);
      const within = (q.toleranceRate ?? 0.02) >= gapRatio;
      return { checkId: q.id, label: q.label, pass: within, detail: `本批写 ${expect} 行，目标表当前 ${rows} 行（误差 ${(gapRatio * 100).toFixed(2)}%）` };
    }
    case 'key_unique': {
      if (!q.field) return { checkId: q.id, label: q.label, pass: true, detail: '未配置校验字段，跳过' };
      const f = q.field.toUpperCase();
      const r = await driver.query(cfg, `SELECT COUNT(1) AS C, COUNT(DISTINCT "${f}") AS D FROM ${table}`, { fetchSize: 1, maxRows: 1 });
      const c = Number(r.rows?.[0]?.C ?? 0);
      const d = Number(r.rows?.[0]?.D ?? 0);
      return { checkId: q.id, label: q.label, pass: c === d, detail: `${f} 总数=${c}，去重=${d}` };
    }
    case 'null_rate': {
      if (!q.field) return { checkId: q.id, label: q.label, pass: true, detail: '未配置校验字段，跳过' };
      const f = q.field.toUpperCase();
      const r = await driver.query(cfg, `SELECT COUNT(1) AS C, COUNT("${f}") AS N FROM ${table}`, { fetchSize: 1, maxRows: 1 });
      const c = Number(r.rows?.[0]?.C ?? 0);
      const n = Number(r.rows?.[0]?.N ?? 0);
      const nullRate = c === 0 ? 0 : 1 - n / c;
      const max = q.max ?? 0.1;
      return { checkId: q.id, label: q.label, pass: nullRate <= max, detail: `${f} 空值率=${(nullRate * 100).toFixed(2)}%（阈值 ${(max * 100).toFixed(0)}%）` };
    }
    case 'reconcile_sum': {
      if (!q.field) return { checkId: q.id, label: q.label, pass: true, detail: '未配置字段，跳过' };
      const r = await driver.query(cfg, `SELECT SUM("${q.field.toUpperCase()}") AS S FROM ${table}`, { fetchSize: 1, maxRows: 1 });
      const sum = Number(r.rows?.[0]?.S ?? 0);
      const expect = q.min ?? 0;
      const diff = Math.abs(sum - expect);
      const tol = Math.abs((q.toleranceRate ?? 0.05) * Math.max(expect, 1));
      return { checkId: q.id, label: q.label, pass: diff <= tol, detail: `目标 SUM=${sum}，期望 ${expect}，偏差 ${diff}` };
    }
    case 'custom_sql': {
      const r = await driver.query(cfg, q.customSql || 'SELECT 1 AS C FROM DUAL', { fetchSize: 1, maxRows: 1 });
      const c = Number(r.rows?.[0]?.C ?? 1);
      return { checkId: q.id, label: q.label, pass: c === 0, detail: `${q.customSql} → 返回 ${c}（0=通过）` };
    }
    default:
      return { checkId: q.id, label: q.label, pass: true, detail: '未实现该校验类型' };
  }
}