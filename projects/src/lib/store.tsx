'use client';

import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AlertRule,
  AlertTask,
  AlertDims,
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
  DataTableGroup,
  Schedule,
  TargetSetting,
  NotifyMode,
  HomeConfig,
  RolePerm,
  PersonPermOverride,
  LinkViewTab,
  LinkViewNodeData,
  DeadlineSetting,
} from './types';
import { uid, OPERATOR_OPTIONS, DEFAULT_HOME_CONFIG, normalizeHomeConfig } from './types';
import { buildSampleTable, ensureFieldsComplete } from './parser';
import { evaluateFlow } from './evaluate';
import type { NodePreview } from './evaluate';
import type { ActionNodeData, ConditionItem, ConditionNodeData, FlowNode, MsgPart } from './types';
import { manageStoreIds } from './perm';

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

/** 门店档案 → 店仓各筛选维度的取值（同时兼容顶层字段与 attrs 字典中的中文字段） */
function storeDimValues(st: Store): { brand?: string; company?: string; department?: string; salesArea?: string; district?: string } {
  const a = st.attrs ?? {};
  return {
    brand: st.brand || a['主营品牌'] || a['品牌'],
    company: st.company || a['所属分公司'] || a['分公司'],
    department: st.department || a['所属部门'] || a['部门'],
    salesArea: st.salesArea || a['销售区域'],
    district: st.district || a['区部'],
  };
}

/** 商品列别名映射（列名可能是中文或英文） */
function productCol(columns: string[], aliases: string[]): string | undefined {
  const hit = aliases.find((al) => columns.some((c) => (c || '').trim() === al));
  return hit;
}

/**
 * 从预警自身命中内容提取可筛选维度（商品/店仓）：
 * - 商品：扫描预览 rows 里「品牌/年份/季节/品类/款色」列的取值，去重。
 * - 店仓：由 storeIds 或 storeMessages[].store 反查门店档案的 主营品牌/分公司/部门/销售区域/区部。
 * 供筛选时取值，也兼容旧预警（无 dims 时按此补算）。
 */
export function computeAlertDims(
  a: { storeIds?: string[]; preview?: AlertTask['preview'] },
  stores: Store[]
): AlertDims | undefined {
  const dims: AlertDims = {};

  const columns = a.preview?.columns ?? [];
  const rows = (a.preview?.rows ?? []).slice(0, 200);
  if (columns.length && rows.length) {
    const pick = (aliases: string[]): string[] => {
      const col = productCol(columns, aliases);
      if (!col) return [];
      return Array.from(new Set(rows.map((r) => String((r as Record<string, unknown>)[col] ?? '').trim()).filter(Boolean)));
    };
    const brand = pick(['品牌', '品牌名', 'brand']);
    const year = pick(['年份', 'year', '年']);
    const season = pick(['季节', 'season']);
    const category = pick(['品类', '类别', 'category', '大类']);
    const style = pick(['款色', '款号', '款', 'style', 'SKU', '款色编码']);
    const product: AlertDims['product'] = {};
    if (brand.length) product.brand = brand;
    if (year.length) product.year = year;
    if (season.length) product.season = season;
    if (category.length) product.category = category;
    if (style.length) product.style = style;
    if (Object.keys(product).length) dims.product = product;
  }

  // 店仓维度：优先 storeIds；旧预警无 storeIds 时用 storeMessages 的店仓名回退匹配
  let sts: Store[] = [];
  const sids = (a.storeIds ?? []).filter(Boolean);
  if (sids.length) sts = stores.filter((s) => sids.includes(s.id));
  if (!sts.length) {
    const names = new Set<string>();
    (a.preview?.storeMessages ?? []).forEach((sm) => sm.store && names.add(sm.store));
    if (names.size) sts = stores.filter((s) => names.has(s.name));
  }
  if (sts.length) {
    const uniq = (f: (st: Store) => string | undefined): string[] =>
      Array.from(new Set(sts.map(f).filter(Boolean))) as string[];
    const store: AlertDims['store'] = {};
    const brand = uniq((st) => storeDimValues(st).brand);
    const company = uniq((st) => storeDimValues(st).company);
    const department = uniq((st) => storeDimValues(st).department);
    const salesArea = uniq((st) => storeDimValues(st).salesArea);
    const district = uniq((st) => storeDimValues(st).district);
    if (brand.length) store.brand = brand;
    if (company.length) store.company = company;
    if (department.length) store.department = department;
    if (salesArea.length) store.salesArea = salesArea;
    if (district.length) store.district = district;
    if (Object.keys(store).length) dims.store = store;
  }

  return Object.keys(dims).length ? dims : undefined;
}

const DEADLINE_UNIT_MS: Record<DeadlineSetting['unit'], number> = {
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
  week: 604_800_000,
  month: 30 * 86_400_000,
};

/** 依据开始组件「规定用时」计算某次预警的到期时刻（时间戳，未启用返回 undefined） */
export function calcDeadline(from: number, d?: DeadlineSetting): number | undefined {
  if (!d || !d.enabled) return undefined;
  const [hh, mm] = (d.clock || '18:00').split(':').map((x) => Number(x) || 0);
  const dayClock = hh * 3_600_000 + mm * 60_000;
  if (d.kind === 'duration') {
    const v = Math.max(0, Number(d.value) || 0);
    return from + v * (DEADLINE_UNIT_MS[d.unit ?? 'minute'] ?? DEADLINE_UNIT_MS.minute);
  }
  if (d.kind === 'weekly') {
    const target = (((d.weekday ?? 1) % 7) + 7) % 7 || 7; // 1-7 → JS 周日=0
    let date = new Date(from);
    let weekdayJS = date.getDay(); // 0=周日
    if (weekdayJS === 0) weekdayJS = 7;
    let diff = target - weekdayJS;
    if (diff < 0 || (diff === 0 && from % 86_400_000 >= dayClock)) diff += 7;
    const at = new Date((from - (from % 86_400_000)) + diff * 86_400_000 + dayClock);
    return at.getTime();
  }
  // monthly：下一个月指定的「号」+ 时点
  const md = Math.min(31, Math.max(1, Number(d.monthDay) || 1));
  let base = new Date(from);
  let year = base.getFullYear();
  let month = base.getMonth();
  const clamp = (y: number, mo: number) => Math.min(md, new Date(y, mo + 1, 0).getDate());
  let cand = new Date(year, month, clamp(year, month));
  if (cand.getTime() < from || (cand.getTime() <= from - (from % 86_400_000) + dayClock - 1 && cand.getDate() === base.getDate() && cand.getMonth() === base.getMonth())) {
    // 本次已过 → 下月
    year = month === 11 ? year + 1 : year;
    month = (month + 1) % 12;
    cand = new Date(year, month, clamp(year, month));
  }
  return new Date(year, month, cand.getDate(), hh, mm, 0, 0).getTime();
}

const DEADLINE_UNIT_LABEL: Record<string, string> = { minute: '分钟', hour: '小时', day: '天', week: '周', month: '个月' };
const WEEKDAY_LABEL: Record<string, string> = { '1': '周一', '2': '周二', '3': '周三', '4': '周四', '5': '周五', '6': '周六', '7': '周日' };

/** 把「规定用时」配置渲染为可读文案（如 30 分钟 / 每周五 18:00 / 每月 3 号 09:00），未启用返回空 */
export function describeDeadlineText(d?: DeadlineSetting): string {
  if (!d || !d.enabled) return '';
  if (d.kind === 'duration') {
    const v = Math.max(0, Number(d.value) || 0);
    return `${v || 0} ${DEADLINE_UNIT_LABEL[d.unit ?? 'minute'] ?? d.unit ?? ''}`;
  }
  const clock = d.clock || '18:00';
  if (d.kind === 'weekly') return `每周${WEEKDAY_LABEL[String(d.weekday ?? 5) ] ?? ''} ${clock}`;
  return `每月${d.monthDay ?? 1} 号 ${clock}`;
}

/** 超时动作「转派对象」配置 → 具体人员名单（复用通知对象的选择方式：person 按职位/岗位；manual 手动选中人员） */
function resolveEscalateNames(t?: TargetSetting, ctx?: BuildAlertCtx): string[] {
  const mode = t?.mode ?? 'manual';
  const persons = ctx?.persons ?? [];
  if (mode === 'person') {
    const posF = t?.personPositions ?? [];
    const postF = t?.personPosts ?? [];
    return persons
      .filter((p) => p.enabled !== false && (!posF.length || (p.title && posF.includes(p.title))) && (!postF.length || (p.post && postF.includes(p.post))))
      .map((p) => p.name);
  }
  return (t?.personnel ?? []).slice();
}

/**
 * 激活前置校验：预警规则必须包含「超时动作」节点；
 * 若该节点开关开启，则必须已配置规定用时 + 指定转派人员，否则不允许激活。
 * 返回错误提示；无错误时返回空串。
 */
export function validateRuleTimeout(r: AlertRule): string {
  const tNodes = r.flow.nodes.filter((n) => n.kind === 'timeout');
  if (tNodes.length === 0) return '请至少添加一个「超时动作」节点，配置完成后才能激活';
  for (const tn of tNodes) {
    const data = tn.data as unknown as { deadline?: DeadlineSetting; escalateTarget?: TargetSetting };
    const d = data?.deadline;
    if (!d || !d.enabled) continue; // 开关关闭：允许直接激活
    const okDeadline = d.kind === 'duration' ? (d.value ?? 0) > 0 && !!d.unit : !!d.clock;
    if (!okDeadline) return '已开启「超时动作」，请先配置规定用时';
    const esc = data?.escalateTarget;
    const okEsc =
      !!esc &&
      (esc.mode === 'manual' ? (esc.personnel ?? []).length > 0 : (esc.personPositions ?? []).length > 0 || (esc.personPosts ?? []).length > 0);
    if (!okEsc) return '已开启「超时动作」，超时后必须指定转派人员';
  }
  return '';
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
  // 超时动作：按「关联的预警动作」把处理时限与转派对象挂到对应动作上（动作知道了才知超期转交谁）
  const dlTimeout = new Map<string, { deadline?: DeadlineSetting; escalateTarget?: TargetSetting }>();
  for (const tn of rule.flow.nodes) {
    if (tn.kind !== 'timeout' || !tn.data) continue;
    const td = tn.data as unknown as { actionId?: string; deadline?: DeadlineSetting; escalateTarget?: TargetSetting };
    dlTimeout.set(td.actionId || '', { deadline: td.deadline, escalateTarget: td.escalateTarget });
  }
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
    // 消息分段：变量字段段 isVar=true，供查看预警弹窗加粗紫色展示（模板结构在每行一致）
    const renderParts = (row: Record<string, unknown>): MsgPart[] => {
      if (!rawTpl) return [];
      const parts: MsgPart[] = [];
      let last = 0;
      const re = /\{([^}]+)\}/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(rawTpl))) {
        if (m.index > last) parts.push({ t: rawTpl.slice(last, m.index) });
        const st = String(row[m[1]] ?? '');
        parts.push({ t: st === 'undefined' || st === '' ? '' : st, isVar: true });
        last = m.index + m[0].length;
      }
      if (last < rawTpl.length) parts.push({ t: rawTpl.slice(last) });
      return parts;
    };
    const storeMessages = hitRows.length
      ? hitRows.map((row) => {
          const r = row as Record<string, unknown>;
          return {
            store: storeCol ? String(r[storeCol] ?? '') : '',
            message: renderMsg(r, `${rule.name} 命中预警，请及时处理`),
            parts: renderParts(r),
          };
        })
      : undefined;
    // 预警关联展示：一个或多个「预警关联展示」节点，动作节点上可勾选是否在本弹窗展示；关联数据按每条预警自己的命中行重算
    const lvNodes = rule.flow.nodes.filter((n) => n.kind === 'linkview' || n.kind === 'linkview_all');
    const tableRowsOf = (t?: DataTable): Array<Record<string, string | number>> =>
      (t && t.rows && t.rows.length ? t.rows : (t?.previewRows ?? [])) as unknown as Array<Record<string, string | number>>;
    const resolveLv = (lv: FlowNode, rows: Array<Record<string, string | number>>): NodePreview['linkviewData'] | undefined => {
      const tabsCfg: LinkViewTab[] = Array.isArray((lv.data as LinkViewNodeData).tabs) ? ((lv.data as LinkViewNodeData).tabs ?? []) : [];
      if (!tabsCfg.length) return { enabled: false, tabs: [] };
      const isAll = lv.kind === 'linkview_all';
      const tabs = tabsCfg.map((tab) => {
        // 匹配键字段对：基础表字段(baseField) ↔ 关联表字段(relField)；基础表即本条预警自己的命中行
        const pairs = (Array.isArray(tab.matchKeys) ? tab.matchKeys : []).filter((k) => k && k.baseField && k.relField);
        let srcRows: Array<Record<string, string | number>> = [];
        let colNames: string[] = [];
        if (tab.source === 'node' && tab.srcNode) {
          const o = evalMap?.[tab.srcNode];
          if (o && Array.isArray(o.rows)) {
            srcRows = o.rows as unknown as Array<Record<string, string | number>>;
            colNames = o.columns ?? [];
          }
        } else {
          const t = (tables ?? []).find((x) => x.id === tab.tableId);
          if (t) {
            srcRows = tableRowsOf(t);
            colNames = t.fields.map((f) => f.key);
          }
        }
        // 全量模式：按匹配字段过滤（基础表字段↔关联表字段），展示匹配来源的全部行；未配置匹配或基础无行时展示全部
        const filtered = srcRows.filter((sr) => {
          if (!pairs.length || !rows.length) return true;
          return rows.some((mr) => pairs.every((k) => String(sr[k.relField ?? ''] ?? '') === String(mr[k.baseField ?? ''] ?? '')));
        });
        // 返回列：勾选则只保留这些列；未勾选默认返回来源全部列
        const rcList = (Array.isArray(tab.returnCols) ? tab.returnCols : []).map((c) => String(c)).filter((c) => c && colNames.includes(c));
        const projCols = rcList.length ? rcList : colNames;
        const projRows = filtered.map((sr) => {
          const o: Record<string, string | number> = {};
          projCols.forEach((c) => {
            if (c in sr) o[c] = sr[c] as string | number;
          });
          return o;
        });
        return {
          name: tab.name || tab.tableName || tab.srcNodeLabel || '关联',
          all: isAll,
          source: tab.source,
          tableName: tab.source === 'table' ? tab.tableName : undefined,
          srcNodeLabel: tab.source === 'node' ? tab.srcNodeLabel : undefined,
          matchKeys: pairs,
          columns: projCols,
          rows: projRows.slice(0, 200),
        };
      });
      return { enabled: true, tabs };
    };
    // 动作上勾选的展示集合：未配置时视为全部 linkview 均展示
    const lvEnabled: Map<string, boolean> = new Map();
    (Array.isArray(a.data.linkviews) ? a.data.linkviews : []).forEach((li) => lvEnabled.set(li.id, !!li.enabled));
    const lvLabel = (n: FlowNode) => {
      const rd = n.data as Record<string, unknown>;
      return typeof rd?.resultLabel === 'string' && rd.resultLabel ? rd.resultLabel : (n.kind === 'linkview_all' ? '预警关联展示-全量' : '预警关联展示');
    };
    const buildLinkviews = (rows: Array<Record<string, string | number>>): Array<{ label: string; linkview: NonNullable<NodePreview['linkviewData']> }> =>
      lvNodes
        .filter((n) => (lvEnabled.size ? lvEnabled.get(n.id) !== false : true))
        .map((n) => ({ label: lvLabel(n), linkview: resolveLv(n, rows) ?? { enabled: false, tabs: [] } }));
    const hit0Parts = hitRows[0] ? renderParts(hitRows[0] as Record<string, unknown>) : undefined;
    const preview = hit && hitRows.length
      ? {
          columns: hit.columns,
          rows: hitRows,
          ...(storeMessages ? { storeMessages } : {}),
          ...(hit0Parts ? { msgParts: hit0Parts } : {}),
        }
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
        const ids = manageStoreIds(p, ctx?.stores ?? []);
        if (!ids.size) return false;
        const byScope = hitStoreById.length === 0 || hitStoreById.some((s) => ids.has(s.id));
        if (!byScope) return false;
        const posFilter = notify?.personPositions ?? [];
        if (posFilter.length && !(p.title && posFilter.includes(p.title))) return false;
        const postFilter = notify?.personPosts ?? [];
        if (postFilter.length && !(p.post && postFilter.includes(p.post))) return false;
        return true;
      });
      recipients = [{ mode: m, names: pers.map((p) => p.name) }];
    }
    const mk = (title: string, storeMsg?: { store?: string; message?: string; parts?: MsgPart[] }) => {
      const tcfg = dlTimeout.get(a.id) ?? dlTimeout.get('');
      const dl = calcDeadline(Date.now(), tcfg?.deadline);
      const escNames = tcfg?.escalateTarget ? resolveEscalateNames(tcfg.escalateTarget, ctx) : (tcfg?.deadline?.escalateTo ?? []);
      const deadlineFields = dl === undefined
        ? {}
        : {
            deadlineAt: dl,
            deadlineLabel: describeDeadlineText(tcfg?.deadline),
            graceMinutes: tcfg?.deadline?.graceMinutes ?? 20,
            graceUntil: dl + ((tcfg?.deadline?.graceMinutes ?? 20) * 60_000),
            escalateTo: escNames,
            escalated: false,
          };
      const curStores = storeMsg
        ? [{ store: storeMsg.store || actionTitle, message: storeMsg.message || content || `${rule.name} · ${actionTitle} 已触发，请及时处理` }]
        : (storeMessages ?? []);
      const curNames =
        m === 'store' && curStores.length
          ? Array.from(new Set(curStores.map((s) => s.store).filter(Boolean)))
          : (recipients?.[0]?.names ?? []);
      const alertRows = (storeMsg?.store && storeCol
        ? (preview?.rows ?? []).filter((r) => String(r[storeCol] ?? '') === storeMsg.store)
        : (preview?.rows ?? [])) as Array<Record<string, string | number>>;
      const alertLinkviews = buildLinkviews(alertRows);
      const obj = {
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
          rows: alertRows,
          ...(curStores.length ? { storeMessages: curStores } : {}),
          ...(recipients ? { recipients: [{ mode: m, names: curNames }] } : {}),
          ...((storeMsg?.parts ?? hit0Parts) ? { msgParts: storeMsg?.parts ?? hit0Parts } : {}),
          ...(alertLinkviews.length ? { linkviews: alertLinkviews.map((x) => ({ label: x.label, linkview: x.linkview })), linkview: alertLinkviews[0].linkview } : {}),
        },
        createdBy: '系统',
        dept: notify?.departments?.[0] ?? targets?.departments?.[0] ?? '',
        assignee: curNames.length
          ? `${curNames.slice(0, 3).join('、')}${curNames.length > 3 ? ' 等' : ''}`
          : (notify?.personnel?.[0] ?? targets?.personnel?.[0] ?? ''),
        storeIds: Array.from(new Set(curStores.map((s) => storesList.find((x) => x.name === s.store)?.id).filter(Boolean) as string[])),
        dealerIds: Array.from(new Set(storesList.filter((x) => curStores.some((s) => s.store === x.name)).map((x) => x.dealerId).filter(Boolean) as string[])),
        notified: curNames.slice(),
        ...deadlineFields,
        status: 'new' as const,
      };
      return { ...obj, dims: computeAlertDims(obj, storesList) };
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
    const json = (await res.json()) as { tables?: DataTable[]; rules?: AlertRule[]; alerts?: AlertTask[]; groups?: RuleGroup[]; tableGroups?: DataTableGroup[]; orgs?: Organization[]; persons?: Person[]; employees?: Employee[]; hrAttributes?: HrAttribute[]; dealers?: Dealer[]; stores?: Store[]; config?: HomeConfig; error?: string };
    if (json.error) return null;
    remoteAvailable = true;
    return { tables: json.tables ?? [], rules: json.rules ?? [], alerts: json.alerts ?? [], ruleGroups: json.groups ?? [], tableGroups: json.tableGroups ?? [], orgs: json.orgs ?? [], persons: json.persons ?? [], employees: json.employees ?? [], hrAttributes: json.hrAttributes ?? [], dealers: json.dealers ?? [], stores: json.stores ?? [], config: normalizeHomeConfig(json.config) };
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
      body: JSON.stringify({ tables: state.tables, rules: state.rules, alerts: state.alerts, groups: state.ruleGroups ?? [], tableGroups: state.tableGroups ?? [], orgs: state.orgs ?? [], persons: state.persons ?? [], employees: state.employees ?? [], hrAttributes: state.hrAttributes ?? [], dealers: state.dealers ?? [], stores: state.stores ?? [], config: { ...state.config, permissions: state.permissions ?? [], permOverrides: state.permOverrides ?? [] } }),
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
  /** 数据表分组（文件夹）实体 */
  tableGroups: DataTableGroup[];
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
  /** 权限配置：岗位权限表 */
  permissions: RolePerm[];
  /** 权限配置：单用户覆盖 */
  permOverrides: PersonPermOverride[];
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
  // data table groups
  addTableGroup: (name: string) => DataTableGroup;
  updateTableGroup: (id: string, newName: string) => void;
  removeTableGroup: (id: string) => void;
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
  setPermissions: (roles: RolePerm[]) => void;
  setPermOverrides: (ovs: PersonPermOverride[]) => void;
  /** 立即把当前状态同步到服务端（跳过防抖），用于「保存」按钮等强一致场景 */
  flushNow: () => void;
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
  const cfg = normalizeHomeConfig(raw.config);
  return { ...raw, tables: raw.tables.map((t) => ({ ...t, fields: ensureFieldsComplete(t.fields ?? [], t.rows ?? []) })), rules, builderTableIds: Array.isArray(raw.builderTableIds) ? raw.builderTableIds : [], alerts: Array.isArray(raw.alerts) ? raw.alerts : [], orgs: Array.isArray(raw.orgs) ? raw.orgs : [], persons: Array.isArray(raw.persons) ? raw.persons : [], hrAttributes: normalizeHrAttrs((Array.isArray(raw.hrAttributes) ? raw.hrAttributes : []).filter((a) => (a.category ?? 'person') !== ('org' as never))), dealers: Array.isArray(raw.dealers) ? raw.dealers : [], stores: Array.isArray(raw.stores) ? raw.stores : [], employees: Array.isArray(raw.employees) ? raw.employees : [], config: cfg, permissions: Array.isArray(cfg.permissions) ? cfg.permissions : (Array.isArray(raw.permissions) ? raw.permissions : []), permOverrides: Array.isArray(cfg.permOverrides) ? cfg.permOverrides : (Array.isArray(raw.permOverrides) ? raw.permOverrides : []) };
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
    case 'ADD_TABLE_GROUP': {
      const g = action.payload as DataTableGroup;
      if (!g || !g.id || !String(g.name ?? '').trim()) return state;
      if (state.tableGroups.some((x) => x.id === g.id || x.name === g.name)) return state;
      return { ...state, tableGroups: [...state.tableGroups, g] };
    }
    case 'REMOVE_TABLE_GROUP': {
      const id = action.payload as string;
      const gone = state.tableGroups.find((g) => g.id === id);
      return {
        ...state,
        tableGroups: state.tableGroups.filter((g) => g.id !== id),
        // 分组删除后组内数据表归回未分组，表本身不删
        tables: gone ? state.tables.map((t) => (t.group === gone.name ? { ...t, group: '' } : t)) : state.tables,
      };
    }
    case 'UPDATE_TABLE_GROUP': {
      const { id, name } = action.payload as { id: string; name: string };
      const n = String(name ?? '').trim();
      const old = state.tableGroups.find((g) => g.id === id);
      if (!old || !n || old.name === n) return state;
      return {
        ...state,
        tableGroups: state.tableGroups.map((g) => (g.id === id ? { ...g, name: n } : g)),
        tables: state.tables.map((t) => (t.group === old.name ? { ...t, group: n } : t)),
      };
    }
    case 'REPLACE_TABLE_GROUPS':
      return { ...state, tableGroups: Array.isArray(action.payload) ? (action.payload as DataTableGroup[]) : state.tableGroups };
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
    case 'SET_PERMISSIONS':
      return { ...state, permissions: Array.isArray(action.payload) ? (action.payload as RolePerm[]) : state.permissions };
    case 'SET_PERM_OVERRIDES':
      return { ...state, permOverrides: Array.isArray(action.payload) ? (action.payload as PersonPermOverride[]) : state.permOverrides };
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
  return { tables: [t], rules: [], activeTableId: t.id, builderTableIds: [t.id], alerts: [], ruleGroups: [], tableGroups: [], orgs: [], persons: [], hrAttributes: [], dealers: [], stores: [], employees: [], config: DEFAULT_HOME_CONFIG, permissions: [], permOverrides: [] };
}

const EMPTY_STATE: AppState = { tables: [], rules: [], activeTableId: '', builderTableIds: [], alerts: [], ruleGroups: [], tableGroups: [], orgs: [], persons: [], hrAttributes: [], dealers: [], stores: [], employees: [], config: DEFAULT_HOME_CONFIG, permissions: [], permOverrides: [] };

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
              tableGroups: state.tableGroups ?? [],
              orgs: state.orgs ?? [],
              persons: state.persons ?? [],
              hrAttributes: state.hrAttributes ?? [],
              dealers: state.dealers ?? [],
              stores: state.stores ?? [],
              employees: state.employees ?? [],
              permissions: state.permissions ?? [],
              permOverrides: state.permOverrides ?? [],
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
          tableGroups: remote.tableGroups ?? [],
          alerts: (remote.alerts ?? []).filter((a) => !isBlankAlert(a)),
          orgs: remote.orgs ?? [],
          persons: remote.persons ?? [],
          hrAttributes: normalizeHrAttrs((remote.hrAttributes ?? []).filter((a) => (a.category ?? 'person') !== ('org' as never))),
          dealers: remote.dealers ?? [],
          stores: remote.stores ?? [],
          employees: remote.employees ?? [],
          config: normalizeHomeConfig(remote.config),
          permissions: Array.isArray((remote.config as HomeConfig | undefined)?.permissions) ? ((remote.config as HomeConfig).permissions ?? []) : (s.permissions ?? []),
          permOverrides: Array.isArray((remote.config as HomeConfig | undefined)?.permOverrides) ? ((remote.config as HomeConfig).permOverrides ?? []) : (s.permOverrides ?? []),
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

  // 页面关闭/刷新前强制兜底落库，避免防抖未触发导致本次改动丢失
  useEffect(() => {
    const flush = () => {
      if (pushTimer.current) clearTimeout(pushTimer.current);
      try {
        const payload = JSON.stringify({
          tables: state.tables, rules: state.rules, alerts: state.alerts, groups: state.ruleGroups ?? [], tableGroups: state.tableGroups ?? [], orgs: state.orgs ?? [], persons: state.persons ?? [], employees: state.employees ?? [], hrAttributes: state.hrAttributes ?? [], dealers: state.dealers ?? [], stores: state.stores ?? [], config: { ...state.config, permissions: state.permissions ?? [], permOverrides: state.permOverrides ?? [] },
        });
        navigator.sendBeacon(STATE_API, new Blob([payload], { type: 'application/json' }));
      } catch { /* 忽略 */ }
    };
    window.addEventListener('beforeunload', flush);
    return () => window.removeEventListener('beforeunload', flush);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
          if (hit) {
            // 重新构建的预警仅刷新可再生数据；保留已产生的处理状态与内容(状态/处理人/时间/方案/留言/计划)
            const { status: _s, assignee: _as, acceptedAt: _ac, startedAt: _sa, handledAt: _ha, resolution: _rs, failedReason: _fr, comments: _cm, plan: _pl, ...fresh } = a;
            dispatch('UPDATE_ALERT', { id: hit.id, patch: { ...fresh, updatedAt: Date.now() } });
          }
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
      addTableGroup: (name) => {
        const n = String(name ?? '').trim();
        const g: DataTableGroup = { id: uid('tg'), name: n, createdAt: Date.now() };
        dispatch('ADD_TABLE_GROUP', g);
        return g;
      },
      removeTableGroup: (id) => dispatch('REMOVE_TABLE_GROUP', id),
      updateTableGroup: (id, name) => dispatch('UPDATE_TABLE_GROUP', { id, name }),
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
      setPermissions: (roles) => dispatch('SET_PERMISSIONS', roles),
      setPermOverrides: (ovs) => dispatch('SET_PERM_OVERRIDES', ovs),
      flushNow: () => {
        if (pushTimer.current) clearTimeout(pushTimer.current);
        void pushRemoteState(state);
      },
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