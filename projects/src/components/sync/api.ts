'use client';

import type { DataSource, SyncDataset, SyncTask, AlertChannel } from '@/lib/sync/types';

async function req(method: string, path: string, body?: unknown) {
  let user = '';
  try {
    const raw = localStorage.getItem('dn_auth');
    if (raw) user = (JSON.parse(raw) as any)?.name || '';
  } catch {}
  const res = await fetch(`/api/sync/${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'x-user': user },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data: any = {};
  try { data = await res.json(); } catch {}
  if (!res.ok) throw new Error(data?.error || `请求失败(${res.status})`);
  return data;
}

export const api = {
  // 数据源
  listDatasources: () => req('GET', 'datasource'),
  createDatasource: (b: any) => req('POST', 'datasource', b),
  updateDatasource: (id: string, b: any) => req('PUT', `datasource/${id}`, { ...b, password: b.password || '' }),
  deleteDatasource: (id: string) => req('DELETE', `datasource/${id}`),
  testDatasource: (b: any, timeoutMs = 10000) => req('POST', 'datasource/test', { ...b, timeoutMs }),
  browseMeta: (id: string, force = false) => req('POST', 'datasource/meta', { id, force }),
  previewTable: (id: string, schema: string, table: string, limit = 1000) =>
    req('POST', 'datasource/table', { id, schema, table, limit }),

  // 数据集
  listDatasets: () => req('GET', 'dataset'),
  createDataset: (b: any) => req('POST', 'dataset', b),
  updateDataset: (id: string, b: any) => req('PUT', `dataset/${id}`, b),
  deleteDataset: (id: string) => req('DELETE', `dataset/${id}`),
  previewDataset: (datasetId: string, params: Record<string, unknown>, limit?: number) =>
    req('POST', 'dataset/preview', { datasetId, params, limit }),
  validateSql: (sql: string) => req('POST', 'dataset/validate', { sql }),

  // 任务
  listTasks: () => req('GET', 'task'),
  createTask: (b: any) => req('POST', 'task', b),
  updateTask: (id: string, b: any) => req('PUT', `task/${id}`, b),
  deleteTask: (id: string) => req('DELETE', `task/${id}`),
  runTask: (taskId: string, trigger: 'manual' | 'backfill', bizDate?: string) =>
    req('POST', 'task/run', { taskId, trigger, bizDate }),
  cronPreview: (cron: string, timezone?: string) => req('POST', 'task/cron', { cron, timezone }),
  setWatermark: (taskId: string, value?: string) => req('POST', 'task/watermark', { taskId, value }),
  resetWatermark: (taskId: string) => req('POST', 'task/watermark', { taskId, reset: true }),

  // 实例
  listInstances: () => req('GET', 'instance'),
  getInstance: (id: string) => req('GET', `instance/${id}`),
  stopInstance: (id: string) => req('POST', `instance/${id}/stop`),

  // 渠道
  listChannels: () => req('GET', 'channel'),
  createChannel: (b: any) => req('POST', 'channel', b),
  updateChannel: (id: string, b: any) => req('PUT', `channel/${id}`, b),
  deleteChannel: (id: string) => req('DELETE', `channel/${id}`),
  testChannel: (b: any) => req('POST', 'channel/test', b),

  // 审计
  listAudit: () => req('GET', 'audit'),
};

export type { DataSource, SyncDataset, SyncTask, AlertChannel };