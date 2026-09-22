import type { ColumnMeta, DriverHealth, TableMeta } from '@/lib/sync/types';
import type { ConnCfg, Driver, QueryOptions, QueryResult } from '@/lib/server/sync/driver';
import { sanitizeError } from '@/lib/server/sync/tool';

/**
 * Paimon 数据源驱动（Apache Paimon on HDFS 湖仓）。
 *
 * 连接语义（type = 'paimon'，免用户名/密码）：
 *   host        NameNode / 网关地址（如 192.168.110.6）
 *   port        hdfs:// RPC 端口（如 8165），仅用于生成 hdfs:// 展示 URL
 *   dbName      仓库根路径（如 paimon → /paimon）
 *   connParams  附加参数（k=v&k2=v）：
 *     webhdfsPort=9870          WebHDFS REST 端口（NameNode http 端口；不填则探测 port/9870）
 *     httpFsPort=14000          HttpFS REST 端口（备选通道，路径同为 /webhdfs/v1）
 *     hdfsUser=hadoop           可选，追加 user.name 查询参数
 *     sqlGateway=http://..:8083 Flink SQL Gateway 地址；配置后支持 SQL 查询/数据集/同步
 *
 * 元数据（库/表/字段）走 WebHDFS/HttpFS REST：
 *   库   = <root>/<db>.db 目录
 *   表   = <root>/<db>.db/<table> 目录
 *   字段 = <root>/<db>.db/<table>/schema/schema-<n>（JSON，取序号最大的当前版本）
 *
 * SQL 查询通过 Flink SQL Gateway REST 执行（这是无需本地引擎读取 Paimon 的标准路径）；
 * 未配置 sqlGateway 时仅支持元数据浏览，查询会给出明确指引。
 */

interface WsEntry {
  pathSuffix: string;
  type: string;
  length?: number;
}

interface BaseConn {
  base: string;
  rootPath: string;
  hdfsUser: string;
}

const baseCache = new Map<string, { conn: BaseConn; at: number }>();
const BASE_TTL = 10 * 60_000;

/** 缓存 key：同一数据源改了主机/端口/参数要重新探测 */
function baseKey(cfg: ConnCfg): string {
  return `${cfg.host}:${cfg.port}/${(cfg.dbName || '').replace(/^\/+|\/+$/g, '')}?${cfg.connParams || ''}`;
}

function parseParams(connParams: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const seg of (connParams || '').split('&')) {
    const i = seg.indexOf('=');
    if (i > 0) out[seg.slice(0, i).trim()] = seg.slice(i + 1).trim();
  }
  return out;
}

function encPath(p: string): string {
  const parts = p.split('/').filter(Boolean).map(encodeURIComponent).join('/');
  return p.startsWith('/') ? '/' + parts : parts;
}

function rootPathOf(cfg: ConnCfg): string {
  const db = (cfg.dbName || '').replace(/^\/+|\/+$/g, '');
  return '/' + db;
}

async function fetchJson(url: string, timeoutMs: number, init?: RequestInit): Promise<{ status: number; json: any }> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), Math.max(1000, timeoutMs));
  try {
    const res = await fetch(url, {
      ...init,
      signal: ac.signal,
      cache: 'no-store',
      headers: { 'content-type': 'application/json', ...(init?.headers || {}) },
    });
    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { raw: text.slice(0, 500) };
    }
    return { status: res.status, json };
  } finally {
    clearTimeout(timer);
  }
}

/** 探测可用的 REST 通道（WebHDFS / HttpFS），返回 base URL */
async function probeBase(cfg: ConnCfg, timeoutMs: number): Promise<string> {
  const p = parseParams(cfg.connParams);
  const root = rootPathOf(cfg);
  const qs = p.hdfsUser ? `&user.name=${encodeURIComponent(p.hdfsUser)}` : '';
  const candidates: string[] = [];
  if (p.webhdfsPort) candidates.push(`http://${cfg.host}:${p.webhdfsPort}/webhdfs/v1`);
  if (p.httpFsPort) candidates.push(`http://${cfg.host}:${p.httpFsPort}/webhdfs/v1`);
  if (p.webhdfs === '1' || /webhdfs/i.test(cfg.connParams)) candidates.unshift(`http://${cfg.host}:${cfg.port}/webhdfs/v1`);
  candidates.push(`http://${cfg.host}:${cfg.port}/webhdfs/v1`);
  if (!p.webhdfsPort) candidates.push(`http://${cfg.host}:9870/webhdfs/v1`);
  if (!p.httpFsPort) candidates.push(`http://${cfg.host}:14000/webhdfs/v1`);

  const errors: string[] = [];
  for (const base of [...new Set(candidates)]) {
    try {
      const { status, json } = await fetchJson(`${base}${encPath(root)}?op=GETFILESTATUS${qs}`, Math.min(timeoutMs, 5000));
      // 200=存在；404 但返回 JSON 也说明该端口是 WebHDFS/HttpFS 服务
      if (json && (status === 200 || status === 404)) return base;
      errors.push(`${base} → HTTP ${status}`);
    } catch (e) {
      errors.push(`${base} → ${sanitizeError(e)}`);
    }
  }
  throw new Error(
    `无法通过 WebHDFS/HttpFS 访问 HDFS（ tried ${candidates.length} 个候选端口）。` +
      `请确认 NameNode HTTP 端口，并在「连接参数」中指定，例如 webhdfsPort=9870 或 httpFsPort=14000。详情：${errors.join('；')}`
  );
}

async function getBase(cfg: ConnCfg, timeoutMs = 8000): Promise<BaseConn> {
  const cached = baseCache.get(baseKey(cfg));
  if (cached && Date.now() - cached.at < BASE_TTL) return cached.conn;
  const base = await probeBase(cfg, timeoutMs);
  const conn: BaseConn = { base, rootPath: rootPathOf(cfg), hdfsUser: parseParams(cfg.connParams).hdfsUser || '' };
  baseCache.set(baseKey(cfg), { conn, at: Date.now() });
  return conn;
}

function qsOf(conn: BaseConn, op: string): string {
  return `?op=${op}${conn.hdfsUser ? `&user.name=${encodeURIComponent(conn.hdfsUser)}` : ''}`;
}

async function wsListStatus(conn: BaseConn, path: string, timeoutMs: number): Promise<WsEntry[]> {
  const { status, json } = await fetchJson(`${conn.base}${encPath(path)}${qsOf(conn, 'LISTSTATUS')}`, timeoutMs);
  if (status !== 200) throw new Error(`LISTSTATUS ${path} 失败：HTTP ${status} ${json?.RemoteException?.message || json?.raw || ''}`);
  const list = json?.FileStatuses?.FileStatus;
  if (!Array.isArray(list)) throw new Error(`LISTSTATUS ${path} 返回格式异常`);
  return list as WsEntry[];
}

async function wsReadText(conn: BaseConn, path: string, timeoutMs: number): Promise<string> {
  const res = await fetch(`${conn.base}${encPath(path)}${qsOf(conn, 'OPEN')}`, {
    cache: 'no-store',
    signal: AbortSignal.timeout(Math.max(1000, timeoutMs)),
  });
  if (res.status !== 200) throw new Error(`读取 ${path} 失败：HTTP ${res.status}`);
  return res.text();
}

function isDir(e: WsEntry): boolean {
  return e.type === 'DIRECTORY' && !e.pathSuffix.startsWith('.') && !e.pathSuffix.startsWith('_');
}

// ---- Flink SQL Gateway ----

interface GatewayResult {
  metaData: Array<{ name: string; jdbcType: string }>;
  rows: Record<string, unknown>[];
}

function gatewayBase(cfg: ConnCfg): string {
  const gw = parseParams(cfg.connParams).sqlGateway;
  if (!gw) return '';
  return gw.replace(/\/+$/, '');
}

async function gwFetch(url: string, timeoutMs: number, init?: RequestInit): Promise<any> {
  const { status, json } = await fetchJson(url, timeoutMs, init);
  if (status >= 400) throw new Error(`Flink SQL Gateway 请求失败：HTTP ${status} ${json?.raw || JSON.stringify(json).slice(0, 300)}`);
  return json;
}

/** 通过 Flink SQL Gateway 执行查询（轮询到 FINISHED 并翻页取完结果） */
async function gatewayQuery(cfg: ConnCfg, sql: string, deadlineMs: number): Promise<GatewayResult> {
  const gw = gatewayBase(cfg);
  if (!gw) throw new Error('PAIMON_NO_GATEWAY');
  const open = await gwFetch(`${gw}/v1/statements`, cfg.queryTimeoutSec * 1000, {
    method: 'POST',
    body: JSON.stringify({ statement: sql }),
  });
  const handle = open?.operationHandle;
  if (!handle) throw new Error(`Flink SQL Gateway 未返回 operationHandle：${JSON.stringify(open).slice(0, 300)}`);

  // 轮询状态
  for (;;) {
    const st = await gwFetch(`${gw}/v1/statements/${encodeURIComponent(handle)}/status`, 8000).catch(() => null);
    const s = st?.status;
    if (s === 'FINISHED') break;
    if (s === 'ERROR' || s === 'CANCELED') throw new Error(`Flink 作业 ${s}`);
    if (Date.now() > deadlineMs) throw new Error('查询超时（Flink SQL Gateway）');
    await new Promise((r) => setTimeout(r, 600));
  }

  // 翻页取结果
  const metaData: Array<{ name: string; jdbcType: string }> = [];
  const rows: Record<string, unknown>[] = [];
  let uri = `${gw}/v1/statements/${encodeURIComponent(handle)}/result/0`;
  for (;;) {
    const j = await gwFetch(uri, 15000);
    const rs = Array.isArray(j?.results) ? j.results : j?.results ? [j.results] : [];
    let eoi = false;
    for (const r of rs) {
      if (r?.resultKind === 'EOI') {
        eoi = true;
        continue;
      }
      const payload = r?.results || r;
      const cols = payload?.resultSchema?.columns || [];
      if (cols.length && metaData.length === 0) {
        for (const c of cols) metaData.push({ name: String(c.name), jdbcType: String(c.dataType || c.type || 'UNKNOWN') });
      }
      const data = payload?.data || [];
      for (const d of data) {
        const fields: unknown[] = d?.fields ?? [];
        const row: Record<string, unknown> = {};
        cols.forEach((c: any, i: number) => {
          row[String(c.name)] = fields[i];
        });
        rows.push(row);
      }
    }
    if (eoi && !j?.nextResultUri) break;
    if (j?.nextResultUri) uri = j.nextResultUri;
    else {
      // 旧版无 nextResultUri：按页号递增，取到空页即止
      const m = uri.match(/\/result\/(\d+)$/);
      if (!m) break;
      const next = Number(m[1]) + 1;
      uri = uri.replace(/\/result\/\d+$/, `/result/${next}`);
      const peek = await gwFetch(uri, 15000).catch(() => null);
      if (!peek || (!peek.results && !Array.isArray(peek.results))) break;
      // 把已取的下一页内容并入（简化：递归消费剩余页）
      const rest = await consumeRemaining(gw, handle, next, cfg, deadlineMs);
      rows.push(...rest.rows);
      if (!metaData.length && rest.metaData.length) metaData.push(...rest.metaData);
      break;
    }
    if (Date.now() > deadlineMs) throw new Error('查询超时（Flink SQL Gateway 拉取结果）');
  }
  return { metaData, rows };
}

async function consumeRemaining(
  gw: string,
  handle: string,
  startPage: number,
  cfg: ConnCfg,
  deadlineMs: number
): Promise<GatewayResult> {
  const metaData: Array<{ name: string; jdbcType: string }> = [];
  const rows: Record<string, unknown>[] = [];
  let page = startPage;
  for (;;) {
    const j = await gwFetch(`${gw}/v1/statements/${encodeURIComponent(handle)}/result/${page}`, 15000).catch(() => null);
    if (!j) break;
    const rs = Array.isArray(j?.results) ? j.results : j?.results ? [j.results] : [];
    let got = false;
    for (const r of rs) {
      if (r?.resultKind === 'EOI') continue;
      const payload = r?.results || r;
      const cols = payload?.resultSchema?.columns || [];
      if (cols.length && !metaData.length) for (const c of cols) metaData.push({ name: String(c.name), jdbcType: String(c.dataType || 'UNKNOWN') });
      for (const d of payload?.data || []) {
        const fields: unknown[] = d?.fields ?? [];
        const row: Record<string, unknown> = {};
        cols.forEach((c: any, i: number) => (row[String(c.name)] = fields[i]));
        rows.push(row);
        got = true;
      }
    }
    if (!got) break;
    page++;
    if (Date.now() > deadlineMs) throw new Error('查询超时（Flink SQL Gateway 拉取结果）');
  }
  return { metaData, rows };
}

/** 解析整表查询：SELECT * FROM [db.]table [FETCH FIRST n ROWS ONLY | LIMIT n] */
function parseSelectAll(sql: string): { db: string; table: string; limit: number } | null {
  const s = sql.replace(/;\s*$/, '').replace(/\s+/g, ' ').trim();
  let m = s.match(/^select\s+\*\s+from\s+(?:"?([\w$]+)"?\.)?"?([\w$]+)"?\s+fetch\s+first\s+(\d+)\s+rows\s+only$/i);
  if (!m) m = s.match(/^select\s+\*\s+from\s+(?:"?([\w$]+)"?\.)?"?([\w$]+)"?\s+limit\s+(\d+)$/i);
  if (!m) m = s.match(/^select\s+\*\s+from\s+(?:"?([\w$]+)"?\.)?"?([\w$]+)"?$/i);
  if (!m) return null;
  return { db: m[1] || '', table: m[2], limit: m[3] ? Number(m[3]) : 0 };
}

function flinkQual(db: string, table: string): string {
  return db ? `\`${db}\`.\`${table}\`` : `\`${table}\``;
}

/** 解析 Paimon 字段类型串（如 "INT NOT NULL"、"VARCHAR(2147483647)"、"DECIMAL(10, 2)"） */
function parseFieldType(raw: string): { dataType: string; length: number; precision: number; scale: number; nullable: boolean } {
  const t = (raw || 'STRING').trim();
  const nullable = !/NOT\s+NULL/i.test(t);
  const dataType = t.replace(/\s+NOT\s+NULL/i, '').trim();
  let length = 0;
  let precision = 0;
  let scale = 0;
  let m = dataType.match(/\((\d+)\)/);
  if (m) {
    length = Number(m[1]);
    precision = Number(m[1]);
  }
  m = dataType.match(/\((\d+)\s*,\s*(\d+)\)/);
  if (m) {
    precision = Number(m[1]);
    scale = Number(m[2]);
  }
  return { dataType, length, precision, scale, nullable };
}

export const paimonDriver: Driver = {
  type: 'paimon',

  async test(cfg: ConnCfg, timeoutMs: number): Promise<DriverHealth> {
    const started = Date.now();
    try {
      const conn = await getBase(cfg, timeoutMs);
      // 仓库根目录必须可列出
      await wsListStatus(conn, conn.rootPath, timeoutMs);
      const gw = gatewayBase(cfg);
      return {
        success: true,
        elapsedMs: Date.now() - started,
        version: `Paimon warehouse ${conn.rootPath}（REST: ${conn.base}）`,
        user: 'anonymous',
        schema: conn.rootPath,
        mode: gw ? 'thick' : 'thin',
      };
    } catch (e) {
      return { success: false, elapsedMs: Date.now() - started, error: sanitizeError(e) };
    }
  },

  async listSchemas(cfg: ConnCfg): Promise<string[]> {
    const conn = await getBase(cfg);
    const entries = await wsListStatus(conn, conn.rootPath, cfg.queryTimeoutSec * 1000);
    return entries.filter((e) => isDir(e) && e.pathSuffix.endsWith('.db')).map((e) => e.pathSuffix.slice(0, -3));
  },

  async listTables(cfg: ConnCfg, schema: string, keyword?: string): Promise<TableMeta[]> {
    const conn = await getBase(cfg);
    const dir = `${conn.rootPath}/${schema}.db`;
    const entries = await wsListStatus(conn, dir, cfg.queryTimeoutSec * 1000);
    return entries
      .filter(isDir)
      .filter((e) => !keyword || e.pathSuffix.toLowerCase().includes(keyword.toLowerCase()))
      .map((e) => ({ name: e.pathSuffix, comment: '', columns: [] }))
      .sort((a, b) => a.name.localeCompare(b.name));
  },

  async listColumns(cfg: ConnCfg, schema: string, table: string): Promise<ColumnMeta[]> {
    const conn = await getBase(cfg);
    const schemaDir = `${conn.rootPath}/${schema}.db/${table}/schema`;
    const entries = await wsListStatus(conn, schemaDir, cfg.queryTimeoutSec * 1000);
    const versions = entries
      .map((e) => e.pathSuffix.match(/^schema-(\d+)$/))
      .filter(Boolean)
      .map((m) => Number(m![1]));
    if (!versions.length) throw new Error(`${schemaDir} 下没有 schema-N 文件（可能不是 Paimon 表目录）`);
    const latest = `schema-${Math.max(...versions)}`;
    const text = await wsReadText(conn, `${schemaDir}/${latest}`, cfg.queryTimeoutSec * 1000);
    const doc = JSON.parse(text);
    const pkSet: Set<string> = new Set(doc.primaryKeys || []);
    return (doc.fields || []).map((f: any) => {
      const t = parseFieldType(String(f.type || 'STRING'));
      return {
        name: String(f.name),
        dataType: t.dataType,
        length: t.length,
        precision: t.precision,
        scale: t.scale,
        nullable: t.nullable,
        primaryKey: pkSet.has(String(f.name)),
        comment: String(f.comment || ''),
      };
    });
  },

  async query(cfg: ConnCfg, sql: string, opts: QueryOptions): Promise<QueryResult> {
    const maxRows = opts.maxRows ?? 1000;
    const deadline = Date.now() + (opts.timeoutSec ?? cfg.queryTimeoutSec) * 1000;
    let metaData: Array<{ name: string; jdbcType: string }>;
    let rows: Record<string, unknown>[];

    if (gatewayBase(cfg)) {
      const r = await gatewayQuery(cfg, sql, deadline);
      metaData = r.metaData;
      rows = r.rows;
    } else {
      const parsed = parseSelectAll(sql);
      if (!parsed) {
        throw new Error(
          'Paimon 数据源未配置查询引擎，仅支持「SELECT * FROM [库.]表 [LIMIT n]」的整表查询；' +
            '复杂 SQL 请在连接参数中配置 Flink SQL Gateway：sqlGateway=http://主机:8083'
        );
      }
      const db = parsed.db || (await this.listSchemas(cfg))[0] || '';
      if (!db) throw new Error(`仓库 /${(cfg.dbName || '').replace(/^\/+|\/+$/g, '')} 下没有任何库（*.db 目录）`);
      // 校验表存在（读取 schema 元信息）
      await this.listColumns(cfg, db, parsed.table);
      throw new Error(
        `表 ${db}.${parsed.table} 数据文件无法在无引擎环境下直接解析。` +
          '请在连接参数中配置 Flink SQL Gateway（sqlGateway=http://主机:8083）后重试，' +
          '或改用「数据集」+ 同步任务从上游写入 Paimon。'
      );
    }

    const sliced = rows.slice(0, maxRows);
    return {
      metaData: metaData.map((m) => ({ name: m.name, jdbcType: m.jdbcType, precision: 0, nullable: true })),
      rows: sliced,
      estimatedCount: opts.noCount ? undefined : rows.length,
      truncated: rows.length > sliced.length,
    };
  },

  async *streamQuery(
    cfg: ConnCfg,
    sql: string,
    _binds: Record<string, unknown>,
    opts: QueryOptions
  ): AsyncGenerator<Record<string, unknown>[]> {
    const fetchSize = opts.fetchSize || 1000;
    const deadline = Date.now() + (opts.timeoutSec ?? cfg.queryTimeoutSec) * 1000;
    if (!gatewayBase(cfg)) {
      // 仅整表查询可在无网关下工作，但数据文件解析仍需引擎——统一给出明确指引
      throw new Error(
        'Paimon 同步读取需要 Flink SQL Gateway：请在数据源「连接参数」中配置 sqlGateway=http://主机:8083'
      );
    }
    const r = await gatewayQuery(cfg, sql, deadline);
    for (let i = 0; i < r.rows.length; i += fetchSize) {
      yield r.rows.slice(i, i + fetchSize);
    }
  },

  async exec(cfg: ConnCfg, sql: string): Promise<{ rowsAffected: number }> {
    if (!gatewayBase(cfg)) throw new Error('Paimon 执行写语句需要 Flink SQL Gateway（连接参数 sqlGateway=...）');
    const deadline = Date.now() + cfg.queryTimeoutSec * 1000;
    await gatewayQuery(cfg, sql, deadline);
    return { rowsAffected: 0 };
  },

  async release(cfg: ConnCfg): Promise<void> {
    baseCache.delete(baseKey(cfg));
    baseCache.delete(cfg.id); // 兼容旧 key
  },
};
