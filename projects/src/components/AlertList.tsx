'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Bell, ClipboardList, Eye, History, MessageSquare, Plus, RotateCcw, Send, X } from 'lucide-react';
import { useStore } from '@/lib/store';
import { resolvePerm, canView, filterAlertsByScope } from '@/lib/perm';
import type { AlertStatus, AlertTask, NotifyMode } from '@/lib/types';
import { PERSONNEL } from '@/lib/types';

const LEVEL_META: Record<string, { label: string; text: string; dot: string; bg: string }> = {
  info: { label: '提醒', text: 'text-blue-600', dot: 'bg-blue-500', bg: 'bg-blue-50 text-blue-600' },
  warn: { label: '预警', text: 'text-amber-600', dot: 'bg-amber-500', bg: 'bg-amber-50 text-amber-600' },
  critical: { label: '紧急', text: 'text-red-600', dot: 'bg-red-500', bg: 'bg-red-50 text-red-600' },
  remind: { label: '提醒', text: 'text-blue-600', dot: 'bg-blue-500', bg: 'bg-blue-50 text-blue-600' },
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

/** 预警处理时长：process 中实时计时，完成/失败后按起止统计 */
function formatDur(start: number, end: number): string {
  const s = Math.max(0, Math.floor((end - start) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h >= 1) return `${h} 小时 ${m} 分`;
  if (m >= 1) return `${m} 分 ${sec} 秒`;
  return `${sec} 秒`;
}

/** 同类预警标识：同一规则 + 同一触发主体（店仓/款色等首行 store 值），用于「历史预警」归并 */
function historyKeyOf(a: AlertTask): string {
  const ent = a.preview?.storeMessages?.[0]?.store ?? '';
  return `${a.ruleId || a.ruleName || 'manual'}::${ent}`;
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

const emptyFilter = { kw: '', level: 'all' as string, status: 'all' as string, person: 'all' as string, start: '', end: '' };

/** 快捷日期标签定义 */
const QUICK_TAGS: { key: string; label: string }[] = [
  { key: 'today', label: '今天' },
  { key: 'yesterday', label: '昨天' },
  { key: 'thisWeek', label: '本周' },
  { key: 'lastWeek', label: '上周' },
  { key: 'thisMonth', label: '本月' },
  { key: 'lastMonth', label: '上月' },
];

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function toYMD(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** 返回某快捷日期对应的 [start, end]（'YYYY-MM-DD'），用于驱动 filter.start/end */
function quickRange(key: string): { start: string; end: string } {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const ONE = 86400000;
  if (key === 'today') return { start: toYMD(today), end: toYMD(today) };
  if (key === 'yesterday') {
    const d = new Date(today.getTime() - ONE);
    return { start: toYMD(d), end: toYMD(d) };
  }
  const dow = today.getDay() || 7; // 周日=0 => 7
  const monday = new Date(today.getTime() - (dow - 1) * ONE);
  if (key === 'thisWeek') return { start: toYMD(monday), end: toYMD(today) };
  if (key === 'lastWeek') {
    const lm = new Date(monday.getTime() - 7 * ONE);
    const le = new Date(monday.getTime() - ONE);
    return { start: toYMD(lm), end: toYMD(le) };
  }
  if (key === 'thisMonth') return { start: toYMD(new Date(today.getFullYear(), today.getMonth(), 1)), end: toYMD(today) };
  if (key === 'lastMonth') {
    const fm = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const le = new Date(today.getFullYear(), today.getMonth(), 0);
    return { start: toYMD(fm), end: toYMD(le) };
  }
  return { start: '', end: '' };
}

export function AlertList({ onBack }: { onBack: () => void }) {
  const { state, addAlert, updateAlertStatus } = useStore();
  const PEOPLE = PERSONNEL as unknown as { name: string; dept: string }[];
  const [meName] = useState<string>(() => (typeof window !== 'undefined' ? localStorage.getItem('dn_auth') || '' : ''));
  const me = state.persons.find((p) => p.name === meName) ?? null;
  const perm = resolvePerm(me, state.config);
  const isManager = canView(perm, 'perms');
  const alerts = useMemo(
    () => filterAlertsByScope(state.alerts ?? [], me, perm.dataScope, state.stores ?? []),
    [state.alerts, me, perm.dataScope, state.stores]
  );
  const pending = alerts.filter((a) => a.status === 'new' || a.status === 'accepted' || a.status === 'processing').length;

  const [creating, setCreating] = useState(false);
  const [ruleId, setRuleId] = useState(state.rules[0]?.id ?? '');
  const [level, setLevel] = useState<AlertTask['level']>('warn');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [reason, setReason] = useState('');
  const [handoffId, setHandoffId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [showHist, setShowHist] = useState(false);
  const [confirm, setConfirm] = useState<null | { title: string; desc?: string; needText?: boolean; required?: boolean; placeholder?: string; onOk: (t: string) => void }>(null);
  const [chatDraft, setChatDraft] = useState('');
  const [planDraft, setPlanDraft] = useState('');
  const [replyTarget, setReplyTarget] = useState<string | null>(null);
  const [replyDraft, setReplyDraft] = useState('');
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const openIdx = alerts.findIndex((x) => x.id === openId);
  const openForSync = openIdx >= 0 ? alerts[openIdx] : null;
  useEffect(() => {
    if (openForSync) setPlanDraft(openForSync.plan || '');
  }, [openForSync?.id]);
  const [confirmText, setConfirmText] = useState('');
  const openConfirm = (c: NonNullable<typeof confirm>) => {
    setConfirmText('');
    setConfirm(c);
  };
  const [filter, setFilter] = useState(emptyFilter);
  const [quickKey, setQuickKey] = useState('');
  const rules = state.rules;
  const groupNameById = useMemo(() => {
    const m = new Map<string, string>();
    (state.ruleGroups ?? []).forEach((g) => m.set(g.id, g.name));
    return m;
  }, [state.ruleGroups]);
  const groupOf = useMemo(() => {
    const m = new Map<string, string>();
    (state.rules ?? []).forEach((r) => {
      if (r.groupId && groupNameById.has(r.groupId)) m.set(r.id, groupNameById.get(r.groupId)!);
    });
    return m;
  }, [state.rules, groupNameById]);

  const personOptions = useMemo(
    () => [...new Set(alerts.map((a) => a.assignee || a.handoffTo).filter(Boolean))],
    [alerts]
  );
  const filtered = useMemo(() => {
    const start = filter.start ? new Date(filter.start + 'T00:00:00').getTime() : null;
    const end = filter.end ? new Date(filter.end + 'T23:59:59').getTime() : null;
    return alerts.filter((a) => {
      if (filter.kw && !(`${a.ruleName || a.title}`.toLowerCase().includes(filter.kw.toLowerCase()))) return false;
      if (filter.level !== 'all' && (a.level ?? 'warn') !== filter.level) return false;
      if (filter.status !== 'all' && a.status !== filter.status) return false;
      if (filter.person !== 'all' && a.assignee !== filter.person && a.handoffTo !== filter.person) return false;
      if (start && a.createdAt < start) return false;
      if (end && a.createdAt > end) return false;
      return true;
    });
  }, [alerts, filter]);

  const stats = useMemo(() => {
    const total = filtered.length;
    const done = filtered.filter((a) => a.status === 'done').length;
    const failed = filtered.filter((a) => a.status === 'failed').length;
    const undone = total - done - failed;
    return { total, done, undone, failed };
  }, [filtered]);

  const applyQuick = (key: string) => {
    const r = quickRange(key);
    setQuickKey(key);
    setFilter({ ...filter, start: r.start, end: r.end });
  };

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
            <option key={k} value={k}>{LEVEL_META[k].label}</option>
          ))}
        </select>
        <select value={filter.status} onChange={(e) => setFilter({ ...filter, status: e.target.value })} className={SelectCls}>
          <option value="all">完成状态</option>
          {(Object.keys(STATUS_META) as AlertStatus[]).map((k) => (
            <option key={k} value={k}>{STATUS_META[k].label}</option>
          ))}
        </select>
        <select value={filter.person} onChange={(e) => setFilter({ ...filter, person: e.target.value })} className={SelectCls}>
          <option value="all">接收人</option>
          {personOptions.map((p) => (
            <option key={p} value={p}>{p}</option>
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

      {/* 快捷日期 + 统计 */}
      <div className="border-b border-gray-100 bg-white px-6 py-2.5">
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          {QUICK_TAGS.map((t) => (
            <button
              key={t.key}
              onClick={() => applyQuick(t.key)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                quickKey === t.key
                  ? 'bg-gray-800 text-white'
                  : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
              }`}
            >
              {t.label}
            </button>
          ))}
          <button
            onClick={() => {
              setQuickKey('');
              setFilter({ ...filter, start: '', end: '' });
            }}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              quickKey === '' ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
            }`}
          >
            全部
          </button>
        </div>
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: '预警条数', value: stats.total, text: 'text-gray-800', sub: `${filtered.length} 条` },
            { label: '已完成', value: stats.done, text: 'text-green-600', sub: `done` },
            { label: '未完成', value: stats.undone, text: 'text-amber-600', sub: `new/accepted/processing` },
            { label: '无法完成', value: stats.failed, text: 'text-red-500', sub: `failed` },
          ].map((s) => (
            <div key={s.label} className="rounded-lg border border-gray-100 bg-[#F7F8FA] px-3 py-2.5">
              <div className="text-[11px] text-gray-400">{s.label}</div>
              <div className={`mt-1 text-xl font-semibold tabular-nums ${s.text}`}>{s.value}</div>
              <div className="mt-0.5 text-[10px] text-gray-300">{s.sub}</div>
            </div>
          ))}
        </div>
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
                <th className="w-14 whitespace-nowrap px-4 py-3 pl-6 font-medium">序号</th>
                <th className="min-w-44 whitespace-nowrap px-4 py-3 font-medium">预警标题</th>
                <th className="whitespace-nowrap px-4 py-3 font-medium">重要程度</th>
                <th className="whitespace-nowrap px-4 py-3 font-medium">预警分组</th>
                <th className="whitespace-nowrap px-4 py-3 font-medium">条数</th>
                <th className="whitespace-nowrap px-4 py-3 font-medium">接收人</th>
                <th className="whitespace-nowrap px-4 py-3 font-medium">已过时间</th>
                <th className="whitespace-nowrap px-4 py-3 font-medium">处理耗时</th>
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
                const dur = a.startedAt ? formatDur(a.startedAt, a.handledAt ?? now) : null;
                return (
                  <Fragment key={a.id}>
                    <tr className="align-middle transition-colors last:border-0 hover:bg-gray-50/70">
                      <td className="whitespace-nowrap px-4 py-3 pl-6 align-middle text-[13px] tabular-nums text-gray-400">{idx + 1}</td>
                      <td className="min-w-44 whitespace-nowrap px-4 py-3 align-middle">
                        <div className="text-[13px] font-medium text-gray-800">{a.title || '—'}</div>
                        {a.ruleName ? <div className="mt-0.5 text-[11px] text-gray-400">{a.ruleName}</div> : null}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-medium ${lv.bg}`}>
                          <i className={`h-1.5 w-1.5 shrink-0 rounded-full ${lv.dot}`} />
                          {lv.label}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-[13px] text-gray-600">{groupOf.get(a.ruleId) || '—'}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs tabular-nums text-gray-600">{count}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-[13px] text-gray-600">
                        {a.handoffTo ? (
                          <span>{a.handoffTo}<span className="ml-1 text-[11px] text-gray-400">（转交）</span></span>
                        ) : a.assignee ? (
                          a.assignee
                        ) : (
                          <span className="text-gray-300">待分配</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs">
                        <ElapsedCell createdAt={a.createdAt} />
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs tabular-nums text-gray-600">
                        {dur ? <span className={a.status === 'processing' ? 'text-violet-500' : ''}>{dur}</span> : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[13px] font-medium">
                          <i className={`h-1.5 w-1.5 shrink-0 rounded-full ${st.text.replace('text-', 'bg-')}`} />
                          <span className={st.text}>{st.label}</span>
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 pr-6">
                        <div className="flex items-center gap-1.5 whitespace-nowrap">
                          {count > 0 ? (
                            <button
                              onClick={() => setOpenId(a.id)}
                              className="inline-flex items-center gap-1 whitespace-nowrap rounded border border-gray-200 bg-white px-3 py-1 text-[11px] font-medium text-gray-600 transition-colors hover:bg-gray-50"
                            >
                              <Eye size={12} /> 查看
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
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

      {/* 查看弹窗 */}
      {(() => {
        const open = openId ? alerts.find((a) => a.id === openId) ?? null : null;
        if (!open) return null;
        const lv = LEVEL_META[(open.level ?? 'warn') as keyof typeof LEVEL_META] ?? LEVEL_META.warn;
        const st = STATUS_META[open.status];
        const stores = open.preview?.storeMessages ?? [];
        const scopeNames = [...new Set(stores.map((s) => s.store).filter(Boolean))] as string[];
        let detailRows = open.preview?.rows ?? [];
        if (scopeNames.length) {
          const keep = detailRows.filter((r) => scopeNames.some((nm) => Object.values(r).some((v) => String(v) === nm)));
          if (keep.length) detailRows = keep;
        }
        const recipient = open.handoffTo ? (
          <span>{open.handoffTo}<span className="ml-1 text-[11px] text-gray-400">（转交）</span></span>
        ) : open.assignee ? (
          open.assignee
        ) : (
          <span className="text-gray-300">待分配</span>
        );
        const comments = open.comments ?? [];
        const sendMsg = () => {
          const text = (chatDraft || '').trim();
          if (!text) return;
          updateAlertStatus(open.id, {
            comments: [...comments, { id: `c${Date.now()}`, by: meName || '当前用户', text, at: Date.now() }],
            updatedAt: Date.now(),
          });
          setChatDraft('');
        };
        const sendReply = (cid: string) => {
          const text = (replyDraft || '').trim();
          if (!text) return;
          updateAlertStatus(open.id, {
            comments: comments.map((c) =>
              c.id === cid ? { ...c, replies: [...(c.replies ?? []), { id: `r${Date.now()}`, by: meName || '当前用户', text, at: Date.now() }] } : c
            ),
            updatedAt: Date.now(),
          });
          setReplyDraft('');
          setReplyTarget(null);
        };
        const delComment = (cid: string) => {
          const c = comments.find((x) => x.id === cid);
          if (!c) return;
          const ownFresh = c.by === meName && now - c.at <= 3600000;
          if (!(ownFresh || isManager)) return;
          openConfirm({
            title: ownFresh ? '撤回这条留言？' : '删除这条留言？',
            desc: `${c.by} · ${new Date(c.at).toLocaleString('zh-CN')}`,
            onOk: () => updateAlertStatus(open.id, { comments: comments.filter((x) => x.id !== cid), updatedAt: Date.now() }),
          });
        };
        const delReply = (cid: string, rid: string) => {
          const c = comments.find((x) => x.id === cid);
          if (!c) return;
          const r = (c.replies ?? []).find((x) => x.id === rid);
          if (!r) return;
          const ownFresh = r.by === meName && now - r.at <= 3600000;
          if (!(ownFresh || isManager)) return;
          openConfirm({
            title: ownFresh ? '撤回这条回复？' : '删除这条回复？',
            desc: `${r.by} · ${new Date(r.at).toLocaleString('zh-CN')}`,
            onOk: () => updateAlertStatus(open.id, { comments: comments.map((x) => (x.id === cid ? { ...x, replies: (x.replies ?? []).filter((y) => y.id !== rid) } : x)), updatedAt: Date.now() }),
          });
        };
        const personMeta = (name: string) => {
          const p = state.persons.find((x) => x.name === name);
          return {
            dept: p ? (state.orgs.find((o) => o.id === p.orgId)?.name ?? '') : '',
            title: p?.title ?? '',
            post: p?.post ?? '',
          };
        };
        const onEnter = (e: React.KeyboardEvent<HTMLInputElement>) => {
          if (e.key === 'Enter') { e.preventDefault(); sendMsg(); }
        };
        const hKey = historyKeyOf(open);
        const history = alerts
          .filter((a) => a.id !== open.id && historyKeyOf(a) === hKey)
          .sort((x, y) => (y.updatedAt ?? y.createdAt ?? 0) - (x.updatedAt ?? x.createdAt ?? 0));
        return (
          <div className="fixed inset-0 z-50 flex flex-col bg-white">
            <style>{`@keyframes alertPop{from{opacity:0;transform:translateY(8px) scale(.985)}to{opacity:1;transform:none}}.alert-pop{animation:alertPop .18s ease-out}`}</style>
            <div className="flex min-h-0 flex-1" onClick={(e) => e.stopPropagation()}>
              {showHist ? (
                <aside className="flex w-72 shrink-0 flex-col border-r border-gray-100 bg-gray-50/40">
                  <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
                    <div className="flex items-center gap-2 text-sm font-medium text-gray-800">
                      <History size={15} className="text-gray-400" />
                      历史预警
                    </div>
                    <button onClick={() => setShowHist(false)} className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
                      <X size={15} />
                    </button>
                  </div>
                  <div className="min-h-0 flex-1 space-y-1 overflow-auto px-2.5 py-2">
                    {history.length ? (
                      history.map((h) => {
                        const hl = (LEVEL_META[(h.level ?? 'warn') as keyof typeof LEVEL_META] ?? LEVEL_META.warn);
                        const hs = STATUS_META[h.status];
                        return (
                          <button
                            key={h.id}
                            onClick={() => setOpenId(h.id)}
                            className={`w-full rounded-lg px-3 py-2 text-left transition-colors ${h.id === open.id ? 'bg-white shadow-sm' : 'hover:bg-white/70'}`}
                          >
                            <div className="flex items-center gap-1.5">
                              <i className={`h-1.5 w-1.5 shrink-0 rounded-full ${hl.dot}`} />
                              <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-gray-700">{h.title || '—'}</span>
                            </div>
                            <div className="mt-1 flex items-center justify-between text-[11px]">
                              <span className="text-gray-400">{new Date(h.createdAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                              <span className={hs.text}>{hs.label}</span>
                            </div>
                          </button>
                        );
                      })
                    ) : (
                      <p className="pt-8 text-center text-xs text-gray-300">暂无相同的历史预警</p>
                    )}
                  </div>
                </aside>
              ) : null}
                <div className="flex min-w-0 flex-1 flex-col">
              {/* 头部 */}
              <div className="flex items-start gap-3 px-6 pt-5 pb-4">
                <span className={`mt-0.5 inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-medium ${lv.bg}`}>
                  <i className={`h-1.5 w-1.5 shrink-0 rounded-full ${lv.dot}`} />
                  {lv.label}
                </span>
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-[15px] font-medium leading-snug text-gray-900">{open.title || '—'}</h3>
                  {open.ruleName ? <p className="mt-0.5 truncate text-xs text-gray-400">{open.ruleName}</p> : null}
                </div>
                <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                  {buildActions(open, updateAlertStatus, setHandoffId, openConfirm, meName).map((x) => (
                    <button
                      key={x.label}
                      onClick={x.fn}
                      className={`whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${x.cls}`}
                    >
                      {x.label}
                    </button>
                  ))}
                  <button
                    onClick={() => setShowHist((v) => !v)}
                    className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50"
                  >
                    <History size={13} />
                    历史预警
                    {history.length ? <span className="rounded-full bg-gray-800 px-1.5 text-[10px] font-semibold text-white">{history.length}</span> : null}
                  </button>
                  <button
                    onClick={() => setOpenId(null)}
                    className="rounded p-1 text-gray-400 transition-colors hover:bg-gray-50 hover:text-gray-600"
                  >
                    <X size={16} />
                  </button>
                </div>
              </div>
              {/* 元信息 */}
              <div className="grid grid-cols-2 gap-x-6 gap-y-2 border-y border-gray-100 bg-gray-50/40 px-6 py-3 text-xs sm:grid-cols-5">
                <div><dt className="text-gray-400">接收人</dt><dd className="mt-0.5 truncate text-gray-700">{recipient}</dd></div>
                <div><dt className="text-gray-400">状态</dt><dd className={`mt-0.5 font-medium ${st.text}`}>{st.label}</dd></div>
                <div><dt className="text-gray-400">预警分组</dt><dd className="mt-0.5 truncate text-gray-700">{groupOf.get(open.ruleId) || '—'}</dd></div>
                <div><dt className="text-gray-400">已过时间</dt><dd className="mt-0.5">　<ElapsedCell createdAt={open.createdAt} /></dd></div>
                <div><dt className="text-gray-400">处理时长</dt><dd className="mt-0.5 tabular-nums text-gray-700">{open.startedAt ? formatDur(open.startedAt, open.handledAt ?? now) : '—'}</dd></div>
              </div>
              {/* 正文 */}
              <div className="min-h-0 flex-1 overflow-auto px-6 py-4">
                <div className="rounded-lg border-l-2 border-violet-400 bg-violet-50/50 px-3 py-2">
                  <p className="text-[14px] font-medium leading-relaxed text-gray-800">{open.content || open.reason || '规则命中产生预警。'}</p>
                </div>
                {open.preview?.recipients?.length ? (
                  <div className="mt-4">
                    <h4 className="mb-2 text-xs font-medium text-gray-400">通知对象</h4>
                    <div className="space-y-1">{renderRecipients(open.preview.recipients)}</div>
                  </div>
                ) : null}
                {open.preview?.columns?.length || stores.length ? (
                  <div className="mt-4">
                    <div className="mb-2 flex items-end justify-between">
                      <h4 className="text-sm font-semibold text-violet-600">判断命中明细</h4>
                      {detailRows.length ? (
                        <span className="text-[11px] text-gray-300">命中 {detailRows.length} 行</span>
                      ) : null}
                    </div>
                    {open.conditionDesc ? <p className="mb-1 text-[11px] leading-relaxed text-gray-400">{open.conditionDesc}</p> : null}
                    {scopeNames.length ? <p className="mb-2 text-[11px] text-gray-400">命中店铺：{scopeNames.join('、')}</p> : null}
                    {open.preview?.columns?.length ? (
                      <div className="overflow-auto rounded-lg border border-gray-100">
                        <table className="w-full border-collapse text-[11px]">
                          <thead>
                            <tr className="bg-gray-50/40 text-left text-gray-400">
                              {open.preview.columns.map((c) => (
                                <th key={c} className="whitespace-nowrap px-2.5 py-2 font-medium">{c}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {detailRows.slice(0, 100).map((r, ri) => (
                              <tr key={ri} className="border-t border-gray-50">
                                {open.preview!.columns.map((c) => (
                                  <td key={c} className="whitespace-nowrap px-2.5 py-2 text-gray-500">{String(r[c] ?? '')}</td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : stores.length ? (
                      <div className="space-y-1 rounded-lg border border-gray-100 bg-gray-50/40 px-3 py-2 text-[12px] text-gray-600">
                        {stores.map((s, si) => (
                          <div key={si}>{s.store || '—'}：{s.message}</div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {(open.resolution || open.failedReason) ? (
                  <div className="mt-4 rounded-lg border border-gray-100 bg-gray-50/40 px-3 py-2">
                    {open.failedReason ? (
                      <div className="text-[12px]">
                        <span className="font-medium text-rose-500">无法完成原因</span>
                        <p className="mt-1 leading-relaxed text-gray-600">{open.failedReason}</p>
                      </div>
                    ) : open.resolution ? (
                      <div className="text-[12px]">
                        <span className="font-medium text-emerald-600">处理方案</span>
                        <p className="mt-1 leading-relaxed text-gray-600">{open.resolution}</p>
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {/* 预警处理方式：数据表下方、留言上方的计划输入 */}
                <div className="mt-4 border-t border-gray-100 pt-4">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-gray-400">
                    <ClipboardList size={13} />
                    预警处理方式
                  </div>
                  <textarea
                    value={planDraft}
                    onChange={(e) => setPlanDraft(e.target.value)}
                    onBlur={() => { if (planDraft !== (openForSync?.plan || '')) updateAlertStatus(open.id, { plan: planDraft }); }}
                    rows={3}
                    placeholder="请填写此条预警你的处理方式，你准备如何解决这条预警，写出可行方案，立刻执行，问题解决多了，就可以得到你心里想要的结果了"
                    className="mt-2.5 w-full resize-none rounded-md border border-gray-200 bg-gray-50 px-3 py-2.5 text-[13px] leading-relaxed text-gray-700 outline-none transition placeholder:text-gray-300 focus:border-gray-300 focus:bg-white"
                  />
                </div>
                {/* 留言：所有看到此预警的人都可留言，展示在数据表下方 */}
                <div className="mt-4 border-t border-gray-100 pt-4">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-gray-400">
                    <MessageSquare size={13} />
                    留言（{comments.length}）
                  </div>
                  <div className="mt-2.5 space-y-3">
                    {comments.length === 0 ? (
                      <p className="text-xs text-gray-300">暂无留言，所有看到此预警的人均可留言。</p>
                    ) : (
                      comments.map((c) => {
                        const meta = personMeta(c.by);
                        const btns = [meta.dept, meta.title, meta.post].filter(Boolean).join(' · ');
                        return (
                          <div key={c.id} className="rounded-md border border-gray-100 bg-white p-2.5">
                            <div className="flex items-start gap-2">
                              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-800/90 text-[10px] font-semibold text-white">{c.by.charAt(0) || '?'}</span>
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5 text-[11px]">
                                  <span className="font-medium text-gray-700">{c.by}</span>
                                  {btns ? <span className="text-gray-400">{btns}</span> : null}
                                  <span className="ml-auto shrink-0 text-gray-300">{new Date(c.at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                                </div>
                                <p className="mt-1 text-[13px] leading-relaxed text-gray-700">{c.text}</p>
                              </div>
                            </div>
                            <div className="mt-1.5 flex items-center gap-2 pl-8">
                              <button
                                onClick={() => { setReplyTarget(replyTarget === c.id ? null : c.id); setReplyDraft(''); }}
                                className="text-[11px] text-gray-400 transition-colors hover:text-gray-600"
                              >回复</button>
                              {c.by === meName && now - c.at <= 3600000 ? (
                                <button onClick={() => delComment(c.id)} className="text-[11px] text-gray-400 transition-colors hover:text-gray-600">撤回</button>
                              ) : null}
                              {isManager ? (
                                <button onClick={() => delComment(c.id)} className="text-[11px] text-rose-400 transition-colors hover:text-rose-600">删除</button>
                              ) : null}
                              {replyTarget === c.id ? (
                                <div className="mt-1.5 flex items-center gap-2">
                                  <input
                                    autoFocus
                                    value={replyDraft}
                                    onChange={(e) => setReplyDraft(e.target.value)}
                                    onKeyDown={(e) => { if (e.key === 'Enter') sendReply(c.id); }}
                                    placeholder="回复留言…"
                                    className="h-7 flex-1 rounded border border-gray-200 bg-gray-50 px-2 text-xs text-gray-700 outline-none transition focus:border-gray-300 focus:bg-white"
                                  />
                                  <button
                                    onClick={() => sendReply(c.id)}
                                    disabled={!replyDraft.trim()}
                                    className="inline-flex h-7 items-center rounded bg-gray-800 px-2 text-xs text-white transition-colors hover:bg-gray-700 disabled:opacity-40"
                                  >回复</button>
                                </div>
                              ) : null}
                              {c.replies && c.replies.length > 0 ? (
                                <div className="mt-2 space-y-1.5 border-l-2 border-gray-100 pl-2">
                                  {c.replies.map((r) => {
                                    const rm = personMeta(r.by);
                                    const rbtns = [rm.dept, rm.title, rm.post].filter(Boolean).join(' · ');
                                    return (
                                      <div key={r.id} className="flex items-start gap-1.5">
                                        <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-gray-300 text-[8px] font-semibold text-white">{r.by.charAt(0) || '?'}</span>
                                        <div className="min-w-0 flex-1">
                                          <div className="flex items-center gap-1.5 text-[10px]">
                                            <span className="font-medium text-gray-500">{r.by}</span>
                                            {rbtns ? <span className="text-gray-300">{rbtns}</span> : null}
                                            <span className="ml-auto shrink-0 text-gray-300">{new Date(r.at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                                          </div>
                                          <p className="mt-0.5 text-[12px] leading-relaxed text-gray-600">{r.text}</p>
                                          <div className="mt-0.5 flex items-center gap-2">
                                            {r.by === meName && now - r.at <= 3600000 ? (
                                              <button onClick={() => delReply(c.id, r.id)} className="text-[10px] text-gray-300 transition-colors hover:text-gray-500">撤回</button>
                                            ) : null}
                                            {isManager ? (
                                              <button onClick={() => delReply(c.id, r.id)} className="text-[10px] text-rose-300 transition-colors hover:text-rose-500">删除</button>
                                            ) : null}
                                          </div>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              ) : null}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                  <div className="mt-2.5 flex items-center gap-2">
                    <input
                      value={chatDraft}
                      onChange={(e) => setChatDraft(e.target.value)}
                      onKeyDown={onEnter}
                      placeholder="写下你的留言…"
                      className="h-9 flex-1 rounded-md border border-gray-200 bg-gray-50 px-3 text-[13px] text-gray-700 outline-none transition focus:border-gray-300 focus:bg-white"
                    />
                    <button
                      onClick={sendMsg}
                      disabled={!chatDraft.trim()}
                      className="inline-flex h-9 items-center gap-1 rounded-md bg-gray-800 px-3 text-xs font-medium text-white transition-colors hover:bg-gray-700 disabled:opacity-40"
                    >
                      <Send size={13} /> 留言
                    </button>
                  </div>
                </div>
              </div>
              </div>
              </div>
            </div>
        );
      })()}

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
                    updateAlertStatus(handoffId, {
                      assignee: p.name,
                      handoffTo: p.name,
                      dept: p.dept,
                      status: 'processing',
                      updatedAt: Date.now(),
                    });
                    setHandoffId(null);
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

      {/* 操作二次确认弹窗 */}
      {confirm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-gray-900/20 p-4 backdrop-blur-sm" onClick={() => setConfirm(null)}>
          <div className="alert-pop w-full max-w-md rounded-xl border border-gray-200 bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-[15px] font-semibold text-gray-900">{confirm.title}</h3>
            {confirm.desc ? <p className="mt-1.5 text-[13px] leading-relaxed text-gray-500">{confirm.desc}</p> : null}
            {confirm.needText ? (
              <textarea
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                rows={3}
                placeholder={confirm.placeholder}
                autoFocus
                className="mt-3 w-full resize-none rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-[13px] text-gray-700 outline-none transition focus:border-gray-300 focus:bg-white"
              />
            ) : null}
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setConfirm(null)} className="rounded-md border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-500 transition-colors hover:bg-gray-50">
                取消
              </button>
              <button
                onClick={() => {
                  const need = confirm.needText && confirm.required;
                  if (need && !confirmText.trim()) return;
                  setConfirm(null);
                  confirm.onOk(confirmText.trim());
                }}
                disabled={confirm.needText && confirm.required && !confirmText.trim()}
                className="rounded-md bg-gray-800 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-gray-700 disabled:opacity-40"
              >
                确认
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

type AlertAction = { label: string; cls: string; fn: () => void };
type ConfirmReq = { title: string; desc?: string; needText?: boolean; required?: boolean; placeholder?: string; onOk: (t: string) => void };
function buildActions(
  a: AlertTask,
  update: (id: string, patch: Partial<AlertTask>) => void,
  handoff: (id: string) => void,
  ask: (c: ConfirmReq) => void,
  who = '当前用户'
): AlertAction[] {
  const N = Date.now();
  const upd = (patch: Partial<AlertTask>) => update(a.id, { ...patch, updatedAt: N });
  // 已完成/不可用 → 灰色；未完成且可操作 → 蓝色
  const blue = 'bg-blue-600 text-white shadow-sm hover:bg-blue-600/90';
  const gray = 'cursor-default bg-gray-100 text-gray-400';
  const okStart = a.status === 'new' || a.status === 'accepted';
  const okDone = a.status === 'processing';
  const okFail = a.status === 'new' || a.status === 'accepted' || a.status === 'processing';
  const okHandoff = okFail;
  const acts: AlertAction[] = [
    { label: '开始处理', cls: okStart ? blue : gray, fn: okStart ? () => ask({ title: '确认开始处理该预警？', desc: '确认后将开始计算处理时长，你将成为该预警的处理人。', onOk: () => upd({ status: 'processing', startedAt: Date.now(), assignee: a.assignee || who }) }) : () => {} },
    { label: '完成', cls: okDone ? blue : gray, fn: okDone ? () => ask({ title: '标记为已处理', needText: true, required: true, placeholder: '请填写处理方案：如何处理、如何解决该预警。（必填）', onOk: (t) => upd({ status: 'done', handledAt: Date.now(), resolution: t }) }) : () => {} },
    { label: '转交', cls: okHandoff ? 'border border-gray-200 bg-white text-gray-600 hover:bg-gray-50' : gray, fn: okHandoff ? () => handoff(a.id) : () => {} },
    { label: '无法完成', cls: okFail ? blue : gray, fn: okFail ? () => ask({ title: '标记为无法完成', needText: true, required: true, placeholder: '请说明无法完成的原因。（必填）', onOk: (t) => upd({ status: 'failed', handledAt: Date.now(), failedReason: t }) }) : () => {} },
  ];
  return acts;
}

const MODE_LABEL: Record<NotifyMode, string> = {
  manual: '手动',
  store: '按店仓',
  employee: '按员工',
  person: '按用户',
};

function renderRecipients(recipients: { mode: NotifyMode; names: string[] }[]) {
  return recipients.map((r, i) => (
    <div key={i} className="flex items-start gap-2">
      <span className="shrink-0 rounded bg-amber-500 px-1.5 py-0.5 text-[10px] font-semibold text-white">{MODE_LABEL[r.mode] ?? r.mode}</span>
      <span className="flex-1 leading-relaxed text-gray-600">
        {r.names.length ? r.names.join('、') : <span className="text-gray-400">该预警无命中通知对象</span>}
      </span>
    </div>
  ));
}