import { execSync } from 'node:child_process';
import { Pool } from 'pg';

let envLoaded = false;
export function loadDbEnv(): void {
  if (envLoaded || process.env.PGHOST || process.env.PGDATABASE_URL) return;
  try {
    const pythonCode = `
import os, sys
try:
    from coze_workload_identity import Client
    c = Client(); envs = c.get_project_env_vars(); c.close()
    for e in envs:
        v = str(e.value)
        if v.startswith("'") and v.endswith("'"): v = v[1:-1]
        print(f"{e.key}={v}")
except Exception as e:
    print(f"# {e}", file=sys.stderr)
`;
    const out = execSync(`python3 -c '${pythonCode.replace(/'/g, "'\"'\"'")}'`, {
      encoding: 'utf-8',
      timeout: 15000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    for (const line of out.trim().split('\n')) {
      if (!line || line.startsWith('#')) continue;
      const idx = line.indexOf('=');
      if (idx <= 0) continue;
      const k = line.slice(0, idx);
      const v = line.slice(idx + 1);
      if (k === 'PGDATABASE_URL' || /^PG|COZE_SUPABASE/.test(k)) {
        if (!process.env[k]) process.env[k] = v;
      }
    }
    envLoaded = true;
  } catch {
    /* ignore */
  }
}

let pool: Pool | null = null;
export function dbPool(): Pool {
  loadDbEnv();
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.PGDATABASE_URL || `postgres://${process.env.PGUSER}:${process.env.PGPASSWORD}@${process.env.PGHOST}:${process.env.PGPORT}/${process.env.PGDATABASE}`,
      ssl: process.env.PGSSLMODE !== 'disable' ? { rejectUnauthorized: false } : false,
      max: 10,
    });
  }
  return pool;
}

const TABLES = [
  'sync_data_sources',
  'sync_datasets',
  'sync_tasks',
  'sync_instances',
  'sync_channels',
  'sync_audit',
  'sync_meta_cache',
  'sync_watermark',
];

/** 启动时幂等建表（不存在才建） */
export async function ensureSchema(): Promise<void> {
  const p = dbPool();
  const client = await p.connect();
  try {
    await client.query('BEGIN');
    for (const t of TABLES) {
      await client.query(`CREATE TABLE IF NOT EXISTS ${t} (
        id varchar(64) PRIMARY KEY,
        data jsonb NOT NULL DEFAULT '{}',
        updated_at timestamptz NOT NULL DEFAULT now()
      )`);
    }
    await client.query(`CREATE TABLE IF NOT EXISTS sync_lock (
      lock_name varchar(128) PRIMARY KEY,
      holder text,
      expires_at timestamptz
    )`);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/** 通用 JSONB 聚合读写 */
export async function listRows(table: string): Promise<any[]> {
  const r = await dbPool().query(`SELECT data FROM ${table} ORDER BY updated_at DESC`);
  return (r.rows || []).map((x) => x.data);
}
export async function getRow(table: string, id: string): Promise<any | null> {
  const r = await dbPool().query(`SELECT data FROM ${table} WHERE id=$1`, [id]);
  return r.rows?.[0]?.data ?? null;
}
export async function upsertRow(table: string, id: string, data: unknown): Promise<void> {
  await dbPool().query(
    `INSERT INTO ${table}(id, data, updated_at) VALUES($1,$2,now())
     ON CONFLICT (id) DO UPDATE SET data=EXCLUDED.data, updated_at=now()`,
    [id, JSON.stringify(data)]
  );
}
export async function removeRow(table: string, id: string): Promise<void> {
  await dbPool().query(`DELETE FROM ${table} WHERE id=$1`, [id]);
}

/** 水位线读写（每个任务一条） */
export async function setWatermark(taskId: string, value: number | string, instanceId?: string): Promise<void> {
  const data = { value, updatedAt: Date.now(), instanceId: instanceId || null };
  await upsertRow('sync_watermark', taskId, data);
}
export async function getWatermark(taskId: string): Promise<{ value: number | string; updatedAt: number } | null> {
  const d = await getRow('sync_watermark', taskId);
  return d || null;
}
export async function resetWatermark(taskId: string): Promise<void> {
  await removeRow('sync_watermark', taskId);
}

/** 尝试获取任务级调度锁（同任务不并发）；返回是否拿到 */
export async function tryAcquireLock(lockName: string, ttlSec: number): Promise<boolean> {
  const r = await dbPool().query(
    `INSERT INTO sync_lock(lock_name, holder, expires_at)
     VALUES($1, $2, now() + ($3 || ' seconds')::interval)
     ON CONFLICT (lock_name) DO UPDATE SET holder=EXCLUDED.holder, expires_at=EXCLUDED.expires_at
     WHERE sync_lock.expires_at IS NULL OR sync_lock.expires_at < now()
     RETURNING holder`,
    [lockName, 'scheduler', ttlSec]
  );
  return (r.rows?.length ?? 0) > 0;
}
export async function releaseLock(lockName: string): Promise<void> {
  await dbPool().query(`DELETE FROM sync_lock WHERE lock_name=$1 AND holder=$2`, [lockName, 'scheduler']).catch(() => {});
}

/** 首次使用守卫：建表 + 懒启动调度器（避免在 next build/静态生成阶段启动） */
let ready = false;
export async function ensureStore(): Promise<void> {
  if (ready) return;
  try {
    await ensureSchema();
    ready = true;
  } catch (e) {
    console.error('[sync] ensure schema failed', (e as Error).message);
  }
  try {
    // 动态引入避免循环依赖与构建期副作用
    const m = require('@/lib/server/sync/scheduler') as { startSchedulerOnce?: () => void };
    m.startSchedulerOnce?.();
  } catch {
    /* ignore */
  }
}

/** 通用门面，业务代码统一走它 */
export const store = {
  save(table: string, data: any) {
    return withEnsure(() => upsertRow(table, data.id, data));
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

async function withEnsure<T>(fn: () => Promise<T>): Promise<T> {
  await ensureStore();
  return fn();
}