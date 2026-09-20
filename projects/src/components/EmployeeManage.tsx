'use client';

import { useMemo, useState, useEffect } from 'react';
import { Database, Pencil, Trash2 } from 'lucide-react';
import { useStore } from '@/lib/store';
import { toast } from 'sonner';
import type { Employee } from '@/lib/types';
import DealerSourceModal, { loadSrcCfg, srcColumns, srcValue } from '@/components/DealerSourceModal';

export default function EmployeeManage({ onBack }: { onBack: () => void }) {
  const { state, updateEmployee, removeEmployee } = useStore();
  const { employees, dealers, stores, hrAttributes } = state;
  const dealerMap = useMemo(() => new Map(dealers.map((d) => [d.id, d.name])), [dealers]);
  const storeMap = useMemo(() => new Map(stores.map((s) => [s.id, s.name])), [stores]);
  const empAttrs = useMemo(() => hrAttributes.filter((a) => (a.category ?? 'person') === 'employee'), [hrAttributes]);
  const [srcOpen, setSrcOpen] = useState(false);
  const [srcTick, setSrcTick] = useState(0);
  const srcCfg = useMemo(() => loadSrcCfg('employee'), [srcTick]);
  const srcCols = useMemo(() => { const c = srcColumns('employee', srcCfg); return c.length ? c : null; }, [srcCfg]);
  const [f, setF] = useState({ dealerId: '', storeId: '', code: '', name: '', post: '', onDuty: '', enabled: '' });
  const filtered = useMemo(() => employees.filter((e) =>
    (!f.dealerId || e.dealerId === f.dealerId) &&
    (!f.storeId || e.storeId === f.storeId) &&
    (!f.code || (e.code ?? '').toLowerCase().includes(f.code.toLowerCase())) &&
    (!f.name || e.name.includes(f.name)) &&
    (!f.post || (e.attrs?.['岗位'] || e.post || '') === f.post) &&
    (!f.onDuty || (e.onDuty !== false) === (f.onDuty === '1')) &&
    (!f.enabled || (e.enabled !== false) === (f.enabled === '1'))
  ), [employees, f]);

  const [editing, setEditing] = useState<Employee | null>(null);
  const [open, setOpen] = useState(false);
  const [pageSize, setPageSize] = useState(20);
  const [page, setPage] = useState(0);
  const [form, setForm] = useState<{ code: string; name: string; dealerId: string; storeId: string; post: string; onDuty: boolean; enabled: boolean; password: string; attrs: Record<string, string> }>({ code: '', name: '', dealerId: '', storeId: '', post: '', onDuty: true, enabled: true, password: '', attrs: {} });
  const openEdit = (e: Employee) => { setEditing(e); setForm({ code: e.code ?? '', name: e.name, dealerId: e.dealerId ?? '', storeId: e.storeId ?? '', post: e.post ?? '', onDuty: e.onDuty !== false, enabled: e.enabled !== false, password: e.password ?? '', attrs: e.attrs ?? {} }); setOpen(true); };

  const save = () => {
    if (!editing) return;
    updateEmployee({ ...editing, password: form.password.trim() || undefined } as Employee);
    setEditing(null);
    setOpen(false);
  };

  const del = (e: Employee) => { if (confirm(`确认删除员工「${e.name}」？`)) removeEmployee(e.id); };

  const total = filtered.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const paged = filtered.slice(safePage * pageSize, safePage * pageSize + pageSize);

  useEffect(() => { setPage(0); }, [filtered, pageSize]);

  const input = 'w-full rounded border border-gray-300 px-2.5 py-1.5 text-sm';
  const label = 'mb-1 block text-xs font-medium text-gray-600';
  const th = 'border border-gray-200 px-3 py-2 text-left text-xs font-semibold text-gray-600 bg-gray-50';
  const td = 'border border-gray-200 px-3 py-2 text-sm text-gray-700';
  const sel = 'w-full rounded border border-gray-300 px-2 py-1.5 text-sm';

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="rounded border border-gray-300 px-3 py-1 text-sm text-gray-600 hover:bg-gray-100">‹ 返回</button>
        <div className="flex items-center gap-2">
          <button onClick={() => setSrcOpen(true)} title="数据表驱动建档" className="inline-flex items-center gap-1 rounded bg-indigo-600 px-3 py-1 text-sm text-white hover:bg-indigo-700"><Database className="h-3.5 w-3.5" />数据源</button>
        </div>
      </div>

      <div className="rounded-md border border-gray-200 bg-white px-3 py-2.5">
        <div className="grid grid-cols-2 gap-x-3 gap-y-2 md:grid-cols-4 xl:grid-cols-8">
          <div>
            <label className={label}>所属经销商</label>
            <select value={f.dealerId} onChange={(e) => setF({ ...f, dealerId: e.target.value })} className={sel}><option value="">全部</option>{dealers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
          </div>
          <div>
            <label className={label}>所属店仓</label>
            <select value={f.storeId} onChange={(e) => setF({ ...f, storeId: e.target.value })} className={sel}><option value="">全部</option>{stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
          </div>
          <div>
            <label className={label}>员工编号</label>
            <input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} placeholder="编号" className={input} />
          </div>
          <div>
            <label className={label}>员工姓名</label>
            <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="姓名" className={input} />
          </div>
          <div>
            <label className={label}>岗位</label>
            <select value={f.post} onChange={(e) => setF({ ...f, post: e.target.value })} className={sel}><option value="">全部</option>{(empAttrs.find((a) => a.name === '岗位')?.items ?? []).map((x) => <option key={x.id} value={x.name}>{x.name}</option>)}</select>
          </div>
          <div>
            <label className={label}>在职状态</label>
            <select value={f.onDuty} onChange={(e) => setF({ ...f, onDuty: e.target.value })} className={sel}><option value="">全部</option><option value="1">在职</option><option value="0">离职</option></select>
          </div>
          <div>
            <label className={label}>可用状态</label>
            <select value={f.enabled} onChange={(e) => setF({ ...f, enabled: e.target.value })} className={sel}><option value="">全部</option><option value="1">可用</option><option value="0">停用</option></select>
          </div>
          <div className="flex items-end">
            <button onClick={() => setF({ dealerId: '', storeId: '', code: '', name: '', post: '', onDuty: '', enabled: '' })} className="h-[34px] w-full rounded border border-gray-300 text-sm text-gray-600 hover:bg-gray-100">重置</button>
          </div>
        </div>
      </div>

      <div className="max-h-[calc(100vh-200px)] overflow-auto rounded border border-gray-200">
        <table className="w-full border-collapse bg-white">
          <thead>
            <tr>
              <th className={th}>序号</th>
              {srcCols ? srcCols.map((c) => <th key={c.key} className={th}>{c.label}</th>) : (
                <>
                  <th className={th}>员工编号</th>
                  <th className={th}>员工姓名</th>
                  <th className={th}>所属经销商</th>
                  <th className={th}>所属店仓</th>
                  <th className={th}>岗位</th>
                  <th className={th}>是否在职</th>
                  <th className={th}>是否可用</th>
                </>
              )}
              <th className={th}>操作</th>
            </tr>
          </thead>
          <tbody>
            {paged.map((e, i) => (
              <tr key={e.id} className="hover:bg-gray-50">
                <td className={td}>{safePage * pageSize + i + 1}</td>
                {srcCols ? srcCols.map((c) => <td key={c.key} className={td}>{srcValue('employee', e, c)}</td>) : (
                  <>
                    <td className={td}>{e.code}</td>
                    <td className={td}>{e.name}</td>
                    <td className={td}>{dealerMap.get(e.dealerId ?? '') ?? '-'}</td>
                    <td className={td}>{storeMap.get(e.storeId ?? '') ?? '-'}</td>
                    <td className={td}>{e.attrs?.['岗位'] || e.post || '-'}</td>
                    <td className={td}>{e.onDuty !== false ? '在职' : '离职'}</td>
                    <td className={td}>{e.enabled !== false ? '可用' : '停用'}</td>
                  </>
                )}
                <td className={td}>
                  <div className="flex items-center gap-1">
                    <button onClick={() => openEdit(e)} className="rounded p-1 text-blue-600 hover:bg-blue-50"><Pencil className="h-4 w-4" /></button>
                    <button onClick={() => del(e)} className="rounded p-1 text-red-500 hover:bg-red-50"><Trash2 className="h-4 w-4" /></button>
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={srcCols ? srcCols.length + 2 : 9} className="px-3 py-8 text-center text-sm text-gray-400">暂无员工</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {filtered.length > 0 && (
        <div className="mt-2 flex items-center justify-between text-xs text-gray-500">
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
            <button disabled={safePage === 0} onClick={() => setPage((p) => Math.max(0, p - 1))} className="rounded border border-gray-200 bg-white px-2 py-0.5 disabled:opacity-40 hover:enabled:bg-gray-50">上一页</button>
            <span>{safePage + 1} / {pageCount}</span>
            <button disabled={safePage >= pageCount - 1} onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))} className="rounded border border-gray-200 bg-white px-2 py-0.5 disabled:opacity-40 hover:enabled:bg-gray-50">下一页</button>
          </div>
        </div>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setOpen(false)}>
          <div className="w-[420px] rounded-lg bg-white p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-3 text-base font-semibold">重置员工密码</h3>
            {editing && <p className="mb-3 text-xs text-gray-400">对象：{editing.name}（员工编号：{editing.code || '-'}）</p>}
            <div>
              <label className={label}>重置密码</label>
              <input value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="留空保持原密码" className={input} />
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setOpen(false)} className="rounded border border-gray-300 px-4 py-1.5 text-sm text-gray-600 hover:bg-gray-100">取消</button>
              <button onClick={save} className="rounded bg-blue-600 px-4 py-1.5 text-sm text-white hover:bg-blue-700">保存</button>
            </div>
          </div>
        </div>
      )}

      <DealerSourceModal kind="employee" open={srcOpen} onClose={() => setSrcOpen(false)} onSynced={() => setSrcTick((x) => x + 1)} />
    </div>
  );
}