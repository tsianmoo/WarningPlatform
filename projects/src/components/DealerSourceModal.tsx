import React, { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Database, Pencil, RefreshCw, Save, X } from 'lucide-react';
import { toast } from 'sonner';
import type { Dealer, Employee, Store, TableField } from '@/lib/types';
import { useStore } from '@/lib/store';

export type SourceKind = 'dealer' | 'store' | 'employee';

const UNIT: Record<SourceKind, string> = { dealer: '经销商', store: '店仓', employee: '员工' };
export const cfgKeyOf = (k: SourceKind) => `dn_src_${k}_cfg`;

export type SemKey = 'name' | 'code' | 'status' | 'contact' | 'phone' | 'province' | 'city' | 'district' | 'address' | 'password' | 'birthday' | 'level' | 'category' | 'brand' | 'company' | 'department' | 'salesArea' | 'post' | 'allowRetail';

/** 系统字段 ↔ 来源表列名（alias / key / 重命名名）自动识别 */
const SYNONYMS: Record<SemKey, string[]> = {
  name: ['名称', '经销商名称', '经销商', '商户名称', '商家名称', '客户名称', '客户', '公司名称', '单位名称', '店仓名称', '店仓', '门店名称', '门店', '员工姓名', '姓名', 'name'],
  code: ['编号', '经销商编号', '商户编号', '店仓编号', '员工编号', '工号', '编码', 'code', 'id'],
  status: ['状态', '是否启用', '是否在职', '在职', 'status'],
  contact: ['联系人', '联系人姓名', 'contact'],
  phone: ['电话', '联系电话', '手机', '手机号', 'phone'],
  province: ['省份', '省', 'province'],
  city: ['城市', '市', 'city'],
  district: ['区县', '区部', '地区', '区', 'district'],
  address: ['地址', '详细地址', 'address'],
  password: ['初始密码', '密码', 'password'],
  birthday: ['生日', '出生日期', 'birthday'],
  level: ['经销商等级', '等级', 'level'],
  category: ['经销商分类', '分类', 'category'],
  brand: ['主营品牌', '品牌', 'brand'],
  company: ['所属分公司', '分公司', 'company'],
  department: ['所属部门', '部门', 'department'],
  salesArea: ['销售区域', 'salesArea'],
  post: ['岗位', '职位', 'post'],
  allowRetail: ['允许零售', '是否允许零售', 'allowRetail'],
};

export interface Cfg {
  tableId: string;
  /** 字段展示顺序（sourceKey），未显示字段自动排在最后 */
  order: string[];
  /** 是否显示（勾选才参与建档；不显示的字段自动排到最下方） */
  visible: Record<string, boolean>;
  /** 字段重命名 label */
  renames: Record<string, string>;
  /** 是否开启列筛选（开启后列表页在该列上方出现可搜索下拉筛选框） */
  filters: Record<string, boolean>;
}

/** 持久化结构：按「表名」保存每个来源表各自的字段配置（同一张表反复上传无需重新勾选）。 */
interface PersistedCfg {
  lastTableId: string;
  byName: Record<string, { tableId: string; order: string[]; visible: Record<string, boolean>; renames: Record<string, string>; filters: Record<string, boolean> }>;
  /** 旧版单表配置（无 byName 的历史数据），作为任意表首次配置的初始值，避免旧勾选丢失 */
  legacy?: { order: string[]; visible: Record<string, boolean>; renames: Record<string, string> } | null;
}

const str = (v: unknown) => (v == null || v === '' ? '' : String(v).trim());
const colName = (f: TableField, renames?: Record<string, string>) => (renames?.[f.key] || '').trim() || (f.alias || '').trim() || f.key;

/** 配置按表名落位：同一张表每次上传会生成新 tableId，但表名稳定 */
export const tableKeyOf = (t: { group?: string; name: string }) => `${t.group || ''}/${t.name}`;

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

export const blankCfg = (tableId = ''): Cfg => ({ tableId, order: [], visible: {}, renames: {}, filters: {} });

function loadPersisted(kind: SourceKind): PersistedCfg {
  try {
    const raw = localStorage.getItem(cfgKeyOf(kind));
    if (!raw) return { lastTableId: '', byName: {} };
    const p = JSON.parse(raw);
    if (p && typeof p === 'object' && p.byName && typeof p.byName === 'object') {
      return { lastTableId: p.lastTableId ?? '', byName: p.byName };
    }
    // 旧版单表配置迁移：作为 legacy 初始值保留用户已勾选的内容
    if (p && typeof p === 'object' && Array.isArray(p.order)) {
      return {
        lastTableId: p.tableId ?? '',
        byName: {},
        legacy: { order: p.order, visible: p.visible ?? {}, renames: p.renames ?? {} },
      };
    }
    return { lastTableId: '', byName: {} };
  } catch {
    return { lastTableId: '', byName: {} };
  }
}

/** 当前（上次选择）表的配置：供列表页读取列顺序与筛选开关，不依赖表查找 */
export function loadSrcCfg(kind: SourceKind = 'dealer'): Cfg | null {
  const p = loadPersisted(kind);
  if (!p.lastTableId) return null;
  for (const entry of Object.values(p.byName)) {
    if (entry.tableId === p.lastTableId) {
      return { tableId: entry.tableId, order: entry.order, visible: entry.visible, renames: entry.renames, filters: entry.filters ?? {} };
    }
  }
  if (p.legacy) return { tableId: p.lastTableId, ...p.legacy, filters: {} };
  return null;
}

/** 列表展示列：按配置筛选勾选列（不依赖表查找，label＝重命名名 || 源列名） */
export function srcColumns(kind: SourceKind, cfg: Cfg | null): { key: string; sys: SemKey | null; label: string }[] {
  if (!cfg || !cfg.tableId) return [];
  return (cfg.order || [])
    .filter((k) => cfg.visible[k] !== false)
    .map((k) => ({ key: k, sys: classifyField(k, cfg.renames[k]), label: cfg.renames[k] || k }));
}

/** 列表单元格取值 */
export function srcValue(kind: SourceKind, rec: Dealer | Store | Employee, col: { key: string; sys: SemKey | null; label: string }): string {
  const r = rec as unknown as Record<string, unknown> & { attrs?: Record<string, string> };
  const attr = (k: string) => r.attrs?.[k] ?? '';
  const fb = () => attr(col.label) || attr(col.key) || '-';
  switch (col.sys) {
    case 'code': return (r.code as string) || fb();
    case 'name': return (r.name as string) || fb();
    case 'contact': return (r.contact as string) || fb();
    case 'phone': return (r.phone as string) || fb();
    case 'address': return (r.address as string) || fb();
    case 'password': return (r.password as string) || fb();
    case 'birthday': return (r.birthday as string) || fb();
    case 'province': return (r.province as string) || fb();
    case 'city': return (r.city as string) || fb();
    case 'district': return (r.district as string) || fb();
    case 'status': return ((r.onDuty !== undefined ? r.onDuty : r.enabled) as boolean) !== false ? '启用' : '停用';
    case 'level': return r.attrs?.['经销商等级'] || fb();
    case 'category': return r.attrs?.['经销商分类'] || fb();
    case 'brand': return (r.brand as string) || r.attrs?.['主营品牌'] || fb();
    case 'company': return (r.company as string) || r.attrs?.['所属分公司'] || fb();
    case 'department': return (r.department as string) || r.attrs?.['所属部门'] || fb();
    case 'salesArea': return (r.salesArea as string) || r.attrs?.['销售区域'] || fb();
    case 'post': return (r.post as string) || r.attrs?.['岗位'] || fb();
    case 'allowRetail': return r.allowRetail ? '是' : '-';
    default: return fb();
  }
}

/** 弹窗内二次确认 */
function InnerConfirm({ title, children, confirmText, tone = 'primary', onConfirm, onCancel }: {
  title: string;
  children: React.ReactNode;
  confirmText: string;
  tone?: 'primary' | 'danger';
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-2xl">
        <h4 className="text-sm font-semibold text-gray-900">{title}</h4>
        <div className="mt-2 text-sm text-gray-500">{children}</div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onCancel} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50">取消</button>
          <button
            onClick={onConfirm}
            className={`rounded-lg px-3 py-1.5 text-sm text-white ${tone === 'danger' ? 'bg-red-600 hover:bg-red-500' : 'bg-blue-600 hover:bg-blue-700'}`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function DealerSourceModal({ kind, open, onClose, onSynced }: { kind: SourceKind; open: boolean; onClose: () => void; onSynced?: () => void }) {
  const { state, addDealer, updateDealer, removeDealers, addStore, updateStore, removeStores, addEmployee, updateEmployee, removeEmployees, flushNow } = useStore();
  const { tables } = state;
  const [persisted, setPersisted] = useState<PersistedCfg>(() => ({ lastTableId: '', byName: {} }));
  const [cfg, setCfg] = useState<Cfg>(() => blankCfg());
  const [syncing, setSyncing] = useState(false);
  const [pendingTableId, setPendingTableId] = useState<string | null>(null);
  const [confirmSave, setConfirmSave] = useState(false);
  const [confirmSync, setConfirmSync] = useState<{ add: number; update: number; remove: number; rows: number } | null>(null);
  const unit = UNIT[kind];

  useEffect(() => {
    if (!open) return;
    const p = loadPersisted(kind);
    setPersisted(p);
    setCfg(loadSrcCfg(kind) ?? blankCfg());
  }, [open, kind]);

  const table = useMemo(() => tables.find((t) => t.id === cfg.tableId), [tables, cfg.tableId]);
  const tableFields = useMemo(() => (table?.fields?.length ? table.fields : []), [table]) as TableField[];

  // 首次打开/切换某表：缺失字段补默认（order 末尾追加、visible=true、rename=''、filter=false）
  useEffect(() => {
    if (!open || !table) return;
    setCfg((c) => {
      if (c.tableId !== table.id) return c;
      const keys = tableFields.map((f) => f.key);
      const order = [...c.order];
      const visible = { ...c.visible };
      const renames = { ...c.renames };
      const filters = { ...c.filters };
      for (const k of keys) {
        if (!order.includes(k)) order.push(k);
        if (typeof visible[k] !== 'boolean') visible[k] = true;
        if (typeof renames[k] !== 'string') renames[k] = '';
        if (typeof filters[k] !== 'boolean') filters[k] = false;
      }
      return { ...c, order, visible, renames, filters };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, table?.id]);

  const setVisible = (key: string, on: boolean) => setCfg({ ...cfg, visible: { ...cfg.visible, [key]: on } });
  const setFilter = (key: string, on: boolean) => setCfg({ ...cfg, filters: { ...cfg.filters, [key]: on } });
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

  /** 配置落盘：按当前表名归位保存（同表下次上传/选择自动载入，无需重新勾选） */
  const persistCfg = (c: Cfg = cfg) => {
    const key = table ? tableKeyOf(table) : '';
    const next: PersistedCfg = {
      lastTableId: c.tableId,
      byName: {
        ...persisted.byName,
        ...(c.tableId && key
          ? { [key]: { tableId: c.tableId, order: c.order, visible: c.visible, renames: c.renames, filters: c.filters } }
          : {}),
      },
    };
    try {
      localStorage.setItem(cfgKeyOf(kind), JSON.stringify(next));
      setPersisted(next);
    } catch {
      toast.error('本地存储不可用，配置未能保存');
    }
  };

  /** 应用切换到某表：载入该表上次保存的配置；从未配置过则用旧版配置兜底，再不行从全显示开始 */
  const applyTable = (tableId: string) => {
    const t = tables.find((x) => x.id === tableId);
    const saved = t ? persisted.byName[tableKeyOf(t)] : undefined;
    if (saved) {
      setCfg({ tableId, order: [...saved.order], visible: { ...saved.visible }, renames: { ...saved.renames }, filters: { ...(saved.filters ?? {}) } });
    } else if (persisted.legacy && (!t || !persisted.byName[tableKeyOf(t)])) {
      setCfg({ tableId, order: [...persisted.legacy.order], visible: { ...persisted.legacy.visible }, renames: { ...persisted.legacy.renames }, filters: {} });
    } else {
      setCfg(blankCfg(tableId));
    }
  };

  const saveCfg = () => {
    persistCfg();
    setConfirmSave(false);
    toast.success(`${unit}数据源配置已保存（按表名记忆，下次更新同一张表自动套用）`);
  };

  // ===== 同步建档：校验 + 预估 + 执行 =====
  const validateSync = (): { sem: Partial<Record<SemKey, string>>; nameKey: string; rows: Record<string, unknown>[] } | null => {
    if (!table) { toast.warning('请先选择数据来源表'); return null; }
    if (!tableFields.length) { toast.warning('该数据表没有可配置的字段'); return null; }
    const sem = autoSemantics(tableFields, cfg.renames);
    const shownOrder = cfg.order.filter((k) => cfg.visible[k] !== false);
    // 编号列是登录账号与按编号覆盖更新的依据，必须放在显示字段的第一列
    if (!sem.code) {
      toast.error(
        `未识别到「编号」列：来源表需包含名为 编号/经销商编号/店仓编号/员工编号/工号/编码 的列（重命名成这些名称也可以）。编号列必须放在首列后才能同步建档`
      );
      return null;
    }
    if (shownOrder[0] !== sem.code) {
      const codeName = cfg.renames[sem.code] || tableFields.find((f) => f.key === sem.code)?.alias || sem.code;
      const firstName = shownOrder[0] ? cfg.renames[shownOrder[0]] || shownOrder[0] : '（无显示列）';
      toast.error(
        `编号必须在首列：当前第一列是「${firstName}」，请用 ↑ 按钮把「${codeName}」移到第一列后再同步建档`
      );
      return null;
    }
    const nameKey = (sem.name || shownOrder[1]) as string | undefined;
    if (!nameKey) { toast.warning('请勾选并保留至少一个可作为「名称」的字段'); return null; }
    if (!sem.name) {
      const fallbackLabel = cfg.renames[nameKey] || tableFields.find((f) => f.key === nameKey)?.alias || nameKey;
      toast.info(`未精确匹配到「名称」列，已用「${fallbackLabel}」列作为${unit}名称字段`);
    }
    // 行数据完整性防护：行数据与元数据分库存储，若来源表的全量行未持久化（只有 ≤50 行预览），
    // 按预览数据计算「移除」会把绝大多数现有档案误判为待删除——必须阻断并要求重新上传
    if (!Array.isArray(table.rows) || table.rows.length === 0) {
      toast.error(
        `来源表「${table.name}」的全量行数据缺失（当前仅有 ${table.previewRows?.length ?? 0} 行预览数据）。` +
          `为避免按不完整数据误删现有${unit}档案，已阻止同步建档；请先到「数据表管理」对该表重新上传 Excel 文件后再同步`
      );
      return null;
    }
    const rows: Record<string, unknown>[] = table.rows;
    if (!rows.length) { toast.warning('来源表没有可用的数据行'); return null; }
    return { sem, nameKey, rows };
  };

  const planSync = () => {
    const ok = validateSync();
    if (!ok) return;
    const { sem, nameKey, rows } = ok;
    persistCfg(); // 同步前先落配置，避免勾选/重命名丢失
    const LIST = kind === 'dealer' ? state.dealers : kind === 'store' ? state.stores : state.employees;
    const match = (d: (Dealer | Store | Employee) & { code?: string; name: string }, r: Record<string, unknown>) => {
      const code = sem.code ? str(r[sem.code]) : '';
      return code ? d.code === code : d.name === str(r[nameKey]);
    };
    const hitCodes = new Set(rows.map((r) => (sem.code ? str(r[sem.code]) : '')).filter(Boolean));
    let add = 0, update = 0;
    for (const r of rows) {
      if (!str(r[nameKey])) continue;
      if (LIST.find((d: (Dealer | Store | Employee) & { code?: string; name: string }) => match(d, r))) update++;
      else add++;
    }
    const remove = LIST.filter((d: (Dealer | Store | Employee) & { code?: string }) => d.code && !hitCodes.has(d.code)).length;
    setConfirmSync({ add, update, remove, rows: rows.length });
  };

  const doSyncBuild = async () => {
    if (syncing) return;
    const ok = validateSync();
    if (!ok) { setConfirmSync(null); return; }
    const { sem, nameKey, rows } = ok;
    const semKeys = new Set(Object.values(sem).filter((v): v is string => !!v));
    const LIST = kind === 'dealer' ? state.dealers : kind === 'store' ? state.stores : state.employees;
    const add = kind === 'dealer' ? addDealer : kind === 'store' ? addStore : addEmployee;
    const upd = kind === 'dealer' ? updateDealer : kind === 'store' ? updateStore : updateEmployee;
    const rem = kind === 'dealer' ? removeDealers : kind === 'store' ? removeStores : removeEmployees;
    setSyncing(true);
    try {
      let synced = 0, updated = 0, removed = 0, skipped = 0;
      const hit = new Set<string>();
      for (const r of rows) {
        const name = str(r[nameKey]);
        if (!name) { skipped++; continue; }
        const code = sem.code ? str(r[sem.code]) || undefined : undefined;
        if (code) hit.add(code);
        const base: Record<string, unknown> = {
          name,
          code,
          sort: 0,
          enabled: sem.status ? !/停用|禁用|0|否|false/i.test(str(r[sem.status])) : true,
        };
        const pick = (k: SemKey) => (sem[k] ? str(r[sem[k]]) || undefined : undefined);
        if (kind === 'dealer') {
          for (const k of ['contact', 'phone', 'province', 'city', 'district', 'address', 'password', 'birthday'] as SemKey[]) {
            const v = pick(k); if (v) base[k] = v;
          }
          const attrs: Record<string, string> = {};
          const lv = pick('level'); if (lv) attrs['经销商等级'] = lv;
          const ct = pick('category'); if (ct) attrs['经销商分类'] = ct;
          for (const k of cfg.order) {
            if (cfg.visible[k] === false || semKeys.has(k)) continue;
            const v = str(r[k]);
            if (v) attrs[cfg.renames[k] || k] = v;
          }
          base.attrs = attrs;
        } else if (kind === 'store') {
          for (const k of ['contact', 'phone', 'address', 'password', 'birthday', 'brand', 'company', 'department', 'salesArea', 'district'] as SemKey[]) {
            const v = pick(k); if (v) base[k] = v;
          }
          const ar = pick('allowRetail'); if (ar) base.allowRetail = !/否|0|false|不允许/i.test(ar);
          const attrs: Record<string, string> = {};
          for (const k of cfg.order) {
            if (cfg.visible[k] === false || semKeys.has(k)) continue;
            const v = str(r[k]);
            if (v) attrs[cfg.renames[k] || k] = v;
          }
          base.attrs = attrs;
        } else {
          for (const k of ['post', 'password'] as SemKey[]) {
            const v = pick(k); if (v) base[k] = v;
          }
          const onDuty = sem.status ? !/停用|禁用|0|否|false|离职/i.test(str(r[sem.status])) : undefined;
          if (onDuty !== undefined) base.onDuty = onDuty;
          const attrs: Record<string, string> = {};
          // 仅排除已写入 base 顶层/已处理的字段；其余（含被识别为 phone/contact 等但
          // Employee 无对应顶层列）一律进 attrs，避免手机号等字段静默丢失
          const handled = new Set([nameKey, sem.code, sem.post, sem.password, sem.status].filter((v): v is string => !!v));
          for (const k of cfg.order) {
            if (cfg.visible[k] === false || handled.has(k)) continue;
            const v = str(r[k]);
            if (v) attrs[cfg.renames[k] || k] = v;
          }
          base.attrs = attrs;
        }
        const exist = LIST.find((d: (Dealer | Store | Employee) & { code?: string; name: string }) => (code ? d.code === code : d.name === name));
        if (exist) { (upd as (p: Dealer | Store | Employee) => void)({ ...exist, ...(base as Partial<Dealer | Store | Employee>) }); updated++; }
        else { (add as (p: unknown) => unknown)(base); synced++; }
      }
      // 批量移除：一次远端请求完成（逐条发删除请求时，几百条档案会卡住「同步中…」数十秒以上）
      const remIds = LIST.filter((d: (Dealer | Store | Employee) & { code?: string }) => d.code && !hit.has(d.code)).map((d) => d.id);
      if (remIds.length > 0) rem(remIds);
      removed = remIds.length;
      const okFlush = flushNow ? await flushNow() : true;
      toast.success(`同步建档完成：新增 ${synced}、更新 ${updated}${removed ? `、移除 ${removed}` : ''}${skipped ? `、跳过 ${skipped} 行` : ''}${okFlush ? '' : '（云端保存暂未成功，仅存本地）'}`);
      if (kind === 'dealer' && (synced > 0 || updated > 0)) {
        toast.info('经销商登录账号 = J + 编号（例：编号 0290001 → 账号 J0290001），初始密码 123456');
      }
      persistCfg();
      setConfirmSync(null);
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
  const pendingTable = tables.find((t) => t.id === pendingTableId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[86vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-3.5">
          <div className="flex items-center gap-2 text-base font-semibold text-gray-800">
            <Database size={17} className="text-blue-500" />
            {unit}数据源配置
          </div>
          <button onClick={onClose} className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-auto px-5 py-4">
          <div className="mb-4">
            <label className="mb-1.5 block text-sm font-medium text-gray-600">选择数据来源表</label>
            <select
              value={cfg.tableId}
              onChange={(e) => e.target.value && e.target.value !== cfg.tableId && setPendingTableId(e.target.value)}
              className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-400"
            >
              <option value="">请选择数据表…</option>
              {tables.map((t) => (
                <option key={t.id} value={t.id}>{`${t.group ? `[${t.group}] ` : ''}${t.name}（${(t.rows?.length ?? t.previewRows?.length ?? 0)} 行）`}</option>
              ))}
            </select>
            <p className="mt-1.5 text-xs text-gray-400">
              切换数据表需二次确认；字段勾选/顺序/筛选设置按表名自动记忆，同一张表下次更新上传无需重新配置。
              <span className="font-medium text-gray-600">「编号」列必须放在首列</span>
              （作为登录账号与按编号覆盖更新的依据，
              {kind === 'dealer' ? '经销商登录账号为「J+编号」，用来和同编号的店仓区分' : '登录账号为编号'}，
              初始密码取「初始密码」列或系统默认 123456）。
            </p>
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
                <label className="flex shrink-0 items-center gap-1.5 text-xs text-gray-500" title="勾选后参与建档并在列表中显示">
                  <input type="checkbox" checked={shown} onChange={(e) => setVisible(k, e.target.checked)} className="h-4 w-4 accent-blue-600" />
                  显示
                </label>
                <label className="flex shrink-0 items-center gap-1.5 text-xs text-gray-500" title="开启后，列表页在该列提供可搜索的下拉筛选框">
                  <input type="checkbox" checked={cfg.filters[k] === true} onChange={(e) => setFilter(k, e.target.checked)} className="h-4 w-4 accent-blue-600" />
                  筛选
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
        </div>

        <div className="flex items-center justify-between border-t border-gray-200 px-5 py-3">
          <button onClick={() => setConfirmSave(true)} className="flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"><Save size={15} />保存配置</button>
          <button onClick={planSync} disabled={syncing} className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700"><RefreshCw size={15} className={syncing ? 'animate-spin' : ''} />同步建档</button>
        </div>
      </div>

      {pendingTableId && pendingTable && (
        <InnerConfirm
          title="切换数据来源表"
          confirmText="确认切换"
          onConfirm={() => {
            applyTable(pendingTableId);
            setPendingTableId(null);
          }}
          onCancel={() => setPendingTableId(null)}
        >
          确定把数据来源表切换为
          <span className="font-medium text-gray-700">「{pendingTable.group ? `[${pendingTable.group}] ` : ''}{pendingTable.name}」</span>吗？
          <span className="mt-1 block text-xs text-gray-400">
            {persisted.byName[tableKeyOf(pendingTable)]
              ? '将自动载入这张表上次保存的字段配置。'
              : '这张表还没有保存过配置，将按「全部显示」开始。当前未保存的修改不会应用。'}
          </span>
        </InnerConfirm>
      )}

      {confirmSave && (
        <InnerConfirm
          title="保存数据源配置"
          confirmText="确认保存"
          onConfirm={saveCfg}
          onCancel={() => setConfirmSave(false)}
        >
          确定保存当前字段配置吗？
          <span className="mt-1 block text-xs text-gray-400">
            配置将按表名保存：显示勾选、筛选开关、重命名与字段顺序，下次更新上传同一张表时自动套用，无需重新勾选。
          </span>
        </InnerConfirm>
      )}

      {confirmSync && (
        <InnerConfirm
          title="确认同步建档"
          confirmText={syncing ? '同步中…' : '确认同步'}
          onConfirm={() => void doSyncBuild()}
          onCancel={() => !syncing && setConfirmSync(null)}
        >
          来源表共 <b className="text-gray-700">{confirmSync.rows}</b> 行数据，按当前配置执行后将：
          <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-gray-500">
            <li>新增 <b className="text-green-600">{confirmSync.add}</b> 条、覆盖更新 <b className="text-blue-600">{confirmSync.update}</b> 条{unit}档案</li>
            <li>
              移除 <b className="text-red-600">{confirmSync.remove}</b> 条编号不在来源表中的现有{unit}档案
              {confirmSync.remove > 0 && '（请确认来源表数据完整）'}
            </li>
            <li>登录账号按编号自动创建/更新（{kind === 'dealer' ? '经销商 = J+编号' : '账号 = 编号'}）</li>
          </ul>
        </InnerConfirm>
      )}
    </div>
  );
}
