import { NextResponse } from 'next/server';
import { getAllTables, getAllRules, getAllAlerts, getAllRuleGroups, syncTables, syncRules, syncAlerts, syncRuleGroups } from '@/lib/server/repo';
import type { AlertRule, AlertTask, DataTable, RuleGroup } from '@/lib/types';

// 读取持久化的全部业务数据（数据表 + 规则 + 预警 + 规则分组）
export async function GET() {
  try {
    const [tables, rules, alerts, groups] = await Promise.all([
      getAllTables(), getAllRules(), getAllAlerts(), getAllRuleGroups(),
    ]);
    return NextResponse.json({ tables, rules, alerts, groups });
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
    };
    const tables = Array.isArray(body.tables) ? body.tables : [];
    const rules = Array.isArray(body.rules) ? body.rules : [];
    const alerts = Array.isArray(body.alerts) ? body.alerts : [];
    const groups = Array.isArray(body.groups) ? body.groups : [];
    await Promise.all([syncTables(tables), syncRules(rules), syncAlerts(alerts), syncRuleGroups(groups)]);
    return NextResponse.json({ success: true, tableCount: tables.length, ruleCount: rules.length, alertCount: alerts.length, groupCount: groups.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
