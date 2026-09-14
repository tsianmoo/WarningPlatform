import { NextResponse } from 'next/server';
import { getAllTables, getAllRules, getAllAlerts, getAllRuleGroups, getAllOrganizations, getAllPersons, getAllHrAttributes, getAllDealers, getAllStores, getHomeConfig, syncTables, syncRules, syncAlerts, syncRuleGroups, syncOrganizations, syncPersons, syncHrAttributes, syncDealers, syncStores, saveHomeConfig } from '@/lib/server/repo';
import type { AlertRule, AlertTask, DataTable, Dealer, HrAttribute, HomeConfig, Organization, Person, RuleGroup, Store } from '@/lib/types';

// 读取持久化的全部业务数据（数据表 + 规则 + 预警 + 规则分组 + 组织架构 + 人事架构 + 经销商/店仓 + 首页配置）
export async function GET() {
  try {
    const [tables, rules, alerts, groups, orgs, persons, hrAttributes, dealers, stores, config] = await Promise.all([
      getAllTables(), getAllRules(), getAllAlerts(), getAllRuleGroups(), getAllOrganizations(), getAllPersons(), getAllHrAttributes(), getAllDealers(), getAllStores(), getHomeConfig(),
    ]);
    return NextResponse.json({ tables, rules, alerts, groups, orgs, persons, hrAttributes, dealers, stores, config });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// 全量同步：以客户端提交的数据为准，覆盖数据库
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      tables?: DataTable[]; rules?: AlertRule[]; alerts?: AlertTask[]; groups?: RuleGroup[];
      orgs?: Organization[]; persons?: Person[]; hrAttributes?: HrAttribute[]; dealers?: Dealer[]; stores?: Store[]; config?: HomeConfig | null;
    };
    const tables = Array.isArray(body.tables) ? body.tables : [];
    const rules = Array.isArray(body.rules) ? body.rules : [];
    const alerts = Array.isArray(body.alerts) ? body.alerts : [];
    const groups = Array.isArray(body.groups) ? body.groups : [];
    const orgs = Array.isArray(body.orgs) ? body.orgs : [];
    const persons = Array.isArray(body.persons) ? body.persons : [];
    const hrAttributes = Array.isArray(body.hrAttributes) ? body.hrAttributes : [];
    const dealers = Array.isArray(body.dealers) ? body.dealers : [];
    const stores = Array.isArray(body.stores) ? body.stores : [];
    await Promise.all([syncTables(tables), syncRules(rules), syncAlerts(alerts), syncRuleGroups(groups), syncOrganizations(orgs), syncPersons(persons), syncHrAttributes(hrAttributes), syncDealers(dealers), syncStores(stores)]);
    if (body.config) await saveHomeConfig(body.config);
    return NextResponse.json({ success: true, tableCount: tables.length, ruleCount: rules.length, alertCount: alerts.length, groupCount: groups.length, orgCount: orgs.length, personCount: persons.length, attrCount: hrAttributes.length, dealerCount: dealers.length, storeCount: stores.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}