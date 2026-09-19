import React, { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Database, Pencil, RefreshCw, Save, X } from 'lucide-react';
import { toast } from 'sonner';
import type { Dealer, TableField } from '@/lib/types';
import { useStore } from '@/lib/store';

type SemKey = 'name' | 'code' | 'status' | 'contact' | 'phone' | 'province' | 'city' | 'district' | 'address' | 'password' | 'birthday' | 'level' | 'category';

const SEM_OPTIONS: { key: SemKey; label: string; required?: boolean }[] = [
  { key: 'name', label: '名称（建档必填）', required: true },
  { key: 'code', label: '编号（去重更新键）' },
  { key: 'status', label: '状态（启用判断）' },
  { key: 'contact', label: '联系人' },
  { key: 'phone', label: '电话' },
  { key: 'province', label: '省份' },
  { key: 'city', label: '城市' },
  { key: 'district', label: '区县' },
  { key: 'address', label: '地址' },
  { key: 'password', label: '初始密码' },
  { key: 'birthday', label: '生日' },
  { key: 'level', label: '经销商等级' },
  { key: 'category', label: '经销商分类' },
];

const SEM_ATTR_LABEL: Partial<Record<SemKey, string>> = { level: '经销商等级', category: '经销商分类' };

const STORE_KEY = 'dn_src_dealer_cfg';

interface Cfg {
  tableId: string;
  /** sourceKey -> 语义；'attr' 表示作为属性字段 */
  assign: Record<string, SemKey | 'attr'>;
  /** attr 字段顺序 */
  order: string[];
  /** attr 字段重命名 label */
  renames: Record<string, string>;
}

const str = (v: unknown) => (v == null || v === '' ? '' : String(v).trim());

export default function DealerSourceModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { state, addDealer, updateDealer } = useStore();
  const tables = state.tables;
  const dealers = state.dealers;

  const [cfg, setCfg] = useState<Cfg>({ tableId: '', assign: {}, order: [], renames: {} });
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    if (!open) return;
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) setCfg(JSON.parse(raw));
    } catch {
      /* ignore */
    }
  }, [open]);

  const table = useMemo(() => tables.find((t) => t.id === cfg.tableId), [tables, cfg.tableId]);
  const fields = useMemo(() => (table?.fields?.length ? table.fields : []), [table]);

  // 初始化 assign/order：首次打开某表时把每个字段默认归为 attr 字段
  useEffect(() => {
    if (!open || !table) return;
    setCfg((c) => {
      const keys = fields.map((f) => f.key);
      if (!c.assign) c.assign = {};
      if (!c.order) c.order = [];
      if (!c.renames) c.renames = {};
      const missing = keys.filter((k) => !(k in c.assign));
      if (!missing.length) return c;
      const assign = { ...c.assign };
      const order = [...c.order];
      for (const k of missing) {
        assign[k] = 'attr';
        if (!order.includes(k)) order.push(k);
      }
      return { ...c, assign, order };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, table?.id]);

  const saveCfg = () => {
    localStorage.setItem(STORE_KEY, JSON.stringify(cfg));
    toast.success('数据源配置已保存');
  };

  const syncBuild = async () => {
    if (!table) return toast.warning('请先选择数据来源表');
    if (!cfg.assign || !Object.values(cfg.assign).includes('name')) return toast.warning('请将某一列映射为「名称（建档必填）」');
    const rows: Record<string, unknown>[] = (table.rows?.length ? table.rows : table.previewRows) ?? [];
    if (!rows.length) return toast.warning('来源表没有可用的数据行');
    setSyncing(true);
    try {
      let synced = 0, updated = 0, skipped = 0;
      for (const r of rows) {
        const name = str(r[cfg.assign.name as string]);
        if (!name) { skipped++; continue; }
        const code = str(r[cfg.assign.code as string]) || undefined;
        const base: Omit<Dealer, 'id' | 'createdAt'> = {
          name,
          code,
          sort: 0,
          enabled: cfg.assign.status ? !/停用|禁用|0|否|false/i.test(str(r[cfg.assign.status as string])) : true,
          contact: cfg.assign.contact ? str(r[cfg.assign.contact as string]) || undefined : undefined,
          phone: cfg.assign.phone ? str(r[cfg.assign.phone as string]) || undefined : undefined,
          province: cfg.assign.province ? str(r[cfg.assign.province as string]) || undefined : undefined,
          city: cfg.assign.city ? str(r[cfg.assign.city as string]) || undefined : undefined,
          district: cfg.assign.district ? str(r[cfg.assign.district as string]) || undefined : undefined,
          address: cfg.assign.address ? str(r[cfg.assign.address as string]) || undefined : undefined,
          password: cfg.assign.password ? str(r[cfg.assign.password as string]) || undefined : undefined,
          birthday: cfg.assign.birthday ? str(r[cfg.assign.birthday as string]) || undefined : undefined,
        };
        // 属性字段：未映射到任何语义的列
        const mappedKeys = new Set<string>(SEM_OPTIONS.map((o) => cfg.assign[o.key]).filter((v): v is SemKey => v != null && v !== 'attr'));
        const attrs: Record<string, string> = {};
        for (const k of cfg.order) {
          if (mappedKeys.has(k)) continue;
          const label = (SEM_ATTR_LABEL[cfg.assign[k] as SemKey] ?? cfg.renames[k]) || fields.find((f) => f.key === k)?.alias || k;
          const v = str(r[k]);
          if (v) attrs[label] = v;
        }
        base.attrs = attrs;

        const exist = dealers.find((d) => d.code && d.code === code);
        if (exist) { updateDealer({ ...exist, ...base }); updated++; }
        else { addDealer(base); synced++; }
      }
      toast.success(`同步建档完成：新增 ${synced}、更新 ${updated}${skipped ? `、跳过 ${skipped} 行` : ''}`);
      onClose();
    } finally {
      setSyncing(false);
    }
  };

  if (!open) return null;
  const tableFields: (TableField & { key: string })[] = fields as (TableField & { key: string })[];
  const attrKeys = (cfg.order ?? []).filter((k) => cfg.assign[k] === 'attr');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[86vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl bg-white shadow-xl">
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
              onChange={(e) => setCfg({ ...cfg, tableId: e.target.value })}
              className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-400"
            >
              <option value="">请选择数据表…</option>
              {tables.map((t) => (
                <option key={t.id} value={t.id}>{`${t.group ? `[${t.group}] ` : ''}${t.name}（${(t.rows?.length ?? t.previewRows?.length ?? 0)} 行）`}</option>
              ))}
            </select>
            <p className="mt-1.5 text-xs text-gray-400">将来源表的列映射到经销商档案字段；未映射的列作为属性字段建档展示，可排序/重命名。</p>
          </div>

          {table && (
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-medium text-gray-600">字段映射与属性配置</span>
              <span className="text-xs text-gray-400">{tableFields.length} 个字段</span>
            </div>
          )}

          {table && tableFields.map((f) => {
            const sem = cfg.assign[f.key];
            const isAttr = sem === 'attr';
            const usedByOther = !isAttr && sem && Object.entries(cfg.assign).some(([k, v]) => v === sem && k !== f.key);
            return (
              <div key={f.key} className="mb-2 flex items-center gap-2 rounded-lg border border-gray-100 px-3 py-2">
                <div className="w-44 shrink-0">
                  <div className="truncate text-sm font-medium text-gray-800">{isAttr ? cfg.renames[f.key] || f.alias || f.key : f.alias || f.key}</div>
                  <div className="truncate text-[11px] text-gray-400">列：{f.key}</div>
                </div>
                <div className="flex-1">
                  <select
                    value={sem ?? ''}
                    onChange={(e) => {
                      const v = e.target.value as SemKey | 'attr' | '';
                      const assign = { ...cfg.assign };
                      if (v === '') delete assign[f.key];
                      else {
                        for (const k of Object.keys(assign)) if (assign[k] === v && v !== 'attr') delete assign[k];
                        assign[f.key] = v;
                      }
                      let order = [...cfg.order];
                      if (v === 'attr') { if (!order.includes(f.key)) order = [...order, f.key]; }
                      else if (v === '') order = order.filter((k) => k !== f.key);
                      setCfg({ ...cfg, assign, order });
                    }}
                    className="w-full rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-blue-400"
                  >
                    <option value="attr">属性字段（建档展示）</option>
                    {SEM_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
                  </select>
                  {usedByOther && <span className="mt-0.5 block text-[11px] text-amber-500">已由其他列映射，此列不再写入</span>}
                </div>
                {isAttr && (
                  <>
                    <div className="flex w-40 shrink-0 items-center gap-1 rounded-md border border-gray-200 px-2">
                      <Pencil size={13} className="shrink-0 text-gray-400" />
                      <input
                        value={cfg.renames[f.key] ?? ''}
                        onChange={(e) => setCfg({ ...cfg, renames: { ...cfg.renames, [f.key]: e.target.value } })}
                        placeholder="重命名"
                        className="w-full bg-transparent py-1.5 text-sm outline-none"
                      />
                    </div>
                    <div className="flex shrink-0 items-center gap-0.5">
                      <button
                        onClick={() => {
                          const order = [...cfg.order];
                          const i = order.indexOf(f.key);
                          if (i <= 0) return;
                          [order[i - 1], order[i]] = [order[i], order[i - 1]];
                          setCfg({ ...cfg, order });
                        }}
                        className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                        title="上移"
                      ><ArrowUp size={14} /></button>
                      <button
                        onClick={() => {
                          const order = [...cfg.order];
                          const i = order.indexOf(f.key);
                          if (i < 0 || i >= order.length - 1) return;
                          [order[i + 1], order[i]] = [order[i], order[i + 1]];
                          setCfg({ ...cfg, order });
                        }}
                        className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                        title="下移"
                      ><ArrowDown size={14} /></button>
                    </div>
                  </>
                )}
              </div>
            );
          })}

          {table && !tableFields.length && <div className="py-8 text-center text-sm text-gray-400">该数据表没有可配置的字段</div>}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-gray-200 bg-gray-50 px-5 py-3">
          <button onClick={saveCfg} className="inline-flex items-center gap-1.5 rounded-md px-3.5 py-2 text-sm text-gray-600 hover:bg-gray-200">
            <Save size={15} />保存配置
          </button>
          <button
            onClick={syncBuild}
            disabled={syncing || !table}
            className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
          >
            <RefreshCw size={15} className={syncing ? 'animate-spin' : ''} />{syncing ? '同步中…' : '同步建档'}
          </button>
        </div>
      </div>
    </div>
  );
}