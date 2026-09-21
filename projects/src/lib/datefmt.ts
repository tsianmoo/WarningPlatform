/** 日期格式配置：字段被设为「日期」时，可选原始值的解析格式，统一输出为标准日期 yyyy-MM-dd */
export interface DateFormatOption {
  value: string;
  label: string;
}

export const DATE_FORMATS: DateFormatOption[] = [
  { value: '', label: '自动识别' },
  { value: 'yyyyMMdd', label: 'yyyyMMdd（如 20260101）' },
  { value: 'yyyy-MM-dd', label: 'yyyy-MM-dd' },
  { value: 'yyyy/MM/dd', label: 'yyyy/MM/dd' },
  { value: 'yyyy.MM.dd', label: 'yyyy.MM.dd' },
  { value: 'yyyyMMddHHmmss', label: 'yyyyMMddHHmmss' },
  { value: 'yyyy-MM-dd HH:mm:ss', label: 'yyyy-MM-dd HH:mm:ss' },
  { value: 'yyyy年MM月dd日', label: 'yyyy年MM月dd日' },
  { value: 'ts_ms', label: '时间戳（毫秒）' },
  { value: 'ts_s', label: '时间戳（秒）' },
];

/** 按指定 token 格式把原始值解析为 Date；解析失败返回 null */
export function parseByFormat(v: unknown, fmt: string): Date | null {
  if (v == null || v === '' || !fmt) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  const s = String(v).trim();
  if (!s) return null;

  const ymd = (y: number, mo: number, d: number, h = 0, mi = 0, se = 0) => {
    const dt = new Date(y, mo - 1, d, h, mi, se);
    return Number.isNaN(dt.getTime()) ? null : dt;
  };

  if (fmt === 'ts_ms' || fmt === 'ts_s') {
    const n = Number(s);
    if (!Number.isFinite(n) || n <= 0) return null;
    const t = fmt === 'ts_s' ? n * 1000 : n;
    const d = new Date(t);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const pad = (re: RegExp, ...idx: number[]): number[] | null => {
    const m = s.match(re);
    if (!m) return null;
    return idx.map((i) => Number(m[i] ?? 0));
  };

  let p: number[] | null = null;
  if (fmt === 'yyyyMMdd') p = pad(/^(\d{4})(\d{2})(\d{2})$/, 1, 2, 3);
  else if (fmt === 'yyyy-MM-dd') p = pad(/^(\d{4})-(\d{1,2})-(\d{1,2})/, 1, 2, 3);
  else if (fmt === 'yyyy/MM/dd') p = pad(/^(\d{4})\/(\d{1,2})\/(\d{1,2})/, 1, 2, 3);
  else if (fmt === 'yyyy.MM.dd') p = pad(/^(\d{4})\.(\d{1,2})\.(\d{1,2})/, 1, 2, 3);
  else if (fmt === 'yyyyMMddHHmmss') p = pad(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/, 1, 2, 3, 4, 5, 6);
  else if (fmt === 'yyyy-MM-dd HH:mm:ss') p = pad(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:\s+(\d{1,2}):(\d{1,2}):(\d{1,2}))?/, 1, 2, 3, 4, 5, 6);
  else if (fmt === 'yyyy年MM月dd日') p = pad(/^(\d{4})年(\d{1,2})月(\d{1,2})日/, 1, 2, 3);

  if (!p) return null;
  const [y, mo, d, h = 0, mi = 0, se = 0] = p;
  if (y < 1900 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return ymd(y, mo, d, h, mi, se);
}

/** 标准化输出：yyyy-MM-dd */
export function toStdDateStr(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}