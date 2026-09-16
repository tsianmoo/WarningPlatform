'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api';
import SqlEditor from './SqlEditor';
import { Field, Modal, Badge, btnPrimary, btnGhost, inputCls, Empty, useToast, usePerm } from './ui';
import type { DataSource, SyncDataset } from '@/lib/sync/types';

export default function DatasetManager({ datasources }: { datasources: DataSource[] }) {
  const { toast, ToastView } = useToast();
  const can = usePerm();
  const [items, setItems] = useState<SyncDataset[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Partial<SyncDataset> | null>(null);
  const [isEdit, setIsEdit] = useState(false);
  // 预览状态
  const [prevMeta, setPrevMeta] = useState<any[] | null>(null);
  const [prevRows, setPrevRows] = useState<any[] | null>(null);
  const [prevEst, setPrevEst] = useState<number | null>(null);
  const [prevTrunc, setPrevTrunc] = useState(false);
  const [prevHints, setPrevHints] = useState<string[]>([]);
  const [prevLoading, setPrevLoading] = useState(false);
  const [validateResult, setValidateResult] = useState<{ ok: boolean; error?: string; params?: string[]; hints?: string[] } | null>(null);
  const [metaCache, setMetaCache] = useState<Record<string, { schemas: any[]; cachePayload?: any }>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.listDatasets();
      setItems(r.items || []);
    } catch (e: any) {
      toast(e.message, 'err');
    } finally {
      setLoading(false);
    }
  }, [toast]);
  useEffect(() => { load(); }, [load]);

  const openCreate = () => {
    setEditing({ key: '', name: '', datasourceId: datasources[0]?.id || '', sql: 'SELECT\n  *\nFROM\n  -- 表和字段可自动补全\n  your_table', previewLimit: 1000, queryTimeoutSec: 30, group: '默认' });
    setIsEdit(false); setPrevMeta(null); setPrevRows(null); setValidateResult(null); setOpen(true);
  };
  const openEdit = (d: SyncDataset) => {
    setEditing({ ...d });
    setIsEdit(true); setPrevMeta(d.fields?.length ? d.fields : null); setPrevRows(null); setValidateResult(null); setOpen(true);
  };
  const set = (k: string, v: any) => setEditing((e) => ({ ...e, [k]: v }));

  const autocompleteMeta = useMemo(() => {
    const dsId = editing?.datasourceId;
    const cache = dsId ? metaCache[dsId] : null;
    const schemaNames: string[] = [];
    const tableNames: string[] = [];
    const columnNames: string[] = [];
    if (cache?.schemas) {
      for (const s of cache.schemas) {
        schemaNames.push(s.name);
        if (s.tables) { for (const t of s.tables) { tableNames.push(t.name); if (t.columns) for (const c of t.columns) columnNames.push(c.name); } }
      }
    }
    return { schemaNames, tableNames, columnNames };
  }, [metaCache, editing?.datasourceId]);

  const doValidate = async () => {
    if (!editing?.sql) return;
    const r = await api.validateSql(editing.sql);
    setValidateResult(r);
  };

  const doPreview = async () => {
    if (!editing?.datasourceId || !editing?.sql) { toast('请先选择数据源并编写 SQL', 'err'); return; }
    setPrevLoading(true); setPrevMeta(null);
    try {
      const dsId = editing.datasourceId;
      const r = await api.previewDataset('dummy', {}, 1000).catch(() => null); // noop keep
      void r;
      // 保存数据集后再预览，或直接按保存的旧数据集预览
      if (editing.id) {
        const res = await api.previewDataset(editing.id, {}, editing.previewLimit || 1000);
        setPrevMeta(res.metaData); setPrevRows(res.rows);
        setPrevEst(res.estimatedCount); setPrevTrunc(res.truncated); setPrevHints(res.hints || []);
      } else {
        toast('请先保存数据集，再预览', 'err');
      }
    } catch (e: any) {
      toast(e.message, 'err');
    } finally {
      setPrevLoading(false);
    }
  };

  // 编辑器可预览需已保存
  const editorSql = editing?.sql || '';
  const save = async () => {
    if (!editing) return;
    try {
      if (isEdit) { await api.updateDataset(editing.id!, editing); toast('数据集已更新'); }
      else { await api.createDataset(editing); toast('数据集已创建'); }
      setOpen(false); load();
    } catch (e: any) { toast(e.message, 'err'); }
  };
  const remove = async (d: SyncDataset) => {
    if (!confirm(`删除数据集「${d.name}」？`)) return;
    try { await api.deleteDataset(d.id); toast('已删除'); load(); }
    catch (e: any) { toast(e.message, 'err'); }
  };

  const exportCsv = () => {
    if (!prevMeta || !prevRows) return;
    const cols = prevMeta.map((m) => m.name);
    const lines = [cols.join(',')];
    for (const row of prevRows.slice(0, 100000)) {
      lines.push(cols.map((c) => { const v = row[c]; const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(','));
    }
    const blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${editing?.key || 'dataset'}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <div className="text-base font-semibold text-gray-800">数据集管理</div>
          <div className="text-xs text-gray-400">用 SQL 定义数据视图，支持参数、校验与预览</div>
        </div>
        <button className={btnPrimary} disabled={!can('create')} onClick={openCreate}>＋ 新建数据集</button>
      </div>
      <div className="flex-1 overflow-auto rounded-lg border border-gray-200 bg-white">
        {loading && <div className="p-6 text-sm text-gray-400">加载中…</div>}
        {!loading && items.length === 0 && <Empty text="暂无数据集" />}
        {!loading && items.length > 0 && (
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-gray-50 text-left text-xs text-gray-500">
              <tr><th className="px-3 py-2">编码</th><th className="px-3 py-2">名称</th><th className="px-3 py-2">数据源</th><th className="px-3 py-2">参数</th><th className="px-3 py-2">分组</th><th className="px-3 py-2 text-right">操作</th></tr>
            </thead>
            <tbody>
              {items.map((d) => {
                const src = datasources.find((s) => s.id === d.datasourceId);
                return (
                  <tr key={d.id} className="border-t border-gray-100 hover:bg-gray-50">
                    <td className="px-3 py-2 font-medium text-gray-800">{d.key}</td>
                    <td className="px-3 py-2 text-gray-600">{d.name}</td>
                    <td className="px-3 py-2 text-gray-400">{src?.label || d.datasourceId.slice(0, 8)}</td>
                    <td className="px-3 py-2">
                      {(d.params || []).map((p: string) => (
                        <span key={p} className="mr-1 inline-flex items-center rounded bg-blue-100 px-1.5 py-0.5 text-xs text-blue-700">{`${'{' + p + '}'}`}</span>
                      ))}
                      {(d.params || []).length === 0 && <span className="text-xs text-gray-300">无</span>}
                    </td>
                    <td className="px-3 py-2 text-gray-400">{d.group}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <button className="mr-1 text-xs text-gray-600 hover:underline disabled:opacity-40" disabled={!can('edit')} onClick={() => openEdit(d)}>编辑</button>
                      <button className="text-xs text-red-500 hover:underline disabled:opacity-40" disabled={!can('delete')} onClick={() => remove(d)}>删除</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <Modal title={isEdit ? '编辑数据集' : '新建数据集'} open={open} onClose={() => setOpen(false)} wide>
        {editing && (
          <div className="space-y-3">
            <div className="grid grid-cols-4 gap-3">
              <Field label="编码"><input className={inputCls} value={editing.key} onChange={(e) => set('key', e.target.value)} placeholder="dwd_order" /></Field>
              <Field label="名称"><input className={inputCls} value={editing.name} onChange={(e) => set('name', e.target.value)} /></Field>
              <Field label="数据源">
                <select className={inputCls} value={editing.datasourceId} onChange={(e) => { set('datasourceId', e.target.value); doLoadMeta(e.target.value); }}>
                  <option value="">选择数据源</option>
                  {datasources.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
              </Field>
              <Field label="分组"><input className={inputCls} value={editing.group} onChange={(e) => set('group', e.target.value)} /></Field>
            </div>
            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs font-medium text-gray-600">SQL（Ctrl/Cmd+Enter 预览）</span>
                <div className="flex gap-2">
                  <button className={btnGhost} onClick={doValidate}>校验</button>
                  <button className={btnPrimary} onClick={doPreview} disabled={prevLoading}>{prevLoading ? '预览中…' : '预览'}</button>
                </div>
              </div>
              <SqlEditor
                value={editorSql}
                onChange={(v) => set('sql', v)}
                schemaNames={autocompleteMeta.schemaNames}
                tableNames={autocompleteMeta.tableNames}
                columnNames={autocompleteMeta.columnNames}
                onPreview={doPreview}
                height="220px"
              />
              {validateResult && (
                <div className={`mt-1 rounded p-1.5 text-xs ${validateResult.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
                  {validateResult.ok ? '✓ 仅含只读 SELECT/WITH，通过安全校验' : `✗ ${validateResult.error}`}
                  {(validateResult.hints || []).map((h) => <div key={h} className="text-yellow-600">⚠ {h}</div>)}
                  {(validateResult.params || []).length > 0 && <div className="text-blue-600">参数：{(validateResult.params || []).join(', ')}</div>}
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="预览行数上限"><input type="number" className={inputCls} value={editing.previewLimit} onChange={(e) => set('previewLimit', Number(e.target.value))} /></Field>
              <Field label="查询超时(s)"><input type="number" className={inputCls} value={editing.queryTimeoutSec} onChange={(e) => set('queryTimeoutSec', Number(e.target.value))} /></Field>
            </div>

            {prevMeta && (
              <div className="rounded border border-gray-200">
                <div className="flex items-center justify-between border-b border-gray-100 bg-gray-50 px-3 py-1.5 text-xs text-gray-500">
                  <span>预览 {prevEst ? `（估算 ${prevEst >= 10000 ? (prevEst / 10000).toFixed(0) + ' 万+行' : prevEst + ' 行'}）` : ''} · 字段 {prevMeta.length}</span>
                  <div className="flex items-center gap-2">
                    {prevHints.map((h) => <span key={h} className="text-yellow-600">⚠ {h}</span>)}
                    {prevTrunc && <Badge color="yellow">仅预览前 {editing.previewLimit || 1000} 行</Badge>}
                    <button className="text-blue-600 hover:underline" onClick={exportCsv}>导出 CSV</button>
                  </div>
                </div>
                <div className="overflow-auto">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-gray-200 text-left text-gray-600">
                      <tr>{prevMeta.map((m) => <th key={m.name} className="whitespace-nowrap border-b border-gray-200 px-2 py-1">{m.name} <span className="font-normal text-gray-400">{m.jdbcType}</span></th>)}</tr>
                    </thead>
                    <tbody>
                      {(prevRows || []).slice(0, 50).map((row, i) => (
                        <tr key={i} className="border-b border-gray-100 hover:bg-blue-50">
                          {prevMeta.map((m) => {
                            const v = row[m.name];
                            return <td key={m.name} className="whitespace-nowrap px-2 py-0.5 text-gray-700">{v == null ? <span className="text-orange-500">NULL</span> : String(v)}</td>;
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {(prevRows || []).length === 0 && <div className="p-4 text-xs text-gray-400">预览无数据（或尚未保存/运行）</div>}
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <button className={btnGhost} onClick={() => setOpen(false)}>取消</button>
              <button className={btnPrimary} disabled={!can('create') && !can('edit')} onClick={save}>保存</button>
            </div>
          </div>
        )}
      </Modal>
      {ToastView}
    </div>
  );

  // 兼容顶层调用：避免 hoisting 问题
  async function doLoadMeta(dsId: string) {
    if (!dsId || metaCache[dsId]) return;
    try {
      const r = await api.browseMeta(dsId);
      setMetaCache((c) => ({ ...c, [dsId]: { schemas: r.schemas || [], cachePayload: r.cachePayload } }));
      if (r.cachePayload) setMetaCache((c) => ({ ...c, [dsId]: { schemas: r.cachePayload.schemas || r.schemas || [] } }));
    } catch {}
  }
}