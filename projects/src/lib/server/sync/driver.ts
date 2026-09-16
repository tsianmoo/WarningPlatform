import type { ColumnMeta, DbType, DriverHealth, TableMeta } from '@/lib/sync/types';
import type { DataSource } from '@/lib/sync/types';
import { decSecret } from '@/lib/server/sync/tool';

/** 从数据源解析出的连接配置（密码已解密） */
export interface ConnCfg {
  id: string;
  type: DbType;
  host: string;
  port: number;
  dbName: string;
  user: string;
  password: string;
  encoding: 'UTF-8' | 'GBK';
  connParams: string;
  maxActive: number;
  minIdle: number;
  maxWaitMs: number;
  queryTimeoutSec: number;
}

export function toConnCfg(ds: DataSource): ConnCfg {
  return {
    id: ds.id,
    type: ds.type,
    host: ds.host,
    port: ds.port,
    dbName: ds.dbName,
    user: ds.user,
    password: decSecret(ds.passwordEnc),
    encoding: ds.encoding,
    connParams: ds.connParams,
    maxActive: ds.maxActive || 10,
    minIdle: ds.minIdle || 2,
    maxWaitMs: ds.maxWaitMs || 10000,
    queryTimeoutSec: ds.queryTimeoutSec || 30,
  };
}

/** 查询选项 */
export interface QueryOptions {
  /** 单批读取行数（流式 / 分页） */
  fetchSize: number;
  /** SQL 注入参数（绑定变量，对象形式） */
  binds?: Record<string, unknown>;
  /** 返回行数上限（预览用，null 表示不限） */
  maxRows?: number;
  /** 查询超时秒 */
  timeoutSec?: number;
  /** 跳过 COUNT 统计（表/明细预览用，避免大表计数） */
  noCount?: boolean;
}

export interface QueryResult {
  /** 字段元信息 */
  metaData: Array<{ name: string; jdbcType: string; precision: number; nullable: boolean }>;
  rows: Record<string, unknown>[];
  /** 估算总行数（COUNT(1)，可能为 undefined） */
  estimatedCount?: number;
  truncated: boolean;
}

/** 数据库驱动抽象。每个厂商实现一套；当前首批落地 Oracle，其余留待后续。 */
export interface Driver {
  readonly type: DbType;
  /** 测试连接（独立超时） */
  test(cfg: ConnCfg, timeoutMs: number): Promise<DriverHealth>;
  /** 列出 Schema / 数据库 */
  listSchemas(cfg: ConnCfg): Promise<string[]>;
  /** 列出某 schema 下的表/视图 */
  listTables(cfg: ConnCfg, schema: string, keyword?: string): Promise<TableMeta[]>;
  /** 列出某表字段 */
  listColumns(cfg: ConnCfg, schema: string, table: string): Promise<ColumnMeta[]>;
  /** 执行查询，返回字段 + 行 + 估算总数（带行数上限） */
  query(cfg: ConnCfg, sql: string, opts: QueryOptions): Promise<QueryResult>;
  /** 流式逐批读取（严格流式，禁止一次性读入内存） */
  streamQuery(
    cfg: ConnCfg,
    sql: string,
    binds: Record<string, unknown>,
    opts: QueryOptions
  ): AsyncGenerator<Record<string, unknown>[]>;
  /** 执行写语句（INSERT/UPDATE/DELETE/DDL） */
  exec(cfg: ConnCfg, sql: string, binds?: Record<string, unknown>): Promise<{ rowsAffected: number }>;
  /** 读取业务主键列（全量+主键比对 / UPSERT 目标主键校验用） */
  getPrimaryKeys?(cfg: ConnCfg, schema: string, table: string): Promise<string[]>;
  /** 释放数据源连接池（删除数据源/停用任务时调用） */
  release(cfg: ConnCfg): Promise<void>;
}

let oracleDriverPromise: Promise<Driver> | null = null;
async function getOracle(): Promise<Driver> {
  if (!oracleDriverPromise) oracleDriverPromise = import('@/lib/server/sync/oracle').then((m) => m.oracleDriver);
  return oracleDriverPromise;
}

/** 驱动的编码集支持集（用于界面展示能力） */
export const DRIVER_SUPPORTED: Record<DbType, boolean> = {
  oracle: true,
  mysql: false,
  postgresql: false,
  sqlserver: false,
  starrocks: false,
};

/** 按类型取驱动实例（未实现的类型抛异常） */
export async function getDriver(type: DbType): Promise<Driver> {
  if (type === 'oracle') return getOracle();
  throw new Error(`驱动「${type}」尚未接入，当前仅支持 Oracle（其他类型接入中）`);
}

export async function getDriverUnsafe(type: DbType): Promise<Driver | null> {
  try {
    return await getDriver(type);
  } catch {
    return null;
  }
}