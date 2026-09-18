'use client';

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Bell, ClipboardList, Eye, MessageSquare, RotateCcw, Send, X } from 'lucide-react';
import { useStore, computeAlertDims } from '@/lib/store';
import { resolvePerm, canView, filterAlertsByScope, resolveAuthAccount } from '@/lib/perm';
import { toast } from 'sonner';
import type { AlertStatus, AlertTask, NotifyMode } from '@/lib/types';
import { PERSONNEL } from '@/lib/types';

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(/[,，]/g, '').replace(/[件个套双]/g, ''));
  return Number.isFinite(n) ? n : 0;
};




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

function ElapsedCell({ createdAt }: { createdAt: number }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(t);
  }, []);
  return <span className="text-gray-400 tabular-nums">{now ? formatElapsed(createdAt, now) : '—'}</span>;
}

const IMG_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|avif)([/?#]|$)/i;

function isImgUrl(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s || s.length > 4000) return null;
  if (/^data:image\/(?:png|jpe?g|gif|webp|svg\+xml|bmp);base64,/i.test(s)) return s;
  if (/^(https?:)?\/\//i.test(s) && IMG_EXT.test(s)) return s;
  return null;
}

function ImgCell({ value, onZoom }: { value: unknown; onZoom: (src: string) => void }) {
  const src = isImgUrl(value);
  if (!src) return <span className="whitespace-pre-wrap break-all text-gray-700">{String(value ?? '')}</span>;
  return (
    <span className="inline-block">
      <img
        src={src}
        alt=""
        loading="lazy"
        onClick={(e) => {
          e.stopPropagation();
          onZoom(src);
        }}
        className="h-[50px] w-[50px] cursor-zoom-in rounded object-cover ring-1 ring-black/5 transition-transform hover:scale-105"
      />
    </span>
  );
}

const emptyFilter = {
  kw: '',
  ruleKw: '',
  level: 'all' as string,
  status: 'all' as string,
  person: 'all' as string,
  start: '',
  end: '',
  pBrand: 'all' as string, pYear: 'all' as string, pSeason: 'all' as string, pCategory: 'all' as string, pStyle: 'all' as string,
  sBrand: 'all' as string, sCompany: 'all' as string, sDept: 'all' as string, sSalesArea: 'all' as string, sDistrict: 'all' as string,
};

/** 商品维度筛选定义（取值来自预警自身的商品维度） */
const PRODUCT_DIMS: { key: keyof typeof emptyFilter; label: string; get: (a: AlertTask) => string[] | undefined }[] = [
  { key: 'pBrand', label: '品牌', get: (a) => a.dims?.product?.brand },
  { key: 'pYear', label: '年份', get: (a) => a.dims?.product?.year },
  { key: 'pSeason', label: '季节', get: (a) => a.dims?.product?.season },
  { key: 'pCategory', label: '品类', get: (a) => a.dims?.product?.category },
  { key: 'pStyle', label: '款色', get: (a) => a.dims?.product?.style },
];

/** 店仓维度筛选定义（取值来自命中店仓的门店档案字段） */
const STORE_DIMS: { key: keyof typeof emptyFilter; label: string; get: (a: AlertTask) => string[] | undefined }[] = [
  { key: 'sBrand', label: '主营品牌', get: (a) => a.dims?.store?.brand },
  { key: 'sCompany', label: '分公司', get: (a) => a.dims?.store?.company },
  { key: 'sDept', label: '部门', get: (a) => a.dims?.store?.department },
  { key: 'sSalesArea', label: '销售区域', get: (a) => a.dims?.store?.salesArea },
  { key: 'sDistrict', label: '区部', get: (a) => a.dims?.store?.district },
];



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

export function AlertList() {
  const { state, updateAlertStatus } = useStore();
  const PEOPLE = PERSONNEL as unknown as { name: string; dept: string }[];
  const [meName] = useState<string>(() => (typeof window !== 'undefined' ? localStorage.getItem('dn_auth') || '' : ''));
  const [onlyMine, setOnlyMine] = useState<boolean>(() => (typeof window !== 'undefined' ? localStorage.getItem('dn_alert_mine') === '1' : false));
  const me = state.persons.find((p) => p.name === meName) ?? null;
  const { subject: meSubject, scopePerson } = resolveAuthAccount(state.stores ?? [], state.dealers ?? [], state.employees ?? [], meName, me);
  const perm = resolvePerm(me, state.config, meSubject);
  const isManager = canView(perm, 'perms');
  const alerts = useMemo(
    () => filterAlertsByScope(state.alerts ?? [], scopePerson ?? me, perm.dataScope, state.stores ?? []),
    [state.alerts, scopePerson, me, perm.dataScope, state.stores]
  );

  const [handoffId, setHandoffId] = useState<string | null>(null);
  const [handoffDept, setHandoffDept] = useState('');
  useEffect(() => { setHandoffDept(''); }, [handoffId]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [showHist, setShowHist] = useState(true);
  const [histTab, setHistTab] = useState<'all' | 'style'>('all');
  const [confirm, setConfirm] = useState<null | { title: string; desc?: string; needText?: boolean; required?: boolean; placeholder?: string; onOk: (t: string) => void }>(null);
  const [chatDraft, setChatDraft] = useState('');
  const [planDraft, setPlanDraft] = useState('');
  const [replyTarget, setReplyTarget] = useState<string | null>(null);
  const [lvTab, setLvTab] = useState(0);
  const [lvGroup, setLvGroup] = useState<number | null>(null);
  const [zoomSrc, setZoomSrc] = useState<string | null>(null);
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
  // 规定用时超宽限期 → 标记转派（一次性），转给指定人员
  useEffect(() => {
    const t = openForSync;
    if (!t) return;
    const dlAt = t.deadlineAt ?? 0;
    const grace = t.graceUntil ?? 0;
    const escTo = t.escalateTo ?? [];
    if (dlAt > 0 && Date.now() > grace && !t.escalated && escTo.length) {
      updateAlertStatus(t.id, { escalated: true, handoffTo: escTo.join('、'), updatedAt: Date.now() });
    }
  }, [openId, openForSync?.escalated]);
  const activeRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (showHist) activeRef.current?.scrollIntoView({ block: 'nearest' });
  }, [openId, showHist, histTab]);
  const [confirmText, setConfirmText] = useState('');
  const openConfirm = (c: NonNullable<typeof confirm>) => {
    setConfirmText('');
    setConfirm(c);
  };
  const [filter, setFilter] = useState(emptyFilter);
  const [searchMode, setSearchMode] = useState<'title' | 'rule'>('title');
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
  // 旧预警缺少 dims 时按命中内容补算，保证新旧预警都能按商品/店仓维度筛选
  const enriched = useMemo(
    () => alerts.map((a) => ({ ...a, dims: a.dims ?? computeAlertDims(a, state.stores ?? []) })),
    [alerts, state.stores]
  );
  // 各维度筛选项：从已有预警统计去重（无该维度数据的预警不产生对应选项）
  const dimOptions = useMemo(() => {
    const build = (defs: typeof PRODUCT_DIMS): Record<string, string[]> => {
      const out: Record<string, string[]> = {};
      for (const d of defs) {
        const set = new Set<string>();
        enriched.forEach((a) => (d.get(a) ?? []).forEach((v) => v && set.add(v)));
        out[d.key] = [...set].sort();
      }
      return out;
    };
    return { ...build(PRODUCT_DIMS), ...build(STORE_DIMS) };
  }, [enriched]);
  const filtered = useMemo(() => {
    const start = filter.start ? new Date(filter.start + 'T00:00:00').getTime() : null;
    const end = filter.end ? new Date(filter.end + 'T23:59:59').getTime() : null;
    return enriched.filter((a) => {
      if (filter.kw && !`${a.title}`.toLowerCase().includes(filter.kw.toLowerCase())) return false;
      if (filter.ruleKw && !`${a.ruleName}`.toLowerCase().includes(filter.ruleKw.toLowerCase())) return false;
      if (filter.level !== 'all' && (a.level ?? 'warn') !== filter.level) return false;
      if (filter.status !== 'all' && a.status !== filter.status) return false;
      if (filter.person && filter.person !== 'all' && a.assignee !== filter.person && a.handoffTo !== filter.person) return false;
      if (onlyMine && meName && a.assignee !== meName && a.handoffTo !== meName) return false;
      if (start && a.createdAt < start) return false;
      if (end && a.createdAt > end) return false;
      for (const d of PRODUCT_DIMS) if (filter[d.key] && filter[d.key] !== 'all' && !(d.get(a) ?? []).includes(filter[d.key])) return false;
      for (const d of STORE_DIMS) if (filter[d.key] && filter[d.key] !== 'all' && !(d.get(a) ?? []).includes(filter[d.key])) return false;
      return true;
    });
  }, [enriched, filter, onlyMine, meName]);

  const stats = useMemo(() => {
    const total = filtered.length;
    const pending = filtered.filter((a) => a.status === 'new').length;
    const processing = filtered.filter((a) => a.status === 'accepted' || a.status === 'processing').length;
    const done = filtered.filter((a) => a.status === 'done').length;
    const rate = total ? Math.round((done / total) * 100) : 0;
    return { total, pending, processing, done, rate };
  }, [filtered]);

  const applyQuick = (key: string) => {
    const r = quickRange(key);
    setQuickKey(key);
    setFilter({ ...filter, start: r.start, end: r.end });
  };

  

  const SelectCls =
    'h-7 whitespace-nowrap rounded border border-gray-200 bg-white px-2 text-xs text-gray-600 outline-none transition-colors hover:border-gray-300 focus:border-gray-400';

  return (
    <div className="flex h-screen flex-col bg-[#F7F8FA]">
      {/* 搜索与筛选栏 */}
      <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 bg-white px-6 py-2.5">
        <div className="inline-flex h-7 items-center overflow-hidden rounded border border-gray-200 bg-white">
          <button
            onClick={() => setSearchMode((m) => (m === 'title' ? 'rule' : 'title'))}
            className="border-r border-gray-200 px-2 text-xs font-medium text-gray-500 transition-colors hover:bg-gray-50"
            title={searchMode === 'title' ? '切换到按规则搜索' : '切换到按标题搜索'}
          >
            {searchMode === 'title' ? '标题' : '规则'}
          </button>
          <input
            value={searchMode === 'title' ? filter.kw : filter.ruleKw}
            onChange={(e) =>
              setFilter(
                searchMode === 'title' ? { ...filter, kw: e.target.value } : { ...filter, ruleKw: e.target.value }
              )
            }
            placeholder={searchMode === 'title' ? '输入标题关键字' : '输入规则关键字'}
            className="w-36 px-2 text-xs text-gray-700 outline-none focus:bg-gray-50"
          />
        </div>
        {PRODUCT_DIMS.some((d) => (dimOptions[d.key] ?? []).length) && (
          <>
            <span className="text-xs font-medium text-gray-500">按商品</span>
            {PRODUCT_DIMS.map((d) => {
              const opts = dimOptions[d.key] ?? [];
              return opts.length ? (
                <span key={d.key} className="inline-flex items-center">
                  <input
                    list={`prod-opts-${d.key}`}
                    value={filter[d.key] === 'all' ? '' : filter[d.key]}
                    onChange={(e) => setFilter({ ...filter, [d.key]: e.target.value })}
                    placeholder={d.label}
                    title={`输入关键字搜索${d.label}`}
                    className="h-7 w-28 rounded border border-gray-200 bg-white px-2 text-xs text-gray-600 outline-none transition-colors hover:border-gray-300 focus:border-gray-400"
                  />
                  <datalist id={`prod-opts-${d.key}`}>{opts.map((v) => <option key={v} value={v} />)}</datalist>
                </span>
              ) : null;
            })}
          </>
        )}
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
        <input
          list="alert-person-opts"
          value={filter.person === 'all' ? '' : filter.person}
          onChange={(e) => setFilter({ ...filter, person: e.target.value })}
          placeholder="接收人"
          title="输入关键字搜索接收人"
          className="h-7 w-28 rounded border border-gray-200 bg-white px-2 text-xs text-gray-700 outline-none transition-colors focus:border-gray-400"
        />
        <datalist id="alert-person-opts">{personOptions.map((p) => <option key={p} value={p} />)}</datalist>
        <input type="date" value={filter.start} onChange={(e) => setFilter({ ...filter, start: e.target.value })} className={SelectCls} />
        <span className="text-xs text-gray-300">至</span>
        <input type="date" value={filter.end} onChange={(e) => setFilter({ ...filter, end: e.target.value })} className={SelectCls} />
        <button
          onClick={() => setFilter(emptyFilter)}
          className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-gray-400 transition-colors hover:bg-gray-50 hover:text-gray-600"
          title="重置筛选"
        >
          <RotateCcw size={12} /> 重置
        </button>
        <div className="mx-1.5 h-4 w-px bg-gray-100" />
        <button
          onClick={() => {
            const next = !onlyMine;
            setOnlyMine(next);
            if (typeof window !== 'undefined') localStorage.setItem('dn_alert_mine', next ? '1' : '0');
          }}
          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
            onlyMine ? 'border-indigo-300 bg-indigo-50 text-indigo-700' : 'border-gray-200 bg-white text-gray-500 hover:border-gray-300 hover:bg-gray-50'
          }`}
          title="打开后仅显示当前登录账号负责的预警"
        >
          <span className={`relative h-3.5 w-6 rounded-full transition-colors ${onlyMine ? 'bg-indigo-500' : 'bg-gray-300'}`}>
            <span className={`absolute top-0.5 h-2.5 w-2.5 rounded-full bg-white shadow transition-all ${onlyMine ? 'left-3' : 'left-0.5'}`} />
          </span>
          只看我的
        </button>
      </div>

      {/* 第二行：日期 · 快捷 · 商品/店仓维度 */}
      <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 bg-white px-6 py-2">
        <div className="mx-1 h-4 w-px bg-gray-100" />
        {QUICK_TAGS.map((t) => (
          <button
            key={t.key}
            onClick={() => applyQuick(t.key)}
            className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
              quickKey === t.key ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
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
          className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
            quickKey === '' ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
          }`}
        >
          全部
        </button>
        {STORE_DIMS.some((d) => (dimOptions[d.key] ?? []).length) && (
          <>
            <div className="mx-1.5 h-4 w-px bg-gray-100" />
            <span className="text-xs font-medium text-gray-500">按店仓</span>
            {STORE_DIMS.map((d) => {
              const opts = dimOptions[d.key] ?? [];
              return opts.length ? (
                <span key={d.key} className="inline-flex items-center">
                  <input
                    list={`dim-opts-${d.key}`}
                    value={filter[d.key] === 'all' ? '' : filter[d.key]}
                    onChange={(e) => setFilter({ ...filter, [d.key]: e.target.value })}
                    placeholder={d.label}
                    title={`输入关键字搜索${d.label}`}
                    className="h-7 w-28 rounded border border-gray-200 bg-white px-2 text-xs text-gray-600 outline-none transition-colors hover:border-gray-300 focus:border-gray-400"
                  />
                  <datalist id={`dim-opts-${d.key}`}>{opts.map((v) => <option key={v} value={v} />)}</datalist>
                </span>
              ) : null;
            })}
          </>
        )}
        <span className="ml-auto text-xs tabular-nums text-gray-400">{filtered.length} 条</span>
      </div>

      {/* 统计 */}
      <div className="border-b border-gray-100 bg-white px-6 py-2.5">
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: '待处理条数', value: stats.pending, text: 'text-amber-600', sub: 'new' },
            { label: '处理中条数', value: stats.processing, text: 'text-blue-600', sub: 'accepted/processing' },
            { label: '已完成条数', value: stats.done, text: 'text-green-600', sub: 'done' },
            { label: '完成率', value: `${stats.rate}%`, text: 'text-gray-800', sub: `共 ${stats.total} 条` },
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
            <p className="text-xs">调整筛选条件，或查看预警后处理。</p>
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

      {/* 查看弹窗 */}
      {(() => {
        const open = openId ? alerts.find((a) => a.id === openId) ?? null : null;
        if (!open) return null;
        const lv = LEVEL_META[(open.level ?? 'warn') as keyof typeof LEVEL_META] ?? LEVEL_META.warn;
        const st = STATUS_META[open.status];
        const dlAt = open.deadlineAt ?? 0;
        const graceUntil = open.graceUntil ?? 0;
        const dlActive = dlAt > 0;
        const overdue = dlActive && now > dlAt;
        const locked = dlActive && now > graceUntil;
        const escNames: string[] = open.escalateTo ?? [];
        const lockedForMe = locked && !(meName && escNames.includes(meName));
        const fmtClock = (t: number) =>
          new Date(t).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        const stores = open.preview?.storeMessages ?? [];
        const scopeNames = [...new Set(stores.map((s) => s.store).filter(Boolean))] as string[];
        let detailRows = open.preview?.rows ?? [];
        if (scopeNames.length) {
          const keep = detailRows.filter((r) => scopeNames.some((nm) => Object.values(r).some((v) => String(v) === nm)));
          if (keep.length) detailRows = keep;
        }
        const focusStyle = String(open.dims?.product?.style?.[0] ?? computeAlertDims(open, state.stores)?.product?.style?.[0] ?? '');
        if (focusStyle) {
          const styleKept = detailRows.filter((r) => Object.values(r).some((v) => String(v) === focusStyle));
          if (styleKept.length) detailRows = styleKept;
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
          if (lockedForMe) { toast.error('此条预警已超时，你已没有操作权限，无法发送留言'); return; }
          updateAlertStatus(open.id, {
            comments: [...comments, { id: `c${Date.now()}`, by: meName || '当前用户', text, at: Date.now() }],
            updatedAt: Date.now(),
          });
          setChatDraft('');
        };
        const sendReply = (cid: string) => {
          const text = (replyDraft || '').trim();
          if (!text) return;
          if (lockedForMe) { toast.error('此条预警已超时，你已没有操作权限，无法回复'); return; }
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
        const sortByTime = (xs: AlertTask[]) =>
          xs.sort((x, y) => (y.updatedAt ?? y.createdAt ?? 0) - (x.updatedAt ?? x.createdAt ?? 0));
        const curStyle = String((open.dims?.product?.style?.[0] ?? '') || '').trim();
        const relatedByPerson = sortByTime(
          alerts.filter(
            (a) =>
              a.id !== open.id &&
              ((a.preview?.storeMessages ?? []).some((s) => scopeNames.includes(s.store)) ||
                (!!open.assignee && a.assignee === open.assignee)),
          ),
        );
        const relatedByStyle = curStyle
          ? sortByTime(
              alerts.filter((a) => {
                if (a.id === open.id) return false;
                const own = a.dims?.product?.style;
                let ss: string[] = [];
                if (own && own.length) ss = own;
                else ss = computeAlertDims(a, state.stores)?.product?.style ?? [];
                return ss.includes(curStyle);
              }),
            )
          : [];
        const sideList = histTab === 'all' ? relatedByPerson : relatedByStyle;
        return (
          <div className="fixed inset-0 z-50 flex flex-col bg-white">
            <style>{`@keyframes alertPop{from{opacity:0;transform:translateY(8px) scale(.985)}to{opacity:1;transform:none}}.alert-pop{animation:alertPop .18s ease-out}`}</style>
            <div className="flex min-h-0 flex-1" onClick={(e) => e.stopPropagation()}>
              {showHist ? (
                <aside className="flex w-72 shrink-0 flex-col border-r border-gray-100 bg-gray-50/40">
                  <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
                      <div className="flex items-center gap-1">
                      {(['all', 'style'] as const).map((t) => (
                        <button
                          key={t}
                          onClick={() => setHistTab(t)}
                          className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${histTab === t ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:bg-gray-100'}`}
                        >
                          {t === 'all' ? '全部预警' : '关联预警'}
                          <span className={`ml-1 rounded-full px-1.5 text-[10px] font-semibold ${histTab === t ? 'bg-gray-800 text-white' : 'bg-gray-200 text-gray-500'}`}>
                            {(t === 'all' ? relatedByPerson : relatedByStyle).length}
                          </span>
                        </button>
                      ))}
                    </div>
                    <button onClick={() => setShowHist(false)} className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
                      <X size={15} />
                    </button>
                  </div>
                  <div className="min-h-0 flex-1 space-y-1 overflow-auto px-2.5 py-2">
                    {sideList.length ? (
                      sideList.map((h) => {
                        const hl = (LEVEL_META[(h.level ?? 'warn') as keyof typeof LEVEL_META] ?? LEVEL_META.warn);
                        const hs = STATUS_META[h.status];
                        return (
                          <button
                            key={h.id}
                            ref={h.id === open.id ? activeRef : undefined}
                            onClick={() => setOpenId(h.id)}
                            className={`w-full rounded-lg px-3 py-2 text-left transition-colors ${h.id === open.id ? 'bg-indigo-100 ring-2 ring-indigo-400 hover:bg-indigo-100' : 'hover:bg-indigo-50/70 hover:ring-1 hover:ring-indigo-100'}`}
                          >
                            <div className="flex items-center gap-1.5">
                              <i className={`h-1.5 w-1.5 shrink-0 rounded-full ${hl.dot}`} />
                              <span className={`min-w-0 flex-1 truncate text-[12px] font-medium ${h.id === open.id ? 'text-indigo-900' : 'text-gray-700'}`}>{h.title || '—'}</span>
                              {h.id === open.id ? <span className="shrink-0 rounded bg-indigo-600 px-1 py-px text-[9px] font-semibold text-white">查看中</span> : null}
                            </div>
                            <div className="mt-1 flex items-center justify-between text-[11px]">
                              <span className="text-gray-400">{new Date(h.createdAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                              <span className={hs.text}>{hs.label}</span>
                            </div>
                          </button>
                        );
                      })
                    ) : (
                      <p className="pt-8 text-center text-xs text-gray-300">{histTab === 'all' ? '暂无与此店铺或接收人相关的预警' : `暂无关于「${curStyle}」的关联预警`}</p>
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
                  {buildActions(open, updateAlertStatus, setHandoffId, openConfirm, meName, lockedForMe).map((x) => (
                    <button
                      key={x.label}
                      onClick={x.fn}
                      className={`whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${x.cls}`}
                    >
                      {x.label}
                    </button>
                  ))}
                  <button
                    onClick={() => setOpenId(null)}
                    className="rounded p-1 text-gray-400 transition-colors hover:bg-gray-50 hover:text-gray-600"
                  >
                    <X size={16} />
                  </button>
                </div>
              </div>
              {dlActive ? (
                <div className={`mx-6 mt-3 rounded-md border px-3 py-2 text-xs leading-relaxed ${locked ? 'border-red-100 bg-red-50 text-red-600' : overdue ? 'border-amber-100 bg-amber-50 text-amber-600' : 'border-gray-100 bg-gray-50 text-gray-500'}`}>
                  {locked
                    ? (escNames.length ? `此条预警已超时，你已没有操作权限，已转派给 ${escNames.join('、')} 处理。` : '此条预警已超时，你已没有操作权限。')
                    : overdue
                    ? `已超过规定用时（${fmtClock(graceUntil)} 前未完成将锁定并转派），请在宽限期内完成操作。`
                    : `须在 ${fmtClock(dlAt)} 前完成；超时后进入宽限期（${fmtClock(graceUntil)} 截止），超宽限期将锁定并转派给${escNames.length ? escNames.join('、') : '指定人员'}处理。`}
                </div>
              ) : null}
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
                  <p className="text-[14px] leading-relaxed text-gray-800">
                    {open.preview?.msgParts?.length ? (
                      open.preview.msgParts.map((p, pi) =>
                        p.isVar ? (
                          <span key={pi} className="font-bold text-purple-600">{p.t}</span>
                        ) : (
                          <span key={pi}>{p.t}</span>
                        )
                      )
                    ) : (
                      open.content || open.reason || '规则命中产生预警。'
                    )}
                  </p>
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
                                  <td key={c} className="whitespace-nowrap px-2.5 py-2 text-gray-500"><ImgCell value={r[c]} onZoom={setZoomSrc} /></td>
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
                {(() => {
                const canAllLv = canView(perm, 'linkview_all');
    const rawGroups =
                  open.preview?.linkviews?.filter((g) => g.linkview?.enabled && g.linkview.tabs?.length && (canAllLv || !(g.linkview.tabs ?? []).some((t) => t.all))) ??
                  (open.preview?.linkview?.enabled && open.preview.linkview.tabs?.length && (canAllLv || !(open.preview.linkview.tabs ?? []).some((t) => t.all))
                    ? [{ label: '预警关联展示', linkview: open.preview.linkview }]
                    : []);
                const flatTabs: { label: string; cols: string[]; rows: Record<string, unknown>[]; all: boolean }[] = [];
                rawGroups.forEach((g, _gi) => {
                  (g.linkview.tabs ?? []).forEach((tb, ti) => {
                    if (tb.all && !canAllLv) return;
                    flatTabs.push({
                      label: tb.name || tb.tableName || tb.srcNodeLabel || `${g.label || '关联'}${rawGroups.length > 1 || (g.linkview.tabs?.length ?? 0) > 1 ? `·${ti + 1}` : ''}`,
                      cols: tb.columns ?? [],
                      rows: tb.rows ?? [],
                      all: !!tb.all,
                    });
                  });
                });
                if (!flatTabs.length) return null;
                const firstAllIdx = flatTabs.findIndex((t) => t.all);
                const sel = lvGroup !== null ? Math.min(lvGroup, flatTabs.length - 1) : null;
                const cur = sel !== null ? flatTabs[sel] : null;
                return (
                  <div className="mt-4">
                    <div className="flex flex-wrap items-center gap-1">
                      {flatTabs.map((f, fi) => {
                        const active = sel === fi;
                        return (
                          <span key={fi} className="inline-flex items-center">
                            {firstAllIdx > 0 && fi === firstAllIdx ? (
                              <span className="mx-1.5 my-0.5 flex h-4 w-px bg-gray-300" title="区分类型" />
                            ) : null}
                            <button
                            type="button"
                            onClick={() => { setLvGroup(active ? null : fi); setLvTab(0); }}
                            className={`whitespace-nowrap rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${active ? 'border-pink-600 bg-pink-600 text-white' : 'border-gray-200 bg-white text-gray-500 hover:border-pink-300 hover:text-pink-600'}`}
                          >
                            {f.label}
                            <span className={`ml-1.5 text-[10px] ${active ? 'text-pink-100' : 'text-gray-300'}`}>{f.rows.length}</span>
                          </button>
                          </span>
                        );
                      })}
                    </div>
                    {cur ? (
                      <div className="mt-3 overflow-auto rounded-lg border border-gray-100">
                        {cur.rows.length ? (
                          <table className="w-full border-collapse text-[11px]">
                            <thead>
                              <tr className="bg-gray-50/40 text-left text-gray-400">
                                {cur.cols.map((c) => (
                                  <th key={c} className="whitespace-nowrap px-2.5 py-2 font-medium">{c}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {cur.rows.slice(0, 100).map((r, ri) => (
                                <tr key={ri} className="border-t border-gray-50">
                                  {cur.cols.map((c) => (
                                    <td key={c} className="whitespace-nowrap px-2.5 py-2 text-gray-500"><ImgCell value={r[c]} onZoom={setZoomSrc} /></td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        ) : (
                          <div className="px-3 py-3 text-xs text-gray-400">该标签暂无关联数据。</div>
                        )}
                      </div>
                    ) : null}
                  </div>
                );
              })()}
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
                    onBlur={() => { if (lockedForMe) return; if (planDraft !== (openForSync?.plan || '')) updateAlertStatus(open.id, { plan: planDraft }); }}
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

              {/* 图片放大预览 */}
              {zoomSrc && (
                <div
                  className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 p-6"
                  onClick={() => setZoomSrc(null)}
                >
                  <img src={zoomSrc} alt="" className="max-h-full max-w-full rounded-lg object-contain shadow-2xl" />
                </div>
              )}
            </div>
        );
      })()}

      {/* 转交弹窗：门店预警→仅门店人员；用户预警→人事管理任意用户，可按部门筛选 */}
      {handoffId && (() => {
        const a = alerts.find((x) => x.id === handoffId) ?? null;
        const modes = (a?.preview?.recipients ?? []).map((r) => r.mode);
        const isStoreAlert =
          modes.includes('store') || modes.includes('employee') || (!!a?.storeIds?.length && !modes.includes('person'));
        const storeName = (id?: string) => (id ? (state.stores ?? []).find((s) => s.id === id)?.name || '' : '');
        const orgName = (id?: string) => (id ? (state.orgs ?? []).find((o) => o.id === id)?.name || '' : '');
        const seenS = new Set<string>();
        const storeCands: { name: string; tag: string }[] = [];
        (state.employees ?? []).forEach((e) => {
          if (e.name && !seenS.has(e.name)) { seenS.add(e.name); storeCands.push({ name: e.name, tag: storeName(e.storeId) }); }
        });
        const seenU = new Set<string>();
        const userCands: { name: string; tag: string }[] = [];
        (state.persons ?? [])
          .filter((p) => p.enabled !== false)
          .forEach((p) => {
            if (p.name && !seenU.has(p.name)) { seenU.add(p.name); userCands.push({ name: p.name, tag: orgName(p.orgId) }); }
          });
        const all =
          isStoreAlert
            ? (storeCands.length ? storeCands : PEOPLE.map((p) => ({ name: p.name, tag: p.dept })))
            : (userCands.length ? userCands : PEOPLE.map((p) => ({ name: p.name, tag: p.dept })));
        const deptOpts = isStoreAlert ? [] : [...new Set((userCands.length ? userCands : PEOPLE.map((p) => ({ name: p.name, tag: p.dept }))).map((p) => p.tag).filter(Boolean))];
        const filtered = isStoreAlert ? all : all.filter((p) => !handoffDept || p.tag === handoffDept);
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/20 p-4 backdrop-blur-sm" onClick={() => setHandoffId(null)}>
            <div className="alert-pop w-full max-w-sm rounded-xl border border-gray-200 bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-[15px] font-semibold text-gray-800">{isStoreAlert ? '转交给门店人员' : '转交给用户'}</h3>
                <button onClick={() => setHandoffId(null)} className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
                  <X size={15} />
                </button>
              </div>
              {!isStoreAlert && deptOpts.length > 1 ? (
                <div className="mb-2.5 flex items-center gap-2">
                  <span className="shrink-0 text-xs text-gray-400">按部门筛选</span>
                  <select
                    value={handoffDept}
                    onChange={(e) => setHandoffDept(e.target.value)}
                    className="h-8 min-w-0 flex-1 rounded-md border border-gray-200 bg-white px-2 text-xs text-gray-700 outline-none focus:border-gray-300"
                  >
                    <option value="">全部部门</option>
                    {deptOpts.map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
              ) : null}
              <div className="max-h-64 space-y-0.5 overflow-auto">
                {filtered.length === 0 ? (
                  <p className="py-6 text-center text-xs text-gray-300">暂无可用选择对象</p>
                ) : (
                  filtered.map((p) => (
                    <button
                      key={p.name}
                      onClick={() => {
                        updateAlertStatus(handoffId, {
                          assignee: p.name,
                          handoffTo: p.name,
                          dept: p.tag || a?.dept || '',
                          status: 'processing',
                          updatedAt: Date.now(),
                        });
                        setHandoffId(null);
                      }}
                      className="flex w-full items-center justify-between rounded-md px-3 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-50"
                    >
                      <span>{p.name}</span>
                      <span className="text-xs text-gray-400">{p.tag || ''}</span>
                    </button>
                  ))
                )}
              </div>
            </div>
          </div>
        );
      })()}

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
  who = '当前用户',
  lockedForMe = false
): AlertAction[] {
  const N = Date.now();
  const upd = (patch: Partial<AlertTask>) => update(a.id, { ...patch, updatedAt: N });
  const guard = () => toast.error('此条预警已超时，你已没有操作权限，操作已被禁用');
  if (lockedForMe) {
    return [
      { label: '开始处理', cls: 'cursor-default bg-gray-100 text-gray-400', fn: guard },
      { label: '完成', cls: 'cursor-default bg-gray-100 text-gray-400', fn: guard },
      { label: '转交', cls: 'cursor-default bg-gray-100 text-gray-400', fn: guard },
      { label: '无法完成', cls: 'cursor-default bg-gray-100 text-gray-400', fn: guard },
    ];
  }
  // 已完成/不可用 → 灰色；未完成且可操作 → 蓝色
  const blue = 'bg-blue-600 text-white shadow-sm hover:bg-blue-600/90';
  const gray = 'cursor-default bg-gray-100 text-gray-400';
  const okStart = a.status === 'new' || a.status === 'accepted';
  const okDone = a.status === 'processing';
  const okFail = a.status === 'new' || a.status === 'accepted' || a.status === 'processing';
  const okHandoff = okFail;
  const acts: AlertAction[] = [
    { label: '开始处理', cls: okStart ? blue : gray, fn: okStart ? () => ask({ title: '确认开始处理该预警？', desc: '确认后将开始计算处理时长，你将成为该预警的处理人。', onOk: () => upd({ status: 'processing', startedAt: Date.now(), assignee: a.assignee || who }) }) : () => {} },
    {
      label: '完成',
      cls: okDone ? blue : gray,
      fn: okDone ? () => {
        const planText = (a.plan || '').trim();
        if (planText.length < 20) {
          toast.error(`预警处理方式未达标：请先在下方填写处理方式（当前 ${planText.length} 字，需不少于 20 字），填写完成后才能点「完成」。`);
          return;
        }
        ask({
          title: '标记为已处理',
          desc: '预警处理方式已达标，请补充处理方案后确认完成。',
          needText: true,
          required: true,
          placeholder: '请填写处理方案：如何处理、如何解决该预警。（必填）',
          onOk: (t) => upd({ status: 'done', handledAt: Date.now(), resolution: t }),
        });
      } : () => {},
    },
    { label: '转交', cls: okHandoff ? 'border border-gray-200 bg-white text-gray-600 hover:bg-gray-50' : gray, fn: okHandoff ? () => handoff(a.id) : () => {} },
    { label: '无法完成', cls: okFail ? blue : gray, fn: okFail ? () => ask({ title: '标记为无法完成', desc: '请填写无法完成的原因，确认后该预警将标记为「无法完成」。', needText: true, required: true, placeholder: '请填写无法完成的原因。（必填）', onOk: (t) => upd({ status: 'failed', handledAt: Date.now(), failedReason: t }) }) : () => {} },
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