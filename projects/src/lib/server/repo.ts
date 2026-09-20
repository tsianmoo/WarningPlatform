import { getSupabaseClient } from '@/storage/database/supabase-client';
import type { AlertRule, AlertStatus, AlertTask, AttrCategory, DataTable, DataTableGroup, Dealer, Employee, HomeConfig, HrAttribute, Organization, Person, RuleGroup, Store } from '@/lib/types';

// 时间戳强制整型（毫秒），避免浮点值写入 bigint 列失败导致整批同步中断
const ts = (v?: number | null, fb = Date.now()) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.floor(n) : fb;
};

// Supabase-js select 单次默认最多返回 1000 行，需按 range 分页取全量，否则超千行会被静默截断、
// 再经全量同步把库中超出的行当 stale 删掉（真丢数据）。
async function selectAllRows<T>(
  client: ReturnType<typeof getSupabaseClient>,
  table: string,
  orders: ReadonlyArray<[string, boolean]>, // [column, ascending]
  limit = 1000,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += limit) {
    let q = client.from(table).select('*').range(from, from + limit - 1);
    for (const [col, asc] of orders) q = q.order(col, { ascending: asc });
    const { data, error } = await q;
    if (error) throw new Error(`读取${table}失败: ${error.message}`);
    const batch = (data ?? []) as T[];
    rows.push(...batch);
    if (batch.length < limit) break;
  }
  return rows;
}

async function selectAllIds(client: ReturnType<typeof getSupabaseClient>, table: string, limit = 1000): Promise<string[]> {
  const rows: string[] = [];
  for (let from = 0; ; from += limit) {
    const { data, error } = await client.from(table).select('id').range(from, from + limit - 1);
    if (error) throw new Error(`读取${table}的ID失败: ${error.message}`);
    const batch = (data as { id: string }[] | null) ?? [];
    rows.push(...batch.map((r) => r.id));
    if (batch.length < limit) break;
  }
  return rows;
}

// 库中存在但本次提交集合里没有的行 = 待删除的 stale（分页取全量 id 后再差集，避免超千行误删）
async function computeStale(client: ReturnType<typeof getSupabaseClient>, table: string, keep: Set<string>): Promise<string[]> {
  const existing = await selectAllIds(client, table);
  return existing.filter((id) => !keep.has(id));
}

interface TableRow {
  id: string;
  name: string;
  file_name: string;
  row_count: number;
  created_at: number;
  data: DataTable;
  updated_at?: string;
}

type TableDataRow = Record<string, string | number | boolean> | Record<string, unknown>;

/** 剥离全量 rows（含 prev 快照里的 rows），只保留元数据，避免单 jsonb 超限 */
function stripRows(t: DataTable): DataTable {
  const { rows: _rows, prev, ...meta } = t;
  const next: DataTable = { ...meta };
  if (prev) next.prev = { ...prev, rows: undefined };
  return next;
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
  accepted_at: number | null;
  started_at: number | null;
  handled_at: number | null;
  resolution: string | null;
  failed_reason: string | null;
  plan: string | null;
  comments: Array<{ id: string; by: string; text: string; at: number; replies?: Array<{ id: string; by: string; text: string; at: number }> }> | null;
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
    acceptedAt: r.accepted_at ?? undefined,
    startedAt: r.started_at ?? undefined,
    handledAt: r.handled_at ?? undefined,
    resolution: r.resolution ?? undefined,
    failedReason: r.failed_reason ?? undefined,
    plan: r.plan ?? undefined,
    comments: r.comments ?? undefined,
    createdAt: r.created_at ?? Date.now(),
    updatedAt: r.updated_at ?? Date.now(),
  };
}

/** 读取全部预警（按创建时间倒序） */
export async function getAllAlerts(): Promise<AlertTask[]> {
  const client = getSupabaseClient();
  const rows = await selectAllRows<AlertRow>(client, 'alert_tasks', [['created_at', false]]);
  return rows.map(toAlertTask);
}

/** 全量覆盖式保存预警（以入参为准，删除库中多余的预警） */
export async function syncAlerts(alerts: AlertTask[], opts?: { clearAll?: boolean }): Promise<void> {
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
    accepted_at: a.acceptedAt ?? null,
    started_at: a.startedAt ?? null,
    handled_at: a.handledAt ?? null,
    resolution: a.resolution ?? null,
    failed_reason: a.failedReason ?? null,
    plan: a.plan ?? null,
    comments: a.comments ?? null,
    created_at: ts(a.createdAt),
    updated_at: ts(a.updatedAt),
  }));

  if (rows.length > 0) {
    const { error } = await client.from('alert_tasks').upsert(rows, { onConflict: 'id' });
    if (error) throw new Error(`保存预警失败: ${error.message}`);
  } else if (opts?.clearAll) {
    // 用户在主界面主动「清空全部」，删除库中所有预警
    const { error: delErr } = await client.from('alert_tasks').delete().neq('id', '');
    if (delErr) throw new Error(`清空预警失败: ${delErr.message}`);
    return;
  } else {
    // 本次提交为空集合时不清空库中已有预警，避免前端某次空同步误删全部业务预警
    return;
  }

  const keep = new Set(rows.map((r) => r.id));
  const staleIds = await computeStale(client, 'alert_tasks', keep);
  if (staleIds.length > 0) {
    const { error: delErr } = await client.from('alert_tasks').delete().in('id', staleIds);
    if (delErr) throw new Error(`删除预警失败: ${delErr.message}`);
  }
}

/** 读取所有数据表（按创建时间升序）。返回的元数据剥离全量 rows（rows 存 data_tables_row）。
 *  首次遇到旧格式（data.rows 仍在元数据里且行表未迁移）时自动迁移到行表，保证存量数据不丢。 */
export async function getAllTables(): Promise<DataTable[]> {
  const client = getSupabaseClient();
  const rows = await selectAllRows<TableRow>(client, 'data_tables', [['created_at', true]]);
  const out: DataTable[] = [];
  for (const r of rows) {
    const t = r.data as DataTable;
    const legacyRows = t.rows as unknown as TableDataRow[] | undefined;
    if (!(await hasTableRows(t.id)) && Array.isArray(legacyRows) && legacyRows.length > 0) {
      await replaceTableRows(t.id, legacyRows);
    }
    out.push(stripRows(t));
  }
  return out;
}

/** 全量覆盖式保存数据表（以入参为准，删除库中多余的表） */
export async function syncTables(tables: DataTable[]): Promise<void> {
  const client = getSupabaseClient();
  const rows = tables.map((t) => ({
    id: t.id,
    name: t.name,
    file_name: t.fileName ?? '',
    row_count: t.rowCount ?? 0,
    created_at: ts(t.createdAt),
    data: stripRows(t),
  }));

  if (rows.length > 0) {
    // 逐表 upsert：元数据已剥离全量 rows（rows 走 data_tables_row），单请求体积可控
    for (const r of rows) {
      const { error } = await client.from('data_tables').upsert([r], { onConflict: 'id' });
      if (error) throw new Error(`保存数据表失败: ${error.message}`);
    }
  }

  // 删除已被前端移除的表（并同步清理其行数据）
  const keep = new Set(tables.map((t) => t.id));
  const staleIds = await computeStale(client, 'data_tables', keep);
  for (const id of staleIds) {
    const [delMeta, delRows] = await Promise.all([
      client.from('data_tables').delete().eq('id', id),
      client.from('data_tables_row').delete().eq('id', id),
    ]);
    if (delMeta.error) throw new Error(`删除数据表失败: ${delMeta.error.message}`);
    if (delRows.error) throw new Error(`删除数据表行失败: ${delRows.error.message}`);
  }
}

const ROW_BATCH = 500;

/** 覆盖式保存某表全量行：清空旧行后按批写入 data_tables_row（一行一个 jsonb，规避单 jsonb 超限） */
export async function replaceTableRows(tableId: string, rows: TableDataRow[]): Promise<void> {
  const client = getSupabaseClient();
  await client.from('data_tables_row').delete().eq('id', tableId);
  for (let from = 0; from < rows.length; from += ROW_BATCH) {
    const chunk = rows.slice(from, from + ROW_BATCH).map((r, i) => ({ id: tableId, seq: from + i, data: r }));
    const { error } = await client.from('data_tables_row').insert(chunk);
    if (error) throw new Error(`保存数据表行失败(${tableId} @${from}): ${error.message}`);
  }
}

/** 读取某表全量行（按 seq 升序，分页取全量，避免超千行截断） */
export async function getAllTableRows(tableId: string): Promise<TableDataRow[]> {
  const client = getSupabaseClient();
  const out: TableDataRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await client
      .from('data_tables_row')
      .select('seq,data')
      .eq('id', tableId)
      .order('seq', { ascending: true })
      .range(from, from + 999);
    if (error) throw new Error(`读取数据表行失败: ${error.message}`);
    const batch = (data ?? []) as { seq: number; data: TableDataRow }[];
    out.push(...batch.map((r) => r.data));
    if (batch.length < 1000) break;
  }
  return out;
}

/** 某表是否已存在行数据（用于判断旧格式 rows 是否需要迁移） */
async function hasTableRows(tableId: string): Promise<boolean> {
  const client = getSupabaseClient();
  const { data, error } = await client.from('data_tables_row').select('seq').eq('id', tableId).limit(1);
  if (error) throw new Error(`校验数据表行失败: ${error.message}`);
  return Array.isArray(data) && data.length > 0;
}

/** 读取所有规则 */
export async function getAllRules(): Promise<AlertRule[]> {
  const client = getSupabaseClient();
  const rows = await selectAllRows<RuleRow>(client, 'alert_rules', [['created_at', true]]);
  return rows.map((r) => r.data as AlertRule);
}

/** 全量覆盖式保存规则 */
export async function syncRules(rules: AlertRule[]): Promise<void> {
  const client = getSupabaseClient();
  const rows = rules.map((r) => ({
    id: r.id,
    name: r.name,
    status: r.status,
    created_at: ts(r.createdAt),
    updated_at_ms: r.updatedAt ?? Date.now(),
    data: r,
  }));

  if (rows.length > 0) {
    const { error } = await client.from('alert_rules').upsert(rows, { onConflict: 'id' });
    if (error) throw new Error(`保存规则失败: ${error.message}`);
  }

  const keep = new Set(rules.map((r) => r.id));
  const staleIds = await computeStale(client, 'alert_rules', keep);
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
  const rows = await selectAllRows<RuleGroupRow>(client, 'rule_groups', [['created_at', true]]);
  return rows.map(toRuleGroup);
}

export async function syncRuleGroups(groups: RuleGroup[]): Promise<void> {
  const client = getSupabaseClient();
  const rows = groups.map((g) => ({
    id: g.id,
    name: g.name,
    created_at: ts(g.createdAt),
  }));
  if (rows.length > 0) {
    const { error } = await client.from('rule_groups').upsert(rows, { onConflict: 'id' });
    if (error) throw new Error(`保存分组失败: ${error.message}`);
  }
  const keep = new Set(groups.map((g) => g.id));
  const staleIds = await computeStale(client, 'rule_groups', keep);
  if (staleIds.length > 0) {
    const { error: delErr } = await client.from('rule_groups').delete().in('id', staleIds);
    if (delErr) throw new Error(`删除分组失败: ${delErr.message}`);
  }
}

/** 读取所有数据表分组 */
export async function getAllTableGroups(): Promise<DataTableGroup[]> {
  const client = getSupabaseClient();
  const rows = await selectAllRows<{ id: string; name: string; created_at: number }>(client, 'table_groups', [['created_at', true]]);
  return rows.map((g) => ({ id: g.id, name: g.name, createdAt: g.created_at ?? Date.now() }));
}

/** 全量覆盖式保存数据表分组 */
export async function syncTableGroups(groups: DataTableGroup[]): Promise<void> {
  const client = getSupabaseClient();
  const rows = groups.map((g) => ({ id: g.id, name: g.name, created_at: ts(g.createdAt) }));
  if (rows.length > 0) {
    const { error } = await client.from('table_groups').upsert(rows, { onConflict: 'id' });
    if (error) throw new Error(`保存数据表分组失败: ${error.message}`);
  }
  const keep = new Set(groups.map((g) => g.id));
  const staleIds = await computeStale(client, 'table_groups', keep);
  if (staleIds.length > 0) {
    const { error: delErr } = await client.from('table_groups').delete().in('id', staleIds);
    if (delErr) throw new Error(`删除数据表分组失败: ${delErr.message}`);
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
  const rows = await selectAllRows<OrgRow>(client, 'organizations', [['sort', true], ['created_at', true]]);
  return rows.map(toOrg);
}

export async function syncOrganizations(orgs: Organization[]): Promise<void> {
  const client = getSupabaseClient();
  const rows = orgs.map((o) => ({
    id: o.id,
    name: o.name,
    kind: o.kind,
    parent_id: o.parentId ?? null,
    sort: o.sort ?? 0,
    created_at: ts(o.createdAt),
  }));
  if (rows.length > 0) {
    const { error } = await client.from('organizations').upsert(rows, { onConflict: 'id' });
    if (error) throw new Error(`保存组织架构失败: ${error.message}`);
    const keep = new Set(orgs.map((o) => o.id));
    const staleIds = await computeStale(client, 'organizations', keep);
    if (staleIds.length > 0) {
      const { error: delErr } = await client.from('organizations').delete().in('id', staleIds);
      if (delErr) throw new Error(`删除组织失败: ${delErr.message}`);
    }
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
  const rows = await selectAllRows<PersonRow>(client, 'persons', [['sort', true], ['created_at', true]]);
  return rows.map(toPerson);
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
    created_at: ts(p.createdAt),
  }));
  if (rows.length > 0) {
    const { error } = await client.from('persons').upsert(rows, { onConflict: 'id' });
    if (error) throw new Error(`保存人事架构失败: ${error.message}`);
    const keep = new Set(persons.map((p) => p.id));
    const staleIds = await computeStale(client, 'persons', keep);
    if (staleIds.length > 0) {
      const { error: delErr } = await client.from('persons').delete().in('id', staleIds);
      if (delErr) throw new Error(`删除人员失败: ${delErr.message}`);
    }
  }
}

export async function getAllHrAttributes(): Promise<HrAttribute[]> {
  const client = getSupabaseClient();
  const rows = await selectAllRows<HrAttribute>(client, 'hr_attributes', [['sort', true]]);
  return rows.map((a) => ({
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
    created_at: ts(a.createdAt),
  }));
  if (rows.length > 0) {
    const { error } = await client.from('hr_attributes').upsert(rows, { onConflict: 'id' });
    if (error) throw new Error(`保存人事属性失败: ${error.message}`);
    const keep = new Set(attributes.map((a) => a.id));
    const staleIds = await computeStale(client, 'hr_attributes', keep);
    if (staleIds.length > 0) {
      const { error: delErr } = await client.from('hr_attributes').delete().in('id', staleIds);
      if (delErr) throw new Error(`删除属性失败: ${delErr.message}`);
    }
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
  dealer_id?: string | null;
  store_id?: string | null;
  post?: string | null;
  on_duty?: boolean | null;
  brand?: string | null;
  company?: string | null;
  department?: string | null;
  sales_area?: string | null;
  district?: string | null;
  allow_retail?: boolean | null;
  province?: string | null;
  city?: string | null;
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
    province: r.province ?? undefined,
    city: r.city ?? undefined,
    district: r.district ?? undefined,
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
    dealerId: r.dealer_id ?? undefined,
    brand: r.brand ?? undefined,
    company: r.company ?? undefined,
    department: r.department ?? undefined,
    salesArea: r.sales_area ?? undefined,
    district: r.district ?? undefined,
    allowRetail: r.allow_retail ?? undefined,
  };
}

export async function getAllDealers(): Promise<Dealer[]> {
  const client = getSupabaseClient();
  const rows = await selectAllRows<DictRow>(client, 'dealers', [['sort', true]]);
  return rows.map(toDealer);
}

export async function syncDealers(dealers: Dealer[]): Promise<void> {
  const client = getSupabaseClient();
  const rows = dealers.map((d) => ({
    id: d.id,
    name: d.name,
    sort: d.sort ?? 0,
    created_at: ts(d.createdAt),
    code: d.code ?? null,
    contact: d.contact ?? null,
    phone: d.phone ?? null,
    address: d.address ?? null,
    password: d.password ?? null,
    birthday: d.birthday ?? null,
    enabled: d.enabled ?? true,
    attrs: d.attrs ?? null,
    province: d.province ?? null,
    city: d.city ?? null,
    district: d.district ?? null,
  }));
  if (rows.length > 0) {
    const { error } = await client.from('dealers').upsert(rows, { onConflict: 'id' });
    if (error) throw new Error(`保存经销商失败: ${error.message}`);
    const keep = new Set(dealers.map((d) => d.id));
    const staleIds = await computeStale(client, 'dealers', keep);
    if (staleIds.length > 0) {
      const { error: delErr } = await client.from('dealers').delete().in('id', staleIds);
      if (delErr) throw new Error(`删除经销商失败: ${delErr.message}`);
    }
  }
}

export async function getAllStores(): Promise<Store[]> {
  const client = getSupabaseClient();
  const rows = await selectAllRows<DictRow>(client, 'stores', [['sort', true]]);
  return rows.map(toStore);
}

export async function syncStores(stores: Store[]): Promise<void> {
  const client = getSupabaseClient();
  const rows = stores.map((s) => ({
    id: s.id,
    name: s.name,
    sort: s.sort ?? 0,
    created_at: ts(s.createdAt),
    code: s.code ?? null,
    contact: s.contact ?? null,
    phone: s.phone ?? null,
    address: s.address ?? null,
    password: s.password ?? null,
    birthday: s.birthday ?? null,
    enabled: s.enabled ?? true,
    attrs: s.attrs ?? null,
    dealer_id: s.dealerId ?? null,
    brand: s.brand ?? null,
    company: s.company ?? null,
    department: s.department ?? null,
    sales_area: s.salesArea ?? null,
    district: s.district ?? null,
    allow_retail: s.allowRetail ?? null,
  }));
  if (rows.length > 0) {
    const { error } = await client.from('stores').upsert(rows, { onConflict: 'id' });
    if (error) throw new Error(`保存店仓失败: ${error.message}`);
  }
  if (rows.length > 0) {
    const keep = new Set(stores.map((s) => s.id));
    const staleIds = await computeStale(client, 'stores', keep);
    if (staleIds.length > 0) {
      const { error: delErr } = await client.from('stores').delete().in('id', staleIds);
      if (delErr) throw new Error(`删除店仓失败: ${delErr.message}`);
    }
  }
}

function toEmployee(r: DictRow): Employee {
  return {
    id: r.id,
    code: r.code ?? undefined,
    name: r.name ?? '',
    dealerId: r.dealer_id ?? undefined,
    storeId: r.store_id ?? undefined,
    post: r.post ?? undefined,
    onDuty: r.on_duty ?? true,
    enabled: r.enabled ?? true,
    password: r.password ?? undefined,
    attrs: r.attrs ?? undefined,
    sort: r.sort ?? 0,
    createdAt: r.created_at ?? 0,
  };
}

export async function getAllEmployees(): Promise<Employee[]> {
  const client = getSupabaseClient();
  const rows = await selectAllRows<DictRow>(client, 'employees', [['sort', true]]);
  return rows.map(toEmployee);
}

export async function syncEmployees(employees: Employee[]): Promise<void> {
  const client = getSupabaseClient();
  const rows = employees.map((e) => ({
    id: e.id,
    code: e.code ?? null,
    name: e.name ?? '',
    dealer_id: e.dealerId ?? null,
    store_id: e.storeId ?? null,
    post: e.post ?? null,
    on_duty: e.onDuty ?? true,
    enabled: e.enabled ?? true,
    password: e.password ?? null,
    attrs: e.attrs ?? null,
    sort: e.sort ?? 0,
    created_at: ts(e.createdAt, 0),
  }));
  if (rows.length > 0) {
    const { error } = await client.from('employees').upsert(rows, { onConflict: 'id' });
    if (error) throw new Error(`保存员工失败: ${error.message}`);
    const keep = new Set(employees.map((e) => e.id));
    const staleIds = await computeStale(client, 'employees', keep);
    if (staleIds.length > 0) {
      const { error: delErr } = await client.from('employees').delete().in('id', staleIds);
      if (delErr) throw new Error(`删除员工失败: ${delErr.message}`);
    }
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
    { id: 'home', config, updated_at: ts(undefined, Date.now()) },
    { onConflict: 'id' }
  );
  if (error) throw new Error(`保存首页配置失败: ${error.message}`);
}
