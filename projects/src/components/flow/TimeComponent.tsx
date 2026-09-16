'use client';

import React, { useState, useMemo } from 'react';
import { Clock } from 'lucide-react';
import type { TimeWindow, TimePreset, TimeUnit } from '@/lib/types';
import { TIME_PRESETS, TIME_UNIT_OPTIONS, resolveTimeWindow, presetLabel } from '@/lib/time';

interface Props {
  value?: TimeWindow;
  onChange: (tw: TimeWindow) => void;
  compact?: boolean;
  hideAllToggle?: boolean;
}

const GROUP_LABEL: Record<string, string> = {
  point: '单日',
  recent: '近 N 天',
  week: '周',
  month: '月',
  quarter: '季度',
  year: '年度',
  fixed: '指定范围',
};

const COMPARE_OPTIONS: { value: 'yoY' | 'ring'; label: string; hint: string }[] = [
  { value: 'yoY', label: '同期', hint: '去年同段' },
  { value: 'ring', label: '环期', hint: '上一时段' },
];

export default function TimeComponent({ value, onChange, hideAllToggle }: Props) {
  const [open, setOpen] = useState(false);
  const tw: TimeWindow = useMemo(() => value ?? { preset: 'thisWeek' }, [value]);
  const resolved = useMemo(() => resolveTimeWindow(tw), [tw]);
  const cmpTw = tw.compare;

  const pick = (preset: TimePreset) => {
    onChange({ ...tw, preset });
    if (preset !== 'custom' && preset !== (value?.preset ?? 'thisWeek')) {
      // 关闭浮层（自定义保持展开以输入数值）
    }
  };

  return (
    <div className="flex w-full min-w-0 items-center gap-2">
      <div className="relative min-w-0 flex-1">
        <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50/50 px-2 py-1 text-left text-xs text-emerald-700 transition hover:bg-emerald-50"
      >
        <Clock size={12} strokeWidth={2.2} className="shrink-0 text-emerald-600" />
        <span className="shrink-0 truncate font-medium">{presetLabel(tw.preset)}</span>
        <span className="ml-auto max-w-[55%] shrink truncate text-[9px] text-emerald-500/80">{resolved.hint}</span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full z-50 mt-1 w-72 rounded-lg border border-border bg-white p-2.5 shadow-lg">
            {(['point', 'recent'] as const).map((g) => (
              <div key={g} className="mb-2">
                <div className="mb-1 px-1 text-[10px] font-medium uppercase tracking-wide text-slate-400">
                  {GROUP_LABEL[g]}
                </div>
                <div className="grid grid-cols-4 gap-1">
                  {TIME_PRESETS.filter((p) => p.group === g).map((p) => (
                    <button
                      key={p.value}
                      type="button"
                      onClick={() => pick(p.value)}
                      className={`rounded-md border px-1 py-1 text-[11px] transition ${
                        tw.preset === p.value
                          ? 'border-emerald-500 bg-emerald-500 text-white'
                          : 'border-slate-200 text-slate-600 hover:border-emerald-300 hover:bg-emerald-50'
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            {(['week', 'month', 'quarter', 'year'] as const).map((g) => (
              <div key={g} className="mb-2">
                <div className="mb-1 px-1 text-[10px] font-medium uppercase tracking-wide text-slate-400">
                  {GROUP_LABEL[g]}
                </div>
                <div className="grid grid-cols-3 gap-1">
                  {TIME_PRESETS.filter((p) => p.group === g).map((p) => (
                    <button
                      key={p.value}
                      type="button"
                      onClick={() => pick(p.value)}
                      className={`rounded-md border px-1 py-1 text-[11px] transition ${
                        tw.preset === p.value
                          ? 'border-emerald-500 bg-emerald-500 text-white'
                          : 'border-slate-200 text-slate-600 hover:border-emerald-300 hover:bg-emerald-50'
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            {/* 自定义 */}
            <div className={tw.preset === 'custom' ? '' : 'mt-2'}>
              <div className="mb-1 flex items-center justify-between px-1">
                <button
                  type="button"
                  onClick={() => pick('custom')}
                  className={`text-[11px] font-medium ${
                    tw.preset === 'custom' ? 'text-emerald-600' : 'text-slate-400 hover:text-emerald-600'
                  }`}
                >
                  自定义（近 N 天/周/月）
                </button>
              </div>
              {tw.preset === 'custom' && (
                <div className="flex items-center gap-1.5 px-1">
                  <input
                    type="number"
                    min={1}
                    value={tw.custom?.value ?? 7}
                    onChange={(e) =>
                      onChange({ ...tw, custom: { value: Math.max(1, Number(e.target.value) || 1), unit: tw.custom?.unit ?? 'day' } })
                    }
                    className="h-7 w-16 rounded-md border border-slate-200 px-1.5 text-[11px] text-slate-700 outline-none focus:border-emerald-400"
                  />
                  <select
                    value={tw.custom?.unit ?? 'day'}
                    onChange={(e) =>
                      onChange({ ...tw, custom: { value: tw.custom?.value ?? 7, unit: e.target.value as TimeUnit } })
                    }
                    className="h-7 rounded-md border border-slate-200 px-1 text-[11px] text-slate-700 outline-none"
                  >
                    {TIME_UNIT_OPTIONS.map((u) => (
                      <option key={u.value} value={u.value}>
                        {u.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
            {/* 指定月份 */}
            <div className="mt-2">
              <div className="mb-1 flex items-center gap-2 px-1">
                <button
                  type="button"
                  onClick={() => {
                    const d = new Date();
                    const def = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
                    onChange({ ...tw, preset: 'specificMonth', month: tw.month || def });
                  }}
                  className={`text-[11px] font-medium ${
                    tw.preset === 'specificMonth' ? 'text-emerald-600' : 'text-slate-400 hover:text-emerald-600'
                  }`}
                >
                  指定月份（如 8 月）
                </button>
              </div>
              {tw.preset === 'specificMonth' && (
                <div className="flex items-center gap-1.5 px-1">
                  <input
                    type="month"
                    value={tw.month ?? ''}
                    onChange={(e) => onChange({ ...tw, preset: 'specificMonth', month: e.target.value })}
                    className="h-7 rounded-md border border-slate-200 px-1.5 text-[11px] text-slate-700 outline-none focus:border-emerald-400"
                  />
                  <span className="text-[10px] text-slate-400">如选择 2025-08 即“8月份”</span>
                </div>
              )}
            </div>
            {/* 对比：同期 / 环期 */}
            <div className="mt-2 border-t border-slate-100 pt-2">
              <label className="flex cursor-pointer select-none items-center gap-1.5 px-1 text-[11px] font-medium text-slate-600">
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 accent-emerald-600"
                  checked={!!tw.compare}
                  onChange={(e) =>
                    onChange({ ...tw, compare: e.target.checked ? { enabled: true, mode: 'ring' } : undefined })
                  }
                />
                对比上一时段（同期/环期）
              </label>
              {cmpTw && (
                <div className="mt-1.5 flex items-center gap-1.5 px-2">
                  {COMPARE_OPTIONS.map((o) => (
                    <button
                      key={o.value}
                      type="button"
                      onClick={() => onChange({ ...tw, compare: { ...cmpTw, mode: o.value } })}
                      className={`inline-flex min-w-[3.5rem] flex-col items-center rounded-md border px-2 py-1 text-[11px] transition ${
                        cmpTw.mode === o.value
                          ? 'border-emerald-500 bg-emerald-500 text-white'
                          : 'border-slate-200 text-slate-600 hover:border-emerald-300 hover:bg-emerald-50'
                      }`}
                    >
                      <span>{o.label}</span>
                      <span className={`text-[9px] ${cmpTw.mode === o.value ? 'text-emerald-100' : 'text-slate-400'}`}>
                        {o.hint}
                      </span>
                    </button>
                  ))}
                  <span className="ml-1 text-[10px] text-slate-400">对比窗口：本期 → 上一时段</span>
                </div>
              )}
            </div>
            <div className="mt-2 max-w-full break-words rounded bg-emerald-50/60 px-2 py-1 text-[10px] leading-relaxed text-emerald-700">
              {tw.preset === 'custom' ? presetLabel('custom') : presetLabel(tw.preset)}：<b>{resolved.label}</b>{' '}
              {resolved.label === resolved.hint ? '' : `（${resolved.hint}）`}
            </div>
          </div>
        </>
      )}
      </div>
      {!hideAllToggle && (
        <label className="flex shrink-0 cursor-pointer select-none items-center gap-1 pl-0.5 text-[11px] font-medium text-emerald-700">
          <input
            type="checkbox"
            className="h-3.5 w-3.5 accent-emerald-600"
            checked={tw.preset === 'all'}
            onChange={(e) => onChange({ ...tw, preset: e.target.checked ? 'all' : tw.preset === 'all' ? 'thisMonth' : tw.preset })}
          />
          不限日期
        </label>
      )}
    </div>
  );
}