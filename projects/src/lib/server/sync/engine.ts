import { getDriver, toConnCfg } from '@/lib/server/sync/driver';
import { getRow, upsertRow, setWatermark, getWatermark } from '@/lib/server/sync/sync-store';
import { quoteLiteral, renderSql, resolveBuiltin } from '@/lib/server/sync/cron';
import { validateReadOnly, dangerHints, extractParams } from '@/lib/server/sync/sql-validate';
import { qualIdent, ident } from '@/lib/server/sync/dialects';
import { sanitizeError, genId } from '@/lib/server/sync/tool';
import { ensureTargetTable, writeBatch, transformRows, fallbackRows, incrementOf } from '@/lib/server/sync/writer';
import { runQualityChecks } from '@/lib/server/sync/quality';
import type {
  SyncInstance,
  SyncTask,
  SyncDataset,
  DataSource,
  QualityResult,
  LogLevel,
} from '@/lib/sync/types';

/** 运行中的实例 id 集合（进程内防重入） */
export const ACTIVE_INSTANCES = new Set<string>();
const STOP_FLAG = new Map<string, boolean>();

export interface RunContext {
  stopRequested: boolean;
  requestStop: () => void;
}

export function requestStop(instanceId: string): void {
  STOP_FLAG.set(instanceId, true);
}
export function clearStop(instanceId: string): void {
  STOP_FLAG.delete(instanceId);
}

// ---------- 基础工具 ----------
function log(inst: SyncInstance, level: LogLevel, msg: string): void {
  inst.log.push({ level, msg, at: Date.now() });
  if (inst.log.length > 2000) inst.log.splice(0, inst.log.length - 2000);
}

async function persist(inst: SyncInstance): Promise<void> {
  await upsertRow('sync_instances', inst.id, inst).catch(() => {});
}

export async function getTask(id: string): Promise<SyncTask | null> {
  return getRow('sync_tasks', id);
}
export async function getDataset(id: string): Promise<SyncDataset | null> {
  return getRow('sync_datasets', id);
}
export async function getDatasource(id: string): Promise<DataSource | null> {
  return getRow('sync_data_sources', id);
}

function resolveValue(raw: string | undefined, wm: number | string | undefined, baseline: number | undefined): string {
  if (!raw) return '';
  const env: Record<string, string> = {
    TODAY: () => resolveBuiltin('TODAY'),
    YESTERDAY: () => resolveBuiltin('YESTERDAY'),
    NOW: () => resolveBuiltin('NOW'),
    YYYYMM: () => resolveBuiltin('YYYYMM'),
  } as unknown as Record<string, string>;
  let out = raw;
  const m = /^\$\{([^}]+)\}$/.exec(raw.trim());
  if (m) {
    const n = m[1].toUpperCase().replace(/:/g, '');
    if (n === 'WATERMARK') return String(wm ?? resolveBuiltin('TODAY'));
    if (n === 'BASELINE') return String(baseline ?? Date.now());
    return resolveBuiltin(n);
  }
  return out;
}

// ---------- 主流程 ----------
export async function runTask(
  taskId: string,
  trigger: SyncInstance['trigger'],
  triggeredBy: string,
  opts: { backfill?: boolean; retryOf?: string; retryTimes?: number } = {}
): Promise<SyncInstance> {
  const task = await getTask(taskId);
  if (!task) throw new Error('任务不存在');
  if (ACTIVE_INSTANCES.has(taskId) && !task.allowParallel) {
    throw new Error('任务正在运行（防重入），跳过本次触发');
  }

  const inst: SyncInstance = {
    id: genId('inst'),
    taskId,
    taskName: task.name,
    trigger,
    status: 'running',
    startAt: Date.now(),
    readRows: 0,
    writeRows: 0,
    updateRows: 0,
    failedRows: 0,
    throughput: 0,
    triggeredBy,
    retryOf: opts.retryOf,
    retryTimes: opts.retryTimes ?? 0,
    params: {},
    sql: '',
    stage: { connect: 0, read: 0, transform: 0, write: 0, commit: 0 },
    log: [],
    dirtySample: [],
    qualityResults: [],
    progress: 0,
    allowParallel: task.allowParallel ?? false,
  };
  ACTIVE_INSTANCES.add(taskId);
  clearStop(inst.id);
  await persist(inst);
  log(inst, 'INFO', `实例启动：触发方式=${trigger}，发起人=${triggeredBy || '-'}`);
  await persist(inst);

  const overallStart = Date.now();
  let wmBefore: number | string | undefined;
  try {
    await execute(inst, task, wmBefore, opts);
    inst.status = 'success';
    inst.endAt = Date.now();
    inst.progress = 100;
    log(inst, 'INFO', `执行成功：读 ${inst.readRows} 行 / 写 ${inst.writeRows} 行 / 更新 ${inst.updateRows} 行 / 失败 ${inst.failedRows} 行`);
  } catch (e) {
    inst.status = 'failed';
    inst.endAt = Date.now();
    inst.error = sanitizeError(e);
    log(inst, 'ERROR', '执行失败：' + sanitizeError(e));
  } finally {
    const durSec = Math.max(1, (inst.endAt ?? Date.now()) - inst.startAt) / 1000;
    inst.throughput = Math.round(inst.writeRows / durSec);
    await persist(inst);
    ACTIVE_INSTANCES.delete(taskId);
    clearStop(inst.id);
  }
  return inst;
}

async function execute(inst: SyncInstance, task: SyncTask, _wmBefore: number | string | undefined, opts: { backfill?: boolean }) {
  const dataset = await getDataset(task.datasetId);
  if (!dataset) throw new Error('请选择数据集');
  const srcDs = await getDatasource(dataset.datasourceId);
  if (!srcDs) throw new Error('源数据源不存在');
  const tgtDs = await getDatasource(task.targetDatasourceId);
  if (!tgtDs) throw new Error('目标数据源不存在');

  const t0 = Date.now();
  const srcDriver = await getDriver(srcDs.type);
  const cfg = toConnCfg(srcDs);
  const tgtCfg = toConnCfg(tgtDs);

  // ---- 水位线 ----
  let watermark: number | string | undefined;
  const wmRow = await getWatermark(task.id);
  watermark = wmRow?.value;
  inst.watermarkBefore = watermark;
  for (const k of Object.keys(task.paramValues)) inst.params[k] = task.paramValues[k];
  inst.params.__watermark_before = watermark != null ? String(watermark) : '(无)';
  log(inst, 'INFO', `增量策略=${task.incrementalMode}，水位线=${watermark ?? '无'}`);

  // ---- 参数解析（静态 + 内置变量）----
  const params: Record<string, unknown> = {};
  for (const p of extractParams(dataset.sql)) {
    const raw = task.paramValues[p];
    params[p] = resolveValue(raw, watermark, undefined);
  }
  inst.params = { ...params } as Record<string, string>;

  // 增量自动注入（时间戳 / 自增ID）
  let finalSql = renderSql(dataset.sql, params).sql;
  if (task.incrementalMode === 'timestamp' || task.incrementalMode === 'autoincrement') {
    if (task.incrementalField && watermark != null) {
      if (!dataset.sql.includes('${WATERMARK}')) {
        const op = task.windowClosed ? '>' : '>'; // 开区间严格大于；闭区间按水位留安全窗口另行处理
        const where = `WHERE inc.${ident(task.incrementalField, srcDs.type)} ${op} ${typeof watermark === 'number' ? watermark : quoteLiteral(watermark)}`;
        finalSql = `SELECT * FROM (${finalSql}) __inc ${where}`;
        log(inst, 'INFO', `自动注入增量条件：${where}`);
      }
    } else if (!task.incrementalField && watermark != null) {
      log(inst, 'WARN', '未配置增量字段，将按全量处理');
    }
  } else if (task.incrementalMode === 'fullcompare') {
    log(inst, 'WARN', '全量+主键比对模式：先全量读取源');
  }

  // ---- 校验 ----
  const v = validateReadOnly(finalSql);
  if (!v.ok) throw new Error(v.error);
  const hints = dangerHints(finalSql);
  hints.forEach((h) => log(inst, 'WARN', '危险提示：' + h));

  inst.sql = finalSql;

  // ---- 目标表构建 ----
  await ensureTargetTable(inst, task, tgtDs, dataset);

  // ---- 流式读取源 ----
  const readStart = Date.now();
  const srcFetch = task.fetchSize || 1000;
  log(inst, 'INFO', `开始读取源：fetchSize=${srcFetch}`);
  const tgtDriver = await getDriver(tgtDs.type);
  const batchSize = task.batchSize || 2000;

  // 全量覆盖：先清空目标
  if (task.writeStrategy === 'OVERWRITE') {
    const clearSql = task.overwriteMode === 'delete'
      ? `DELETE FROM ${qualIdent(task.targetSchema, task.targetTable, tgtDs.type)}`
      : `TRUNCATE TABLE ${qualIdent(task.targetSchema, task.targetTable, tgtDs.type)}`;
    await tgtDriver.exec(tgtCfg, clearSql);
    log(inst, 'INFO', `OVERWRITE 已清空目标表：${task.overwriteMode || 'truncate'}`);
  }

  let batch: Record<string, unknown>[] = [];
  let curWatum = watermark;

  const processBatch = async (rows: Record<string, unknown>[]): Promise<void> => {
    inst.readRows += rows.length;
    const tranStart = Date.now();
    const transformed = transformRows(inst, task, rows);
    inst.stage.transform += Date.now() - tranStart;

    if (!transformed.length) {
      await persist(inst);
      return;
    }
    try {
      const written = await writeBatch(inst, task, tgtDs, tgtDriver, transformed);
      inst.writeRows += written.writes;
      inst.updateRows += written.updates;
      const m = incrementOf(task, transformed);
      if (m != null) curWatum = m;
      inst.progress = Math.min(95, Math.round((inst.readRows / (inst.readRows + 1000)) * 100));
      inst.stage.write += Date.now() - tranStart;
      await persist(inst);
    } catch (e) {
      const msg = sanitizeError(e);
      log(inst, 'WARN', `批次写入失败（${rows.length} 行）：${msg}`);
      if (task.onBatchError === 'abort') throw e;
      // 降级单条定位脏数据
      const bad = await fallbackRows(inst, task, tgtDs, tgtDriver, transformed, msg);
      inst.failedRows += bad;
      if (task.badRowThreshold && inst.failedRows > task.badRowThreshold) {
        throw new Error(`失败行数超过阈值 ${task.badRowThreshold}`);
      }
    }
  };

  for await (const chunk of srcDriver.streamQuery(cfg, finalSql, {}, { fetchSize: srcFetch, timeoutSec: task.taskTimeoutSec > 0 ? Math.min(task.taskTimeoutSec, 600) : 600 })) {
    if (STOP_FLAG.get(inst.id)) {
      log(inst, 'WARN', '收到停止请求，在批次间退出');
      inst.status = 'cancelled';
      throw new Error('用户取消');
    }
    batch.push(...chunk);
    while (batch.length >= batchSize) {
      const flush = batch.slice(0, batchSize);
      batch = batch.slice(batchSize);
      await processBatch(flush);
    }
  }
  if (batch.length) await processBatch(batch);
  inst.stage.read = Date.now() - readStart;

  // ---- 更新水位线（用本批实际最大值，而非调度时间）----
  if ((task.incrementalMode === 'timestamp' || task.incrementalMode === 'autoincrement') && curWatum != null) {
    await setWatermark(task.id, curWatum, inst.id);
    inst.watermarkAfter = curWatum;
    log(inst, 'INFO', `水位线更新为 ${curWatum}（取实际批次最大增量）`);
  } else if (wmRow?.value != null) {
    // 无增量但已有水位，保持不动（避免空跑丢水位）
  }

  // ---- 质量校验 ----
  const quality = await runQualityChecks(inst, task, tgtDs, dataset);
  inst.qualityResults = quality;
  const failedQual = quality.filter((q) => !q.pass);
  if (failedQual.length) {
    log(inst, 'WARN', `质量校验未通过 ${failedQual.length} 项：` + failedQual.map((q) => q.label).join(', '));
    if (task.qualityOnFail === 'block') {
      inst.status = 'failed';
      throw new Error('质量校验未通过（已阻断）');
    }
  }
  inst.stage.commit = Date.now() - t0;
}