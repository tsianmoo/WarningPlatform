// ============ 数据同步模块 领域类型 ============
// 自包含模块，不侵入预警规则引擎。持久化走独立 JSONB 表。

export type DbType = 'oracle' | 'mysql' | 'postgresql' | 'sqlserver' | 'starrocks';

export const DB_TYPE_LABEL: Record<DbType, string> = {
  oracle: 'Oracle',
  mysql: 'MySQL',
  postgresql: 'PostgreSQL',
  sqlserver: 'SQL Server',
  starrocks: 'StarRocks',
};

export type DataSourceHealth = 'normal' | 'abnormal' | 'unknown';

/** 数据源连接配置 */
export interface DataSource {
  id: string;
  /** 连接名称（编码，唯一） */
  key: string;
  type: DbType;
  label: string;
  host: string;
  port: number;
  /** database / SID / service name */
  dbName: string;
  user: string;
  /** 加密后的密码（服务端可解密） */
  passwordEnc: string;
  /** 表单输入的明文密码（仅用于编辑器/新建；服务端加密为 passwordEnc 后入库） */
  password?: string;
  encoding: 'UTF-8' | 'GBK';
  /** 附加连接参数（k=v&k2=v） */
  connParams: string;
  /** 生成的 JDBC URL（只读展示） */
  jdbcUrl: string;
  maxActive: number;
  minIdle: number;
  maxWaitMs: number;
  queryTimeoutSec: number;
  group: string;
  desc: string;
  consecutiveFailures: number;
  lastAvailableAt?: number;
  health: DataSourceHealth;
  /** 授权用户 / 角色 */
  authUsers: string[];
  authRoles: string[];
  createdAt: number;
  updatedAt: number;
  updatedBy: string;
}

export interface ColumnMeta {
  name: string;
  dataType: string;
  length: number;
  precision: number;
  scale: number;
  nullable: boolean;
  primaryKey: boolean;
  comment: string;
}

export interface TableMeta {
  name: string;
  comment: string;
  columns: ColumnMeta[];
}

/** 元数据缓存（库/Schema → 表/视图 → 字段） */
export interface MetadataCache {
  /** 顶层对象：Schema（Oracle/PG）或数据库（MySQL） */
  schemas: Array<{ name: string; tables: TableMeta[] }>;
  cachedAt: number;
}

export type DatasetSourceMode = 'sql';
export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

export interface DatasetField {
  name: string;
  jdbcType: string;
  precision: number;
  nullable: boolean;
}

/** 数据集（SQL 模式） */
export interface SyncDataset {
  id: string;
  key: string;
  name: string;
  datasourceId: string;
  sql: string;
  /** 参数占位符（${name}） */
  params: string[];
  /** 预览解析出的字段 */
  fields: DatasetField[];
  previewLimit: number;
  queryTimeoutSec: number;
  desc: string;
  group: string;
  createdAt: number;
  updatedAt: number;
  updatedBy: string;
}

export type WriteStrategy = 'APPEND' | 'OVERWRITE' | 'UPSERT' | 'INSERT_IGNORE' | 'TEMP_SWAP';
export const WRITE_STRATEGY_LABEL: Record<WriteStrategy, string> = {
  APPEND: '追加写(APPEND)',
  OVERWRITE: '全量覆盖(OVERWRITE)',
  UPSERT: '增量合并(UPSERT)',
  INSERT_IGNORE: '主键忽略(INSERT_IGNORE)',
  TEMP_SWAP: '临时表原子替换(TEMP_SWAP)',
};

export type IncrementalMode = 'timestamp' | 'autoincrement' | 'fullcompare' | 'none';
export const INCREMENTAL_MODE_LABEL: Record<IncrementalMode, string> = {
  timestamp: '时间戳增量',
  autoincrement: '自增ID增量',
  fullcompare: '全量+主键比对',
  none: '全量（无增量）',
};

export type TaskStatus = 'draft' | 'active' | 'paused';

/** 字段映射项 */
export interface FieldMapping {
  src: string; // 源字段名
  tgt: string; // 目标字段名
  ignore: boolean; // 忽略该字段
  /** 常量 / 系统字段（_sync_time/_sync_batch_id/_source_table/_op） */
  constValue?: string;
  isSystem?: boolean;
}

/** 同步任务 */
export interface SyncTask {
  id: string;
  key: string;
  name: string;
  group: string;
  owner: string;
  desc: string;
  enabled: boolean;
  tags: string;
  // 源
  datasetId: string;
  /** 参数值集合 */
  paramValues: Record<string, string>;
  // 目标（目标为普通数据源）
  targetDatasourceId: string;
  targetSchema: string;
  targetTable: string;
  writeStrategy: WriteStrategy;
  overwriteMode?: 'truncate' | 'delete';
  /** 业务主键（UPSERT / INSERT_IGNORE / 增量比对用） */
  bizKeys: string[];
  /** 字段映射（改名/忽略/常量/系统字段） */
  fieldMappings: FieldMapping[];
  // 增量
  incrementalMode: IncrementalMode;
  incrementalField?: string;
  /** 水位线（服务端维护） */
  watermark?: number | string;
  /** 安全窗口（秒，时间戳增量回退量） */
  safetyWindowSec: number;
  windowClosed?: boolean; // 开区间(false)=严格大于；闭区间(true)=大于等于
  firstRunBehavior: 'full' | 'incremental';
  // 调度
  cron: string;
  timezone: string;
  /** 间隔调度（秒）；与 cron / 一次性互斥，设置后按 interval 跑 */
  intervalSec?: number;
  /** 一次性调度：过期时间戳 */
  expireAt?: number;
  misfire: 'run_now' | 'ignore' | 'next';
  allowParallel: boolean;
  /** 最近一次运行状态（调度器维护） */
  lastStatus?: { status: string; lastRun: string; lastError?: string; lastWriteRows?: number };
  /** 运行中标记（进程内防重入快照） */
  running?: boolean;
  // 执行
  fetchSize: number;
  batchSize: number;
  maxActiveIns?: number;
  rateLimitPerSec?: number; // rows/s
  taskTimeoutSec: number;
  retryTimes: number;
  retryBackoffSec: number;
  autoCreateTable: boolean;
  autoAddColumn: boolean;
  onBatchError: 'continue' | 'abort';
  badRowThreshold: number;
  typeTrim: boolean;
  lengthOverflow: 'truncate' | 'error';
  encodingFrom: 'UTF-8' | 'GBK';
  // 质量校验
  qualityChecks: QualityCheck[];
  qualityOnFail: 'alert' | 'block';
  // 告警
  alertChannels: string[];
  /** 告警触发规则与模板 */
  alert?: {
    onFailure?: boolean;
    onRetryFail?: boolean;
    onTimeout?: boolean;
    onRowAnomaly?: boolean;
    rowAnomalyPct?: number;
    rowAnomalyAbsMin?: number;
    rowAnomalyAbsMax?: number;
    dataQualityFail?: boolean;
    datasourceDown?: boolean;
    heartbeatMissingMins?: number;
    suppressMinutes?: number;
    muteUntil?: string;
    dashboardUrl?: string;
    templates?: Record<string, { title: string; body: string }>;
  };
  // 依赖
  dependsOn: string[];
  mutexGroup: string;
  createdAt: number;
  updatedAt: number;
  updatedBy: string;
}

export type InstanceStatus = 'waiting' | 'running' | 'success' | 'failed' | 'cancelled' | 'timeout';
export type TriggerType = 'auto' | 'manual' | 'backfill' | 'retry';

export interface StageTiming {
  connect: number;
  read: number;
  transform: number;
  write: number;
  commit: number;
}

/** 运行实例 */
export interface SyncInstance {
  id: string;
  taskId: string;
  taskName: string;
  trigger: TriggerType;
  status: InstanceStatus;
  startAt: number;
  endAt?: number;
  readRows: number;
  writeRows: number;
  updateRows: number;
  failedRows: number;
  throughput: number; // rows/s
  triggeredBy: string;
  retryOf?: string;
  retryTimes: number;
  params: Record<string, string>;
  watermarkAfter?: number | string;
  watermarkBefore?: number | string;
  sql: string; // 参数已替换
  error?: string;
  stage: StageTiming;
  log: SyncLogLine[];
  dirtySample: DirtyRow[];
  qualityResults: QualityResult[];
  progress: number; // 0-100
  allowParallel: boolean;
}

export interface SyncLogLine {
  level: LogLevel;
  msg: string;
  at: number;
}

export interface DirtyRow {
  row: Record<string, unknown>;
  error: string;
  at: number;
}

export type QualityType =
  | 'row_count'
  | 'key_unique'
  | 'null_rate'
  | 'interval'
  | 'reconcile_sum'
  | 'custom_sql'
  | 'sample_compare';

export interface QualityCheck {
  id: string;
  type: QualityType;
  field?: string;
  label: string;
  /** interval 上下限 / reconcile 误差率 */
  min?: number;
  max?: number;
  toleranceRate?: number;
  customSql?: string;
  enabled: boolean;
}

export interface QualityResult {
  checkId: string;
  label: string;
  pass: boolean;
  detail: string;
}

export type ChannelType = 'smtp' | 'wecom' | 'dingtalk' | 'feishu' | 'webhook';

export interface AlertChannel {
  id: string;
  key: string;
  name: string;
  type: ChannelType;
  enabled: boolean;
  /** SMTP: host|port|user|pass|from ; webhook/robot: url(webhook) ; 签名 */
  host?: string;
  port?: number;
  user?: string;
  passwordEnc?: string;
  from?: string;
  to?: string; // 收件人（逗号分隔）
  tls?: boolean; // SMTP 是否使用 STARTTLS / TLS
  webhookUrl?: string;
  secret?: string; // 签名密钥
  templateTitle?: string;
  templateBody?: string;
  group: string;
  createdAt: number;
  updatedAt: number;
}

/** 审计日志 */
export interface AuditEntry {
  id: string;
  at: number;
  who: string;
  action: string; // create/update/delete/test/run/stop
  targetType: string; // datasource/dataset/task/channel
  targetId: string;
  targetName: string;
  diff?: string; // 变更前后 diff（JSON）
}

export interface DriverHealth {
  success: boolean;
  elapsedMs: number;
  version?: string;
  user?: string;
  schema?: string;
  mode?: 'thin' | 'thick';
  error?: string;
}

/** 告警事件负载（模板变量 ${task} ${instance} ${error} …） */
export interface AlertEvent {
  taskId: string;
  taskName?: string;
  instanceId?: string;
  type: string; // failure / retry_failed / timeout / recover / row_anomaly / data_quality / datasource_down
  severity?: string;
  status?: string;
  error?: string;
  duration?: number;
  rows?: number;
  dashboardUrl?: string;
}