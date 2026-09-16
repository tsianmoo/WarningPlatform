import cronParser from 'cron-parser';

type CronIter = { next(): { toDate(): Date }; prev(): { getTime(): number } };
// cron-parser 真实入口是其静态 parse 方法（类型声明不完整，这里显式取出，兼容 default 与命名两种导出形态）
const parseExpression: (expr: string, opts?: { tz?: string; currentDate?: Date }) => CronIter =
  (cronParser as any)?.CronExpressionParser?.parse || (cronParser as any)?.CronExpressionParser || (cronParser as any)?.parse;

/** 归一化 Quartz 风格表达式：7 位时去掉最后的“年”字段；`?` 保留（cron-parser 在日/周域原生支持） */
function normalizeCron(expr: string): string {
  const parts = expr.trim().split(/\s+/);
  if (parts.length === 7) parts.pop();
  return parts.join(' ');
}

export interface CronMatch {
  isValid: boolean;
  error?: string;
  nextRuns?: number[]; // 未来 5 次执行时间戳（当地时区）
}

/** 解析 cron 表达式并计算未来 n 次执行时间（5/6/7 位均尝试） */
export function parseCron(expr: string, timezone?: string): CronMatch {
  const e = normalizeCron(expr);
  try {
    const iter = parseExpression(e, { tz: timezone || undefined, currentDate: new Date() });
    const nextRuns: number[] = [];
    for (let i = 0; i < 5; i++) {
      nextRuns.push(iter.next().toDate().getTime());
    }
    return { isValid: true, nextRuns };
  } catch {
    return { isValid: false, error: '无效的 Cron 表达式（支持 5/6/7 位）' };
  }
}

/** 判断某个时刻是否命中 cron（用于调度 tick）。退化为分钟级匹配。 */
export function cronMatches(expr: string, date: Date, timezone?: string): boolean {
  try {
    const iter = parseExpression(normalizeCron(expr), { tz: timezone || undefined, currentDate: date });
    // 检查当前分钟是否在表达式域内：对比前一个与自身
    const prev = iter.prev().getTime();
    const nowMs = date.getTime();
    const diff = Math.abs(nowMs - prev);
    return diff < 60_000; // 命中到上一分钟内的某个调度点
  } catch {
    return false;
  }
}

/** 给定起始时间，计算未来 count 次执行时间戳（毫秒） */
export function cronNextTimes(expr: string, timezone: string | undefined, from: Date, count: number): Date[] {
  try {
    const iter = parseExpression(normalizeCron(expr), { tz: timezone || undefined, currentDate: from });
    const out: Date[] = [];
    for (let i = 0; i < count; i++) out.push(iter.next().toDate());
    return out;
  } catch {
    return [];
  }
}

/** 计算「自然日日期分表」变量的常用格式 */
export function todayStr(): string {
  const d = new Date();
  return formatDate(d);
}
export function yesterdayStr(): string {
  const d = new Date(Date.now() - 86400_000);
  return formatDate(d);
}
export function monthStr(): string {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function formatDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 将 ${var} 占位符渲染为字面量 SQL（带正确引号），并返回可读的展示 SQL */
export function renderSql(sql: string, values: Record<string, unknown>): { sql: string; display: string } {
  const bindLeak: Record<string, unknown> = {};
  const display = sql.replace(/\$\{([^}]+)\}/g, (_, key: string) => {
    const name = key.trim();
    bindLeak[name] = values[name];
    const raw = String(values[name] ?? '');
    return quoteLiteral(raw);
  });
  return { sql: display, display };
}

/** 字面量安全引用（用于把参数/水位渲染进 SQL） */
export function quoteLiteral(v: unknown): string {
  if (v == null) return 'NULL';
  if (typeof v === 'number') return String(v);
  if (v instanceof Date) return `TO_TIMESTAMP('${toOraTs(v)}','YYYY-MM-DD HH24:MI:SS')`;
  const s = String(v).replace(/'/g, "''");
  // 若是纯数字当作数字
  if (/^-?\d+(\.\d+)?$/.test(s)) return s;
  return `'${s}'`;
}

export function toOraTs(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

/** 内置变量解析（参数值里可引用） */
export function resolveBuiltin(name: string): string {
  const n = name.toUpperCase();
  const map: Record<string, string> = {
    TODAY: todayStr(),
    YESTERDAY: yesterdayStr(),
    NOW: toOraTs(new Date()),
    YYYYMM: monthStr(),
    YYYY: String(new Date().getFullYear()),
    MM: String(new Date().getMonth() + 1).padStart(2, '0'),
    DD: String(new Date().getDate()).padStart(2, '0'),
  };
  return map[n] ?? '';
}