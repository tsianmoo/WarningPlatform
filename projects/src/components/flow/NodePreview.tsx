'use client';

import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { X, Table2, AlertCircle, BellRing } from 'lucide-react';
import type { DataTable, FlowEdge, FlowNode } from '@/lib/types';
import { evaluateFlow, type NodePreview } from '@/lib/evaluate';

interface PreviewState {
  nodeId: string;
  loading: boolean;
  title: string;
  result?: NodePreview;
}

interface PreviewCtx {
  open: (node: FlowNode, allNodes: FlowNode[], edges: FlowEdge[], tables: DataTable[]) => void;
  close: () => void;
}

const Ctx = createContext<PreviewCtx | null>(null);

export function useNodePreview(): PreviewCtx {
  const ctx = useContext(Ctx);
  if (!ctx) return { open: () => {}, close: () => {} };
  return ctx;
}

export function NodePreviewProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PreviewState | null>(null);
  const seqRef = useRef(0);

  const open = useCallback((node: FlowNode, allNodes: FlowNode[], edges: FlowEdge[], tables: DataTable[]) => {
    const seq = ++seqRef.current;
    // 先弹出"计算中"，再在下一帧做重计算，避免大表同步计算阻塞弹窗渲染
    setState({ nodeId: node.id, loading: true, title: '计算中' });
    requestAnimationFrame(() => {
      setTimeout(() => {
        if (seq !== seqRef.current) return;
        try {
          const outputs = evaluateFlow(allNodes, edges, tables);
          const result: NodePreview = outputs[node.id] ?? {
            title: '预览',
            columns: [],
            rows: [],
            note: '暂无可预览结果。',
            unsupported: true,
          };
          if (seq === seqRef.current) setState({ nodeId: node.id, loading: false, title: result.title, result });
        } catch (err) {
          if (seq === seqRef.current) {
            setState({
              nodeId: node.id,
              loading: false,
              title: '预览出错',
              result: {
                title: '预览出错',
                columns: [],
                rows: [],
                note: `计算预览时出错：${err instanceof Error ? err.message : String(err)}`,
                unsupported: true,
              },
            });
          }
        }
      }, 0);
    });
  }, []);

  const close = useCallback(() => {
    seqRef.current += 1;
    setState(null);
  }, []);

  const value = useMemo(() => ({ open, close }), [open, close]);

  return (
    <Ctx.Provider value={value}>
      {children}
      {state && <PreviewModal state={state} onClose={close} />}
    </Ctx.Provider>
  );
}

function PreviewModal({ state, onClose }: { state: PreviewState; onClose: () => void }) {
  const r = state.result;
  const scrollBoxRef = useRef<HTMLDivElement | null>(null);
  // 横向滚动进度条：record 记录可视区占全宽的比例与滚动偏移
  const [hBar, setHBar] = useState<{ ratio: number; left: number } | null>(null);

  const handleHScroll = useCallback(() => {
    const el = scrollBoxRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    if (max <= 0) {
      setHBar(null); // 不超宽，无需进度条
      return;
    }
    setHBar({ ratio: el.clientWidth / el.scrollWidth, left: el.scrollLeft / max });
  }, []);

  // 内容或列变化后，在布局阶段测量一次，决定是否展示进度条（避免在 ref 回调里 setState 造成无限循环）
  useLayoutEffect(() => {
    handleHScroll();
  }, [handleHScroll, r]);

  return (
    <div
      className="fixed inset-0 z-[999] flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-[min(1080px,96vw)] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-gray-100 px-5 py-3">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
            <Table2 className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-gray-800">节点预览 · {state.title}</div>
            <div className="text-[11px] text-gray-400">基于已上传数据计算，用于逐步核对配置是否正确</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto flex h-7 w-7 items-center justify-center rounded-lg text-gray-400 transition hover:bg-gray-100 hover:text-gray-700"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-auto px-5 py-4">
          {state.loading ? (
            <div className="flex flex-col items-center justify-center gap-3 py-12 text-gray-400">
              <span className="h-7 w-7 animate-spin rounded-full border-2 border-gray-200 border-t-blue-500" />
              <span className="text-[12px]">正在计算预览结果…</span>
            </div>
          ) : r ? (
            <>
              {r.diag && (
                <div
                  className={`mb-3 rounded-lg px-3 py-2 text-[12px] leading-relaxed ${
                    r.diag.startsWith('✅')
                      ? 'bg-emerald-50 text-emerald-700'
                      : 'bg-amber-50 text-amber-800'
                  }`}
                >
                  {r.diag}
                </div>
              )}
              {r.note && (
                <div
                  className={`mb-3 flex items-start gap-2 rounded-lg px-3 py-2 text-[12px] leading-relaxed ${
                    r.unsupported ? 'bg-gray-50 text-gray-500' : 'bg-blue-50/70 text-blue-700'
                  }`}
                >
                  {r.unsupported && <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
                  <span>{r.note}</span>
                </div>
              )}

              {r.alertMessages && r.alertMessages.length > 0 && (
                <div className="mb-3 rounded-lg border border-indigo-200 bg-indigo-50/60 px-3 py-2.5">
                  <div className="mb-1.5 flex items-center gap-1.5 text-[12px] font-semibold text-indigo-700">
                    <BellRing className="h-3.5 w-3.5" />
                    通知消息预览（已用命中数据填充字段）
                  </div>
                  <div className="max-h-[32vh] space-y-1.5 overflow-auto pr-1">
                    {r.alertMessages.map((m, i) => (
                      <div key={i} className="rounded-md border border-indigo-100 bg-white px-2.5 py-1.5">
                        <div className="text-[11px] font-semibold text-indigo-600">{m.title || '预警通知'} #{i + 1}</div>
                        {m.content ? (
                          <div className="whitespace-pre-wrap text-[12px] leading-relaxed text-gray-700">{m.content}</div>
                        ) : (
                          <div className="text-[12px] italic text-gray-400">未配置通知消息内容</div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {r.columns.length > 0 && (
                <div className="relative rounded-lg border border-gray-200">
                  <div
                    ref={(el) => {
                      scrollBoxRef.current = el;
                    }}
                    onScroll={handleHScroll}
                    className="max-h-[70vh] w-full overflow-auto overscroll-x-contain"
                  >
                    <table className="min-w-max border-collapse text-[12px]">
                      <thead>
                        <tr className="bg-gray-50">
                          {r.columns.map((c) => (
                            <th
                              key={c}
                              className="sticky top-0 z-[1] whitespace-nowrap border-b border-gray-200 bg-gray-50 px-3 py-2 text-left font-semibold text-gray-600"
                            >
                              {c}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {r.rows.length === 0 ? (
                          <tr>
                            <td colSpan={r.columns.length} className="px-3 py-6 text-center text-gray-400">
                              无匹配结果
                            </td>
                          </tr>
                        ) : (
                          r.rows.map((row, i) =>
                            (row as Record<string, unknown>).__gh ? (
                              <tr key={i} className="border-b border-gray-200 bg-blue-50/70">
                                <td
                                  colSpan={r.columns.length}
                                  className="whitespace-nowrap px-3 py-1.5 text-[12px] font-semibold text-blue-700"
                                >
                                  <span className="flex items-center gap-1.5">
                                    <span className="inline-block h-3 w-1 rounded-full bg-blue-400" />
                                    <span className="font-semibold">
                                      {String(row['店铺'] ?? '')}　（该款色所有店铺合并：上报销量与全局尺码占比，库存列见各店铺明细）
                                    </span>
                                  </span>
                                </td>
                              </tr>
                            ) : (
                              <tr key={i} className={i % 2 ? 'bg-gray-50/50' : 'bg-white'}>
                                {r.columns.map((c) => (
                                  <td
                                    key={c}
                                    className="whitespace-nowrap border-b border-gray-100 px-3 py-1.5 text-gray-700"
                                  >
                                    <span className="block max-w-[420px] truncate" title={String(row[c] ?? '')}>
                                      {String(row[c] ?? '')}
                                    </span>
                                  </td>
                                ))}
                              </tr>
                            ),
                          )
                        )}
                      </tbody>
                    </table>
                  </div>

                  {/* 横向滚动进度条：内容超宽时显示，thumb 表示可视区位置 */}
                  {hBar && (
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[2] h-1.5 bg-gray-100/90">
                      <div
                        className="absolute top-0 h-full rounded-full bg-blue-400/90 transition-[left,width] duration-75"
                        style={{
                          width: `${Math.max(hBar.ratio * 100, 6)}%`,
                          left: `${hBar.left * (100 - Math.max(hBar.ratio * 100, 6))}%`,
                        }}
                      />
                    </div>
                  )}
                </div>
              )}

              {r.scalar && (
                <div className="mt-2 flex items-center justify-between rounded-lg border border-violet-200 bg-violet-50 px-4 py-3">
                  <span className="text-[12px] text-violet-700">{r.scalar.label}</span>
                  <span className="text-lg font-semibold tabular-nums text-violet-800">{r.scalar.value}</span>
                </div>
              )}
            </>
          ) : null}
        </div>

        <div className="border-t border-gray-100 px-5 py-2.5 text-[11px] text-gray-400">
          预览基于已上传全量数据计算（结果最多展示前 50 行），用于核对逻辑；正式执行结果相同。
        </div>
      </div>
    </div>
  );
}
