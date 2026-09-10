'use client';

import React, { useState, useEffect } from 'react';
import {
  CheckCircle2,
  Clock,
  Flag,
  CalendarClock,
  History,
  MessageSquareText,
  XCircle,
  PlayCircle,
} from 'lucide-react';
import type { AlertRule, ExecutionRecord } from '@/lib/types';
import { useStore, computeNextTrigger, formatDateTime, buildAlertsForRule } from '@/lib/store';
import { toast } from 'sonner';

const STATUS_META: Record<
  ExecutionRecord['status'],
  { label: string; color: string; dot: string }
> = {
  pending: { label: '待处理', color: 'text-amber-600 bg-amber-50', dot: '#F59E0B' },
  completed: { label: '已完成', color: 'text-green-600 bg-green-50', dot: '#10B981' },
  rescheduled: { label: '已改期', color: 'text-blue-600 bg-blue-50', dot: '#3B82F6' },
  ended: { label: '已结束', color: 'text-gray-500 bg-gray-100', dot: '#9CA3AF' },
};

function toLocalInput(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function ExecutionTracker({ rule }: { rule: AlertRule }) {
  const { updateRule, updateExecution, addAlert } = useStore();
  const [completionDesc, setCompletionDesc] = useState<Record<string, string>>({});
  const [newTime, setNewTime] = useState<Record<string, string>>({});
  const latestPending = rule.executions.find((e) => e.status === 'pending');

  useEffect(() => {
    if (!latestPending) return;
    setNewTime((prev) => {
      if (prev[latestPending.id]) return prev;
      return { ...prev, [latestPending.id]: toLocalInput(latestPending.scheduledAt) };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latestPending?.id]);

  const markCompleted = (e: ExecutionRecord) => {
    const desc = completionDesc[e.id]?.trim();
    if (!desc) {
      toast.error('请填写本次完成过程描述');
      return;
    }
    const next = computeNextTrigger(rule.schedule);
    updateExecution(rule.id, e.id, {
      status: 'completed',
      completionDesc: desc,
      nextTriggerAt: next,
      actionNote: '已标记完成，系统已排定下次触发',
      history: [
        ...(e.history ?? []),
        { at: new Date().toISOString(), note: '标记完成并填报完成描述' },
      ],
    });
    toast.success('已记录完成过程');
  };

  const reschedule = (e: ExecutionRecord) => {
    const iso = newTime[e.id] ? new Date(newTime[e.id]).toISOString() : '';
    if (!iso) {
      toast.error('请选择新的触发时间');
      return;
    }
    updateExecution(rule.id, e.id, {
      status: 'rescheduled',
      nextTriggerAt: iso,
      actionNote: '触发时间已调整',
      history: [...(e.history ?? []), { at: new Date().toISOString(), note: `改期至 ${formatDateTime(iso)}` }],
    });
    toast.success('已调整下次触发时间');
  };

  /** 立即触发：把规则配置的预警动作节点转成预警工单写入预警列表，并将本次执行标记为已完成 */
  const triggerNow = (e: ExecutionRecord) => {
    const list = buildAlertsForRule(rule);
    list.forEach((a) => addAlert(a));
    updateExecution(rule.id, e.id, {
      status: 'completed',
      completionDesc: '规则触发，已生成预警',
      actionNote: '已触发并生成预警，系统已排定下次触发',
      nextTriggerAt: computeNextTrigger(rule.schedule),
      history: [...(e.history ?? []), { at: new Date().toISOString(), note: `触发并生成 ${list.length} 条预警` }],
    });
    toast.success(`已触发，生成 ${list.length} 条预警`);
  };

  const endEarly = (e: ExecutionRecord) => {
    updateExecution(rule.id, e.id, {
      status: 'ended',
      actionNote: '提前结束，不再触发',
      nextTriggerAt: '',
      history: [...(e.history ?? []), { at: new Date().toISOString(), note: '提前结束本次预警' }],
    });
    // 若该规则无其它待处理项，可将规则置为已结束
    const stillPending = rule.executions.filter((x) => x.id !== e.id && x.status === 'pending').length > 0;
    if (!stillPending) {
      updateRule(rule.id, { status: 'ended' });
    }
    toast.success('已提前结束');
  };

  const endRule = () => {
    updateRule(rule.id, { status: 'ended' });
    toast.success('规则已终止');
  };

  const sorted = [...rule.executions].sort((a, b) => (a.scheduledAt < b.scheduledAt ? 1 : -1));

  return (
    <div className="rounded-xl border bg-white">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <History size={16} className="text-blue-600" />
          <div className="text-sm font-semibold text-gray-800">执行跟踪</div>
          <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500">{rule.executions.length} 次</span>
        </div>
        {rule.status === 'active' && (
          <button
            onClick={endRule}
            className="rounded-md border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50"
          >
            提前结束规则
          </button>
        )}
      </div>

      <div className="max-h-[420px] divide-y overflow-y-auto">
        {sorted.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-gray-400">
            暂无执行记录。激活规则后将自动生成待办执行。
          </div>
        )}
        {sorted.map((e) => {
          const meta = STATUS_META[e.status];
          const pending = e.status === 'pending';
          return (
            <div key={e.id} className="px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium" style={{ backgroundColor: meta.dot + '18', color: meta.dot }}>
                  <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: meta.dot }} />
                  {meta.label}
                </span>
                <span className="inline-flex items-center gap-1 text-xs text-gray-500">
                  <Clock size={12} /> 计划 {formatDateTime(e.scheduledAt)}
                </span>
                {e.nextTriggerAt && <span className="text-xs text-gray-400">→ 下次 {formatDateTime(e.nextTriggerAt)}</span>}
              </div>

              {pending && (
                <div className="mt-2 space-y-2">
                  <textarea
                    value={completionDesc[e.id] ?? ''}
                    onChange={(ev) => setCompletionDesc((p) => ({ ...p, [e.id]: ev.target.value }))}
                    placeholder="填写本次完成过程描述（完成后必填）"
                    className="w-full rounded-md border px-2 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-300"
                    rows={2}
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      onClick={() => markCompleted(e)}
                      className="inline-flex items-center gap-1 rounded-md bg-green-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-green-700"
                    >
                      <CheckCircle2 size={13} /> 标记已完成后下次触发
                    </button>
                    {rule.status === 'active' && (
                      <button
                        onClick={() => triggerNow(e)}
                        className="inline-flex items-center gap-1 rounded-md bg-amber-500 px-2.5 py-1 text-xs font-medium text-white hover:bg-amber-600"
                      >
                        <PlayCircle size={13} /> 立即触发生成预警
                      </button>
                    )}
                    <div className="flex items-center gap-1">
                      <input
                        type="datetime-local"
                        value={newTime[e.id] ?? toLocalInput(e.scheduledAt)}
                        onChange={(ev) => setNewTime((p) => ({ ...p, [e.id]: ev.target.value }))}
                        className="rounded-md border px-2 py-1 text-xs text-gray-700"
                      />
                      <button
                        onClick={() => reschedule(e)}
                        className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-2.5 py-1 text-xs text-white hover:bg-blue-700"
                      >
                        <CalendarClock size={13} /> 调整下次触发
                      </button>
                    </div>
                    <button
                      onClick={() => endEarly(e)}
                      className="inline-flex items-center gap-1 rounded-md border border-red-200 px-2.5 py-1 text-xs text-red-600 hover:bg-red-50"
                    >
                      <XCircle size={13} /> 提前结束
                    </button>
                  </div>
                </div>
              )}

              {e.completionDesc && (
                <div className="mt-2 flex items-start gap-1.5 rounded-md bg-green-50/60 px-2 py-1.5 text-xs text-green-700">
                  <MessageSquareText size={13} className="mt-0.5 shrink-0" />
                  <span>{e.completionDesc}</span>
                </div>
              )}
              {e.actionNote && !e.completionDesc && (
                <div className="mt-2 flex items-start gap-1.5 rounded-md bg-gray-50 px-2 py-1.5 text-xs text-gray-500">
                  <Flag size={13} className="mt-0.5 shrink-0" />
                  <span>{e.actionNote}</span>
                </div>
              )}
              {e.history && e.history.length > 0 && (
                <div className="mt-2 space-y-0.5 border-l border-gray-100 pl-3">
                  {e.history.map((h, i) => (
                    <div key={i} className="text-[11px] text-gray-400">
                      <PlayCircle size={10} className="mr-1 inline" />
                      {formatDateTime(h.at)} · {h.note}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}