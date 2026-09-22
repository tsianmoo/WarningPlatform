import { query, queryOne, execute } from '@/storage/database/db';

/**
 * 数据同步模块的存储层（重写版）。
 *
 * 修正旧设计：
 *   1. 旧版为 sync_* 单独开了一套裸 pg 连接池（和业务表的 Supabase 栈并存），
 *      还靠 spawn python 去读平台注入的环境变量；现在共用 src/storage/database/db.ts 的池。
 *   2. 旧版有 8 张结构完全相同的表（id + data jsonb + updated_at），
 *      本质是一张表加 type；现在统一为 sync_resources。
 *   3. 旧版表结构靠 ensureSchema() 在首次请求时字符串拼 SQL 创建；
 *      现在由 db/migrations 管理。
 *   4. 旧版水位值塞在 jsonb 里（无法用 SQL 比较）；现在抽成 value_text / value_num 真列。
 */

/** 旧表名 → sync_resources.type 映射（保持路由层调用方式不变） */
const TYPE_OF: Record<string, string> = {
  sync_data_sources: 'data_source',
  sync_datasets: 'dataset',
  sync_tasks: 'task',
  sync_instances: 'instance',
  sync_channels: 'channel',
  sync_meta_cache: 'meta_cache',
  sync_audit: 'audit',
  // 也允许直接传 type 名
  data_source: 'data_source',
  dataset: 'dataset',
  task: 'task',
  instance: 'instance',
  channel: 'channel',
  meta_cache: 'meta_cache',
  audit: 'audit',
};

function typeOf(table: string): string {
  const t = TYPE_OF[table];
  if (!t) throw new Error(`未知的同步资源表：${table}`);
  return t;
}

interface SyncRow {
  id: string;
  data: unknown;
  updated_at: Date | string;
}

/** 兼容旧数据：data 可能是字符串化的 JSON */
function parseData(v: unknown): unknown {
  if (typeof v === 'string') {
    try {
      return JSON.parse(v);
    } catch {
      return {};
    }
  }
  return v ?? {};
}

const pickString = (v: unknown): string | null => {
  const s = v === null || v === undefined ? '' : String(v);
  return s.trim() === '' ? null : s;
};

export async function listRows(table: string): Promise<unknown[]> {
  const t = typeOf(table);
  const rows = await query<SyncRow>(
    `SELECT id, data, updated_at FROM sync_resources WHERE type = $1 ORDER BY updated_at DESC`,
    [t]
  );
  return rows.map((r) => parseData(r.data));
}

export async function getRow<T = unknown>(table: string, id: string): Promise<T | null> {
  const t = typeOf(table);
  const row = await queryOne<SyncRow>(
    `SELECT id, data, updated_at FROM sync_resources WHERE id = $1 AND type = $2`,
    [id, t]
  );
  return row ? (parseData(row.data) as T) : null;
}

export async function upsertRow(table: string, id: string, data: unknown): Promise<void> {
  const t = typeOf(table);
  const obj = (data ?? {}) as Record<string, unknown>;
  // name / status 抽成真列，便于列表检索与统计（旧版全埋在 jsonb 里）
  await execute(
    `INSERT INTO sync_resources (id, type, name, status, data, updated_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (id) DO UPDATE
       SET type = EXCLUDED.type, name = EXCLUDED.name, status = EXCLUDED.status,
           data = EXCLUDED.data, updated_at = now()`,
    [id, t, pickString(obj.name), pickString(obj.status), JSON.stringify(obj)]
  );
}

export async function removeRow(table: string, id: string): Promise<void> {
  const t = typeOf(table);
  await execute(`DELETE FROM sync_resources WHERE id = $1 AND type = $2`, [id, t]);
}

// ---------------------------------------------------------------------------
// 增量水位（抽成真列，可用 SQL 直接比较）
// ---------------------------------------------------------------------------

export async function setWatermark(
  taskId: string,
  value: number | string,
  instanceId?: string
): Promise<void> {
  const isNum = typeof value === 'number' && Number.isFinite(value);
  await execute(
    `INSERT INTO sync_watermarks (task_id, value_text, value_num, instance_id, updated_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (task_id) DO UPDATE
       SET value_text = EXCLUDED.value_text, value_num = EXCLUDED.value_num,
           instance_id = EXCLUDED.instance_id, updated_at = now()`,
    [taskId, isNum ? null : String(value), isNum ? Math.floor(value as number) : null, instanceId ?? null]
  );
}

export async function getWatermark(
  taskId: string
): Promise<{ value: number | string; updatedAt: number } | null> {
  const row = await queryOne<{
    value_text: string | null;
    value_num: string | null;
    updated_at: Date | string;
  }>(`SELECT value_text, value_num, updated_at FROM sync_watermarks WHERE task_id = $1`, [taskId]);
  if (!row) return null;
  const value =
    row.value_num !== null && row.value_num !== undefined
      ? Number(row.value_num)
      : (row.value_text ?? '');
  const updatedAt = row.updated_at instanceof Date
    ? row.updated_at.getTime()
    : new Date(String(row.updated_at)).getTime();
  return { value, updatedAt };
}

export async function resetWatermark(taskId: string): Promise<void> {
  await execute(`DELETE FROM sync_watermarks WHERE task_id = $1`, [taskId]);
}

// ---------------------------------------------------------------------------
// 任务级调度锁
// ---------------------------------------------------------------------------

export async function tryAcquireLock(lockName: string, ttlSec: number): Promise<boolean> {
  const rows = await query<{ holder: string }>(
    `INSERT INTO sync_locks (lock_name, holder, acquired_at, expires_at)
     VALUES ($1, 'scheduler', now(), now() + ($2 || ' seconds')::interval)
     ON CONFLICT (lock_name) DO UPDATE
       SET holder = EXCLUDED.holder, acquired_at = now(), expires_at = EXCLUDED.expires_at
     WHERE sync_locks.expires_at IS NULL OR sync_locks.expires_at < now()
     RETURNING holder`,
    [lockName, String(ttlSec)]
  );
  return rows.length > 0;
}

export async function releaseLock(lockName: string): Promise<void> {
  await execute(`DELETE FROM sync_locks WHERE lock_name = $1 AND holder = 'scheduler'`, [lockName]).catch(
    () => {}
  );
}

// ---------------------------------------------------------------------------
// 懒启动调度器（表结构已由迁移创建，这里不再建表）
// ---------------------------------------------------------------------------

let ready = false;
export async function ensureStore(): Promise<void> {
  if (ready) return;
  ready = true;
  try {
    // 动态引入，避免构建期的副作用与循环依赖
    const m = require('@/lib/server/sync/scheduler') as { startSchedulerOnce?: () => void };
    m.startSchedulerOnce?.();
  } catch {
    /* 调度器启动失败不应阻塞数据同步接口 */
  }
}

async function withEnsure<T>(fn: () => Promise<T>): Promise<T> {
  await ensureStore();
  return fn();
}

/** 通用门面，业务代码统一走它（签名与旧版保持一致） */
export const store = {
  save(table: string, data: unknown) {
    const id = (data as { id?: string } | null)?.id;
    if (!id) throw new Error('store.save 需要 data.id');
    return withEnsure(() => upsertRow(table, id, data));
  },
  get(table: string, id: string) {
    return withEnsure(() => getRow(table, id));
  },
  list(table: string) {
    return withEnsure(() => listRows(table));
  },
  remove(table: string, id: string) {
    return withEnsure(() => removeRow(table, id));
  },
};
