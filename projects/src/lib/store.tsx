'use client';

import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AlertRule,
  AlertTask,
  DataTable,
  ExecutionRecord,
  HrAttribute,
  HrAttributeItem,
  Dealer,
  Store,
  Employee,
  Organization,
  Person,
  RuleGroup,
  Schedule,
  TargetSetting,
  NotifyMode,
  HomeConfig,
} from './types';
import { uid, OPERATOR_OPTIONS, DEFAULT_HOME_CONFIG, normalizeHomeConfig } from './types';
import { buildSampleTable, ensureFieldsComplete } from './parser';
import { evaluateFlow } from './evaluate';
import type { NodePreview } from './evaluate';
import type { ActionNodeData, ConditionItem, ConditionNodeData, FlowNode } from './types';

/** 判断预警是否为残缺脏数据（标题与规则名均为空且无预览，仅基础字段的残留记录） */
export function isBlankAlert(a: Partial<AlertTask> | null | undefined): boolean {
  if (!a) return true;
  return !(a.title?.trim() || a.ruleName?.trim());
}

/** 归一化属性标签：容忍历史遗留的字符串数组（如 ["店长"]），统一转成 {id,name} 对象数组，避免 key 冲突与渲染崩溃 */
export function normalizeHrAttrs(attrs: unknown[]): HrAttribute[] {
  return (attrs ?? []).map((raw) => {
    const a = raw as HrAttribute;
    const items: HrAttributeItem[] = (Array.isArray(a.items) ? a.items : []).map((it, idx) => {
      if (typeof it === 'string') return { id: `itm_${idx}_${a.id}`, name: it };
      const o = it as HrAttributeItem;
      return { id: o.id ?? `itm_${idx}_${a.id}`, name: o.name ?? String(o) };
    });
    return { ...a, items };
  });
}

/** 拼接“为什么预警”的判断规则描述，如：如果未开单天数大于平均未开单天数，提醒 */
function buildConditionDesc(nodes: FlowNode[]): string {
  const opLabel = (op: string | undefined) => OPERATOR_OPTIONS.find((o) => o.value === op)?.label ?? String(op ?? '');
  const parts: string[] = [];
  for (const nd of nodes) {
    if (nd.kind !== 'condition') continue;
    const cd = (nd.data ?? {}) as Partial<ConditionNodeData>;
    const rightOf = (c: ConditionItem, op?: string): string => {
      if (op === 'empty' || op === 'notEmpty') return op === 'empty' ? '为空' : '不为空';
      if (c.refNode?.label) return c.refNode.label;
      if (c.rightSource === 'node' && c.refNode?.label) return c.refNode.label;
      const vals = (c.values ?? []).filter((v: string) => v !== '');
      return vals.length ? vals.join('、') : (c.values?.includes('') ? '空' : '');
    };
    // 多条件组优先（判断节点的实际存储在 conditions 数组，右值可能是值集合或引用节点标量）
    if (cd.conditions && cd.conditions.length) {
      const join = cd.conditionJoin === 'or' ? ' 或 ' : ' 且 ';
      const inner = cd.conditions.map((c) => {
        const left = c.colLabel || c.col || '该值';
        const op = opLabel(c.op);
        const right = rightOf(c, c.op);
        return `如果 ${left} ${op} ${right}`;
      });
      parts.push(inner.join(join));
    } else {
      const left = cd.leftNode?.label || cd.fieldLabel || '该值';
      const op = opLabel(cd.operator);
      let right = cd.value ?? '';
      if (cd.operator === 'between') {
        right = `${cd.value} 到 ${cd.valueMax}`;
      } else if (cd.valueSource === 'node') {
        right = cd.refNode?.label || right;
      } else if (cd.valueSource === 'field') {
        right = (cd.refValue as { fieldLabel?: string } | undefined)?.fieldLabel || right;
      }
      parts.push(`如果 ${left} ${op} ${right}`);
    }
  }
  return parts.join(' 且 ') || '';
}

/** 依据规则里配置的预警动作节点生成预警工单（不含 id/时间戳，由 ADD_ALERT 落库时补齐） */
export interface BuildAlertCtx {
  stores?: Store[];
  employees?: Employee[];
  persons?: Person[];
}

export function buildAlertsForRule(
  rule: AlertRule,
  tables?: DataTable[],
  ctx?: BuildAlertCtx
): Omit<AlertTask, 'id' | 'createdAt' | 'updatedAt'>[] {
  const base: { id: string; data: ActionNodeData }[] = [];
  for (const nd of rule.flow.nodes) {
    if (nd.kind === 'action' && nd.data && (nd.data as ActionNodeData).enabled !== false) {
      base.push({ id: nd.id, data: nd.data as ActionNodeData });
    }
  }
  if (base.length === 0) base.push({ id: '', data: { level: 'warn' as const, title: rule.name } });
  const targets = rule.targets;
  // 触发时对规则求值，取每个预警动作的命中明细作为“预览数据”
  let evalMap: Record<string, NodePreview> | undefined;
  if (tables && tables.length) {
    try {
      evalMap = evaluateFlow(rule.flow.nodes, rule.flow.edges, tables);
    } catch {
      evalMap = undefined;
    }
  }
  const conditionDesc = buildConditionDesc(rule.flow.nodes);
  return base.flatMap((a) => {
    const notify = a.data.notify;
    const actionTitle = a.data.title?.trim() || rule.name;
    const hit = a.id ? evalMap?.[a.id] : undefined;
    const rawTpl = a.data.content?.trim() || '';
    // 店仓列：优先取含“店/仓”的列，否则首个字符串列
    const storeCol = hit && hit.columns
      ? (hit.columns.find((c) => /店|仓/.test(c)) ?? hit.columns[0])
      : undefined;
    const hitRows = hit && hit.rows && hit.rows.length ? hit.rows.slice(0, 200) : [];
    const renderMsg = (row: Record<string, unknown>, fallback: string): string => {
      if (!rawTpl) return fallback;
      return rawTpl.replace(/\{([^}]+)\}/g, (_m, f: string) => {
        const st = String(row[f] ?? '');
        return st === 'undefined' || st === '' ? '' : st;
      }).trim();
    };
    const storeMessages = hitRows.length
      ? hitRows.map((row) => {
          const r = row as Record<string, unknown>;
          return {
            store: storeCol ? String(r[storeCol] ?? '') : '',
            message: renderMsg(r, `${rule.name} 命中预警，请及时处理`),
          };
        })
      : undefined;
    const preview = hit && hitRows.length
      ? { columns: hit.columns, rows: hitRows, ...(storeMessages ? { storeMessages } : {}) }
      : undefined;
    // 类型/重要等级 → 兼容 level；字段模板替换（列表预览取第一行）
    const type = a.data.type;
    const priority = a.data.priority;
    const lv =
      type === 'remind' ? 'remind'
      : type === 'alert' ? (priority === 'Important&Urgent' || priority === 'Urgent' ? 'critical' : 'warn')
      : (a.data.level ?? ('warn' as const));
    let content = a.data.content?.trim();
    if (content && hit && hitRows.length && hit.columns) {
      content = renderMsg(hitRows[0] as Record<string, unknown>, content);
    }
    // 按通知方式（mode）解析通知对象：store=命中门店；employee=命中门店所属员工；person=管理了命中门店/员工的人员
    let recipients: { mode: NotifyMode; names: string[] }[] | undefined;
    const m = notify?.mode ?? 'manual';
    const hitStoreNames = Array.from(
      new Set((storeMessages ?? []).map((s) => s.store).filter(Boolean))
    );
    const storesList = ctx?.stores ?? [];
    const hitStoreById = hitStoreNames.length
      ? storesList.filter((s) => hitStoreNames.includes(s.name))
      : storesList;
    if (m === 'store') {
      const names = Array.from(
        new Set(hitStoreById.length ? hitStoreById.map((s) => s.name) : hitStoreNames)
      );
      recipients = [{ mode: m, names }];
    } else if (m === 'employee') {
      const emps = (ctx?.employees ?? []).filter(
        (e) => e.enabled !== false && (!hitStoreById.length || e.storeId === undefined || hitStoreById.some((s) => s.id === e.storeId))
      );
      recipients = [{ mode: m, names: emps.map((e) => e.name) }];
    } else if (m === 'person') {
      const pers = (ctx?.persons ?? []).filter((p) => {
        if (p.enabled === false) return false;
        const ids = p.manageScope?.storeIds ?? [];
        if (!ids.length) return false;
        const byScope = hitStoreById.length === 0 || hitStoreById.some((s) => ids.includes(s.id));
        if (!byScope) return false;
        const posFilter = notify?.personPositions ?? [];
        if (posFilter.length && !(p.title && posFilter.includes(p.title))) return false;
        const postFilter = notify?.personPosts ?? [];
        if (postFilter.length && !(p.post && postFilter.includes(p.post))) return false;
        return true;
      });
      recipients = [{ mode: m, names: pers.map((p) => p.name) }];
    }
    const mk = (title: string, storeMsg?: { store?: string; message?: string; }) => {
      const curStores = storeMsg
        ? [{ store: storeMsg.store || actionTitle, message: storeMsg.message || content || `${rule.name} · ${actionTitle} 已触发，请及时处理` }]
        : (storeMessages ?? []);
      const curNames =
        m === 'store' && curStores.length
          ? Array.from(new Set(curStores.map((s) => s.store).filter(Boolean)))
          : (recipients?.[0]?.names ?? []);
      return {
        ruleId: rule.id,
        ruleName: rule.name,
        level: lv,
        priority: type === 'alert' ? priority : undefined,
        title: actionTitle,
        content: storeMsg?.message || content || `${rule.name} · ${actionTitle} 已触发，请及时处理`,
        reason: rule.description || `${rule.name} 命中「${actionTitle}」预警动作，达到触发条件`,
        conditionDesc: conditionDesc || undefined,
        preview: {
          columns: preview?.columns ?? [],
          rows: preview?.rows ?? [],
          ...(curStores.length ? { storeMessages: curStores } : {}),
          ...(recipients ? { recipients: [{ mode: m, names: curNames }] } : {}),
        },
        createdBy: '系统',
        dept: notify?.departments?.[0] ?? targets?.departments?.[0] ?? '',
        assignee: curNames.length
          ? `${curNames.slice(0, 3).join('、')}${curNames.length > 3 ? ' 等' : ''}`
          : (notify?.personnel?.[0] ?? targets?.personnel?.[0] ?? ''),
        status: 'new' as const,
      };
    };
    if (m === 'store' && storeMessages?.length) {
      return storeMessages.map((sm) => mk(actionTitle, sm));
    }
    return [mk(actionTitle)];
  });
}

const LS_KEY = 'alert-platform-v1';
const STATE_API = '/api/state';
/** 远端持久化是否可用（首次拉取成功后置为 true） */
let remoteAvailable = false;

/** 从服务端数据库拉取持久化数据 */
async function fetchRemoteState(): Promise<Partial<AppState> | null> {
  try {
    const res = await fetch(STATE_API, { cache: 'no-store' });
    if (!res.ok) return null;
    const json = (await res.json()) as { tables?: DataTable[]; rules?: AlertRule[]; alerts?: AlertTask[]; groups?: RuleGroup[]; orgs?: Organization[]; persons?: Person[]; employees?: Employee[]; hrAttributes?: HrAttribute[]; dealers?: Dealer[]; stores?: Store[]; config?: HomeConfig; error?: string };
    if (json.error) return null;
    remoteAvailable = true;
    return { tables: json.tables ?? [], rules: json.rules ?? [], alerts: json.alerts ?? [], ruleGroups: json.groups ?? [], orgs: json.orgs ?? [], persons: json.persons ?? [], employees: json.employees ?? [], hrAttributes: json.hrAttributes ?? [], dealers: json.dealers ?? [], stores: json.stores ?? [], config: normalizeHomeConfig(json.config) };
  } catch {
    return null;
  }
}

/** 本地缓存里是否有用户数据（用于首次迁移到数据库） */
function readLocalCache(): { tables: DataTable[]; rules: AlertRule[] } | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const parsed = migrateState(JSON.parse(raw) as AppState);
    if (!parsed || !Array.isArray(parsed.tables)) return null;
    // 内置示例表（id=tbl-sample）不算用户数据
    const tables = parsed.tables.filter((t) => t.id !== 'tbl-sample');
    return { tables, rules: parsed.rules ?? [] };
  } catch {
    return null;
  }
}

/** 把当前状态全量同步到服务端数据库（失败静默，保留本地缓存） */
async function pushRemoteState(state: AppState) {
  // 远程尚未确认可用（例如刚打开页面时 GET /api/state 失败）时，
  // 在每次写库前重新探测：连上则自愈为可同步，避免整个会话只存 localStorage。
  if (!remoteAvailable) {
    try {
      const ping = await fetchRemoteState();
      if (!ping || !ping.tables) return; // 仍不可用则放弃本次，本地缓存继续兜底
    } catch {
      return;
    }
  }
  try {
    await fetch(STATE_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tables: state.tables, rules: state.rules, alerts: state.alerts, groups: state.ruleGroups ?? [], orgs: state.orgs ?? [], persons: state.persons ?? [], employees: state.employees ?? [], hrAttributes: state.hrAttributes ?? [], dealers: state.dealers ?? [], stores: state.stores ?? [], config: state.config }),
    });
  } catch {
    /* 网络异常时忽略，localStorage 仍有兜底 */
  }
}

export interface AppState {
  tables: DataTable[];
  rules: AlertRule[];
  activeTableId: string;
  /** 当前规则构建所用到的数据表 id（多表支持） */
  builderTableIds: string[];
  /** 预警（由规则触发的待处理告警实例） */
  alerts: AlertTask[];
  /** 规则分组 */
  ruleGroups: RuleGroup[];
  /** 组织架构（平级分类组织） */
  orgs: Organization[];
  /** 人事架构（挂载在组织下的人员） */
  persons: Person[];
  employees: Employee[];
  /** 员工（组织架构下，可登录系统） */
  /** 人事属性字典（部门管理/职位管理/岗位管理等，每属性含多条目） */
  hrAttributes: HrAttribute[];
  /** 经销商字典 */
  dealers: Dealer[];
  /** 店仓字典 */
  stores: Store[];
  /** 登录页/首页展示配置 */
  config: HomeConfig;
}

type StoreApi = {
  state: AppState;
  /** 数据是否已完成首屏加载（从远端/本地恢复） */
  ready: boolean;
  /** 远端数据库持久化是否可用 */
  remotePersist: boolean;
  // tables
  addTable: (t: DataTable) => void;
  updateTable: (id: string, patch: Partial<DataTable>) => void;
  removeTable: (id: string) => void;
  setActiveTable: (id: string) => void;
  setBuilderTables: (ids: string[]) => void;
  renameField: (tableId: string, fieldKey: string, alias: string) => void;
  setFieldType: (tableId: string, fieldKey: string, type: DataTable['fields'][number]['type']) => void;
  // rules
  addRule: (r: AlertRule) => void;
  updateRule: (id: string, patch: Partial<AlertRule>) => void;
  removeRule: (id: string, clearAlerts?: boolean) => void;
  activateRule: (id: string) => void;
  // execution
  updateExecution: (ruleId: string, execId: string, patch: Partial<ExecutionRecord>) => void;
  // alerts
  addAlert: (a: Omit<AlertTask, 'id' | 'createdAt' | 'updatedAt'>) => void;
  updateAlertStatus: (id: string, patch: Partial<AlertTask>) => void;
  // groups
  addRuleGroup: (name: string) => RuleGroup;
  updateRuleGroup: (id: string, name: string) => void;
  removeRuleGroup: (id: string) => void;
  // organizations
  addOrg: (o: Omit<Organization, 'id' | 'createdAt'>) => Organization;
  updateOrg: (o: Organization) => void;
  removeOrg: (id: string) => void;
  moveOrg: (id: string, dir: -1 | 1) => void;
  // persons
  addPerson: (p: Omit<Person, 'id' | 'createdAt'>) => Person;
  updatePerson: (p: Person) => void;
  removePerson: (id: string) => void;
  // employees
  addEmployee: (p: Omit<Employee, 'id' | 'createdAt'>) => Employee;
  updateEmployee: (p: Employee) => void;
  removeEmployee: (id: string) => void;
  replEmployees: (list: (Omit<Employee, 'id' | 'createdAt'>)[]) => void;
  // hr attributes
  addHrAttribute: (a: Omit<HrAttribute, 'id' | 'createdAt'>) => HrAttribute;
  updateHrAttribute: (a: HrAttribute) => void;
  removeHrAttribute: (id: string) => void;
  // dealers
  addDealer: (d: Omit<Dealer, 'id' | 'createdAt'>) => Dealer;
  updateDealer: (d: Dealer) => void;
  removeDealer: (id: string) => void;
  moveDealer: (id: string, dir: -1 | 1) => void;
  // stores
  addStore: (s: Omit<Store, 'id' | 'createdAt'>) => Store;
  updateStore: (s: Store) => void;
  removeStore: (id: string) => void;
  moveStore: (id: string, dir: -1 | 1) => void;
  updateHomeConfig: (patch: Partial<HomeConfig> | ((c: HomeConfig) => HomeConfig)) => void;
  resetAll: () => void;
};

const StoreContext = createContext<StoreApi | null>(null);

function migrateState(raw: AppState | null): AppState {
  if (!raw || !Array.isArray(raw.tables)) {
    return loadInitialState();
  }
  // 兼容旧版：dataTableId → tableIds
  const rules = (raw.rules ?? []).map((r) => {
    const legacyTableId = (r as { dataTableId?: string }).dataTableId;
    const tableIds =
      Array.isArray(r.tableIds) && r.tableIds.length
        ? r.tableIds
        : legacyTableId
          ? [legacyTableId]
          : [];
    return { ...r, tableIds };
  });
  return { ...raw, tables: raw.tables.map((t) => ({ ...t, fields: ensureFieldsComplete(t.fields ?? [], t.rows ?? []) })), rules, builderTableIds: Array.isArray(raw.builderTableIds) ? raw.builderTableIds : [], alerts: Array.isArray(raw.alerts) ? raw.alerts : [], orgs: Array.isArray(raw.orgs) ? raw.orgs : [], persons: Array.isArray(raw.persons) ? raw.persons : [], hrAttributes: normalizeHrAttrs((Array.isArray(raw.hrAttributes) ? raw.hrAttributes : []).filter((a) => (a.category ?? 'person') !== ('org' as never))), dealers: Array.isArray(raw.dealers) ? raw.dealers : [], stores: Array.isArray(raw.stores) ? raw.stores : [], employees: Array.isArray(raw.employees) ? raw.employees : [], config: normalizeHomeConfig(raw.config) };
}

function loadInitial(): AppState {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      return migrateState(JSON.parse(raw) as AppState);
    }
  } catch {
    /* ignore */
  }
  // 首次进入：内置一份示例数据表，便于直接演示
  return loadInitialState();
}

function makeDefaultSchedule(): Schedule {
  const now = new Date();
  const next = new Date(now.getTime() + 24 * 3600 * 1000);
  return {
    repeatType: 'daily',
    timeOfDay: '09:00',
    weekdays: [1, 2, 3, 4, 5],
    monthDays: [1, 15],
    customInterval: 3,
    startDate: formatYmd(now),
    endDate: formatYmd(new Date(now.getTime() + 90 * 24 * 3600 * 1000)),
    nextTriggerAt: next.toISOString(),
  };
}

function formatYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function makeDefaultRule(): AlertRule {
  return {
    id: uid('rule'),
    name: '',
    description: '',
    tableIds: [],
    status: 'draft',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    flow: { nodes: [], edges: [] },
    schedule: makeDefaultSchedule(),
    targets: { departments: [], personnel: [] },
    executions: [],
  };
}

function reducer(state: AppState, action: { type: string; payload?: unknown }): AppState {
  switch (action.type) {
    case 'ADD_TABLE': {
      const t = action.payload as DataTable;
      return { ...state, tables: [...state.tables, t], activeTableId: t.id };
    }
    case 'UPDATE_TABLE': {
      const { id, patch } = action.payload as { id: string; patch: Partial<DataTable> };
      return { ...state, tables: state.tables.map((t) => (t.id === id ? { ...t, ...patch } : t)) };
    }
    case 'REMOVE_TABLE': {
      const id = action.payload as string;
      // 已有规则引用该数据表时禁止删除（需先删除/解除关联规则），避免删表连带丢失规则
      if (state.rules.some((r) => r.tableIds?.includes(id))) return state;
      const tables = state.tables.filter((t) => t.id !== id);
      return {
        ...state,
        tables,
        activeTableId: state.activeTableId === id ? tables[0]?.id ?? '' : state.activeTableId,
      };
    }
    case 'SET_ACTIVE_TABLE':
      return { ...state, activeTableId: action.payload as string };
    case 'SET_BUILDER_TABLES': {
      const ids = action.payload as string[];
      if (ids.length === state.builderTableIds.length && ids.every((v, i) => v === state.builderTableIds[i])) {
        return state; // 内容未变，复用旧引用，避免配置器 effect 无限循环
      }
      return { ...state, builderTableIds: ids };
    }
    case 'RENAME_FIELD': {
      const { tableId, fieldKey, alias } = action.payload as { tableId: string; fieldKey: string; alias: string };
      return {
        ...state,
        tables: state.tables.map((t) =>
          t.id === tableId
            ? { ...t, fields: t.fields.map((f) => (f.key === fieldKey ? { ...f, alias } : f)) }
            : t
        ),
      };
    }
    case 'SET_FIELD_TYPE': {
      const { tableId, fieldKey, type } = action.payload as {
        tableId: string;
        fieldKey: string;
        type: DataTable['fields'][number]['type'];
      };
      return {
        ...state,
        tables: state.tables.map((t) =>
          t.id === tableId ? { ...t, fields: t.fields.map((f) => (f.key === fieldKey ? { ...f, type } : f)) } : t
        ),
      };
    }
    case 'ADD_RULE': {
      // 幂等：同 id 规则已存在则覆盖，避免重复保存/双击产生重复规则
      const r = action.payload as AlertRule;
      return state.rules.some((x) => x.id === r.id)
        ? { ...state, rules: state.rules.map((x) => (x.id === r.id ? { ...r, updatedAt: Date.now() } : x)) }
        : { ...state, rules: [...state.rules, r] };
    }
    case 'UPDATE_RULE': {
      const { id, patch } = action.payload as { id: string; patch: Partial<AlertRule> };
      return {
        ...state,
        rules: state.rules.map((r) => (r.id === id ? { ...r, ...patch, updatedAt: Date.now() } : r)),
      };
    }
    case 'REMOVE_RULE': {
      const { id, clearAlerts } = (action.payload ?? {}) as { id: string; clearAlerts?: boolean };
      return {
        ...state,
        rules: state.rules.filter((r) => r.id !== id),
        ...(clearAlerts ? { alerts: state.alerts.filter((a) => a.ruleId !== id) } : {}),
      };
    }
    case 'UPDATE_EXECUTION': {
      const { ruleId, execId, patch } = action.payload as {
        ruleId: string;
        execId: string;
        patch: Partial<ExecutionRecord>;
      };
      return {
        ...state,
        rules: state.rules.map((r) =>
          r.id === ruleId
            ? {
                ...r,
                executions: r.executions.map((e) => (e.id === execId ? { ...e, ...patch } : e)),
                updatedAt: Date.now(),
              }
            : r
        ),
      };
    }
    case 'UPDATE_ALERT': {
      const { alertId, patch } = action.payload as { alertId: string; patch: Partial<AlertTask> };
      return {
        ...state,
        alerts: state.alerts.map((a) => (a.id === alertId ? { ...a, ...patch, updatedAt: Date.now() } : a)),
      };
    }
    case 'ADD_ALERT': {
      const raw = action.payload as Partial<AlertTask>;
      if (isBlankAlert(raw)) return state;
      const now = Date.now();
      const alert: AlertTask = {
        id: raw.id ?? `alert_${now}_${Math.random().toString(36).slice(2, 7)}`,
        createdAt: raw.createdAt ?? now,
        updatedAt: raw.updatedAt ?? now,
        ruleId: raw.ruleId ?? '',
        ruleName: raw.ruleName ?? '',
        level: raw.level ?? 'warn',
        title: raw.title ?? '',
        content: raw.content ?? '',
        reason: raw.reason,
        conditionDesc: raw.conditionDesc,
        preview: raw.preview,
        dept: raw.dept ?? '',
        assignee: raw.assignee ?? '',
        status: raw.status ?? 'new',
        handoffTo: raw.handoffTo,
      };
      return { ...state, alerts: [alert, ...state.alerts] };
    }
    case 'ADD_RULE_GROUP': {
      const g = action.payload as RuleGroup;
      if (!g || !g.id || !String(g.name ?? '').trim()) return state;
      if (state.ruleGroups.some((x) => x.id === g.id || x.name === g.name)) return state;
      return { ...state, ruleGroups: [g, ...state.ruleGroups] };
    }
    case 'REMOVE_RULE_GROUP': {
      const id = action.payload as string;
      return {
        ...state,
        ruleGroups: state.ruleGroups.filter((g) => g.id !== id),
        rules: state.rules.map((r) => (r.groupId === id ? { ...r, groupId: '' } : r)),
      };
    }
    case 'UPDATE_RULE_GROUP': {
      const { id, name } = action.payload as { id: string; name: string };
      const n = String(name ?? '').trim();
      if (!id || !n) return state;
      return { ...state, ruleGroups: state.ruleGroups.map((g) => (g.id === id ? { ...g, name: n } : g)) };
    }
    case 'REPLACE_GROUPS':
      return { ...state, ruleGroups: Array.isArray(action.payload) ? (action.payload as RuleGroup[]) : state.ruleGroups };
    // 组织架构
    case 'ADD_ORG': {
      const o = action.payload as Organization;
      if (state.orgs.some((x) => x.id === o.id)) return state;
      return { ...state, orgs: [...state.orgs, o] };
    }
    case 'UPDATE_ORG': {
      const { id, patch } = action.payload as { id: string; patch: Partial<Organization> };
      return { ...state, orgs: state.orgs.map((o) => (o.id === id ? { ...o, ...patch } : o)) };
    }
    case 'REMOVE_ORG': {
      const id = action.payload as string;
      return {
        ...state,
        orgs: state.orgs.filter((o) => o.id !== id),
        persons: state.persons.map((p) => (p.orgId === id ? { ...p, orgId: '' } : p)),
      };
    }
    case 'REPLACE_ORGS':
      return { ...state, orgs: Array.isArray(action.payload) ? (action.payload as Organization[]) : state.orgs };
    // 员工管理
    case 'ADD_EMPLOYEE': {
      if (state.employees.some((x) => x.id === (action.payload as Employee).id)) return state;
      return { ...state, employees: [...state.employees, action.payload as Employee] };
    }
    case 'UPDATE_EMPLOYEE': {
      const { id, patch } = action.payload as { id: string; patch: Employee };
      return { ...state, employees: state.employees.map((x) => (x.id === id ? { ...x, ...patch, id } : x)) };
    }
    case 'REMOVE_EMPLOYEE': {
      const id = action.payload as string;
      return { ...state, employees: state.employees.filter((e) => e.id !== id) };
    }
    case 'REPLACE_EMPLOYEES':
      return { ...state, employees: Array.isArray(action.payload) ? (action.payload as Employee[]) : state.employees };
    // 人事架构
    case 'ADD_PERSON': {
      const p = action.payload as Person;
      if (state.persons.some((x) => x.id === p.id)) return state;
      return { ...state, persons: [...state.persons, p] };
    }
    case 'UPDATE_PERSON': {
      const { id, patch } = action.payload as { id: string; patch: Partial<Person> };
      return { ...state, persons: state.persons.map((p) => (p.id === id ? { ...p, ...patch } : p)) };
    }
    case 'REMOVE_PERSON': {
      const id = action.payload as string;
      return {
        ...state,
        persons: state.persons
          .filter((p) => p.id !== id)
          .map((p) => (p.supervisorId === id ? { ...p, supervisorId: undefined } : p)),
      };
    }
    case 'REPLACE_PERSONS':
      return { ...state, persons: Array.isArray(action.payload) ? (action.payload as Person[]) : state.persons };
    // 员工管理
    case 'ADD_EMPLOYEE': {
      const e = action.payload as Employee;
      if (state.employees.some((x) => x.id === e.id)) return state;
      return { ...state, employees: [...state.employees, e] };
    }
    case 'UPDATE_EMPLOYEE': {
      const { id, patch } = action.payload as { id: string; patch: Partial<Employee> };
      return { ...state, employees: state.employees.map((e) => (e.id === id ? { ...e, ...patch } : e)) };
    }
    case 'REMOVE_EMPLOYEE':
      return { ...state, employees: state.employees.filter((e) => e.id !== (action.payload as string)) };
    case 'REPLACE_EMPLOYEES':
      return { ...state, employees: Array.isArray(action.payload) ? (action.payload as Employee[]) : state.employees };
    // 人事属性字典
    case 'ADD_HRATTR': {
      const a = action.payload as HrAttribute;
      if (state.hrAttributes.some((x) => x.id === a.id)) return state;
      return { ...state, hrAttributes: [...state.hrAttributes, a] };
    }
    case 'UPDATE_HRATTR': {
      const { id, patch } = action.payload as { id: string; patch: Partial<HrAttribute> };
      return { ...state, hrAttributes: state.hrAttributes.map((a) => (a.id === id ? { ...a, ...patch } : a)) };
    }
    case 'REMOVE_HRATTR': {
      const id = action.payload as string;
      return { ...state, hrAttributes: state.hrAttributes.filter((a) => a.id !== id) };
    }
    case 'REPLACE_HRATTRIBUTES':
      return { ...state, hrAttributes: Array.isArray(action.payload) ? (action.payload as HrAttribute[]) : state.hrAttributes };
    // 经销商字典
    case 'ADD_DEALER': {
      const d = action.payload as Dealer;
      if (state.dealers.some((x) => x.id === d.id)) return state;
      return { ...state, dealers: [...state.dealers, d] };
    }
    case 'UPDATE_DEALER': {
      const { id, patch } = action.payload as { id: string; patch: Partial<Dealer> };
      return { ...state, dealers: state.dealers.map((d) => (d.id === id ? { ...d, ...patch } : d)) };
    }
    case 'REMOVE_DEALER': {
      const id = action.payload as string;
      return { ...state, dealers: state.dealers.filter((d) => d.id !== id) };
    }
    case 'REPLACE_DEALERS':
      return { ...state, dealers: Array.isArray(action.payload) ? (action.payload as Dealer[]) : state.dealers };
    // 店仓字典
    case 'ADD_STORE': {
      const s = action.payload as Store;
      if (state.stores.some((x) => x.id === s.id)) return state;
      return { ...state, stores: [...state.stores, s] };
    }
    case 'UPDATE_STORE': {
      const { id, patch } = action.payload as { id: string; patch: Partial<Store> };
      return { ...state, stores: state.stores.map((s) => (s.id === id ? { ...s, ...patch } : s)) };
    }
    case 'REMOVE_STORE': {
      const id = action.payload as string;
      return { ...state, stores: state.stores.filter((s) => s.id !== id) };
    }
    case 'REPLACE_STORES':
      return { ...state, stores: Array.isArray(action.payload) ? (action.payload as Store[]) : state.stores };
    // 员工
    case 'ADD_EMPLOYEE': {
      const e = action.payload as Employee;
      if (state.employees.some((x) => x.id === e.id)) return state;
      return { ...state, employees: [...state.employees, e] };
    }
    case 'UPDATE_EMPLOYEE': {
      const { id, patch } = action.payload as { id: string; patch: Partial<Employee> };
      return { ...state, employees: state.employees.map((e) => (e.id === id ? { ...e, ...patch } : e)) };
    }
    case 'REMOVE_EMPLOYEE': {
      const id = action.payload as string;
      return { ...state, employees: state.employees.filter((e) => e.id !== id) };
    }
    case 'REPLACE_EMPLOYEES':
      return { ...state, employees: Array.isArray(action.payload) ? (action.payload as Employee[]) : state.employees };
    case 'UPDATE_CONFIG': {
      const patch = action.payload as HomeConfig | ((c: HomeConfig) => HomeConfig);
      return { ...state, config: typeof patch === 'function' ? patch(state.config) : { ...state.config, ...patch } };
    }
    case 'RESET':
      return loadInitialState();
    default:
      return state;
  }
}

function loadInitialState(): AppState {
  const sample = buildSampleTable();
  const t: DataTable = {
    id: 'tbl-sample',
    name: '示例-订单数据集',
    fileName: 'orders-sample.xlsx',
    createdAt: Date.now(),
    rowCount: sample.rowCount,
    fields: sample.fields,
    previewRows: sample.previewRows,
    rows: sample.rows,
  };
  return { tables: [t], rules: [], activeTableId: t.id, builderTableIds: [t.id], alerts: [], ruleGroups: [], orgs: [], persons: [], hrAttributes: [], dealers: [], stores: [], employees: [], config: DEFAULT_HOME_CONFIG };
}

const EMPTY_STATE: AppState = { tables: [], rules: [], activeTableId: '', builderTableIds: [], alerts: [], ruleGroups: [], orgs: [], persons: [], hrAttributes: [], dealers: [], stores: [], employees: [], config: DEFAULT_HOME_CONFIG };

export function StoreProvider({ children }: { children: React.ReactNode }) {
  // 初始统一为空，避免 SSR 与客户端首帧不一致导致 Hydration 报错；
  // 挂载后优先从服务端数据库恢复，失败时回退 localStorage（含示例数据表）。
  const [state, setState] = useState<AppState>(EMPTY_STATE);
  const [ready, setReady] = useState(false);
  const [remotePersist, setRemotePersist] = useState(false);
  const loaded = useRef(false);
  const pushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const remote = await fetchRemoteState();
      if (cancelled) return;
      if (remote && remote.tables) {
        let tables = remote.tables ?? [];
        let rules = remote.rules ?? [];
        // 数据库为空但本地缓存有用户数据：一次性迁移到数据库
        if (tables.length === 0 && rules.length === 0) {
          const cache = readLocalCache();
          if (cache && (cache.tables.length > 0 || cache.rules.length > 0)) {
            tables = cache.tables;
            rules = cache.rules;
            void pushRemoteState({
              tables,
              rules,
              config: state.config,
              alerts: state.alerts ?? [],
              ruleGroups: state.ruleGroups ?? [],
              orgs: state.orgs ?? [],
              persons: state.persons ?? [],
              hrAttributes: state.hrAttributes ?? [],
              dealers: state.dealers ?? [],
              stores: state.stores ?? [],
              employees: state.employees ?? [],
              activeTableId: tables[0]?.id ?? '',
              builderTableIds: tables.map((t) => t.id),
            });
          }
        }
        setState((s) => ({
          ...s,
          tables: (tables ?? []).map((t) => ({ ...t, fields: ensureFieldsComplete(t.fields ?? [], t.rows ?? []) })),
          rules,
          ruleGroups: remote.ruleGroups ?? [],
          alerts: (remote.alerts ?? []).filter((a) => !isBlankAlert(a)),
          orgs: remote.orgs ?? [],
          persons: remote.persons ?? [],
          hrAttributes: normalizeHrAttrs((remote.hrAttributes ?? []).filter((a) => (a.category ?? 'person') !== ('org' as never))),
          dealers: remote.dealers ?? [],
          stores: remote.stores ?? [],
          employees: remote.employees ?? [],
          config: normalizeHomeConfig(remote.config),
          activeTableId: tables[0]?.id ?? '',
          builderTableIds: tables.map((t) => t.id),
        }));
        setRemotePersist(true);
      } else {
        // 远端不可用：回退本地缓存，首次进入使用内置示例表
        setState(loadInitial());
      }
      loaded.current = true;
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
    // 仅在挂载时加载一次远端数据，后续通过 setState 更新
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 状态变化：本地缓存兜底 + 防抖同步到服务端数据库
  useEffect(() => {
    if (!loaded.current) return;
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(state));
    } catch {
      /* ignore */
    }
    if (pushTimer.current) clearTimeout(pushTimer.current);
    pushTimer.current = setTimeout(() => {
      void pushRemoteState(state);
    }, 600);
    return () => {
      if (pushTimer.current) clearTimeout(pushTimer.current);
    };
  }, [state]);

  const api = useMemo<StoreApi>(() => {
    const dispatch = (t: string, payload?: unknown) => setState((s) => reducer(s, { type: t, payload }));
    return {
      state,
      ready,
      remotePersist,
      addTable: (t) => dispatch('ADD_TABLE', t),
      updateTable: (id, patch) => dispatch('UPDATE_TABLE', { id, patch }),
      removeTable: (id) => dispatch('REMOVE_TABLE', id),
      setActiveTable: (id) => dispatch('SET_ACTIVE_TABLE', id),
      setBuilderTables: (ids) => dispatch('SET_BUILDER_TABLES', ids),
      renameField: (tableId, fieldKey, alias) => dispatch('RENAME_FIELD', { tableId, fieldKey, alias }),
      setFieldType: (tableId, fieldKey, type) => dispatch('SET_FIELD_TYPE', { tableId, fieldKey, type }),
      addRule: (r) => dispatch('ADD_RULE', r),
      updateRule: (id, patch) => dispatch('UPDATE_RULE', { id, patch }),
      activateRule: (id) => {
        const rule = state.rules.find((r) => r.id === id);
        if (!rule) return;
        const alerts = buildAlertsForRule(rule, state.tables, { stores: state.stores ?? [], employees: state.employees ?? [], persons: state.persons ?? [] });
        const seen = new Set<string>();
        for (const a of alerts) {
          const key = `${a.ruleId}|${a.level}|${a.title}|${a.dept ?? ''}|${a.assignee ?? ''}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const hit = state.alerts.find(
            (x) => x.ruleId === a.ruleId && x.level === a.level && x.title === a.title && x.dept === a.dept && x.assignee === a.assignee
          );
          if (hit) dispatch('UPDATE_ALERT', { id: hit.id, patch: { ...a, updatedAt: Date.now() } });
          else dispatch('ADD_ALERT', a);
        }
        if (rule.status !== 'active') dispatch('UPDATE_RULE', { id, patch: { status: 'active' } });
      },
      removeRule: (id, clearAlerts) => dispatch('REMOVE_RULE', { id, clearAlerts: !!clearAlerts }),
      updateExecution: (ruleId, execId, patch) => dispatch('UPDATE_EXECUTION', { ruleId, execId, patch }),
      addRuleGroup: (name) => {
        const n = String(name ?? '').trim();
        const g: RuleGroup = { id: uid('group'), name: n, createdAt: Date.now() };
        dispatch('ADD_RULE_GROUP', g);
        return g;
      },
      removeRuleGroup: (id) => dispatch('REMOVE_RULE_GROUP', id),
      updateRuleGroup: (id, name) => dispatch('UPDATE_RULE_GROUP', { id, name }),
      addAlert: (alert) => dispatch('ADD_ALERT', alert),
      updateAlertStatus: (alertId, patch) => dispatch('UPDATE_ALERT', { alertId, patch }),
      addOrg: (o) => {
        const org: Organization = { ...o, id: uid('org'), createdAt: Date.now() };
        dispatch('ADD_ORG', org);
        return org;
      },
      updateOrg: (o) => dispatch('UPDATE_ORG', { id: o.id, patch: o }),
      removeOrg: (id) => dispatch('REMOVE_ORG', id),
      replEmployees: (list) => dispatch('REPLACE_EMPLOYEES', list),
      addEmployee: (e) => {
        const emp: Employee = { ...e, id: uid('emp'), createdAt: Date.now() };
        dispatch('ADD_EMPLOYEE', emp);
        return emp;
      },
      updateEmployee: (e) => dispatch('UPDATE_EMPLOYEE', { id: e.id, patch: e }),
      removeEmployee: (id) => dispatch('REMOVE_EMPLOYEE', id),
      addPerson: (p) => {
        const person: Person = { ...p, id: uid('person'), createdAt: Date.now() };
        dispatch('ADD_PERSON', person);
        return person;
      },
      updatePerson: (p) => dispatch('UPDATE_PERSON', { id: p.id, patch: p }),
      removePerson: (id) => dispatch('REMOVE_PERSON', id),
      addHrAttribute: (a) => {
        const attr: HrAttribute = { id: uid('hrattr'), name: a.name, items: a.items ?? [], sort: a.sort ?? state.hrAttributes.length, category: a.category ?? 'person', createdAt: Date.now() };
        dispatch('ADD_HRATTR', attr);
        return attr;
      },
      updateHrAttribute: (a) => dispatch('UPDATE_HRATTR', { id: a.id, patch: a }),
      removeHrAttribute: (id) => dispatch('REMOVE_HRATTR', id),
      addDealer: (d) => {
        const dealer: Dealer = { ...d, id: uid('dealer'), sort: d.sort ?? state.dealers.length, createdAt: Date.now() };
        dispatch('ADD_DEALER', dealer);
        return dealer;
      },
      updateDealer: (d) => dispatch('UPDATE_DEALER', { id: d.id, patch: d }),
      removeDealer: (id) => dispatch('REMOVE_DEALER', id),
      moveDealer: (id, dir) => {
        const arr = [...state.dealers].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
        const idx = arr.findIndex((d) => d.id === id);
        const swapWith = arr[idx + dir];
        if (idx < 0 || !swapWith) return;
        dispatch('UPDATE_DEALER', { id, patch: { sort: swapWith.sort } });
        dispatch('UPDATE_DEALER', { id: swapWith.id, patch: { sort: arr[idx].sort } });
      },
      addStore: (s) => {
        const store: Store = { ...s, id: uid('store'), sort: s.sort ?? state.stores.length, createdAt: Date.now() };
        dispatch('ADD_STORE', store);
        return store;
      },
      updateStore: (s) => dispatch('UPDATE_STORE', { id: s.id, patch: s }),
      removeStore: (id) => dispatch('REMOVE_STORE', id),
      moveStore: (id, dir) => {
        const arr = [...state.stores].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
        const idx = arr.findIndex((s) => s.id === id);
        const swapWith = arr[idx + dir];
        if (idx < 0 || !swapWith) return;
        dispatch('UPDATE_STORE', { id, patch: { sort: swapWith.sort } });
        dispatch('UPDATE_STORE', { id: swapWith.id, patch: { sort: arr[idx].sort } });
      },
      updateHomeConfig: (patch) => dispatch('UPDATE_CONFIG', patch),
      moveOrg: (id, dir) => {
        const target = state.orgs.find((o) => o.id === id);
        if (!target) return;
        const siblings = state.orgs
          .filter((o) => (o.parentId ?? '') === (target.parentId ?? ''))
          .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
        const idx = siblings.findIndex((o) => o.id === id);
        const swapWith = siblings[idx + dir];
        if (!swapWith || idx < 0) return;
        const newTarget = { ...target, sort: swapWith.sort };
        const newSwap = { ...swapWith, sort: target.sort };
        dispatch('UPDATE_ORG', { id: target.id, patch: newTarget });
        dispatch('UPDATE_ORG', { id: swapWith.id, patch: newSwap });
      },
      resetAll: () => dispatch('RESET'),
    };
  }, [state, ready, remotePersist]);

  return <StoreContext.Provider value={api}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreApi {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used within StoreProvider');
  return ctx;
}

// ---- 工具 ----

export function formatDate(input: string | number): string {
  const d = new Date(input);
  if (isNaN(d.getTime())) return '-';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function formatDateTime(input: string | number): string {
  const d = new Date(input);
  if (isNaN(d.getTime())) return '-';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${day} ${h}:${min}`;
}

/** 依据调度配置计算下一次触发时间 */
export function computeNextTrigger(sche: Schedule, from: Date = new Date()): string {
  const base = new Date(from);
  // 基础时间：当天 timeOfDay
  const [hh, mm] = (sche.timeOfDay || '09:00').split(':').map(Number);
  const candidate = new Date(base);
  candidate.setHours(hh, mm, 0, 0);

  if (sche.repeatType === 'once') {
    return candidate > base ? candidate.toISOString() : addDays(candidate, 0).toISOString();
  }
  if (sche.repeatType === 'daily') {
    while (candidate <= base) candidate.setDate(candidate.getDate() + 1);
    return candidate.toISOString();
  }
  if (sche.repeatType === 'weekly') {
    const daySet = new Set(sche.weekdays.length ? sche.weekdays : [1, 2, 3, 4, 5]);
    for (let i = 0; i < 8; i++) {
      const wd = candidate.getDay() === 0 ? 7 : candidate.getDay();
      if (daySet.has(wd) && candidate > base) return candidate.toISOString();
      candidate.setDate(candidate.getDate() + 1);
    }
    return candidate.toISOString();
  }
  if (sche.repeatType === 'monthly') {
    const daySet = new Set(sche.monthDays.length ? sche.monthDays : [1, 15]);
    for (let i = 0; i <= 62; i++) {
      if (daySet.has(candidate.getDate()) && candidate > base) return candidate.toISOString();
      candidate.setDate(candidate.getDate() + 1);
    }
    return candidate.toISOString();
  }
  // custom
  const interval = Math.max(1, sche.customInterval || 1);
  while (candidate <= base) candidate.setDate(candidate.getDate() + interval);
  return candidate.toISOString();
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

/** 生成待办执行记录（pending），用于在激活规则时写入一次 */
export function createPendingExecution(ruleId: string, scheduledAt: string): ExecutionRecord {
  return {
    id: uid('exec'),
    ruleId,
    scheduledAt,
    triggeredAt: scheduledAt,
    status: 'pending',
    history: [],
  };
}

export type { TargetSetting };