'use client';

import { useMemo, useState, useEffect } from 'react';
import { ChevronLeft, Database, Pencil, Trash2 } from 'lucide-react';
import { useStore } from '@/lib/store';
import { toast } from 'sonner';
import type { Employee } from '@/lib/types';
import DealerSourceModal, { loadSrcCfg, srcColumns, srcValue } from '@/components/DealerSourceModal';
import { ColumnFilter, LoginToggle } from '@/components/ColumnFilter';

export default function EmployeeManage({ onBack }: { onBack: () => void }) {
  const { state, updateEmployee, removeEmployee } = useStore();
  const { employees, dealers, stores } = state;
  const dealerMap = useMemo(() => new Map(dealers.map((d) => [d.id, d.name])), [dealers]);
  const storeMap = useMemo(() => new Map(stores.map((s) => [s.id, s.name])), [stores]);
  const [srcOpen, setSrcOpen] = useState(false);
  const [srcTick, setSrcTick] = useState(0);
  const srcCfg = useMemo(() => loadSrcCfg('employee'), [srcTick]);
  const srcCols = useMemo(() => { const c = srcColumns('employee', srcCfg); return c.length ? c : null; }, [srcCfg]);
  // 列筛选：数据源配置里勾了「筛选」的字段，在列表上方出现可搜索下拉
  const filterCols = useMemo(() => (srcCols ?? []).filter((c) => srcCfg?.filters?.[c.key] === true), [srcCols, srcCfg]);
  const [colFilters, setColFilters] = useState<Record<string, string>>({});
  const colVal = (e: Employee, c: NonNullable<typeof srcCols>[number]) => srcValue('employee', e, c);

  const [kw, setKw] = useState('');
  const q = kw.trim().toLowerCase();
  const filtered = useMemo(() => employees.filter((e) =>
    (!q || (e.name || '').toLowerCase().includes(q) || (e.code || '').toLowerCase().includes(q)) &&
    filterCols.every((c) => {
      const v = colFilters[c.key];
      if (!v) return true;
      return colVal(e, c) === v;
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ), [employees, q, filterCols, colFilters]);

  const [editing, setEditing] = useState<Employee | null>(null);
  const [open, setOpen] = useState(false);
  const [confirmDel, setConfirmDel] = useState<Employee | null>(null);
  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(0);
  const [form, setForm] = useState<{ password: string }>({ password: '' });
  const openEdit = (e: Employee) => { setEditing(e); setForm({ password: e.password ?? '' }); setOpen(true); };

  const save = () => {
    if (!editing) return;
    updateEmployee({ ...editing, password: form.password.trim() || undefined } as Employee);
    setEditing(null);
    setOpen(false);
  };

  const total = filtered.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const paged = filtered.slice(safePage * pageSize, safePage * pageSize + pageSize);

  useEffect(() => { setPage(0); }, [kw, pageSize]);

  const input = 'w-full rounded border border-gray-300 px-2.5 py-1.5 text-sm';
  const label = 'mb-1 block text-xs font-medium text-gray-600';
  return (
    <div className="flex h-full overflow-hidden">
      <aside className="flex flex-1 shrink-0 flex-col overflow-hidden border-r border-gray-200 bg-white">
        <div className="border-b border-gray-100 px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-sm font-medium text-gray-700">
              <button onClick={onBack} title="返回经销商" className="-ml-1 rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"><ChevronLeft size={16} /></button>
              <span>员工列表</span>
              <span className="rounded-full bg-gray-100 px-1.5 text-[11px] text-gray-500">{filtered.length}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <button onClick={() => setSrcOpen(true)} title="数据表驱动建档" className="inline-flex items-center gap-1 rounded-md bg-indigo-600 px-2.5 py-1.5 text-sm text-white hover:bg-indigo-700"><Database size={15} />数据源</button>
            </div>
          </div>
          <input value={kw} onChange={(e) => setKw(e.target.value)} placeholder="搜索员工姓名 / 编号" className="mt-2 w-full rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm outline-none focus:border-blue-400" />
          {filterCols.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {filterCols.map((c) => (
                <ColumnFilter
                  key={c.key}
                  label={c.label}
                  options={Array.from(new Set(employees.map((e) => colVal(e, c))))}
                  value={colFilters[c.key] || ''}
                  onChange={(v) => {
                    setColFilters((m) => ({ ...m, [c.key]: v }));
                    setPage(0);
                  }}
                />
              ))}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-auto">
          <table className="min-w-full border-collapse text-sm [&_td]:whitespace-nowrap [&_th]:whitespace-nowrap" style={{ width: 'max-content' }}>
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs text-gray-500">
                <th className="px-3 py-2.5 font-medium">序号</th>
                {srcCols ? srcCols.map((c) => <th key={c.key} className="px-3 py-2.5 font-medium">{c.label}</th>) : (
                  <>
                    <th className="px-3 py-2.5 font-medium">员工编号</th>
                    <th className="px-3 py-2.5 font-medium">员工姓名</th>
                    <th className="px-3 py-2.5 font-medium">所属经销商</th>
                    <th className="px-3 py-2.5 font-medium">所属店仓</th>
                    <th className="px-3 py-2.5 font-medium">岗位</th>
                    <th className="px-3 py-2.5 font-medium">是否在职</th>
                  </>
                )}
                <th className="px-3 py-2.5 font-medium">可用状态</th>
                <th className="sticky right-0 z-10 border-l border-gray-200 bg-gray-50 px-3 py-2.5 text-right font-medium shadow-[-6px_0_8px_-6px_rgba(0,0,0,0.15)]">操作</th>
              </tr>
            </thead>
            <tbody>
              {paged.map((e, i) => {
                return (
                  <tr key={e.id} className="group border-b border-gray-100 text-gray-700 hover:bg-gray-50">
                    <td className="px-3 py-2.5 text-gray-400">{safePage * pageSize + i + 1}</td>
                    {srcCols ? srcCols.map((c) => <td key={c.key} className="px-3 py-2.5">{colVal(e, c)}</td>) : (
                      <>
                        <td className="px-3 py-2.5">{e.code || '-'}</td>
                        <td className="px-3 py-2.5 font-medium text-gray-900">{e.name}</td>
                        <td className="px-3 py-2.5">{dealerMap.get(e.dealerId ?? '') ?? '-'}</td>
                        <td className="px-3 py-2.5">{storeMap.get(e.storeId ?? '') ?? '-'}</td>
                        <td className="px-3 py-2.5">{e.attrs?.['岗位'] || e.post || '-'}</td>
                        <td className="px-3 py-2.5">{e.onDuty !== false ? '在职' : '离职'}</td>
                      </>
                    )}
                    <td className="px-3 py-2.5">{e.enabled !== false ? <span className="rounded bg-green-50 px-1.5 py-0.5 text-xs font-medium text-green-600">可用</span> : <span className="rounded bg-red-50 px-1.5 py-0.5 text-xs font-medium text-red-500">停用</span>}</td>
                    <td className="sticky right-0 z-10 border-l border-gray-100 px-3 py-2.5 shadow-[-6px_0_8px_-6px_rgba(0,0,0,0.12)] bg-white group-hover:bg-gray-50">
                      <span className="flex items-center justify-end gap-1 text-gray-400">
                        <span className="mr-1 flex items-center gap-1.5 border-r border-gray-100 pr-2" title="允许登录">
                          <LoginToggle
                            checked={e.enabled !== false}
                            onChange={(on) => {
                              if (on === e.enabled) return;
                              updateEmployee({ ...e, enabled: on } as Employee);
                              toast.success(`${on ? '已开启' : '已关闭'}「${e.name}」的登录（${on ? '账号可正常登录' : '登录账号已停用，现有会话一并失效'}）`);
                            }}
                          />
                        </span>
                        <button title="编辑" onClick={() => openEdit(e)} className="rounded p-1 hover:bg-gray-100 hover:text-gray-700"><Pencil size={14} /></button>
                        <button title="删除" onClick={() => setConfirmDel(e)} className="rounded p-1 hover:bg-red-50 hover:text-red-600"><Trash2 size={14} /></button>
                      </span>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={srcCols ? srcCols.length + 3 : 9} className="px-3 py-8 text-center text-sm text-gray-400">暂无员工，点击右上角「数据源」同步建档</td></tr>
              )}
            </tbody>
          </table>
        </div>

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
              <button disabled={safePage === 0} onClick={() => setPage((p) => Math.max(0, p - 1))} className="rounded border border-gray-200 bg-white px-2 py-0.5 disabled:opacity-40 hover:enabled:bg-gray-50">上一页</button>
              <span>{safePage + 1} / {pageCount}</span>
              <button disabled={safePage >= pageCount - 1} onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))} className="rounded border border-gray-200 bg-white px-2 py-0.5 disabled:opacity-40 hover:enabled:bg-gray-50">下一页</button>
            </div>
          </div>
        )}
      </aside>

      {open && editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
            <h3 className="text-base font-semibold text-gray-900">重置员工密码</h3>
            <div className="mt-5">
              <label className={label}>重置密码</label>
              <input value={form.password} onChange={(e) => setForm({ password: e.target.value })} placeholder="留空保持原密码" className="mt-1.5 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-gray-900" />
              <p className="mt-3 text-xs text-gray-400">对象：{editing.name}（员工编号：{editing.code || '-'}）</p>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button onClick={() => setOpen(false)} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50">取消</button>
              <button onClick={save} className="rounded-lg bg-gray-900 px-3 py-1.5 text-sm text-white hover:bg-gray-700">保存</button>
            </div>
          </div>
        </div>
      )}

      {confirmDel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
            <h3 className="text-base font-semibold text-gray-900">删除确认</h3>
            <p className="mt-2 text-sm text-gray-500">确定删除员工「{confirmDel.name}」吗？删除后不可恢复。</p>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setConfirmDel(null)} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm">取消</button>
              <button
                onClick={() => {
                  removeEmployee(confirmDel.id);
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

      <DealerSourceModal kind="employee" open={srcOpen} onClose={() => { setSrcOpen(false); setSrcTick((x) => x + 1); }} onSynced={() => setSrcTick((x) => x + 1)} />
    </div>
  );
}
