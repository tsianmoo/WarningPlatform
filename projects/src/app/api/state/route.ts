import { NextResponse } from 'next/server';
import { getAllTables, getAllRules, getAllAlerts, getAllRuleGroups, getAllTableGroups, getAllOrganizations, getAllPersons, getAllHrAttributes, getAllDealers, getAllStores, getAllEmployees, getHomeConfig, syncTables, syncRules, syncAlerts, syncRuleGroups, syncTableGroups, syncOrganizations, syncPersons, syncHrAttributes, syncDealers, syncStores, syncEmployees, saveHomeConfig } from '@/lib/server/repo';
import type { AlertRule, AlertTask, DataTable, DataTableGroup, Dealer, Employee, HrAttribute, HomeConfig, Organization, Person, RuleGroup, Store } from '@/lib/types';

// 读取持久化的全部业务数据（数据表 + 规则 + 预警 + 规则分组 + 组织架构 + 人事架构 + 经销商/店仓 + 员工 + 首页配置）
export async function GET() {
  try {
    const [tables, rules, alerts, groups, tableGroups, orgs, persons, hrAttributes, dealers, stores, employees, config] = await Promise.all([
      getAllTables(), getAllRules(), getAllAlerts(), getAllRuleGroups(), getAllTableGroups(), getAllOrganizations(), getAllPersons(), getAllHrAttributes(), getAllDealers(), getAllStores(), getAllEmployees(), getHomeConfig(),
    ]);
    return NextResponse.json({ tables, rules, alerts, groups, tableGroups, orgs, persons, hrAttributes, dealers, stores, employees, config });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// 全量同步：以客户端提交的数据为准，覆盖数据库
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      tables?: DataTable[]; rules?: AlertRule[]; alerts?: AlertTask[]; groups?: RuleGroup[]; tableGroups?: DataTableGroup[];
      orgs?: Organization[]; persons?: Person[]; hrAttributes?: HrAttribute[]; dealers?: Dealer[]; stores?: Store[]; employees?: Employee[]; config?: HomeConfig | null; clearAlertsAll?: boolean;
    };
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
    // 各实体独立同步：单个实体（或某条脏数据）失败不拖垮整批其他实体落库，避免"新增用户"因别处报错而静默丢失
    const syncs = [
      ['tables', () => syncTables(tables)],
      ['rules', () => syncRules(rules)],
      ['alerts', () => syncAlerts(alerts, { clearAll: !!body.clearAlertsAll })],
      ['groups', () => syncRuleGroups(groups)],
      ['tableGroups', () => syncTableGroups(tableGroups)],
      ['orgs', () => syncOrganizations(orgs)],
      ['persons', () => syncPersons(persons)],
      ['hrAttributes', () => syncHrAttributes(hrAttributes)],
      ['dealers', () => syncDealers(dealers)],
      ['stores', () => syncStores(stores)],
      ['employees', () => syncEmployees(employees)],
    ] as const;
    const results = await Promise.allSettled(syncs.map(([, fn]) => Promise.resolve().then(fn)));
    if (body.config) {
      try { await saveHomeConfig(body.config); } catch (err) { results.push({ status: 'rejected', reason: err instanceof Error ? err.message : String(err) }); }
    }
    const errors = results.map((r, i) => (r.status === 'rejected' ? `${syncs[i] ? syncs[i][0] : 'config'}: ${r.reason && (r.reason as Error).message ? (r.reason as Error).message : r.reason}` : null)).filter(Boolean);
    return NextResponse.json({ success: true, errors, tableCount: tables.length, ruleCount: rules.length, alertCount: alerts.length, groupCount: groups.length, tableGroupCount: tableGroups.length, orgCount: orgs.length, personCount: persons.length, attrCount: hrAttributes.length, dealerCount: dealers.length, storeCount: stores.length, employeeCount: employees.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}