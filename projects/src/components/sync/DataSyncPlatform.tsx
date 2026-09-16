'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useStore } from '@/lib/store';
import { resolvePerm, canOper } from '@/lib/perm';
import { PermCtx } from './ui';
import DatasourceManager from './DatasourceManager';
import DatasetManager from './DatasetManager';
import TaskManager from './TaskManager';
import MonitorTab from './MonitorTab';
import ChannelManager from './ChannelManager';

type TabKey = 'datasource' | 'dataset' | 'task' | 'monitor' | 'channel' | 'audit';

const TABS: { key: TabKey; label: string; hint: string }[] = [
  { key: 'datasource', label: '① 数据源', hint: '外部连接配置 / 测试 / 元数据' },
  { key: 'dataset', label: '② 数据集', hint: 'SQL 定义 / 校验 / 预览' },
  { key: 'task', label: '③ 同步任务', hint: '源→目标 / 写入增量 / 调度' },
  { key: 'monitor', label: '④ 运行监控', hint: '实例 / 日志 / 脏数据' },
  { key: 'channel', label: '⑤ 告警', hint: '通知渠道' },
  { key: 'audit', label: '⑥ 审计', hint: '操作留痕' },
];

export default function DataSyncPlatform() {
  const { state } = useStore();
  const [tab, setTab] = useState<TabKey>('datasource');
  const [datasources, setDatasources] = useState<any[]>([]);
  const [datasets, setDatasets] = useState<any[]>([]);
  const [tasks, setTasks] = useState<any[]>([]);
  const [channels, setChannels] = useState<any[]>([]);
  const [audit, setAudit] = useState<any[]>([]);

  const meName = typeof window !== 'undefined' ? localStorage.getItem('dn_auth') || '' : '';
  const me = useMemo(() => state.persons.find((p: any) => p.name === meName) ?? null, [state.persons, meName]);
  const perm = useMemo(() => resolvePerm(me, state.config), [me, state.config]);
  const can = useCallback((op: string) => canOper(perm, 'datasync', op as any), [perm]);

  const loadDs = useCallback(async () => {
    try { const r = await fetch('/api/sync/datasource').then((x) => x.json()); setDatasources(r.items || []); } catch {}
  }, []);
  const loadDataset = useCallback(async () => {
    try { const r = await fetch('/api/sync/dataset').then((x) => x.json()); setDatasets(r.items || []); } catch {}
  }, []);
  const loadTask = useCallback(async () => {
    try { const r = await fetch('/api/sync/task').then((x) => x.json()); setTasks(r.items || []); } catch {}
  }, []);
  const loadChannel = useCallback(async () => {
    try { const r = await fetch('/api/sync/channel').then((x) => x.json()); setChannels(r.items || []); } catch {}
  }, []);
  const loadAudit = useCallback(async () => {
    try { const r = await fetch('/api/sync/audit').then((x) => x.json()); setAudit(r.items || []); } catch {}
  }, []);

  useEffect(() => {
    loadDs(); loadDataset(); loadTask(); loadChannel(); if (tab === 'audit') loadAudit();
  }, [loadDs, loadDataset, loadTask, loadChannel, tab]);

  // 视图权限：view 由 resolvePerm 的 page.view 决定，不通过 canOper(op) 判断（无 'view' 操作）。
  // 写操作(create/edit/delete/run)仍由子组件按 can(op) 门禁控制。
  return (
    <PermCtx.Provider value={can}>
      <div className="flex h-full flex-col">
        <div className="mb-3 flex items-center gap-1 border-b border-gray-200 pb-2 overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              title={t.hint}
              className={`rounded-md px-3 py-1.5 text-sm whitespace-nowrap ${tab === t.key ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1">
          {tab === 'datasource' && <DatasourceManager />}
          {tab === 'dataset' && <DatasetManager datasources={datasources} />}
          {tab === 'task' && <TaskManager datasources={datasources} datasets={datasets} channels={channels} />}
          {tab === 'monitor' && <MonitorTab />}
          {tab === 'channel' && <ChannelManager />}
          {tab === 'audit' && <AuditView items={audit} />}
        </div>
      </div>
    </PermCtx.Provider>
  );
}

function AuditView({ items }: { items: any[] }) {
  return (
    <div className="flex h-full flex-col">
      <div className="mb-3 text-base font-semibold text-gray-800">操作审计</div>
      <div className="flex-1 overflow-auto rounded-lg border border-gray-200 bg-white">
        {items.length === 0 && <div className="p-6 text-sm text-gray-400">暂无审计记录</div>}
        {items.length > 0 && (
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-gray-50 text-left text-xs text-gray-500">
              <tr><th className="px-3 py-2">时间</th><th className="px-3 py-2">操作人</th><th className="px-3 py-2">动作</th><th className="px-3 py-2">对象</th><th className="px-3 py-2">变更 diff</th></tr>
            </thead>
            <tbody>
              {items.map((a) => (
                <tr key={a.id} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="px-3 py-2 text-xs text-gray-500">{new Date(a.at).toLocaleString()}</td>
                  <td className="px-3 py-2 text-gray-600">{a.who}</td>
                  <td className="px-3 py-2"><code className="rounded bg-gray-100 px-1 text-xs">{a.action}</code></td>
                  <td className="px-3 py-2">
                    <div className="text-gray-700">{a.targetName}</div>
                    <div className="text-xs text-gray-400">{a.targetType}</div>
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-500">{a.diff ? String(a.diff).slice(0, 80) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}