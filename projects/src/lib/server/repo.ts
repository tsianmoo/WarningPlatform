import { getSupabaseClient } from '@/storage/database/supabase-client';
import type { AlertRule, AlertStatus, AlertTask, DataTable } from '@/lib/types';

interface TableRow {
  id: string;
  name: string;
  file_name: string;
  row_count: number;
  created_at: number;
  data: DataTable;
  updated_at?: string;
}

interface RuleRow {
  id: string;
  name: string;
  status: string;
  created_at: number;
  updated_at_ms: number;
  data: AlertRule;
}

interface AlertRow {
  id: string;
  rule_id: string | null;
  rule_name: string | null;
  level: string | null;
  title: string | null;
  content: string | null;
  reason: string | null;
  condition_desc: string | null;
  preview: AlertTask['preview'] | null;
  dept: string | null;
  assignee: string | null;
  status: string | null;
  handoff_to: string | null;
  created_at: number;
  updated_at: number;
}

function toAlertTask(r: AlertRow): AlertTask {
  return {
    id: r.id,
    ruleId: r.rule_id ?? '',
    ruleName: r.rule_name ?? '',
    level: (r.level as AlertTask['level']) ?? 'warn',
    title: r.title ?? '',
    content: r.content ?? '',
    reason: r.reason ?? undefined,
    conditionDesc: r.condition_desc ?? undefined,
    preview: r.preview ?? undefined,
    createdBy: (r.preview as { createdBy?: string } | null)?.createdBy ?? undefined,
    dept: r.dept ?? '',
    assignee: r.assignee ?? '',
    status: (r.status as AlertStatus) ?? 'new',
    handoffTo: r.handoff_to ?? undefined,
    createdAt: r.created_at ?? Date.now(),
    updatedAt: r.updated_at ?? Date.now(),
  };
}

/** 读取全部预警（按创建时间倒序） */
export async function getAllAlerts(): Promise<AlertTask[]> {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from('alert_tasks')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw new Error(`读取预警失败: ${error.message}`);
  return (data as AlertRow[] | null)?.map(toAlertTask) ?? [];
}

/** 全量覆盖式保存预警（以入参为准，删除库中多余的预警） */
export async function syncAlerts(alerts: AlertTask[]): Promise<void> {
  const client = getSupabaseClient();
  const rows = alerts.map((a) => ({
    id: a.id,
    rule_id: a.ruleId,
    rule_name: a.ruleName,
    level: a.level,
    title: a.title,
    content: a.content,
    reason: a.reason ?? null,
    condition_desc: a.conditionDesc ?? null,
    preview: a.preview || a.createdBy ? { ...a.preview, createdBy: a.createdBy, columns: a.preview?.columns ?? [], rows: a.preview?.rows ?? [] } : null,
    dept: a.dept,
    assignee: a.assignee,
    status: a.status,
    handoff_to: a.handoffTo ?? null,
    created_at: a.createdAt ?? Date.now(),
    updated_at: a.updatedAt ?? Date.now(),
  }));

  if (rows.length > 0) {
    const { error } = await client.from('alert_tasks').upsert(rows, { onConflict: 'id' });
    if (error) throw new Error(`保存预警失败: ${error.message}`);
  }

  const { data: existing, error: selErr } = await client.from('alert_tasks').select('id');
  if (selErr) throw new Error(`读取预警ID失败: ${selErr.message}`);
  const keep = new Set(alerts.map((a) => a.id));
  const staleIds = ((existing as { id: string }[] | null) ?? [])
    .map((r) => r.id)
    .filter((id) => !keep.has(id));
  if (staleIds.length > 0) {
    const { error: delErr } = await client.from('alert_tasks').delete().in('id', staleIds);
    if (delErr) throw new Error(`删除预警失败: ${delErr.message}`);
  }
}

/** 读取所有数据表（按创建时间升序） */
export async function getAllTables(): Promise<DataTable[]> {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from('data_tables')
    .select('id,name,file_name,row_count,created_at,data')
    .order('created_at', { ascending: true });
  if (error) throw new Error(`读取数据表失败: ${error.message}`);
  return (data as TableRow[] | null)?.map((r) => r.data as DataTable) ?? [];
}

/** 全量覆盖式保存数据表（以入参为准，删除库中多余的表） */
export async function syncTables(tables: DataTable[]): Promise<void> {
  const client = getSupabaseClient();
  const rows = tables.map((t) => ({
    id: t.id,
    name: t.name,
    file_name: t.fileName ?? '',
    row_count: t.rowCount ?? 0,
    created_at: t.createdAt ?? Date.now(),
    data: t,
  }));

  if (rows.length > 0) {
    const { error } = await client.from('data_tables').upsert(rows, { onConflict: 'id' });
    if (error) throw new Error(`保存数据表失败: ${error.message}`);
  }

  // 删除已被前端移除的表
  const { data: existing, error: selErr } = await client.from('data_tables').select('id');
  if (selErr) throw new Error(`读取数据表ID失败: ${selErr.message}`);
  const keep = new Set(tables.map((t) => t.id));
  const staleIds = ((existing as { id: string }[] | null) ?? [])
    .map((r) => r.id)
    .filter((id) => !keep.has(id));
  if (staleIds.length > 0) {
    const { error: delErr } = await client.from('data_tables').delete().in('id', staleIds);
    if (delErr) throw new Error(`删除数据表失败: ${delErr.message}`);
  }
}

/** 读取所有规则 */
export async function getAllRules(): Promise<AlertRule[]> {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from('alert_rules')
    .select('id,name,status,created_at,updated_at_ms,data')
    .order('created_at', { ascending: true });
  if (error) throw new Error(`读取规则失败: ${error.message}`);
  return (data as RuleRow[] | null)?.map((r) => r.data as AlertRule) ?? [];
}

/** 全量覆盖式保存规则 */
export async function syncRules(rules: AlertRule[]): Promise<void> {
  const client = getSupabaseClient();
  const rows = rules.map((r) => ({
    id: r.id,
    name: r.name,
    status: r.status,
    created_at: r.createdAt ?? Date.now(),
    updated_at_ms: r.updatedAt ?? Date.now(),
    data: r,
  }));

  if (rows.length > 0) {
    const { error } = await client.from('alert_rules').upsert(rows, { onConflict: 'id' });
    if (error) throw new Error(`保存规则失败: ${error.message}`);
  }

  const { data: existing, error: selErr } = await client.from('alert_rules').select('id');
  if (selErr) throw new Error(`读取规则ID失败: ${selErr.message}`);
  const keep = new Set(rules.map((r) => r.id));
  const staleIds = ((existing as { id: string }[] | null) ?? [])
    .map((r) => r.id)
    .filter((id) => !keep.has(id));
  if (staleIds.length > 0) {
    const { error: delErr } = await client.from('alert_rules').delete().in('id', staleIds);
    if (delErr) throw new Error(`删除规则失败: ${delErr.message}`);
  }
}
