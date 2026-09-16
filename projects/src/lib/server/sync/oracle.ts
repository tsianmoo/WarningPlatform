import oracledb from 'oracledb';
import type {
  ColumnMeta,
  DbType,
  DriverHealth,
  TableMeta,
} from '@/lib/sync/types';
import type { ConnCfg, Driver, QueryOptions, QueryResult } from '@/lib/server/sync/driver';
import { sanitizeError } from '@/lib/server/sync/tool';

// thin 模式：纯 JS，无需安装 Oracle Instant Client
oracledb.autoCommit = false;

interface PoolKey {
  cfgId: string;
  user: string;
  host: string;
  db: string;
}

function buildConnectString(cfg: ConnCfg): string {
  const sid = /(?:^|&)sid=(1|true)(?:&|$)/i.test(cfg.connParams || '');
  const sep = sid ? ':' : '/';
  return `${cfg.host}:${cfg.port}${sep}${cfg.dbName}`;
}

const POOLS = new Map<string, oracledb.Pool>();

/** Oracle 连接的最小类型桩：允许泛型 execute、cancel、close */
interface OraConn {
  execute<T = any>(
    sql: string,
    binds?: any,
    options?: any
  ): Promise<{ rows?: T[]; metaData?: any[]; rowsAffected?: number }>;
  cancel(): void;
  close(): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
}

function poolKey(cfg: ConnCfg): PoolKey {
  return { cfgId: cfg.id, user: cfg.user, host: cfg.host, db: cfg.dbName };
}

function poolTag(k: PoolKey): string {
  return `${k.cfgId}:${k.user}@${k.host}/${k.db}`;
}

async function getPool(cfg: ConnCfg): Promise<oracledb.Pool> {
  const k = poolKey(cfg);
  const tag = poolTag(k);
  let pool: oracledb.Pool | undefined = POOLS.get(tag);
  if (!pool) {
    pool = await oracledb.createPool({
      user: cfg.user,
      password: cfg.password,
      connectString: buildConnectString(cfg),
      poolMax: Math.max(1, cfg.maxActive || 10),
      poolMin: Math.max(0, cfg.minIdle || 2),
      poolIncrement: 1,
      poolTimeout: 60,
      queueMax: Math.max(cfg.maxWaitMs || 10000, 1) * 0,
      queueTimeout: cfg.maxWaitMs || 10000,
      enableStatistics: false,
      // thin 模式其它高级参数走扩展属性
    } as oracledb.PoolAttributes);
    // thin 模式通过连接属性控制编码读取；UTF-8 默认即可，GBK 由语句层处理
    POOLS.set(tag, pool);
  }
  return pool;
}

/** 打开连接并执行 fn，超时通过 cancel 中断 */
async function withConn<T>(
  cfg: ConnCfg,
  timeoutMs: number | undefined,
  fn: (conn: OraConn) => Promise<T>
): Promise<T> {
  const pool = await getPool(cfg);
  const conn: OraConn = (await pool.getConnection()) as unknown as OraConn;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    if (timeoutMs && timeoutMs > 0) {
      timer = setTimeout(() => {
        try {
          conn.cancel();
        } catch {
          /* ignore */
        }
      }, timeoutMs);
    }
    return await fn(conn);
  } finally {
    if (timer) clearTimeout(timer);
    try {
      await conn.close();
    } catch {
      /* ignore */
    }
  }
}

function jdbcType(name: unknown, dbTypeName?: string): string {
  return String(dbTypeName || name || 'UNKNOWN');
}

function toColumns(meta: any[]): Array<{
  name: string;
  jdbcType: string;
  precision: number;
  nullable: boolean;
}> {
  return (meta || []).map((m) => ({
    name: m.name as string,
    jdbcType: jdbcType(m.dbType, m.dbTypeName),
    precision: Number(m.precision || 0),
    nullable: !m.nullable ? false : m.nullable === true || (m.nullable as unknown) === 1,
  }));
}

function isEmptyQueryWrapped(sql: string): boolean {
  const s = sql.replace(/\s+/g, ' ').trim();
  return /^\(\s*\)$/i.test(s);
}

export const oracleDriver: Driver = {
  type: 'oracle',

  async test(cfg: ConnCfg, timeoutMs: number): Promise<DriverHealth> {
    const started = Date.now();
    try {
      const info = await withConn(cfg, timeoutMs, async (conn) => {
        const ver = await conn.execute<{ B1: string }>(
          "SELECT BANNER_FULL FROM V$VERSION WHERE ROWNUM=1",
          {},
          { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        const user = await conn.execute<{ B1: string; SCHEMA_NAME: string }>(
          'SELECT USER AS B1, SYS_CONTEXT(\'USERENV\', \'CURRENT_SCHEMA\') AS SCHEMA_NAME FROM DUAL',
          {},
          { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        return {
          version: (ver.rows?.[0]?.B1 || '').trim(),
          user: user.rows?.[0]?.B1 || '',
          schema: user.rows?.[0]?.SCHEMA_NAME || '',
        };
      });
      return {
        success: true,
        elapsedMs: Date.now() - started,
        version: info.version,
        user: info.user,
        schema: info.schema,
      };
    } catch (e) {
      return { success: false, elapsedMs: Date.now() - started, error: sanitizeError(e) };
    }
  },

  async listSchemas(cfg: ConnCfg): Promise<string[]> {
    return withConn(cfg, cfg.queryTimeoutSec * 1000, async (conn) => {
      const r = await conn.execute<{ NAME: string }>(
        'SELECT username AS NAME FROM all_users WHERE oracle_maintained = \'N\' ORDER BY username',
        {},
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );
      return (r.rows || []).map((x) => x.NAME);
    });
  },

  async listTables(cfg: ConnCfg, schema: string, keyword?: string): Promise<TableMeta[]> {
    return withConn(cfg, cfg.queryTimeoutSec * 1000, async (conn) => {
      let sql =
        "SELECT owner, table_name, comments FROM all_tab_comments WHERE owner = :schema AND table_type='TABLE'";
      const binds: Record<string, unknown> = { schema };
      if (keyword) {
        sql += ' AND table_name LIKE :kw';
        binds.kw = `%${keyword.toUpperCase()}%`;
      }
      sql += ' ORDER BY table_name';
      const r = await conn.execute<{ OWNER: string; TABLE_NAME: string; COMMENTS: string | null }>(
        sql,
        binds,
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );
      return (r.rows || []).map((x) => ({ name: x.TABLE_NAME, comment: x.COMMENTS || '', columns: [] }));
    });
  },

  async listColumns(cfg: ConnCfg, schema: string, table: string): Promise<ColumnMeta[]> {
    return withConn(cfg, cfg.queryTimeoutSec * 1000, async (conn) => {
      const r = await conn.execute<
        { COLUMN_NAME: string; DATA_TYPE: string; DATA_LENGTH: number; DATA_PRECISION: number; DATA_SCALE: number; NULLABLE: string; COMMENTS: string | null }
      >(
        `SELECT c.COLUMN_NAME, c.DATA_TYPE, c.DATA_LENGTH, c.DATA_PRECISION, c.DATA_SCALE, c.NULLABLE,
                cc.COMMENTS
         FROM all_tab_columns c
         LEFT JOIN all_col_comments cc
           ON cc.owner = c.owner AND cc.table_name = c.table_name AND cc.column_name = c.column_name
         WHERE c.owner = :schema AND c.table_name = :table
         ORDER BY c.COLUMN_ID`,
        { schema, table },
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );
      return (r.rows || []).map((x) => ({
        name: x.COLUMN_NAME,
        dataType: x.DATA_TYPE,
        length: Number(x.DATA_LENGTH || 0),
        precision: Number(x.DATA_PRECISION ?? 0),
        scale: Number(x.DATA_SCALE ?? 0),
        nullable: (x.NULLABLE || 'Y').toUpperCase() === 'Y',
        primaryKey: false,
        comment: x.COMMENTS || '',
      }));
    });
  },

  async getPrimaryKeys(cfg: ConnCfg, schema: string, table: string): Promise<string[]> {
    return withConn(cfg, cfg.queryTimeoutSec * 1000, async (conn) => {
      const r = await conn.execute<{ COLUMN_NAME: string }>(
        `SELECT cols.column_name
         FROM all_constraints cons, all_cons_columns cols
         WHERE cons.owner = :schema AND cons.table_name = :table
           AND cons.constraint_type = 'P'
           AND cols.owner = cons.owner AND cols.constraint_name = cons.constraint_name
         ORDER BY cols.position`,
        { schema, table },
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );
      return (r.rows || []).map((x) => x.COLUMN_NAME);
    });
  },

  async query(cfg: ConnCfg, sql: string, opts: QueryOptions): Promise<QueryResult> {
    const maxRows = opts.maxRows ?? 1000;
    const fetchSize = opts.fetchSize || 1000;
    const timeoutSec = opts.timeoutSec ?? cfg.queryTimeoutSec;
    return withConn(cfg, timeoutSec * 1000, async (conn) => {
      const result = await conn.execute<Record<string, unknown>>(sql, opts.binds || {}, {
        outFormat: oracledb.OUT_FORMAT_OBJECT,
        fetchArraySize: Math.min(fetchSize, 1000),
      });
      const meta = toColumns(result.metaData || []);
      const rows = (result.rows || []).slice(0, maxRows) as Record<string, unknown>[];
      let estimatedCount: number | undefined;
      if (!opts.noCount && !isEmptyQueryWrapped(sql)) {
        try {
          const cntSql = `SELECT COUNT(1) AS C FROM (${sql.replace(/;\s*$/, '')}) src`;
          const r = await conn.execute<{ C: number | string }>(cntSql, opts.binds || {}, {
            outFormat: oracledb.OUT_FORMAT_OBJECT,
            fetchArraySize: 1,
          });
          estimatedCount = Number(r.rows?.[0]?.C ?? 0);
        } catch {
          estimatedCount = undefined; // 大表计数失败时显示"未统计"
        }
      }
      return { metaData: meta, rows, estimatedCount, truncated: rows.length < (result.rows?.length ?? 0) || (opts.maxRows !== undefined && rows.length >= (opts.maxRows ?? 0)) };
    });
  },

  async *streamQuery(
    cfg: ConnCfg,
    sql: string,
    binds: Record<string, unknown>,
    opts: QueryOptions
  ): AsyncGenerator<Record<string, unknown>[]> {
    const fetchSize = opts.fetchSize || cfg.queryTimeoutSec * 0 + (opts.fetchSize || 1000);
    const batchSize = opts.maxRows ? Infinity : 2000;
    const deadline = Date.now() + (opts.timeoutSec ?? 0) * 1000;
    const pool = await getPool(cfg);
    const conn: any = await pool.getConnection();
    let batch: Record<string, unknown>[] = [];
    let count = 0;
    try {
      const stream = conn.queryStream(sql, binds, { outFormat: oracledb.OUT_FORMAT_OBJECT, fetchArraySize: fetchSize });
      for await (const row of stream) {
        if (Date.now() > deadline && opts.timeoutSec && opts.timeoutSec > 0) {
          throw new Error('查询超时');
        }
        batch.push(row);
        count++;
        if (batch.length >= batchSize) {
          yield batch;
          batch = [];
        }
        if (opts.maxRows && count >= opts.maxRows) {
          yield batch;
          batch = [];
          break;
        }
      }
      if (batch.length) yield batch;
    } finally {
      try {
        await conn.close();
      } catch {
        /* ignore */
      }
    }
  },

  async exec(cfg: ConnCfg, sql: string, binds?: Record<string, unknown>): Promise<{ rowsAffected: number }> {
    const pool = await getPool(cfg);
    const conn: any = await pool.getConnection();
    try {
      const r = await conn.execute(sql, binds || {}, {});
      try {
        await conn.commit();
      } catch {
        /* ignore */
      }
      return { rowsAffected: Number(r.rowsAffected || 0) };
    } finally {
      try {
        await conn.close();
      } catch {
        /* ignore */
      }
    }
  },

  async release(cfg: ConnCfg): Promise<void> {
    const k = poolKey(cfg);
    const tag = poolTag(k);
    const pool = POOLS.get(tag);
    if (pool) {
      try {
        await pool.close(0);
      } catch {
        /* ignore */
      }
      POOLS.delete(tag);
    }
  },
};