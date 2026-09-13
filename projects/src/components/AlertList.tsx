'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowLeft, Bell, Eye, Plus, RotateCcw, Send, X } from 'lucide-react';
import { useStore } from '@/lib/store';
import type { AlertStatus, AlertTask } from '@/lib/types';
import { PERSONNEL } from '@/lib/types';

const LEVEL_META: Record<string, { label: string; text: string; dot: string }> = {
  info: { label: '提醒', text: 'text-blue-600', dot: 'bg-blue-500' },
  warn: { label: '预警', text: 'text-amber-600', dot: 'bg-amber-500' },
  critical: { label: '紧急', text: 'text-red-600', dot: 'bg-red-500' },
  remind: { label: '提醒', text: 'text-blue-600', dot: 'bg-blue-500' },
};

const STATUS_META: Record<AlertStatus, { label: string; text: string }> = {
  new: { label: '待处理', text: 'text-gray-500' },
  accepted: { label: '已接受', text: 'text-blue-600' },
  processing: { label: '处理中', text: 'text-amber-600' },
  done: { label: '已处理', text: 'text-green-600' },
  failed: { label: '无法完成', text: 'text-red-500' },
};

/** 已过时间：相对创建/触发时间时长，客户端定时刷新 */
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
  return <span className="text-gray-400 tabular-nums">{now ? formatElapsed(createdAt, now) : '—'}</span>;
}

/** 提取某条预警涉及的店仓集合（用于筛选下拉） */
function alertStores(a: AlertTask): string[] {
  const direct = (a.preview?.storeMessages ?? []).map((s) => s.store).filter(Boolean);
  const set = new Set(direct);
  if (set.size === 0 && a.preview?.rows?.length) {
    const col = a.preview.columns.find((c) => /店|仓/.test(c)) ?? a.preview.columns[0];
    if (col) a.preview.rows.forEach((r) => set.add(String(r[col] ?? '')));
  }
  return [...set];
}

const emptyFilter = { kw: '', level: 'all' as string, status: 'all' as string, dept: 'all' as string, person: 'all' as string, store: 'all' as string, start: '', end: '' };

export function AlertList({ onBack }: { onBack: () => void }) {
  const { state, addAlert, updateAlertStatus } = useStore();
  const PEOPLE = PERSONNEL as unknown as { name: string; dept: string }[];
  const alerts = useMemo(() => state.alerts ?? [], [state.alerts]);
  const pending = alerts.filter((a) => a.status === 'new' || a.status === 'accepted' || a.status === 'processing').length;

  const [creating, setCreating] = useState(false);
  const [ruleId, setRuleId] = useState(state.rules[0]?.id ?? '');
  const [level, setLevel] = useState<AlertTask['level']>('warn');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [reason, setReason] = useState('');
  const [handoffId, setHandoffId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [filter, setFilter] = useState(emptyFilter);
  const [confirmBox, setConfirmBox] = useState<{ title: string; desc: string; confirmLabel: string; onConfirm: () => void } | null>(null);
  const rules = state.rules;

  const deptOptions = useMemo(() => [...new Set(alerts.map((a) => a.dept).filter(Boolean))], [alerts]);
  const personOptions = useMemo(
    () => [...new Set(alerts.map((a) => a.assignee || a.handoffTo).filter(Boolean))],
    [alerts]
  );
  const storeOptions = useMemo(() => [...new Set(alerts.flatMap(alertStores))], [alerts]);

  const filtered = useMemo(() => {
    const start = filter.start ? new Date(filter.start + 'T00:00:00').getTime() : null;
    const end = filter.end ? new Date(filter.end + 'T23:59:59').getTime() : null;
    return alerts.filter((a) => {
      if (filter.kw && !(`${a.ruleName || a.title}`.toLowerCase().includes(filter.kw.toLowerCase()))) return false;
      if (filter.level !== 'all' && (a.level ?? 'warn') !== filter.level) return false;
      if (filter.status !== 'all' && a.status !== filter.status) return false;
      if (filter.dept !== 'all' && a.dept !== filter.dept) return false;
      if (filter.person !== 'all' && a.assignee !== filter.person && a.handoffTo !== filter.person) return false;
      if (filter.store !== 'all' && !alertStores(a).includes(filter.store)) return false;
      if (start && a.createdAt < start) return false;
      if (end && a.createdAt > end) return false;
      return true;
    });
  }, [alerts, filter]);

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
    setReason('');
  };

  const SelectCls =
    'h-7 whitespace-nowrap rounded border border-gray-200 bg-white px-2 text-xs text-gray-600 outline-none transition-colors hover:border-gray-300 focus:border-gray-400';

  return (
    <div className="flex h-screen flex-col bg-[#F7F8FA]">
      {/* 顶栏 */}
      <div className="flex items-center gap-3 border-b border-gray-100 bg-white px-6 py-3.5">
        <button onClick={onBack} className="rounded-md p-1 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700" title="返回">
          <ArrowLeft size={17} />
        </button>
        <h1 className="text-sm font-semibold text-gray-800">预警列表</h1>
        {pending > 0 && <span className="text-xs font-medium text-gray-400">{pending} 条待处理</span>}
        <div className="ml-auto">
          <button
            onClick={() => setCreating(true)}
            className="inline-flex items-center gap-1.5 rounded border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50"
          >
            <Plus size={14} /> 生成预警
          </button>
        </div>
      </div>

      {/* 筛选栏 */}
      <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 bg-white px-6 py-2.5">
        <input
          value={filter.kw}
          onChange={(e) => setFilter({ ...filter, kw: e.target.value })}
          placeholder="标题"
          className="h-7 w-40 rounded border border-gray-200 bg-white px-2 text-xs text-gray-700 outline-none transition-colors focus:border-gray-400"
        />
        <input type="date" value={filter.start} onChange={(e) => setFilter({ ...filter, start: e.target.value })} className={SelectCls} />
        <span className="text-xs text-gray-300">至</span>
        <input type="date" value={filter.end} onChange={(e) => setFilter({ ...filter, end: e.target.value })} className={SelectCls} />
        <select value={filter.level} onChange={(e) => setFilter({ ...filter, level: e.target.value })} className={SelectCls}>
          <option value="all">重要程度</option>
          {Object.keys(LEVEL_META).map((k) => (
            <option key={k} value={k}>{LEVEL_META[k].label}（{k}级）</option>
          ))}
        </select>
        <select value={filter.status} onChange={(e) => setFilter({ ...filter, status: e.target.value })} className={SelectCls}>
          <option value="all">完成状态</option>
          {(Object.keys(STATUS_META) as AlertStatus[]).map((k) => (
            <option key={k} value={k}>{STATUS_META[k].label}</option>
          ))}
        </select>
        <select value={filter.dept} onChange={(e) => setFilter({ ...filter, dept: e.target.value })} className={SelectCls}>
          <option value="all">适用部门</option>
          {deptOptions.map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
        <select value={filter.person} onChange={(e) => setFilter({ ...filter, person: e.target.value })} className={SelectCls}>
          <option value="all">适用人员</option>
          {personOptions.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
        <select value={filter.store} onChange={(e) => setFilter({ ...filter, store: e.target.value })} className={SelectCls}>
          <option value="all">适用店仓</option>
          {storeOptions.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <button
          onClick={() => setFilter(emptyFilter)}
          className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-gray-400 transition-colors hover:bg-gray-50 hover:text-gray-600"
          title="重置筛选"
        >
          <RotateCcw size={12} /> 重置
        </button>
        <span className="ml-auto text-xs tabular-nums text-gray-400">{filtered.length} 条</span>
      </div>

      {/* 列表 */}
      <div className="min-h-0 flex-1 overflow-auto">
        {filtered.length === 0 ? (
          <div className="mt-24 flex flex-col items-center gap-2 text-center text-sm text-gray-400">
            <Bell size={30} className="text-gray-300" />
            <p>暂无预警。</p>
            <p className="text-xs">调整筛选条件，或点击右上角「生成预警」。</p>
          </div>
        ) : (
          <table className="w-full border-collapse bg-white text-xs">
            <thead>
              <tr className="sticky top-0 z-10 bg-white text-left text-xs text-gray-400">
                <th className="whitespace-nowrap px-4 py-3 pl-6 font-medium">序号</th>
                <th className="min-w-44 whitespace-nowrap px-4 py-3 font-medium">标题</th>
                <th className="whitespace-nowrap px-4 py-3 font-medium">预警条数</th>
                <th className="whitespace-nowrap px-4 py-3 font-medium">重要程度</th>
                <th className="whitespace-nowrap px-4 py-3 font-medium">适用部门</th>
                <th className="whitespace-nowrap px-4 py-3 font-medium">适用人员</th>
                <th className="whitespace-nowrap px-4 py-3 font-medium">创建人</th>
                <th className="whitespace-nowrap px-4 py-3 font-medium">创建时间</th>
                <th className="whitespace-nowrap px-4 py-3 font-medium">已过时间</th>
                <th className="whitespace-nowrap px-4 py-3 font-medium">状态</th>
                <th className="whitespace-nowrap px-4 py-3 pr-6 font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((a, idx) => {
                const lv = (LEVEL_META[(a.level ?? 'warn') as keyof typeof LEVEL_META] ?? LEVEL_META.warn);
                const st = STATUS_META[a.status];
                const count = a.preview?.storeMessages?.length ?? a.preview?.rows?.length ?? 0;
                const stores = a.preview?.storeMessages ?? [];
                const actions: { label: string; fn: () => void; cls: string }[] = [];
                if (a.status === 'new') {
                  actions.push({
                    label: '接受',
                    fn: () =>
                      setConfirmBox({
                        title: '确认接受该预警？',
                        desc: `将「${a.ruleName || a.title || '该预警'}」分配给 ${a.assignee || '当前用户'}，状态改为「已接受」。`,
                        confirmLabel: '确认接受',
                        onConfirm: () => updateAlertStatus(a.id, { status: 'accepted', assignee: a.assignee || '当前用户', updatedAt: Date.now() }),
                      }),
                    cls: 'bg-gray-800 text-white hover:bg-gray-700',
                  });
                } else if (a.status === 'accepted') {
                  actions.push({
                    label: '开始处理',
                    fn: () => updateAlertStatus(a.id, { status: 'processing', updatedAt: Date.now() }),
                    cls: 'bg-gray-800 text-white hover:bg-gray-700',
                  });
                } else if (a.status === 'processing') {
                  actions.push({
                    label: '已处理',
                    fn: () => updateAlertStatus(a.id, { status: 'done', updatedAt: Date.now() }),
                    cls: 'bg-gray-800 text-white hover:bg-gray-700',
                  });
                }
                if (a.status === 'new' || a.status === 'accepted' || a.status === 'processing') {
                  actions.push({
                    label: '转交',
                    fn: () => setHandoffId(a.id),
                    cls: 'border border-gray-200 bg-white text-gray-500 hover:bg-gray-50',
                  });
                  actions.push({
                    label: '无法完成',
                    fn: () =>
                      setConfirmBox({
                        title: '确认标记为无法完成？',
                        desc: '确认后将「' + (a.ruleName || a.title || '该预警') + '」状态改为「无法完成」，不再视为待处理。',
                        confirmLabel: '确认无法完成',
                        onConfirm: () => updateAlertStatus(a.id, { status: 'failed', updatedAt: Date.now() }),
                      }),
                    cls: 'border border-gray-100 bg-white text-gray-300 hover:bg-gray-50',
                  });
                }
                return (
                  <Fragment key={a.id}>
                    <tr className="align-middle transition-colors last:border-0 hover:bg-gray-50/70">
                      <td className="whitespace-nowrap px-4 py-3 pl-6 text-xs tabular-nums text-gray-300">{String(idx + 1).padStart(2, '0')}</td>
                      <td className="whitespace-nowrap px-4 py-3 align-middle text-[13px] font-medium text-gray-800">
                        {a.ruleName || a.title || '—'}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs tabular-nums text-gray-600">{count}</td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <span className={`inline-flex items-center gap-1.5 text-[13px] font-medium ${lv.text}`}>
                          <i className={`h-1.5 w-1.5 shrink-0 rounded-full ${lv.dot}`} />
                          {lv.label}（{a.level ?? 'warn'}级）
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-[13px] text-gray-600">{a.dept || '—'}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-[13px] text-gray-600">
                        {a.handoffTo ? (
                          <span>{a.handoffTo}<span className="ml-1 text-[11px] text-gray-400">（转交）</span></span>
                        ) : a.assignee ? (
                          a.assignee
                        ) : (
                          <span className="text-gray-300">待分配</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-[13px] text-gray-600">{a.createdBy || '—'}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs tabular-nums text-gray-500">
                        {new Date(a.createdAt).toLocaleString('zh-CN')}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs">
                        <ElapsedCell createdAt={a.createdAt} />
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[13px] font-medium">
                          <i className={`h-1.5 w-1.5 shrink-0 rounded-full ${st.text.replace('text-', 'bg-')}`} />
                          <span className={st.text}>{st.label}</span>
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 pr-6">
                        <div className="flex items-center gap-1.5 whitespace-nowrap">
                          {actions.map((x) => (
                            <button
                              key={x.label}
                              onClick={x.fn}
                              className={`whitespace-nowrap rounded px-2 py-1 text-[11px] font-medium transition-colors ${x.cls}`}
                            >
                              {x.label}
                            </button>
                          ))}
                          {count > 0 ? (
                            <button
                              onClick={() => setOpenId(openId === a.id ? null : a.id)}
                              className="inline-flex items-center gap-1 whitespace-nowrap rounded border border-gray-200 bg-white px-2 py-1 text-[11px] font-medium text-gray-500 transition-colors hover:bg-gray-50"
                            >
                              <Eye size={12} /> 查看
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                    {openId === a.id && count > 0 ? (
                      <tr className="bg-gray-50/50">
                        <td colSpan={11} className="px-6 py-3">
                          {stores.length ? (
                            <div className="max-h-72 overflow-auto">
                              <table className="w-full border-collapse text-[12px]">
                                <thead>
                                  <tr className="text-left text-[11px] text-gray-400">
                                    <th className="whitespace-nowrap border-b border-gray-100 px-3 py-1.5 font-medium">店仓</th>
                                    <th className="whitespace-nowrap border-b border-gray-100 px-3 py-1.5 font-medium">预警消息</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {stores.map((s, si) => (
                                    <tr key={si} className="align-top">
                                      <td className="whitespace-nowrap border-b border-gray-100 px-3 py-1.5 font-medium text-gray-600">{s.store || '—'}</td>
                                      <td className="border-b border-gray-100 px-3 py-1.5 text-gray-600">{s.message}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          ) : a.preview?.rows ? (
                            <div className="max-h-60 overflow-auto rounded border border-gray-100">
                              <table className="w-full border-collapse text-[11px]">
                                <thead>
                                  <tr className="border-b bg-gray-50 text-left text-gray-400">
                                    {a.preview.columns.map((c) => (
                                      <th key={c} className="whitespace-nowrap px-2.5 py-1.5 font-medium">{c}</th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody>
                                  {a.preview.rows.slice(0, 100).map((r, ri) => (
                                    <tr key={ri} className="border-b border-gray-100">
                                      {a.preview!.columns.map((c) => (
                                        <td key={c} className="whitespace-nowrap px-2.5 py-1.5 text-gray-500">{String(r[c] ?? '')}</td>
                                      ))}
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          ) : null}
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* 生成弹窗 */}
      {creating && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/20 p-4 backdrop-blur-sm" onClick={() => setCreating(false)}>
          <div className="w-full max-w-sm rounded-lg border border-gray-200 bg-white p-5 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-800">生成预警</h3>
              <button onClick={() => setCreating(false)} className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
                <X size={15} />
              </button>
            </div>
            <label className="mb-1 block text-xs text-gray-500">关联规则</label>
            <select
              value={ruleId}
              onChange={(e) => setRuleId(e.target.value)}
              className="mb-3 w-full rounded border border-gray-200 px-3 py-2 text-sm outline-none transition-colors focus:border-gray-400"
            >
              {rules.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
            <label className="mb-1 block text-xs text-gray-500">级别</label>
            <div className="mb-3 flex gap-2">
              {(Object.keys(LEVEL_META) as AlertTask['level'][]).map((lv) => (
                <button
                  key={lv}
                  onClick={() => setLevel(lv)}
                  className={`rounded border px-3 py-1 text-xs transition-colors ${
                    level === lv ? 'border-gray-800 bg-gray-800 text-white' : 'border-gray-200 text-gray-500 hover:bg-gray-50'
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
              className="mb-2 w-full rounded border border-gray-200 px-3 py-2 text-sm outline-none transition-colors focus:border-gray-400"
            />
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="预警内容 / 说明"
              rows={3}
              className="mb-2 w-full resize-none rounded border border-gray-200 px-3 py-2 text-sm outline-none transition-colors focus:border-gray-400"
            />
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="为什么预警（触发原因，可填如上月未开单天数达到阈值等）"
              rows={2}
              className="mb-4 w-full resize-none rounded border border-gray-200 px-3 py-2 text-sm outline-none transition-colors focus:border-gray-400"
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => setCreating(false)} className="rounded px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-100">取消</button>
              <button
                onClick={createAlert}
                className="inline-flex items-center gap-1.5 rounded bg-gray-800 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-gray-700"
              >
                <Send size={14} /> 生成
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 转交弹窗 */}
      {handoffId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/20 p-4 backdrop-blur-sm" onClick={() => setHandoffId(null)}>
          <div className="w-full max-w-xs rounded-lg border border-gray-200 bg-white p-5 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-800">转交给其他人</h3>
              <button onClick={() => setHandoffId(null)} className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
                <X size={15} />
              </button>
            </div>
            <div className="max-h-64 space-y-0.5 overflow-auto">
              {PEOPLE.map((p) => (
                <button
                  key={p.name}
                  onClick={() => {
                    setConfirmBox({
                      title: '确认转交预警？',
                      desc: `确认将「${alerts.find((x) => x.id === handoffId)?.ruleName || alerts.find((x) => x.id === handoffId)?.title || '该预警'}」转交给「${p.name}（${p.dept}）」？`,
                      confirmLabel: '确认转交',
                      onConfirm: () => {
                        updateAlertStatus(handoffId, {
                          assignee: p.name,
                          handoffTo: p.name,
                          dept: p.dept,
                          status: 'processing',
                          updatedAt: Date.now(),
                        });
                        setHandoffId(null);
                      },
                    });
                  }}
                  className="flex w-full items-center justify-between rounded px-3 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-50"
                >
                  <span>{p.name}</span>
                  <span className="text-xs text-gray-400">{p.dept}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 二次确认弹窗（接受 / 转交 / 无法完成） */}
      {confirmBox && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/20 p-4 backdrop-blur-sm" onClick={() => setConfirmBox(null)}>
          <div className="w-full max-w-xs rounded-lg border border-gray-200 bg-white p-5 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-50 text-amber-500">
                <AlertTriangle size={17} />
              </div>
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-gray-800">{confirmBox.title}</h3>
                <p className="mt-1 text-xs leading-relaxed text-gray-500">{confirmBox.desc}</p>
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setConfirmBox(null)}
                className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-500 transition-colors hover:bg-gray-50"
              >
                取消
              </button>
              <button
                onClick={() => {
                  confirmBox.onConfirm();
                  setConfirmBox(null);
                }}
                className="rounded-md bg-gray-800 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-gray-700"
              >
                {confirmBox.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}