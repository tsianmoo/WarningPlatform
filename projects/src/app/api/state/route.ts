import { NextResponse } from 'next/server';
import { getAllTables, getAllRules, getAllAlerts, getAllRuleGroups, getAllTableGroups, getAllOrganizations, getAllPersons, getAllHrAttributes, getAllDealers, getAllStores, getAllEmployees, getHomeConfig, syncTables, syncRules, syncAlerts, syncRuleGroups, syncTableGroups, syncOrganizations, syncPersons, syncHrAttributes, syncDealers, syncStores, syncEmployees, saveHomeConfig, hasAnyBusinessData } from '@/lib/server/repo';
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
      orgs?: Organization[]; persons?: Person[]; hrAttributes?: HrAttribute[]; dealers?: Dealer[]; stores?: Store[]; employees?: Employee[]; config?: HomeConfig | null;
    };
    const tables = Array.isArray(body.tables) ? body.tables : [];
    try {
      require('fs').appendFileSync('/tmp/state_post.log', JSON.stringify({ ts: Date.now(), n: tables.length, names: tables.map(t => t.name), alerts: Array.isArray(body.alerts) ? body.alerts.length : 0 }) + '\n');
    } catch {}
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

    // 空覆盖防护：当本次提交的业务数据全空（无业务表、规则、员工、店仓、组织架构等），
    // 但库中已有业务数据时，判定为异常回退状态，拒绝本次覆盖，避免把真实数据清空。
    const businessCount =
      tables.filter((t) => t.id !== 'tbl-sample').length + rules.length + alerts.length + groups.length + tableGroups.length +
      orgs.length + persons.length + hrAttributes.length + dealers.length + stores.length + employees.length;
    if (businessCount === 0) {
      const existing = await hasAnyBusinessData();
      if (existing) {
        return NextResponse.json({ success: true, skipped: 'empty-overwrite-guard', tableCount: tables.length, ruleCount: rules.length });
      }
    }

    await Promise.all([syncTables(tables), syncRules(rules), syncAlerts(alerts), syncRuleGroups(groups), syncTableGroups(tableGroups), syncOrganizations(orgs), syncPersons(persons), syncHrAttributes(hrAttributes), syncDealers(dealers), syncStores(stores), syncEmployees(employees)]);
    if (body.config) await saveHomeConfig(body.config);
    return NextResponse.json({ success: true, tableCount: tables.length, ruleCount: rules.length, alertCount: alerts.length, groupCount: groups.length, tableGroupCount: tableGroups.length, orgCount: orgs.length, personCount: persons.length, attrCount: hrAttributes.length, dealerCount: dealers.length, storeCount: stores.length, employeeCount: employees.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}