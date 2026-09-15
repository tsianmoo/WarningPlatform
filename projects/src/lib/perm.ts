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
  for (const m of ALL_MODULES) out[m] = { view: true, all: { ...all } };
  return out;
}

function pageFromModule(ma: ModuleActionPerm | undefined): PagePerm {
  const all: Partial<Record<PermOp, boolean>> = {};
  if (ma) {
    (['create', 'edit', 'delete', 'run', 'handle', 'upload', 'assign'] as (keyof ModuleActionPerm)[]).forEach((k) => {
      if (k !== 'view' && ma[k] !== undefined && ma[k] !== null) all[k] = !!ma[k];
    });
  }
  return { view: ma?.view ?? true, all };
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

/** 解析当前用户的生效权限：自定义覆盖 > 岗位模板 > 兜底 */
export function resolvePerm(person: Person | null, cfg: HomeConfig | undefined | null): ResolvedPerm {
  if (!person) return { pages: defaultPagePerms(), dataScope: null, overridden: false };

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

  const roles: RolePerm[] = cfg?.permissions ?? [];
  const role = person.post ? roles.find((r) => r.post === person.post) : undefined;
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

export function canView(perm: ResolvedPerm, mod: PermModule): boolean {
  return perm.pages[mod]?.view ?? true;
}

/**
 * 判断页面操作权限。
 * @param op 操作码（PermOp）
 * @param resourceId 资源 id（数据表/规则/经销商/店仓/人员）。传了则取该资源细粒度；否则取页面级默认(all)
 */
export function canOper(perm: ResolvedPerm, mod: PermModule, op: PermOp, resourceId?: string): boolean {
  const p = perm.pages[mod];
  if (!p || !p.view) return false;
  if (resourceId && p.resources?.[resourceId]) {
    const r = p.resources[resourceId][op];
    if (r !== undefined) return !!r;
  }
  return p.all?.[op] ?? false;
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
  return alerts.filter((a) => alertVisible(a, person, scope, allow));
}

function alertVisible(a: AlertTask, person: Person, scope: DataScope | null, allow: Set<string> | null): boolean {
  if (allow === null) return true; // all
  if (allow.size === 0) {
    // self 模式：只看本人
    if ((scope?.type ?? 'self') === 'self') {
      return !!person.name && (a.assignee?.includes(person.name) || a.handoffTo === person.name || !!a.notified?.includes(person.name));
    }
    return false;
  }
  if (a.storeIds && a.storeIds.length) return a.storeIds.some((id) => allow.has(id));
  if (a.dealerIds && a.dealerIds.length) return a.dealerIds.some((d) => allow.has(d));
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