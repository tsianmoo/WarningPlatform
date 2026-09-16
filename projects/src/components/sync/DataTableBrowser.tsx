'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from './api';
import { btnGhost, btnPrimary, inputCls } from './ui';

type TableEl = { name: string; comment?: string };
type SchemaEl = { name: string; tables: TableEl[] };
type SourceRow = { id: string; label: string; type: string; host?: string; health?: string };

type Sel = { srcId: string; srcLabel: string; schema: string; table: string } | null;

export default function DataTableBrowser({ onOpenPlatform }: { onOpenPlatform?: () => void }) {
  const [sources, setSources] = useState<SourceRow[]>([]);
  const [schemas, setSchemas] = useState<Record<string, SchemaEl[]>>({});
  const [loadingSource, setLoadingSource] = useState<boolean>(false);
  const [keyword, setKeyword] = useState('');
  const [sel, setSel] = useState<Sel>(null);

  // 右栏：表内容预览
  const [cols, setCols] = useState<any[]>([]);
  const [rows, setRows] = useState<any[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [loadingRows, setLoadingRows] = useState(false);
  const [rowErr, setRowErr] = useState('');

  const loadSources = useCallback(async () => {
    setLoadingSource(true);
    try {
      const r = await api.listDatasources();
      setSources(r.items || []);
    } catch {
      setSources([]);
    } finally {
      setLoadingSource(false);
    }
  }, []);

  useEffect(() => { loadSources(); }, [loadSources]);

  const browseSource = useCallback(async (id: string) => {
    if (schemas[id]?.length) return; // 已缓存
    try {
      const r = await api.browseMeta(id);
      const s = r.schemas || [];
      setSchemas((m) => ({ ...m, [id]: s }));
    } catch {
      setSchemas((m) => ({ ...m, [id]: [] }));
    }
  }, [schemas]);

  const openTable = useCallback(async (src: SourceRow, schema: string, table: string) => {
    setSel({ srcId: src.id, srcLabel: src.label, schema, table });
    setLoadingRows(true); setRowErr('');
    try {
      const r = await api.previewTable(src.id, schema, table, 1000);
      setCols(r.columns || []); setRows(r.rows || []); setTruncated(!!r.truncated);
    } catch (e: any) {
      setRows([]); setCols([]); setTruncated(false);
      setRowErr(typeof e === 'string' ? e : (e?.message || '预览失败'));
    } finally {
      setLoadingRows(false);
    }
  }, []);

  const flatList = useMemo(() => {
    const list: { src: SourceRow; schema: string; table: TableEl }[] = [];
    const kw = keyword.trim().toLowerCase();
    for (const s of sources) {
      for (const sc of schemas[s.id] || []) {
        for (const t of sc.tables) {
          const name = `${sc.name}.${t.name}`.toLowerCase();
          if (!kw || name.includes(kw) || s.label.toLowerCase().includes(kw)) {
            list.push({ src: s, schema: sc.name, table: t });
          }
        }
      }
    }
    return list;
  }, [sources, schemas, keyword]);

  const exportCsv = () => {
    if (!cols.length) return;
    const esc = (v: any) => {
      const s = v === null || v === undefined ? '' : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const head = cols.map((c) => esc(c.name)).join(',');
    const body = rows.slice(0, 50000).map((r) => cols.map((c) => esc(r[c.name])).join(',')).join('\n');
    const blob = new Blob([`\ufeff${head}\n${body}`], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${sel?.table || 'table'}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="flex h-full flex-col">
      {/* 头部 */}
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-base font-semibold text-gray-800">API 数据表</div>
          <div className="text-xs text-gray-400">浏览已接入数据源下的表，点击左侧表名在右侧查看内容（仅预览前 1000 行）</div>
        </div>
        <div className="flex items-center gap-2">
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索表名 / 数据源…"
            className={`${inputCls} w-44 md:w-56`}
          />
          <button className={btnGhost} onClick={() => loadSources()}>刷新数据源</button>
          {onOpenPlatform && (
            <button className={btnPrimary} onClick={onOpenPlatform}>数据同步平台</button>
          )}
        </div>
      </div>

      {/* 左右两栏 */}
      <div className="flex min-h-0 flex-1 gap-3">
        {/* 左：数据表列表 */}
        <aside className="flex w-72 shrink-0 flex-col overflow-hidden rounded-lg border border-gray-200 bg-white">
          <div className="border-b border-gray-100 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
            数据表列表
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            {loadingSource && sources.length === 0 && (
              <div className="p-4 text-sm text-gray-400">加载数据源…</div>
            )}
            {!loadingSource && sources.length === 0 && (
              <div className="p-4 text-sm text-gray-500">
                尚未配置数据源。
                <div className="mt-2">
                  <button className="text-blue-600 underline" onClick={onOpenPlatform}>
                    前往数据同步平台新建数据源
                  </button>
                </div>
              </div>
            )}
            {sources.map((s) => (
              <div key={s.id} className="border-b border-gray-50">
                <button
                  className="flex w-full items-center justify-between px-3 py-2 text-sm hover:bg-gray-50"
                  onClick={() => browseSource(s.id)}
                  title={s.host}
                >
                  <span className={`flex items-center gap-1.5 font-medium ${s.health === 'error' ? 'text-red-600' : 'text-gray-700'}`}>
                    <span className="text-gray-400">{schemas[s.id]?.length ? '▾' : '▸'}</span>{s.label}
                  </span>
                  <span className="rounded bg-gray-100 px-1.5 text-xs text-gray-500">{s.type}</span>
                </button>
                {(schemas[s.id] || []).map((sc: SchemaEl) => (
                  <div key={sc.name}>
                    <div className="flex items-center gap-1 px-4 py-1 text-xs font-medium text-gray-400">
                      <span>🗄</span>{sc.name}
                    </div>
                    {sc.tables.filter((t) => {
                      const k = keyword.trim().toLowerCase();
                      return !k || t.name.toLowerCase().includes(k) || s.label.toLowerCase().includes(k);
                    }).map((t: TableEl) => {
                      const active = sel?.srcId === s.id && sel?.schema === sc.name && sel?.table === t.name;
                      return (
                        <button
                          key={t.name}
                          onClick={() => openTable(s, sc.name, t.name)}
                          className={`flex w-full items-center justify-between px-5 py-1 text-left text-sm ${active ? 'bg-blue-50 font-medium text-blue-700' : 'text-gray-600 hover:bg-gray-50'}`}
                          title={t.comment || t.name}
                        >
                          <span className="truncate">▤ {t.name}</span>
                          {t.comment && <span className="ml-2 shrink-0 text-xs text-gray-300">{t.comment}</span>}
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            ))}
            {!loadingSource && sources.length > 0 && flatList.length === 0 && (
              <div className="p-4 text-sm text-gray-400">未找到匹配的表（可点击数据源加载其 Schema/表）</div>
            )}
          </div>
        </aside>

        {/* 右：表内容 */}
        <section className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-gray-200 bg-white">
          {!sel ? (
            <div className="flex flex-1 items-center justify-center text-sm text-gray-400">
              在左侧选择一张表查看其内容
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2">
                <div className="min-w-0">
                  <span className="text-sm font-semibold text-gray-800">{sel.table}</span>
                  <span className="ml-2 text-xs text-gray-400">{sel.srcLabel} · {sel.schema}</span>
                  {truncated && <span className="ml-2 rounded bg-amber-50 px-1.5 text-xs text-amber-600">仅预览前 1000 行</span>}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-xs text-gray-400">{cols.length} 列 · {rows.length} 行</span>
                  {cols.length > 0 && <button className={btnGhost} onClick={exportCsv}>导出 CSV</button>}
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-auto">
                {loadingRows && <div className="p-6 text-sm text-gray-400">加载表内容…</div>}
                {!loadingRows && rowErr && (
                  <div className="p-4 text-sm text-red-600">预览失败：{rowErr}</div>
                )}
                {!loadingRows && !rowErr && cols.length === 0 && (
                  <div className="p-6 text-sm text-gray-400">该表没有可展示的列</div>
                )}
                {!loadingRows && !rowErr && cols.length > 0 && (
                  <table className="w-full border-collapse text-sm">
                    <thead className="sticky top-0 z-10 bg-gray-50">
                      <tr>
                        {cols.map((c, i) => (
                          <th key={i} className="whitespace-nowrap border-b border-gray-200 px-3 py-2 text-left text-xs font-semibold text-gray-600">
                            <div className="text-gray-800">{c.name}</div>
                            <div className="font-normal text-gray-400">{c.type}</div>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r, ri) => (
                        <tr key={ri} className="border-b border-gray-50 hover:bg-gray-50">
                          {cols.map((c, ci) => {
                            const v = r[c.name];
                            return (
                              <td key={ci} className="max-w-[260px] truncate px-3 py-1.5 align-top text-xs text-gray-700">
                                {v === null || v === undefined
                                  ? <span className="text-gray-300 italic">NULL</span>
                                  : typeof v === 'object' ? JSON.stringify(v) : String(v)}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}