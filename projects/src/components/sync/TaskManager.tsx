'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from './api';
import { Field, Modal, Badge, btnPrimary, btnGhost, inputCls, Empty, useToast, usePerm } from './ui';
import type { DataSource, SyncDataset, SyncTask, AlertChannel } from '@/lib/sync/types';

const WRITE_STRATEGIES = ['APPEND', 'OVERWRITE', 'UPSERT', 'INSERT_IGNORE', 'TEMP_SWAP'];
const INCR_MODES = ['none', 'timestamp', 'auto_increment', 'pk_compare'];
const SAFE_CHARS = /^[A-Za-z0-9_]+$/;

export default function TaskManager({ datasources, datasets, channels }: { datasources: DataSource[]; datasets: SyncDataset[]; channels: AlertChannel[] }) {
  const { toast, ToastView } = useToast();
  const can = usePerm();
  const [items, setItems] = useState<SyncTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Partial<SyncTask> | null>(null);
  const [isEdit, setIsEdit] = useState(false);
  const [nextRuns, setNextRuns] = useState<number[]>([]);
  const [runModal, setRunModal] = useState<SyncTask | null>(null);
  const [bizDate, setBizDate] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try { const r = await api.listTasks(); setItems(r.items || []); }
    catch (e: any) { toast(e.message, 'err'); }
    finally { setLoading(false); }
  }, [toast]);
  useEffect(() => { load(); }, [load]);

  const openCreate = () => {
    setEditing({
      key: '', name: '', group: '默认', owner: '', desc: '', enabled: true, tags: '',
      datasetId: '', paramValues: {}, targetDatasourceId: '', targetSchema: '', targetTable: '',
      writeStrategy: 'APPEND', overwriteMode: 'truncate', bizKeys: [], fieldMappings: [],
      incrementalMode: 'none', incrementalField: '', safetyWindowSec: 300, windowClosed: false, firstRunBehavior: 'full',
      cron: '', timezone: '', misfire: 'ignore', allowParallel: false,
      fetchSize: 1000, batchSize: 2000, rateLimitPerSec: undefined, taskTimeoutSec: 7200,
      retryTimes: 2, retryBackoffSec: 30, autoCreateTable: true, autoAddColumn: false,
      onBatchError: 'continue', badRowThreshold: 100, typeTrim: false, lengthOverflow: 'truncate', encodingFrom: 'UTF-8',
      qualityChecks: [], qualityOnFail: 'alert', alertChannels: [], alert: undefined,
    });
    setIsEdit(false); setNextRuns([]); setOpen(true);
  };
  const openEdit = (t: SyncTask) => { setEditing({ ...t }); setIsEdit(true); setNextRuns([]); setOpen(true); };
  const set = (k: string, v: any) => setEditing((e) => ({ ...e, [k]: v }));

  const dataset = useMemo(() => datasets.find((d) => d.id === editing?.datasetId), [datasets, editing?.datasetId]);

  const doCronPreview = async () => {
    if (!editing?.cron) { setNextRuns([]); return; }
    try {
      const r = await api.cronPreview(editing.cron, editing.timezone);
      if (r.isValid) { setNextRuns(r.nextRuns || []); toast('Cron 有效'); }
      else toast(r.error || 'Cron 无效', 'err');
    } catch (e: any) { toast(e.message, 'err'); }
  };

  const save = async () => {
    if (!editing) return;
    if (!editing.key || !editing.datasetId || !editing.targetDatasourceId || !editing.targetTable) {
      toast('编码/源数据集/目标数据源/目标表 必填', 'err'); return;
    }
    // 目标表名安全校验（允许 ${TODAY} 变量）
    const segs = (editing.targetTable || '').split(/\$\{[^}]+\}/).join('').split('.');
    if (segs.some((s) => s && !SAFE_CHARS.test(s))) { toast('目标表名含非法字符', 'err'); return; }
    try {
      if (isEdit) { await api.updateTask(editing.id!, editing); toast('任务已更新'); }
      else { await api.createTask(editing); toast('任务已创建'); }
      setOpen(false); load();
    } catch (e: any) { toast(e.message, 'err'); }
  };
  const remove = async (t: SyncTask) => {
    if (!confirm(`删除任务「${t.name}」？`)) return;
    try { await api.deleteTask(t.id); toast('已删除'); load(); }
    catch (e: any) { toast(e.message, 'err'); }
  };
  const toggle = async (t: SyncTask) => {
    try { await api.updateTask(t.id, { enabled: !t.enabled }); load(); }
    catch (e: any) { toast(e.message, 'err'); }
  };
  const doRun = async (t: SyncTask, trigger: 'manual' | 'backfill') => {
    if (trigger === 'backfill' && !bizDate) { toast('补数请选择业务日期', 'err'); return; }
    try {
      await api.runTask(t.id, trigger, bizDate || undefined);
      toast(`已触发${trigger === 'backfill' ? '补数' : '执行'}`);
      setRunModal(null);
      setTimeout(load, 1500);
    } catch (e: any) { toast(e.message, 'err'); }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <div className="text-base font-semibold text-gray-800">同步任务</div>
          <div className="text-xs text-gray-400">源数据集 + 目标表 + 调度 + 写入/增量策略 + 告警质量</div>
        </div>
        <button className={btnPrimary} disabled={!can('create')} onClick={openCreate}>＋ 新建任务</button>
      </div>
      <div className="flex-1 overflow-auto rounded-lg border border-gray-200 bg-white">
        {loading && <div className="p-6 text-sm text-gray-400">加载中…</div>}
        {!loading && items.length === 0 && <Empty text="暂无同步任务" />}
        {!loading && items.length > 0 && (
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-gray-50 text-left text-xs text-gray-500">
              <tr>
                <th className="px-3 py-2">名称</th><th className="px-3 py-2">源 → 目标</th>
                <th className="px-3 py-2">写入</th><th className="px-3 py-2">增量</th><th className="px-3 py-2">调度</th>
                <th className="px-3 py-2">状态</th><th className="px-3 py-2">最近运行</th><th className="px-3 py-2 text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {items.map((t) => {
                const src = datasets.find((d) => d.id === t.datasetId);
                const tgt = datasources.find((d) => d.id === t.targetDatasourceId);
                return (
                  <tr key={t.id} className="border-t border-gray-100 hover:bg-gray-50">
                    <td className="px-3 py-2">
                      <div className="font-medium text-gray-800">{t.name}</div>
                      <div className="text-xs text-gray-400">{t.key}</div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="text-gray-600">{src?.name || '?'}</div>
                      <div className="text-xs text-gray-400">→ {(tgt?.label || '') + '.' + t.targetTable}</div>
                    </td>
                    <td className="px-3 py-2"><Badge color="blue">{t.writeStrategy}</Badge></td>
                    <td className="px-3 py-2 text-xs text-gray-500">{t.incrementalMode === 'none' ? '全量' : t.incrementalMode}</td>
                    <td className="px-3 py-2 text-xs text-gray-500">{t.cron ? <code className="rounded bg-gray-100 px-1">{t.cron}</code> : t.intervalSec ? `每${t.intervalSec}s` : '—'}</td>
                    <td className="px-3 py-2">
                      <button onClick={() => toggle(t)} title="点击切换启用">
                        {t.enabled ? <Badge color="green">启用</Badge> : <Badge color="gray">停用</Badge>}
                      </button>
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-400">{t.lastStatus?.lastRun ? new Date(t.lastStatus.lastRun).toLocaleString() : '—'}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <button className="mr-1 text-xs text-green-600 hover:underline disabled:opacity-40" disabled={!can('run')} onClick={() => setRunModal(t)}>执行</button>
                      <button className="mr-1 text-xs text-gray-600 hover:underline disabled:opacity-40" disabled={!can('edit')} onClick={() => openEdit(t)}>编辑</button>
                      <button className="mr-1 text-xs text-amber-600 hover:underline disabled:opacity-40" disabled={!can('edit')} onClick={() => { if (confirm('清空水位线并强制下次全量？')) api.resetWatermark(t.id).then(() => toast('水位已重置')).catch((e) => toast(e.message, 'err')); }}>重置水位</button>
                      <button className="text-xs text-red-500 hover:underline disabled:opacity-40" disabled={!can('delete')} onClick={() => remove(t)}>删除</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <Modal title={isEdit ? '编辑任务' : '新建任务'} open={open} onClose={() => setOpen(false)} wide>
        {editing && (
          <div className="space-y-4">
            <div className="grid grid-cols-4 gap-3">
              <Field label="编码"><input className={inputCls} value={editing.key} onChange={(e) => set('key', e.target.value)} /></Field>
              <Field label="名称"><input className={inputCls} value={editing.name} onChange={(e) => set('name', e.target.value)} /></Field>
              <Field label="分组"><input className={inputCls} value={editing.group} onChange={(e) => set('group', e.target.value)} /></Field>
              <Field label="负责人"><input className={inputCls} value={editing.owner} onChange={(e) => set('owner', e.target.value)} /></Field>
              <Field label="标签" className="col-span-2"><input className={inputCls} value={editing.tags} onChange={(e) => set('tags', e.target.value)} placeholder="多个用逗号分隔" /></Field>
              <Field label="首次执行">
                <select className={inputCls} value={editing.firstRunBehavior} onChange={(e) => set('firstRunBehavior', e.target.value)}>
                  <option value="full">首次全量，后续增量</option><option value="incremental">直接增量</option>
                </select>
              </Field>
              <label className="flex items-end gap-2 pb-1.5"><input type="checkbox" checked={!!editing.enabled} onChange={(e) => set('enabled', e.target.checked)} /><span className="text-sm">启用调度</span></label>
            </div>

            <div className="rounded border border-gray-200 p-3">
              <div className="mb-2 text-xs font-semibold text-gray-500">源（数据集 + 参数）</div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="源数据集">
                  <select className={inputCls} value={editing.datasetId} onChange={(e) => set('datasetId', e.target.value)}>
                    <option value="">选择数据集</option>
                    {datasets.map((d) => <option key={d.id} value={d.id}>{d.name}（{d.key}）</option>)}
                  </select>
                </Field>
                <div className="text-xs text-gray-400 pt-5">参数可注入静态值或内置变量（${'{'}TODAY${'}'} / ${'{'}yyyyMM${'}'}）</div>
              </div>
              {dataset && dataset.params.length > 0 && (
                <div className="mt-2 grid grid-cols-3 gap-2">
                  {dataset.params.map((p) => (
                    <Field key={p} label={`参数 ${p}`}>
                      <input className={inputCls} value={(editing.paramValues as any)?.[p] || ''} onChange={(e) => set('paramValues', { ...(editing.paramValues || {}), [p]: e.target.value })} />
                    </Field>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded border border-gray-200 p-3">
              <div className="mb-2 text-xs font-semibold text-gray-500">目标表（支持 ${'{'}TODAY${'}'} 等变量日期分表）</div>
              <div className="grid grid-cols-3 gap-3">
                <Field label="目标数据源">
                  <select className={inputCls} value={editing.targetDatasourceId} onChange={(e) => set('targetDatasourceId', e.target.value)}>
                    <option value="">选择数据源</option>
                    {datasources.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
                  </select>
                </Field>
                <Field label="目标 Schema（可选）"><input className={inputCls} value={editing.targetSchema} onChange={(e) => set('targetSchema', e.target.value)} /></Field>
                <Field label="目标表名"><input className={inputCls} value={editing.targetTable} onChange={(e) => set('targetTable', e.target.value)} placeholder="order_detail_${yyyyMM}" /></Field>
              </div>
              <div className="mt-2 flex items-center gap-4 text-xs text-gray-500">
                <label className="flex items-center gap-1"><input type="checkbox" checked={!!editing.autoCreateTable} onChange={(e) => set('autoCreateTable', e.target.checked)} /> 目标表不存在时自动建表</label>
                <label className="flex items-center gap-1"><input type="checkbox" checked={!!editing.autoAddColumn} onChange={(e) => set('autoAddColumn', e.target.checked)} /> 结构变更自动加列</label>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <Field label="写入策略">
                <select className={inputCls} value={editing.writeStrategy} onChange={(e) => set('writeStrategy', e.target.value)}>
                  {WRITE_STRATEGIES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </Field>
              {editing.writeStrategy === 'OVERWRITE' && (
                <Field label="覆盖方式">
                  <select className={inputCls} value={editing.overwriteMode} onChange={(e) => set('overwriteMode', e.target.value)}>
                    <option value="truncate">TRUNCATE</option><option value="delete">DELETE</option>
                  </select>
                </Field>
              )}
              {editing.writeStrategy === 'UPSERT' && (
                <Field label="业务主键(逗号分隔)"><input className={inputCls} value={(editing.bizKeys || []).join(',')} onChange={(e) => set('bizKeys', e.target.value.split(',').map((s) => s.trim()).filter(Boolean))} /></Field>
              )}
              <Field label="增量策略">
                <select className={inputCls} value={editing.incrementalMode} onChange={(e) => set('incrementalMode', e.target.value)}>
                  <option value="none">全量</option><option value="timestamp">时间戳增量</option><option value="autoincrement">自增ID增量</option><option value="fullcompare">全量+主键比对</option>
                </select>
              </Field>
              {(editing.incrementalMode === 'timestamp' || editing.incrementalMode === 'autoincrement') && (
                <Field label="增量字段（如 UPDATE_TIME）"><input className={inputCls} value={editing.incrementalField} onChange={(e) => set('incrementalField', e.target.value)} /></Field>
              )}
            </div>

            <div className="rounded border border-gray-200 p-3">
              <div className="mb-2 text-xs font-semibold text-gray-500">调度</div>
              <div className="grid grid-cols-5 gap-3">
                <Field label="Cron 表达式（5/6/7位）"><input className={inputCls} value={editing.cron} onChange={(e) => set('cron', e.target.value)} placeholder="0 */5 * * * ?" /></Field>
                <Field label="时区"><input className={inputCls} value={editing.timezone} onChange={(e) => set('timezone', e.target.value)} placeholder="Asia/Shanghai" /></Field>
                <Field label="间隔执行(秒，可选)"><input type="number" className={inputCls} value={editing.intervalSec || ''} onChange={(e) => set('intervalSec', e.target.value ? Number(e.target.value) : undefined)} /></Field>
                <Field label="Misfire">
                  <select className={inputCls} value={editing.misfire} onChange={(e) => set('misfire', e.target.value)}>
                    <option value="ignore">忽略</option><option value="cancel">丢弃</option><option value="immediate">立即补跑</option><option value="next">下次再跑</option>
                  </select>
                </Field>
                <label className="flex items-end gap-2 pb-1.5"><input type="checkbox" checked={!!editing.allowParallel} onChange={(e) => set('allowParallel', e.target.checked)} /><span className="text-xs">允许并行</span></label>
                <div className="col-span-3 flex items-end gap-2">
                  <button className={btnGhost} onClick={doCronPreview}>预览接下来 5 次</button>
                  {nextRuns.length > 0 && (
                    <div className="text-xs text-gray-500">{nextRuns.map((t) => new Date(t).toLocaleString()).join('  →  ')}</div>
                  )}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-4 gap-3">
              <Field label="读取批大小(fetchSize)"><input type="number" className={inputCls} value={editing.fetchSize} onChange={(e) => set('fetchSize', Number(e.target.value))} /></Field>
              <Field label="写入批大小"><input type="number" className={inputCls} value={editing.batchSize} onChange={(e) => set('batchSize', Number(e.target.value))} /></Field>
              <Field label="限速(rows/s，可选)"><input type="number" className={inputCls} value={editing.rateLimitPerSec || ''} onChange={(e) => set('rateLimitPerSec', e.target.value ? Number(e.target.value) : undefined)} /></Field>
              <Field label="任务超时(s)"><input type="number" className={inputCls} value={editing.taskTimeoutSec} onChange={(e) => set('taskTimeoutSec', Number(e.target.value))} /></Field>
              <Field label="失败重试次数"><input type="number" className={inputCls} value={editing.retryTimes} onChange={(e) => set('retryTimes', Number(e.target.value))} /></Field>
              <Field label="重试退避(s)"><input type="number" className={inputCls} value={editing.retryBackoffSec} onChange={(e) => set('retryBackoffSec', Number(e.target.value))} /></Field>
              <Field label="批失败策略">
                <select className={inputCls} value={editing.onBatchError} onChange={(e) => set('onBatchError', e.target.value)}>
                  <option value="continue">降级单条并记录脏数据</option><option value="abort">批次失败即整体失败</option>
                </select>
              </Field>
              <Field label="脏数据阈值(条)"><input type="number" className={inputCls} value={editing.badRowThreshold} onChange={(e) => set('badRowThreshold', Number(e.target.value))} /></Field>
            </div>

            <div className="rounded border border-gray-200 p-3">
              <div className="mb-2 text-xs font-semibold text-gray-500">质量校验 & 告警</div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="质量校验规则（每行一条: 类型[:参数]）">
                  <textarea className={inputCls} rows={3}
                    value={(editing.qualityChecks || []).map((q: any) => (typeof q === 'string' ? q : `${q.type}:${q.param || ''}`)).join('\n')}
                    onChange={(e) => set('qualityChecks', e.target.value.split('\n').map((s) => s.trim()).filter(Boolean)
                      .map((s) => { const i = s.indexOf(':'); return i > 0 ? { type: s.slice(0, i), param: s.slice(i + 1) } : { type: s }; }))}
                    placeholder={'row_count\nkey_unique:ID\nnull_rate:AMOUNT\nsum_compare:AMOUNT\nsample:20'} />
                </Field>
                <div>
                  <Field label="规则说明">项目; 每行一条, 见右侧占位</Field>
                  <div className="mt-1 text-xs text-gray-400">row_count / key_unique:k1,k2 / null_rate:COL / range:COL:min:max / sum_compare:COL / sample:N / custom:SQL</div>
                </div>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-3">
                <Field label="校验失败处理">
                  <select className={inputCls} value={editing.qualityOnFail} onChange={(e) => set('qualityOnFail', e.target.value)}>
                    <option value="alert">仅告警</option><option value="block">阻断下游并标记实例失败</option>
                  </select>
                </Field>
                <Field label="告警渠道（多选，Ctrl click）">
                  <select multiple className={inputCls + ' h-16'} value={editing.alertChannels || []}
                    onChange={(e) => set('alertChannels', Array.from(e.target.selectedOptions).map((o) => o.value))}>
                    {channels.map((c) => <option key={c.id} value={c.id}>{c.name}（{c.type}）</option>)}
                  </select>
                </Field>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <button className={btnGhost} onClick={() => setOpen(false)}>取消</button>
              <button className={btnPrimary} disabled={!can('create') && !can('edit')} onClick={save}>保存</button>
            </div>
          </div>
        )}
      </Modal>

      {/* 执行 / 补数 */}
      <Modal title={`执行任务 · ${runModal?.name || ''}`} open={!!runModal} onClose={() => setRunModal(null)}>
        <div className="space-y-3">
          <Field label="补数业务日期（补数时必填）"><input type="date" className={inputCls} value={bizDate} onChange={(e) => setBizDate(e.target.value)} /></Field>
          <div className="flex gap-2 justify-end">
            <button className={btnGhost} onClick={() => setRunModal(null)}>取消</button>
            {runModal && <button className={btnPrimary} onClick={() => doRun(runModal, 'manual')}>立即执行</button>}
            {runModal && <button className={btnGhost} onClick={() => doRun(runModal, 'backfill')}>补数</button>}
          </div>
        </div>
      </Modal>
      {ToastView}
    </div>
  );
}