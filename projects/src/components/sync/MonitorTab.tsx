'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';
import { Modal, Badge, btnPrimary, btnGhost, Empty, useToast, usePerm } from './ui';

const STATUS_COLOR: Record<string, 'green' | 'red' | 'yellow' | 'gray' | 'blue'> = {
  success: 'green', failed: 'red', cancelled: 'gray', timeout: 'red',
  running: 'blue', ritzing: 'yellow', waiting: 'yellow',
};
const STATUS_LABEL: Record<string, string> = {
  success: '成功', failed: '失败', cancelled: '已取消', timeout: '超时', running: '运行中', waiting: '等待', retrying: '重试中',
};
const STAGE_KEYS = ['connect', 'read', 'transform', 'write', 'commit'];

function fmtDuration(ms?: number) {
  if (!ms) return '—';
  if (ms < 1000) return ms + 'ms';
  const s = ms / 1000;
  if (s < 60) return s.toFixed(1) + 's';
  return (s / 60).toFixed(1) + 'm';
}

export default function MonitorTab() {
  const { toast, ToastView } = useToast();
  const can = usePerm();
  const [items, setItems] = useState<any[]>([]);
  const [detail, setDetail] = useState<any | null>(null);
  const [logFilter, setLogFilter] = useState('');
  const [level, setLevel] = useState('ALL');
  const timer = useRef<any>(null);

  const load = useCallback(async () => {
    try { const r = await api.listInstances(); setItems(r.items || []); }
    catch {}
  }, []);

  useEffect(() => {
    load();
    timer.current = setInterval(load, 5000);
    return () => clearInterval(timer.current);
  }, [load]);

  const refreshDetail = useCallback(async () => {
    if (!detail?.id) return;
    try { const r = await api.getInstance(detail.id); setDetail(r.item); }
    catch {}
  }, [detail?.id]);

  useEffect(() => {
    if (!detail?.id) return;
    const t = setInterval(refreshDetail, 5000);
    return () => clearInterval(t);
  }, [detail?.id, refreshDetail]);

  const filteredLogs = (detail?.log || []).filter((l: any) =>
    (level === 'ALL' || l.level === level) &&
    (!logFilter || (l.msg || '').toLowerCase().includes(logFilter.toLowerCase())));

  const maxProgress = Math.max(detail?.progress || 0, 1);
  const stage = detail?.stage || {};
  const colorDiff = (c: number) => <span className={c > 0 ? 'text-green-600' : c < 0 ? 'text-red-600' : 'text-gray-500'}>{c > 0 ? '+' + c : c}</span>;

  return (
    <div className="flex h-full flex-col">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <div className="text-base font-semibold text-gray-800">运行监控</div>
          <div className="text-xs text-gray-400">自动每 5s 刷新，点击行查看实例详情/日志/脏数据</div>
        </div>
        <button className={btnGhost} onClick={load}>刷新</button>
      </div>
      <div className="flex-1 overflow-auto rounded-lg border border-gray-200 bg-white">
        {items.length === 0 && <Empty text="暂无运行实例" />}
        {items.length > 0 && (
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-gray-50 text-left text-xs text-gray-500">
              <tr>
                <th className="px-3 py-2">任务</th><th className="px-3 py-2">触发</th><th className="px-3 py-2">状态</th>
                <th className="px-3 py-2">开始</th><th className="px-3 py-2">耗时</th>
                <th className="px-3 py-2">读/写/更新/失败</th><th className="px-3 py-2">吞吐</th>
              </tr>
            </thead>
            <tbody>
              {items.map((inst) => (
                <tr key={inst.id} className="cursor-pointer border-t border-gray-100 hover:bg-blue-50" onClick={() => setDetail(inst)}>
                  <td className="px-3 py-2">
                    <div className="font-medium text-gray-800">{inst.taskName}</div>
                    <div className="text-xs text-gray-400">{inst.id}</div>
                  </td>
                  <td className="px-3 py-2"><Badge color={inst.trigger === 'auto' ? 'blue' : inst.trigger === 'backfill' ? 'yellow' : 'gray'}>{inst.trigger}</Badge></td>
                  <td className="px-3 py-2"><Badge color={STATUS_COLOR[inst.status] || 'gray'}>{STATUS_LABEL[inst.status] || inst.status}</Badge></td>
                  <td className="px-3 py-2 text-xs text-gray-500">{inst.startAt ? new Date(inst.startAt).toLocaleString() : '—'}</td>
                  <td className="px-3 py-2 text-xs text-gray-500">{fmtDuration(inst.durationMs)}</td>
                  <td className="px-3 py-2 text-xs text-gray-600">{inst.readRows ?? 0} / {inst.writeRows ?? 0} / {inst.updateRows ?? 0} / <span className="text-red-500">{inst.failedRows ?? 0}</span></td>
                  <td className="px-3 py-2 text-xs text-gray-500">{inst.throughput ? inst.throughput + ' r/s' : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Modal title={`实例详情 · ${detail?.taskName || ''}`} open={!!detail} onClose={() => setDetail(null)} wide>
        {detail && (
          <div className="space-y-3">
            <div className="flex items-center gap-3 text-sm">
              <Badge color={STATUS_COLOR[detail.status] || 'gray'}>{STATUS_LABEL[detail.status] || detail.status}</Badge>
              <span className="text-xs text-gray-500">ID {detail.id}</span>
              {detail.retryOf && <span className="text-xs text-amber-600">retry_of {detail.retryOf}</span>}
              {detail.error && <span className="text-xs text-red-600">{String(detail.error).slice(0, 120)}</span>}
              <div className="ml-auto flex gap-2 text-xs">
                <button className="text-blue-600 hover:underline disabled:opacity-40"
                  disabled={!can('run')}
                  onClick={() => { if (detail.status === 'running' || detail.status === 'waiting') api.stopInstance(detail.id).then(() => toast('已请求中断')).catch((e) => toast(e.message, 'err')); }}>停止</button>
                <button className="text-blue-600 hover:underline disabled:opacity-40" disabled={!can('run')}
                  onClick={() => api.runTask(detail.taskId, 'manual').then(() => toast('已触发重跑')).catch((e) => toast(e.message, 'err'))}>重跑同参数</button>
              </div>
            </div>

            <div>
              <div className="mb-1 flex justify-between text-xs text-gray-500"><span>进度</span><span>{detail.progress ?? 0}%（读 {detail.readRows ?? 0} 行）</span></div>
              <div className="h-2 w-full overflow-hidden rounded bg-gray-100"><div className="h-full bg-blue-500 transition-all" style={{ width: `${Math.min(maxProgress, 100)}%` }} /></div>
            </div>

            <div className="grid grid-cols-5 gap-2 text-center text-xs">
              {STAGE_KEYS.map((k) => {
                const v = stage[k];
                return (
                  <div key={k} className="rounded border border-gray-100 bg-gray-50 p-1.5">
                    <div className="text-gray-400">{k}</div>
                    <div className="font-medium text-gray-700">{v ? fmtDuration(v) : '—'}</div>
                  </div>
                );
              })}
            </div>

            <div className="grid grid-cols-3 gap-2 text-xs text-gray-600">
              <div className="rounded bg-gray-50 p-2">读 {detail.readRows ?? 0} · 写 {detail.writeRows ?? 0}</div>
              <div className="rounded bg-gray-50 p-2">更新 {detail.updateRows ?? 0} · 失败 <span className="text-red-600">{detail.failedRows ?? 0}</span></div>
              <div className="rounded bg-gray-50 p-2">吞吐 {detail.throughput ?? 0} rows/s · 耗时 {fmtDuration(detail.durationMs)}</div>
            </div>

            {detail.sqlDisplay && (
              <div>
                <div className="mb-1 text-xs font-semibold text-gray-500">实际执行 SQL（参数已替换，敏感值已脱敏）</div>
                <pre className="max-h-32 overflow-auto rounded bg-gray-900 p-2 text-xs text-green-300">{detail.sqlDisplay}</pre>
              </div>
            )}

            {detail.quality && detail.quality.length > 0 && (
              <div>
                <div className="mb-1 text-xs font-semibold text-gray-500">质量校验结果</div>
                <div className="flex flex-wrap gap-2">
                  {detail.quality.map((q: any) => (
                    <span key={q.rule} className={`rounded px-2 py-0.5 text-xs ${q.passed ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                      {q.rule}{q.unit ? `:${colorDiff(q.unit)}` : ''}{q.passed ? '' : `（${q.detail || '不通过'}）`}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs font-semibold text-gray-500">日志/脏数据</span>
                <div className="flex gap-2 text-xs">
                  <select className="rounded border border-gray-200 px-1" value={level} onChange={(e) => setLevel(e.target.value)}>
                    {['ALL', 'DEBUG', 'INFO', 'WARN', 'ERROR'].map((l) => <option key={l}>{l}</option>)}
                  </select>
                  <input className="rounded border border-gray-200 px-1" placeholder="过滤关键字" value={logFilter} onChange={(e) => setLogFilter(e.target.value)} />
                </div>
              </div>
              <div className="max-h-48 overflow-auto rounded border border-gray-100">
                {filteredLogs.map((l: any, i: number) => (
                  <div key={i} className="border-b border-gray-50 px-2 py-0.5 text-xs font-mono">
                    <span className={'mr-1 ' + (l.level === 'ERROR' ? 'text-red-500' : l.level === 'WARN' ? 'text-yellow-600' : l.level === 'DEBUG' ? 'text-gray-400' : 'text-gray-600')}>
                      [{l.level}][{new Date(l.at).toLocaleTimeString()}]
                    </span>
                    <span className="text-gray-700">{l.msg}</span>
                  </div>
                ))}
                {filteredLogs.length === 0 && <div className="p-3 text-xs text-gray-400">无日志</div>}
              </div>
              {detail.badRows && detail.badRows.length > 0 && (
                <div className="mt-2">
                  <span className="text-xs text-red-600">脏数据样本（{detail.badRows.length}）：</span>
                  <div className="mt-1 max-h-24 overflow-auto rounded border border-red-100 bg-red-50 p-2 text-xs font-mono text-red-700">
                    {detail.badRows.slice(0, 10).map((b: any, i: number) => (
                      <div key={i}>{JSON.stringify(b.row)} — {b.error}</div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>
      {ToastView}
    </div>
  );
}