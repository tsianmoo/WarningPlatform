'use client';

import { useMemo, useState, useEffect } from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts';
import { useStore } from '@/lib/store';
import { Sparkles, BellOff, CircleCheckBig, Clock3, TrendingUp, CheckCircle2 } from 'lucide-react';
import type { ExecutionRecord } from '@/lib/types';

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const fmt = (d: Date) => `${d.getMonth() + 1}/${d.getDate()}`;

const completionTime = (e: ExecutionRecord): Date | null => {
  if (e.status !== 'completed') return null;
  if (e.history && e.history.length) return new Date(e.history[e.history.length - 1].at);
  return e.triggeredAt ? new Date(e.triggeredAt) : null;
};

export function Dashboard({ onGoTables, onGoRules }: { onGoTables: () => void; onGoRules: () => void }) {
  const { state } = useStore();
  const rules = state.rules;

  const stats = useMemo(() => {
    const total = rules.length;
    const active = rules.filter((r) => r.status === 'active').length;
    const inactive = rules.filter((r) => r.status !== 'active').length;

    const all = rules.flatMap((r) => r.executions ?? []);
    const now = new Date();
    const today = startOfDay(now);

    const todayTriggered = all.filter((e) => e.triggeredAt && sameDay(startOfDay(new Date(e.triggeredAt)), today)).length;
    const todayCompleted = all.filter((e) => {
      const t = completionTime(e);
      return t && sameDay(startOfDay(t), today);
    }).length;
    const completed = all.filter((e) => e.status === 'completed').length;
    const pending = all.filter((e) => e.status === 'pending' || e.status === 'rescheduled').length;
    const ended = all.filter((e) => e.status === 'ended').length;
    const completionRate = all.length ? Math.round((completed / all.length) * 100) : 0;

    return { total, active, inactive, all, today, todayTriggered, todayCompleted, completed, pending, ended, completionRate };
  }, [rules]);

  const trend = useMemo(() => {
    const last = 14;
    const today = stats.today;
    const days: { label: string; 触发: number; 完成: number }[] = [];
    for (let i = last - 1; i >= 0; i--) {
      const d = addDays(today, -i);
      const triggered = stats.all.filter((e) => e.triggeredAt && sameDay(startOfDay(new Date(e.triggeredAt)), d)).length;
      const done = stats.all.filter((e) => {
        const t = completionTime(e);
        return t && sameDay(startOfDay(t), d);
      }).length;
      days.push({ label: fmt(d), 触发: triggered, 完成: done });
    }
    return days;
  }, [stats.today, stats.all]);

  const pie = useMemo(() => {
    return [
      { name: '已完成', value: stats.completed, color: '#10B981' },
      { name: '进行中', value: stats.pending, color: '#3B82F6' },
      { name: '已结束', value: stats.ended, color: '#9CA3AF' },
    ].filter((x) => x.value > 0);
  }, [stats.completed, stats.pending, stats.ended]);

  const activeWithPending = useMemo(() => {
    return rules
      .filter((r) => r.status === 'active')
      .map((r) => {
        const ex = r.executions ?? [];
        const pend = ex.filter((e) => e.status === 'pending' || e.status === 'rescheduled');
        const done = ex.filter((e) => e.status === 'completed').length;
        const rate = ex.length ? Math.round((done / ex.length) * 100) : 0;
        const next = pend.length ? Math.min(...pend.map((e) => (e.nextTriggerAt ? +new Date(e.nextTriggerAt) : Infinity))) : null;
        return { rule: r, pendCount: pend.length, done, total: ex.length, rate, next };
      })
      .filter((x) => x.pendCount > 0 || x.total > 0);
  }, [rules]);

  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  if (!mounted)
    return (
      <div className="flex h-full items-center justify-center p-10 text-sm text-gray-400">首页加载中…</div>
    );

  return (
    <div className="h-full overflow-auto bg-[#F7F8FA] px-6 py-6">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">首页 · 预警概览</h1>
          <p className="mt-0.5 text-sm text-gray-500">预警规则的全局运行状态与趋势</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={onGoTables} className="rounded-lg border bg-white px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50">
            数据表管理
          </button>
          <button onClick={onGoRules} className="rounded-lg border bg-white px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50">
            预警规则
          </button>
        </div>
      </div>

      {/* 统计卡片 */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard icon={<Sparkles size={18} />} color="#3B82F6" label="预警规则总数" value={stats.total} sub={`启用 ${stats.active} · 未启用 ${stats.inactive}`} />
        <StatCard icon={<BellOff size={18} />} color="#F59E0B" label="今日触发" value={stats.todayTriggered} sub={`今日完成 ${stats.todayCompleted}`} />
        <StatCard icon={<CircleCheckBig size={18} />} color="#10B981" label="已完成预警" value={stats.completed} sub={`进行中 ${stats.pending}`} />
        <StatCard icon={<TrendingUp size={18} />} color="#8B5CF6" label="完成率" value={`${stats.completionRate}%`} sub={`已完成 ${stats.completed} / 共 ${stats.all.length}`} />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* 趋势图 */}
        <div className="rounded-xl border bg-white p-4 lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-800">预警趋势（近 14 天）</h2>
            <div className="flex items-center gap-3 text-[11px] text-gray-500">
              <span className="flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-blue-500" />触发</span>
              <span className="flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-emerald-500" />完成</span>
            </div>
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trend} margin={{ top: 5, right: 8, left: -18, bottom: 0 }}>
                <defs>
                  <linearGradient id="gTrig" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#3B82F6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#EEF1F5" />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#9CA3AF' }} axisLine={false} tickLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#9CA3AF' }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 10, border: '1px solid #E5E7EB' }} />
                <Area type="monotone" dataKey="触发" stroke="#3B82F6" strokeWidth={2} fill="url(#gTrig)" />
                <Area type="monotone" dataKey="完成" stroke="#10B981" strokeWidth={2} fill="none" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* 饼图 分类 */}
        <div className="rounded-xl border bg-white p-4">
          <h2 className="mb-1 text-sm font-semibold text-gray-800">预警分类</h2>
          <p className="text-[11px] text-gray-400">按执行状态分布</p>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={pie} dataKey="value" nameKey="name" innerRadius={46} outerRadius={72} paddingAngle={3} strokeWidth={0}>
                  {pie.map((c) => (
                    <Cell key={c.name} fill={c.color} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 10, border: '1px solid #E5E7EB' }} />
                <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" iconSize={8} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-1 grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg bg-gray-50 py-2">
              <div className="text-sm font-bold text-emerald-600">{stats.completed}</div>
              <div className="text-[10px] text-gray-400">已完成</div>
            </div>
            <div className="rounded-lg bg-gray-50 py-2">
              <div className="text-sm font-bold text-blue-600">{stats.pending}</div>
              <div className="text-[10px] text-gray-400">进行中</div>
            </div>
            <div className="rounded-lg bg-gray-50 py-2">
              <div className="text-sm font-bold text-gray-600">{stats.ended}</div>
              <div className="text-[10px] text-gray-400">已结束</div>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* 完成进度 */}
        <div className="rounded-xl border bg-white p-4 lg:col-span-1">
          <h2 className="mb-3 text-sm font-semibold text-gray-800">完成进度</h2>
          <div className="mb-2 flex items-center justify-between text-xs">
            <span className="text-gray-500">整体完成率</span>
            <span className="font-semibold text-gray-800">{stats.completionRate}%</span>
          </div>
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-gray-100">
            <div className="h-full rounded-full bg-gradient-to-r from-blue-500 to-emerald-500 transition-all" style={{ width: `${stats.completionRate}%` }} />
          </div>
          {activeWithPending.length > 0 ? (
            <div className="mt-4 space-y-3">
              <div className="text-xs font-medium text-gray-500">各预警进度</div>
              {activeWithPending.map(({ rule, done, total, rate }) => (
                <div key={rule.id}>
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="max-w-[70%] truncate text-gray-600">{rule.name}</span>
                    <span className="text-gray-400">{done}/{total}</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
                    <div className="h-full rounded-full bg-blue-500" style={{ width: `${rate}%` }} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-4 rounded-lg bg-gray-50 py-6 text-center text-xs text-gray-400">暂无启用中的预警</div>
          )}
        </div>

        {/* 进行中的预警 */}
        <div className="rounded-xl border bg-white p-4 lg:col-span-2">
          <h2 className="mb-3 text-sm font-semibold text-gray-800">进行中的预警（未完成）</h2>
          {activeWithPending.filter((x) => x.pendCount > 0).length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-gray-400">
              <Clock3 className="mb-2 text-gray-300" size={32} />
              <p className="text-xs">当前没有待完成的预警</p>
            </div>
          ) : (
            <div className="space-y-2">
              {activeWithPending
                .filter((x) => x.pendCount > 0)
                .map(({ rule, pendCount, next }) => (
                  <div key={rule.id} className="flex items-center gap-3 rounded-lg border bg-white px-3 py-2.5">
                    <CheckCircle2 className="shrink-0 text-blue-500" size={18} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-gray-800">{rule.name}</div>
                      <div className="text-[11px] text-gray-400">
                        待处理 <span className="font-semibold text-amber-600">{pendCount}</span> 次
                        {next ? ` · 下次触发 ${new Date(next).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}` : ''}
                      </div>
                    </div>
                  </div>
                ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({ icon, color, label, value, sub }: { icon: React.ReactNode; color: string; label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-xl border bg-white p-4">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg" style={{ color, backgroundColor: `${color}18` }}>
          {icon}
        </span>
        <div>
          <div className="text-[12px] text-gray-500">{label}</div>
          <div className="text-xl font-bold text-gray-900">{value}</div>
        </div>
      </div>
      {sub && <div className="mt-2 text-[11px] text-gray-400">{sub}</div>}
    </div>
  );
}