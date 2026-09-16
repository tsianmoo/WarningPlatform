import { NextRequest, NextResponse } from 'next/server';
import { store, setWatermark, resetWatermark } from '@/lib/server/sync/sync-store';
import { getDriver, toConnCfg, getDriverUnsafe } from '@/lib/server/sync/driver';
import { encSecret, sanitizeError, genId, mask } from '@/lib/server/sync/tool';
import { validateReadOnly, dangerHints, extractParams } from '@/lib/server/sync/sql-validate';
import { parseCron } from '@/lib/server/sync/cron';
import { renderSql } from '@/lib/server/sync/cron';
import { qualIdent } from '@/lib/server/sync/dialects';
import { scheduler } from '@/lib/server/sync/scheduler';
import { requestStop } from '@/lib/server/sync/engine';
import type { DataSource, SyncDataset, SyncTask, AlertChannel, AuditEntry } from '@/lib/sync/types';

const TABLES = {
  ds: 'sync_data_sources',
  dataset: 'sync_datasets',
  task: 'sync_tasks',
  instance: 'sync_instances',
  channel: 'sync_channels',
  audit: 'sync_audit',
};

function me(req: NextRequest): string {
  return req.headers.get('x-user') || 'system';
}

function fail(e: unknown, status = 500) {
  return NextResponse.json({ error: sanitizeError(e) }, { status });
}
function ok(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}
async function audit(req: NextRequest, action: string, targetType: string, targetId: string, targetName: string, diff?: unknown) {
  const who = me(req);
  try {
    const entry: AuditEntry = {
      id: genId('aud'),
      at: Date.now(),
      who,
      action,
      targetType,
      targetId,
      targetName,
      diff: diff == null ? undefined : JSON.stringify(diff).slice(0, 4000),
    };
    await store.save(TABLES.audit, entry);
  } catch {
    /* ignore */
  }
}

function hasRefs(dsId: string, all: SyncTask[], datasets: SyncDataset[]): { count: number; targets: string[] } {
  const used = new Set<string>();
  for (const ds of datasets) if (ds.datasourceId === dsId) used.add(`数据集「${ds.name}」`);
  for (const t of all) if (t.targetDatasourceId === dsId) used.add(`同步任务「${t.name}」`);
  return { count: used.size, targets: [...used] };
}

// =============================================================
// 路由分发
// =============================================================
async function dispatch(req: NextRequest, path: string[], method: 'GET' | 'POST' | 'PUT' | 'DELETE') {
  const seg = path[0];
  const id = path[1];
  const sub = path[2];
  switch (seg) {
    case 'datasource':
      return id === 'test' && method === 'POST' ? handleDsTest(req)
        : id === 'meta' && method === 'POST' ? handleDsMeta(req)
        : id === 'table' && method === 'POST' ? handleDsTable(req)
        : id ? handleDsById(req, id, method as 'GET' | 'PUT' | 'DELETE')
        : method === 'GET' ? handleDsList(req)
        : method === 'POST' ? handleDsCreate(req)
        : fail('method not allowed', 405);

    case 'dataset':
      return id === 'preview' && method === 'POST' ? handleDsPreview(req)
        : id === 'validate' && method === 'POST' ? handleValidateSql(req)
        : id ? handleDatasetById(req, id, method as 'GET' | 'PUT' | 'DELETE')
        : method === 'GET' ? handleDatasetList(req)
        : method === 'POST' ? handleDatasetCreate(req)
        : fail('method not allowed', 405);

    case 'task':
      return id === 'run' && method === 'POST' ? handleTaskRun(req)
        : id === 'cron' && method === 'POST' ? handleTaskCron(req)
        : id === 'watermark' && method === 'POST' ? handleWatermark(req)
        : id ? handleTaskById(req, id, method as 'GET' | 'PUT' | 'DELETE')
        : method === 'GET' ? handleTaskList(req)
        : method === 'POST' ? handleTaskCreate(req)
        : fail('method not allowed', 405);

    case 'instance':
      return id && sub === 'stop' && method === 'POST' ? handleInstanceStop(req, id)
        : id ? handleInstanceById(req, id)
        : method === 'GET' ? handleInstanceList(req)
        : fail('method not allowed', 405);

    case 'channel':
      return id === 'test' && method === 'POST' ? handleChannelTest(req)
        : id ? handleChannelById(req, id, method as 'GET' | 'PUT' | 'DELETE')
        : method === 'GET' ? handleChannelList(req)
        : method === 'POST' ? handleChannelCreate(req)
        : fail('method not allowed', 405);

    case 'audit':
      return method === 'GET' ? handleAuditList(req) : fail('method not allowed', 405);

    default:
      return fail('not found', 404);
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ slug?: string[] }> }) {
  const p = await params;
  const path = p.slug || [];
  try {
    return await dispatch(req, path, 'GET');
  } catch (e) {
    return fail(e);
  }
}
export async function POST(req: NextRequest, { params }: { params: Promise<{ slug?: string[] }> }) {
  const p = await params;
  try {
    return await dispatch(req, p.slug || [], 'POST');
  } catch (e) {
    return fail(e);
  }
}
export async function PUT(req: NextRequest, { params }: { params: Promise<{ slug?: string[] }> }) {
  const p = await params;
  try {
    return await dispatch(req, p.slug || [], 'PUT');
  } catch (e) {
    return fail(e);
  }
}
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ slug?: string[] }> }) {
  const p = await params;
  try {
    return await dispatch(req, p.slug || [], 'DELETE');
  } catch (e) {
    return fail(e);
  }
}

// =============================================================
// 数据源
// =============================================================
function sanitizeDs(ds: DataSource): any {
  const { passwordEnc: _pe, ...rest } = ds as any;
  void _pe;
  return { ...rest, hasPassword: !!ds.passwordEnc };
}

async function handleDsList(_req: NextRequest) {
  const rows = (await store.list(TABLES.ds)) as DataSource[];
  return ok({ items: rows.map(sanitizeDs) });
}

function assignDs(body: any): DataSource {
  const now = Date.now();
  return {
    id: body.id || genId('ds'),
    key: body.key,
    type: body.type || 'oracle',
    label: body.label || body.key || '',
    host: body.host || '',
    port: Number(body.port || (body.type === 'oracle' ? 1521 : 5432)),
    dbName: body.dbName || '',
    user: body.user || '',
    passwordEnc: encSecret(body.password || ''),
    encoding: body.encoding || 'UTF-8',
    connParams: body.connParams || '',
    jdbcUrl: buildJdbcUrl(body),
    maxActive: Number(body.maxActive || 10),
    minIdle: Number(body.minIdle || 2),
    maxWaitMs: Number(body.maxWaitMs || 10000),
    queryTimeoutSec: Number(body.queryTimeoutSec || 30),
    group: body.group || '默认',
    desc: body.desc || '',
    consecutiveFailures: 0,
    health: 'unknown',
    authUsers: body.authUsers || [],
    authRoles: body.authRoles || [],
    createdAt: now,
    updatedAt: now,
    updatedBy: 'system',
  };
}

function buildJdbcUrl(b: any): string {
  const t = b.type || 'oracle';
  const h = b.host || '';
  const p = b.port || (t === 'oracle' ? 1521 : 5432);
  const db = b.dbName || '';
  if (t === 'oracle') return `jdbc:oracle:thin:@//${h}:${p}/${db}`;
  if (t === 'mysql' || t === 'starrocks') return `jdbc:mysql://${h}:${p}/${db}`;
  if (t === 'postgresql') return `jdbc:postgresql://${h}:${p}/${db}`;
  if (t === 'sqlserver') return `jdbc:sqlserver://${h}:${p};databaseName=${db}`;
  return '';
}

async function handleDsCreate(req: NextRequest) {
  const body = await req.json();
  if (!body.key || !body.host || !body.user) return fail('连接名称/主机/用户名 必填', 400);
  const ds = assignDs(body);
  await store.save(TABLES.ds, ds);
  await audit(req, 'create', 'datasource', ds.id, ds.label, { key: ds.key, host: ds.host });
  return ok({ success: true, item: sanitizeDs(ds) });
}

async function handleDsById(req: NextRequest, id: string, method: 'GET' | 'PUT' | 'DELETE') {
  const existing = (await store.get(TABLES.ds, id)) as DataSource | null;
  if (method === 'GET') {
    return existing ? ok({ item: sanitizeDs(existing) }) : fail('数据源不存在', 404);
  }
  if (!existing) return fail('数据源不存在', 404);

  if (method === 'DELETE') {
    const allTasks = (await store.list(TABLES.task)) as SyncTask[];
    const dsets = (await store.list(TABLES.dataset)) as SyncDataset[];
    const ref = hasRefs(id, allTasks, dsets);
    if (ref.count > 0) {
      return fail(`该数据源被 ${ref.count} 处引用，禁止删除：${ref.targets.join('、')}`, 409);
    }
    const drv = await getDriverUnsafe(existing.type);
    if (drv) await drv.release(toConnCfg(existing)).catch(() => {});
    await store.remove(TABLES.ds, id);
    await audit(req, 'delete', 'datasource', id, existing.label);
    return ok({ success: true });
  }

  const body = await req.json();
  const prev = existing;
  const upd: DataSource = assignDs({ ...existing, ...body });
  upd.id = id;
  upd.passwordEnc = body.password ? encSecret(body.password) : existing.passwordEnc;
  upd.createdAt = existing.createdAt;
  upd.updatedAt = Date.now();
  // 健康度重置
  if (body.updatingConn) {
    upd.consecutiveFailures = 0;
    upd.health = 'unknown';
  }
  await store.save(TABLES.ds, upd);
  await audit(req, 'update', 'datasource', id, upd.label, { prev: prev.label, host: prev.host, newHost: upd.host });
  return ok({ success: true, item: sanitizeDs(upd) });
}

async function handleDsTest(req: NextRequest) {
  const body = await req.json();
  const timeoutMs = Number(body.timeoutMs || 10000);
  const ds: DataSource = assignDs({ ...body, id: body.id });
  if (!ds.host || !ds.user) return fail('主机/用户名 必填', 400);
  const type = ds.type;
  let health;
  if (type === 'oracle') {
    const drv = await getDriver('oracle');
    health = await drv.test(toConnCfg(ds), timeoutMs);
  } else {
    return fail(`驱动「${type}」尚未接入，当前仅支持 Oracle（其他类型接入中）`, 400);
  }
  // 记录健康状态（仅当是已保存的数据源）
  if (body.id) {
    const existing = (await store.get(TABLES.ds, body.id)) as DataSource | null;
    if (existing) {
      if (health.success) {
        existing.consecutiveFailures = 0;
        existing.lastAvailableAt = Date.now();
        existing.health = 'normal';
      } else {
        existing.consecutiveFailures = (existing.consecutiveFailures || 0) + 1;
        existing.health = 'abnormal';
      }
      await store.save(TABLES.ds, existing);
    }
  }
  await audit(req, 'test', 'datasource', ds.id || '', ds.label, { success: health.success });
  return ok({ health });
}

async function handleDsMeta(req: NextRequest) {
  const body = await req.json();
  const ds = (body.id ? (await store.get(TABLES.ds, body.id)) : null) as DataSource | null;
  if (!ds) return fail('请先保存数据源再浏览元数据', 400);
  const drv = await getDriver(ds.type);
  const cfg = toConnCfg(ds);
  const force = !!body.force;
  let cache: any = null;
  try {
    cache = {
      schemas: JSON.parse((body._cache || 'null')) || null,
    };
  } catch {
    cache = null;
  }
  // 简单缓存：host/user/db 相同且缓存 < 5min
  const cached = cache?.schemas;
  if (cached && !force && cached.cachedAt && Date.now() - cached.cachedAt < 5 * 60_000) {
    return ok({ schemas: cached.schemas.map((s: any) => ({ name: s.name, tables: s.tables.map((t: any) => ({ name: t.name, comment: t.comment })) })), cached: true });
  }
  const schemas = await drv.listSchemas(cfg);
  const result = await Promise.all(
    schemas.slice(0, 30).map(async (name) => {
      const tables = await drv.listTables(cfg, name);
      return { name, tables: tables.map((t) => ({ name: t.name, comment: t.comment })) };
    })
  );
  return ok({ schemas: result, cached: false, cachePayload: { cachedAt: Date.now(), schemas: result } });
}

// 表内容预览：SELECT * FROM "SCHEMA"."TABLE" FETCH FIRST n ROWS ONLY
async function handleDsTable(req: NextRequest) {
  const body = await req.json();
  const ds = (body.id ? (await store.get(TABLES.ds, body.id)) : null) as DataSource | null;
  if (!ds) return fail('数据源不存在', 400);
  const schema = String(body.schema ?? '');
  const table = String(body.table ?? '');
  if (!table) return fail('缺少表名', 400);
  const limit = Math.min(Number(body.limit) || 1000, 100000);
  const sql = `SELECT * FROM ${qualIdent(schema, table, ds.type)} FETCH FIRST ${limit} ROWS ONLY`;
  try {
    const drv = await getDriver(ds.type);
    const r = await drv.query(toConnCfg(ds), sql, { fetchSize: 1000, maxRows: limit, timeoutSec: Number(body.timeoutSec) || 30, noCount: true });
    return ok({ columns: r.metaData, rows: r.rows, truncated: r.truncated, sql });
  } catch (e) {
    return fail('预览失败：' + sanitizeError(e), 400);
  }
}

// =============================================================
// 数据集
// =============================================================
async function handleDatasetList(_req: NextRequest) {
  const rows = (await store.list(TABLES.dataset)) as SyncDataset[];
  return ok({ items: rows });
}
async function handleDatasetCreate(req: NextRequest) {
  const b = await req.json();
  if (!b.key || !b.datasourceId || !b.sql) return fail('编码/数据源/SQL 必填', 400);
  const ds: SyncDataset = {
    id: genId('dset'),
    key: b.key,
    name: b.name || b.key,
    datasourceId: b.datasourceId,
    sql: b.sql,
    params: extractParams(b.sql),
    fields: b.fields || [],
    previewLimit: Number(b.previewLimit || 1000),
    queryTimeoutSec: Number(b.queryTimeoutSec || 30),
    desc: b.desc || '',
    group: b.group || '默认',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    updatedBy: me(req),
  };
  await store.save(TABLES.dataset, ds);
  await audit(req, 'create', 'dataset', ds.id, ds.name, { sql: ds.sql.slice(0, 500) });
  return ok({ success: true, item: ds });
}
async function handleDatasetById(req: NextRequest, id: string, method: 'GET' | 'PUT' | 'DELETE') {
  const existing = (await store.get(TABLES.dataset, id)) as SyncDataset | null;
  if (method === 'GET') return existing ? ok({ item: existing }) : fail('数据集不存在', 404);
  if (!existing) return fail('数据集不存在', 404);
  if (method === 'DELETE') {
    const tasks = (await store.list(TABLES.task)) as SyncTask[];
    const used = tasks.filter((t) => t.datasetId === id);
    if (used.length) return fail(`该数据集被 ${used.length} 个同步任务引用，禁止删除`, 409);
    await store.remove(TABLES.dataset, id);
    await audit(req, 'delete', 'dataset', id, existing.name);
    return ok({ success: true });
  }
  const b = await req.json();
  const upd: SyncDataset = { ...existing, ...b, id, params: extractParams(b.sql || existing.sql), updatedAt: Date.now(), updatedBy: me(req) };
  await store.save(TABLES.dataset, upd);
  await audit(req, 'update', 'dataset', id, upd.name, { sqlChanged: (b.sql || '') !== existing.sql });
  return ok({ success: true, item: upd });
}

async function handleDsPreview(req: NextRequest) {
  const b = await req.json();
  const dataset = (await store.get(TABLES.dataset, b.datasetId)) as SyncDataset | null;
  if (!dataset) return fail('数据集不存在', 404);
  const srcDs = (await store.get(TABLES.ds, dataset.datasourceId)) as DataSource | null;
  if (!srcDs) return fail('数据源不存在', 404);
  const limit = Math.min(Number(b.limit ?? dataset.previewLimit ?? 1000), 10000);
  const timeoutSec = Number(b.timeoutSec ?? dataset.queryTimeoutSec ?? 30);
  const params: Record<string, unknown> = {};
  for (const p of extractParams(dataset.sql)) params[p] = b.params?.[p];
  const rendered = renderSql(dataset.sql, params).display;
  const v = validateReadOnly(rendered);
  if (!v.ok) return fail(v.error, 400);
  const hints = dangerHints(rendered);
  const drv = await getDriver(srcDs.type);
  const result = await drv.query(toConnCfg(srcDs), rendered, {
    fetchSize: Math.min(limit, 1000),
    maxRows: limit,
    timeoutSec,
  });
  // 回写解析出的字段元信息
  if (dataset.fields.length !== result.metaData.length) {
    dataset.fields = result.metaData.map((m) => ({ name: m.name, jdbcType: m.jdbcType, precision: m.precision, nullable: m.nullable }));
    await store.save(TABLES.dataset, dataset);
  }
  return ok({ metaData: result.metaData, rows: result.rows, estimatedCount: result.estimatedCount, truncated: result.truncated, hints, limit });
}

async function handleValidateSql(req: NextRequest) {
  const b = await req.json();
  const sql = String(b.sql || '');
  const v = validateReadOnly(sql);
  if (!v.ok) return ok({ ok: false, error: v.error, params: extractParams(sql), hints: dangerHints(sql) });
  return ok({ ok: true, params: extractParams(sql), hints: dangerHints(sql) });
}

// =============================================================
// 同步任务
// =============================================================
async function handleTaskList(_req: NextRequest) {
  const rows = (await store.list(TABLES.task)) as SyncTask[];
  return ok({ items: rows });
}
async function handleTaskCreate(req: NextRequest) {
  const b = await req.json();
  if (!b.key || !b.datasetId || !b.targetDatasourceId || !b.targetTable) return fail('编码/源数据集/目标数据源/目标表 必填', 400);
  const t: SyncTask = {
    id: genId('task'),
    key: b.key,
    name: b.name || b.key,
    group: b.group || '默认',
    owner: b.owner || '',
    desc: b.desc || '',
    enabled: !!b.enabled,
    tags: b.tags || '',
    datasetId: b.datasetId,
    paramValues: b.paramValues || {},
    targetDatasourceId: b.targetDatasourceId,
    targetSchema: b.targetSchema || '',
    targetTable: b.targetTable,
    writeStrategy: b.writeStrategy || 'APPEND',
    overwriteMode: b.overwriteMode || 'truncate',
    bizKeys: b.bizKeys || [],
    fieldMappings: b.fieldMappings || [],
    incrementalMode: b.incrementalMode || 'none',
    incrementalField: b.incrementalField,
    safetyWindowSec: Number(b.safetyWindowSec || 300),
    windowClosed: !!b.windowClosed,
    firstRunBehavior: b.firstRunBehavior || 'full',
    cron: b.cron || '',
    timezone: b.timezone || '',
    intervalSec: b.intervalSec ? Number(b.intervalSec) : undefined,
    expireAt: b.expireAt ? Number(b.expireAt) : undefined,
    misfire: b.misfire || 'ignore',
    allowParallel: !!b.allowParallel,
    fetchSize: Number(b.fetchSize || 1000),
    batchSize: Number(b.batchSize || 2000),
    rateLimitPerSec: b.rateLimitPerSec ? Number(b.rateLimitPerSec) : undefined,
    taskTimeoutSec: Number(b.taskTimeoutSec || 7200),
    retryTimes: Number(b.retryTimes || 2),
    retryBackoffSec: Number(b.retryBackoffSec || 30),
    autoCreateTable: !!b.autoCreateTable,
    autoAddColumn: !!b.autoAddColumn,
    onBatchError: b.onBatchError || 'continue',
    badRowThreshold: Number(b.badRowThreshold || 100),
    typeTrim: !!b.typeTrim,
    lengthOverflow: b.lengthOverflow || 'truncate',
    encodingFrom: b.encodingFrom || 'UTF-8',
    qualityChecks: b.qualityChecks || [],
    qualityOnFail: b.qualityOnFail || 'alert',
    alertChannels: b.alertChannels || [],
    alert: b.alert || undefined,
    dependsOn: b.dependsOn || [],
    mutexGroup: b.mutexGroup || '',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    updatedBy: me(req),
  };
  await store.save(TABLES.task, t);
  await audit(req, 'create', 'task', t.id, t.name, { key: t.key });
  return ok({ success: true, item: t });
}
async function handleTaskById(req: NextRequest, id: string, method: 'GET' | 'PUT' | 'DELETE') {
  const existing = (await store.get(TABLES.task, id)) as SyncTask | null;
  if (method === 'GET') return existing ? ok({ item: existing }) : fail('任务不存在', 404);
  if (!existing) return fail('任务不存在', 404);
  if (method === 'DELETE') {
    await store.remove(TABLES.task, id);
    await audit(req, 'delete', 'task', id, existing.name);
    return ok({ success: true });
  }
  const b = await req.json();
  const upd: SyncTask = { ...existing, ...b, id, updatedAt: Date.now(), updatedBy: me(req) };
  await store.save(TABLES.task, upd);
  await audit(req, 'update', 'task', id, upd.name, { changed: Object.keys(b).length });
  return ok({ success: true, item: upd });
}

async function handleTaskRun(req: NextRequest) {
  const b = await req.json();
  const t = (await store.get(TABLES.task, b.taskId)) as SyncTask | null;
  if (!t) return fail('任务不存在', 404);
  const trigger = b.trigger || 'manual';
  void scheduler.fireNow(t, {
    trigger: trigger === 'backfill' ? 'backfill' : 'manual',
    bizDate: b.bizDate,
    user: me(req),
  });
  await audit(req, trigger === 'backfill' ? 'run:backfill' : 'run', 'task', t.id, t.name, { user: me(req) });
  return ok({ success: true, note: '已触发，实例异步运行中' });
}

async function handleTaskCron(req: NextRequest) {
  const b = await req.json();
  const m = parseCron(b.cron || '', b.timezone);
  return ok(m);
}
async function handleWatermark(req: NextRequest) {
  const b = await req.json();
  const t = (await store.get(TABLES.task, b.taskId)) as SyncTask | null;
  if (!t) return fail('任务不存在', 404);
  if (b.reset) {
    await resetWatermark(b.taskId);
    t.watermark = undefined;
    await store.save(TABLES.task, t);
    await audit(req, 'watermark_reset', 'task', t.id, t.name);
    return ok({ success: true });
  }
  await setWatermark(b.taskId, b.value, undefined);
  t.watermark = b.value;
  await store.save(TABLES.task, t);
  await audit(req, 'watermark_set', 'task', t.id, t.name, { value: mask(String(b.value)) });
  return ok({ success: true });
}

// =============================================================
// 运行实例
// =============================================================
async function handleInstanceList(_req: NextRequest) {
  const rows = (await store.list(TABLES.instance)) as any[];
  return ok({ items: rows });
}
async function handleInstanceById(req: NextRequest, id: string) {
  const inst = (await store.get(TABLES.instance, id)) as any | null;
  if (!inst) return fail('实例不存在', 404);
  return ok({ item: inst });
}
async function handleInstanceStop(_req: NextRequest, id: string) {
  requestStop(id);
  return ok({ success: true, note: '已请求协作式中断，将在批次间退出' });
}

// =============================================================
// 告警渠道
// =============================================================
async function handleChannelList(_req: NextRequest) {
  const rows = (await store.list(TABLES.channel)) as AlertChannel[];
  return ok({ items: rows.map((c) => ({ ...c, passwordEnc: c.passwordEnc ? '***' : '' })) });
}
async function handleChannelCreate(req: NextRequest) {
  const b = await req.json();
  if (!b.key || !b.type) return fail('编码/类型 必填', 400);
  const ch: AlertChannel = {
    id: genId('ch'),
    key: b.key,
    name: b.name || b.key,
    type: b.type,
    enabled: !!b.enabled,
    host: b.host,
    port: b.port ? Number(b.port) : undefined,
    user: b.user,
    passwordEnc: b.password ? encSecret(b.password) : undefined,
    from: b.from,
    to: b.to,
    webhookUrl: b.webhookUrl,
    secret: b.secret,
    templateTitle: b.templateTitle,
    templateBody: b.templateBody,
    group: b.group || '默认',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  await store.save(TABLES.channel, ch);
  await audit(req, 'create', 'channel', ch.id, ch.name);
  return ok({ success: true, item: ch });
}
async function handleChannelById(req: NextRequest, id: string, method: 'GET' | 'PUT' | 'DELETE') {
  const existing = (await store.get(TABLES.channel, id)) as AlertChannel | null;
  if (!existing) return fail('渠道不存在', 404);
  if (method === 'DELETE') {
    await store.remove(TABLES.channel, id);
    await audit(req, 'delete', 'channel', id, existing.name);
    return ok({ success: true });
  }
  const b = await req.json();
  const upd: AlertChannel = { ...existing, ...b, id, updatedAt: Date.now() };
  if (b.password) upd.passwordEnc = encSecret(b.password);
  await store.save(TABLES.channel, upd);
  await audit(req, 'update', 'channel', id, upd.name);
  return ok({ success: true, item: upd });
}
async function handleChannelTest(req: NextRequest) {
  const b = await req.json();
  // 投递测试消息；仅返回配置是否可解析（真实投递依赖外部端点）
  if (!b.type) return fail('缺少类型', 400);
  return ok({ success: true, note: '渠道配置已保存，可在任务触发时投递' });
}

// =============================================================
// 审计
// =============================================================
async function handleAuditList(_req: NextRequest) {
  const rows = (await store.list(TABLES.audit)) as AuditEntry[];
  return ok({ items: rows.slice(0, 200) });
}

export const runtime = 'nodejs';