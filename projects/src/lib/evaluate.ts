import type {
  DataTable,
  TableField,
  FlowEdge,
  FlowNode,
  NodeKind,
  ConditionNodeData,
  BaseNodeData,
  LookupNodeData,
  GroupByNodeData,
  BaselineNodeData,
  FillJoinNodeData,
  FieldNodeData,
  TimeNodeData,
  TopNNodeData,
  DiffNodeData,
  DateGranularity,
  FilterCondition,
  FilterNodeData,
  ElapsedNodeData,
  ComputeNodeData,
  ComputeExpr,
  ExprToken,
  RankNodeData,
} from './types';
import { resolveTimeWindow, resolveElapsedDays } from './time';
import type { TimeWindow } from './types';
import { TAG_COLORS } from './parser';
import { OPERATOR_OPTIONS } from './types';
import type { ActionNodeData } from './types';

/** ReactFlow 节点（type 字段）与内部 FlowNode（kind 字段）都可能传入，统一归一化为内部节点 */
type AnyNodeLike = { id: string; type?: string; kind?: NodeKind; data?: Record<string, unknown>; position?: { x: number; y: number } };

function normalizeNode(raw: AnyNodeLike): FlowNode {
  const kind = (raw.kind ?? (raw.type as NodeKind)) || 'trigger';
  return {
    id: raw.id,
    kind,
    position: raw.position ?? { x: 0, y: 0 },
    data: (raw.data ?? {}) as FlowNode['data'],
  };
}

type AnyEdgeLike = { id?: string; source: string; target: string; label?: string };

function normalizeEdge(raw: AnyEdgeLike, idx: number): FlowEdge {
  return { id: raw.id ?? `e-${idx}`, source: raw.source, target: raw.target };
}

/** 将任意值转为毫秒时间戳（Date / 字符串 / 数字） */
function tsNum(v: unknown): number {
  if (v == null) return Number.NaN;
  if (v instanceof Date) return v.getTime();
  const d = new Date(v as string | number);
  return Number.isNaN(d.getTime()) ? Number.NaN : d.getTime();
}

/** 判断行内日期值是否落在对比窗口（含截止日整天）内 */
function inRangeCmp(v: unknown, c?: { start: Date; end: Date }): boolean {
  if (!c) return false;
  const n = tsNum(v);
  return Number.isFinite(n) && n >= c.start.getTime() && n <= c.end.getTime() + 86399999;
}

/** 单个节点的预览结果 */
export interface NodePreview {
  /** 结果标题 */
  title: string;
  /** 表格列 */
  columns: string[];
  /** 表格行 */
  rows: Record<string, string | number>[];
  /** 标量结果（如基准值）；kind=column 表示可作为下游逐行对比的列，kind=table 表示整张表透传 */
  scalar?: { label?: string; value?: string; kind?: 'scalar' | 'column' | 'table'; col?: string };
  /** 说明/提示 */
  note?: string;
  /** 诊断信息（说明为何为 0/为空等） */
  diag?: string;
  /** 配置不完整或暂不支持逐行预览 */
  unsupported?: boolean;
  /** 该结果可用的全部列名（含未在 columns 展示的列），供下游节点选择 */
  allCols?: string[];
  /** 结果形态：scalar=单值（其 rows 只是"统计项/数值"展示），table=逐行明细表 */
  shape?: 'scalar' | 'table';
  /** 预警动作：将通知消息模板对每个命中行渲染后的实际消息（用于预览通知内容） */
  alertMessages?: { title: string; content: string }[];
}

type OutputMap = Record<string, NodePreview>;

const PREVIEW_LIMIT = 20000;

/** 全量行（用于聚合/统计计算）；无全量数据时回退到预览样本行 */
function allRows(t?: DataTable): Record<string, string | number | boolean>[] {
  if (!t) return [];
  if (t.rows && t.rows.length) return t.rows;
  return t.previewRows as unknown as Record<string, string | number | boolean>[];
}

/** 宽松数字解析：去千分位逗号、货币符号、空格、百分号等 */
function toNum(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
  if (v == null || v === '') return NaN;
  const s = String(v)
    .replace(/[,，¥￥$€\s%]/g, '')
    .replace(/[一二三四五六七八九十百千万亿]+元/g, '');
  if (s === '') return NaN;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : NaN;
}

function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return '—';
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}



/** 计算某时间窗迄今已过去的天数（含今天，拉齐到自然日）。now 未到 start 返回0；已过 end 则取窗口内已过去天数 */
function calcElapsedDays(twr: { start: Date; end: Date } | undefined, now = new Date()): number {
  if (!twr) return 0;
  const day = 86400000;
  const startDay = new Date(twr.start.getFullYear(), twr.start.getMonth(), twr.start.getDate()).getTime();
  const nowDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const endDay = new Date(twr.end.getFullYear(), twr.end.getMonth(), twr.end.getDate()).getTime();
  if (nowDay < startDay) return 0;
  if (nowDay > endDay) return (endDay - startDay) / day + 1;
  return (nowDay - startDay) / day + 1;
}

/** 在行对象里按字段key/别名宽松取列名：先精确，再按唯一前缀/包含匹配 */
function findKey(row: Record<string, unknown>, key: string): string | undefined {
  if (key in row) return key;
  const hit = Object.keys(row).find((k) => k === key || k.toLowerCase().includes(key.toLowerCase()) || key.toLowerCase().includes(k.toLowerCase()));
  return hit;
}

/** 根据名次与总数计算 TOP 档标签 */
function tierOf(rank: number, total: number, tiers: { label: string; from: number; to: number }[], enabled: boolean): string {
  if (!enabled || !total || !rank) return '';
  if (!tiers.length) return '';
  const pct = (rank / total) * 100;
  for (const tt of tiers) {
    if (pct >= tt.from && pct <= tt.to) return tt.label;
  }
  // 未落入任何档位：归为超出（最后一个档之后）
  const maxTo = Math.max(...tiers.map((x) => x.to));
  return pct > maxTo ? '' : '';
}

/** 是否包含分组排名 */
function metaHasGroup(meta: { mode: 'whole' | 'group'; groupBy: unknown[] }[]): boolean {
  return meta.some((m) => m.mode === 'group' && m.groupBy && m.groupBy.length > 0);
}

/** 计算某行所在分组的成员数 */
function bucketSize(
  rows: { r: Record<string, unknown> }[],
  groupBy: { key: string }[],
  cur: Record<string, unknown>,
): number {
  const keyOf = (r: Record<string, unknown>) => groupBy.map((g) => {
    const k = findKey(r, g.key);
    return String(k === undefined ? '' : r[k]);
  }).join('␟');
  const target = keyOf(cur);
  return rows.filter((x) => keyOf(x.r) === target).length;
}
/** 按粒度格式化分组键 */
function granVal(v: unknown, gran?: DateGranularity): string {
  if (!gran || v === null || v === undefined || v === '') return String(v ?? '');
  const dt = toDate(v);
  if (!dt || Number.isNaN(dt.getTime())) return String(v);
  const yr = dt.getFullYear();
  const mo = `${yr}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
  const day = `${mo}-${String(dt.getDate()).padStart(2, '0')}`;
  if (gran === 'year') return String(yr);
  if (gran === 'month') return mo;
  if (gran === 'day') return day;
  const one = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
  const dow = (one.getDay() + 6) % 7;
  one.setDate(one.getDate() - dow);
  const oneMo = `${one.getFullYear()}-${String(one.getMonth() + 1).padStart(2, '0')}`;
  const oneDay = `${oneMo}-${String(one.getDate()).padStart(2, '0')}`;
  return oneDay + '周';
}

function groupLabel(label: string, gran?: DateGranularity): string {
  if (!gran) return label;
  const map: Record<DateGranularity, string> = {
    year: `${label}(年份)`,
    month: `${label}(月份)`,
    week: `${label}(周)`,
    day: `${label}(日期)`,
  };
  return map[gran] ?? label;
}

/** Excel 序列日期 / 字符串日期 -> Date（宽松解析） */
function toDate(v: unknown): Date | null {
  if (v == null || v === '') return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === 'number') {
    // Excel 1900 日期序列
    if (v > 20000 && v < 80000) {
      const d = new Date(Math.round((v - 25569) * 86400 * 1000));
      return Number.isNaN(d.getTime()) ? null : d;
    }
    // 8 位数字 YYYYMMDD
    if (v > 19000101 && v < 21001231) {
      const y = Math.floor(v / 10000);
      const m = Math.floor((v % 10000) / 100);
      const day = v % 100;
      const d = new Date(y, m - 1, day);
      return Number.isNaN(d.getTime()) ? null : d;
    }
    return null;
  }
  let s = String(v).trim();
  if (!s) return null;
  // 2025年8月5日 / 2025/8/5 / 2025.8.5 -> 2025-8-5
  s = s
    .replace(/[年月./]/g, '-')
    .replace(/日/g, '')
    .replace(/\s+\d{1,2}:\d{2}(:\d{2})?$/, '') // 去掉时间部分
    .replace(/-+$/g, '')
    .trim();
  const m = s.match(/^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?/);
  if (m) {
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const day = m[3] ? Number(m[3]) : 1;
    const d = new Date(y, mo - 1, day);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  // 字符串 8 位 YYYYMMDD（如 "20200801"）
  const s8 = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (s8) {
    const d = new Date(Number(s8[1]), Number(s8[2]) - 1, Number(s8[3]));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function inRange(v: unknown, start: Date, end: Date): boolean {
  const d = toDate(v);
  if (!d) return false;
  const t = d.getTime();
  return t >= start.getTime() && t <= end.getTime() + 86399999;
}

function inWindow(v: unknown, tw?: TimeWindow): boolean {
  if (!tw || !tw.preset) return true;
  const { start, end } = resolveTimeWindow(tw);
  return inRange(v, start, end);
}

function agg(fn: string, nums: number[]): number {
  const xs = nums.filter((n) => Number.isFinite(n));
  if (xs.length === 0) return NaN;
  switch (fn) {
    case 'sum':
      return xs.reduce((a, b) => a + b, 0);
    case 'avg':
      return xs.reduce((a, b) => a + b, 0) / xs.length;
    case 'count':
      return xs.length;
    case 'max':
      return Math.max(...xs);
    case 'min':
      return Math.min(...xs);
    case 'median': {
      const s = [...xs].sort((a, b) => a - b);
      const mid = Math.floor(s.length / 2);
      return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
    }
    default:
      return NaN;
  }
}

/** 去重计数：统计某列的去重值个数 */
function aggCountDistinct(vals: unknown[]): number {
  return new Set(vals.map((v) => String(v ?? '').trim()).filter((v) => v !== '' && v !== 'null' && v !== 'undefined')).size;
}

/**
 * 开单天数：在给定明细行中，统计「有成交金额(>0)」的不同日期数量。
 * 需要行级数据：dateVal（单据日期原始值）、amountVal（成交金额）。
 */
function aggActiveDays(rows: Record<string, unknown>[], dateKey: string, amountKey: string): number {
  const days = new Set<string>();
  for (const r of rows) {
    const amt = toNum(r[amountKey]);
    if (!Number.isFinite(amt) || amt <= 0) continue;
    const d = toDate(r[dateKey]);
    if (d instanceof Date && !isNaN(d.getTime())) {
      days.add(`${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`);
    } else {
      // 无法解析成日期时，用原始值去重兜底
      const raw = String(r[dateKey] ?? '').trim();
      if (raw) days.add(raw);
    }
  }
  return days.size;
}

function buildGroups(
  rows: Record<string, unknown>[],
  dims: { key: string; gran?: import('../lib/types').DateGranularity }[],
  metrics: { key: string }[],
): Map<string, { nums: number[][]; keys: string[]; recs: Record<string, unknown>[] }> {
  const groups = new Map<string, { nums: number[][]; keys: string[]; recs: Record<string, unknown>[] }>();
  for (const r of rows) {
    const keys = dims.map((x) => granVal(r[x.key], x.gran));
    if (!keys.join('').trim()) continue;
    const k = keys.join('␟');
    if (!groups.has(k)) groups.set(k, { nums: metrics.map(() => []), keys, recs: [] });
    const g = groups.get(k)!;
    metrics.forEach((mt, mi) => {
      g.nums[mi].push(toNum(r[mt.key]));
    });
    g.recs.push(r);
  }
  return groups;
}

function tableById(tables: DataTable[], id?: string): DataTable | undefined {
  return tables.find((t) => t.id === id);
}

function distinctValues(rows: Record<string, unknown>[], key: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of rows) {
    const v = r[key];
    if (v == null || v === '') continue;
    const s = String(v);
    if (!seen.has(s)) {
      seen.add(s);
      out.push(s);
    }
  }
  return out;
}

function cap<T>(arr: T[]): T[] {
  return arr.slice(0, PREVIEW_LIMIT);
}

/** 取某节点输出的标量值（基准统计） */
function scalarOf(out?: NodePreview): number {
  if (!out?.scalar) return NaN;
  return toNum(out.scalar.value);
}

/** 取一个节点的"可参与数字运算的值"：优先用标量输出；若为列输出（如分组开单天数），取首行第一个数值列的值 */
function nodeRefScalarVal(out?: NodePreview): number {
  if (out?.scalar) return toNum(out.scalar.value);
  if (out && out.columns.length && out.rows.length) {
    const cols = out.columns.filter((c) => c !== 'label');
    const row = out.rows[0];
    for (const c of cols) {
      const v = toNum(row[c]);
      if (Number.isFinite(v)) return v;
    }
  }
  return NaN;
}

/** 四则运算：a <op> b；除零/非数返回 NaN */
function arith(op: ComputeExpr['op'], a: number, b: number): number {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return NaN;
  switch (op) {
    case 'add': return a + b;
    case 'sub': return a - b;
    case 'mul': return a * b;
    case 'div': return b === 0 ? NaN : a / b;
    default: return NaN;
  }
}

function arithSymbol(op: ComputeExpr['op']): string {
  return op === 'add' ? '＋' : op === 'sub' ? '－' : op === 'mul' ? '×' : '÷';
}

/**
 * 组合表达式求值：把公式里的列名（key / label）替换为该行数值，再安全计算。
 * 仅允许数字、四则、括号、小数点与 %；列名替换后通过白名单校验，防御注入。
 * 返回 NaN 表示无法计算（空值/除零等）。
 */
function evalRowFormula(
  exprText: string,
  row: Record<string, unknown>,
  cols: string[],
  labels?: Record<string, string>,
): number {
  try {
    let s = String(exprText || '');
    // 全角符号归一化为半角（用户常误输 （）＋－×÷／）
    s = s
      .replace(/[（]/g, '(').replace(/[）]/g, ')')
      .replace(/[＋]/g, '+').replace(/[－—]/g, '-')
      .replace(/[×✕✖]/g, '*').replace(/[÷／]/g, '/');
    // 按长度降序替换列名，避免“库存”与“库存汇总”的部分匹配
    const keys = (labels ? [...cols, ...Object.values(labels)] : cols)
      .filter(Boolean)
      .sort((a, b) => b.length - a.length);
    for (const name of keys) {
      const key = labels && labels[name] ? labels[name] : name;
      const v = toNum(row[key]);
      s = s.split(name).join(Number.isFinite(v) ? `(${v})` : '(0)');
    }
    const cleaned = s.replace(/\s+/g, '');
    if (!/^[0-9+\-*/().%]*$/.test(cleaned)) return NaN;
    const expr = cleaned.replace(/%/g, '/100');
     
    const v = new Function(`"use strict";return (${expr});`)();
    return Number.isFinite(v) ? v : NaN;
  } catch {
    return NaN;
  }
}

/** token 序列 → 人类可读表达式文本（用于 note/预览展示），列名用中括号包裹避免歧义 */
function tokensToText(tokens: ExprToken[]): string {
  return tokens
    .map((t) => {
      switch (t.kind) {
        case 'field': return `[${t.label || t.col}]`;
        case 'op': return arithSymbol(t.op);
        case 'paren': return t.paren;
        case 'num': return t.value;
        default: return '';
      }
    })
    .join(' ')
    .replace(/\s*\(\s*/g, '(')
    .replace(/\s*\)\s*/g, ') ');
}

/** 取行内某列的值，兼容「聚合前缀」中英文差异（如 sum(销售数量) ⇄ 求和(销售数量)）。 */
function rowFieldValue(row: Record<string, unknown>, col: string): unknown {
  if (col in row) return row[col];
  // 尝试把聚合函数的英文/中文前缀互相替换后再查，兼容历史保存的英文 vs 引擎中文列名
  const prefixMap: Record<string, string> = {
    sum: '求和', avg: '平均', max: '最大', min: '最小',
    count: '计数', countDistinct: '去重计数', activeDays: '开单天数',
  };
  for (const [en, zh] of Object.entries(prefixMap)) {
    const startEn = `${en}(`;
    const startZh = `${zh}(`;
    if (col.startsWith(startEn) && `${zh}${col.slice(startEn.length - 1)}` in row) {
      return row[`${zh}${col.slice(startEn.length - 1)}`];
    }
    if (col.startsWith(startZh) && `${en}${col.slice(startZh.length - 1)}` in row) {
      return row[`${en}${col.slice(startZh.length - 1)}`];
    }
  }
  return undefined;
}

/**
 * 结构化（点选式）表达式逐行求值：把 token 序列拼成合法算术串后安全计算。
 * - field 片段替换为该行对应列的数值；
 * - 仅含数字/四则/括号，杜绝注入；任何片段缺失/非数/除零 → NaN。
 */
function evalRowTokens(tokens: ExprToken[], row: Record<string, unknown>): number {
  try {
    if (!tokens || !tokens.length) return NaN;
    const parts: string[] = [];
    let hasField = false;
    for (const t of tokens) {
      switch (t.kind) {
        case 'field': {
          hasField = true;
          const v = toNum(rowFieldValue(row, t.col));
          if (!Number.isFinite(v)) return NaN;
          parts.push(`(${v})`);
          break;
        }
        case 'op':
          parts.push(t.op === 'add' ? '+' : t.op === 'sub' ? '-' : t.op === 'mul' ? '*' : '/');
          break;
        case 'paren':
          parts.push(t.paren);
          break;
        case 'num': {
          const n = toNum(t.value);
          if (!Number.isFinite(n)) return NaN;
          parts.push(`(${n})`);
          break;
        }
        default:
          return NaN;
      }
    }
    if (!hasField) return NaN;
    const expr = parts.join('');
    if (!/^[0-9+\-*/().\s]*$/.test(expr)) return NaN;
     
    const v = new Function(`"use strict";return (${expr});`)();
    return Number.isFinite(v) ? v : NaN;
  } catch {
    return NaN;
  }
}

/** 取一个节点的"可参与数字运算的值"：优先用标量输出；若为列输出（如分组开单天数），取首行第一个数值列

/** 按 id 取表；id 缺失时兜底到第一张可用表（兼容旧节点仅显示未写入 tableId） */
function matchCond(r: Record<string, unknown>, c: FilterCondition): boolean {
  const v = r[c.fieldKey];
  const s = String(v ?? '');
  const arr = (c.values && c.values.length ? c.values : c.value ? [c.value] : []);
  switch (c.op) {
    case 'eq': return s === arr[0];
    case 'neq': return s !== arr[0];
    case 'in': return arr.length ? arr.some((x) => String(x) === s) : true;
    case 'nin': return arr.length ? !arr.some((x) => String(x) === s) : true;
    case 'contains': return s.includes(arr[0] ?? '') || String(arr[0] ?? '').includes(s);
    default: return true;
  }
}

function resolveTable(tables: DataTable[], id?: string): DataTable | undefined {
  if (id) {
    const t = tableById(tables, id);
    if (t) return t;
  }
  return tables[0];
}

/** 把一个节点的预览输出（columns + rows）包装成一张"虚拟数据表"，供下游节点像选表一样选它 */
function virtualTableFromPreview(out: NodePreview | undefined, name: string): DataTable | undefined {
  if (!out || !out.columns.length) return undefined;
  const sampleRows = out.rows.slice(0, 50);
  const fields: TableField[] = out.columns.map((c, i) => {
    // 依据该列样本推断类型
    const colVals = out.rows.map((r) => r[c]);
    const numericCount = colVals.filter((v) => Number.isFinite(toNum(v))).length;
    const dateCount = colVals.filter((v) => toDate(v) !== null).length;
    let type: TableField['type'] = 'string';
    if (colVals.length && numericCount / colVals.length >= 0.8) type = 'number';
    else if (colVals.length && dateCount / colVals.length >= 0.8) type = 'date';
    return {
      key: c,
      alias: c,
      type,
      tagColor: TAG_COLORS[i % TAG_COLORS.length],
      sample: String(colVals.find((v) => v !== '' && v != null) ?? ''),
    };
  });
  const vrows = out.rows.map((r) => {
    const o: Record<string, string | number | boolean> = {};
    for (const c of out.columns) {
      const v = r[c];
      o[c] = typeof v === 'number' ? v : typeof v === 'boolean' ? v : String(v ?? '');
    }
    return o;
  });
  return {
    id: `__node_${name}`,
    name,
    fileName: '',
    createdAt: 0,
    rowCount: out.rows.length,
    fields,
    previewRows: sampleRows.map((r) => {
      const o: Record<string, string> = {};
      for (const c of out.columns) o[c] = String(r[c] ?? '');
      return o;
    }),
    rows: vrows,
  };
}

/**
 * 便捷封装：按节点 data 上的 source/sourceNode/tableId 解析数据行集。
 * 各处理节点调用时把 byId（outputs 查找器）与 incoming 传入。
 */
function resolveRowset(
  spec: { tableId?: string; source?: 'table' | 'node'; sourceNode?: string; sourceTable?: string },
  tables: DataTable[],
  byId: (nid?: string) => NodePreview | undefined,
  incoming: (NodePreview | undefined)[],
): { t: DataTable; from: string } | undefined {
  // byId 是 outputs[nid] 包装；这里直接复用 pickColumnOutput 需要 outputs map，
  // 改为：node 来源时从 incoming 或 byId 指定节点取
  if (spec.source === 'node') {
    const out = spec.sourceNode ? byId(spec.sourceNode) : (incoming.find((o) => o && o.columns.length > 0) ?? undefined);
    const name = out?.title || '上一步结果';
    const vt = virtualTableFromPreview(out, name);
    if (vt) return { t: vt, from: `节点结果·${name}` };
    return undefined;
  }
  const t = resolveTable(tables, spec.tableId) || (spec.tableId === undefined ? tables[0] : undefined);
  if (!t) return undefined;
  return { t, from: t.name };
}

/** 取一个分组/逐行结果（含多列）：优先指定节点，其次入边，最后回退到最近的多列结果 */
function pickColumnOutput(
  outputs: OutputMap,
  incoming: (NodePreview | undefined)[],
  nid?: string,
): NodePreview | undefined {
  const explicit = nid ? outputs[nid] : undefined;
  if (explicit && explicit.columns.length) return explicit;
  const inCol = incoming.find((o) => o && o.columns.length > 0);
  if (inCol) return inCol;
  const any = Object.values(outputs).find((o) => o && o.columns.length > 1);
  return any;
}

/** 取一个标量结果（基准统计输出）：优先指定节点，其次入边中的标量，最后回退到最近的标量 */
function pickScalarOutput(
  outputs: OutputMap,
  incoming: (NodePreview | undefined)[],
  nid?: string,
): NodePreview | undefined {
  const explicit = nid ? outputs[nid] : undefined;
  if (explicit && explicit.scalar) return explicit;
  const inScalar = incoming.find((o) => o && o.scalar);
  if (inScalar) return inScalar;
  return Object.values(outputs).find((o) => o && o.scalar);
}

function evalNode(
  node: FlowNode,
  nodes: FlowNode[],
  edges: FlowEdge[],
  tables: DataTable[],
  outputs: OutputMap,
): NodePreview {
  const d = node.data as Record<string, unknown>;
  const incoming = edges.filter((e) => e.target === node.id).map((e) => outputs[e.source]);
  const byId = (nid?: string) => (nid ? outputs[nid] : undefined);

  switch (node.kind) {
    case 'trigger':
      return { title: '开始', columns: [], rows: [], note: '规则触发入口，无数据输出。' };

    case 'time': {
      const td = d as unknown as TimeNodeData;
      const tw = td.timeWindow;
      if (!tw?.preset) return { title: '时间窗口', columns: [], rows: [], note: '未设置时间范围。' };
      const { label, start, end } = resolveTimeWindow(tw);
      return {
        title: '时间窗口',
        columns: ['时间范围', '起', '止'],
        rows: [{ 时间范围: label, 起: start.toLocaleDateString(), 止: end.toLocaleDateString() }],
        note: '该时间范围会作用于下游按日期筛选的节点。',
      };
    }

    case 'elapsed': {
      const ed = d as unknown as ElapsedNodeData;
      const scope = ed.scope || 'month';
      const includeToday = ed.includeToday !== false;
      const r = resolveElapsedDays(scope, { customStart: ed.customStart, customEnd: ed.customEnd, includeToday });
      const scopeLabel =
        scope === 'week' ? '本周' : scope === 'month' ? '本月' : scope === 'quarter' ? '本季' : scope === 'year' ? '本年' : '时间区间';
      const label = ed.resultLabel || `${scopeLabel}已过天数`;
      const day0 = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate());
      const fmtD = (x: Date) => `${x.getFullYear()}/${String(x.getMonth() + 1).padStart(2, '0')}/${String(x.getDate()).padStart(2, '0')}`;
      const calcElapsedDays = (s: Date, e: Date) => {
        const now = day0(new Date());
        if (now < day0(s)) return 0;
        const ref = now > day0(e) ? day0(e) : now;
        return Math.round((ref.getTime() - day0(s).getTime()) / 86400000) + 1;
      };
      const asOfDesc = includeToday ? '含今天' : '不含今天（统计到昨天）';
      return {
        title: '已过天数',
        columns: ['统计项', '数值'],
        rows: [{ 统计项: label, 数值: String(r.elapsedDays) }],
        scalar: { label, value: String(r.elapsedDays) },
        shape: 'scalar' as const,
        note: `${r.periodLabel}（${fmtD(r.periodStart)} ~ ${fmtD(r.periodEnd)}，共 ${r.totalDays} 天），截至 ${fmtD(r.asOf)}（${asOfDesc}）已过去 ${r.elapsedDays} 天。可与「开单天数」相减得到未开单天数。`,
      };
    }

    case 'base': {
      const bd = d as unknown as BaseNodeData;
      const rs = resolveRowset(
        {
          tableId: bd.tableId,
          source: (d as Record<string, unknown>).source as 'table' | 'node' | undefined,
          sourceNode: (d as Record<string, unknown>).sourceNode as string | undefined,
        },
        tables,
        byId,
        incoming,
      );
      if (!rs) {
        return { title: '基础数据', columns: [], rows: [], shape: 'table', note: '请选择数据表或上一步节点结果，并选择维度列。' };
      }
      const t = rs.t;
      const srcIsNode = (d as Record<string, unknown>).source === 'node';
      // 勾选列（多列，仅数据表模式）优先；否则回退单列 fieldKey
      const selCols = !srcIsNode && bd.columns && bd.columns.length ? bd.columns.filter((c) => c && c.key) : [];
      const single = selCols.length === 1;
      const distinct = !!bd.distinct && single;
      if (selCols.length) {
        const labels = selCols.map((c) => c.label || c.key);
        if (distinct) {
          const vals = distinctValues(allRows(t), selCols[0].key);
          const col = labels[0];
          return {
            title: '基础数据',
            columns: [col],
            rows: cap(vals).map((v) => ({ [col]: v })),
            shape: 'table',
            note: `来自「${rs.from}」的「${col}」，共 ${vals.length} 个去重值（预览最多显示 ${PREVIEW_LIMIT} 行）。`,
            scalar: { kind: 'column', col },
            allCols: t.fields.map((f) => f.key),
          };
        }
        const rows = cap(allRows(t)).map((r) => {
          const o: Record<string, string | number> = {};
          selCols.forEach((c, i) => { o[labels[i]] = r[c.key] as string | number; });
          return o;
        });
        return {
          title: '基础数据',
          columns: labels,
          rows,
          shape: 'table',
          note: `来自「${rs.from}」的 ${labels.join('、')}，共 ${rows.length} 行（预览最多显示 ${PREVIEW_LIMIT} 行）。`,
          allCols: t.fields.map((f) => f.key),
        };
      }
      const fieldKey = bd.fieldKey || t.fields.find((f) => f.type === 'string')?.key || t.fields[0]?.key;
      if (!fieldKey) {
        return { title: '基础数据', columns: [], rows: [], shape: 'table', note: '未找到可用的维度列。' };
      }
      const vals = distinctValues(allRows(t), fieldKey);
      const label = bd.fieldLabel || fieldKey;
      return {
        title: '基础数据',
        columns: [label],
        rows: cap(vals).map((v) => ({ [label]: v })),
        shape: 'table',
        note: `来自「${rs.from}」的「${label}」，共 ${vals.length} 个去重值（预览最多显示 ${PREVIEW_LIMIT} 行）。`,
        scalar: { kind: 'column', col: label },
        allCols: t.fields.map((f) => f.key),
      };
    }

    case 'field': {
      const fd = d as unknown as FieldNodeData;
      const rs = resolveRowset(
        {
          tableId: fd.tableId,
          source: (d as Record<string, unknown>).source as 'table' | 'node' | undefined,
          sourceNode: (d as Record<string, unknown>).sourceNode as string | undefined,
        },
        tables,
        byId,
        incoming,
      );
      if (!rs) return { title: '数据字段', columns: [], rows: [], note: '请选择数据表或上一步节点结果。' };
      const t = rs.t;
      if (!fd.fieldKey) {
        const first = t.fields[0];
        if (first) {
          const vals = distinctValues(allRows(t), first.key);
          return { title: '数据字段', columns: [first.alias || first.key], rows: cap(vals).map((v) => ({ [first.alias || first.key]: v })), note: `尚未选择字段，预览「${rs.from}」首个列「${first.alias || first.key}」共 ${vals.length} 个值。` };
        }
        return { title: '数据字段', columns: [], rows: [], note: '请选择字段。' };
      }
      const label = fd.fieldLabel || fd.fieldKey;
      const vals = distinctValues(allRows(t), fd.fieldKey);
      return {
        title: '数据字段',
        columns: [label],
        rows: cap(vals).map((v) => ({ [label]: v })),
        note: `来自「${rs.from}」字段「${label}」共 ${vals.length} 个去重值。`,
        scalar: { kind: 'column', col: label },
        allCols: t.fields.map((f) => f.key),
      };
    }

    case 'lookup': {
      const ld = d as unknown as LookupNodeData;
      const rs = resolveRowset(
        {
          tableId: ld.tableId,
          source: (d as Record<string, unknown>).source as 'table' | 'node' | undefined,
          sourceNode: (d as Record<string, unknown>).sourceNode as string | undefined,
        },
        tables,
        byId,
        incoming,
      );
      if (!rs) return { title: '查找', columns: [], rows: [], note: '请选择数据表或上一步节点结果。' };
      const target = rs.t;
      const trows = allRows(target);
      const tFields = target.fields;
      const targetFields = {
        firstString: tFields.find((f) => f.type === 'string'),
        firstNumber: tFields.find((f) => f.type === 'number'),
        firstDate: tFields.find((f) => f.type === 'date'),
      };

      if (ld.mode === 'aggregate') {
        // 未显式选择时，智能猜测匹配字段（店仓类）与汇总字段（数值类），便于先看到结果
        const matchField = ld.matchField || targetFields.firstString?.key;
        const aggField = ld.aggField || targetFields.firstNumber?.key;
        const dateField = ld.dateField || targetFields.firstDate?.key;
        if (!matchField || !aggField)
          return { title: '查找·聚合带回', columns: [], rows: [], note: '请选择匹配字段与汇总字段（目标表需有文本键列与数值指标列）。' };

        // —— 诊断统计（帮助定位"全是 0"的原因）——
        const totalRows = trows.length;
        const dateParsable = dateField ? trows.filter((r) => toDate(r[dateField]) !== null).length : totalRows;
        const useWindow = ld.timeWindow && ld.timeWindow.preset && dateField;
        const filtered = trows.filter((r) => (useWindow ? inWindow(r[dateField], ld.timeWindow) : true));
        const numParsable = filtered.filter((r) => Number.isFinite(toNum(r[aggField]))).length;
        const winLabel = useWindow && ld.timeWindow ? resolveTimeWindow(ld.timeWindow).label : '不限时间';

        // 匹配键集合：优先上游（基础数据）维度列；否则用目标表 distinct
        let keys: string[] = [];
        const up = incoming[0];
        if (up && up.columns.length) {
          keys = up.rows.map((r) => String(r[up.columns[0]])).filter((v) => v !== '');
        }
        if (keys.length === 0) keys = distinctValues(trows, matchField);
        const outLabel = ld.aggLabel || (ld.aggFn === 'activeDays' ? '开单天数' : `${ld.aggFn || 'sum'}(${ld.aggFieldLabel || aggField})`);
        const keyLabel = ld.matchFieldLabel || matchField;
        const matchedKeys = new Set(filtered.map((r) => String(r[matchField])));
        const rows = keys.map((k) => {
          const matched = filtered.filter((r) => String(r[matchField]) === k);
          let val: number;
          if (ld.aggFn === 'activeDays') {
            val = aggActiveDays(matched, dateField || '', aggField);
          } else if (ld.aggFn === 'countDistinct') {
            val = aggCountDistinct(matched.map((r) => r[aggField]));
          } else {
            val = agg(ld.aggFn || 'sum', matched.map((r) => toNum(r[aggField])));
          }
          if (!Number.isFinite(val)) val = ld.fillZero ? 0 : NaN;
          return { [keyLabel]: k, [outLabel]: Number.isFinite(val) ? fmtNum(val) : (ld.fillZero ? '0' : '无记录') };
        });

        // 诊断结论
        let diag = '';
        if (totalRows === 0) diag = '⚠️ 该表样本没有数据行，请确认上传的表正确。';
        else if (useWindow && dateParsable === 0)
          diag = `⚠️ 时间窗「${winLabel}」内 0 行：日期字段「${dateField}」没有可解析的日期（样本 ${totalRows} 行均未识别为日期）。请检查日期字段是否选错、日期格式是否规范。`;
        else if (filtered.length === 0) {
          // 计算样本数据的实际日期范围，帮助定位"年份对不上"
          const parsed = dateField ? trows.map((r) => toDate(r[dateField])).filter((x): x is Date => x !== null) : [];
          let rangeHint = '';
          if (parsed.length) {
            const min = parsed.reduce((a, b) => (a < b ? a : b));
            const max = parsed.reduce((a, b) => (a > b ? a : b));
            const sameYear = min.getFullYear() === max.getFullYear();
            const winHint = ld.timeWindow ? resolveTimeWindow(ld.timeWindow).hint.replace(/（.*?）/, '') : '';
            rangeHint = `样本数据日期范围为 ${sameYear ? min.getFullYear() + '年' : ''}${min.getMonth() + 1}月${min.getDate()}日 ~ ${max.getFullYear()}年${max.getMonth() + 1}月${max.getDate()}日；而时间窗解析为 ${winHint}。二者年份不一致就会 0 行。请改用「指定月份」并选数据所在的月份（如 ${min.getFullYear()}年${min.getMonth() + 1}月）。`;
          }
          diag = `⚠️ 时间窗「${winLabel}」过滤后 0 行（样本 ${totalRows} 行都不在该时间范围内）。${rangeHint} `;
        }
        else if (numParsable === 0)
          diag = `⚠️ 汇总字段「${ld.aggFieldLabel || aggField}」无法解析为数字（时间窗内 ${filtered.length} 行）。请检查汇总字段是否为成交金额这类数值列。`;
        else if (keys.every((k) => !matchedKeys.has(k)))
          diag = `⚠️ 时间窗内有 ${filtered.length} 行，但没有任何行的「${keyLabel}」与上游键匹配。请检查匹配字段是否一致（如零售表的"店仓"与店仓表的"店仓"）。`;
        else
          diag = `✅ 时间窗「${winLabel}」：样本 ${totalRows} 行 → 窗内 ${filtered.length} 行，其中「${ld.aggFieldLabel || aggField}」可计入数字的 ${numParsable} 行；命中键 ${matchedKeys.size} 个。`;

        return {
          title: '查找·聚合带回',
          columns: [keyLabel, outLabel],
          rows: cap(rows),
          shape: 'table',
          note: `在「${rs.from}」中按「${keyLabel}」匹配、时间窗内 ${ld.aggFn || 'sum'}(「${ld.aggFieldLabel || aggField}」)，共 ${rows.length} 个键${ld.fillZero ? '，无记录按 0 计入' : ''}。`,
          diag,
        };
      }

      // 返回字段值
      if (!ld.matchField || !ld.returnField)
        return { title: '查找·返回字段', columns: [], rows: [], note: '请选择匹配字段与返回字段。' };
      const up = incoming[0];
      const keys: string[] = up && up.columns.length ? up.rows.map((r) => String(r[up.columns[0]])) : distinctValues(trows, ld.matchField);
      const retLabel = ld.returnLabel || ld.returnFieldLabel || ld.returnField;
      const keyLabel = ld.matchFieldLabel || ld.matchField;
      const rows = keys.map((k) => {
        const hit = trows.find((r) => String(r[ld.matchField!]) === k);
        return { [keyLabel]: k, [retLabel]: hit ? String(hit[ld.returnField!] ?? '') : '无匹配' };
      });
      return {
        title: '查找·返回字段',
        columns: [keyLabel, retLabel],
        rows: cap(rows),
        note: `在「${rs.from}」中按「${keyLabel}」匹配，带回「${retLabel}」。`,
      };
    }

    case 'rank': {
      const rk = d as unknown as RankNodeData;
      const rs = resolveRowset(
        {
          tableId: rk.tableId,
          source: (d as Record<string, unknown>).source as 'table' | 'node' | undefined,
          sourceNode: rk.refNode?.nodeId,
        },
        tables,
        byId,
        incoming,
      );
      if (!rs) return { title: '排名', columns: [], rows: [], note: '请选择数据表或上一步节点结果。' };
      const t = rs.t;
      const srcIsNode = (d as Record<string, unknown>).source === 'node';
      // 数据表模式：按日期字段 + 统计时间窗圈定排名范围（无日期字段留空=不限时间）
      const dateKey = !srcIsNode ? rk.dateField : undefined;
      // 节点结果模式：时间范围以上游节点为准，不在此过滤
      const useWindow = !srcIsNode && dateKey && rk.timeWindow;
      let srcRows = allRows(t);
      if (useWindow && dateKey) srcRows = srcRows.filter((r) => inWindow(r[dateKey], rk.timeWindow));
      if (!srcRows.length) return { title: '排名', columns: [], rows: [], note: '数据源暂无记录。' };
      const items = (Array.isArray(rk.items) ? rk.items.filter((it) => it.fieldKey) : []).map((it) => ({
        ...it,
        fieldLabel: it.fieldLabel || it.fieldKey,
        outLabel: it.rankLabel || `排名(${it.fieldLabel || it.fieldKey})`,
      }));
      // 行集合：基于该行参与排名的指标列
      const rowList = srcRows.map((r, oi) => ({ r, oi }));

      const colVal = (r: Record<string, unknown>, key: string): unknown => {
        const k = findKey(r, key);
        return k !== undefined ? r[k] : undefined;
      };
      // 全量排名：按值排序，返回 { 名次索引, 并列 }
      const rankAll = (it: { fieldKey: string; order: 'asc' | 'desc' }, rows: { r: Record<string, unknown>; oi: number }[]) => {
        const withVal = rows
          .map((x, pos) => ({ x, pos, v: toNum(colVal(x.r, it.fieldKey)) }))
          .filter((y) => Number.isFinite(y.v) && !Number.isNaN(y.v));
        withVal.sort((a, b) => (it.order === 'desc' ? b.v - a.v : a.v - b.v));
        // 乐观并列名次 + 名次连续
        const rankByO: Record<number, number> = {};
        let draft = 1;
        for (let i = 0; i < withVal.length; i++) {
          if (i > 0 && withVal[i].v !== withVal[i - 1].v) draft = i + 1;
          rankByO[withVal[i].pos] = draft;
        }
        return { rankByO, total: rows.length };
      };
      // 分组排名：按分组键切分，组内排名
      const rankGrouped = (
        it: { fieldKey: string; order: 'asc' | 'desc' },
        groupBy: { key: string }[],
        rows: { r: Record<string, unknown>; oi: number }[],
      ): { rankByO: Record<number, number>; total: number } => {
        const mk = (r: Record<string, unknown>) => groupBy.map((g) => String(colVal(r, g.key) ?? '')).join('␟');
        const buckets = new Map<string, { r: Record<string, unknown>; oi: number }[]>();
        rows.forEach((x) => {
          const k = mk(x.r);
          if (!buckets.has(k)) buckets.set(k, []);
          buckets.get(k)!.push(x);
        });
        const rankByO: Record<number, number> = {};
        for (const members of buckets.values()) {
          const withVal = members
            .map((x) => ({ x, v: toNum(colVal(x.r, it.fieldKey)) }))
            .filter((y) => Number.isFinite(y.v) && !Number.isNaN(y.v));
          withVal.sort((a, b) => (it.order === 'desc' ? b.v - a.v : a.v - b.v));
          let draft = 1;
          for (let i = 0; i < withVal.length; i++) {
            if (i > 0 && withVal[i].v !== withVal[i - 1].v) draft = i + 1;
            rankByO[withVal[i].x.oi] = draft;
          }
        }
        return { rankByO, total: rows.length };
      };

      // 生成输出：原始列 + 每个排名项生成「排名」和「TOP档」两列
      const baseCols = [...new Set<string>([...t.fields.map((f) => f.alias || f.key), ...Object.keys(srcRows[0] || {})])];
      const outCols = [...baseCols];
      const itemMeta: {
        outLabel: string;
        topOutLabel: string;
        order: 'asc' | 'desc';
        tiers: { label: string; from: number; to: number }[];
        tiersOn: boolean;
        mode: 'whole' | 'group';
        groupBy: { key: string; label: string }[];
      }[] = [];
      // 生成输出列名时需避让：上游透传列（baseCols）+ 本节点已用列名（usedCols）
      const usedCols = new Set<string>([...baseCols]);
      const uniq = (base: string): string => {
        if (!usedCols.has(base)) return base;
        let n = 2;
        while (usedCols.has(`${base}#${n}`)) n += 1;
        return `${base}#${n}`;
      };
      items.forEach((it) => {
        const outLabel = uniq(it.outLabel);
        usedCols.add(outLabel);
        const topOutLabel = uniq(`TOP档(${it.fieldLabel})`);
        usedCols.add(topOutLabel);
        outCols.push(outLabel, topOutLabel);
        itemMeta.push({
          outLabel,
          topOutLabel,
          order: it.order,
          tiers: it.topTiers && it.topTiers.length ? it.topTiers : [{ label: 'TOP', from: 0, to: 100 }],
          tiersOn: it.topTiersEnabled !== false,
          mode: it.mode,
          groupBy: it.groupBy || [],
        });
      });
      const rows = rowList.map(({ r, oi }) => {
        const row: Record<string, string | number> = {};
        baseCols.forEach((c) => (row[c] = r[c] as string | number));
        itemMeta.forEach((meta, mi) => {
          const it = items[mi];
          let rankVal = '';
          let topVal = '';
          if (meta.mode === 'group' && meta.groupBy.length) {
            const { rankByO } = rankGrouped(it, meta.groupBy, rowList);
            if (rankByO[oi] !== undefined) {
              rankVal = String(rankByO[oi]);
              topVal = tierOf(rankByO[oi], meta.groupBy.length ? bucketSize(rowList, meta.groupBy, r) : rowList.length, meta.tiers, meta.tiersOn);
            }
          } else {
            const { rankByO, total } = rankAll(it, rowList);
            if (rankByO[oi] !== undefined) {
              rankVal = String(rankByO[oi]);
              topVal = tierOf(rankByO[oi], total, meta.tiers, meta.tiersOn);
            }
          }
          row[meta.outLabel] = rankVal;
          row[meta.topOutLabel] = topVal;
        });
        return row;
      });
      return {
        title: '排名',
        columns: outCols,
        rows: cap(rows),
        shape: 'table',
        note: `来自「${rs.from}」${useWindow && dateKey ? `（${resolveTimeWindow(rk.timeWindow!).label}内）` : ''}对 ${items.map((i) => i.fieldLabel).join('、') || '指标'} 计算排名${metaHasGroup(itemMeta) ? '（分组排名）' : ''}，并生成 TOP 分档。`,
      };
    }

    case 'groupby': {
      const gd = d as unknown as GroupByNodeData;
      const rs = resolveRowset(
        {
          tableId: gd.tableId,
          source: (d as Record<string, unknown>).source as 'table' | 'node' | undefined,
          sourceNode: (d as Record<string, unknown>).sourceNode as string | undefined,
        },
        tables,
        byId,
        incoming,
      );
      if (!rs) return { title: '分组聚合', columns: [], rows: [], note: '请选择数据表或上一步节点结果。' };
      const t = rs.t;
      const dims: { key: string; label: string; gran?: DateGranularity }[] = (
        gd.dims && gd.dims.length
          ? gd.dims.filter((x) => x.fieldKey)
          : gd.groupField
            ? [{ fieldKey: gd.groupField, fieldLabel: gd.groupFieldLabel }]
            : []
      ).map((x) => ({
        key: x.fieldKey || '',
        label: x.fieldLabel || x.fieldKey || '',
        gran: x.granularity,
      }));
      const metricField = gd.metricField || t.fields.find((f) => f.type === 'number')?.key;
      // 多指标：优先用 metrics 列表；否则回退到单指标 metricField/metricFn
      const metrics: { key: string; label: string; fn: string; outLabel: string }[] = (
        Array.isArray(gd.metrics) && gd.metrics.length
          ? gd.metrics.filter((m) => m.fieldKey)
          : gd.metricField
            ? [{ id: 'legacy', fieldKey: gd.metricField, fieldLabel: gd.metricFieldLabel, fn: gd.metricFn || 'sum' }]
            : []
      ).map((m) => ({ key: m.fieldKey as string, label: m.fieldLabel || m.fieldKey || '', fn: (m.fn || 'sum') as string, outLabel: m.resultLabel || '' }));
      if (!metrics.length) metrics.push({ key: metricField ?? '', label: metricField ?? '', fn: 'sum', outLabel: '' });
      if (dims.length && !dims.some((x) => !x.key) && metrics.length) {
      // 时间窗过滤
      const srcRows = allRows(t);
      const rows0 = gd.dateField && gd.timeWindow ? srcRows.filter((r) => inWindow(r[gd.dateField || ''], gd.timeWindow)) : srcRows;
      const groups = buildGroups(rows0, dims, metrics);
      // 时间窗起止（预览展示列：开始日期 / 结束日期）
      const twrAll = gd.dateField && gd.timeWindow && gd.timeWindow.preset !== 'all' ? resolveTimeWindow(gd.timeWindow, new Date()) : undefined;
      // —— 对比期（同期/环期）聚合 ——
      let cmpGroups: Map<string, { nums: number[][]; keys: string[]; recs: Record<string, unknown>[] }> | null = null;
      let cmpMode: 'yoY' | 'ring' | null = null;
      let cmpLabel = '';
      if (gd.timeWindow && gd.dateField) {
        const twr = twrAll ?? resolveTimeWindow(gd.timeWindow, new Date());
        if (twr.compare) {
          cmpMode = (gd.timeWindow && (gd.timeWindow as { compare?: { mode?: 'yoY' | 'ring' } }).compare?.mode) || 'ring';
          cmpLabel = twr.compare.label;
          const cmpRows = srcRows.filter((r) => inRange(r[gd.dateField || ''], twr.compare!.start, twr.compare!.end));
          cmpGroups = buildGroups(cmpRows, dims, metrics);
        }
      }
      const fnLabel = (fn: string) =>
        fn === 'activeDays' ? '开单天数' : fn === 'countDistinct' ? '去重计数' : fn === 'sum' ? '求和' : fn === 'avg' ? '平均' : fn === 'max' ? '最大' : fn === 'min' ? '最小' : fn === 'count' ? '计数' : fn;
      const mLabels = metrics.map((mt) => mt.outLabel || `${fnLabel(mt.fn)}(${mt.label || mt.key})`);
      const dimLabels = dims.map((x) => groupLabel(x.label, x.gran));
      const dateKey = gd.dateField || t.fields.find((f) => f.type === 'date')?.key || '';
      // 时间窗起止日期列：解析出的统计窗口范围（如 2026/09/01 ~ 2026/09/30），置于结果首列
      const fmtD = (x: Date) => `${x.getFullYear()}/${String(x.getMonth() + 1).padStart(2, '0')}/${String(x.getDate()).padStart(2, '0')}`;
      const dateCols: { key: string; label: string; value: string }[] = [];
      if (twrAll) {
        dateCols.push(
          { key: '开始日期', label: '开始日期', value: fmtD(twrAll.start) },
          { key: '结束日期', label: '结束日期', value: fmtD(twrAll.end) },
          { key: '已过天数', label: '已过天数', value: String(calcElapsedDays(twrAll)) },
        );
      }
      const cmpValByKey = new Map<string, number[]>();
      if (cmpGroups && cmpMode) {
        for (const [k, cg] of cmpGroups) {
          cmpValByKey.set(k, metrics.map((mt, mi) => (mt.fn === 'count' ? cg.recs.length : agg(mt.fn, cg.nums[mi]))));
        }
      }
      const out = [...groups.values()].map((g) => {
        const row: Record<string, string | number> = {};
        dateCols.forEach((dc) => (row[dc.key] = dc.value));
        dimLabels.forEach((lab, i) => (row[lab] = g.keys[i] ?? ''));
        const cvals = cmpValByKey.get(g.keys.join('␟'));
        metrics.forEach((mt, mi) => {
          let val: number;
          const fn = mt.fn;
          if (fn === 'activeDays') {
            val = aggActiveDays(g.recs, dateKey, mt.key);
          } else if (fn === 'countDistinct') {
            val = aggCountDistinct(g.recs.map((r) => r[mt.key]));
          } else if (fn === 'count') {
            val = g.recs.length;
          } else {
            val = agg(fn, g.nums[mi]);
          }
          row[mLabels[mi]] = fmtNum(val);
          if (cmpMode && cmpGroups) {
            const cv = cvals ? cvals[mi] : NaN;
            row[`${mLabels[mi]} · ${cmpLabel}`] = Number.isFinite(cv) ? fmtNum(cv) : '—';
            if (Number.isFinite(val) && Number.isFinite(cv)) {
              const rate = val !== 0 ? ((val - cv) / cv) * 100 : cv !== 0 ? -100 : 0;
              row[`${mLabels[mi]} · 增长率%`] = fmtNum(rate);
            } else {
              row[`${mLabels[mi]} · 增长率%`] = '—';
            }
          }
        });
        return row;
      });
      // 兜底：若 groups 为空（无行），仍构造一次以便展示类型
      const emptyRow: Record<string, string> = Object.fromEntries([
        ...dateCols.map((dc) => [dc.key, dc.value] as const),
        ...dims.map((x) => [groupLabel(x.label, x.gran), ''] as const),
        ...mLabels.map((m) => [m, ''] as const),
        ...(cmpMode && cmpGroups ? mLabels.flatMap((m) => [[`${m} · ${cmpLabel}`, ''] as const, [`${m} · 增长率%`, ''] as const]) : []),
      ]);
      const finalOut = out.length ? out : [emptyRow];
      const idx = metrics.findIndex((m) => m.key === metricField);
      const defaultMLabel = idx >= 0 ? mLabels[idx] : (gd.resultLabel || `${fnLabel(gd.metricFn || 'sum')}(${gd.metricFieldLabel || metricField})`);
      return {
        title: '分组聚合',
        columns: [...dateCols.map((dc) => dc.label), ...dimLabels, ...mLabels, ...(cmpMode && cmpGroups ? mLabels.flatMap((m) => [`${m} · ${cmpLabel}`, `${m} · 增长率%`]) : [])],
        rows: cap(finalOut),
        shape: 'table',
        scalar:
          dims.length === 0 && finalOut.length === 1
            ? { label: mLabels[0] || defaultMLabel, value: String(finalOut[0][mLabels[0]] ?? ''), kind: 'column' as const, col: mLabels[0] }
            : undefined,
        note: `来自「${rs.from}」按 ${dimLabels.join('、')} 分组，${mLabels.join('、')}，共 ${out.length} 组。`,
      };
      }
    }

    case 'filter': {
      const fd = d as unknown as FilterNodeData;
      const rs = resolveRowset(
        {
          tableId: fd.tableId,
          source: (d as Record<string, unknown>).source as 'table' | 'node' | undefined,
          sourceNode: (d as Record<string, unknown>).sourceNode as string | undefined,
        },
        tables,
        byId,
        incoming,
      );
      if (!rs) return { title: '过滤', columns: [], rows: [], note: '请选择数据表或上一步节点结果。' };
      if (!fd.conditions || !fd.conditions.length)
        return { title: '过滤', columns: [], rows: [], note: '请添加至少一个过滤条件。' };
      const t = rs.t;
      const rows0 = allRows(t);
      // 解析“引用节点结果”条件：把排名取数等上游节点的输出值（首行指定列/首列）取出，作为比较值
      const resolvedConds = (fd.conditions || []).map((c) => {
        // 引用节点结果模式：自动归一化出实际过滤字段(fieldKey)与引用列(refColumn)，兼容未显式选字段/选列的旧配置
        if (c.valueSource === 'node') {
          const ref = c.refNodeId ? byId(c.refNodeId) : undefined;
          const refCol =
            c.refColumn && ref && ref.columns.includes(c.refColumn)
              ? c.refColumn
              : ref && ref.columns.length
                ? ref.columns[0]
                : c.refColumn || '';
          let fk = c.fieldKey;
          if (!fk && refCol) {
            // 优先匹配行集内同名字段，保证 fieldKey 与实际行 key 一致
            const m = t.fields.find((f) => f.key === refCol);
            fk = m ? m.key : refCol;
          }
          const norm = { ...c, fieldKey: fk || c.fieldKey, fieldLabel: fk || c.fieldLabel, refColumn: refCol };
          if (ref && ref.rows.length) {
            const col = norm.refColumn && ref.columns.includes(norm.refColumn) ? norm.refColumn : ref.columns[0];
            const refVal = String(ref.rows[0][col] ?? '');
            return { ...norm, value: refVal, values: norm.op === 'in' || norm.op === 'nin' ? [refVal] : norm.values };
          }
          // 引用取不到值时条件不成立（避免误命中全部）
          return { ...norm, value: '', values: [] };
        }
        return c;
      });
      const hit = rows0.filter((r) => resolvedConds.every((c) => matchCond(r, c)));
      const rows = hit.map((r) => {
        const row: Record<string, string | number> = {};
        for (const f of t.fields) {
          const val = r[f.key];
          row[f.alias || f.key] = typeof val === 'number' ? val : String(val ?? '');
        }
        return row;
      });
      const cols = t.fields.map((f) => f.alias || f.key);
      const missingField = resolvedConds.some((c) => !c.fieldKey);
      return {
        title: '过滤',
        columns: cols,
        rows: cap(rows),
        shape: 'table',
        note:
          (missingField
            ? `⚠️ 有过滤条件未选择“字段”，无法过滤（请为该条件选字段）。`
            : '') +
          `来自「${rs.from}」共 ${rows0.length} 行，命中 ${rows.length} 行 → 过滤条件 ${fd.conditions!.length} 个。`,
        scalar: { kind: 'table' },
        allCols: cols,
      };
    }

    case 'baseline': {
      const bd = d as unknown as BaselineNodeData;
      let values: number[] = [];
      let basis = '';
      if ((bd.source ?? 'node') === 'node') {
        const src = pickColumnOutput(outputs, incoming, bd.refNode?.nodeId);
        if (!src) return { title: '基准统计', columns: [], rows: [], note: '请先添加「查找·聚合带回 / 分组聚合」节点并连到本节点。' };
        const col = bd.refNode?.label || src.columns[src.columns.length - 1];
        values = src.rows.map((r) => toNum(r[col])).filter((n) => Number.isFinite(n));
        basis = `节点结果「${col}」的 ${values.length} 个分组值`;
      } else {
        const t = resolveTable(tables, bd.tableId);
        const valueField = bd.valueField || t?.fields.find((f) => f.type === 'number')?.key;
        if (!t || !valueField) return { title: '基准统计', columns: [], rows: [], note: '请选择数据表与待统计数值字段。' };
        values = allRows(t).map((r) => toNum(r[valueField])).filter((n) => Number.isFinite(n));
        basis = `「${t.name}·${bd.valueFieldLabel || valueField}」的 ${values.length} 条记录`;
      }
      const fn = bd.baselineFn || 'avg';
      let statValues = values;
      let tailDesc = '';
      if (fn === 'topAvg' || fn === 'bottomAvg') {
        const pct = typeof bd.percent === 'number' && bd.percent > 0 && bd.percent <= 100 ? bd.percent : 20;
        const sorted = [...values].sort((a, b) => b - a); // 降序
        // 取 ceil，保证小样本（如 5 个店铺取 20%）至少取 1 个，且不超过总数
        const take = Math.max(1, Math.min(sorted.length, Math.ceil(sorted.length * pct / 100)));
        statValues = (fn === 'topAvg' ? sorted.slice(0, take) : sorted.slice(sorted.length - take)).filter(
          (n) => Number.isFinite(n),
        );
        tailDesc = `${fn === 'topAvg' ? '前' : '后'} ${pct}%（${take}/${sorted.length} 个店）`;
      }
      const val = fn === 'topAvg' || fn === 'bottomAvg' ? agg('avg', statValues) : agg(fn, values);
      const fnText: Record<string, string> = {
        avg: '所有分组的平均值',
        median: '中位数',
        max: '最高值',
        min: '最低值',
        topAvg: tailDesc,
        bottomAvg: tailDesc,
      };
      const label = bd.resultLabel || '基准值';
      return {
        title: '基准统计',
        columns: ['基准项', '数值'],
        rows: [{ 基准项: label, 数值: fmtNum(val) }],
        scalar: { label, value: fmtNum(val) },
        note: `对${basis}${fn === 'topAvg' || fn === 'bottomAvg' ? `按指标降序排序，取${tailDesc}再求平均` : `求「${fnText[fn] || fn}」`}，得到基准值。`,
      };
    }

    case 'filljoin': {
      const fd = d as unknown as FillJoinNodeData;
      const factSource: 'table' | 'node' = fd.factSource === 'table' ? 'table' : 'node';
      const uniIsNode = fd.universeSource === 'node';
      const uniNode = uniIsNode ? (fd.universeNodeId ? byId(fd.universeNodeId) : undefined) : undefined;
      const uni = uniIsNode ? undefined : resolveTable(tables, fd.universeTableId);
      if (uniIsNode) {
        if (!uniNode || !uniNode.rows || !uniNode.columns?.length) {
          return { title: '左关联补全', columns: [], rows: [], shape: 'table', note: '请选择全集节点（如第一个左关联补全结果）。' };
        }
      } else if (!uni) {
        return { title: '左关联补全', columns: [], rows: [], shape: 'table', note: '请先选择全集表（如店仓表）。' };
      }
      const uniRows = uniIsNode ? uniNode!.rows : allRows(uni!);
      const uniName = uniIsNode ? uniNode!.note || '补全结果' : uni!.name;
      // 不在未显式选择全集键时自动兜底首列：要求用户明确手动指定匹配键
      const universeField = fd.universeField || '';
      if (!universeField) {
        return { title: '左关联补全', columns: [], rows: [], shape: 'table', note: '请先选择全集主匹配键字段（如：店仓名称），并选择事实主匹配键。' };
      }
      const _rawExtra = (Array.isArray(fd.extraKeys) ? fd.extraKeys : []).filter((k) => k?.universeField && k?.factField);
      // 主键与追加键按“全集键名”去重，避免同一键被多次输出/组合
      const extraKeys = _rawExtra.reduce<Array<{ universeField: string; universeFieldLabel?: string; factField: string; factFieldLabel?: string }>>((acc, k) => {
        if (k.universeField && !acc.some((e) => e.universeField === k.universeField)) acc.push(k);
        return acc;
      }, []);
      const uniKeyCols = [universeField, ...extraKeys.map((k) => k.universeField)];
      const uniLabels = [fd.universeFieldLabel || universeField, ...extraKeys.map((k) => k.universeFieldLabel || k.universeField)];
      // 全集返回列：universeReturnFields 多选（空则默认返回全部列）；兼容旧单列 universeReturnField
      const uniAllCols = uniRows.length
        ? Object.keys(uniRows[0] ?? {}).filter((c) => !uniKeyCols.includes(c))
        : [];
      const wantsAll =
        !fd.universeReturnFields || fd.universeReturnFields.length === 0 || fd.universeReturnFields.some((f) => !f.key || f.key === '__all__');
      const returnRefs = wantsAll
        ? uniAllCols.map((k) => ({ key: k, label: k }))
        : (fd.universeReturnFields || []).filter((f) => f.key && !uniKeyCols.includes(f.key));
      if (!wantsAll && fd.universeReturnField && !returnRefs.some((f) => f.key === fd.universeReturnField)) {
        returnRefs.push({ key: fd.universeReturnField, label: fd.universeReturnLabel || fd.universeReturnField });
      }
      const retFields = returnRefs.filter((f) => !uniLabels.includes(f.label));
      // 全集组合（多键去重）
      const comboSeen = new Set<string>();
      const uniCombos: Array<{ key: string; row: Record<string, string | number> }> = [];
      for (const r of uniRows) {
        const parts = uniKeyCols.map((f) => String(r[f] ?? ''));
        const key = parts.join('\u0001');
        if (comboSeen.has(key)) continue;
        comboSeen.add(key);
        const row: Record<string, string | number> = {};
        uniLabels.forEach((lab, i) => {
          const v = r[uniKeyCols[i]];
          if (v == null) row[lab] = '';
          else if (typeof v === 'number' || typeof v === 'string') row[lab] = v;
          else row[lab] = String(v);
        });
        if (retFields.length) {
          for (const rf of retFields) {
            const rv = r[rf.key];
            row[rf.label] = rv == null ? '' : typeof rv === 'number' ? rv : String(rv);
          }
        }
        uniCombos.push({ key, row });
      }
      const fillVal = fd.fillValue ?? '0';

      // 事实结果来源：节点结果模式优先取显式引用的上游节点(factNode)，否则取入边中的多列结果；数据表模式取所选表
      const factNode =
        factSource === 'node'
          ? (fd.factNode ? byId(fd.factNode) : undefined) ?? pickColumnOutput(outputs, incoming, undefined)
          : undefined;

      let factCols: string[] = [];
      let factMap = new Map<string, Record<string, string | number | boolean>>();
      let factName = fd.factTableName || '事实结果';
      // 事实侧仅带回的指标列（如「库存」）：指定后 factCols 只保留该列
      const retCol = fd.factReturnField || '';
      if (factNode) {
        // 节点结果：手动指定匹配键；缺失时提示，不自动兜底首列
        if (!fd.factKeyField) {
          return { title: '左关联补全', columns: [], rows: [], shape: 'table', note: '请选择事实主匹配键字段（与全集主匹配键对应）。' };
        }
        const pk = factNode.columns.includes(fd.factKeyField) ? fd.factKeyField : '';
        if (!pk) {
          return { title: '左关联补全', columns: [], rows: [], shape: 'table', note: `事实节点中未找到匹配键字段「${fd.factKeyField}」。` };
        }
        const fKeys = [pk, ...extraKeys.map((k) => k.factField)];
        factCols = factNode.columns.filter((c) => !fKeys.includes(c));
        if (retCol && factNode.columns.includes(retCol)) factCols = [retCol];
        factName = fd.factNodeLabel || factNode.title || '节点结果';
        factMap = new Map(factNode.rows.map((r) => [fKeys.map((c) => String(r[c] ?? '')).join('\u0001'), r]));
      } else {
        const ft = tableById(tables, fd.factTableId);
        if (ft && fd.factKeyField) {
          factName = ft.name;
          const fKeys = [fd.factKeyField, ...extraKeys.map((k) => k.factField)];
          factCols = ft.fields.map((f) => f.alias || f.key).filter((c) => !fKeys.includes(c));
          if (retCol) factCols = factCols.filter((c) => c === retCol || c === fd.factReturnField);
          factMap = new Map(allRows(ft).map((r) => [fKeys.map((c) => String(r[c] ?? '')).join('\u0001'), r]));
        } else {
          return { title: '左关联补全', columns: [], rows: [], shape: 'table', note: factSource === 'node' ? '请在「事实结果」里选择一个节点结果（如分组聚合/计算），或将其连到本节点。' : '请选择事实结果表与匹配键。' };
        }
      }

      const rows = uniCombos.map(({ key, row }) => {
        const hit = factMap.get(key);
        const r: Record<string, string | number> = { ...row };
        for (const c of factCols) {
          const v = hit ? (hit[c] ?? fillVal) : fillVal;
          if (typeof v === 'number' || typeof v === 'string') r[c] = v;
          else r[c] = String(v);
        }
        return r;
      });
      return {
        title: '左关联补全',
        columns: [...uniLabels, ...retFields.map((f) => f.label), ...factCols],
        rows: cap(rows),
        shape: 'table',
        scalar: { kind: 'column', col: factCols[factCols.length - 1] },
        note: `以「${uniName}」的 ${uniCombos.length} 个「${uniLabels.join('+')}」组合为全集，左关联 ${factName}，缺失补「${fillVal}」（共 ${rows.length} 行）。`,
      };
    }

    case 'condition': {
      const cd = d as unknown as ConditionNodeData;
      const leftIsField = cd.leftSource === 'field';
      const src = !leftIsField
        ? (() => {
            const out = pickColumnOutput(outputs, incoming, cd.leftNode?.nodeId);
            // 判断对象是"标量单值"节点（如已过天数、基准值、单值计算）时，
            // 没有逐行明细：包装为单行判断表（列=结果名，行值=该标量），使其可被条件判断（整表命中或不命中）。
            if (out && out.shape !== 'table' && out.scalar && out.scalar.value !== undefined && out.scalar.value !== '') {
              const lab = cd.leftNode?.label || out.scalar.label || out.scalar.col || out.columns[out.columns.length - 1] || '值';
              return {
                title: out.title,
                columns: [lab],
                rows: [{ [lab]: out.scalar.value }],
              } as NodePreview;
            }
            return out;
          })()
        : (() => {
            const t = resolveTable(tables, cd.tableId);
            if (!t || !cd.fieldKey) return undefined;
            const lab = cd.fieldLabel || cd.fieldKey;
            return {
              columns: [lab],
              rows: allRows(t).map((r) => ({ [lab]: r[cd.fieldKey!] ?? '' })),
            } as NodePreview;
          })();
      if (!src || !src.columns.length) return { title: '判断', columns: [], rows: [], note: '请先配置判断对象：连接分组/补全/计算节点，或在「表字段」里选列。' };

      const leftCol =
        !leftIsField
          ? cd.leftNode?.label || src.columns[src.columns.length - 1]
          : cd.fieldLabel || cd.fieldKey || src.columns[0];

      let rightNum = NaN;
      let rightDesc = '';
      if (cd.valueSource === 'const') {
        rightNum = toNum(cd.value);
        rightDesc = `常量 ${cd.value}`;
      } else if (cd.valueSource === 'node') {
        const refOut = pickScalarOutput(outputs, incoming, cd.refNode?.nodeId);
        rightNum = scalarOf(refOut);
        rightDesc = `节点结果「${cd.refNode?.label || refOut?.scalar?.label || '基准值'}」=${Number.isFinite(rightNum) ? fmtNum(rightNum) : '—'}`;
      } else {
        rightDesc = `字段「${cd.refValue?.fieldLabel || cd.refValue?.fieldKey || '?'}」`;
      }
      const cmp = (a: number, b: number) => {
        switch (cd.operator) {
          case 'gt': return a > b;
          case 'gte': return a >= b;
          case 'lt': return a < b;
          case 'lte': return a <= b;
          case 'eq': return a === b;
          case 'neq': return a !== b;
          default: return false;
        }
      };
      const lo = toNum(cd.value);
      const hi = toNum(cd.valueMax);
      const emptyVal = (v: unknown) => v === '' || v === null || v === undefined || String(v).trim() === '';
      const numEq = (raw: unknown, v: string) => {
        if (v === '') return false;
        const n = toNum(v);
        const r = toNum(raw);
        if (Number.isFinite(n) && Number.isFinite(r)) return r === n;
        return String(raw ?? '') === v;
      };
      const hasConditions = !!(cd.conditions && cd.conditions.length);
      const join: 'and' | 'or' = cd.conditionJoin === 'or' ? 'or' : 'and';
      const matched = src.rows.filter((r) => {
        if (hasConditions) {
          const resolveCol = (item: NonNullable<ConditionNodeData['conditions']>[number], row: Record<string, unknown> | undefined) => {
            const col = item.col || item.colLabel || src.columns[0];
            if (row && Object.prototype.hasOwnProperty.call(row, col)) return row[col];
            // 列 key 与实际行 key 可能不一致（推断 key vs 节点输出列名），改按列名在 columns 中定位
            const idx = src.columns.indexOf(item.colLabel || item.col || col);
            const keys = Object.keys(row || {});
            const k = idx >= 0 ? keys[idx] : undefined;
            return k !== undefined ? row![k] : row![col];
          };
          const itemHit = (item: NonNullable<ConditionNodeData['conditions']>[number], raw: unknown): boolean => {
            const op = item.op || cd.operator;
            if (op === 'empty') return emptyVal(raw);
            if (op === 'notEmpty') return !emptyVal(raw);
            // 引用节点标量作右值（如基准统计的平均连带率 / 前 N% 平均值）
            if (item.refNode?.nodeId) {
              const refOut = pickScalarOutput(outputs, incoming, item.refNode.nodeId);
              const rn = scalarOf(refOut);
              const lv = toNum(raw);
              if (!Number.isFinite(lv) || !Number.isFinite(rn)) return false;
              switch (op) {
                case 'gt': return lv > rn;
                case 'gte': return lv >= rn;
                case 'lt': return lv < rn;
                case 'lte': return lv <= rn;
                case 'eq': return lv === rn;
                case 'neq': return lv !== rn;
                default: return false;
              }
            }
            let values = item.values && item.values.length ? item.values : [];
            if (!values.length && cd.value !== undefined && cd.value !== '') values = [cd.value];
            // 「空/0」同时匹配空值与 0
            const emptyHit = values.includes('') && (emptyVal(raw) || String(raw ?? '') === '0');
            let valHit = false;
            const cmpOps = op === 'gt' || op === 'gte' || op === 'lt' || op === 'lte';
            for (const v of values) {
              if (v === '') continue;
              if (op === 'contains') {
                if (String(raw ?? '').toLowerCase().includes(String(v).toLowerCase())) { valHit = true; break; }
              } else if (cmpOps) {
                const r = toNum(raw);
                const n = toNum(v);
                if (Number.isFinite(r) && Number.isFinite(n)) {
                  const hit =
                    op === 'gt' ? r > n :
                    op === 'gte' ? r >= n :
                    op === 'lt' ? r < n :
                    r <= n;
                  if (hit) { valHit = true; break; }
                }
              } else if (numEq(raw, v)) {
                valHit = true;
                break;
              }
            }
            if (op === 'neq') return !emptyHit && !valHit;
            return emptyHit || valHit;
          };
          const results = cd.conditions!.map((item) => itemHit(item, resolveCol(item, r)));
          return join === 'or' ? results.some(Boolean) : results.every(Boolean);
        }
        const raw = r[leftCol];
        const lv = toNum(raw);

        // 为空 / 不为空（不依赖右值）
        if (cd.operator === 'empty') return raw === '' || raw === null || raw === undefined || String(raw).trim() === '';
        if (cd.operator === 'notEmpty') return !(raw === '' || raw === null || raw === undefined || String(raw).trim() === '');

        // 包含（文本匹配）
        if (cd.operator === 'contains') {
          const needle = cd.valueSource === 'field'
            ? String(r[cd.refValue?.fieldLabel || cd.refValue?.fieldKey || ''] ?? '')
            : String(cd.value ?? '');
          return needle !== '' && String(raw ?? '').toLowerCase().includes(needle.toLowerCase());
        }

        // 区间（between / notBetween）
        if (cd.operator === 'between' || cd.operator === 'notBetween') {
          if (!Number.isFinite(lv) || !Number.isFinite(lo) || !Number.isFinite(hi)) return false;
          const inside = lv >= Math.min(lo, hi) && lv <= Math.max(lo, hi);
          return cd.operator === 'between' ? inside : !inside;
        }

        if (!Number.isFinite(lv)) return false;
        if (cd.valueSource === 'field') {
          // 字段对比：右值为另一字段（FieldRef），若来源列在同一结果里按列取，否则跳过
          const rv = toNum(r[cd.refValue?.fieldLabel || cd.refValue?.fieldKey || '']);
          return Number.isFinite(rv) && cmp(lv, rv);
        }
        return Number.isFinite(rightNum) && cmp(lv, rightNum);
      });
      const opLabel = OPERATOR_OPTIONS.find((o) => o.value === cd.operator)?.label ?? cd.operator;
      const condNote = hasConditions
        ? `判断（${join === 'or' ? '任一成立' : '全部成立'}）：` +
          cd
            .conditions!.map((c, i) => {
              const col = c.colLabel || c.col || leftCol;
              const opRef = c.op || cd.operator;
              const opN = OPERATOR_OPTIONS.find((o2) => o2.value === opRef)?.label || opRef;
              const vals = (c.values && c.values.length ? c.values : [])
                .map((v) => (v === '' ? '空' : String(v)))
                .join(' / ');
              return `${i + 1}.${col} ${opN}${vals ? ` ∈{${vals}}` : ''}`;
            })
            .join('；')
        : `条件：${leftCol} ${opLabel} ${rightDesc || (cd.operator === 'between' ? `${fmtNum(lo)} ~ ${fmtNum(hi)}` : '')}`;
      return {
        title: '判断',
        columns: src.columns,
        rows: cap(matched),
        shape: 'table',
        note: `${condNote}；命中 ${matched.length} 行（共 ${src.rows.length} 行）。`,
      };
    }

    case 'topn': {
      const nd = d as unknown as TopNNodeData;
      const rs = resolveRowset(
        {
          tableId: nd.tableId,
          source: (d as Record<string, unknown>).source as 'table' | 'node' | undefined,
          sourceNode: (d as Record<string, unknown>).sourceNode as string | undefined,
        },
        tables,
        byId,
        incoming,
      );
      if (!rs) return { title: '排名取数', columns: [], rows: [], note: '请选择数据表或上一步节点结果。' };
      const t = rs.t;
      const groupField = nd.groupField || t.fields.find((f) => f.type === 'string')?.key;
      const metricField = nd.metricField || t.fields.find((f) => f.type === 'number')?.key;
      if (!groupField || !metricField)
        return { title: '排名取数', columns: [], rows: [], note: '请选择分组维度与排名指标（需有文本分组列与数值指标列）。' };
      const srcAll = allRows(t);
      const rows0 = nd.dateField && nd.timeWindow ? srcAll.filter((r) => inWindow(r[nd.dateField || ''], nd.timeWindow)) : srcAll;
      const groups = new Map<string, number[]>();
      for (const r of rows0) {
        const k = String(r[groupField] ?? '');
        if (!k) continue;
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k)!.push(toNum(r[metricField]));
      }
      let arr = [...groups.entries()].map(([k, nums]) => ({ k, v: agg(nd.metricFn || 'sum', nums) }));
      arr.sort((a, b) => (nd.order === 'asc' ? a.v - b.v : b.v - a.v));
      arr = arr.slice(0, nd.topN || 1);
      const gLabel = nd.groupFieldLabel || groupField;
      const mLabel = nd.resultLabel || '指标';
      return {
        title: '排名取数',
        columns: [gLabel, mLabel],
        rows: cap(arr.map((x) => ({ [gLabel]: x.k, [mLabel]: fmtNum(x.v) }))),
        shape: 'table',
        note: `来自「${rs.from}」按「${gLabel}」分组${nd.metricFn || 'sum'}后${nd.order === 'asc' ? '升序' : '降序'}取前 ${nd.topN || 1} 名。`,
      };
    }

    case 'diff': {
      const dd = d as unknown as DiffNodeData;
      const baseRs = resolveRowset({ tableId: dd.baseTableId, source: 'table' }, tables, byId, incoming);
      const checkRs = resolveRowset({ tableId: dd.checkTableId, source: 'table' }, tables, byId, incoming);
      if (!baseRs || !checkRs)
        return { title: '反匹配排查', columns: [], rows: [], note: '请选择全集表与排查表。' };
      const u = baseRs.t;
      const c = checkRs.t;
      const baseField = dd.baseField || u.fields.find((f) => f.type === 'string')?.key;
      const checkField = dd.checkField || c.fields.find((f) => f.type === 'string')?.key;
      if (!baseField || !checkField)
        return { title: '反匹配排查', columns: [], rows: [], note: '请选择基准表关键字段与排查表关键字段。' };
      const baseRows = allRows(u);
      let checkRows = dd.dateField && dd.timeWindow ? allRows(c).filter((r) => inWindow(r[dd.dateField || ''], dd.timeWindow)) : allRows(c);
      // 取“排名取数(销量第一名款色)”节点输出的款色值，用于把排查表限定到该款色
      let fval = dd.filterValue ?? '';
      if (dd.filterValueSource === 'topn' || !fval) {
        const topn = incoming.find((o) => o.title === '排名取数' && o.rows.length > 0);
        const c0 = topn?.columns?.[0];
        if (topn && c0 && topn.rows[0]) fval = String(topn.rows[0][c0] ?? '');
      }
      if (dd.filterField && fval !== '') checkRows = checkRows.filter((r) => String(r[dd.filterField] ?? '') === fval);
      const matched = new Set(checkRows.map((r) => String(r[checkField] ?? '')));
      const seen = new Set<string>();
      const out: Record<string, string | number>[] = [];
      for (const r of baseRows) {
        const k = String(r[checkField] ?? '');
        if (matched.has(k) || seen.has(k)) continue;
        seen.add(k);
        out.push({ [baseField]: r[baseField] as string | number });
      }
      const dim = dd.filterFieldLabel || dd.filterField || '款色';
      const note =
        `${dd.checkTableName || '排查表'}${dd.filterField ? `中「${dim}」=` : ''}${dd.filterField && fval !== '' ? fval : ''}${dd.filterField ? '的' : ''}` +
        `在「${dd.baseTableName || '基准表'}」无匹配的项共 ${out.length} 项。`;
      return { title: '反匹配排查', columns: [baseField], rows: cap(out), shape: 'table', note };
    }

    case 'action': {
      const dA = d as unknown as ActionNodeData;
      const src =
        pickColumnOutput(outputs, incoming, dA.sourceNode?.nodeId) ||
        incoming.find((o) => o && o.columns.length > 0 && o.rows.length > 0);
      if (!src || !src.rows.length) {
        return { title: '预警动作', columns: [], rows: [], note: '规则终点：命中后触发通知/动作。请在动作配置中选择命中数据来源节点…', unsupported: true };
      }
      const renderMsg = (row: Record<string, string | number>): string => {
        const tpl = dA.content?.trim();
        if (!tpl) return '';
        return tpl.replace(/\{([^}]+)\}/g, (_, f: string) => {
          const v = String(row[f] ?? '');
          return v === 'undefined' ? '' : v;
        });
      };
      const title0 = (dA.title?.trim()) || '预警通知';
      const alertMessages = src.rows.slice(0, 50).map((row) => ({
        title: title0,
        content: renderMsg(row),
      }));
      return {
        title: '预警动作',
        columns: src.columns,
        rows: src.rows,
        shape: 'table',
        allCols: src.columns,
        note: `命中 ${src.rows.length} 行，将触发通知/动作。`,
        alertMessages,
      };
    }

    case 'compute': {
      const cd = d as unknown as ComputeNodeData;
      const expr = cd.expr;

      // 模式一：两个节点结果直接运算（如 已过天数 - 开单天数），无需字段聚合
      if (expr && expr.leftType === 'node') {
        const leftOut = expr.left ? byId(expr.left.nodeId) : undefined;
        const rightOut = expr.refType === 'const' ? undefined : (expr.ref ? byId(expr.ref.nodeId) : undefined);
        const leftLabel = expr.left?.label || '节点';
        const rightLabel =
          expr.refType === 'const' ? `常量 ${expr.constValue}` : (expr.ref?.label || '节点');
        const sym = arithSymbol(expr.op);
        const label = cd.resultLabel || `${leftLabel} ${sym} ${rightLabel}`;

        // 判断操作数是否为"逐行明细"输出（如分组聚合出的"店仓+开单天数"）。
        // 注意：标量节点(已过天数等)也有"统计项/数值"展示行，必须用 shape==='table' 区分。
        const isTable = (o?: NodePreview): boolean => !!o && o.shape === 'table' && o.rows.length > 0;
        const leftIsCol = isTable(leftOut);
        const rightIsCol = isTable(rightOut);
        const rightConst = expr.refType === 'const' ? toNum(expr.constValue) : NaN;

        // 若某一侧为逐行明细（表），则以该表为主表逐行运算（另一侧作为常数）。
        // 两侧都是表时，优先以左表为主表逐行（右表取首值作常数）。
        const mainIsLeft = leftIsCol || !rightIsCol;
        const main = mainIsLeft ? leftOut : rightOut;
        if (main && isTable(main)) {
          // 结构化（点选式）表达式：token 序列优先，逐行安全求值
          const tokens = Array.isArray(expr.tokens) ? (expr.tokens as ExprToken[]) : [];
          if (tokens.some((t) => t.kind === 'field')) {
            const resultRows = main.rows.map((r) => {
              const v = evalRowTokens(tokens, r);
              const out: Record<string, string | number> = { ...r };
              out[label] = Number.isFinite(v) ? fmtNum(v) : '—';
              return out;
            });
            return {
              title: '计算结果',
              columns: [...main.columns, label],
              rows: resultRows,
              shape: 'table' as const,
              note: `组合公式：${tokensToText(tokens)} → ${label}`,
            };
          }
          // 自由文本表达式：用户直接用该表列名写公式（如 "数量/(数量+库存汇总)"），逐行安全求值
          const exprText = String((expr.exprText || '')).trim();
          if (exprText) {
            // 组合表达式：保留左节点主表「全部列」（店仓/款色/数量/库存…），再追加结果列（售罄率）
            const resultRows = main.rows.map((r) => {
              const v = evalRowFormula(exprText, r, main.columns);
              const out: Record<string, string | number> = { ...r };
              out[label] = Number.isFinite(v) ? fmtNum(v) : '—';
              return out;
            });
            return {
              title: '计算结果',
              columns: [...main.columns, label],
              rows: resultRows,
              shape: 'table',
              note: `组合公式：${exprText}`,
            };
          }
          // 同一节点结果内的两列逐行运算（如 售罄率 = 店铺成交 ÷ 库存数量）
          const aCol = mainIsLeft ? expr.left?.col : expr.ref?.col;
          const bCol = mainIsLeft ? expr.ref?.col : expr.left?.col;
          const sameNode =
            expr.leftType === 'node' &&
            expr.refType === 'node' &&
            !!expr.left?.nodeId &&
            expr.left.nodeId === expr.ref?.nodeId;
          if (sameNode && aCol && bCol && aCol !== bCol &&
              main.rows.some((r) => Number.isFinite(toNum(r[aCol]!))) &&
              main.rows.some((r) => Number.isFinite(toNum(r[bCol]!)))) {
            const keyCols = main.columns.filter(
              (c) => c !== aCol && c !== bCol && !main.rows.some((r) => Number.isFinite(toNum(r[c]))),
            );
            const resultRows = main.rows.map((r) => {
              const v = arith(expr.op, toNum(r[aCol!]), toNum(r[bCol!]));
              const out: Record<string, string | number> = {};
              keyCols.forEach((c) => { out[c] = r[c]; });
              out[label] = Number.isFinite(v) ? fmtNum(v) : '—';
              return out;
            });
            return {
              title: '计算',
              columns: [...keyCols, label],
              rows: resultRows,
              shape: 'table' as const,
              note: `对「${leftLabel}」逐行：${aCol} ${sym} ${bCol} → ${label}（共 ${resultRows.length} 行）`,
            };
          }
          // 主表中逐行取"数值列"：即每行第一个能解析为数字的列（开单天数等）
          const otherConst = mainIsLeft
            ? (expr.refType === 'const' ? rightConst : nodeRefScalarVal(rightOut))
            : nodeRefScalarVal(leftOut);
          const outCols = main.columns;
          const keyCols = main.columns.filter((c) => {
            const anyNum = main.rows.some((r) => Number.isFinite(toNum(r[c])));
            return !anyNum;
          });
          const explicitCol = mainIsLeft ? expr.left?.col : expr.ref?.col;
          const rowCol = explicitCol && main.columns.includes(explicitCol) ? explicitCol : undefined;
          const pickRowVal = (r: Record<string, unknown>): number => {
            if (rowCol) {
              const v = toNum(r[rowCol]);
              if (Number.isFinite(v)) return v;
            }
            for (const c of outCols) {
              const v = toNum(r[c]);
              if (Number.isFinite(v)) return v;
            }
            return NaN;
          };
          const resultRows = main.rows.map((r) => {
            const rowVal = pickRowVal(r);
            const a = mainIsLeft ? rowVal : otherConst;
            const b = mainIsLeft ? otherConst : rowVal;
            const v = arith(expr.op, a, b);
            const out: Record<string, string | number> = {};
            keyCols.forEach((c) => { out[c] = r[c]; });
            out[label] = Number.isFinite(v) ? fmtNum(v) : '—';
            return out;
          });
          const firstVal = (() => {
            const v0 = pickRowVal(main.rows[0]);
            if (Number.isFinite(v0)) {
              return arith(expr.op, mainIsLeft ? v0 : otherConst, mainIsLeft ? otherConst : v0);
            }
            return NaN;
          })();
          const finalCols = keyCols.includes(label) ? keyCols : [...keyCols, label];
          return {
            title: '计算',
            columns: finalCols,
            rows: resultRows,
            shape: 'table' as const,
            scalar: Number.isFinite(firstVal) ? { label, value: String(firstVal), kind: 'column' as const, col: label } : undefined,
            note: `节点间运算：以「${mainIsLeft ? leftLabel : rightLabel}」的每一行，用 ${leftLabel} ${sym} ${rightLabel} 逐行计算，得到结果列「${label}」（共 ${resultRows.length} 行）。`,
          };
        }

        const leftVal = nodeRefScalarVal(leftOut);
        const rightVal = expr.refType === 'const' ? rightConst : nodeRefScalarVal(rightOut);
        const finalVal = arith(expr.op, leftVal, rightVal);
        const lv = Number.isFinite(leftVal) ? fmtNum(leftVal) : '空';
        const rv = Number.isFinite(rightVal) ? fmtNum(rightVal) : '空';
        const note = Number.isFinite(finalVal)
          ? `节点间运算：「${leftLabel}」(${lv}) ${sym} 「${rightLabel}」(${rv}) = ${fmtNum(finalVal)}。`
          : `节点间运算：「${leftLabel}」(${lv}) ${sym} 「${rightLabel}」(${rv}) 无法计算，请确认两个节点都已配置并产出数值。`;
        return {
          title: '计算',
          columns: ['统计项', '数值'],
          rows: [{ 统计项: label, 数值: Number.isFinite(finalVal) ? fmtNum(finalVal) : '—' }],
          shape: 'scalar' as const,
          scalar: { label, value: Number.isFinite(finalVal) ? String(finalVal) : '', kind: 'scalar' as const },
          note,
        };
      }

      // 模式二：字段聚合（可选再与节点/常量做二次运算）
      const rs = resolveRowset(
        {
          tableId: cd.tableId,
          source: (d as Record<string, unknown>).source as 'table' | 'node' | undefined,
          sourceNode: (d as Record<string, unknown>).sourceNode as string | undefined,
        },
        tables,
        byId,
        incoming,
      );
      if (!rs) return { title: '计算', columns: [], rows: [], note: '请选择数据表或上一步节点结果，并选择计算字段；或在下方选择"两个节点结果运算"。' };
      const t = rs.t;
      const fieldKey = cd.fieldKey || t.fields.find((f) => f.type === 'number')?.key;
      if (!fieldKey) return { title: '计算', columns: [], rows: [], note: '未找到可参与计算的数值字段，请选择计算字段。' };
      const dateKey = cd.dateField || t.fields.find((f) => f.type === 'date')?.key || '';
      const srcRows = allRows(t);
      const rows0 = dateKey && cd.timeWindow ? srcRows.filter((r) => inWindow(r[dateKey], cd.timeWindow)) : srcRows;
      const fn = cd.fn || 'sum';
      let baseVal: number;
      if (fn === 'activeDays') {
        baseVal = aggActiveDays(rows0, dateKey, fieldKey);
      } else if (fn === 'countDistinct') {
        baseVal = aggCountDistinct(rows0.map((r) => r[fieldKey]));
      } else {
        baseVal = agg(fn, rows0.map((r) => toNum(r[fieldKey])));
      }
      const fLabel = cd.fieldLabel || fieldKey;
      const fnLabel = fn === 'activeDays' ? '开单天数' : fn === 'countDistinct' ? '去重计数' : fn === 'sum' ? '求和' : fn === 'avg' ? '平均' : fn === 'count' ? '计数' : fn === 'max' ? '最大' : fn === 'min' ? '最小' : fn;
      const winLabel = cd.timeWindow ? (() => { const w = resolveTimeWindow(cd.timeWindow); return w.label; })() : '全量';
      let finalVal = baseVal;
      let finalNote = `在「${rs.from}」中按 ${winLabel} 求「${fLabel}」${fnLabel} = ${fmtNum(baseVal)}。`;
      if (expr) {
        const refVal = expr.refType === 'const' ? toNum(expr.constValue) : nodeRefScalarVal(expr.ref ? byId(expr.ref.nodeId) : undefined);
        const opLabel = arithSymbol(expr.op);
        const refLabel =
          expr.refType === 'const'
            ? `常量 ${expr.constValue}`
            : `节点「${expr.ref?.label || '上一步'}」=${Number.isFinite(refVal) ? fmtNum(refVal) : '空'}`;
        if (Number.isFinite(refVal)) {
          finalVal =
            expr.order === 'ref_first'
              ? arith(expr.op, refVal, baseVal)
              : arith(expr.op, baseVal, refVal);
          const selfFirst = expr.order !== 'ref_first';
          finalNote = `${finalNote} 再与${refLabel}运算：${selfFirst ? fmtNum(baseVal) : fmtNum(refVal)} ${opLabel} ${selfFirst ? fmtNum(refVal) : fmtNum(baseVal)} → ${fmtNum(finalVal)}。`;
        } else {
          finalNote = `${finalNote} 再与${refLabel}运算：引用值无法解析为数字，结果保留聚合值。`;
        }
      }
      const label = cd.resultLabel || `${fnLabel}(${fLabel})`;
      return {
        title: '计算',
        columns: ['统计项', '数值'],
        rows: [{ 统计项: label, 数值: Number.isFinite(finalVal) ? fmtNum(finalVal) : '—' }],
        scalar: { label, value: Number.isFinite(finalVal) ? String(finalVal) : '' },
        note: finalNote,
      };
    }

    case 'relation':
      return { title: '关联', columns: [], rows: [], note: '关联节点：按关联字段在两表间匹配（预览以配置为准）。', unsupported: true };

    case 'logic': {
      const ld = d as unknown as { logic?: 'and' | 'or' | 'if' | string };
      const inc = incoming.filter((o): o is NodePreview => !!o && o.rows.length > 0 && !o.unsupported);
      const cols = inc[0]?.columns ?? [];
      if (inc.length === 0) {
        return { title: '逻辑关联', columns: [], rows: [], note: '组合多个条件（且/或）。等待上游命中行…', unsupported: true };
      }
      const rowKey = (r: Record<string, unknown>) => JSON.stringify(r);
      try {
        if (ld.logic === 'or') {
          const m = new Map<string, Record<string, string | number>>();
          inc.forEach((o) => o.rows.forEach((r) => m.set(rowKey(r), r as Record<string, string | number>)));
          const rows = [...m.values()];
          return { title: '逻辑关联', columns: cols, rows, shape: 'table', allCols: cols, note: `并集：任一条件命中，共 ${rows.length} 行。` };
        }
        // and / if / 默认：取交集（全部条件同时命中）
        const base = inc[0].rows.map(rowKey);
        const rows = base
          .filter((k) => inc.every((o) => o.rows.some((r) => rowKey(r) === k)))
          .map((k) => JSON.parse(k) as Record<string, string | number>);
        return { title: '逻辑关联', columns: cols, rows, shape: 'table', allCols: cols, note: `交集：全部条件命中，共 ${rows.length} 行。` };
      } catch {
        return { title: '逻辑关联', columns: [], rows: [], note: '逻辑组合失败', unsupported: true };
      }
    }

    default:
      return { title: '节点', columns: [], rows: [], note: '该节点暂不支持逐行预览。', unsupported: true };
  }
}

/** 收集一个节点 data 里显式引用的上游节点 id（作为拓扑依赖，不依赖连线） */
function collectNodeDataRefs(node: FlowNode): string[] {
  const d = (node.data ?? {}) as unknown as Record<string, unknown>;
  const refs: string[] = [];
  const push = (v: unknown) => {
    if (typeof v === 'string' && v) refs.push(v);
    else if (v && typeof v === 'object' && typeof (v as { nodeId?: unknown }).nodeId === 'string') {
      refs.push((v as { nodeId: string }).nodeId);
    }
  };
  push(d.sourceNode as unknown);
  push(d.factNode as unknown);
  push(d.universeNodeId as unknown);
  push(d.refNode as unknown);
  push(d.leftNode as unknown);
  push((d.left as { nodeId?: unknown } | null | undefined)?.nodeId);
  push((d.right as { nodeId?: unknown } | null | undefined)?.nodeId);
  push((d.ref as { nodeId?: unknown } | null | undefined)?.nodeId);
  return refs.filter(Boolean);
}

/** 按拓扑顺序求值所有节点 */
export function evaluateFlow(nodes: FlowNode[], edges: FlowEdge[], tables: DataTable[]): OutputMap {
  // 兼容 ReactFlow 实例节点（type 字段）与内部 FlowNode（kind 字段）
  const normNodes = (nodes as unknown as AnyNodeLike[]).map(normalizeNode);
  const normEdges = (edges as unknown as AnyEdgeLike[]).map(normalizeEdge);
  const outputs: OutputMap = {};
  const remaining = [...normNodes];
  let guard = 0;
  while (remaining.length && guard < normNodes.length + 5) {
    guard += 1;
    const ready = remaining.filter((n) => {
      // 连线依赖（入边必须已就绪；若源节点不在图中则忽略）
      const edgeOk = normEdges
        .filter((e) => e.target === n.id)
        .every((e) => outputs[e.source] !== undefined || !normNodes.some((x) => x.id === e.source));
      // 引用依赖（data 里的 sourceNode/factNode/universeNodeId 等必须已就绪）
      const refOk = collectNodeDataRefs(n).every((rid) => outputs[rid] !== undefined || !normNodes.some((x) => x.id === rid));
      return edgeOk && refOk;
    });
    if (!ready.length) {
      // 环或缺失，剩余的直接求值
      for (const n of remaining) outputs[n.id] = safeEval(n, normNodes, normEdges, tables, outputs);
      break;
    }
    for (const n of ready) {
      outputs[n.id] = safeEval(n, normNodes, normEdges, tables, outputs);
      remaining.splice(remaining.indexOf(n), 1);
    }
  }
  return outputs;
}

function safeEval(
  node: FlowNode,
  nodes: FlowNode[],
  edges: FlowEdge[],
  tables: DataTable[],
  outputs: OutputMap,
): NodePreview {
  try {
    return evalNode(node, nodes, edges, tables, outputs);
  } catch (err) {
    return {
      title: '预览出错',
      columns: [],
      rows: [],
      note: `计算预览时出错：${err instanceof Error ? err.message : String(err)}`,
      unsupported: true,
    };
  }
}
