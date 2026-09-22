import type { PoolClient } from 'pg';
import {
  query,
  queryOne,
  execute,
  withTransaction,
  asArray,
  asObject,
  toMs,
  toMsOrNull,
  msToTs,
} from '@/storage/database/db';
import { hashPassword, DEFAULT_INITIAL_PASSWORD } from '@/lib/server/auth';
import type {
  AlertRule,
  AlertStatus,
  AlertTask,
  AlertComment,
  AttrCategory,
  DataTable,
  DataTableGroup,
  Dealer,
  Employee,
  ExecutionRecord,
  HomeConfig,
  HrAttribute,
  Organization,
  Person,
  PersonPermOverride,
  RolePerm,
  RuleGroup,
  Schedule,
  Store,
} from '@/lib/types';

/**
 * 数据访问层（重写版）。
 *
 * 与旧版 repo.ts 的根本差异：
 *   1. 不再「以入参为准删除库中其余行」。所有 sync* 只做增量 upsert；
 *      删除必须走显式的 delete*，且一律软删除（deleted_at）。
 *      旧版这套 delete-stale 语义是历史「数据莫名消失」的根因。
 *   2. 不再走 Supabase PostgREST（原先还要靠 spawn python 读环境变量），
 *      改用统一的 pg 连接池 + 真实 SQL。
 *   3. 时间统一 timestamptz；与前端毫秒数的换算集中在 db.ts。
 *   4. 权限、留言、状态流转、工单归属门店/经销商全部落成真表；
 *      旧版这些字段要么塞 jsonb、要么根本存不下来。
 */

export type RuleLock = { owner: string; at: number };
export type RuleLockMap = Record<string, RuleLock>;

// ============================================================================
// 通用工具
// ============================================================================

/** 空串转 null，避免外键列被空串污染 */
const nn = (v: unknown): string | null => {
  const s = v === null || v === undefined ? '' : String(v).trim();
  return s === '' ? null : s;
};

/** 批量 upsert。表名与列名均来自本文件字面量，无注入面。 */
async function upsertRows(
  tx: PoolClient,
  table: string,
  columns: string[],
  rows: unknown[][],
  conflictCols: string[],
  chunkSize = 200
): Promise<void> {
  if (rows.length === 0) return;
  const setClause = columns
    .filter((c) => !conflictCols.includes(c))
    .map((c) => `${c}=EXCLUDED.${c}`)
    .join(', ');

  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const params: unknown[] = [];
    const tuples = chunk.map((r) => {
      const ph = r.map((v) => {
        params.push(v);
        return `$${params.length}`;
      });
      return `(${ph.join(', ')})`;
    });
    const sql =
      `INSERT INTO ${table} (${columns.join(', ')}) VALUES ${tuples.join(', ')}` +
      (setClause
        ? ` ON CONFLICT (${conflictCols.join(', ')}) DO UPDATE SET ${setClause}`
        : ` ON CONFLICT DO NOTHING`);
    await tx.query(sql, params as never[]);
  }
}

/** 软删除 */
async function softDelete(tx: PoolClient, table: string, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await tx.query(
    `UPDATE ${table} SET deleted_at = now() WHERE id = ANY($1::text[]) AND deleted_at IS NULL`,
    [ids]
  );
}

/** 写审计日志（旧版业务侧完全空白） */
export async function writeAudit(
  actor: string | null,
  action: string,
  targetType?: string | null,
  targetId?: string | null,
  detail?: unknown,
  ip?: string | null
): Promise<void> {
  try {
    await execute(
      `INSERT INTO audit_log (actor, actor_ip, action, target_type, target_id, detail)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [actor, ip ?? null, action, targetType ?? null, targetId ?? null, detail ? JSON.stringify(detail) : null]
    );
  } catch (err) {
    console.error('[audit] 写入失败:', (err as Error).message);
  }
}

// ============================================================================
// 账号：密码 hash 统一收口到 accounts 表（旧版明文散落在 4 张业务表）
// ============================================================================

interface AccountSeed {
  id: string;
  username: string;
  displayName: string;
  subjectType: 'person' | 'dealer' | 'store' | 'employee';
  subjectId: string;
}

/**
 * 保证业务档案存在对应登录账号。
 * 已存在则只同步展示名与归属，绝不覆盖已设置的密码。
 */
async function ensureAccounts(tx: PoolClient, seeds: AccountSeed[]): Promise<void> {
  const valid = seeds.filter((s) => s.username.trim() !== '');
  if (valid.length === 0) return;

  const idSet = new Set(valid.map((s) => s.id));
  const usernames = Array.from(new Set(valid.map((s) => s.username)));
  const existing = await tx.query<{ id: string; username: string }>(
    `SELECT id, lower(username) AS username FROM accounts
      WHERE lower(username) = ANY($1::text[]) OR id = ANY($2::text[])`,
    [usernames.map((u) => u.toLowerCase()), Array.from(idSet)]
  );
  const takenUsername = new Set(existing.rows.map((r) => r.username));
  const existingId = new Set(existing.rows.map((r) => r.id));

  const inserts: unknown[][] = [];
  const updates: AccountSeed[] = [];

  for (const s of valid) {
    if (takenUsername.has(s.username.toLowerCase())) {
      // 用户名已被占用：只有确认是本实体（id 相同）才更新归属
      if (existingId.has(s.id)) updates.push(s);
      continue;
    }
    if (existingId.has(s.id)) {
      updates.push(s);
      continue;
    }
    inserts.push([
      s.id,
      s.username,
      await hashPassword(DEFAULT_INITIAL_PASSWORD),
      s.displayName,
      s.subjectType,
      s.subjectId,
      true, // must_change_password：初始密码首次登录必须修改
      true,
    ]);
  }

  if (inserts.length > 0) {
    await upsertRows(
      tx,
      'accounts',
      ['id', 'username', 'password_hash', 'display_name', 'subject_type', 'subject_id',
       'must_change_password', 'enabled'],
      inserts,
      ['id']
    );
  }
  for (const s of updates) {
    await tx.query(
      `UPDATE accounts SET display_name = $2, subject_type = $3, subject_id = $4 WHERE id = $1`,
      [s.id, s.displayName, s.subjectType, s.subjectId]
    );
  }
}

/** 停用某类主体名下所有账号 */
async function disableAccounts(tx: PoolClient, subjectType: string, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await tx.query(
    `UPDATE accounts SET enabled = false WHERE subject_type = $1 AND subject_id = ANY($2::text[])`,
    [subjectType, ids]
  );
}

// ============================================================================
// 组织架构
// ============================================================================

interface OrgRow {
  id: string;
  name: string;
  kind: string;
  parent_id: string | null;
  sort: number | string;
  created_at: Date | string;
}

const toOrg = (r: OrgRow): Organization => ({
  id: r.id,
  name: r.name,
  kind: (r.kind as Organization['kind']) ?? '其他',
  parentId: r.parent_id ?? undefined,
  sort: Number(r.sort ?? 0),
  createdAt: toMs(r.created_at),
});

export async function getAllOrganizations(): Promise<Organization[]> {
  const rows = await query<OrgRow>(
    `SELECT id, name, kind, parent_id, sort, created_at
       FROM organizations WHERE deleted_at IS NULL ORDER BY sort, created_at`
  );
  return rows.map(toOrg);
}

export async function syncOrganizations(orgs: Organization[]): Promise<void> {
  await withTransaction((tx) =>
    upsertRows(
      tx,
      'organizations',
      ['id', 'name', 'kind', 'parent_id', 'sort', 'deleted_at'],
      orgs.map((o) => [o.id, o.name, o.kind ?? '其他', nn(o.parentId), Number(o.sort ?? 0), null]),
      ['id']
    )
  );
}

export async function deleteOrganizations(ids: string[]): Promise<void> {
  await withTransaction((tx) => softDelete(tx, 'organizations', ids));
}

// ============================================================================
// 经销商
// ============================================================================

interface DealerRow {
  id: string;
  name: string;
  code: string | null;
  contact: string | null;
  phone: string | null;
  address: string | null;
  birthday: string | null;
  enabled: boolean;
  attrs: unknown;
  province: string | null;
  city: string | null;
  district: string | null;
  sort: number | string;
  created_at: Date | string;
}

const toDealer = (r: DealerRow): Dealer => ({
  id: r.id,
  name: r.name,
  code: r.code ?? undefined,
  contact: r.contact ?? undefined,
  phone: r.phone ?? undefined,
  address: r.address ?? undefined,
  birthday: r.birthday ?? undefined,
  enabled: r.enabled ?? true,
  attrs: asObject<Record<string, string>>(r.attrs, {}),
  province: r.province ?? undefined,
  city: r.city ?? undefined,
  district: r.district ?? undefined,
  sort: Number(r.sort ?? 0),
  createdAt: toMs(r.created_at),
});

const DEALER_COLS = [
  'id', 'name', 'code', 'contact', 'phone', 'address', 'birthday', 'enabled', 'attrs',
  'province', 'city', 'district', 'sort', 'deleted_at',
];

const dealerValues = (d: Dealer): unknown[] => [
  d.id, d.name, nn(d.code), nn(d.contact), nn(d.phone), nn(d.address), nn(d.birthday),
  d.enabled ?? true, JSON.stringify(d.attrs ?? {}), nn(d.province), nn(d.city), nn(d.district),
  Number(d.sort ?? 0), null,
];

export async function getAllDealers(): Promise<Dealer[]> {
  const rows = await query<DealerRow>(
    `SELECT id, name, code, contact, phone, address, birthday, enabled, attrs,
            province, city, district, sort, created_at
       FROM dealers WHERE deleted_at IS NULL ORDER BY sort, created_at`
  );
  return rows.map(toDealer);
}

export async function syncDealers(dealers: Dealer[]): Promise<void> {
  await withTransaction(async (tx) => {
    await upsertRows(tx, 'dealers', DEALER_COLS, dealers.map(dealerValues), ['id']);
    await ensureAccounts(
      tx,
      dealers.filter((d) => nn(d.code)).map((d) => ({
        id: `acct_dealer_${d.id}`,
        username: String(d.code),
        displayName: d.name,
        subjectType: 'dealer' as const,
        subjectId: d.id,
      }))
    );
  });
}

export async function deleteDealers(ids: string[]): Promise<void> {
  await withTransaction(async (tx) => {
    await softDelete(tx, 'dealers', ids);
    await tx.query(`UPDATE stores SET dealer_id = NULL WHERE dealer_id = ANY($1::text[])`, [ids]);
    await tx.query(`UPDATE employees SET dealer_id = NULL WHERE dealer_id = ANY($1::text[])`, [ids]);
    await tx.query(`UPDATE persons SET dealer_id = NULL WHERE dealer_id = ANY($1::text[])`, [ids]);
    await disableAccounts(tx, 'dealer', ids);
  });
}

// ============================================================================
// 店仓
// ============================================================================

interface StoreRow extends Omit<DealerRow, 'province' | 'city'> {
  dealer_id: string | null;
  brand: string | null;
  company: string | null;
  department: string | null;
  sales_area: string | null;
  allow_retail: boolean;
}

const toStore = (r: StoreRow): Store => ({
  id: r.id,
  name: r.name,
  code: r.code ?? undefined,
  contact: r.contact ?? undefined,
  phone: r.phone ?? undefined,
  address: r.address ?? undefined,
  birthday: r.birthday ?? undefined,
  enabled: r.enabled ?? true,
  attrs: asObject<Record<string, string>>(r.attrs, {}),
  dealerId: r.dealer_id ?? undefined,
  brand: r.brand ?? undefined,
  company: r.company ?? undefined,
  department: r.department ?? undefined,
  salesArea: r.sales_area ?? undefined,
  district: r.district ?? undefined,
  allowRetail: r.allow_retail ?? false,
  sort: Number(r.sort ?? 0),
  createdAt: toMs(r.created_at),
});

const STORE_COLS = [
  'id', 'name', 'code', 'contact', 'phone', 'address', 'birthday', 'enabled', 'attrs',
  'dealer_id', 'brand', 'company', 'department', 'sales_area', 'district', 'allow_retail',
  'sort', 'deleted_at',
];

const storeValues = (s: Store): unknown[] => [
  s.id, s.name, nn(s.code), nn(s.contact), nn(s.phone), nn(s.address), nn(s.birthday),
  s.enabled ?? true, JSON.stringify(s.attrs ?? {}), nn(s.dealerId), nn(s.brand), nn(s.company),
  nn(s.department), nn(s.salesArea), nn(s.district), s.allowRetail ?? false,
  Number(s.sort ?? 0), null,
];

export async function getAllStores(): Promise<Store[]> {
  const rows = await query<StoreRow>(
    `SELECT id, name, code, contact, phone, address, birthday, enabled, attrs,
            dealer_id, brand, company, department, sales_area, district, allow_retail,
            sort, created_at
       FROM stores WHERE deleted_at IS NULL ORDER BY sort, created_at`
  );
  return rows.map(toStore);
}

export async function syncStores(stores: Store[]): Promise<void> {
  await withTransaction(async (tx) => {
    await upsertRows(tx, 'stores', STORE_COLS, stores.map(storeValues), ['id']);
    await ensureAccounts(
      tx,
      stores.filter((s) => nn(s.code)).map((s) => ({
        id: `acct_store_${s.id}`,
        username: String(s.code),
        displayName: s.name,
        subjectType: 'store' as const,
        subjectId: s.id,
      }))
    );
  });
}

export async function deleteStores(ids: string[]): Promise<void> {
  await withTransaction(async (tx) => {
    await softDelete(tx, 'stores', ids);
    await tx.query(`UPDATE employees SET store_id = NULL WHERE store_id = ANY($1::text[])`, [ids]);
    await tx.query(`UPDATE persons SET store_id = NULL WHERE store_id = ANY($1::text[])`, [ids]);
    await disableAccounts(tx, 'store', ids);
  });
}

// ============================================================================
// 员工
// ============================================================================

interface EmployeeRow {
  id: string;
  code: string | null;
  name: string;
  dealer_id: string | null;
  store_id: string | null;
  post: string | null;
  on_duty: boolean;
  enabled: boolean;
  attrs: unknown;
  sort: number | string;
  created_at: Date | string;
}

const toEmployee = (r: EmployeeRow): Employee => ({
  id: r.id,
  code: r.code ?? undefined,
  name: r.name,
  dealerId: r.dealer_id ?? undefined,
  storeId: r.store_id ?? undefined,
  post: r.post ?? undefined,
  onDuty: r.on_duty ?? true,
  enabled: r.enabled ?? true,
  attrs: asObject<Record<string, string>>(r.attrs, {}),
  sort: Number(r.sort ?? 0),
  createdAt: toMs(r.created_at),
});

const EMPLOYEE_COLS = [
  'id', 'code', 'name', 'dealer_id', 'store_id', 'post',
  'on_duty', 'enabled', 'attrs', 'sort', 'deleted_at',
];

const employeeValues = (e: Employee): unknown[] => [
  e.id, nn(e.code), e.name, nn(e.dealerId), nn(e.storeId), nn(e.post),
  e.onDuty ?? true, e.enabled ?? true, JSON.stringify(e.attrs ?? {}), Number(e.sort ?? 0), null,
];

export async function getAllEmployees(): Promise<Employee[]> {
  const rows = await query<EmployeeRow>(
    `SELECT id, code, name, dealer_id, store_id, post, on_duty, enabled, attrs, sort, created_at
       FROM employees WHERE deleted_at IS NULL ORDER BY sort, created_at`
  );
  return rows.map(toEmployee);
}

export async function syncEmployees(employees: Employee[]): Promise<void> {
  await withTransaction(async (tx) => {
    await upsertRows(tx, 'employees', EMPLOYEE_COLS, employees.map(employeeValues), ['id']);
    await ensureAccounts(
      tx,
      employees.filter((e) => nn(e.code)).map((e) => ({
        id: `acct_employee_${e.id}`,
        username: String(e.code),
        displayName: e.name,
        subjectType: 'employee' as const,
        subjectId: e.id,
      }))
    );
  });
}

export async function deleteEmployees(ids: string[]): Promise<void> {
  await withTransaction(async (tx) => {
    await softDelete(tx, 'employees', ids);
    await disableAccounts(tx, 'employee', ids);
  });
}

// ============================================================================
// 人员
// ============================================================================

interface PersonRow {
  id: string;
  name: string;
  org_id: string | null;
  title: string | null;
  post: string | null;
  supervisor_id: string | null;
  phone: string | null;
  email: string | null;
  username: string | null;
  id_card: string | null;
  address: string | null;
  birthday: string | null;
  dealer_id: string | null;
  store_id: string | null;
  enabled: boolean;
  sort: number | string;
  created_at: Date | string;
  scope_data: unknown;
}

const toPerson = (r: PersonRow): Person => {
  const scope = asObject<Person['manageScope'] | null>(r.scope_data, null);
  const hasScope =
    !!scope && (!!scope.tableId || !!scope.field || (scope.filters?.length ?? 0) > 0 ||
      (scope.storeIds?.length ?? 0) > 0 || !!scope.storeAttrName || !!scope.desc);
  return {
    id: r.id,
    name: r.name,
    orgId: r.org_id ?? '',
    title: r.title ?? undefined,
    post: r.post ?? undefined,
    supervisorId: r.supervisor_id ?? undefined,
    phone: r.phone ?? undefined,
    email: r.email ?? undefined,
    username: r.username ?? undefined,
    idCard: r.id_card ?? undefined,
    address: r.address ?? undefined,
    birthday: r.birthday ?? undefined,
    dealerId: r.dealer_id ?? undefined,
    storeId: r.store_id ?? undefined,
    enabled: r.enabled ?? true,
    sort: Number(r.sort ?? 0),
    createdAt: toMs(r.created_at),
    manageScope: hasScope ? (scope as Person['manageScope']) : undefined,
  };
};

const PERSON_COLS = [
  'id', 'name', 'org_id', 'title', 'post', 'supervisor_id', 'phone', 'email',
  'username', 'id_card', 'address', 'birthday', 'dealer_id', 'store_id',
  'enabled', 'sort', 'deleted_at',
];

const personValues = (p: Person): unknown[] => [
  p.id, p.name, nn(p.orgId), nn(p.title), nn(p.post), nn(p.supervisorId), nn(p.phone),
  nn(p.email), nn(p.username), nn(p.idCard), nn(p.address), nn(p.birthday),
  nn(p.dealerId), nn(p.storeId), p.enabled ?? true, Number(p.sort ?? 0), null,
];

export async function getAllPersons(): Promise<Person[]> {
  const rows = await query<PersonRow>(
    `SELECT p.id, p.name, p.org_id, p.title, p.post, p.supervisor_id, p.phone, p.email,
            p.username, p.id_card, p.address, p.birthday, p.dealer_id, p.store_id,
            p.enabled, p.sort, p.created_at,
            s.data AS scope_data
       FROM persons p
       LEFT JOIN person_data_scopes s ON s.person_id = p.id
      WHERE p.deleted_at IS NULL
      ORDER BY p.sort, p.created_at`
  );
  return rows.map(toPerson);
}

export async function syncPersons(persons: Person[]): Promise<void> {
  await withTransaction(async (tx) => {
    await upsertRows(tx, 'persons', PERSON_COLS, persons.map(personValues), ['id']);

    // 管理范围由本人独占，replacement 语义安全
    const withScope = persons.filter((p) => p.manageScope);
    const withoutScope = persons.filter((p) => !p.manageScope).map((p) => p.id);
    if (withScope.length > 0) {
      await upsertRows(
        tx,
        'person_data_scopes',
        ['person_id', 'table_id', 'filters', 'store_ids', 'description', 'data'],
        withScope.map((p) => [
          p.id,
          nn(p.manageScope?.tableId),
          JSON.stringify(p.manageScope?.filters ?? []),
          p.manageScope?.storeIds ?? [],
          nn(p.manageScope?.desc),
          JSON.stringify(p.manageScope ?? {}),
        ]),
        ['person_id']
      );
    }
    if (withoutScope.length > 0) {
      await tx.query(`DELETE FROM person_data_scopes WHERE person_id = ANY($1::text[])`, [withoutScope]);
    }

    await ensureAccounts(
      tx,
      persons.map((p) => ({
        id: `acct_person_${p.id}`,
        username: String(nn(p.username) ?? p.name),
        displayName: p.name,
        subjectType: 'person' as const,
        subjectId: p.id,
      }))
    );
  });
}

export async function deletePersons(ids: string[]): Promise<void> {
  await withTransaction(async (tx) => {
    await softDelete(tx, 'persons', ids);
    await disableAccounts(tx, 'person', ids);
  });
}

// ============================================================================
// 人事属性字典
// ============================================================================

interface HrAttrRow {
  id: string;
  name: string;
  items: unknown;
  category: string;
  sort: number | string;
  created_at: Date | string;
}

const toHrAttr = (r: HrAttrRow): HrAttribute => ({
  id: r.id,
  name: r.name,
  items: asArray<{ id: string; name: string }>(r.items, []),
  category: (r.category ?? 'person') as AttrCategory,
  sort: Number(r.sort ?? 0),
  createdAt: toMs(r.created_at),
});

export async function getAllHrAttributes(): Promise<HrAttribute[]> {
  const rows = await query<HrAttrRow>(
    `SELECT id, name, items, category, sort, created_at
       FROM hr_attributes WHERE deleted_at IS NULL ORDER BY sort, created_at`
  );
  return rows.map(toHrAttr);
}

export async function syncHrAttributes(attributes: HrAttribute[]): Promise<void> {
  await withTransaction((tx) =>
    upsertRows(
      tx,
      'hr_attributes',
      ['id', 'name', 'items', 'category', 'sort', 'deleted_at'],
      attributes.map((a) => [
        a.id, a.name, JSON.stringify(a.items ?? []), a.category ?? 'person', Number(a.sort ?? 0), null,
      ]),
      ['id']
    )
  );
}

export async function deleteHrAttributes(ids: string[]): Promise<void> {
  await withTransaction((tx) => softDelete(tx, 'hr_attributes', ids));
}

// ============================================================================
// 数据表（含行级存储）
// ============================================================================

interface DataTableRow {
  id: string;
  name: string;
  file_name: string;
  row_count: number | string;
  group_id: string | null;
  group_name: string | null;
  fields: unknown;
  preview_rows: unknown;
  relations: unknown;
  prev_snapshot: unknown;
  created_at: Date | string;
}

/** DB 行 → 前端 DataTable。group 由 group_id 关联出的名称回填，UI 无需改动。 */
function toDataTable(r: DataTableRow): DataTable {
  const prev = asObject<DataTable['prev'] | null>(r.prev_snapshot, null);
  return {
    id: r.id,
    name: r.name,
    fileName: r.file_name ?? '',
    createdAt: toMs(r.created_at),
    rowCount: Number(r.row_count ?? 0),
    fields: asArray<DataTable['fields'][number]>(r.fields, []),
    previewRows: asArray<Record<string, string>>(r.preview_rows, []),
    relations: asArray<NonNullable<DataTable['relations']>[number]>(r.relations, []),
    group: r.group_name ?? '',
    ...(prev ? { prev } : {}),
  };
}

export async function getAllTables(): Promise<DataTable[]> {
  const rows = await query<DataTableRow>(
    `SELECT t.id, t.name, t.file_name, t.row_count, t.group_id, g.name AS group_name,
            t.fields, t.preview_rows, t.relations, t.prev_snapshot, t.created_at
       FROM data_tables t
       LEFT JOIN data_table_groups g ON g.id = t.group_id
      WHERE t.deleted_at IS NULL
      ORDER BY t.created_at`
  );
  return rows.map(toDataTable);
}

export async function syncTables(tables: DataTable[]): Promise<void> {
  await withTransaction(async (tx) => {
    // group 在 UI 里是「名称」，这里解析为 group_id（旧版直接存名称字符串，改分组名即断链）
    const names = Array.from(
      new Set(tables.map((t) => (t.group ?? '').trim()).filter((n) => n !== ''))
    );
    const nameToId = new Map<string, string>();
    if (names.length > 0) {
      const found = await tx.query<{ id: string; name: string }>(
        `SELECT id, name FROM data_table_groups WHERE name = ANY($1::text[]) AND deleted_at IS NULL`,
        [names]
      );
      for (const g of found.rows) nameToId.set(g.name, g.id);
    }

    await upsertRows(
      tx,
      'data_tables',
      ['id', 'name', 'file_name', 'row_count', 'group_id', 'fields', 'preview_rows',
       'relations', 'prev_snapshot', 'deleted_at'],
      tables.map((t) => [
        t.id,
        t.name,
        t.fileName ?? '',
        Number(t.rowCount ?? 0),
        nameToId.get((t.group ?? '').trim()) ?? null,
        JSON.stringify(t.fields ?? []),
        JSON.stringify(t.previewRows ?? []),
        JSON.stringify(t.relations ?? []),
        t.prev ? JSON.stringify(t.prev) : null,
        null,
      ]),
      ['id']
    );
  });
}

export async function deleteTables(ids: string[]): Promise<void> {
  await withTransaction((tx) => softDelete(tx, 'data_tables', ids));
}

export async function getAllTableGroups(): Promise<DataTableGroup[]> {
  const rows = await query<{ id: string; name: string; created_at: Date | string }>(
    `SELECT id, name, created_at FROM data_table_groups
      WHERE deleted_at IS NULL ORDER BY sort, created_at`
  );
  return rows.map((g) => ({ id: g.id, name: g.name, createdAt: toMs(g.created_at) }));
}

export async function syncTableGroups(groups: DataTableGroup[]): Promise<void> {
  await withTransaction((tx) =>
    upsertRows(
      tx,
      'data_table_groups',
      ['id', 'name', 'sort', 'deleted_at'],
      groups.map((g, i) => [g.id, g.name, i, null]),
      ['id']
    )
  );
}

export async function deleteTableGroups(ids: string[]): Promise<void> {
  await withTransaction(async (tx) => {
    await softDelete(tx, 'data_table_groups', ids);
    // 组被删后其下数据表置为未分组，避免出现指向已删组的空分组
    await tx.query(`UPDATE data_tables SET group_id = NULL WHERE group_id = ANY($1::text[])`, [ids]);
  });
}

/** 在事务内向表末尾插入一批行（row_index 从 startIdx 起） */
async function insertRowsChunk(
  tx: { query: (sql: string, params?: unknown[]) => Promise<unknown> },
  tableId: string,
  chunk: Record<string, unknown>[],
  startIdx: number
): Promise<void> {
  const CHUNK = 500;
  for (let from = 0; from < chunk.length; from += CHUNK) {
    const part = chunk.slice(from, from + CHUNK);
    const params: unknown[] = [];
    const tuples = part.map((r, i) => {
      params.push(tableId, startIdx + from + i, JSON.stringify(r ?? {}));
      const base = params.length - 2;
      return `($${base}, $${base + 1}, $${base + 2})`;
    });
    await tx.query(
      `INSERT INTO data_table_rows (table_id, row_index, data) VALUES ${tuples.join(', ')}
       ON CONFLICT (table_id, row_index) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
      params as never[]
    );
  }
}

/**
 * 覆盖式保存某表全量行。
 * 修正旧版两个问题：
 *   1. 用事务包裹，删除 + 写入原子完成，并发读不会命中「空表窗口」
 *   2. 先 upsert 再删除多余行（而不是先 DELETE 全表），进一步缩小空窗
 */
export async function replaceTableRows(
  tableId: string,
  rows: Record<string, unknown>[]
): Promise<void> {
  await withTransaction(async (tx) => {
    await insertRowsChunk(tx, tableId, rows, 0);
    await tx.query(`DELETE FROM data_table_rows WHERE table_id = $1 AND row_index >= $2`, [
      tableId,
      rows.length,
    ]);
  });
}

/**
 * 分片上传支持：先清空表（phase=start 时调用），再按偏移量追加行（phase=append 时调用）。
 * 大表（数万行）一次性整包 POST 容易因请求体过大/超时失败，客户端改为分片后由这两个函数承接。
 */
export async function clearTableRows(tableId: string): Promise<void> {
  await execute(`DELETE FROM data_table_rows WHERE table_id = $1`, [tableId]);
}

export async function appendTableRows(
  tableId: string,
  rows: Record<string, unknown>[],
  offset = 0
): Promise<void> {
  await withTransaction(async (tx) => {
    await insertRowsChunk(tx, tableId, rows, offset);
  });
}

export async function getAllTableRows(tableId: string): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  const PAGE = 5000;
  for (let from = 0; ; from += PAGE) {
    const rows = await query<{ data: unknown }>(
      `SELECT data FROM data_table_rows WHERE table_id = $1 ORDER BY row_index LIMIT $2 OFFSET $3`,
      [tableId, PAGE, from]
    );
    for (const r of rows) out.push(asObject<Record<string, unknown>>(r.data, {}));
    if (rows.length < PAGE) break;
  }
  return out;
}

// ============================================================================
// 预警规则
// ============================================================================

interface RuleRow {
  id: string;
  name: string;
  group_id: string | null;
  description: string;
  created_by: string | null;
  status: string;
  table_ids: string[] | null;
  flow: unknown;
  targets: unknown;
  created_at: Date | string;
  updated_at: Date | string;
  schedule_data: unknown;
  execs: unknown;
}

const toExecution = (v: unknown, ruleId: string): ExecutionRecord => {
  const e = asObject<Record<string, unknown>>(v, {});
  return {
    id: String(e.id ?? ''),
    ruleId,
    scheduledAt: e.scheduledAt ? new Date(String(e.scheduledAt)).toISOString() : '',
    triggeredAt: e.triggeredAt ? new Date(String(e.triggeredAt)).toISOString() : '',
    status: (e.status as ExecutionRecord['status']) ?? 'pending',
    completionDesc: (e.completionDesc as string) ?? undefined,
    nextTriggerAt: e.nextTriggerAt ? new Date(String(e.nextTriggerAt)).toISOString() : undefined,
    actionNote: (e.actionNote as string) ?? undefined,
    history: asArray<{ at: string; note: string }>(e.history, []),
  };
};

const toRule = (r: RuleRow): AlertRule => {
  const sched = asObject<Partial<Schedule> | null>(r.schedule_data, null);
  const schedule: Schedule = {
    repeatType: (sched?.repeatType as Schedule['repeatType']) ?? 'daily',
    timeOfDay: sched?.timeOfDay ?? '09:00',
    weekdays: sched?.weekdays ?? [],
    monthDays: sched?.monthDays ?? [],
    customInterval: sched?.customInterval ?? 1,
    startDate: sched?.startDate ?? '',
    endDate: sched?.endDate ?? '',
    nextTriggerAt: sched?.nextTriggerAt ?? '',
  };
  return {
    id: r.id,
    name: r.name,
    groupId: r.group_id ?? undefined,
    description: r.description ?? '',
    createdBy: r.created_by ?? undefined,
    tableIds: r.table_ids ?? [],
    status: (r.status as AlertRule['status']) ?? 'draft',
    createdAt: toMs(r.created_at),
    updatedAt: toMs(r.updated_at),
    flow: asObject<AlertRule['flow']>(r.flow, { nodes: [], edges: [] }),
    schedule,
    targets: asObject<AlertRule['targets']>(r.targets, {
      mode: 'manual', departments: [], personnel: [],
    }),
    executions: asArray<unknown>(r.execs, []).map((e) => toExecution(e, r.id)),
  };
};

export async function getAllRules(): Promise<AlertRule[]> {
  const rows = await query<RuleRow>(
    `SELECT r.id, r.name, r.group_id, r.description, r.created_by, r.status, r.table_ids,
            r.flow, r.targets, r.created_at, r.updated_at,
            jsonb_build_object(
              'repeatType', s.repeat_type,
              'timeOfDay', s.time_of_day,
              'weekdays', to_jsonb(s.weekdays),
              'monthDays', to_jsonb(s.month_days),
              'customInterval', s.custom_interval,
              'startDate', to_char(s.start_date, 'YYYY-MM-DD'),
              'endDate', to_char(s.end_date, 'YYYY-MM-DD'),
              'nextTriggerAt', s.next_trigger_at
            ) AS schedule_data,
            COALESCE((
              SELECT jsonb_agg(jsonb_build_object(
                       'id', e.id,
                       'scheduledAt', e.scheduled_at,
                       'triggeredAt', e.triggered_at,
                       'nextTriggerAt', e.next_trigger_at,
                       'status', e.status,
                       'completionDesc', e.completion_desc,
                       'actionNote', e.action_note,
                       'history', e.history)
                     ORDER BY e.created_at)
                FROM rule_executions e WHERE e.rule_id = r.id
            ), '[]'::jsonb) AS execs
       FROM alert_rules r
       LEFT JOIN rule_schedules s ON s.rule_id = r.id
      WHERE r.deleted_at IS NULL
      ORDER BY r.created_at`
  );
  return rows.map(toRule);
}

/** 增量 upsert 规则（绝不按入参删除其它规则） */
export async function syncRules(rules: AlertRule[]): Promise<void> {
  await withTransaction(async (tx) => {
    await upsertRows(
      tx,
      'alert_rules',
      ['id', 'name', 'group_id', 'description', 'created_by', 'status', 'table_ids',
       'flow', 'targets', 'deleted_at'],
      rules.map((r) => [
        r.id, r.name, nn(r.groupId), r.description ?? '', nn(r.createdBy), r.status ?? 'draft',
        r.tableIds ?? [],
        JSON.stringify(r.flow ?? { nodes: [], edges: [] }),
        JSON.stringify(r.targets ?? {}),
        null,
      ]),
      ['id']
    );

    const withSched = rules.filter((r) => r.schedule);
    if (withSched.length > 0) {
      await upsertRows(
        tx,
        'rule_schedules',
        ['rule_id', 'repeat_type', 'time_of_day', 'weekdays', 'month_days',
         'custom_interval', 'start_date', 'end_date', 'next_trigger_at'],
        withSched.map((r) => [
          r.id,
          r.schedule?.repeatType ?? 'daily',
          nn(r.schedule?.timeOfDay),
          r.schedule?.weekdays ?? [],
          r.schedule?.monthDays ?? [],
          Number(r.schedule?.customInterval ?? 1),
          nn(r.schedule?.startDate),
          nn(r.schedule?.endDate),
          r.schedule?.nextTriggerAt ? new Date(r.schedule.nextTriggerAt) : null,
        ]),
        ['rule_id']
      );
    }

    // 执行记录属于规则自身 → 按规则范围 replacement（只影响本规则，安全）
    for (const r of rules) {
      const execs = r.executions ?? [];
      if (execs.length === 0) continue;
      await upsertRows(
        tx,
        'rule_executions',
        ['id', 'rule_id', 'status', 'scheduled_at', 'triggered_at', 'next_trigger_at',
         'completion_desc', 'action_note', 'history'],
        execs.map((e) => [
          e.id,
          r.id,
          e.status ?? 'pending',
          e.scheduledAt ? new Date(e.scheduledAt) : null,
          e.triggeredAt ? new Date(e.triggeredAt) : null,
          e.nextTriggerAt ? new Date(e.nextTriggerAt) : null,
          nn(e.completionDesc),
          nn(e.actionNote),
          JSON.stringify(e.history ?? []),
        ]),
        ['id']
      );
      await tx.query(`DELETE FROM rule_executions WHERE rule_id = $1 AND id <> ALL($2::text[])`, [
        r.id,
        execs.map((e) => e.id),
      ]);
    }
  });
}

/** 显式删除规则（软删除 + 可选清理其名下工单） */
export async function deleteRules(
  ruleIds: string[],
  opts?: { clearAlerts?: boolean }
): Promise<void> {
  if (ruleIds.length === 0) return;
  await withTransaction(async (tx) => {
    await softDelete(tx, 'alert_rules', ruleIds);
    if (opts?.clearAlerts) {
      await tx.query(
        `UPDATE alert_tasks SET deleted_at = now()
          WHERE rule_id = ANY($1::text[]) AND deleted_at IS NULL`,
        [ruleIds]
      );
    }
  });
}

// ============================================================================
// 规则分组
// ============================================================================

export async function getAllRuleGroups(): Promise<RuleGroup[]> {
  const rows = await query<{ id: string; name: string; created_at: Date | string }>(
    `SELECT id, name, created_at FROM rule_groups WHERE deleted_at IS NULL ORDER BY created_at`
  );
  return rows.map((g) => ({ id: g.id, name: g.name, createdAt: toMs(g.created_at) }));
}

export async function syncRuleGroups(groups: RuleGroup[]): Promise<void> {
  await withTransaction((tx) =>
    upsertRows(
      tx,
      'rule_groups',
      ['id', 'name', 'deleted_at'],
      groups.map((g) => [g.id, g.name, null]),
      ['id']
    )
  );
}

export async function deleteRuleGroups(groupIds: string[]): Promise<void> {
  if (groupIds.length === 0) return;
  await withTransaction(async (tx) => {
    await softDelete(tx, 'rule_groups', groupIds);
    await tx.query(`UPDATE alert_rules SET group_id = NULL WHERE group_id = ANY($1::text[])`, [groupIds]);
  });
}

// ============================================================================
// 规则编辑锁（替代旧版塞在 home_config.config.locks 的 jsonb）
// ============================================================================

export async function getRuleLocks(): Promise<RuleLockMap> {
  await execute(`DELETE FROM rule_edit_locks WHERE expires_at < now()`);
  const rows = await query<{ rule_id: string; owner: string; acquired_at: Date | string }>(
    `SELECT rule_id, owner, acquired_at FROM rule_edit_locks`
  );
  const out: RuleLockMap = {};
  for (const r of rows) out[r.rule_id] = { owner: r.owner, at: toMs(r.acquired_at) };
  return out;
}

export async function setRuleLock(ruleId: string, owner: string, ttlMs: number): Promise<void> {
  await execute(
    `INSERT INTO rule_edit_locks (rule_id, owner, expires_at)
     VALUES ($1, $2, now() + ($3 || ' milliseconds')::interval)
     ON CONFLICT (rule_id) DO UPDATE
       SET owner = EXCLUDED.owner, acquired_at = now(), expires_at = EXCLUDED.expires_at
     WHERE rule_edit_locks.expires_at < now() OR rule_edit_locks.owner = EXCLUDED.owner`,
    [ruleId, owner, String(ttlMs)]
  );
}

export async function deleteRuleLock(ruleId: string, owner: string): Promise<void> {
  await execute(`DELETE FROM rule_edit_locks WHERE rule_id = $1 AND owner = $2`, [ruleId, owner]);
}

// ============================================================================
// 预警工单
// ============================================================================

interface TaskRow {
  id: string;
  rule_id: string | null;
  rule_name: string;
  level: string;
  priority: string | null;
  title: string;
  content: string;
  reason: string | null;
  condition_desc: string | null;
  preview: unknown;
  dept: string;
  assignee: string;
  handoff_to: string | null;
  created_by: string | null;
  status: string;
  resolution: string | null;
  failed_reason: string | null;
  plan: string | null;
  notified: string[] | null;
  dims: unknown;
  accepted_at: Date | string | null;
  started_at: Date | string | null;
  handled_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
  store_ids: string[] | null;
  dealer_ids: string[] | null;
}

function toTask(r: TaskRow, comments: AlertComment[]): AlertTask {
  const preview = asObject<AlertTask['preview'] | null>(r.preview, null);
  return {
    id: r.id,
    ruleId: r.rule_id ?? '',
    ruleName: r.rule_name ?? '',
    level: (r.level as AlertTask['level']) ?? 'warn',
    priority: r.priority ?? undefined,
    title: r.title ?? '',
    content: r.content ?? '',
    reason: r.reason ?? undefined,
    conditionDesc: r.condition_desc ?? undefined,
    preview: preview ?? undefined,
    createdBy: r.created_by ?? preview?.createdBy ?? undefined,
    dept: r.dept ?? '',
    assignee: r.assignee ?? '',
    handoffTo: r.handoff_to ?? undefined,
    status: (r.status as AlertStatus) ?? 'new',
    resolution: r.resolution ?? undefined,
    failedReason: r.failed_reason ?? undefined,
    plan: r.plan ?? undefined,
    notified: r.notified ?? [],
    dims: asObject<AlertTask['dims'] | undefined>(r.dims, undefined),
    storeIds: r.store_ids ?? [],
    dealerIds: r.dealer_ids ?? [],
    acceptedAt: toMsOrNull(r.accepted_at),
    startedAt: toMsOrNull(r.started_at),
    handledAt: toMsOrNull(r.handled_at),
    comments: comments.length > 0 ? comments : undefined,
    createdAt: toMs(r.created_at),
    updatedAt: toMs(r.updated_at),
  };
}

/** 读取全部预警（含留言、归属门店/经销商） */
export async function getAllAlerts(): Promise<AlertTask[]> {
  const rows = await query<TaskRow>(
    `SELECT t.*,
            COALESCE((SELECT array_agg(s.store_id) FROM alert_task_stores s WHERE s.task_id = t.id), '{}') AS store_ids,
            COALESCE((SELECT array_agg(d.dealer_id) FROM alert_task_dealers d WHERE d.task_id = t.id), '{}') AS dealer_ids
       FROM alert_tasks t
      WHERE t.deleted_at IS NULL
      ORDER BY t.created_at DESC`
  );
  if (rows.length === 0) return [];

  const commentRows = await query<{
    id: string;
    task_id: string;
    parent_id: string | null;
    author: string;
    text: string;
    created_at: Date | string;
  }>(
    `SELECT id, task_id, parent_id, author, text, created_at
       FROM alert_comments
      WHERE task_id = ANY($1::text[]) AND deleted_at IS NULL
      ORDER BY created_at`,
    [rows.map((r) => r.id)]
  );

  const byTask = new Map<string, AlertComment[]>();
  const replyPool = new Map<string, { by: string; text: string; at: number }[]>();
  for (const c of commentRows) {
    if (!c.parent_id) {
      const list = byTask.get(c.task_id) ?? [];
      list.push({ id: c.id, by: c.author, text: c.text, at: toMs(c.created_at), replies: [] });
      byTask.set(c.task_id, list);
    } else {
      const list = replyPool.get(c.parent_id) ?? [];
      list.push({ by: c.author, text: c.text, at: toMs(c.created_at) });
      replyPool.set(c.parent_id, list);
    }
  }
  const replyIds = new Map<string, string[]>();
  for (const c of commentRows) {
    if (!c.parent_id) continue;
    const arr = replyIds.get(c.parent_id) ?? [];
    arr.push(c.id);
    replyIds.set(c.parent_id, arr);
  }
  for (const [taskId, list] of byTask) {
    void taskId;
    for (const parent of list) {
      const infos = replyPool.get(parent.id);
      const ids = replyIds.get(parent.id) ?? [];
      parent.replies = infos ? infos.map((r, i) => ({ id: ids[i] ?? `reply_${i}`, ...r })) : [];
    }
  }

  return rows.map((r) => toTask(r, byTask.get(r.id) ?? []));
}

/**
 * 增量保存预警。
 * 修正旧版：旧版按「入参为准删除库中多余预警」；
 * 现在只 upsert，清空必须显式 clearAll，删除必须走 deleteAlerts()。
 */
export async function syncAlerts(
  alerts: AlertTask[],
  opts?: { clearAll?: boolean; actor?: string | null }
): Promise<void> {
  if (alerts.length === 0) {
    if (opts?.clearAll) {
      await withTransaction(async (tx) => {
        await tx.query(`UPDATE alert_tasks SET deleted_at = now() WHERE deleted_at IS NULL`);
      });
      await writeAudit(opts.actor ?? null, 'alert.clearAll', 'alert_tasks', null);
    }
    return;
  }

  const ids = alerts.map((a) => a.id);

  // 姓名 → 人员 id：旧版把「人名」当外键存，改名即断链；这里补上真外键
  const names = Array.from(
    new Set(
      alerts.flatMap((a) => [nn(a.assignee), nn(a.createdBy)]).filter((v): v is string => !!v)
    )
  );
  const personByName = new Map<string, string>();
  if (names.length > 0) {
    const pr = await query<{ id: string; name: string }>(
      `SELECT id, name FROM persons WHERE name = ANY($1::text[]) AND deleted_at IS NULL`,
      [names]
    );
    for (const p of pr) if (!personByName.has(p.name)) personByName.set(p.name, p.id);
  }

  const prevRows = await query<{ id: string; status: string }>(
    `SELECT id, status FROM alert_tasks WHERE id = ANY($1::text[])`,
    [ids]
  );
  const prevStatus = new Map(prevRows.map((r) => [r.id, r.status]));

  await withTransaction(async (tx) => {
    await upsertRows(
      tx,
      'alert_tasks',
      ['id', 'rule_id', 'rule_name', 'level', 'priority', 'title', 'content', 'reason',
       'condition_desc', 'preview', 'dept', 'assignee', 'assignee_person_id', 'handoff_to',
       'created_by', 'created_by_person_id', 'status', 'resolution', 'failed_reason', 'plan',
       'notified', 'dims', 'accepted_at', 'started_at', 'handled_at', 'deleted_at'],
      alerts.map((a) => [
        a.id,
        nn(a.ruleId),
        a.ruleName ?? '',
        a.level ?? 'warn',
        nn(a.priority),
        a.title ?? '',
        a.content ?? '',
        nn(a.reason),
        nn(a.conditionDesc),
        a.preview ? JSON.stringify(a.preview) : null,
        a.dept ?? '',
        a.assignee ?? '',
        personByName.get(nn(a.assignee) ?? '') ?? null,
        nn(a.handoffTo),
        nn(a.createdBy),
        personByName.get(nn(a.createdBy) ?? '') ?? null,
        a.status ?? 'new',
        nn(a.resolution),
        nn(a.failedReason),
        nn(a.plan),
        a.notified ?? [],
        a.dims ? JSON.stringify(a.dims) : null,
        msToTs(a.acceptedAt),
        msToTs(a.startedAt),
        msToTs(a.handledAt),
        null,
      ]),
      ['id']
    );

    // 状态流转历史：与库中旧状态不同才记录（旧版完全缺失的审计能力）
    const logRows: unknown[][] = [];
    for (const a of alerts) {
      const old = prevStatus.get(a.id);
      const now = a.status ?? 'new';
      if (old === undefined) {
        logRows.push([a.id, null, now, opts?.actor ?? nn(a.createdBy)]);
      } else if (old !== now) {
        logRows.push([a.id, old, now, opts?.actor ?? null]);
      }
    }
    if (logRows.length > 0) {
      const params: unknown[] = [];
      const tuples = logRows.map((r) => {
        const ph = r.map((v) => {
          params.push(v);
          return `$${params.length}`;
        });
        return `(${ph.join(', ')})`;
      });
      await tx.query(
        `INSERT INTO alert_task_status_log (task_id, from_status, to_status, operator)
         VALUES ${tuples.join(', ')}`,
        params as never[]
      );
    }

    // 归属门店 / 经销商：属于工单自身 → 按工单范围 replacement 安全
    await tx.query(`DELETE FROM alert_task_stores WHERE task_id = ANY($1::text[])`, [ids]);
    await tx.query(`DELETE FROM alert_task_dealers WHERE task_id = ANY($1::text[])`, [ids]);

    const storePairs: [string, string][] = [];
    const dealerPairs: [string, string][] = [];
    for (const a of alerts) {
      for (const s of a.storeIds ?? []) if (s) storePairs.push([a.id, s]);
      for (const d of a.dealerIds ?? []) if (d) dealerPairs.push([a.id, d]);
    }
    // 门店/经销商可能已删除 → JOIN 过滤，避免外键报错
    if (storePairs.length > 0) {
      await tx.query(
        `INSERT INTO alert_task_stores (task_id, store_id)
         SELECT x.a, x.b FROM unnest($1::text[], $2::text[]) AS x(a, b)
           JOIN stores s ON s.id = x.b
         ON CONFLICT DO NOTHING`,
        [storePairs.map((p) => p[0]), storePairs.map((p) => p[1])]
      );
    }
    if (dealerPairs.length > 0) {
      await tx.query(
        `INSERT INTO alert_task_dealers (task_id, dealer_id)
         SELECT x.a, x.b FROM unnest($1::text[], $2::text[]) AS x(a, b)
           JOIN dealers d ON d.id = x.b
         ON CONFLICT DO NOTHING`,
        [dealerPairs.map((p) => p[0]), dealerPairs.map((p) => p[1])]
      );
    }

    // 留言：整份提交（含回复）→ upsert + 软删本次未提交的
    const commentRows: unknown[][] = [];
    const keepByTask = new Map<string, string[]>();
    for (const a of alerts) {
      const keep: string[] = [];
      for (const c of a.comments ?? []) {
        keep.push(c.id);
        commentRows.push([c.id, a.id, null, c.by ?? '', c.text ?? '']);
        for (const rep of c.replies ?? []) {
          keep.push(rep.id);
          commentRows.push([rep.id, a.id, c.id, rep.by ?? '', rep.text ?? '']);
        }
      }
      if (keep.length > 0) keepByTask.set(a.id, keep);
    }
    if (commentRows.length > 0) {
      await upsertRows(
        tx,
        'alert_comments',
        ['id', 'task_id', 'parent_id', 'author', 'text'],
        commentRows,
        ['id']
      );
      for (const [taskId, keep] of keepByTask) {
        await tx.query(
          `UPDATE alert_comments SET deleted_at = now()
            WHERE task_id = $1 AND deleted_at IS NULL AND id <> ALL($2::text[])`,
          [taskId, keep]
        );
      }
    }
  });
}

/** 显式删除工单（软删除） */
export async function deleteAlerts(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await withTransaction((tx) => softDelete(tx, 'alert_tasks', ids));
}

/** 某工单的状态流转历史 */
export async function getAlertStatusLog(taskId: string) {
  const rows = await query<{
    id: string; from_status: string | null; to_status: string;
    operator: string | null; note: string | null; at: Date | string;
  }>(
    `SELECT id, from_status, to_status, operator, note, at
       FROM alert_task_status_log WHERE task_id = $1 ORDER BY at`,
    [taskId]
  );
  return rows.map((r) => ({
    id: r.id, fromStatus: r.from_status, toStatus: r.to_status,
    operator: r.operator, note: r.note, at: toMs(r.at),
  }));
}

// ============================================================================
// 配置 / 权限
// ============================================================================

export async function getHomeConfig(): Promise<HomeConfig | null> {
  const row = await queryOne<{ data: unknown }>(`SELECT data FROM app_config WHERE id = 'singleton'`);
  return row ? asObject<HomeConfig | null>(row.data, null) : null;
}

export async function saveHomeConfig(config: HomeConfig): Promise<void> {
  await withTransaction(async (tx) => {
    await tx.query(
      `INSERT INTO app_config (id, data) VALUES ('singleton', $1)
       ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
      [JSON.stringify(config ?? {})]
    );

    const permissions = Array.isArray(config?.permissions) ? config.permissions : [];
    const overrides = Array.isArray(config?.permOverrides) ? config.permOverrides : [];

    if (permissions.length > 0) {
      await upsertRows(
        tx,
        'roles',
        ['post', 'subject_kind', 'name', 'pages', 'modules', 'data_scope', 'data_scope_type'],
        permissions.map((p) => [
          p.post,
          p.subjectKind ?? 'post',
          // RolePerm 未定义 name，展示名沿用主体标识（与旧数据语义一致）
          p.post,
          JSON.stringify(p.pages ?? {}),
          JSON.stringify(p.modules ?? {}),
          JSON.stringify(p.dataScope ?? {}),
          p.dataScope?.type ?? 'self',
        ]),
        ['post', 'subject_kind']
      );
    }

    // 单用户覆盖：按 personId 精确归属（旧版无 personId，导致任一人的覆盖会作用于所有人）
    const withId = overrides.filter((o) => nn(o.personId));
    if (withId.length > 0) {
      await upsertRows(
        tx,
        'person_perm_overrides',
        ['person_id', 'data'],
        withId.map((o) => [String(o.personId), JSON.stringify(o)]),
        ['person_id']
      );
    }
  });
}

/**
 * 删除角色。
 *
 * roles 是纯配置表（复合主键 post + subject_kind，无 deleted_at，也无人引用），
 * 「这一行不存在」就等于「没有配置这个角色」，因此这里是物理删除。
 * 必须显式调用：saveHomeConfig 只做 upsert，不清理未提交的行，
 * 否则在界面上删掉的角色会留在库里继续生效。
 */
export async function deleteRoles(keys: { post: string; subjectKind?: string }[]): Promise<void> {
  if (keys.length === 0) return;
  await execute(
    `DELETE FROM roles
      WHERE (post, subject_kind) IN (SELECT * FROM unnest($1::text[], $2::text[]))`,
    [keys.map((k) => k.post), keys.map((k) => k.subjectKind ?? 'post')]
  );
}

/** 删除单人权限覆盖（同样是配置表，行不存在即代表未覆盖） */
export async function deletePermOverrides(personIds: string[]): Promise<void> {
  if (personIds.length === 0) return;
  await execute(`DELETE FROM person_perm_overrides WHERE person_id = ANY($1::text[])`, [personIds]);
}

export async function getPermissions(): Promise<RolePerm[]> {
  const rows = await query<{
    post: string; subject_kind: string; name: string;
    pages: unknown; modules: unknown; data_scope: unknown;
  }>(`SELECT post, subject_kind, name, pages, modules, data_scope FROM roles ORDER BY subject_kind, post`);
  return rows.map((r) => ({
    post: r.post,
    subjectKind: r.subject_kind as RolePerm['subjectKind'],
    pages: asObject<RolePerm['pages']>(r.pages, {}),
    modules: asObject<RolePerm['modules']>(r.modules, {}),
    dataScope: asObject<RolePerm['dataScope']>(r.data_scope, null),
  })) as RolePerm[];
}

export async function getPermOverrides(): Promise<PersonPermOverride[]> {
  const rows = await query<{ data: unknown }>(`SELECT data FROM person_perm_overrides`);
  return rows
    .map((r) => asObject<PersonPermOverride | null>(r.data, null))
    .filter((v): v is PersonPermOverride => !!v);
}

// ============================================================================
// 看板统计（旧版因整对象 jsonb，这些数在 SQL 层根本算不出来，只能在浏览器遍历）
// ============================================================================

export async function getDashboardStats() {
  const row = await queryOne<Record<string, string>>(
    `SELECT
       (SELECT count(*) FROM alert_tasks WHERE deleted_at IS NULL) AS total,
       (SELECT count(*) FROM alert_tasks WHERE deleted_at IS NULL
          AND status IN ('new','accepted','processing')) AS open,
       (SELECT count(*) FROM alert_tasks WHERE deleted_at IS NULL AND status = 'done') AS done,
       (SELECT count(*) FROM alert_tasks WHERE deleted_at IS NULL AND status = 'failed') AS failed,
       (SELECT count(*) FROM alert_rules WHERE deleted_at IS NULL AND status = 'active') AS active_rules,
       (SELECT count(*) FROM alert_tasks WHERE deleted_at IS NULL
          AND created_at >= now() - interval '7 days') AS last7`
  );
  return {
    total: Number(row?.total ?? 0),
    open: Number(row?.open ?? 0),
    done: Number(row?.done ?? 0),
    failed: Number(row?.failed ?? 0),
    activeRules: Number(row?.active_rules ?? 0),
    last7Days: Number(row?.last7 ?? 0),
  };
}
