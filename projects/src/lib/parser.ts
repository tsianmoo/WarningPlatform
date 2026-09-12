import * as XLSX from 'xlsx';
import Papa from 'papaparse';
import type { FieldType, TableField } from './types';

export const TAG_COLORS = [
  '#3B82F6',
  '#8B5CF6',
  '#06B6D4',
  '#F59E0B',
  '#10B981',
  '#EC4899',
  '#EF4444',
  '#64748B',
];

type ParsedResult = { rows: Record<string, unknown>[] };

function inferFieldType(samples: string[]): FieldType {
  const vals = samples.filter((v) => v != null && v !== '').slice(0, 30);
  if (vals.length === 0) return 'string';
  let dateCount = 0;
  let numCount = 0;
  for (const v of vals) {
    if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(v) || /^\d{1,2}[-/]\d{1,2}[-/]\d{4}/.test(v)) dateCount++;
    else if (v !== '' && !isNaN(Number(v))) numCount++;
  }
  if (dateCount / vals.length > 0.5) return 'date';
  if (numCount / vals.length > 0.8) return 'number';
  return 'string';
}

/** 将任意行对象数组解析为字段定义 + 预览行 + 全量行 */
export function buildTableFromRows(rows: Record<string, unknown>[]): {
  fields: TableField[];
  previewRows: Record<string, string>[];
  rowCount: number;
  rows?: Record<string, string | number | boolean>[];
} {
  const keys = Object.keys(rows[0] || {});
  const fields: TableField[] = keys.map((k, i) => {
    const samples = rows.map((r) => String(r[k] ?? ''));
    return {
      key: k,
      alias: k, // 默认别名等于列名，可后续标签化
      type: inferFieldType(samples),
      tagColor: TAG_COLORS[i % TAG_COLORS.length],
      sample: samples.find((s) => s !== '') ?? '',
    };
  });
  const previewRows = rows.slice(0, 50).map((r) => {
    const o: Record<string, string> = {};
    for (const k of keys) o[k] = String(r[k] ?? '');
    return o;
  });
  // 全量行：保留数字为 number 以便聚合计算，其余转字符串
  const fullRows = rows.map((r) => {
    const o: Record<string, string | number | boolean> = {};
    for (const k of keys) {
      const v = r[k];
      o[k] = typeof v === 'number' && !Number.isNaN(v) ? (v as number) : typeof v === 'boolean' ? (v as boolean) : String(v ?? '');
    }
    return o;
  });
  return { fields, previewRows, rowCount: rows.length, rows: fullRows };
}

/** 补齐表格 fields：若 rows 中出现但 fields 缺失的列，追加到尾部（兼容旧字段快照） */
export function ensureFieldsComplete(fields: TableField[], rows: Record<string, unknown>[]): TableField[] {
  const first = rows[0];
  if (!first) return fields;
  const known = new Set(fields.map((f) => f.key));
  const keys = Object.keys(first);
  const next = [...fields];
  keys.forEach((k, i) => {
    if (known.has(k)) return;
    const samples = rows.map((r) => String(r[k] ?? ''));
    next.push({
      key: k,
      alias: k,
      type: inferFieldType(samples),
      tagColor: TAG_COLORS[next.length % TAG_COLORS.length],
      sample: samples.find((s) => s !== '') ?? '',
    });
  });
  return next;
}

/** 解析 Excel 文件 */
export async function parseExcel(file: File): Promise<ParsedResult> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });
  return { rows: json };
}

/** 解析 CSV 文件（兼容 UTF-8 / GBK） */
export async function parseCsv(file: File): Promise<ParsedResult> {
  const text = await readTextSmart(file);
  const res = Papa.parse<Record<string, unknown>>(text, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: false,
  });
  return { rows: res.data.filter((r) => Object.values(r).some((v) => v != null && v !== '')) };
}

async function readTextSmart(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  // 尝试 UTF-8（带BOM则去除）
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(bytes.subarray(3));
  }
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return text;
  } catch {
    // fallback: try windows-1252/gbk 解码，使用 TextDecoder label ('gbk' 在多数引擎支持)
    try {
      return new TextDecoder('gbk').decode(bytes);
    } catch {
      return new TextDecoder('utf-8').decode(bytes);
    }
  }
}

/** 根据文件扩展名解析任意表格文件 */
export async function parseTableFile(file: File): Promise<ParsedResult> {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (['xlsx', 'xls', 'xlsm'].includes(ext)) return parseExcel(file);
  if (['csv', 'txt', 'tsv'].includes(ext)) return parseCsv(file);
  // 未知类型，尝试按 Excel 读，失败再按 csv
  try {
    return await parseExcel(file);
  } catch {
    return parseCsv(file);
  }
}

/** 内置示例数据（确保首次体验即可用） */
export function buildSampleTable(): ReturnType<typeof buildTableFromRows> {
  const rows = [
    { orderId: 'SO-1001', customer: '华东销售一部', amount: 35600, status: '待审核', department: '销售部', recordedAt: '2025-01-05' },
    { orderId: 'SO-1002', customer: '华南运营组', amount: 128000, status: '已发货', department: '运营部', recordedAt: '2025-01-06' },
    { orderId: 'SO-1003', customer: '西南风控组', amount: 7200, status: '待审核', department: '风控部', recordedAt: '2025-01-07' },
    { orderId: 'SO-1004', customer: '华北数据组', amount: 95000, status: '异常', department: '数据部', recordedAt: '2025-01-08' },
    { orderId: 'SO-1005', customer: '东北安全组', amount: 42100, status: '已发货', department: '安全部', recordedAt: '2025-01-09' },
    { orderId: 'SO-1006', customer: '华南运营组', amount: 83000, status: '异常', department: '运营部', recordedAt: '2025-01-10' },
    { orderId: 'SO-1007', customer: '华东销售二部', amount: 1500, status: '待审核', department: '销售部', recordedAt: '2025-01-11' },
    { orderId: 'SO-1008', customer: '西南风控组', amount: 64200, status: '已发货', department: '风控部', recordedAt: '2025-01-12' },
  ];
  return buildTableFromRows(rows);
}