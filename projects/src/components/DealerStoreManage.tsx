'use client';

import { useMemo, useRef, useState, useEffect } from 'react';
import { ChevronDown, ChevronUp, Database, Download, Pencil, Plus, Trash2, Upload } from 'lucide-react';
import * as XLSX from 'xlsx';
import { useStore } from '@/lib/store';
import { resolvePerm, canOper } from '@/lib/perm';
import { toast } from 'sonner';
import type { AttrCategory, Dealer, HrAttribute, Store } from '@/lib/types';
import { parseExcel } from '@/lib/parser';
import DealerSourceModal, { classifyField, loadSrcCfg, srcColumns, srcValue, type SemKey } from '@/components/DealerSourceModal';

type Kind = 'dealer' | 'store';

const KIND_CATEGORY: Record<Kind, AttrCategory> = { dealer: 'dealer', store: 'store' };

const META: Record<Kind, { unit: string; label: string }> = {
  dealer: { unit: '经销商', label: '经销商列表' },
  store: { unit: '店仓', label: '店仓列表' },
};

export function DealerStoreManage({ kind }: { kind: Kind }) {
  const { state, addDealer, updateDealer, removeDealer, moveDealer, addStore, updateStore, removeStore, moveStore } = useStore();
  const meName = typeof window !== 'undefined' ? localStorage.getItem('dn_auth') || '' : '';
  const me = state.persons.find((p) => p.name === meName) ?? null;
  const perm = resolvePerm(me, state.config);
  const mod: 'dealer' | 'store' = kind === 'dealer' ? 'dealer' : 'store';
  const can = (op: Parameters<typeof canOper>[2], _rid?: string) => canOper(perm, mod, op);
  const { dealers, stores, hrAttributes } = state;

  const list: (Dealer | Store)[] = (kind === 'dealer' ? dealers : stores).slice().sort((a, b) => a.sort - b.sort);
  const [kw, setKw] = useState('');
  const [activeId, setActiveId] = useState<string>(list[0]?.id || '');
  const [dictForm, setDictForm] = useState<{ item: (Dealer | Store) | null } | null>(null);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [srcOpen, setSrcOpen] = useState(false);
  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(0);

  // 经销商数据源驱动：仅展示来源表勾选显示的字段列（未配置时为 null 走基础列兜底）
  const [srcTick, setSrcTick] = useState(0);
  const srcCfg = useMemo(() => (kind === 'dealer' || kind === 'store') ? loadSrcCfg(kind) : null, [kind, srcTick]);
  const srcCols = useMemo(() => {
    if (kind !== 'dealer' && kind !== 'store') return null;
    const cols = srcColumns(kind, srcCfg);
    return cols.length ? cols : null;
  }, [kind, srcCfg]);
  const dealerColVal = (d: Dealer | Store, c: NonNullable<typeof srcCols>[number]) => srcValue(kind, d, c);
  const q = kw.trim().toLowerCase();
  const filtered = q ? list.filter((d) => (d.name || '').toLowerCase().includes(q) || (d.code || '').toLowerCase().includes(q)) : list;
  const total = filtered.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const paged = filtered.slice(safePage * pageSize, safePage * pageSize + pageSize);
  const unit = META[kind].unit;

  useEffect(() => { setPage(0); }, [kw, pageSize]);

  const categoryAttrs = hrAttributes.filter((a) => (a.category ?? 'person') === KIND_CATEGORY[kind]);

  const field = (d: Dealer | Store) => (kind === 'dealer' ? updateDealer(d as Dealer) : updateStore(d as Store));
  const remove = (id: string) => (kind === 'dealer' ? removeDealer(id) : removeStore(id));
  const move = (id: string, dir: -1 | 1) => (kind === 'dealer' ? moveDealer(id, dir) : moveStore(id, dir));

  const saveUnit = (draft: Omit<Dealer, 'id' | 'createdAt'> | Omit<Store, 'id' | 'createdAt'>) => {
    const active: Dealer | Store | undefined = dictForm?.item ?? list.find((x) => x.id === activeId);
    if (active) {
      field({ ...(active as object), ...(draft as object) } as Dealer);
    } else {
      const code = (draft as { code?: string }).code?.trim() ?? '';
      const name = (draft as { name?: string }).name?.trim() ?? '';
      const dup = list.find(
        (x) =>
          (kind === 'dealer' && ((code && x.code === code) || x.name === name)) ||
          (kind === 'store' && ((code && x.code === code) || x.name === name))
      );
      if (dup) {
        toast('已存在重复的' + (kind === 'dealer' ? '经销商编号或名称' : '店仓编号或名称') + '，不能新增');
        return;
      }
      (kind === 'dealer' ? addDealer : addStore)(draft as never);
    }
  };

  const TEMPLATE_COLS = kind === 'dealer'
    ? ['经销商编号', '经销商名称', '状态', '联系人', '电话', '省份', '城市', '区县', '地址']
    : ['店仓编号', '店仓名称', '所属经销商', '主营品牌', '分公司', '部门', '销售区域', '区部', '是否允许零售', '状态', '联系人', '电话', '地址'];

  const downloadTemplate = () => {
    const aoa = [TEMPLATE_COLS];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '模板');
    XLSX.writeFile(wb, `${unit}导入模板.xlsx`);
  };

  const handleImport = async (file: File) => {
    setLoading(true);
    try {
      if (file.name.endsWith('.xlsx') || file.name.endsWith('.xls') || file.name.endsWith('.xlsm')) {
      const { rows } = await parseExcel(file);
      if (!rows.length) return toast.error('模板中没有数据');
      let ok = 0;
      let updated = 0;
      const noStatus: string[] = [];
      const skipped: string[] = [];
      for (const r of rows) {
        const required = kind === 'dealer'
          ? ['经销商名称']
          : ['店仓编号', '店仓名称', '所属经销商', '主营品牌', '分公司', '部门', '销售区域', '区部', '是否允许零售', '状态'];
        const missing = required.filter((col) => String(r[col] ?? '').trim() === '');
        if (missing.length) { skipped.push(`${kind === 'store' ? '店仓档案' : '经销商档案'}行缺:${missing.join('/')}`); continue; }
        const attrs: Record<string, string> = {};
        if (kind === 'dealer') {
          const lv = String(r['经销商等级'] ?? '').trim();
          const cat = String(r['经销商分类'] ?? '').trim();
          if (lv) attrs['经销商等级'] = lv;
          if (cat) attrs['经销商分类'] = cat;
        } else {
          ['主营品牌', '分公司', '部门', '销售区域', '区部'].forEach((col) => {
            const v = String(r[col] ?? '').trim();
            if (v) attrs[col] = v;
          });
        }
        const enabled = !/停用|禁用|0|否/i.test(String(r['状态'] ?? '启用'));
        const codeStr = String(r['经销商编号'] ?? '').trim();
        const nameStr = String(r['经销商名称'] ?? '').trim();
        if (kind === 'dealer') {
          if (!codeStr || !nameStr) {
            skipped.push(`经销商编号/名称缺失（${codeStr || '-'}）`);
            return;
          }
          const base: Omit<Dealer, 'id' | 'createdAt'> = {
            code: codeStr || undefined,
            name: nameStr,
            attrs,
            enabled,
            sort: 0,
            contact: String(r['联系人'] ?? '').trim() || undefined,
            phone: String(r['电话'] ?? '').trim() || undefined,
            province: String(r['省份'] ?? '').trim() || undefined,
            city: String(r['城市'] ?? '').trim() || undefined,
            district: String(r['区县'] ?? '').trim() || undefined,
            address: String(r['地址'] ?? '').trim() || undefined,
            password: String(r['密码'] ?? '').trim() || undefined,
            birthday: String(r['生日'] ?? '').trim() || undefined,
          };
          const exist = dealers.find((x) => x.code === codeStr);
          if (exist) {
            updateDealer({ ...exist, ...base });
            updated++;
          } else {
            addDealer(base as Dealer);
          }
        } else {
          const dealerName = String(r['所属经销商'] ?? '').trim();
          const dealer = dealers.find((x) => x.name === dealerName);
          if (!dealer) noStatus.push(String(r['店仓名称'] ?? ''));
          addStore({
            code: String(r['店仓编号'] ?? '').trim() || undefined,
            name: String(r['店仓名称']).trim(),
            attrs,
            dealerId: dealer?.id,
            allowRetail: !/否|0|不允许/i.test(String(r['是否允许零售'] ?? '是')),
            enabled,
            sort: 0,
            contact: String(r['联系人'] ?? '').trim() || undefined,
            phone: String(r['电话'] ?? '').trim() || undefined,
            address: String(r['地址'] ?? '').trim() || undefined,
          } as never);
        }
        ok++;
      }
      if (noStatus.length) toast.warning(`以下店仓未匹配到所属经销商：${noStatus.join('、')}`);
      if (skipped.length) toast.warning(`跳过 ${skipped.length} 行（缺少必填项）：${skipped.slice(0, 5).join('；')}${skipped.length > 5 ? ' 等' : ''}`);
      if (ok) toast.success(kind === 'dealer' ? `成功导入 ${ok} 条商户（新增 ${ok - updated}、更新 ${updated}）` : `成功导入 ${ok} 条${unit}`);
    } else {
      toast.error('请上传 .xlsx / .xls / .xlsm 文件');
    }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex h-full overflow-hidden">
      {/* 列表：经销商 / 店仓 宽表格 */}
      <aside className="flex flex-1 shrink-0 flex-col overflow-hidden border-r border-gray-200 bg-white">
        <div className="border-b border-gray-100 px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-sm font-medium text-gray-700">
              <span>{META[kind].label}</span>
              <span className="rounded-full bg-gray-100 px-1.5 text-[11px] text-gray-500">{filtered.length}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <button onClick={() => setSrcOpen(true)} title="数据表驱动建档" className="inline-flex items-center gap-1 rounded-md bg-indigo-600 px-2.5 py-1.5 text-sm text-white hover:bg-indigo-700"><Database size={15} />数据源</button>
            </div>
          </div>
          <input value={kw} onChange={(e) => setKw(e.target.value)} placeholder={`搜索${unit}名称 / 编号`} className="mt-2 w-full rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm outline-none focus:border-blue-400" />
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.xlsm" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImport(f); e.target.value = ''; }} />
        </div>

        <div className="flex-1 overflow-auto">
          <table className="min-w-full border-collapse text-sm [&_td]:whitespace-nowrap [&_th]:whitespace-nowrap" style={{ width: 'max-content' }}>
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs text-gray-500">
                <th className="px-3 py-2.5 font-medium">序号</th>
                {srcCols ? (
                  srcCols.map((c) => <th key={c.key} className="px-3 py-2.5 font-medium">{c.label}</th>)
                ) : (
                  <>
                    <th className="px-3 py-2.5 font-medium">{unit}编号</th>
                    <th className="px-3 py-2.5 font-medium">{unit}名称</th>
                    {kind === 'store' && <th className="px-3 py-2.5 font-medium">所属经销商</th>}
                    {kind === 'dealer' && <th className="px-3 py-2.5 font-medium">经销商等级</th>}
                    {kind === 'dealer' && <th className="px-3 py-2.5 font-medium">经销商分类</th>}
                    {kind === 'store' && <th className="px-3 py-2.5 font-medium">主营品牌</th>}
                    {kind === 'store' && <th className="px-3 py-2.5 font-medium">分公司</th>}
                    {kind === 'store' && <th className="px-3 py-2.5 font-medium">部门</th>}
                    {kind === 'store' && <th className="px-3 py-2.5 font-medium">销售区域</th>}
                    {kind === 'store' && <th className="px-3 py-2.5 font-medium">区部</th>}
                    {kind === 'store' && <th className="px-3 py-2.5 font-medium">允许零售</th>}
                    {kind === 'dealer' && <th className="px-3 py-2.5 font-medium">省份</th>}
                    {kind === 'dealer' && <th className="px-3 py-2.5 font-medium">城市</th>}
                    {kind === 'dealer' && <th className="px-3 py-2.5 font-medium">区县</th>}
                  </>
                )}
                <th className="px-3 py-2.5 font-medium">状态</th>
                <th className="px-3 py-2.5 font-medium text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {paged.map((d, idx) => {
                const s = d as Store;
                const rowNo = safePage * pageSize + idx + 1;
                return (
                  <tr key={d.id} onClick={() => setActiveId(d.id)} className={`cursor-pointer border-b border-gray-100 ${activeId === d.id ? 'bg-blue-50' : 'text-gray-700 hover:bg-gray-50'}`}>
                    <td className="px-3 py-2.5 text-gray-400">{rowNo}</td>
                    {srcCols ? (
                      srcCols.map((c) => <td key={c.key} className="px-3 py-2.5">{dealerColVal(d as Dealer, c)}</td>)
                    ) : (
                      <>
                        <td className="px-3 py-2.5">{d.code || '-'}</td>
                        <td className={`px-3 py-2.5 font-medium ${activeId === d.id ? 'text-blue-700' : 'text-gray-900'}`}>{d.name}</td>
                        {kind === 'store' && <td className="px-3 py-2.5">{dealers.find((x) => x.id === s.dealerId)?.name ?? '-'}</td>}
                        {kind === 'dealer' && <td className="px-3 py-2.5">{s.attrs?.['经销商等级'] || '-'}</td>}
                        {kind === 'dealer' && <td className="px-3 py-2.5">{s.attrs?.['经销商分类'] || '-'}</td>}
                        {kind === 'store' && <td className="px-3 py-2.5">{s.attrs?.['主营品牌'] || '-'}</td>}
                        {kind === 'store' && <td className="px-3 py-2.5">{s.attrs?.['分公司'] || '-'}</td>}
                        {kind === 'store' && <td className="px-3 py-2.5">{s.attrs?.['部门'] || '-'}</td>}
                        {kind === 'store' && <td className="px-3 py-2.5">{s.attrs?.['销售区域'] || '-'}</td>}
                        {kind === 'store' && <td className="px-3 py-2.5">{s.attrs?.['区部'] || '-'}</td>}
                        {kind === 'store' && <td className="px-3 py-2.5">{s.allowRetail === false ? '不允许' : '允许'}</td>}
                        {kind === 'dealer' && <td className="px-3 py-2.5">{(d as unknown as { province?: string }).province || '-'}</td>}
                        {kind === 'dealer' && <td className="px-3 py-2.5">{(d as unknown as { city?: string }).city || '-'}</td>}
                        {kind === 'dealer' && <td className="px-3 py-2.5">{(d as unknown as { district?: string }).district || '-'}</td>}
                      </>
                    )}
                    <td className="px-3 py-2.5">{s.enabled === false ? <span className="rounded bg-red-50 px-1.5 py-0.5 text-xs font-medium text-red-500">停用</span> : <span className="rounded bg-green-50 px-1.5 py-0.5 text-xs font-medium text-green-600">启用</span>}</td>
                    <td className="px-3 py-2.5">
                      <span className="flex items-center justify-end gap-0.5 text-gray-400">
                        <button title="上移" onClick={(e) => { e.stopPropagation(); move(d.id, -1); }} className="rounded p-1 hover:bg-gray-100 hover:text-gray-700"><ChevronUp size={14} /></button>
                        <button title="下移" onClick={(e) => { e.stopPropagation(); move(d.id, 1); }} className="rounded p-1 hover:bg-gray-100 hover:text-gray-700"><ChevronDown size={14} /></button>
                        {can('edit', d.id) && <button title="编辑" onClick={(e) => { e.stopPropagation(); setDictForm({ item: d }); }} className="rounded p-1 hover:bg-gray-100 hover:text-gray-700"><Pencil size={14} /></button>}
                        {can('delete', d.id) && <button title="删除" onClick={(e) => { e.stopPropagation(); setConfirmDel(d.id); }} className="rounded p-1 hover:bg-red-50 hover:text-red-600"><Trash2 size={14} /></button>}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {filtered.length === 0 && <div className="px-4 py-8 text-center text-sm text-gray-400">暂无{unit}，点击右上角新增{unit}</div>}
          {filtered.length > 0 && (
            <div className="flex items-center justify-between border-t border-gray-100 px-3 py-2 text-xs text-gray-500">
              <div className="flex items-center gap-1.5">
                共 <span className="font-medium text-gray-700">{total}</span> 行
                <span className="mx-1 text-gray-300">|</span>
                每页
                <select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(0); }} className="rounded border border-gray-200 bg-white px-1 py-0.5 outline-none">
                  {[10, 20, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
                行
              </div>
              <div className="flex items-center gap-1.5">
                <button disabled={safePage === 0} onClick={() => setPage((p) => Math.max(0, p - 1))} className="rounded border border-gray-200 bg-white px-2 py-0.5 disabled:opacity-40 hover:enabled:bg-gray-50">
                  上一页
                </button>
                <span>{safePage + 1} / {pageCount}</span>
                <button disabled={safePage >= pageCount - 1} onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))} className="rounded border border-gray-200 bg-white px-2 py-0.5 disabled:opacity-40 hover:enabled:bg-gray-50">
                  下一页
                </button>
              </div>
            </div>
          )}
        </div>
      </aside>

      {dictForm && (
        <DictForm
          key={dictForm.item?.id ?? 'new'}
          kind={kind}
          initial={dictForm.item as (Dealer | Store) | null}
          categoryAttrs={categoryAttrs}
          dealerOptions={dealers}
          onClose={() => setDictForm(null)}
          onSave={saveUnit}
        />
      )}

      {confirmDel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
            <h3 className="text-base font-semibold text-gray-900">删除确认</h3>
            <p className="mt-2 text-sm text-gray-500">确定删除该记录吗？删除后不可恢复。</p>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setConfirmDel(null)} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm">取消</button>
              <button
                onClick={() => {
                  remove(confirmDel);
                  setConfirmDel(null);
                }}
                className="rounded-lg bg-red-600 px-3 py-1.5 text-sm text-white hover:bg-red-500"
              >
                删除
              </button>
            </div>
          </div>
        </div>
      )}

      <DealerSourceModal kind={kind} open={srcOpen} onClose={() => setSrcOpen(false)} onSynced={() => setSrcTick((x) => x + 1)} />
    </div>
  );
}

/** 经销商/店仓 新增或编辑弹窗 */
function DictForm(props: {
  kind: Kind;
  initial: (Dealer | Store) | null;
  categoryAttrs: HrAttribute[];
  dealerOptions: Dealer[];
  onClose: () => void;
  onSave: (d: Omit<Dealer, 'id' | 'createdAt'> | Omit<Store, 'id' | 'createdAt'>) => void;
}) {
  const { kind, initial, onClose, onSave } = props;
  const unit = META[kind].unit;
  const [password, setPassword] = useState(initial?.password ?? '');

  const save = () => {
    const d = initial as (Dealer | Store) | null;
    if (!d?.name) return toast.error(`缺少${unit}名称，无法保存`);
    onSave({ ...d, password: password || undefined, sort: d.sort ?? 0 } as Omit<Dealer, 'id' | 'createdAt'>);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
        <h3 className="text-base font-semibold text-gray-900">重置{unit}密码</h3>
        <div className="mt-5">
          <label className="block text-xs font-medium text-gray-500">重置密码</label>
          <input value={password} onChange={(e) => setPassword(e.target.value)} type="text" placeholder="留空保持原密码" className="mt-1.5 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-gray-900" />
          {initial?.name && <p className="mt-3 text-xs text-gray-400">对象：{initial.name}（{unit}编号：{initial.code || '-'}）</p>}
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm">取消</button>
          <button onClick={save} className="rounded-lg bg-gray-900 px-3 py-1.5 text-sm text-white hover:bg-gray-700">保存</button>
        </div>
      </div>
    </div>
  );
}

