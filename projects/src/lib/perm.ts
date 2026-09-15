import type {
  AlertTask,
  DataScope,
  HomeConfig,
  ModuleActionPerm,
  PagePerm,
  Person,
  PersonPermOverride,
  PermModule,
  PermOp,
  RolePerm,
  Store,
  Dealer,
  Employee,
} from '@/lib/types';

/** 全部功能页面 */
export const ALL_MODULES: PermModule[] = [
  'home',
  'datatables',
  'rules',
  'alerts',
  'dealer',
  'store',
  'dattrs',
  'sattrs',
  'people',
  'attrs',
  'homecfg',
  'perms',
];

/** 岗位默认（未配置任何权限时的兜底）：所有页面及操作全放开 → 系统开箱可用，配置了岗位后才按角色收紧 */
export function defaultPagePerms(): Partial<Record<PermModule, PagePerm>> {
  const all: Partial<Record<PermOp, boolean>> = {
    create: true,
    edit: true,
    delete: true,
    run: true,
    handle: true,
    upload: true,
    download: true,
    assign: true,
    resetPwd: true,
    manage: true,
  };
  const out: Partial<Record<PermModule, PagePerm>> = {};
  for (const m of ALL_MODULES) out[m] = { view: true, ops: { ...all } };
  return out;
}

function pageFromModule(ma: ModuleActionPerm | undefined): PagePerm {
  const ops: Partial<Record<PermOp, boolean>> = {};
  if (ma) {
    (['create', 'edit', 'delete', 'run', 'handle', 'upload', 'assign'] as (keyof ModuleActionPerm)[]).forEach((k) => {
      if (k !== 'view' && ma[k] !== undefined && ma[k] !== null) ops[k as PermOp] = !!ma[k];
    });
  }
  return { view: ma?.view ?? true, ops };
}

/** 旧数据（modules）→ 新结构（pages）迁移 */
export function migrateRole(r: RolePerm): RolePerm {
  const pages = { ...(r.pages ?? {}) };
  if (r.modules && !r.pages) {
    (Object.keys(r.modules) as PermModule[]).forEach((m) => {
      pages[m] = pageFromModule(r.modules![m]);
    });
  }
  return { ...r, pages, modules: undefined };
}

function migrateOverride(o: PersonPermOverride): PersonPermOverride {
  const pages = { ...(o.pages ?? {}) };
  if (o.modules && !o.pages) {
    (Object.keys(o.modules) as PermModule[]).forEach((m) => {
      pages[m] = pageFromModule(o.modules![m]);
    });
  }
  return { ...o, pages, modules: undefined };
}

export interface ResolvedPerm {
  pages: Partial<Record<PermModule, PagePerm>>;
  dataScope: DataScope | null;
  /** 是否命中用户自定义覆盖 */
  overridden: boolean;
}

/** 权限主体身份：主体类型 + 主体标识（岗位名 / 经销商编号 / 店仓编号 / 员工编号） */
export interface AuthSubject {
  kind: 'post' | 'dealer' | 'store' | 'employee';
  key: string;
}

/** 在角色表中按主体类型 + 标识查找（缺省 subjectKind 视为 'post'） */
export function findRoleBySubject(roles: RolePerm[], kind: 'post' | 'dealer' | 'store' | 'employee', key: string): RolePerm | undefined {
  return roles.find((r) => (r.subjectKind ?? 'post') === kind && r.post === key && !!key);
}

/**
 * 解析当前账号的生效权限：自定义覆盖(仅人员) > 岗位/经销商/店仓/员工角色 > 兜底。
 * @param person 命中的人员（无则为 null）
 * @param cfg 平台配置（含 permissions / permOverrides）
 * @param account 非人员账号（经销商/店仓/员工）的主体身份
 */
export function resolvePerm(person: Person | null, cfg: HomeConfig | undefined | null, account?: AuthSubject | null): ResolvedPerm {
  const roles: RolePerm[] = cfg?.permissions ?? [];

  if (person) {
    const overrides: PersonPermOverride[] = cfg?.permOverrides ?? [];
    const ov = overrides.find((o) => o && o.enabled !== false);
    if (ov) {
      const m = migrateOverride(ov);
      return {
        pages: { ...defaultPagePerms(), ...(m.pages ?? {}) },
        dataScope: m.dataScope ?? null,
        overridden: true,
      };
    }
    const role = person.post ? findRoleBySubject(roles, 'post', person.post) : undefined;
    if (role) {
      const m = migrateRole(role);
      return {
        pages: { ...defaultPagePerms(), ...(m.pages ?? {}) },
        dataScope: m.dataScope ?? null,
        overridden: false,
      };
    }
    return { pages: defaultPagePerms(), dataScope: null, overridden: false };
  }

  if (account && account.key) {
    const role = findRoleBySubject(roles, account.kind, account.key);
    if (role) {
      const m = migrateRole(role);
      return {
        pages: { ...defaultPagePerms(), ...(m.pages ?? {}) },
        dataScope: m.dataScope ?? null,
        overridden: false,
      };
    }
  }

  return { pages: defaultPagePerms(), dataScope: null, overridden: false };
}

/**
 * 根据登录名解析当前账号：命中人员返回人员（subjectKind='post'，key=岗位名）；
 * 否则在 经销商/店仓/员工 中按 name 或 code 匹配，返回非人员主体与其对应的“归属人员壳”。
 * @param scopePerson 非人员账号用于数据权限推断的轻量归属（dealerId / storeId）
 */
export function resolveAuthAccount(
  stores: Store[],
  dealers: Dealer[],
  employees: Employee[],
  meName: string,
  me: Person | null
): { subject: AuthSubject | null; scopePerson: Person | null } {
  if (me) return { subject: me.post ? { kind: 'post', key: me.post } : null, scopePerson: me };
  if (!meName) return { subject: null, scopePerson: null };
  const d = dealers.find((x) => !!(x.name && x.name === meName) || !!(x.code && x.code === meName));
  if (d) {
    return {
      subject: { kind: 'dealer', key: d.code || d.name || '' },
      scopePerson: { id: d.id, name: meName, orgId: '', dealerId: d.id, enabled: true, sort: 0, createdAt: 0 },
    };
  }
  const s = stores.find((x) => !!(x.name && x.name === meName) || !!(x.code && x.code === meName));
  if (s) {
    return {
      subject: { kind: 'store', key: s.code || s.name || '' },
      scopePerson: { id: s.id, name: meName, orgId: '', dealerId: s.dealerId, storeId: s.id, enabled: true, sort: 0, createdAt: 0 },
    };
  }
  const e = employees.find((x) => !!(x.name && x.name === meName) || !!(x.code && x.code === meName));
  if (e) {
    return {
      subject: { kind: 'employee', key: e.code || e.name || '' },
      scopePerson: { id: e.id, name: meName, orgId: '', dealerId: e.dealerId, storeId: e.storeId, enabled: true, sort: 0, createdAt: 0 },
    };
  }
  return { subject: null, scopePerson: null };
}

export function canView(perm: ResolvedPerm, mod: PermModule): boolean {
  return perm.pages[mod]?.view ?? true;
}

/**
 * 判断页面操作权限。
 * @param op 操作码（PermOp）；页面级，作用于该页所有资源（整页统一，不细分到单个表/经销商）
 */
export function canOper(perm: ResolvedPerm, mod: PermModule, op: PermOp): boolean {
  const p = perm.pages[mod];
  if (!p || !p.view) return false;
  return p.ops?.[op] ?? false;
}

/** 由数据范围 + 用户归属推导允许可见的店仓 id 集合；all 返回 null（代表不过滤） */
export function allowedStoreIds(scope: DataScope | null, person: Person, stores: Store[]): Set<string> | null {
  const s = scope ?? inferScope(person);
  if (!s) return null;
  switch (s.type) {
    case 'all':
      return null;
    case 'self':
      return new Set();
    case 'dealer':
      return new Set(stores.filter((x) => x.dealerId && x.dealerId === person.dealerId).map((x) => x.id));
    case 'store':
      return person.storeId ? new Set([person.storeId]) : new Set();
    case 'managed': {
      const ids = person.manageScope?.storeIds ?? [];
      return new Set(ids);
    }
    case 'custom': {
      const out = new Set<string>();
      (s.dealerIds ?? []).forEach((did) => stores.filter((x) => x.dealerId === did).forEach((x) => out.add(x.id)));
      (s.storeIds ?? []).forEach((id) => out.add(id));
      for (const f of s.attrFilters ?? []) {
        for (const st of stores) {
          const v = storeAttrValue(st, f.attrName);
          if (v && f.values.includes(v)) out.add(st.id);
        }
      }
      if (s.useManageScope) (person.manageScope?.storeIds ?? []).forEach((id) => out.add(id));
      return out;
    }
    default:
      return new Set();
  }
}

/** 按用户最终数据权限过滤预警列表 */
export function filterAlertsByScope(
  alerts: AlertTask[],
  person: Person | null,
  scope: DataScope | null,
  stores: Store[]
): AlertTask[] {
  if (!person) return alerts;
  const allow = allowedStoreIds(scope, person, stores);
  const nameToId = new Map(stores.map((s) => [s.name, s.id]));
  return alerts.filter((a) => alertVisible(a, person, scope, allow, nameToId));
}

/**
 * 预警的归属性店仓 id（按「接收门店」口径）：
 * 1) 优先读显式持久化的 storeIds（新规则已带）；
 * 2) 否则取该预警实际接收/通知的门店名（preview.recipients 中 mode=store 的 names，
 *    preview.storeMessages[].store）映射为门店 id。
 * 仅用接收门店判定，保证「可见预警的接收人始终落在数据权限范围内」。
 */
function storeIdsOf(a: AlertTask, nameToId: Map<string, string>): string[] {
  if (a.storeIds?.length) return a.storeIds;
  const names = new Set<string>();
  for (const r of a.preview?.recipients ?? []) {
    if (r.mode === 'store') (r.names ?? []).forEach((n) => n && names.add(n));
  }
  for (const sm of a.preview?.storeMessages ?? []) if (sm.store) names.add(sm.store);
  const out = new Set<string>();
  for (const n of names) {
    const id = nameToId.get(n);
    if (id) out.add(id);
  }
  return [...out];
}

function alertVisible(
  a: AlertTask,
  person: Person,
  scope: DataScope | null,
  allow: Set<string> | null,
  nameToId: Map<string, string>
): boolean {
  if (allow === null) return true; // all
  if (allow.size === 0) {
    // self 模式：只看本人
    if ((scope?.type ?? 'self') === 'self') {
      return !!person.name && (a.assignee?.includes(person.name) || a.handoffTo === person.name || !!a.notified?.includes(person.name));
    }
    return false;
  }
  const ids = storeIdsOf(a, nameToId);
  if (ids.length) return ids.some((id) => allow.has(id));
  // 预警没有可判定的门店归属（旧数据且内容未带店仓名）-> 门店型数据范围下视为不可见
  return false;
}

export function inferScope(person: Person): DataScope | null {
  if (person.dealerId) return { type: 'dealer' };
  if (person.storeId) return { type: 'store' };
  return { type: 'self' };
}

function storeAttrValue(s: Store, attrName: string): string {
  if (attrName === '销售区域' || attrName === 'salesArea') return s.salesArea ?? '';
  if (attrName === '区部' || attrName === 'district') return s.district ?? '';
  if (attrName === '所属分公司' || attrName === 'company') return s.company ?? '';
  if (attrName === '所属部门' || attrName === 'department') return s.department ?? '';
  return s.attrs?.[attrName] ?? '';
}

/** 便捷取 Person.permOverride（兼容 modules 旧的字段） */
export function normalizePersonOverride(p?: Person): PersonPermOverride | undefined {
  if (!p?.permOverride) return undefined;
  return p.permOverride;
}