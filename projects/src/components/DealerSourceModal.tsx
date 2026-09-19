import React, { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Database, Pencil, RefreshCw, Save, X } from 'lucide-react';
import { toast } from 'sonner';
import type { Dealer, TableField } from '@/lib/types';
import { useStore } from '@/lib/store';

type SemKey = 'name' | 'code' | 'status' | 'contact' | 'phone' | 'province' | 'city' | 'district' | 'address' | 'password' | 'birthday' | 'level' | 'category';

/** 系统字段 ↔ 来源表列名（alias / key）自动识别 */
const SYNONYMS: Record<SemKey, string[]> = {
  name: ['名称', '经销商名称', '商户名称', '商家名称', 'name'],
  code: ['编号', '经销商编号', '商户编号', '编码', 'code', 'id'],
  status: ['状态', '是否启用', 'status'],
  contact: ['联系人', '联系人姓名', 'contact'],
  phone: ['电话', '联系电话', '手机', '手机号', 'phone'],
  province: ['省份', '省', 'province'],
  city: ['城市', '市', 'city'],
  district: ['区县', '地区', '区', 'district'],
  address: ['地址', '详细地址', 'address'],
  password: ['初始密码', '密码', 'password'],
  birthday: ['生日', 'birthday'],
  level: ['经销商等级', '等级', 'level'],
  category: ['经销商分类', '分类', 'category'],
};

const STORE_KEY = 'dn_src_dealer_cfg';

export interface Cfg {
  tableId: string;
  /** 字段展示顺序（sourceKey），未显示字段自动排在最后 */
  order: string[];
  /** 是否显示（勾选才参与建档；不显示的字段自动排到最下方） */
  visible: Record<string, boolean>;
  /** 字段重命名 label */
  renames: Record<string, string>;
}

const str = (v: unknown) => (v == null || v === '' ? '' : String(v).trim());

function colName(f: TableField, renames?: Record<string, string>): string {
  const r = (renames?.[f.key] || '').trim();
  if (r) return r;
  return (f.alias || '').trim() || f.key;
}
function autoSemantics(fields: TableField[], renames?: Record<string, string>): Partial<Record<SemKey, string>> {
  const used = new Set<string>();
  const sem: Partial<Record<SemKey, string>> = {};
  for (const sk of Object.keys(SYNONYMS) as SemKey[]) {
    const syns = SYNONYMS[sk];
    const f = fields.find((x) => {
      if (used.has(x.key)) return false;
      const nm = colName(x, renames).toLowerCase();
      return syns.some((s) => nm === s.toLowerCase());
    });
    if (f) { sem[sk] = f.key; used.add(f.key); }
  }
  return sem;
}

/** 按来源列 key/alias 识别其所属系统字段（与 autoSemantics 一致） */
export function classifyField(key: string, alias?: string): SemKey | null {
  const a = (alias || '').trim();
  for (const sk of Object.keys(SYNONYMS) as SemKey[]) {
    if (SYNONYMS[sk].some((s) => a === s || key === s || a.toLowerCase() === s.toLowerCase())) return sk;
  }
  return null;
}

/** 读取经销商数据源配置（localStorage） */
export function loadSrcCfg(): Cfg | null {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as Cfg;
  } catch {
    return null;
  }
}

export default function DealerSourceModal({ open, onClose, onSynced }: { open: boolean; onClose: () => void; onSynced?: () => void }) {
  const { state, addDealer, updateDealer, flushNow } = useStore();
  const tables = state.tables;
  const dealers = state.dealers;

  const [cfg, setCfg] = useState<Cfg>({ tableId: '', order: [], visible: {}, renames: {} });
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    if (!open) return;
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const p = JSON.parse(raw) as Partial<Cfg>;
        setCfg({ tableId: p.tableId ?? '', order: p.order ?? [], visible: p.visible ?? {}, renames: p.renames ?? {} });
      } else {
        setCfg({ tableId: '', order: [], visible: {}, renames: {} });
      }
    } catch {
      setCfg({ tableId: '', order: [], visible: {}, renames: {} });
    }
  }, [open]);

  const table = useMemo(() => tables.find((t) => t.id === cfg.tableId), [tables, cfg.tableId]);
  const tableFields = useMemo(() => (table?.fields?.length ? table.fields : []), [table]) as TableField[];

  // 首次打开某表：缺失字段补默认（order 末尾追加、visible=true、rename=''）
  useEffect(() => {
    if (!open || !table) return;
    setCfg((c) => {
      const keys = tableFields.map((f) => f.key);
      const order = [...c.order];
      const visible = { ...c.visible };
      const renames = { ...c.renames };
      for (const k of keys) {
        if (!order.includes(k)) order.push(k);
        if (typeof visible[k] !== 'boolean') visible[k] = true;
        if (typeof renames[k] !== 'string') renames[k] = '';
      }
      return { ...c, order, visible, renames };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, table?.id]);

  const setVisible = (key: string, on: boolean) => setCfg({ ...cfg, visible: { ...cfg.visible, [key]: on } });
  const setRename = (key: string, val: string) => setCfg({ ...cfg, renames: { ...cfg.renames, [key]: val } });

  // 上下移动：仅在同组（显示/隐藏）内交换字段顺序
  const move = (key: string, dir: -1 | 1) => {
    const inShown = cfg.visible[key] !== false;
    const group = cfg.order.filter((k) => (inShown ? cfg.visible[k] !== false : cfg.visible[k] === false));
    const i = group.indexOf(key);
    const nb = group[i + dir];
    if (i < 0 || !nb) return;
    const a = cfg.order.indexOf(key);
    const b = cfg.order.indexOf(nb);
    const order = [...cfg.order];
    [order[a], order[b]] = [order[b], order[a]];
    setCfg({ ...cfg, order });
  };

  const persistCfg = () => localStorage.setItem(STORE_KEY, JSON.stringify({ tableId: cfg.tableId, order: cfg.order, visible: cfg.visible, renames: cfg.renames }));
  const saveCfg = () => {
    persistCfg();
    toast.success('数据源配置已保存');
  };

  const syncBuild = async () => {
    persistCfg(); // 同步建档前先落配置，避免勾选/重命名丢失
    if (!table) return toast.warning('请先选择数据来源表');
    if (!tableFields.length) return toast.warning('该数据表没有可配置的字段');
    const sem = autoSemantics(tableFields, cfg.renames);
    if (!sem.name) return toast.warning(`未在来源表匹配到「名称」列，请确认包含类似「${SYNONYMS.name.slice(0, 3).join('/')}」的列`);
    if (!sem.code) toast.info('未匹配到「编号」列，本次将全部新增、无法按编号去重更新');
    const rows: Record<string, unknown>[] = (table.rows?.length ? table.rows : table.previewRows) ?? [];
    if (!rows.length) return toast.warning('来源表没有可用的数据行');
    const semKeys = new Set(Object.values(sem).filter((v): v is string => !!v));
    setSyncing(true);
    try {
      let synced = 0, updated = 0, skipped = 0;
      for (const r of rows) {
        const name = str(r[sem.name as string]);
        if (!name) { skipped++; continue; }
        const code = sem.code ? str(r[sem.code]) || undefined : undefined;
        const base: Omit<Dealer, 'id' | 'createdAt'> = {
          name,
          code,
          sort: 0,
          enabled: sem.status ? !/停用|禁用|0|否|false/i.test(str(r[sem.status])) : true,
          contact: sem.contact ? str(r[sem.contact]) || undefined : undefined,
          phone: sem.phone ? str(r[sem.phone]) || undefined : undefined,
          province: sem.province ? str(r[sem.province]) || undefined : undefined,
          city: sem.city ? str(r[sem.city]) || undefined : undefined,
          district: sem.district ? str(r[sem.district]) || undefined : undefined,
          address: sem.address ? str(r[sem.address]) || undefined : undefined,
          password: sem.password ? str(r[sem.password]) || undefined : undefined,
          birthday: sem.birthday ? str(r[sem.birthday]) || undefined : undefined,
        };
        // 属性字段：非系统语义列（按 order 顺序写入）
        const attrLevel = sem.level ? str(r[sem.level]) || undefined : undefined;
        const attrCategory = sem.category ? str(r[sem.category]) || undefined : undefined;
        const attrs: Record<string, string> = {};
        if (attrLevel) attrs['经销商等级'] = attrLevel;
        if (attrCategory) attrs['经销商分类'] = attrCategory;
        for (const k of cfg.order) {
          if (cfg.visible[k] === false || semKeys.has(k)) continue;
          const f = tableFields.find((x) => x.key === k);
          if (!f) continue;
          const label = cfg.renames[k] || f.alias || k;
          const v = str(r[k]);
          if (v) attrs[label] = v;
        }
        base.attrs = attrs;

        const exist = dealers.find((d) => d.code && d.code === code);
        if (exist) { updateDealer({ ...exist, ...base }); updated++; }
        else { addDealer(base); synced++; }
      }
      toast.success(`同步建档完成：新增 ${synced}、更新 ${updated}${skipped ? `、跳过 ${skipped} 行` : ''}`);
      persistCfg();
      if (flushNow) flushNow();
      onClose();
      onSynced?.();
    } finally {
      setSyncing(false);
    }
  };

  if (!open) return null;

  // 字段展示顺序：已显示的在前（按 order），未显示的自动排到最下方
  const shownKeys = cfg.order.filter((k) => cfg.visible[k] !== false);
  const hiddenKeys = cfg.order.filter((k) => cfg.visible[k] === false);
  const listedKeys = [...shownKeys, ...hiddenKeys];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[86vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-3.5">
          <div className="flex items-center gap-2 text-base font-semibold text-gray-800">
            <Database size={17} className="text-blue-500" />
            经销商数据源配置
          </div>
          <button onClick={onClose} className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-auto px-5 py-4">
          <div className="mb-4">
            <label className="mb-1.5 block text-sm font-medium text-gray-600">选择数据来源表</label>
            <select
              value={cfg.tableId}
              onChange={(e) => setCfg({ ...cfg, tableId: e.target.value, order: [], visible: {}, renames: {} })}
              className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-400"
            >
              <option value="">请选择数据表…</option>
              {tables.map((t) => (
                <option key={t.id} value={t.id}>{`${t.group ? `[${t.group}] ` : ''}${t.name}（${(t.rows?.length ?? t.previewRows?.length ?? 0)} 行）`}</option>
              ))}
            </select>
            <p className="mt-1.5 text-xs text-gray-400">无需手动映射——同步建档时按列名（如「经销商名称/编号/联系人…」）自动识别；仅需勾选「显示」的列、调整顺序或重命名。</p>
          </div>

          {table && (
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-medium text-gray-600">字段配置</span>
              <span className="text-xs text-gray-400">{tableFields.length} 个字段（已显示 {shownKeys.length} / 未显示 {hiddenKeys.length}）</span>
            </div>
          )}

          {table && listedKeys.map((k) => {
            const f = tableFields.find((x) => x.key === k);
            if (!f) return null;
            const shown = cfg.visible[k] !== false;
            return (
              <div key={k} className={`mb-2 flex items-center gap-2 rounded-lg border px-3 py-2 ${shown ? 'border-gray-100' : 'border-gray-50 bg-gray-50/60 opacity-60'}`}>
                <label className="flex shrink-0 items-center gap-1.5 text-xs text-gray-500">
                  <input type="checkbox" checked={shown} onChange={(e) => setVisible(k, e.target.checked)} className="h-4 w-4 accent-blue-600" />
                  显示
                </label>
                <div className="flex flex-1 items-center gap-1 rounded-md border border-gray-200 px-2">
                  <Pencil size={13} className="shrink-0 text-gray-400" />
                  <input
                    value={cfg.renames[k] || f.alias || ''}
                    onChange={(e) => setRename(k, e.target.value)}
                    placeholder={f.alias || k}
                    className="w-full bg-transparent py-1.5 text-sm outline-none"
                  />
                </div>
                <div className="w-24 shrink-0 truncate text-right text-[11px] text-gray-400" title={f.key}>源列：{f.key}</div>
                <div className="flex shrink-0 items-center gap-0.5">
                  <button onClick={() => move(k, -1)} className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700" title="上移"><ArrowUp size={14} /></button>
                  <button onClick={() => move(k, 1)} className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700" title="下移"><ArrowDown size={14} /></button>
                </div>
              </div>
            );
          })}

          {table && !tableFields.length && <div className="py-8 text-center text-sm text-gray-400">该数据表没有可配置的字段</div>}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-gray-200 bg-gray-50 px-5 py-3">
          <button onClick={saveCfg} className="inline-flex items-center gap-1.5 rounded-md px-3.5 py-2 text-sm text-gray-600 hover:bg-gray-200"><Save size={15} />保存配置</button>
          <button onClick={syncBuild} disabled={syncing || !table} className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60">
            <RefreshCw size={15} className={syncing ? 'animate-spin' : ''} />{syncing ? '同步中…' : '同步建档'}
          </button>
        </div>
      </div>
    </div>
  );
}