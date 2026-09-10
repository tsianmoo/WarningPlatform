'use client';

import React from 'react';
import { CalendarClock, Users, RefreshCcw, Info } from 'lucide-react';
import {
  DEPARTMENTS,
  PERSONNEL,
  type RepeatType,
  type Schedule,
} from '@/lib/types';
import { computeNextTrigger } from '@/lib/store';

const REPEAT_OPTIONS: { value: RepeatType; label: string }[] = [
  { value: 'once', label: '仅一次' },
  { value: 'daily', label: '每日' },
  { value: 'weekly', label: '每周' },
  { value: 'monthly', label: '每月' },
  { value: 'custom', label: '自定义间隔' },
];

const WEEKDAYS = [
  { n: 1, label: '一' },
  { n: 2, label: '二' },
  { n: 3, label: '三' },
  { n: 4, label: '四' },
  { n: 5, label: '五' },
  { n: 6, label: '六' },
  { n: 7, label: '日' },
];

export function ScheduleSetting({
  schedule,
  onChange,
}: {
  schedule: Schedule;
  onChange: (s: Schedule) => void;
}) {
  const set = (patch: Partial<Schedule>) => onChange({ ...schedule, ...patch });

  const recompute = () => {
    const next = computeNextTrigger(schedule);
    set({ nextTriggerAt: next });
  };

  const toggleWeekday = (n: number) =>
    set({
      weekdays: schedule.weekdays.includes(n)
        ? schedule.weekdays.filter((w) => w !== n)
        : [...schedule.weekdays, n].sort(),
    });

  const toggleMonthDay = (d: number) =>
    set({
      monthDays: schedule.monthDays.includes(d)
        ? schedule.monthDays.filter((x) => x !== d)
        : [...schedule.monthDays, d].sort((a, b) => a - b),
    });

  const rows = 'py-1.5 border-b border-gray-50 last:border-0';

  return (
    <div className="rounded-xl border bg-white">
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <CalendarClock size={16} className="text-blue-600" />
        <div className="text-sm font-semibold text-gray-800">触发调度设置</div>
      </div>
      <div className="px-4 py-2 text-sm">
        <div className={rows}>
          <div className="mb-1 text-xs text-gray-500">重复方式</div>
          <div className="flex flex-wrap gap-1.5">
            {REPEAT_OPTIONS.map((o) => (
              <button
                key={o.value}
                onClick={() => set({ repeatType: o.value })}
                className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                  schedule.repeatType === o.value
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>

        <div className={rows}>
          <div className="text-xs text-gray-500">每日触发时刻</div>
          <input
            type="time"
            value={schedule.timeOfDay}
            onChange={(e) => set({ timeOfDay: e.target.value })}
            className="mt-1 rounded-md border px-2 py-1 text-sm text-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-300"
          />
        </div>

        {schedule.repeatType === 'weekly' && (
          <div className={rows}>
            <div className="mb-1 text-xs text-gray-500">重复的星期</div>
            <div className="flex gap-1.5">
              {WEEKDAYS.map((w) => (
                <button
                  key={w.n}
                  onClick={() => toggleWeekday(w.n)}
                  className={`h-8 w-8 rounded-lg text-xs transition ${
                    schedule.weekdays.includes(w.n)
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                  }`}
                >
                  周{w.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {schedule.repeatType === 'monthly' && (
          <div className={rows}>
            <div className="mb-1 text-xs text-gray-500">重复的日期（号）</div>
            <div className="flex flex-wrap gap-1">
              {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                <button
                  key={d}
                  onClick={() => toggleMonthDay(d)}
                  className={`h-6 w-7 rounded text-[11px] transition ${
                    schedule.monthDays.includes(d)
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                  }`}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>
        )}

        {schedule.repeatType === 'custom' && (
          <div className={rows}>
            <div className="text-xs text-gray-500">每多少天触发一次</div>
            <div className="mt-1 flex items-center gap-2">
              <input
                type="number"
                min={1}
                value={schedule.customInterval}
                onChange={(e) => set({ customInterval: Number(e.target.value) || 1 })}
                className="w-20 rounded-md border px-2 py-1 text-sm text-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-300"
              />
              <span className="text-sm text-gray-500">天</span>
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 py-2">
          <div>
            <div className="mb-1 text-xs text-gray-500">开始日期</div>
            <input
              type="date"
              value={schedule.startDate}
              onChange={(e) => set({ startDate: e.target.value })}
              className="w-full rounded-md border px-2 py-1 text-sm text-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-300"
            />
          </div>
          <div>
            <div className="mb-1 text-xs text-gray-500">结束日期（可空=长期）</div>
            <input
              type="date"
              value={schedule.endDate}
              onChange={(e) => set({ endDate: e.target.value })}
              className="w-full rounded-md border px-2 py-1 text-sm text-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-300"
            />
          </div>
        </div>

        <div className={`${rows} flex items-center gap-2`}>
          <div className="text-xs text-gray-500">下次触发时间</div>
          <button
            onClick={recompute}
            className="inline-flex items-center gap-1 rounded-md bg-blue-50 px-2 py-1 text-xs text-blue-600 hover:bg-blue-100"
          >
            <RefreshCcw size={12} /> 重新计算
          </button>
        </div>
        <div className="py-1.5">
          <input
            type="datetime-local"
            value={toLocalInput(schedule.nextTriggerAt)}
            onChange={(e) => set({ nextTriggerAt: e.target.value ? new Date(e.target.value).toISOString() : '' })}
            className="w-full rounded-md border px-2 py-1 text-sm text-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-300"
          />
          <div className="mt-1 flex items-center gap-1 text-[11px] text-gray-400">
            <Info size={11} />
            系统按重复周期自动推算；也可手动调整下次触发时刻
          </div>
        </div>
      </div>
    </div>
  );
}

function toLocalInput(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function TargetSetting({
  targets,
  onChange,
}: {
  targets: { departments: string[]; personnel: string[] };
  onChange: (t: { departments: string[]; personnel: string[] }) => void;
}) {
  const toggleDept = (d: string) =>
    onChange({
      ...targets,
      departments: targets.departments.includes(d)
        ? targets.departments.filter((x) => x !== d)
        : [...targets.departments, d],
    });

  const togglePerson = (name: string) =>
    onChange({
      ...targets,
      personnel: targets.personnel.includes(name)
        ? targets.personnel.filter((x) => x !== name)
        : [...targets.personnel, name],
    });

  return (
    <div className="rounded-xl border bg-white">
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <Users size={16} className="text-blue-600" />
        <div className="text-sm font-semibold text-gray-800">通知对象设置</div>
      </div>
      <div className="px-4 py-3">
        <div className="mb-1.5 text-xs text-gray-500">适用于部门（{targets.departments.length}）</div>
        <div className="mb-3 flex flex-wrap gap-1.5">
          {DEPARTMENTS.map((d) => (
            <button
              key={d}
              onClick={() => toggleDept(d)}
              className={`rounded-lg px-2.5 py-1 text-xs transition ${
                targets.departments.includes(d)
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {d}
            </button>
          ))}
        </div>

        <div className="mb-1.5 text-xs text-gray-500">适用于人员（{targets.personnel.length}）</div>
        <div className="grid grid-cols-2 gap-1.5">
          {PERSONNEL.map((p) => {
            const active = targets.personnel.includes(p.name);
            return (
              <button
                key={p.name}
                onClick={() => togglePerson(p.name)}
                className={`flex items-center justify-between rounded-lg border px-2 py-1.5 text-left text-xs transition ${
                  active ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-600 hover:border-blue-200'
                }`}
              >
                <span>{p.name}</span>
                <span className="text-[10px] text-gray-400">{p.dept}</span>
              </button>
            );
          })}
        </div>
        {targets.departments.length === 0 && targets.personnel.length === 0 && (
          <div className="mt-2 rounded bg-amber-50 px-2 py-1 text-[11px] text-amber-600">
            请至少选择部门或人员，否则预警无法通知
          </div>
        )}
      </div>
    </div>
  );
}