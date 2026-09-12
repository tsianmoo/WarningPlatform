'use client';

import { Fragment, useEffect, useState } from 'react';
import { ArrowLeft, Bell, BellRing, Eye, Plus, Send, X } from 'lucide-react';
import { useStore } from '@/lib/store';
import type { AlertStatus, AlertTask } from '@/lib/types';
import { PERSONNEL } from '@/lib/types';

const LEVEL_META: Record<string, { label: string; text: string; bg: string; dot: string }> = {
  info: { label: '提醒', text: 'text-blue-600', bg: 'bg-blue-50 border-blue-200', dot: 'bg-blue-500' },
  warn: { label: '预警', text: 'text-amber-600', bg: 'bg-amber-50 border-amber-200', dot: 'bg-amber-500' },
  critical: { label: '紧急', text: 'text-red-600', bg: 'bg-red-50 border-red-200', dot: 'bg-red-500' },
};

const STATUS_META: Record<AlertStatus, { label: string; text: string; bg: string }> = {
  new: { label: '待处理', text: 'text-gray-600', bg: 'bg-gray-100' },
  accepted: { label: '已接受', text: 'text-blue-600', bg: 'bg-blue-100' },
  processing: { label: '处理中', text: 'text-amber-600', bg: 'bg-amber-100' },
  done: { label: '已处理', text: 'text-green-600', bg: 'bg-green-100' },
  failed: { label: '无法完成', text: 'text-red-600', bg: 'bg-red-100' },
};

/** 已过时间：相对触发时间的时长，客户端定时刷新 */
function formatElapsed(from: number, now: number): string {
  const diff = Math.max(0, now - from);
  const min = Math.floor(diff / 60000);
  if (min < 1) return '不足 1 分钟';
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h < 1) return `${m} 分钟`;
  const d = Math.floor(h / 24);
  if (d < 1) return `${h} 小时 ${m} 分`;
  return `${d} 天 ${h % 24} 小时`;
}

function ElapsedCell({ createdAt }: { createdAt: number }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(t);
  }, []);
  return (
    <span className="text-gray-500 tabular-nums">
      {now ? formatElapsed(createdAt, now) : '—'}
    </span>
  );
}

export function AlertList({ onBack }: { onBack: () => void }) {
  const { state, addAlert, updateAlertStatus } = useStore();
  const PEOPLE = PERSONNEL as unknown as { name: string; dept: string }[];
  const alerts = state.alerts ?? [];
  const pending = alerts.filter((a) => a.status === 'new' || a.status === 'accepted' || a.status === 'processing').length;

  const [creating, setCreating] = useState(false);
  const [ruleId, setRuleId] = useState(state.rules[0]?.id ?? '');
  const [level, setLevel] = useState<AlertTask['level']>('warn');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [reason, setReason] = useState('');
  const [handoffId, setHandoffId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const rules = state.rules;

  const createAlert = () => {
    const rule = rules.find((r) => r.id === ruleId);
    addAlert({
      ruleId: rule?.id ?? '',
      ruleName: rule?.name ?? '未命名规则',
      level,
      title: title.trim() || (rule?.name ?? '预警') + ' - 触发告警',
      content: content.trim() || '规则命中，产生一条预警，请及时处理。',
      reason: reason.trim() || `基于「${rule?.name ?? '手动'}」规则人工生成预警`,
      dept: '零售运营',
      assignee: '',
      status: 'new',
    });
    setCreating(false);
    setTitle('');
    setContent('');
  };

  return (
    <div className="flex h-screen flex-col bg-[#F7F8FA]">
      {/* 顶栏 */}
      <div className="flex items-center gap-3 border-b bg-white px-5 py-3">
        <button onClick={onBack} className="rounded-md p-1 hover:bg-gray-100" title="返回">
          <ArrowLeft size={17} className="text-gray-600" />
        </button>
        <div className="flex items-center gap-2">
          <BellRing size={16} className="text-blue-600" />
          <h1 className="text-sm font-semibold text-gray-800">预警列表</h1>
          {pending > 0 && (
            <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-600">
              {pending} 条待处理
            </span>
          )}
        </div>
        <div className="ml-auto">
          <button
            onClick={() => setCreating(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500"
          >
            <Plus size={14} /> 生成预警
          </button>
        </div>
      </div>

      {/* 列表 */}
      <div className="min-h-0 flex-1 overflow-auto p-5">
        {alerts.length === 0 ? (
          <div className="mt-24 flex flex-col items-center gap-2 text-center text-sm text-gray-400">
            <Bell size={30} className="text-gray-300" />
            <p>暂无预警。</p>
            <p className="text-xs">主动规则触发后会生成预警，也可点击右上角「生成预警」。</p>
          </div>
        ) : (
          <div className="w-full">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="border-b bg-white text-left text-gray-500">
                  <th className="w-12 px-3 py-2 font-medium">序号</th>
                  <th className="min-w-40 px-3 py-2 font-medium">标题</th>
                  <th className="min-w-52 px-3 py-2 font-medium">判断方式</th>
                  <th className="w-20 px-3 py-2 font-medium">预警级别</th>
                  <th className="w-28 px-3 py-2 font-medium">适用部门</th>
                  <th className="w-28 px-3 py-2 font-medium">适用人员</th>
                  <th className="w-40 px-3 py-2 font-medium">触发时间</th>
                  <th className="w-28 px-3 py-2 font-medium">已过时间</th>
                  <th className="w-24 px-3 py-2 font-medium">状态</th>
                  <th className="min-w-72 px-3 py-2 font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {alerts.map((a, idx) => {
                  const lv = (LEVEL_META[(a.level ?? 'warn') as keyof typeof LEVEL_META] ?? LEVEL_META.warn);
                  const st = STATUS_META[a.status];
                  const actions: { label: string; fn: () => void; cls: string }[] = [];
                  if (a.status === 'new') {
                    actions.push({
                      label: '接受',
                      fn: () => updateAlertStatus(a.id, { status: 'accepted', assignee: a.assignee || '当前用户', updatedAt: Date.now() }),
                      cls: 'bg-blue-600 text-white hover:bg-blue-500',
                    });
                  } else if (a.status === 'accepted') {
                    actions.push({
                      label: '开始处理',
                      fn: () => updateAlertStatus(a.id, { status: 'processing', updatedAt: Date.now() }),
                      cls: 'bg-amber-500 text-white hover:bg-amber-400',
                    });
                  } else if (a.status === 'processing') {
                    actions.push({
                      label: '已处理',
                      fn: () => updateAlertStatus(a.id, { status: 'done', updatedAt: Date.now() }),
                      cls: 'bg-green-600 text-white hover:bg-green-500',
                    });
                  }
                  if (a.status === 'new' || a.status === 'accepted' || a.status === 'processing') {
                    actions.push({
                      label: '转交',
                      fn: () => setHandoffId(a.id),
                      cls: 'border border-gray-300 bg-white text-gray-600 hover:bg-gray-50',
                    });
                    actions.push({
                      label: '无法完成',
                      fn: () => updateAlertStatus(a.id, { status: 'failed', updatedAt: Date.now() }),
                      cls: 'border border-red-200 bg-white text-red-600 hover:bg-red-50',
                    });
                  }
                  const pv = a.preview;
                  return (
                    <Fragment key={a.id}>
                      <tr className="border-b border-gray-100 align-top hover:bg-gray-50/60">
                      <td className="px-3 py-2.5 text-gray-400">{String(idx + 1).padStart(2, '0')}</td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-1.5">
                          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${lv.dot}`} />
                          <span className="font-medium text-gray-800">{a.ruleName || a.title}</span>
                        </div>
                        {a.content ? (
                          <div className="mt-1 max-w-[260px] truncate text-[11px] text-gray-400" title={a.content}>
                            {a.content}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="block max-w-[300px] text-gray-600">
                          {a.conditionDesc || a.reason || a.content || '—'}
                        </span>
                        {pv ? (
                          <div className="mt-0.5 text-[11px] text-gray-400">命中 {pv.rows.length} 行数据</div>
                        ) : null}
                      </td>
                      <td className="px-3 py-2.5">
                        <span className={`inline-flex rounded px-1.5 py-0.5 text-[11px] font-medium ${lv.bg} ${lv.text}`}>
                          {lv.label}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-gray-600">{a.dept || '—'}</td>
                      <td className="px-3 py-2.5 text-gray-600">
                        {a.handoffTo ? (
                          <span>{a.handoffTo}<span className="ml-1 text-[10px] text-blue-500">（转交）</span></span>
                        ) : a.assignee ? (
                          a.assignee
                        ) : (
                          <span className="text-gray-400">待分配</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-gray-500 tabular-nums">
                        {new Date(a.createdAt).toLocaleString('zh-CN')}
                      </td>
                      <td className="px-3 py-2.5">
                        <ElapsedCell createdAt={a.createdAt} />
                      </td>
                      <td className="px-3 py-2.5">
                        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] ${st.bg} ${st.text}`}>
                          {st.label}
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex flex-wrap gap-1.5">
                          {actions.map((x) => (
                            <button
                              key={x.label}
                              onClick={x.fn}
                              className={`rounded-md px-2.5 py-1 text-[11px] font-medium ${x.cls}`}
                            >
                              {x.label}
                            </button>
                          ))}
                          {pv ? (
                            <button
                              onClick={() => setOpenId(openId === a.id ? null : a.id)}
                              className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-2.5 py-1 text-[11px] font-medium text-gray-600 hover:bg-gray-50"
                            >
                              <Eye size={12} /> 查看判断数据
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                    {openId === a.id && pv ? (
                      <tr className="border-b border-dashed border-gray-200 bg-gray-50/70">
                        <td colSpan={10} className="px-3 py-2.5">
                          <div className="max-h-60 overflow-auto rounded-lg border border-gray-200 bg-white">
                            <table className="w-full border-collapse text-[11px]">
                              <thead>
                                <tr className="border-b bg-gray-50 text-left text-gray-500">
                                  {pv.columns.map((c) => (
                                    <th key={c} className="whitespace-nowrap px-2.5 py-1.5 font-medium">{c}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {pv.rows.slice(0, 100).map((r, ri) => (
                                  <tr key={ri} className="border-b border-gray-100">
                                    {pv.columns.map((c) => (
                                      <td key={c} className="whitespace-nowrap px-2.5 py-1.5 text-gray-600">{String(r[c] ?? '')}</td>
                                    ))}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </td>
                      </tr>
                    ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 生成弹窗 */}
      {creating && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={() => setCreating(false)}>
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-800">生成预警</h3>
              <button onClick={() => setCreating(false)} className="rounded p-1 hover:bg-gray-100">
                <X size={15} className="text-gray-400" />
              </button>
            </div>
            <label className="mb-1 block text-xs text-gray-500">关联规则</label>
            <select
              value={ruleId}
              onChange={(e) => setRuleId(e.target.value)}
              className="mb-3 w-full rounded-lg border px-3 py-2 text-sm outline-none focus:border-blue-400"
            >
              {rules.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
            <label className="mb-1 block text-xs text-gray-500">级别</label>
            <div className="mb-3 flex gap-2">
              {(Object.keys(LEVEL_META) as AlertTask['level'][]).map((lv) => (
                <button
                  key={lv}
                  onClick={() => setLevel(lv)}
                  className={`rounded-lg border px-3 py-1 text-xs ${
                    level === lv ? 'border-blue-500 bg-blue-50 text-blue-600' : 'border-gray-200 text-gray-500 hover:bg-gray-50'
                  }`}
                >
                  {LEVEL_META[lv as keyof typeof LEVEL_META]?.label ?? lv}
                </button>
              ))}
            </div>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="预警标题（默认取规则名）"
              className="mb-2 w-full rounded-lg border px-3 py-2 text-sm outline-none focus:border-blue-400"
            />
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="预警内容 / 说明"
              rows={3}
              className="mb-2 w-full resize-none rounded-lg border px-3 py-2 text-sm outline-none focus:border-blue-400"
            />
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="为什么预警（触发原因，可填如上月未开单天数达到阈值等）"
              rows={2}
              className="mb-4 w-full resize-none rounded-lg border px-3 py-2 text-sm outline-none focus:border-blue-400"
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => setCreating(false)} className="rounded-lg px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-50">
                取消
              </button>
              <button
                onClick={createAlert}
                className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500"
              >
                <Send size={14} /> 生成
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 转交弹窗 */}
      {handoffId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={() => setHandoffId(null)}>
          <div className="w-full max-w-xs rounded-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-800">转交给其他人</h3>
              <button onClick={() => setHandoffId(null)} className="rounded p-1 hover:bg-gray-100">
                <X size={15} className="text-gray-400" />
              </button>
            </div>
            <div className="max-h-64 space-y-1 overflow-auto">
              {PEOPLE.map((p) => (
                <button
                  key={p.name}
                  onClick={() => {
                    updateAlertStatus(handoffId, {
                      assignee: p.name,
                      handoffTo: p.name,
                      dept: p.dept,
                      status: 'processing',
                      updatedAt: Date.now(),
                    });
                    setHandoffId(null);
                  }}
                  className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                >
                  <span>{p.name}</span>
                  <span className="text-xs text-gray-400">{p.dept}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}