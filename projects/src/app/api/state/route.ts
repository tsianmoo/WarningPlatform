import { NextResponse } from 'next/server';
import { gunzipSync } from 'zlib';
import { getAllTables, getAllRules, getAllAlerts, getAllRuleGroups, getAllTableGroups, getAllOrganizations, getAllPersons, getAllHrAttributes, getAllDealers, getAllStores, getAllEmployees, getHomeConfig, syncTables, syncRules, syncAlerts, syncRuleGroups, syncTableGroups, syncOrganizations, syncPersons, syncHrAttributes, syncDealers, syncStores, syncEmployees, saveHomeConfig, putTablesDirect } from '@/lib/server/repo';
import type { AlertRule, AlertTask, DataTable, DataTableGroup, Dealer, Employee, HrAttribute, HomeConfig, Organization, Person, RuleGroup, Store } from '@/lib/types';
import { isBigDataTable } from '@/lib/types';

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
    // 兼容 gzip 压缩传输（客户端对大状态启用 Content-Encoding: gzip，规避超大 body 被网关限制）
    let raw: unknown;
    if (req.headers.get('content-encoding') === 'gzip') {
      const buf = Buffer.from(await req.arrayBuffer());
      raw = JSON.parse(gunzipSync(buf).toString('utf8'));
    } else {
      raw = await req.json();
    }
    const body = raw as {
      tables?: DataTable[]; rules?: AlertRule[]; alerts?: AlertTask[]; groups?: RuleGroup[]; tableGroups?: DataTableGroup[];
      orgs?: Organization[]; persons?: Person[]; hrAttributes?: HrAttribute[]; dealers?: Dealer[]; stores?: Store[]; employees?: Employee[]; config?: HomeConfig | null;
    };
    const tables = Array.isArray(body.tables) ? body.tables : [];
    // 大表已通过独立 /api/tables 通道落库（其 body 仅占位元信息、不含 rows 内容）。
    // 兜底兼容：若提交的大表仍带全量 rows（如旧浏览器端未走新通道），此处直接直连落库，避免大表内容被丢弃。
    const allTables = Array.isArray(tables) ? tables : [];
    const smallTables: DataTable[] = [];
    const directBigRows = [];
    const bigTableIds: string[] = [];
    for (const t of allTables) {
      if (isBigDataTable(t)) {
        bigTableIds.push(t.id);
        if (Array.isArray(t.rows) && t.rows.length > 0) {
          directBigRows.push({
            id: t.id,
            name: t.name,
            file_name: t.fileName ?? '',
            row_count: t.rowCount ?? 0,
            created_at: t.createdAt ?? Date.now(),
            data: t,
          });
        }
      } else {
        smallTables.push(t);
      }
    }
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

    // 防误清库：客户端推送“全空状态”时，若数据库中已有(除首页配置外的)业务数据，则拒绝本次覆盖，
    // 避免某次空同步把整库业务数据一次性清空。仅当数据库本来就空时才放行。
    const allEmpty = [tables, rules, alerts, groups, tableGroups, orgs, persons, hrAttributes, dealers, stores, employees].every((a) => a.length === 0);
    if (allEmpty) {
      const probe = await Promise.all([getAllTables(), getAllRules(), getAllAlerts(), getAllRuleGroups(), getAllTableGroups(), getAllOrganizations(), getAllPersons(), getAllHrAttributes(), getAllDealers(), getAllStores(), getAllEmployees()]);
      if (probe.some((x) => x.length > 0)) {
        return NextResponse.json({ error: '检测到全空全量推送，已阻止以防止误清库；若意图清空请先手动确认本地数据。' }, { status: 409 });
      }
    }

    if (directBigRows.length > 0) await putTablesDirect(directBigRows);
    await Promise.all([syncTables(smallTables, bigTableIds), syncRules(rules), syncAlerts(alerts), syncRuleGroups(groups), syncTableGroups(tableGroups), syncOrganizations(orgs), syncPersons(persons), syncHrAttributes(hrAttributes), syncDealers(dealers), syncStores(stores), syncEmployees(employees)]);
    if (body.config) await saveHomeConfig(body.config);
    return NextResponse.json({ success: true, tableCount: tables.length, ruleCount: rules.length, alertCount: alerts.length, groupCount: groups.length, tableGroupCount: tableGroups.length, orgCount: orgs.length, personCount: persons.length, attrCount: hrAttributes.length, dealerCount: dealers.length, storeCount: stores.length, employeeCount: employees.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}