import { NextResponse } from 'next/server';
import {
  getAllTables, getAllRules, getAllAlerts, getAllRuleGroups, getAllTableGroups,
  getAllOrganizations, getAllPersons, getAllHrAttributes, getAllDealers, getAllStores,
  getAllEmployees, getHomeConfig, getPermissions, getPermOverrides, getRuleLocks,
  syncTables, syncRules, syncAlerts, syncRuleGroups, syncTableGroups, syncOrganizations,
  syncPersons, syncHrAttributes, syncDealers, syncStores, syncEmployees, saveHomeConfig,
  deleteRules, deleteRuleGroups, deleteTables, deleteTableGroups, deleteDealers,
  deleteStores, deletePersons, deleteEmployees, deleteOrganizations, deleteHrAttributes,
  deleteAlerts, writeAudit, deleteRoles, deletePermOverrides,
} from '@/lib/server/repo';
import { requireAccount } from '@/lib/server/auth';
import { assertModuleOp, canManageHomeConfig, canManagePerms } from '@/lib/server/authz';
import { fail, clientIp } from '@/lib/server/api';
import type {
  AlertRule, AlertTask, DataTable, DataTableGroup, Dealer, Employee, HrAttribute,
  HomeConfig, Organization, Person, PermModule, PermOp, RuleGroup, Store,
} from '@/lib/types';

/**
 * 全量状态读取 / 增量写入。
 *
 * 与旧版的关键差异：
 *   - 旧版 POST 是「以客户端提交为准，覆盖数据库并删除多余行」，
 *     配合无鉴权接口，任何一次 GET 不完整或一条 curl 就能清空业务数据。
 *   - 现在 POST 只做 upsert（绝不删除），删除必须通过 `del` 显式声明；
 *     且所有接口都要求已登录会话（旧版 GET 还会把明文密码下发）。
 *   - 写入前按数据库里的角色配置做服务端授权校验（旧版权限判断只在前端）。
 */

/** 实体集合 → 权限模块：用于把「这次要写哪些实体」翻译成「需要哪些模块权限」 */
const ENTITY_MODULE: Record<string, PermModule> = {
  tables: 'datatables',
  tableGroups: 'datatables',
  rules: 'rules',
  groups: 'rules',
  alerts: 'alerts',
  orgs: 'people',
  persons: 'people',
  employees: 'people',
  hrAttributes: 'attrs',
  dealers: 'dealer',
  stores: 'store',
};

/** 删除通道的字段名 → 权限模块 */
const DEL_MODULE: Record<string, PermModule> = {
  ruleIds: 'rules',
  groupIds: 'rules',
  tableIds: 'datatables',
  tableGroupIds: 'datatables',
  dealerIds: 'dealer',
  storeIds: 'store',
  personIds: 'people',
  employeeIds: 'people',
  orgIds: 'people',
  hrAttributeIds: 'attrs',
  alertIds: 'alerts',
};

/** upsert 既可能是新增也可能是编辑，二者有一即可 */
const WRITE_OPS: PermOp[] = ['create', 'edit'];
const DELETE_OPS: PermOp[] = ['delete'];

export async function GET() {
  try {
    await requireAccount();
    const [
      tables, rules, alerts, groups, tableGroups, orgs, persons, hrAttributes,
      dealers, stores, employees, config, permissions, permOverrides, locks,
    ] = await Promise.all([
      getAllTables(), getAllRules(), getAllAlerts(), getAllRuleGroups(), getAllTableGroups(),
      getAllOrganizations(), getAllPersons(), getAllHrAttributes(), getAllDealers(),
      getAllStores(), getAllEmployees(), getHomeConfig(), getPermissions(),
      getPermOverrides(), getRuleLocks(),
    ]);
    return NextResponse.json({
      tables, rules, alerts, groups, tableGroups, orgs, persons, hrAttributes,
      dealers, stores, employees,
      config: config ? { ...config, permissions, permOverrides } : null,
      locks,
    });
  } catch (err) {
    return fail(err);
  }
}

interface StateBody {
  tables?: DataTable[];
  rules?: AlertRule[];
  alerts?: AlertTask[];
  groups?: RuleGroup[];
  tableGroups?: DataTableGroup[];
  orgs?: Organization[];
  persons?: Person[];
  hrAttributes?: HrAttribute[];
  dealers?: Dealer[];
  stores?: Store[];
  employees?: Employee[];
  config?: HomeConfig | null;
  clearAlertsAll?: boolean;
  del?: {
    ruleIds?: string[];
    groupIds?: string[];
    clearAlerts?: boolean;
    tableIds?: string[];
    tableGroupIds?: string[];
    dealerIds?: string[];
    storeIds?: string[];
    personIds?: string[];
    employeeIds?: string[];
    orgIds?: string[];
    hrAttributeIds?: string[];
    alertIds?: string[];
    /** 被移除的角色 / 单人权限覆盖（配置表，显式删除） */
    roleKeys?: { post: string; subjectKind?: string }[];
    overridePersonIds?: string[];
  };
}

export async function POST(req: Request) {
  try {
    const account = await requireAccount();
    const actor = account.displayName || account.username;
    const ip = clientIp(req);
    const body = (await req.json()) as StateBody;

    // 显式删除通道：与 upsert 通道分开，彻底消除「空数组 = 清库」
    if (body.del) {
      const d = body.del;

      // 授权：按涉及到的模块逐个校验删除权限（未涉及的空数组不校验）
      const delMods = new Set<PermModule>();
      for (const [field, mod] of Object.entries(DEL_MODULE)) {
        const ids = (d as Record<string, unknown>)[field];
        if (Array.isArray(ids) && ids.length > 0) delMods.add(mod);
      }
      if (d.clearAlerts) delMods.add('alerts');
      for (const mod of delMods) await assertModuleOp(account, mod, DELETE_OPS);

      // 删角色/权限覆盖属于「系统-权限管理」，单独校验（避免用别的模块权限提权）
      if (d.roleKeys?.length || d.overridePersonIds?.length) {
        await assertModuleOp(account, 'perms', ['manage']);
      }

      if (d.ruleIds?.length) await deleteRules(d.ruleIds, { clearAlerts: !!d.clearAlerts });
      if (d.groupIds?.length) await deleteRuleGroups(d.groupIds);
      if (d.tableIds?.length) await deleteTables(d.tableIds);
      if (d.tableGroupIds?.length) await deleteTableGroups(d.tableGroupIds);
      if (d.dealerIds?.length) await deleteDealers(d.dealerIds);
      if (d.storeIds?.length) await deleteStores(d.storeIds);
      if (d.personIds?.length) await deletePersons(d.personIds);
      if (d.employeeIds?.length) await deleteEmployees(d.employeeIds);
      if (d.orgIds?.length) await deleteOrganizations(d.orgIds);
      if (d.hrAttributeIds?.length) await deleteHrAttributes(d.hrAttributeIds);
      if (d.alertIds?.length) await deleteAlerts(d.alertIds);
      if (d.roleKeys?.length) await deleteRoles(d.roleKeys);
      if (d.overridePersonIds?.length) await deletePermOverrides(d.overridePersonIds);

      await writeAudit(actor, 'state.delete', null, null, d, ip);
      return NextResponse.json({ success: true, errors: [] });
    }

    const tables = Array.isArray(body.tables) ? body.tables : [];
    const rules = Array.isArray(body.rules) ? body.rules : [];
    const alerts = Array.isArray(body.alerts) ? body.alerts : [];
    const groups = Array.isArray(body.groups) ? body.groups : [];
    const tableGroups = Array.isArray(body.tableGroups) ? body.tableGroups : [];
    const orgs = Array.isArray(body.orgs) ? body.orgs : [];
    const persons = Array.isArray(body.persons) ? body.persons : [];
    const hrAttributes = Array.isArray(body.hrAttributes) ? body.hrAttributes : [];
    const dealers = Array.isArray(body.dealers) ? body.dealers : [];
    const stores = Array.isArray(body.stores) ? body.stores : [];
    const employees = Array.isArray(body.employees) ? body.employees : [];

    // 授权：只校验「本次真的要写入」的模块（客户端每次会带上全部实体，
    // 空数组代表无内容可写，不构成越权）
    const writeMods = new Set<PermModule>();
    for (const [field, mod] of Object.entries(ENTITY_MODULE)) {
      const arr = (body as unknown as Record<string, unknown>)[field];
      if (Array.isArray(arr) && arr.length > 0) writeMods.add(mod);
    }
    for (const mod of writeMods) await assertModuleOp(account, mod, WRITE_OPS);

    // 各实体独立写入：单个实体失败不拖垮整批，错误按实体回传
    const syncs: [string, () => Promise<void>][] = [
      ['tables', () => syncTables(tables)],
      ['rules', () => syncRules(rules)],
      ['alerts', () => syncAlerts(alerts, { clearAll: !!body.clearAlertsAll, actor })],
      ['groups', () => syncRuleGroups(groups)],
      ['tableGroups', () => syncTableGroups(tableGroups)],
      ['orgs', () => syncOrganizations(orgs)],
      ['persons', () => syncPersons(persons)],
      ['hrAttributes', () => syncHrAttributes(hrAttributes)],
      ['dealers', () => syncDealers(dealers)],
      ['stores', () => syncStores(stores)],
      ['employees', () => syncEmployees(employees)],
    ];

    const results = await Promise.allSettled(syncs.map(([, fn]) => fn()));
    const errors: string[] = [];
    results.forEach((r, i) => {
      if (r.status === 'rejected') {
        const reason = r.reason instanceof Error ? r.reason.message : String(r.reason);
        errors.push(`${syncs[i][0]}: ${reason}`);
      }
    });

    if (body.config) {
      try {
        if (!(await canManageHomeConfig(account))) {
          // 客户端每次保存都会带上 config，无权限时跳过该项，不阻断其它实体的写入
          errors.push('config: 没有权限修改全局配置，该项已跳过');
        } else {
          let cfg = body.config;
          if (!(await canManagePerms(account))) {
            // 保留数据库里现有的权限配置，避免越权提权
            const [curPerms, curOverrides] = await Promise.all([getPermissions(), getPermOverrides()]);
            cfg = { ...cfg, permissions: curPerms, permOverrides: curOverrides };
          }
          await saveHomeConfig(cfg);
        }
      } catch (err) {
        errors.push(`config: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (body.clearAlertsAll) {
      await writeAudit(actor, 'alert.clearAll', 'alert_tasks', null, null, ip);
    }

    return NextResponse.json({
      success: true,
      errors,
      tableCount: tables.length,
      ruleCount: rules.length,
      alertCount: alerts.length,
      groupCount: groups.length,
      tableGroupCount: tableGroups.length,
      orgCount: orgs.length,
      personCount: persons.length,
      attrCount: hrAttributes.length,
      dealerCount: dealers.length,
      storeCount: stores.length,
      employeeCount: employees.length,
    });
  } catch (err) {
    return fail(err);
  }
}
