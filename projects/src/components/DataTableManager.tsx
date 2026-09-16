'use client';

import React, { useMemo, useRef, useState } from 'react';
import {
  UploadCloud,
  Table2,
  FileSpreadsheet,
  Trash2,
  Tags,
  Database,
  ChevronRight,
  RefreshCw,
  Undo2,
  Folder,
  FolderOpen,
  Plus,
  MoreVertical,
  Pencil,
  Inbox,
  FolderPlus,
  FolderInput,
  ArrowUp,
  ArrowDown,
  Lock,
  Unlock,
} from 'lucide-react';
import { useStore, formatDateTime } from '@/lib/store';
import { resolvePerm, canOper } from '@/lib/perm';
import { Input } from '@/components/ui/input';
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const TYPE_LABEL: Record<FieldType, string> = {
  string: '文本',
  number: '数值',
  date: '日期',
  boolean: '布尔',
};

export function DataTableManager() {
  const { state, addTable, updateTable, removeTable, setActiveTable, renameField, setFieldType, toggleFieldVisible, toggleFieldLock, moveField, addField, addTableGroup, updateTableGroup, removeTableGroup } = useStore();
  const meName = typeof window !== 'undefined' ? localStorage.getItem('dn_auth') || '' : '';
  const me = state.persons.find((p) => p.name === meName) ?? null;
  const perm = resolvePerm(me, state.config);
  const can = (op: Parameters<typeof canOper>[2], _rid?: string) => canOper(perm, 'datatables', op);
  const [dragging, setDragging] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [openDelete, setOpenDelete] = useState<{ id: string; refs: AlertRule[] } | null>(null);
  const [openUpdate, setOpenUpdate] = useState<{
    t: DataTable;
    next: { name: string; fileName: string; fields: DataTable['fields']; previewRows: DataTable['previewRows']; rowCount: number; rows: DataTable['rows'] };
  } | null>(null);
  const [moveTable, setMoveTable] = useState<DataTable | null>(null);
  const [moveTarget, setMoveTarget] = useState('');
  const [rightTab, setRightTab] = useState<'fields' | 'preview'>('fields');
  const [openAddField, setOpenAddField] = useState(false);
  const [newField, setNewField] = useState({
    key: '',
    alias: '',
    type: 'string' as FieldType,
    defaultValue: '',
  });
  const uploadGroupRef = useRef('');
  const uploadRef = useRef<HTMLInputElement>(null);
  const fillRef = useRef<HTMLInputElement>(null);
  const setUploadGroup = (g: string) => {
    uploadGroupRef.current = g;
  };
  const tryDelete = (t: DataTable) => {
    // 若已被规则引用，标注引用来源并由对话框阻止删除；无引用时仍须二次确认
    setOpenDelete({ id: t.id, refs: state.rules.filter((r) => r.tableIds?.includes(t.id)) });
  };

  const buildNew = async (file: File) => {
    const { rows } = await parseTableFile(file);
    if (!rows.length) {
      toast.error('文件内容为空或未解析出数据');
      return null;
    }
    const name = file.name.replace(/\.[^.]+$/, '');
    const { fields, previewRows, rowCount, rows: fullRows } = buildTableFromRows(rows);
    return { name, fileName: file.name, fields, previewRows, rowCount, rows: fullRows as DataTable['rows'] };
  };

  const handleFile = async (file: File, group = '') => {
    try {
      const next = await buildNew(file);
      if (!next) return;
      const table: DataTable = { id: uid('tbl'), createdAt: Date.now(), group, ...next };
      addTable(table);
      toast.success(`已导入「${table.name}」，共 ${table.rowCount} 行`);
    } catch (e) {
      toast.error('数据解析失败，请检查文件格式');
      console.error(e);
    }
  };

  // 手动建列：先创建空表并配置字段列，再通过 handleFill 按列对齐导入数据
  const createBlank = (group = '') => {
    const table: DataTable = {
      id: uid('tbl'),
      createdAt: Date.now(),
      name: '未命名表',
      fileName: '',
      fields: [],
      previewRows: [],
      rowCount: 0,
      group,
    };
    addTable(table);
    setActiveTable(table.id);
    setRightTab('fields');
    setOpenAddField(true);
    toast.info('已创建空表，请先在右侧「添加字段」定义列结构，再上传文件按列导入');
  };

  // 将文件按预先配置的字段列对齐填充到已有的表（仅保留字段中声明的列）
  const handleFill = async (t: DataTable, file: File) => {
    try {
      const { rows } = await parseTableFile(file);
      if (!rows.length) {
        toast.error('文件内容为空或未解析出数据');
        return;
      }
      const known = new Set(t.fields.map((f) => f.key));
      const unknown = Object.keys(rows[0]).filter((k) => !known.has(k));
      const previewRows = rows.slice(0, 50).map((r) => {
        const o: Record<string, string> = {};
        for (const f of t.fields) o[f.key] = String(r[f.key] ?? '');
        return o;
      });
      const fullRows: Record<string, string | number | boolean>[] = rows.map((r) => {
        const o: Record<string, string | number | boolean> = {};
        for (const f of t.fields) {
          const v = r[f.key];
          o[f.key] = typeof v === 'number' && !Number.isNaN(v) ? v : typeof v === 'boolean' ? v : String(v ?? '');
        }
        return o;
      });
      updateTable(t.id, {
        name: file.name.replace(/\.[^.]+$/, ''),
        fileName: file.name,
        previewRows,
        rowCount: rows.length,
        rows: fullRows,
      });
      toast.success(
        `已导入 ${rows.length} 行` +
          (unknown.length ? `；已忽略未配置列：${unknown.slice(0, 5).join('、')}` : '')
      );
    } catch (e) {
      toast.error('数据解析失败，请检查文件格式');
      console.error(e);
    }
  };

  const finger = (t: { rowCount: number; fields: DataTable['fields']; previewRows: DataTable['previewRows'] }) =>
    JSON.stringify({ n: t.rowCount, k: t.fields.map((f) => f.key), p: t.previewRows.slice(0, 50) });

  // 鼠标悬停「更新」：重新上传，做到全覆盖；数据不一致时提示确认
  const handleUpdate = async (t: DataTable, file: File) => {
    try {
      const next = await buildNew(file);
      if (!next) return;
      if (finger(t) === finger(next)) {
        toast.success('新文件与原表数据一致，无需更新');
        return;
      }
      setOpenUpdate({ t, next });
    } catch (e) {
      toast.error('数据解析失败，请检查文件格式');
      console.error(e);
    }
  };

  const applyUpdate = () => {
    if (!openUpdate) return;
    const { t, next } = openUpdate;
    const mergedFields = next.fields.map((f) => {
      const old = t.fields.find((o) => o.key === f.key);
      return old ? { ...f, alias: f.alias || old.alias } : f;
    });
    updateTable(t.id, {
      name: next.name,
      fileName: next.fileName,
      createdAt: Date.now(),
      rowCount: next.rowCount,
      fields: mergedFields,
      previewRows: next.previewRows,
      rows: next.rows,
      prev: { fileName: t.fileName, rowCount: t.rowCount, fields: t.fields, previewRows: t.previewRows, rows: t.rows },
    });
    setOpenUpdate(null);
    toast.success(`已覆盖更新「${t.name}」，如需还原可点击“返回上一步”`);
  };

  const undoUpdate = (t: DataTable) => {
    if (!t.prev) return;
    updateTable(t.id, {
      fileName: t.prev.fileName,
      rowCount: t.prev.rowCount,
      fields: t.prev.fields,
      previewRows: t.prev.previewRows,
      rows: t.prev.rows ?? [],
      prev: undefined,
    });
    toast.success(`已返回上一步，恢复「${t.name}」更新前的数据`);
  };

  const createGroup = () => {
    const name = window.prompt('请输入文件夹（分组）名称');
    const n = String(name ?? '').trim();
    if (!n) return;
    if (state.tableGroups.some((g) => g.name === n)) {
      toast.error(`分组「${n}」已存在`);
      return;
    }
    addTableGroup(n);
    toast.success(`已新建分组「${n}」`);
  };

  const renameGroup = (gname: string) => {
    const g = state.tableGroups.find((x) => x.name === gname);
    if (!g) return;
    const name = window.prompt('重命名分组', gname);
    const n = String(name ?? '').trim();
    if (!n || n === gname) return;
    if (state.tableGroups.some((x) => x.name === n)) {
      toast.error(`分组「${n}」已存在`);
      return;
    }
    updateTableGroup(g.id, n);
    toast.success(`已重命名「${gname}」→「${n}」`);
  };

  const deleteGroup = (gname: string) => {
    const g = state.tableGroups.find((x) => x.name === gname);
    if (!g) return;
    const cnt = state.tables.filter((t) => t.group === gname).length;
    if (cnt > 0) {
      toast.error(`分组「${gname}」下有 ${cnt} 张数据表，请先移出或删除数据后再删除分组`);
      return;
    }
    if (window.confirm(`删除分组「${gname}」？`)) {
      removeTableGroup(g.id);
      toast.success(`已删除分组「${gname}」`);
    }
  };

  const renameTable = (t: DataTable) => {
    const name = window.prompt('重命名数据表', t.name);
    const n = String(name ?? '').trim();
    if (!n || n === t.name) return;
    if (state.tables.some((x) => x.id !== t.id && x.name === n)) {
      toast.error(`数据表「${n}」已存在`);
      return;
    }
    updateTable(t.id, { name: n });
    toast.success(`已重命名「${t.name}」→「${n}」`);
  };

  const openMove = (t: DataTable) => {
    setMoveTable(t);
    setMoveTarget(t.group || '');
  };

  const doMove = () => {
    if (!moveTable) return;
    if (moveTarget !== moveTable.group) {
      updateTable(moveTable.id, { group: moveTarget });
      toast.success(`已将「${moveTable.name}」移动到 ${moveTarget ? `「${moveTarget}」` : '未分组'}`);
    }
    setMoveTable(null);
    setMoveTarget('');
  };

  // 文件夹：每个分组实体一条，未分组的孤儿表（含 group 为空或不属于任何分组）归入「未分组」伪节点
  const groupTree = useMemo(() => {
    const byName = new Map<string, DataTable[]>();
    for (const t of state.tables) byName.set(t.group || '', [...(byName.get(t.group || '') ?? []), t]);
    const folders: { name: string; tables: DataTable[]; isFolder: boolean }[] = state.tableGroups.map((g) => ({ name: g.name, tables: byName.get(g.name) ?? [], isFolder: true }));
    const orphanTables = state.tables.filter((t) => !state.tableGroups.some((g) => g.name === t.group));
    if (orphanTables.length > 0) folders.push({ name: '', tables: orphanTables, isFolder: false });
    return folders;
  }, [state.tables, state.tableGroups]);

  const toggleCollapsed = (name: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  // 更新 diff：逐字段区分 新增/保留/删除，便于用户确认新列加入与旧列移除的影响面
  const fieldDiff = useMemo(() => {
    if (!openUpdate) return { added: [], kept: [], removed: [] };
    const oldMap = new Map(openUpdate.t.fields.map((f) => [f.key, f]));
    const nextSet = new Set(openUpdate.next.fields.map((f) => f.key));
    const added = openUpdate.next.fields.filter((f) => !oldMap.has(f.key));
    const removed = openUpdate.t.fields.filter((f) => !nextSet.has(f.key));
    const kept = openUpdate.next.fields.filter((f) => oldMap.has(f.key)).map((f) => ({ f, old: oldMap.get(f.key)! }));
    return { added, kept, removed };
  }, [openUpdate]);

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
      <div className="grid min-h-0 flex-1 grid-cols-[340px_1fr] gap-6">
        {/* 左：数据表列表 */}
        <section className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white">
          <input
            ref={uploadRef}
            type="file"
            accept=".xlsx,.xls,.xlsm,.csv,.txt"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleFile(f, uploadGroupRef.current);
              e.target.value = '';
            }}
          />
          <input
            ref={fillRef}
            type="file"
            accept=".xlsx,.xls,.xlsm,.csv,.txt"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleFill(active, f);
              e.target.value = '';
            }}
          />
          <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
            <div className="text-sm font-medium text-gray-700">数据表</div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400">{state.tables.length} 张</span>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="flex h-6 w-6 items-center justify-center rounded-md text-gray-400 transition hover:bg-gray-100 hover:text-gray-600" title="上传数据表 / 新建分组">
                    <Plus size={16} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-[160px]">
                  <DropdownMenuItem
                    onSelect={() => {
                      setUploadGroup('');
                      uploadRef.current?.click();
                    }}
                  >
                    <UploadCloud size={14} className="mr-2 text-gray-400" />
                    上传数据表
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => createBlank(uploadGroupRef.current)}>
                    <Table2 size={14} className="mr-2 text-gray-400" />
                    手动建列（先配列再上传）
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={createGroup}>
                    <FolderPlus size={14} className="mr-2 text-gray-400" />
                    新建分组
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {state.tables.length === 0 && state.tableGroups.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-gray-50 text-gray-300">
                  <Table2 size={22} strokeWidth={1.5} />
                </span>
                <p className="text-sm text-gray-400">还没有数据表，点击上方「＋」上传或新建分组</p>
              </div>
            ) : (
              <div className="space-y-1">
                {groupTree.map((node) => {
                  const isOpen = !collapsed.has(node.name);
                  return (
                    <div key={node.name === '' ? '__uncat' : node.name}>
                      {/* 分组 / 未分组 节点行 */}
                      <div className="group flex items-center gap-1 rounded-lg py-1.5 pr-1 hover:bg-gray-50">
                        <button
                          onClick={() => toggleCollapsed(node.name)}
                          className="rounded p-0.5 text-gray-400 transition hover:text-gray-600"
                          title={node.tables.length ? '展开 / 折叠' : undefined}
                        >
                          <ChevronRight size={14} className={`transition-transform ${isOpen || !node.tables.length ? 'rotate-90' : ''}`} />
                        </button>
                        {node.isFolder ? (
                          <FolderOpen size={15} className="text-amber-400" strokeWidth={1.8} />
                        ) : (
                          <Inbox size={15} className="text-gray-300" strokeWidth={1.8} />
                        )}
                        <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-700">{node.isFolder ? node.name : '未分组'}</span>
                        <span className="shrink-0 px-0.5 text-xs text-gray-400">{node.tables.length}</span>
                        {/* ＋：上传到当前 / 新建分组 */}
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button
                              onClick={(e) => e.stopPropagation()}
                              className="rounded-md p-1 text-gray-300 opacity-0 transition hover:bg-gray-100 hover:text-gray-600 group-hover:opacity-100"
                              title={node.isFolder ? `上传到「${node.name}」/ 新建分组` : '上传到未分组 / 新建分组'}
                            >
                              <Plus size={14} />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="min-w-[160px]">
                            <DropdownMenuItem
                              onSelect={() => {
                                setUploadGroup(node.isFolder ? node.name : '');
                                uploadRef.current?.click();
                              }}
                            >
                              <UploadCloud size={14} className="mr-2 text-gray-400" />
                              上传数据表{node.isFolder ? `到「${node.name}」` : ''}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onSelect={createGroup}>
                              <FolderPlus size={14} className="mr-2 text-gray-400" />
                              新建分组
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                        {/* ⋮：重命名 / 删除 */}
                        {node.isFolder && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button
                                onClick={(e) => e.stopPropagation()}
                                className="rounded-md p-1 text-gray-300 opacity-0 transition hover:bg-gray-100 hover:text-gray-600 group-hover:opacity-100"
                                title="分组操作"
                              >
                                <MoreVertical size={14} />
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="min-w-[140px]">
                              <DropdownMenuItem onSelect={() => renameGroup(node.name)}>
                                <Pencil size={14} className="mr-2 text-gray-400" />
                                重命名
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onSelect={() => deleteGroup(node.name)}
                                disabled={node.tables.length > 0}
                                className={node.tables.length ? 'text-red-300 focus:text-red-300' : 'text-red-500 focus:text-red-600'}
                              >
                                <Trash2 size={14} className="mr-2" />
                                {node.tables.length ? `删除（组内 ${node.tables.length} 张需先移出）` : '删除'}
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </div>
                      {/* 分组下数据表列表 */}
                      {node.isFolder && !isOpen ? null : (
                        <div className="ml-4 space-y-1.5 pb-1.5 pt-0.5">
                          {node.tables.length === 0 ? (
                            <p className="px-2 py-1 text-xs text-gray-300">空分组</p>
                          ) : (
                            node.tables.map((t) => (
                              <div
                                key={t.id}
                                onClick={() => setActiveTable(t.id)}
                                className={`group flex cursor-pointer items-center justify-between rounded-xl border px-3 py-2 transition ${
                                  t.id === activeId
                                    ? 'border-gray-300 bg-gray-50 shadow-sm'
                                    : 'border-transparent hover:border-gray-200 hover:bg-gray-50/50'
                                }`}
                              >
                                <div className="flex min-w-0 items-center gap-2.5">
                                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-gray-100 text-gray-500">
                                    <Table2 size={14} strokeWidth={1.7} />
                                  </span>
                                  <div className="min-w-0">
                                    <div className="truncate text-sm font-medium text-gray-800">{t.name}</div>
                                    <div className="mt-0.5 text-xs text-gray-400">
                                      {t.rowCount.toLocaleString()} 行 · {t.fields.length} 字段
                                    </div>
                                  </div>
                                </div>
                                <div className="flex shrink-0 items-center gap-0.5">
                                  <div className="flex items-center gap-0.5 opacity-0 transition group-hover:opacity-100">
                                    {t.prev && (
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          undoUpdate(t);
                                        }}
                                        className="rounded-md p-1 text-gray-400 transition hover:bg-amber-50 hover:text-amber-600"
                                        title="返回上一步"
                                      >
                                        <Undo2 size={14} />
                                      </button>
                                    )}
                                    <label
                                      onClick={(e) => e.stopPropagation()}
                                      className="cursor-pointer rounded-md p-1 text-gray-400 transition hover:bg-violet-50 hover:text-violet-600"
                                      title="更新数据表（重新上传覆盖）"
                                    >
                                      <RefreshCw size={14} />
                                      <input
                                        type="file"
                                        accept=".xlsx,.xls,.xlsm,.csv,.txt"
                                        className="hidden"
                                        onChange={(e) => {
                                          const f = e.target.files?.[0];
                                          if (f) void handleUpdate(t, f);
                                          e.target.value = '';
                                        }}
                                      />
                                    </label>
                                  </div>
                                  <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                      <button
                                        onClick={(e) => e.stopPropagation()}
                                        className="rounded-md p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600"
                                        title="数据表操作"
                                      >
                                        <MoreVertical size={14} />
                                      </button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end" className="min-w-[140px]">
                                      <DropdownMenuItem onSelect={() => renameTable(t)}>
                                        <Pencil size={14} className="mr-2 text-gray-400" />
                                        重命名
                                      </DropdownMenuItem>
                                      <DropdownMenuItem onSelect={() => openMove(t)}>
                                        <FolderInput size={14} className="mr-2 text-gray-400" />
                                        移动到…
                                      </DropdownMenuItem>
                                      <DropdownMenuSeparator />
                                      {can('delete', t.id) && (
                                        <DropdownMenuItem onSelect={() => tryDelete(t)} className="text-red-500 focus:text-red-600">
                                          <Trash2 size={14} className="mr-2" />
                                          删除
                                        </DropdownMenuItem>
                                      )}
                                    </DropdownMenuContent>
                                  </DropdownMenu>
                                </div>
                              </div>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
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
                  <div className="mt-2 flex items-center gap-2">
                    <span className="inline-flex items-center gap-1 rounded-md bg-amber-50/60 px-2 py-1 text-xs text-amber-700">
                      <Folder size={12} strokeWidth={1.8} />
                      {active.group || '未分组'}
                    </span>
                    {active.prev && (
                      <button
                        onClick={() => undoUpdate(active)}
                        className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-1 text-xs font-medium text-amber-600 transition hover:bg-amber-100"
                        title="返回上一步，恢复更新前的数据"
                      >
                        <Undo2 size={13} /> 返回上一步
                      </button>
                    )}
                  </div>
                  <p className="mt-1.5 text-xs text-gray-400">共 {active.fields.length} 个字段 · 点击「标签值 / 类型」可标签化并用于规则配置</p>
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-gray-400">
                    <tr className="border-b border-gray-100">
                      <th className="w-12 px-2 py-2.5 text-center font-medium">显示</th>
                      <th className="px-4 py-2.5 font-medium">字段（列名）</th>
                      <th className="px-4 py-2.5 font-medium">标签值</th>
                      <th className="px-4 py-2.5 font-medium">类型</th>
                      <th className="px-4 py-2.5 font-medium">样例</th>
                      <th className="px-4 py-2.5 text-right font-medium">
                        <div className="flex items-center justify-end gap-1.5">
                          {active.rowCount === 0 && !active.fileName && (
                            <button
                              onClick={() => fillRef.current?.click()}
                              className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-600 transition hover:bg-gray-100"
                              title="按已配置列对齐导入文件数据"
                            >
                              <UploadCloud size={13} /> 导入数据
                            </button>
                          )}
                          <button
                            onClick={() => setOpenAddField(true)}
                            className="inline-flex items-center gap-1 rounded-md bg-gray-900 px-2.5 py-1 text-xs font-medium text-white transition hover:bg-gray-700"
                          >
                            <Plus size={13} /> 添加字段
                          </button>
                        </div>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {active.fields.map((f, fi) => (
                      <tr
                        key={f.key}
                        className={`group/border border-b border-gray-50 hover:bg-gray-50/40 ${f.hidden ? 'opacity-45' : ''}`}
                      >
                        <td className="px-2 py-2.5 text-center">
                          <label className="inline-flex cursor-pointer items-center">
                            <input
                              type="checkbox"
                              checked={!f.hidden}
                              onChange={() => toggleFieldVisible(active.id, f.key)}
                              className="h-4 w-4 cursor-pointer rounded border-gray-300 accent-gray-900"
                            />
                          </label>
                        </td>
                        <td className="px-4 py-2.5">
                          <span className="inline-flex items-center gap-2 rounded-md px-2 py-1 text-xs text-gray-700">
                            <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: f.tagColor }} />
                            <span className="font-mono">{f.key}</span>
                            {f.locked && (
                              <span className="inline-flex items-center gap-0.5 text-[10px] text-gray-400">
                                <Lock size={11} />
                              </span>
                            )}
                          </span>
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-1.5">
                            <Tags size={13} className="shrink-0 text-gray-300" />
                            <input
                              value={f.alias}
                              disabled={f.locked}
                              onChange={(e) => renameField(active.id, f.key, e.target.value)}
                              className="w-40 rounded-md border border-transparent px-2 py-1 text-sm text-gray-800 placeholder:text-gray-300 focus:border-gray-300 focus:outline-none focus:ring-1 focus:ring-gray-200 disabled:bg-transparent disabled:text-gray-500"
                              placeholder="点击输入标签"
                              title={f.locked ? '字段已锁定，不可修改' : undefined}
                            />
                          </div>
                        </td>
                        <td className="px-4 py-2.5">
                          <select
                            value={f.type}
                            disabled={f.locked}
                            onChange={(e) => setFieldType(active.id, f.key, e.target.value as FieldType)}
                            className="rounded-md border border-gray-200 bg-white px-2 py-1 text-xs text-gray-600 outline-none hover:border-gray-300 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {(['string', 'number', 'date', 'boolean'] as FieldType[]).map((t) => (
                              <option key={t} value={t}>
                                {TYPE_LABEL[t]}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="max-w-[180px] truncate px-4 py-2.5 text-xs text-gray-400">{f.sample || '—'}</td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center justify-end gap-0.5">
                            <button
                              onClick={() => moveField(active.id, f.key, 'up')}
                              disabled={fi === 0}
                              className="rounded-md p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-30"
                              title="上移"
                            >
                              <ArrowUp size={14} />
                            </button>
                            <button
                              onClick={() => moveField(active.id, f.key, 'down')}
                              disabled={fi === active.fields.length - 1}
                              className="rounded-md p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-30"
                              title="下移"
                            >
                              <ArrowDown size={14} />
                            </button>
                            <button
                              onClick={() => toggleFieldLock(active.id, f.key)}
                              className={`ml-1 rounded-md p-1 transition hover:bg-gray-100 ${
                                f.locked ? 'text-amber-500' : 'text-gray-400 hover:text-gray-700'
                              }`}
                              title={f.locked ? '解锁字段' : '锁定字段（锁定后不可改标签/类型）'}
                            >
                              {f.locked ? <Lock size={14} /> : <Unlock size={14} />}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {active.fields.length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-4 py-10 text-center text-sm text-gray-400">
                          该表未解析出字段
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {rightTab === 'preview' && (
                <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
                  <div className="border-t border-gray-100 bg-gray-50/60 px-6 py-4">
                    <div className="mb-2 text-xs font-medium text-gray-500">数据预览 · 前 {active.previewRows.length} 行</div>
                    <div className="overflow-auto rounded-xl border border-gray-150 bg-white">
                      <table className="w-full text-xs">
                        <thead className="bg-gray-50 text-left text-gray-500">
                          <tr>
                            {active.fields.filter((f) => !f.hidden).map((f) => (
                              <th key={f.key} className="whitespace-nowrap px-3 py-2 font-medium">
                                {f.alias || f.key}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {active.previewRows.map((r, i) => (
                            <tr key={i} className="border-t border-gray-50">
                              {active.fields.filter((f) => !f.hidden).map((f) => (
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
                </div>
              )}
            </>
          )}
        </section>
      </div>

      <AlertDialog open={openAddField} onOpenChange={(v) => !v && setOpenAddField(false)}>
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>添加字段</AlertDialogTitle>
            <AlertDialogDescription>
              手动添加字段可保证数据表列结构正确，上传文件时将按此列对齐，避免导入错乱。字段锁定后可防止误改。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="grid gap-3 py-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">字段名（列名 key）</label>
              <Input
                value={newField.key}
                onChange={(e) => setNewField({ ...newField, key: e.target.value })}
                placeholder="例如 style_no"
                className="font-mono"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500">标签（别名）</label>
                <Input
                  value={newField.alias}
                  onChange={(e) => setNewField({ ...newField, alias: e.target.value })}
                  placeholder="例如 款号"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500">类型</label>
                <select
                  value={newField.type}
                  onChange={(e) => setNewField({ ...newField, type: e.target.value as FieldType })}
                  className="w-full rounded-md border border-gray-200 bg-white px-2 py-1.5 text-sm text-gray-700 outline-none focus:border-gray-300"
                >
                  {(['string', 'number', 'date', 'boolean'] as FieldType[]).map((t) => (
                    <option key={t} value={t}>
                      {TYPE_LABEL[t]}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">默认值（可选，用于回填已存在行）</label>
              <Input
                value={newField.defaultValue}
                onChange={(e) => setNewField({ ...newField, defaultValue: e.target.value })}
                placeholder="留空则不回填"
              />
            </div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setOpenAddField(false)}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={!newField.key.trim() || !!active?.fields.some((f) => f.key === newField.key.trim())}
              onClick={() => {
                if (!active) return;
                addField(active.id, {
                  key: newField.key.trim(),
                  alias: newField.alias.trim(),
                  type: newField.type,
                  defaultValue: newField.defaultValue,
                });
                toast.success(`已添加字段「${newField.key.trim()}」`);
                setNewField({ key: '', alias: '', type: 'string', defaultValue: '' });
                setOpenAddField(false);
                setRightTab('fields');
              }}
            >
              添加字段
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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

      <AlertDialog open={!!openUpdate} onOpenChange={(v) => !v && setOpenUpdate(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>更新数据表「{openUpdate?.t.name}」</AlertDialogTitle>
            <AlertDialogDescription>
              新文件与当前表内容不一致，更新将覆盖全部数据：
              <div className="mt-3 overflow-hidden rounded-xl border border-gray-150">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 text-left text-gray-500">
                    <tr>
                      <th className="px-3 py-2 font-medium">项目</th>
                      <th className="px-3 py-2 font-medium">当前</th>
                      <th className="px-3 py-2 font-medium">新文件</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-t border-gray-100">
                      <td className="px-3 py-2 text-gray-500">文件名</td>
                      <td className="px-3 py-2 text-gray-700">{openUpdate?.t.fileName}</td>
                      <td className="px-3 py-2 text-gray-700">{openUpdate?.next.fileName}</td>
                    </tr>
                    <tr className="border-t border-gray-100">
                      <td className="px-3 py-2 text-gray-500">行数</td>
                      <td className="px-3 py-2 text-gray-700">{openUpdate?.t.rowCount.toLocaleString()}</td>
                      <td className="px-3 py-2 text-gray-700">{openUpdate?.next.rowCount.toLocaleString()}</td>
                    </tr>
                    <tr className="border-t border-gray-100">
                      <td className="px-3 py-2 text-gray-500">首行样例</td>
                      <td className="px-3 py-2 text-gray-500">{Object.values(openUpdate?.t.previewRows[0] ?? {}).slice(0, 5).join(' · ') || '—'}</td>
                      <td className="px-3 py-2 text-gray-500">{Object.values(openUpdate?.next.previewRows[0] ?? {}).slice(0, 5).join(' · ') || '—'}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="mt-4 overflow-hidden rounded-xl border border-gray-150">
                <div className="flex items-center gap-3 border-b border-gray-100 bg-gray-50 px-3 py-2 text-xs font-medium text-gray-500">
                  字段对比
                  <span className="text-emerald-600">新增 +{fieldDiff.added.length}</span>
                  <span className="text-gray-400">保留 {fieldDiff.kept.length}</span>
                  <span className="text-red-500">删除 -{fieldDiff.removed.length}</span>
                </div>
                {fieldDiff.added.length + fieldDiff.removed.length + fieldDiff.kept.length === 0 ? (
                  <div className="px-3 py-6 text-center text-xs text-gray-400">无字段变化</div>
                ) : (
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50 text-left text-gray-500">
                      <tr>
                        <th className="px-3 py-2 font-medium">变化</th>
                        <th className="px-3 py-2 font-medium">字段</th>
                        <th className="px-3 py-2 font-medium">说明</th>
                      </tr>
                    </thead>
                    <tbody>
                      {fieldDiff.added.map((f) => (
                        <tr key={f.key} className="border-t border-gray-100">
                          <td className="px-3 py-2">
                            <span className="inline-flex rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-600">新增</span>
                          </td>
                          <td className="px-3 py-2 font-mono text-gray-700">{f.key}</td>
                          <td className="px-3 py-2 text-gray-500">类型自动推断为「{TYPE_LABEL[f.type]}」，标签默认等于列名，可到右侧详情修改后用于规则配置</td>
                        </tr>
                      ))}
                      {fieldDiff.kept.map(({ f, old }) => (
                        <tr key={f.key} className="border-t border-gray-100">
                          <td className="px-3 py-2">
                            <span className="inline-flex rounded bg-gray-100 px-1.5 py-0.5 text-gray-500">保留</span>
                          </td>
                          <td className="px-3 py-2 font-mono text-gray-700">{f.key}</td>
                          <td className="px-3 py-2 text-gray-500">
                            {old.alias && old.alias !== f.key
                              ? `沿用已配置标签「${old.alias}」与类型「${TYPE_LABEL[old.type]}」`
                              : `沿用已配置类型「${TYPE_LABEL[old.type]}」`}
                          </td>
                        </tr>
                      ))}
                      {fieldDiff.removed.map((f) => (
                        <tr key={f.key} className="border-t border-gray-100">
                          <td className="px-3 py-2">
                            <span className="inline-flex rounded bg-red-50 px-1.5 py-0.5 text-red-500">删除</span>
                          </td>
                          <td className="px-3 py-2 font-mono text-gray-700">{f.key}</td>
                          <td className="px-3 py-2 text-gray-500">更新后将从字段列表移除；若该列已被预警规则引用（判断字段或通知模板），请同步调整相关规则</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
              <span className="mt-3 block text-gray-500">确认后覆盖更新，可通过“返回上一步”还原；新增列需在右侧详情设置标签值/类型后才能用于规则配置。</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setOpenUpdate(null)}>取消</AlertDialogCancel>
            <AlertDialogAction className="bg-violet-600 text-white hover:bg-violet-700" onClick={applyUpdate}>
              确认更新
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!moveTable} onOpenChange={(v) => !v && setMoveTable(null)}>
        <AlertDialogContent className="sm:max-w-[380px]">
          <AlertDialogHeader>
            <AlertDialogTitle>移动「{moveTable?.name}」</AlertDialogTitle>
            <AlertDialogDescription>选择要将该数据表移动到哪个文件夹：</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="grid gap-2">
            <label className="text-sm font-medium text-gray-700">目标文件夹</label>
            <select
              value={moveTarget}
              onChange={(e) => setMoveTarget(e.target.value)}
              className="h-9 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-700 outline-none focus:border-violet-300"
            >
              <option value="">未分组</option>
              {state.tableGroups.map((g) => (
                <option key={g.id} value={g.name}>
                  {g.name}
                </option>
              ))}
            </select>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setMoveTable(null)}>取消</AlertDialogCancel>
            <AlertDialogAction className="bg-violet-600 text-white hover:bg-violet-700" onClick={doMove}>
              移动
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}