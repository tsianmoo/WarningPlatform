'use client';

import React, { useState, useMemo } from 'react';
import { Clock, Settings2, CalendarRange } from 'lucide-react';
import type { TimeWindow, TimePreset, TimeUnit } from '@/lib/types';
import { TIME_PRESETS, TIME_UNIT_OPTIONS, resolveTimeWindow, presetLabel } from '@/lib/time';

interface Props {
  value?: TimeWindow;
  onChange: (tw: TimeWindow) => void;
  compact?: boolean;
  hideAllToggle?: boolean;
  disabled?: boolean;
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

export default function TimeComponent({ value, onChange, hideAllToggle, disabled }: Props) {
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
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50/50 px-2 py-1 text-left text-xs text-emerald-700 transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-50 disabled:text-slate-400 disabled:hover:bg-slate-50"
      >
        <Clock size={12} strokeWidth={2.2} className="shrink-0 text-emerald-600" />
        <span className="shrink-0 truncate font-medium">{presetLabel(tw.preset)}</span>
        <span className="ml-auto max-w-[55%] shrink truncate text-[9px] text-emerald-500/80">{resolved.hint}</span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full z-50 mt-1 w-full rounded-md border border-border bg-white p-2 shadow-lg">
            {(['point', 'recent'] as const).map((g) => (
              <div key={g} className="mb-1.5">
                <div className="mb-0.5 px-1 text-[9px] font-medium uppercase tracking-wide text-slate-400">
                  {GROUP_LABEL[g]}
                </div>
                <div className="grid grid-cols-4 gap-1">
                  {TIME_PRESETS.filter((p) => p.group === g).map((p) => (
                    <button
                      key={p.value}
                      type="button"
                      onClick={() => pick(p.value)}
                      className={`rounded border px-1 py-0.5 text-[10px] transition ${
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
              <div key={g} className="mb-1.5">
                <div className="mb-0.5 px-1 text-[9px] font-medium uppercase tracking-wide text-slate-400">
                  {GROUP_LABEL[g]}
                </div>
                <div className="grid grid-cols-3 gap-1">
                  {TIME_PRESETS.filter((p) => p.group === g).map((p) => (
                    <button
                      key={p.value}
                      type="button"
                      onClick={() => pick(p.value)}
                      className={`rounded border px-1 py-0.5 text-[10px] transition ${
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
            <div className={tw.preset === 'custom' ? '' : 'mt-1'}>
              <div className="mb-0.5 flex items-center justify-between px-1">
                <button
                  type="button"
                  onClick={() => pick('custom')}
                  className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium transition ${
                    tw.preset === 'custom'
                      ? 'bg-emerald-100 text-emerald-700'
                      : 'bg-slate-100 text-slate-600 hover:bg-emerald-50 hover:text-emerald-600'
                  }`}
                >
                  <Settings2 size={11} />
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
                    className="h-6 w-16 rounded border border-slate-200 px-1.5 text-[10px] text-slate-700 outline-none focus:border-emerald-400"
                  />
                  <select
                    value={tw.custom?.unit ?? 'day'}
                    onChange={(e) =>
                      onChange({ ...tw, custom: { value: tw.custom?.value ?? 7, unit: e.target.value as TimeUnit } })
                    }
                    className="h-6 rounded border border-slate-200 px-1 text-[10px] text-slate-700 outline-none"
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
            <div className="mt-1">
              <div className="mb-0.5 flex items-center gap-2 px-1">
                <button
                  type="button"
                  onClick={() => {
                    const d = new Date();
                    const def = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
                    onChange({ ...tw, preset: 'specificMonth', month: tw.month || def });
                  }}
                  className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium transition ${
                    tw.preset === 'specificMonth'
                      ? 'bg-emerald-100 text-emerald-700'
                      : 'bg-slate-100 text-slate-600 hover:bg-emerald-50 hover:text-emerald-600'
                  }`}
                >
                  <CalendarRange size={11} />
                  指定月份（如 8 月）
                </button>
              </div>
              {tw.preset === 'specificMonth' && (
                <div className="flex items-center gap-1.5 px-1">
                  <input
                    type="month"
                    value={tw.month ?? ''}
                    onChange={(e) => onChange({ ...tw, preset: 'specificMonth', month: e.target.value })}
                    className="h-6 rounded border border-slate-200 px-1.5 text-[10px] text-slate-700 outline-none focus:border-emerald-400"
                  />
                  <span className="text-[9px] text-slate-400">如选择 2025-08 即“8月份”</span>
                </div>
              )}
            </div>
            {/* 对比：同期 / 环期 */}
            <div className="mt-1 border-t border-slate-100 pt-1">
              <label className="flex cursor-pointer select-none items-center gap-1.5 px-1 text-[10px] font-medium text-slate-600">
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
                <div className="mt-1 space-y-1 px-2">
                  {COMPARE_OPTIONS.map((o) => {
                    const active = (cmpTw.modes ?? [cmpTw.mode ?? 'ring']).includes(o.value);
                    const toggle = (on: boolean) => {
                      const cur = (cmpTw.modes ?? [cmpTw.mode ?? 'ring']).filter(Boolean) as ('yoY' | 'ring')[];
                      const next = on ? Array.from(new Set([...cur, o.value])) : cur.filter((m) => m !== o.value);
                      onChange({ ...tw, compare: { ...cmpTw, modes: next, mode: next[0] ?? 'ring' } });
                    };
                    return (
                      <label
                        key={o.value}
                        className={`flex cursor-pointer select-none items-center justify-between rounded border px-2 py-0.5 text-[10px] transition ${
                          active ? 'border-emerald-500 bg-emerald-50' : 'border-slate-200 hover:border-emerald-300 hover:bg-emerald-50/40'
                        }`}
                      >
                        <span className={`flex items-center gap-1 ${active ? 'text-emerald-700' : 'text-slate-600'}`}>
                          <input
                            type="checkbox"
                            className="h-3 w-3 accent-emerald-600"
                            checked={active}
                            onChange={(e) => toggle(e.target.checked)}
                          />
                          <span className="font-medium">{o.label}</span>
                          <span className="text-[8px] text-slate-400">{o.hint}</span>
                        </span>
                      </label>
                    );
                  })}
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
        <label className={`flex shrink-0 select-none items-center gap-1 pl-0.5 text-[11px] font-medium text-emerald-700 ${disabled ? 'cursor-not-allowed text-slate-400' : 'cursor-pointer'}`}>
          <input
            type="checkbox"
            disabled={disabled}
            className="h-3.5 w-3.5 accent-emerald-600 disabled:opacity-40"
            checked={tw.preset === 'all'}
            onChange={(e) => onChange({ ...tw, preset: e.target.checked ? 'all' : tw.preset === 'all' ? 'thisMonth' : tw.preset })}
          />
          不限日期
        </label>
      )}
    </div>
  );
}