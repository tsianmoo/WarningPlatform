import type { ResolvedCompare, TimePreset, TimeUnit, TimeWindow } from '@/lib/types';

export const TIME_PRESETS: {
  value: TimePreset;
  label: string;
  group: 'point' | 'recent' | 'week' | 'month' | 'quarter' | 'year' | 'fixed';
}[] = [
  { value: 'all', label: '不限日期', group: 'fixed' },
  { value: 'today', label: '今天', group: 'point' },
  { value: 'yesterday', label: '昨天', group: 'point' },
  { value: 'dayBefore', label: '前天', group: 'point' },
  { value: 'recent3', label: '近3天', group: 'recent' },
  { value: 'recent7', label: '近7天', group: 'recent' },
  { value: 'recent14', label: '近14天', group: 'recent' },
  { value: 'recent30', label: '近30天', group: 'recent' },
  { value: 'thisWeek', label: '本周', group: 'week' },
  { value: 'weekToDate', label: '本周至今', group: 'week' },
  { value: 'lastWeek', label: '上周', group: 'week' },
  { value: 'twoWeeksAgo', label: '上上周', group: 'week' },
  { value: 'thisMonth', label: '本月', group: 'month' },
  { value: 'monthToDate', label: '本月至今', group: 'month' },
  { value: 'lastMonth', label: '上月', group: 'month' },
  { value: 'twoMonthsAgo', label: '上上月', group: 'month' },
  { value: 'thisQuarter', label: '本季', group: 'quarter' },
  { value: 'quarterToDate', label: '本季至今', group: 'quarter' },
  { value: 'thisYear', label: '本年', group: 'year' },
  { value: 'yearToDate', label: '本年至今', group: 'year' },
  { value: 'specificMonth', label: '指定月份', group: 'fixed' },
];

export const TIME_UNIT_OPTIONS: { value: TimeUnit; label: string }[] = [
  { value: 'day', label: '天' },
  { value: 'week', label: '周' },
  { value: 'month', label: '月' },
];

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const getMonday = (d: Date) => {
  const s = startOfDay(d);
  const day = s.getDay() || 7; // 周日=0→7
  return addDays(s, 1 - day);
};
const startOfQuarter = (d: Date) => new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3, 1);

const fmt = (d: Date) =>
  `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;

export interface CompareWindow {
  /** 对比周期名（如：上月 / 去年同期 / 环比上月） */
  label: string;
  /** 对比区间起 */
  start: Date;
  /** 对比区间止 */
  end: Date;
}

export interface ResolvedTimeWindow {
  start: Date;
  end: Date;
  label: string;
  hint: string;
  /** 同期/环期对比区间（可选） */
  compare?: CompareWindow;
}

/** 解析时间窗口为具体起止日期与展示文本 */
export function resolveTimeWindow(tw: TimeWindow, now = new Date()): ResolvedTimeWindow {
  let start: Date;
  let end: Date = now;
  let label = '';

  const preset: TimePreset = tw?.preset || 'thisWeek';
  const unitDays = (u?: TimeUnit) => (u === 'week' ? 7 : u === 'month' ? 30 : 1);

  switch (preset) {
    case 'all':
      start = new Date(0);
      end = new Date(8640000000000000);
      label = '不限日期';
      break;
    case 'today':
      start = startOfDay(now);
      label = '今天';
      break;
    case 'yesterday':
      start = startOfDay(addDays(now, -1));
      end = addDays(now, -1);
      label = '昨天';
      break;
    case 'dayBefore':
      start = startOfDay(addDays(now, -2));
      end = addDays(now, -2);
      label = '前天';
      break;
    case 'recent3':
      start = startOfDay(addDays(now, -2));
      label = '近3天';
      break;
    case 'recent7':
      start = startOfDay(addDays(now, -6));
      label = '近7天';
      break;
    case 'recent14':
      start = startOfDay(addDays(now, -13));
      label = '近14天';
      break;
    case 'recent30':
      start = startOfDay(addDays(now, -29));
      label = '近30天';
      break;
    case 'thisWeek': {
      start = getMonday(now);
      end = addDays(start, 6);
      label = '本周';
      break;
    }
    case 'lastWeek': {
      start = addDays(getMonday(now), -7);
      end = addDays(start, 6);
      label = '上周';
      break;
    }
    case 'twoWeeksAgo': {
      start = addDays(getMonday(now), -14);
      end = addDays(start, 6);
      label = '上上周';
      break;
    }
    case 'weekToDate': {
      start = getMonday(now);
      end = startOfDay(now);
      label = '本周至今';
      break;
    }
    case 'thisQuarter': {
      start = startOfQuarter(now);
      end = new Date(start.getFullYear(), start.getMonth() + 3, 0);
      label = '本季';
      break;
    }
    case 'quarterToDate': {
      start = startOfQuarter(now);
      end = startOfDay(now);
      label = '本季至今';
      break;
    }
    case 'thisYear':
      start = new Date(now.getFullYear(), 0, 1);
      end = new Date(now.getFullYear(), 11, 31);
      label = '本年';
      break;
    case 'yearToDate': {
      start = new Date(now.getFullYear(), 0, 1);
      end = startOfDay(now);
      label = '本年至今';
      break;
    }
    case 'thisMonth':
      start = new Date(now.getFullYear(), now.getMonth(), 1);
      end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      label = '本月';
      break;
    case 'monthToDate': {
      start = new Date(now.getFullYear(), now.getMonth(), 1);
      end = startOfDay(now);
      label = '本月至今';
      break;
    }
    case 'lastMonth':
      start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      end = new Date(now.getFullYear(), now.getMonth(), 0);
      label = '上月';
      break;
    case 'twoMonthsAgo':
      start = new Date(now.getFullYear(), now.getMonth() - 2, 1);
      end = new Date(now.getFullYear(), now.getMonth() - 1, 0);
      label = '上上月';
      break;
    case 'specificMonth': {
      const m = tw?.month;
      let y = now.getFullYear();
      let mo = now.getMonth();
      if (m && /^\d{4}-\d{2}$/.test(m)) {
        const [ys, ms] = m.split('-');
        y = Number(ys);
        mo = Number(ms) - 1;
      }
      start = new Date(y, mo, 1);
      end = new Date(y, mo + 1, 0);
      label = `${y}年${mo + 1}月`;
      break;
    }
    case 'custom':
    default: {
      const v = Math.max(1, Math.floor(tw?.custom?.value ?? 7));
      const u = tw?.custom?.unit ?? 'day';
      start = startOfDay(addDays(now, -(v - 1) * unitDays(u)));
      label = `近${v}` + (u === 'day' ? '天' : u === 'week' ? '周' : '月');
      break;
    }
  }

  if (preset === 'all') return { start, end, label, hint: '不限日期' };

  const sameDay = start.getTime() === end.getTime();
  const hint = sameDay
    ? fmt(start)
    : `${fmt(start)} ~ ${fmt(end)}（${Math.round((end.getTime() - start.getTime()) / 86400000) + 1} 天）`;

  let compare: ResolvedCompare | undefined;
  if (tw.compare?.enabled) {
    const modes = compareModes(tw.compare);
    const first = modes[0] ?? 'ring';
    compare = computeCompareWindow(tw, preset, start, end, now, first);
  }

  return { start, end, label, hint, compare };
}

/** 解析对比模式列表（兼容旧字段 mode / 新字段 modes），去重保序 */
export function compareModes(c?: { mode?: 'yoY' | 'ring'; modes?: ('yoY' | 'ring')[] }): ('yoY' | 'ring')[] {
  if (!c) return [];
  const list = (Array.isArray(c.modes) && c.modes.length ? c.modes : [c.mode ?? 'ring']).filter(Boolean) as ('yoY' | 'ring')[];
  return Array.from(new Set(list));
}

type Gran = 'day' | 'week' | 'month' | 'quarter' | 'year';

function granularityOf(preset: TimePreset, tw: TimeWindow): Gran {
  if (/week|Week/.test(preset)) return 'week';
  if (/Quarter|quarter/.test(preset)) return 'quarter';
  if (/Year|year/.test(preset)) return 'year';
  if (/Month|month/.test(preset)) return 'month';
  // recent / specificMonth / previousNMonth 等按天数平移
  const u = tw.custom?.unit;
  if (u === 'week') return 'week';
  if (u === 'month' || /month|Month/.test(preset)) return 'month';
  return 'day';
}

function shiftGran(d: Date, gran: Gran, n: number): Date {
  if (gran === 'week') return addDays(d, n * 7);
  if (gran === 'month') return new Date(d.getFullYear(), d.getMonth() + n, d.getDate());
  if (gran === 'quarter') return new Date(d.getFullYear(), d.getMonth() + n * 3, d.getDate());
  if (gran === 'year') return new Date(d.getFullYear() + n, d.getMonth(), Math.min(d.getDate(), new Date(d.getFullYear() + n, d.getMonth() + 1, 0).getDate()));
  return addDays(d, n);
}

export function computeCompareWindow(
  tw: TimeWindow,
  preset: TimePreset,
  start: Date,
  end: Date,
  _now: Date = new Date(),
  forcedMode?: 'yoY' | 'ring'
): ResolvedCompare {
  void _now;
  const mode = forcedMode ?? tw.compare?.mode ?? 'ring';
  const n = Math.max(1, Math.floor(tw.compare?.shift ?? 1));
  let cs = start;
  let ce = end;
  let label: string;
  if (mode === 'yoY') {
    cs = new Date(start.getFullYear() - n, start.getMonth(), Math.min(start.getDate(), 28));
    ce = new Date(end.getFullYear() - n, end.getMonth(), Math.min(end.getDate(), 28));
    label = `${n === 1 ? '' : n + '年'}同期`;
  } else {
    const gran = granularityOf(preset, tw);
    cs = shiftGran(start, gran, -n);
    ce = shiftGran(end, gran, -n);
    label = `上移 ${n} 周期`;
  }
  return { enabled: true, mode, start: cs, end: ce, label };
}

export function presetLabel(preset: TimePreset): string {
  return TIME_PRESETS.find((p) => p.value === preset)?.label ?? '时间窗口';
}

export interface ElapsedDayResult {
  /** 周期名称（如：本月 / 2026年第三季度） */
  periodLabel: string;
  /** 周期起点 */
  periodStart: Date;
  /** 周期终点（周期最后一天） */
  periodEnd: Date;
  /** 周期总天数 */
  totalDays: number;
  /** 从周期起点到"参考日(默认今天)"已过去的天数（含参考日，至少为 0） */
  elapsedDays: number;
  /** 参考日（默认今天） */
  asOf: Date;
}

const startOfDayT = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
const addDaysT = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const getMondayT = (d: Date) => {
  const s = startOfDayT(d);
  const day = s.getDay() || 7;
  return addDaysT(s, 1 - day);
};

/** 计算某周期/区间内"已过去的天数"（默认截止到今天并含今天；includeToday=false 时统计到昨天） */
export function resolveElapsedDays(
  scope: 'week' | 'month' | 'quarter' | 'year' | 'custom',
  opts: { customStart?: string; customEnd?: string; includeToday?: boolean } = {},
  now: Date = new Date(),
): ElapsedDayResult {
  const today = startOfDayT(now);
  const includeToday = opts.includeToday !== false; // 默认含今天
  let periodStart: Date;
  let periodEnd: Date;
  let periodLabel = '';

  if (scope === 'week') {
    periodStart = getMondayT(today);
    periodEnd = addDaysT(periodStart, 6);
    periodLabel = '本周';
  } else if (scope === 'month') {
    periodStart = new Date(today.getFullYear(), today.getMonth(), 1);
    periodEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    periodLabel = `${today.getFullYear()}年${today.getMonth() + 1}月`;
  } else if (scope === 'quarter') {
    const q = Math.floor(today.getMonth() / 3); // 0..3
    periodStart = new Date(today.getFullYear(), q * 3, 1);
    periodEnd = new Date(today.getFullYear(), q * 3 + 3, 0);
    periodLabel = `${today.getFullYear()}年第${q + 1}季度`;
  } else if (scope === 'year') {
    periodStart = new Date(today.getFullYear(), 0, 1);
    periodEnd = new Date(today.getFullYear(), 11, 31);
    periodLabel = `${today.getFullYear()}年`;
  } else {
    // custom：解析 YYYY-MM-DD（兼容 2026/8/1、20260801）
    const parse = (s?: string): Date | null => {
      if (!s) return null;
      const m = s.trim().match(/^(\d{4})[-/.年]?(\d{1,2})[-/.月]?(\d{1,2})日?$/);
      if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
      const compact = s.trim().match(/^(\d{4})(\d{2})(\d{2})$/);
      if (compact) return new Date(Number(compact[1]), Number(compact[2]) - 1, Number(compact[3]));
      return null;
    };
    periodStart = parse(opts.customStart) || addDaysT(today, -6);
    const endParsed = parse(opts.customEnd);
    periodEnd = endParsed || today;
    periodLabel = '自定义区间';
  }

  const totalDays = Math.round((periodEnd.getTime() - periodStart.getTime()) / 86400000) + 1;
  // 参考日：含今天→今天；不含今天→昨天。再截断到周期内。
  let ref = includeToday ? today : addDaysT(today, -1);
  ref = ref < periodStart ? periodStart : ref > periodEnd ? periodEnd : ref;
  // 已过天数：含参考日时 +1；不含当天(参考日=昨天)时，到昨天为止的天数 = 昨天到起点 +1，
  // 但当参考日被截断为周期起点且当天本身不计入时，应返回 0（周期第一天且不含当天）。
  let elapsedDays: number;
  if (!includeToday && addDaysT(today, -1) < periodStart) {
    // 周期今天才开始（起点=今天）且不含当天 → 已过 0 天
    elapsedDays = 0;
  } else {
    elapsedDays = Math.max(0, Math.round((ref.getTime() - periodStart.getTime()) / 86400000) + 1);
  }

  return { periodLabel, periodStart, periodEnd, totalDays, elapsedDays, asOf: ref };
}