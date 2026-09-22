import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import 'dotenv/config';

/**
 * 全站唯一数据库连接池。
 *
 * 修正的两处旧设计：
 *   1. 旧版存在两套互不相干的访问栈（Supabase PostgREST 走业务表、裸 pg 走同步表），
 *      现在统一为本地 PostgreSQL + 单一连接池。
 *   2. 旧版靠 spwan python 进程去读取平台注入的环境变量，失败即静默降级；
 *      现在显式从 .env.local 读取，缺失即抛错，不再静默。
 */

let pool: Pool | null = null;

function connectionString(): string {
  const url = process.env.DATABASE_URL;
  if (url && url.trim()) return url.trim();

  const { PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE } = process.env;
  if (PGHOST && PGDATABASE) {
    const u = PGUSER || 'postgres';
    const p = PGPASSWORD ? `:${encodeURIComponent(PGPASSWORD)}` : '';
    const port = PGPORT || '5432';
    return `postgres://${u}${p}@${PGHOST}:${port}/${PGDATABASE}`;
  }

  throw new Error(
    '数据库未配置：请在项目根目录的 .env.local 中设置 DATABASE_URL（或 PGHOST/PGDATABASE 等）。'
  );
}

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: connectionString(),
      max: Number(process.env.PG_POOL_MAX || 10),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      ssl: process.env.PGSSLMODE === 'require' ? { rejectUnauthorized: false } : false,
    });
    pool.on('error', (err) => {
      console.error('[db] 空闲连接异常:', err.message);
    });
  }
  return pool;
}

/** 执行一条 SQL 并返回行 */
export async function query<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  const res = await getPool().query<T>(sql, params as never[]);
  return res.rows;
}

/** 执行一条 SQL 并返回首行（无则 null） */
export async function queryOne<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: unknown[] = []
): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows.length > 0 ? rows[0] : null;
}

/** 执行写语句，返回影响行数 */
export async function execute(sql: string, params: unknown[] = []): Promise<number> {
  const res = await getPool().query(sql, params as never[]);
  return res.rowCount ?? 0;
}

/**
 * 事务包装。
 * 旧版 replaceTableRows 的「先 DELETE 全表再分批 INSERT」没有事务，
 * 并发读会命中空表；所有多语句写入一律走这里。
 */
export async function withTransaction<T>(fn: (tx: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** 健康检查：连通性探测 */
export async function pingDb(): Promise<boolean> {
  try {
    await query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

// ---- 从任意类型的 JSONB 值取对象（pg 会自动解析 jsonb，但历史数据可能是字符串） ----
export function asObject<T>(v: unknown, fallback: T): T {
  if (v === null || v === undefined) return fallback;
  if (typeof v === 'string') {
    try {
      return JSON.parse(v) as T;
    } catch {
      return fallback;
    }
  }
  return v as T;
}

export function asArray<T>(v: unknown, fallback: T[] = []): T[] {
  const o = asObject<unknown>(v, fallback);
  return Array.isArray(o) ? (o as T[]) : fallback;
}

// ---- 时间：DB 用 timestamptz，前端用毫秒数，转换集中在此 ----
export function toMs(v: unknown, fallback = Date.now()): number {
  if (v === null || v === undefined) return fallback;
  if (v instanceof Date) {
    const t = v.getTime();
    return Number.isFinite(t) ? t : fallback;
  }
  if (typeof v === 'number') return Math.floor(v);
  const t = new Date(String(v)).getTime();
  return Number.isFinite(t) ? t : fallback;
}

export function toMsOrNull(v: unknown): number | undefined {
  if (v === null || v === undefined) return undefined;
  return toMs(v, 0) || undefined;
}

/** 毫秒数 → 可写入 timestamptz 的值（非法则 null） */
export function msToTs(v: unknown): Date | null {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  const d = new Date(Math.floor(n));
  return Number.isNaN(d.getTime()) ? null : d;
}
