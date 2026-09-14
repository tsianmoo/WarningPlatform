import { getSupabaseClient } from '@/storage/database/supabase-client';
import type { AlertRule, AlertStatus, AlertTask, AttrCategory, DataTable, Dealer, HomeConfig, HrAttribute, Organization, Person, RuleGroup, Store } from '@/lib/types';

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
    id: a.id ?? `alert_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
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
  } else {
    // 本次提交为空集合时不清空库中已有预警，避免前端某次空同步误删全部业务预警
    return;
  }

  const { data: existing, error: selErr } = await client.from('alert_tasks').select('id');
  if (selErr) throw new Error(`读取预警ID失败: ${selErr.message}`);
  const keep = new Set(rows.map((r) => r.id));
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

interface RuleGroupRow {
  id: string;
  name: string;
  created_at: number;
}

function toRuleGroup(row: RuleGroupRow): RuleGroup {
  return { id: row.id, name: row.name, createdAt: row.created_at };
}

export async function getAllRuleGroups(): Promise<RuleGroup[]> {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from('rule_groups')
    .select('id,name,created_at')
    .order('created_at', { ascending: true });
  if (error) throw new Error(`读取分组失败: ${error.message}`);
  return ((data as RuleGroupRow[] | null) ?? []).map(toRuleGroup);
}

export async function syncRuleGroups(groups: RuleGroup[]): Promise<void> {
  const client = getSupabaseClient();
  const rows = groups.map((g) => ({
    id: g.id,
    name: g.name,
    created_at: g.createdAt ?? Date.now(),
  }));
  if (rows.length > 0) {
    const { error } = await client.from('rule_groups').upsert(rows, { onConflict: 'id' });
    if (error) throw new Error(`保存分组失败: ${error.message}`);
  }
  const { data: existing, error: selErr } = await client.from('rule_groups').select('id');
  if (selErr) throw new Error(`读取分组ID失败: ${selErr.message}`);
  const keep = new Set(groups.map((g) => g.id));
  const staleIds = ((existing as { id: string }[] | null) ?? [])
    .map((r) => r.id)
    .filter((id) => !keep.has(id));
  if (staleIds.length > 0) {
    const { error: delErr } = await client.from('rule_groups').delete().in('id', staleIds);
    if (delErr) throw new Error(`删除分组失败: ${delErr.message}`);
  }
}

interface OrgRow {
  id: string;
  name: string;
  kind: string;
  parent_id: string | null;
  sort: number;
  created_at: number;
}

function toOrg(r: OrgRow): Organization {
  return {
    id: r.id,
    name: r.name,
    kind: (r.kind as Organization['kind']) ?? '其他',
    parentId: r.parent_id ?? undefined,
    sort: r.sort ?? 0,
    createdAt: r.created_at ?? Date.now(),
  };
}

export async function getAllOrganizations(): Promise<Organization[]> {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from('organizations')
    .select('*')
    .order('sort', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) throw new Error(`读取组织架构失败: ${error.message}`);
  return ((data as OrgRow[] | null) ?? []).map(toOrg);
}

export async function syncOrganizations(orgs: Organization[]): Promise<void> {
  const client = getSupabaseClient();
  const rows = orgs.map((o) => ({
    id: o.id,
    name: o.name,
    kind: o.kind,
    parent_id: o.parentId ?? null,
    sort: o.sort ?? 0,
    created_at: o.createdAt ?? Date.now(),
  }));
  if (rows.length > 0) {
    const { error } = await client.from('organizations').upsert(rows, { onConflict: 'id' });
    if (error) throw new Error(`保存组织架构失败: ${error.message}`);
  }
  const { data: existing, error: selErr } = await client.from('organizations').select('id');
  if (selErr) throw new Error(`读取组织ID失败: ${selErr.message}`);
  const keep = new Set(orgs.map((o) => o.id));
  const staleIds = ((existing as { id: string }[] | null) ?? [])
    .map((r) => r.id)
    .filter((id) => !keep.has(id));
  if (staleIds.length > 0) {
    const { error: delErr } = await client.from('organizations').delete().in('id', staleIds);
    if (delErr) throw new Error(`删除组织失败: ${delErr.message}`);
  }
}

interface PersonRow {
  id: string;
  name: string;
  org_id: string | null;
  title: string | null;
  supervisor_id: string | null;
  manage_scope: Person['manageScope'] | null;
  phone: string | null;
  email: string | null;
  username: string | null;
  id_card: string | null;
  address: string | null;
  birthday: string | null;
  password: string | null;
  post: string | null;
  dealer_id: string | null;
  store_id: string | null;
  enabled: boolean;
  sort: number;
  created_at: number;
}

function toPerson(r: PersonRow): Person {
  return {
    id: r.id,
    name: r.name,
    orgId: r.org_id ?? '',
    title: r.title ?? undefined,
    post: r.post ?? undefined,
    dealerId: r.dealer_id ?? undefined,
    storeId: r.store_id ?? undefined,
    supervisorId: r.supervisor_id ?? undefined,
    manageScope: r.manage_scope ?? undefined,
    phone: r.phone ?? undefined,
    email: r.email ?? undefined,
    username: r.username ?? undefined,
    idCard: r.id_card ?? undefined,
    address: r.address ?? undefined,
    birthday: r.birthday ?? undefined,
    password: r.password ?? undefined,
    enabled: r.enabled ?? true,
    sort: r.sort ?? 0,
    createdAt: r.created_at ?? Date.now(),
  };
}

export async function getAllPersons(): Promise<Person[]> {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from('persons')
    .select('*')
    .order('sort', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) throw new Error(`读取人事架构失败: ${error.message}`);
  return ((data as PersonRow[] | null) ?? []).map(toPerson);
}

export async function syncPersons(persons: Person[]): Promise<void> {
  const client = getSupabaseClient();
  const rows = persons.map((p) => ({
    id: p.id,
    name: p.name,
    org_id: p.orgId ?? '',
    title: p.title ?? null,
    post: p.post ?? null,
    dealer_id: p.dealerId ?? null,
    store_id: p.storeId ?? null,
    supervisor_id: p.supervisorId ?? null,
    manage_scope: p.manageScope ?? null,
    phone: p.phone ?? null,
    email: p.email ?? null,
    username: p.username ?? null,
    id_card: p.idCard ?? null,
    address: p.address ?? null,
    birthday: p.birthday ?? null,
    password: p.password ?? null,
    enabled: p.enabled ?? true,
    sort: p.sort ?? 0,
    created_at: p.createdAt ?? Date.now(),
  }));
  if (rows.length > 0) {
    const { error } = await client.from('persons').upsert(rows, { onConflict: 'id' });
    if (error) throw new Error(`保存人事架构失败: ${error.message}`);
  }
  const { data: existing, error: selErr } = await client.from('persons').select('id');
  if (selErr) throw new Error(`读取人员ID失败: ${selErr.message}`);
  const keep = new Set(persons.map((p) => p.id));
  const staleIds = ((existing as { id: string }[] | null) ?? [])
    .map((r) => r.id)
    .filter((id) => !keep.has(id));
  if (staleIds.length > 0) {
    const { error: delErr } = await client.from('persons').delete().in('id', staleIds);
    if (delErr) throw new Error(`删除人员失败: ${delErr.message}`);
  }
}

export async function getAllHrAttributes(): Promise<HrAttribute[]> {
  const client = getSupabaseClient();
  const { data, error } = await client.from('hr_attributes').select('*').order('sort', { ascending: true });
  if (error) throw new Error(`读取人事属性失败: ${error.message}`);
  return ((data as unknown as HrAttribute[]) ?? []).map((a) => ({
    id: a.id,
    name: a.name,
    items: a.items ?? [],
    sort: a.sort ?? 0,
    category: (a.category ?? 'person') as AttrCategory,
    createdAt: a.createdAt ?? 0,
  }));
}

export async function syncHrAttributes(attributes: HrAttribute[]): Promise<void> {
  const client = getSupabaseClient();
  const rows = attributes.map((a) => ({
    id: a.id,
    name: a.name,
    items: a.items ?? [],
    sort: a.sort ?? 0,
    category: a.category ?? 'person',
    created_at: a.createdAt ?? Date.now(),
  }));
  if (rows.length > 0) {
    const { error } = await client.from('hr_attributes').upsert(rows, { onConflict: 'id' });
    if (error) throw new Error(`保存人事属性失败: ${error.message}`);
  }
  const { data: existing, error: selErr } = await client.from('hr_attributes').select('id');
  if (selErr) throw new Error(`读取属性ID失败: ${selErr.message}`);
  const keep = new Set(attributes.map((a) => a.id));
  const staleIds = ((existing as { id: string }[] | null) ?? [])
    .map((r) => r.id)
    .filter((id) => !keep.has(id));
  if (staleIds.length > 0) {
    const { error: delErr } = await client.from('hr_attributes').delete().in('id', staleIds);
    if (delErr) throw new Error(`删除属性失败: ${delErr.message}`);
  }
}

interface DictRow {
  id: string;
  name: string;
  sort: number;
  created_at: number;
  code?: string | null;
  contact?: string | null;
  phone?: string | null;
  address?: string | null;
  password?: string | null;
  birthday?: string | null;
  enabled?: boolean | null;
  attrs?: Record<string, string> | null;
}

function toDealer(r: DictRow): Dealer {
  return {
    id: r.id,
    name: r.name,
    sort: r.sort ?? 0,
    createdAt: r.created_at ?? 0,
    code: r.code ?? undefined,
    contact: r.contact ?? undefined,
    phone: r.phone ?? undefined,
    address: r.address ?? undefined,
    password: r.password ?? undefined,
    birthday: r.birthday ?? undefined,
    enabled: r.enabled ?? true,
    attrs: r.attrs ?? undefined,
  };
}

function toStore(r: DictRow): Store {
  return {
    id: r.id,
    name: r.name,
    sort: r.sort ?? 0,
    createdAt: r.created_at ?? 0,
    code: r.code ?? undefined,
    contact: r.contact ?? undefined,
    phone: r.phone ?? undefined,
    address: r.address ?? undefined,
    password: r.password ?? undefined,
    birthday: r.birthday ?? undefined,
    enabled: r.enabled ?? true,
    attrs: r.attrs ?? undefined,
  };
}

export async function getAllDealers(): Promise<Dealer[]> {
  const client = getSupabaseClient();
  const { data, error } = await client.from('dealers').select('*').order('sort', { ascending: true });
  if (error) throw new Error(`读取经销商失败: ${error.message}`);
  return ((data as DictRow[] | null) ?? []).map(toDealer);
}

export async function syncDealers(dealers: Dealer[]): Promise<void> {
  const client = getSupabaseClient();
  const rows = dealers.map((d) => ({
    id: d.id,
    name: d.name,
    sort: d.sort ?? 0,
    created_at: d.createdAt ?? Date.now(),
    code: d.code ?? null,
    contact: d.contact ?? null,
    phone: d.phone ?? null,
    address: d.address ?? null,
    password: d.password ?? null,
    birthday: d.birthday ?? null,
    enabled: d.enabled ?? true,
    attrs: d.attrs ?? null,
  }));
  if (rows.length > 0) {
    const { error } = await client.from('dealers').upsert(rows, { onConflict: 'id' });
    if (error) throw new Error(`保存经销商失败: ${error.message}`);
  }
  const { data: existing, error: selErr } = await client.from('dealers').select('id');
  if (selErr) throw new Error(`读取经销商ID失败: ${selErr.message}`);
  const keep = new Set(dealers.map((d) => d.id));
  const staleIds = ((existing as { id: string }[] | null) ?? []).map((r) => r.id).filter((id) => !keep.has(id));
  if (staleIds.length > 0) {
    const { error: delErr } = await client.from('dealers').delete().in('id', staleIds);
    if (delErr) throw new Error(`删除经销商失败: ${delErr.message}`);
  }
}

export async function getAllStores(): Promise<Store[]> {
  const client = getSupabaseClient();
  const { data, error } = await client.from('stores').select('*').order('sort', { ascending: true });
  if (error) throw new Error(`读取店仓失败: ${error.message}`);
  return ((data as DictRow[] | null) ?? []).map(toStore);
}

export async function syncStores(stores: Store[]): Promise<void> {
  const client = getSupabaseClient();
  const rows = stores.map((s) => ({
    id: s.id,
    name: s.name,
    sort: s.sort ?? 0,
    created_at: s.createdAt ?? Date.now(),
    code: s.code ?? null,
    contact: s.contact ?? null,
    phone: s.phone ?? null,
    address: s.address ?? null,
    password: s.password ?? null,
    birthday: s.birthday ?? null,
    enabled: s.enabled ?? true,
    attrs: s.attrs ?? null,
  }));
  if (rows.length > 0) {
    const { error } = await client.from('stores').upsert(rows, { onConflict: 'id' });
    if (error) throw new Error(`保存店仓失败: ${error.message}`);
  }
  const { data: existing, error: selErr } = await client.from('stores').select('id');
  if (selErr) throw new Error(`读取店仓ID失败: ${selErr.message}`);
  const keep = new Set(stores.map((s) => s.id));
  const staleIds = ((existing as { id: string }[] | null) ?? []).map((r) => r.id).filter((id) => !keep.has(id));
  if (staleIds.length > 0) {
    const { error: delErr } = await client.from('stores').delete().in('id', staleIds);
    if (delErr) throw new Error(`删除店仓失败: ${delErr.message}`);
  }
}

export async function getHomeConfig(): Promise<HomeConfig | null> {
  const client = getSupabaseClient();
  const { data, error } = await client.from('home_config').select('config').eq('id', 'home').single();
  if (error) return null;
  return (data?.config as HomeConfig) ?? null;
}

export async function saveHomeConfig(config: HomeConfig): Promise<void> {
  const client = getSupabaseClient();
  const { error } = await client.from('home_config').upsert(
    { id: 'home', config, updated_at: Date.now() },
    { onConflict: 'id' }
  );
  if (error) throw new Error(`保存首页配置失败: ${error.message}`);
}
