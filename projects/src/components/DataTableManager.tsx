'use client';

import React, { useState } from 'react';
import {
  UploadCloud,
  Table2,
  FileSpreadsheet,
  Trash2,
  Tags,
  ArrowLeft,
  Database,
  ChevronRight,
} from 'lucide-react';
import { useStore, formatDateTime } from '@/lib/store';
import { resolvePerm, canOper } from '@/lib/perm';
import { parseTableFile, buildTableFromRows } from '@/lib/parser';
import { uid, type FieldType, type DataTable, type AlertRule } from '@/lib/types';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';

const TYPE_LABEL: Record<FieldType, string> = {
  string: '文本',
  number: '数值',
  date: '日期',
  boolean: '布尔',
};

export function DataTableManager({ onHome }: { onHome?: () => void }) {
  const { state, addTable, removeTable, setActiveTable, renameField, setFieldType } = useStore();
  const meName = typeof window !== 'undefined' ? localStorage.getItem('dn_auth') || '' : '';
  const me = state.persons.find((p) => p.name === meName) ?? null;
  const perm = resolvePerm(me, state.config);
  const can = (op: Parameters<typeof canOper>[2], _rid?: string) => canOper(perm, 'datatables', op);
  const [dragging, setDragging] = useState(false);
  const [openDelete, setOpenDelete] = useState<{ id: string; refs: AlertRule[] } | null>(null);

  const tryDelete = (t: DataTable) => {
    // 若已被规则引用，标注引用来源并由对话框阻止删除；无引用时仍须二次确认
    setOpenDelete({ id: t.id, refs: state.rules.filter((r) => r.tableIds?.includes(t.id)) });
  };

  const handleFile = async (file: File) => {
    try {
      const { rows } = await parseTableFile(file);
      if (!rows.length) {
        toast.error('文件内容为空或未解析出数据');
        return;
      }
      const name = file.name.replace(/\.[^.]+$/, '');
      const { fields, previewRows, rowCount, rows: fullRows } = buildTableFromRows(rows);
      const table: DataTable = {
        id: uid('tbl'),
        name,
        fileName: file.name,
        createdAt: Date.now(),
        rowCount,
        fields,
        previewRows,
        rows: fullRows as Record<string, string | number | boolean>[],
      };
      addTable(table);
      toast.success(`已导入「${name}」，共 ${rowCount} 行`);
    } catch (e) {
      toast.error('数据解析失败，请检查文件格式');
      console.error(e);
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  };

  const active = state.tables.find((t) => t.id === state.activeTableId) ?? state.tables[0];
  const activeId = active?.id ?? '';

  return (
    <div className="flex h-full flex-col px-8 pb-10 pt-6">
      {/* 顶部栏 */}
      <header className="mb-7 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-1.5 text-xs text-gray-400">
            <Database size={13} strokeWidth={1.8} />
            <span>工作台</span>
            <ChevronRight size={12} />
            <span className="text-gray-500">数据表</span>
          </div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-gray-900">数据表管理</h1>
          <p className="mt-1.5 text-sm text-gray-500">上传数据源，为字段打上标签，供预警规则直接引用。</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={onHome}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3.5 py-2 text-sm text-gray-600 transition hover:border-gray-300 hover:text-gray-900"
          >
            <ArrowLeft size={15} strokeWidth={2} />
            返回首页
          </button>
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-700">
            <UploadCloud size={16} strokeWidth={2} />
            上传数据表
            <input
              type="file"
              accept=".xlsx,.xls,.xlsm,.csv,.txt"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleFile(f);
                e.target.value = '';
              }}
            />
          </label>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[340px_1fr] gap-6">
        {/* 左：数据表列表 */}
        <section className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white">
          <div className="flex items-baseline justify-between border-b border-gray-100 px-5 py-4">
            <div className="text-sm font-medium text-gray-700">数据表</div>
            <div className="text-xs text-gray-400">{state.tables.length} 张</div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {state.tables.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-gray-50 text-gray-300">
                  <Table2 size={22} strokeWidth={1.5} />
                </span>
                <p className="text-sm text-gray-400">还没有数据表</p>
              </div>
            ) : (
              <div className="space-y-1.5">
                {state.tables.map((t) => (
                  <div
                    key={t.id}
                    onClick={() => setActiveTable(t.id)}
                    className={`group flex cursor-pointer items-center justify-between rounded-xl border px-3.5 py-3 transition ${
                      t.id === activeId
                        ? 'border-gray-300 bg-gray-50 shadow-sm'
                        : 'border-transparent hover:border-gray-200 hover:bg-gray-50/50'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-500">
                        <Table2 size={17} strokeWidth={1.7} />
                      </span>
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-gray-800">{t.name}</div>
                        <div className="mt-0.5 text-xs text-gray-400">
                          {t.rowCount.toLocaleString()} 行 · {t.fields.length} 字段
                        </div>
                      </div>
                    </div>
                    {can('delete', t.id) && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        tryDelete(t);
                      }}
                      className="rounded-md p-1.5 text-gray-300 opacity-0 transition hover:bg-red-50 hover:text-red-500 group-hover:opacity-100"
                      title="删除数据表"
                    >
                      <Trash2 size={15} />
                    </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="border-t border-gray-100 p-3">
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              className={`flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed px-4 py-3 text-sm transition ${
                dragging ? 'border-gray-400 bg-gray-50 text-gray-700' : 'border-gray-200 text-gray-400 hover:border-gray-300 hover:text-gray-600'
              }`}
            >
              <UploadCloud size={16} strokeWidth={1.7} />
              拖拽文件到此处，或点击上传
              <input
                type="file"
                accept=".xlsx,.xls,.xlsm,.csv,.txt"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleFile(f);
                  e.target.value = '';
                }}
              />
            </div>
          </div>
        </section>

        {/* 右：字段标签化详情 */}
        <section className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white">
          {!active ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-gray-400">
              <FileSpreadsheet size={38} strokeWidth={1.2} />
              <p className="text-sm">上传数据表后，可在此为字段打标签</p>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
                <div>
                  <div className="flex items-center gap-2.5">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gray-900 text-white">
                      <Database size={16} strokeWidth={1.8} />
                    </span>
                    <span className="text-base font-semibold text-gray-900">{active.name}</span>
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">{formatDateTime(active.createdAt)}</span>
                  </div>
                  <p className="mt-1.5 text-xs text-gray-400">共 {active.fields.length} 个字段 · 点击「标签值 / 类型」可标签化并用于规则配置</p>
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-gray-400">
                    <tr className="border-b border-gray-100">
                      <th className="px-4 py-2.5 font-medium">字段（列名）</th>
                      <th className="px-4 py-2.5 font-medium">标签值</th>
                      <th className="px-4 py-2.5 font-medium">类型</th>
                      <th className="px-4 py-2.5 font-medium">样例</th>
                    </tr>
                  </thead>
                  <tbody>
                    {active.fields.map((f) => (
                      <tr key={f.key} className="group/border border-b border-gray-50 hover:bg-gray-50/40">
                        <td className="px-4 py-2.5">
                          <span className="inline-flex items-center gap-2 rounded-md px-2 py-1 text-xs text-gray-700">
                            <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: f.tagColor }} />
                            <span className="font-mono">{f.key}</span>
                          </span>
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-1.5">
                            <Tags size={13} className="shrink-0 text-gray-300" />
                            <input
                              value={f.alias}
                              onChange={(e) => renameField(active.id, f.key, e.target.value)}
                              className="w-40 rounded-md border border-transparent px-2 py-1 text-sm text-gray-800 placeholder:text-gray-300 focus:border-gray-300 focus:outline-none focus:ring-1 focus:ring-gray-200"
                              placeholder="点击输入标签"
                            />
                          </div>
                        </td>
                        <td className="px-4 py-2.5">
                          <select
                            value={f.type}
                            onChange={(e) => setFieldType(active.id, f.key, e.target.value as FieldType)}
                            className="rounded-md border border-gray-200 bg-white px-2 py-1 text-xs text-gray-600 outline-none hover:border-gray-300"
                          >
                            {(['string', 'number', 'date', 'boolean'] as FieldType[]).map((t) => (
                              <option key={t} value={t}>
                                {TYPE_LABEL[t]}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="max-w-[180px] truncate px-4 py-2.5 text-xs text-gray-400">{f.sample || '—'}</td>
                      </tr>
                    ))}
                    {active.fields.length === 0 && (
                      <tr>
                        <td colSpan={4} className="px-4 py-10 text-center text-sm text-gray-400">
                          该表未解析出字段
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="border-t border-gray-100 bg-gray-50/60 px-6 py-4">
                <div className="mb-2 text-xs font-medium text-gray-500">数据预览 · 前 {active.previewRows.length} 行</div>
                <div className="overflow-auto rounded-xl border border-gray-150 bg-white">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50 text-left text-gray-500">
                      <tr>
                        {active.fields.map((f) => (
                          <th key={f.key} className="whitespace-nowrap px-3 py-2 font-medium">
                            {f.alias || f.key}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {active.previewRows.map((r, i) => (
                        <tr key={i} className="border-t border-gray-50">
                          {active.fields.map((f) => (
                            <td key={f.key} className="whitespace-nowrap px-3 py-2 text-gray-500">
                              {r[f.key] ?? ''}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </section>
      </div>

      <AlertDialog open={!!openDelete} onOpenChange={(v) => !v && setOpenDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {openDelete && openDelete.refs.length > 0 ? '无法删除数据表' : '删除数据表'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {openDelete && openDelete.refs.length > 0 ? (
                <>
                  该数据表已被 <span className="font-semibold text-gray-700">{openDelete.refs.length}</span>{' '}
                  条预警规则引用：
                  <span className="mt-1 block">
                    {openDelete.refs.map((r) => r.name).join('、')}
                  </span>
                  <span className="mt-2 block text-gray-500">
                    请先删除这些预警规则，才能删除数据表，以免规则因数据缺失而失效。
                  </span>
                </>
              ) : (
                <>
                  删除后该数据表将无法用于任何预警规则，且不可恢复。确认要删除吗？
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setOpenDelete(null)}>{openDelete && openDelete.refs.length > 0 ? '知道了' : '取消'}</AlertDialogCancel>
            {openDelete && openDelete.refs.length === 0 && (
              <AlertDialogAction
                className="bg-red-600 text-white hover:bg-red-700"
                onClick={() => {
                  if (openDelete) removeTable(openDelete.id);
                  setOpenDelete(null);
                  toast.success('已删除数据表');
                }}
              >
                确认删除
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}