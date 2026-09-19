import React, { useEffect, useMemo, useState } from 'react';
import { Database, Pencil, RefreshCw, Save, X } from 'lucide-react';
import { toast } from 'sonner';
import type { Dealer, TableField } from '@/lib/types';
import { useStore } from '@/lib/store';

type SemKey = 'name' | 'code' | 'status' | 'contact' | 'phone' | 'province' | 'city' | 'district' | 'address' | 'password' | 'birthday' | 'level' | 'category';

const SEM_OPTIONS: { key: SemKey; label: string }[] = [
  { key: 'name', label: '名称（建档必填）' },
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

const STORE_KEY = 'dn_src_dealer_cfg';

interface Cfg {
  tableId: string;
  /** sourceKey -> 语义；'attr' 表示作为属性字段 */
  assign: Record<string, SemKey | 'attr'>;
  /** 是否显示（勾选才参与建档） */
  visible: Record<string, boolean>;
  /** attr 字段重命名 label */
  renames: Record<string, string>;
}

const str = (v: unknown) => (v == null || v === '' ? '' : String(v).trim());

export default function DealerSourceModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { state, addDealer, updateDealer } = useStore();
  const tables = state.tables;
  const dealers = state.dealers;

  const [cfg, setCfg] = useState<Cfg>({ tableId: '', assign: {}, visible: {}, renames: {} });
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    if (!open) return;
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const p = JSON.parse(raw) as Partial<Cfg>;
        setCfg({ tableId: p.tableId ?? '', assign: p.assign ?? {}, visible: {}, renames: p.renames ?? {} });
      } else {
        setCfg({ tableId: '', assign: {}, visible: {}, renames: {} });
      }
    } catch {
      setCfg({ tableId: '', assign: {}, visible: {}, renames: {} });
    }
  }, [open]);

  const table = useMemo(() => tables.find((t) => t.id === cfg.tableId), [tables, cfg.tableId]);
  const tableFields = useMemo(() => (table?.fields?.length ? table.fields : []), [table]) as TableField[];

  // 首次打开某表：缺失字段补默认（assign=attr、visible=true）
  useEffect(() => {
    if (!open || !table) return;
    setCfg((c) => {
      const keys = tableFields.map((f) => f.key);
      const assign = { ...c.assign };
      const visible = { ...c.visible };
      const renames = { ...c.renames };
      for (const k of keys) {
        if (!(k in assign)) assign[k] = 'attr';
        if (typeof visible[k] !== 'boolean') visible[k] = true;
        if (typeof renames[k] !== 'string') renames[k] = '';
      }
      return { ...c, assign, visible, renames };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, table?.id]);

  const setVisible = (key: string, on: boolean) => setCfg({ ...cfg, visible: { ...cfg.visible, [key]: on } });
  const setRename = (key: string, val: string) => setCfg({ ...cfg, renames: { ...cfg.renames, [key]: val } });
  const setAssign = (key: string, v: SemKey | 'attr' | '') => {
    const assign = { ...cfg.assign };
    if (v === '') delete assign[key];
    else {
      for (const k of Object.keys(assign)) if (assign[k] === v && v !== 'attr') delete assign[k];
      assign[key] = v;
    }
    setCfg({ ...cfg, assign });
  };

  const saveCfg = () => {
    localStorage.setItem(STORE_KEY, JSON.stringify({ tableId: cfg.tableId, assign: cfg.assign, visible: cfg.visible, renames: cfg.renames }));
    toast.success('数据源配置已保存');
  };

  const syncBuild = async () => {
    if (!table) return toast.warning('请先选择数据来源表');
    const semantics: Record<SemKey, string> = {} as Record<SemKey, string>;
    for (const f of tableFields) {
      const sv = cfg.assign[f.key];
      if (cfg.visible[f.key] !== false && sv && sv !== 'attr') semantics[sv] = f.key;
    }
    if (!semantics.name) return toast.warning('请将某一列映射为「名称（建档必填）」并勾选显示');
    const rows: Record<string, unknown>[] = (table.rows?.length ? table.rows : table.previewRows) ?? [];
    if (!rows.length) return toast.warning('来源表没有可用的数据行');
    setSyncing(true);
    try {
      let synced = 0, updated = 0, skipped = 0;
      for (const r of rows) {
        const name = str(r[semantics.name]);
        if (!name) { skipped++; continue; }
        const code = semantics.code ? str(r[semantics.code]) || undefined : undefined;
        const base: Omit<Dealer, 'id' | 'createdAt'> = {
          name,
          code,
          sort: 0,
          enabled: semantics.status ? !/停用|禁用|0|否|false/i.test(str(r[semantics.status])) : true,
          contact: semantics.contact ? str(r[semantics.contact]) || undefined : undefined,
          phone: semantics.phone ? str(r[semantics.phone]) || undefined : undefined,
          province: semantics.province ? str(r[semantics.province]) || undefined : undefined,
          city: semantics.city ? str(r[semantics.city]) || undefined : undefined,
          district: semantics.district ? str(r[semantics.district]) || undefined : undefined,
          address: semantics.address ? str(r[semantics.address]) || undefined : undefined,
          password: semantics.password ? str(r[semantics.password]) || undefined : undefined,
          birthday: semantics.birthday ? str(r[semantics.birthday]) || undefined : undefined,
        };
        // 属性字段：未映射到任何语义、且勾选显示的列
        const attrLevel = semantics.level ? str(r[semantics.level]) || undefined : undefined;
        const attrCategory = semantics.category ? str(r[semantics.category]) || undefined : undefined;
        const attrs: Record<string, string> = {};
        if (attrLevel) attrs['经销商等级'] = attrLevel;
        if (attrCategory) attrs['经销商分类'] = attrCategory;
        for (const f of tableFields) {
          if (cfg.visible[f.key] === false) continue;
          if (cfg.assign[f.key] && cfg.assign[f.key] !== 'attr') continue;
          const label = cfg.renames[f.key] || f.alias || f.key;
          const v = str(r[f.key]);
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
              onChange={(e) => setCfg({ ...cfg, tableId: e.target.value, assign: {}, visible: {}, renames: {} })}
              className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-400"
            >
              <option value="">请选择数据表…</option>
              {tables.map((t) => (
                <option key={t.id} value={t.id}>{`${t.group ? `[${t.group}] ` : ''}${t.name}（${(t.rows?.length ?? t.previewRows?.length ?? 0)} 行）`}</option>
              ))}
            </select>
            <p className="mt-1.5 text-xs text-gray-400">勾选「显示」的列才参与建档；映射到系统字段的列写入档案对应项，其余列作为属性字段展示。</p>
          </div>

          {table && (
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-medium text-gray-600">字段映射</span>
              <span className="text-xs text-gray-400">{tableFields.length} 个字段</span>
            </div>
          )}

          {table && tableFields.map((f) => {
            const sem = cfg.assign[f.key];
            const isAttr = sem === 'attr';
            const usedByOther = !isAttr && sem && Object.entries(cfg.assign).some(([k, v]) => v === sem && k !== f.key);
            const shown = cfg.visible[f.key] !== false;
            return (
              <div key={f.key} className={`mb-2 flex items-center gap-2 rounded-lg border px-3 py-2 ${shown ? 'border-gray-100' : 'border-gray-50 bg-gray-50/60 opacity-60'}`}>
                <label className="flex shrink-0 items-center gap-1.5 text-xs text-gray-500">
                  <input type="checkbox" checked={shown} onChange={(e) => setVisible(f.key, e.target.checked)} className="h-4 w-4 accent-blue-600" />
                  显示
                </label>
                <div className="w-36 shrink-0">
                  <div className="truncate text-sm font-medium text-gray-800">{isAttr ? cfg.renames[f.key] || f.alias || f.key : f.alias || f.key}</div>
                  <div className="truncate text-[11px] text-gray-400">列：{f.key}</div>
                </div>
                <div className="flex-1">
                  <select
                    value={sem ?? ''}
                    disabled={!shown}
                    onChange={(e) => setAssign(f.key, e.target.value as SemKey | 'attr' | '')}
                    className="w-full rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-blue-400 disabled:opacity-50"
                  >
                    <option value="attr">属性字段（建档展示）</option>
                    {SEM_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
                  </select>
                  {usedByOther && <span className="mt-0.5 block text-[11px] text-amber-500">该语义已由其他列映射，此列不写入</span>}
                </div>
                {isAttr && (
                  <div className="flex w-40 shrink-0 items-center gap-1 rounded-md border border-gray-200 px-2">
                    <Pencil size={13} className="shrink-0 text-gray-400" />
                    <input
                      value={cfg.renames[f.key] ?? ''}
                      onChange={(e) => setRename(f.key, e.target.value)}
                      placeholder="重命名"
                      className="w-full bg-transparent py-1.5 text-sm outline-none"
                    />
                  </div>
                )}
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