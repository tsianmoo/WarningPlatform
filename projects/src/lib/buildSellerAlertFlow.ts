import { createNodeData } from '@/components/flow/nodes';
import type { FlowEdge, FlowNode } from '@/lib/types';

/** 数据结构形态（仅依赖我们关心的字段，避免强耦合具体表类型） */
type Tbl = { id: string; name: string; fields: Array<{ key: string; alias?: string; type?: string }> };

export type BuiltFlow = { nodes: FlowNode[]; edges: FlowEdge[] };

function pickTbl(tables: Tbl[], keys: string[]): Tbl | undefined {
  return tables.find((t) => keys.some((k) => t.name.toLowerCase().includes(k)));
}
function pickField(fields: Tbl['fields'], keys: string[]) {
  return fields.find((f) => keys.some((k) => (f.alias || f.key).toLowerCase().includes(k)));
}
function uniq(seed: string): string {
  return `${seed}_${Math.random().toString(36).slice(2, 7)}`;
}
function n(
  seed: string,
  kind: FlowNode['kind'],
  x: number,
  y: number,
  data: Record<string, unknown>
): FlowNode {
  return { id: uniq(seed), type: kind, kind, position: { x, y }, data } as unknown as FlowNode;
}
function e(src: FlowNode, tgt: FlowNode): FlowEdge {
  return { id: `${src.id}->${tgt.id}`, source: src.id, target: tgt.id } as FlowEdge;
}

/**
 * 一键搭建「销量第一名款色的有销售 / 无销售门店预警」
 * 流程：零售表 → 排名取数(销量第一款色) ；店仓表全集 ──反匹配排查(diff)──> 无销售门店 → 预警动作
 */
export function buildSellerAlertFlow(tables: Tbl[]): BuiltFlow {
  const retail = pickTbl(tables, ['零售', '销售']);
  const store = pickTbl(tables, ['店仓', '门店', '店铺']);

  const haveRetail = !!retail;
  const haveStore = !!store;
  const storeName = store?.name ?? '';
  const retailName = retail?.name ?? '';

  const storeFld = store ? pickField(store.fields, ['店仓', '门店', '店铺']) : undefined;
  const colorFld = retail ? pickField(retail.fields, ['款色', '款号', '颜色', 'sku', '商品']) : undefined;
  const qtyFld = retail ? pickField(retail.fields, ['销量', '数量', '销售']) : undefined;
  const dateFld = retail ? pickField(retail.fields, ['日期', '时间', 'date', 'day']) : undefined;

  const storeKey = storeFld?.key ?? '';
  const storeLabel = storeFld?.alias || storeFld?.key || '店仓';
  const colorKey = colorFld?.key ?? '';
  const colorLabel = colorFld?.alias || colorFld?.key || '款色';
  const qtyKey = qtyFld?.key ?? '';
  const qtyLabel = qtyFld?.alias || qtyFld?.key || '销售数量';
  const dateKey = dateFld?.key ?? '';
  const dateLabel = dateFld?.alias || dateFld?.key || '日期';

  // —— 基础数据源 ——
  const baseRetail = n('retail', 'base', 0, 0, {
    ...createNodeData('base'),
    tableId: retail?.id ?? '',
    tableName: retailName,
    fieldKey: qtyKey,
    fieldLabel: qtyLabel,
    resultLabel: '零售销售明细',
  });
  const baseStore = n('store', 'base', 260, 0, {
    ...createNodeData('base'),
    tableId: store?.id ?? '',
    tableName: storeName,
    fieldKey: storeKey,
    fieldLabel: storeLabel,
    resultLabel: '所有店仓（全集）',
  });

  // —— 排名第一的款色 ——
  const topn = n('topn', 'topn', 520, 0, {
    ...createNodeData('topn'),
    tableId: retail?.id ?? '',
    tableName: retailName,
    groupField: colorKey,
    groupFieldLabel: colorLabel,
    metricField: qtyKey,
    metricFieldLabel: qtyLabel,
    metricFn: 'sum',
    order: 'desc',
    topN: 1,
    dateField: dateKey,
    dateFieldLabel: dateLabel,
    timeWindow: { preset: 'all' },
    resultLabel: '销量第一名款色',
  });

  // —— 反匹配排查：该款色在全集店仓中无销售的门店 ——
  const diff = n('diff', 'diff', 780, 0, {
    ...createNodeData('diff'),
    baseTableId: store?.id ?? '',
    baseTableName: storeName,
    baseField: storeKey,
    baseFieldLabel: storeLabel,
    checkTableId: retail?.id ?? '',
    checkTableName: retailName,
    checkField: storeKey,
    checkFieldLabel: storeLabel,
    filterField: colorKey,
    filterFieldLabel: colorLabel,
    filterValueSource: 'topn',
    filterValue: '',
    dateField: dateKey,
    dateFieldLabel: dateLabel,
    timeWindow: { preset: 'all' },
    resultLabel: '无销售门店',
  });

  // —— 预警动作 ——
  const action = n('act', 'action', 1040, 0, {
    ...createNodeData('action'),
    level: 'warn',
    title: '销量第一名款色 · 无销售门店预警',
    content: `销量第一名款色在这些门店没有销售，请关注库存与铺货。`,
    notify: { departments: [], personnel: [] },
    resultLabel: '无销售门店预警',
  });

  const nodes: FlowNode[] = [baseRetail, baseStore, topn, diff, action];
  const edges: FlowEdge[] = [];
  if (haveRetail) edges.push(e(baseRetail, topn));
  if (haveStore && haveRetail) edges.push(e(baseStore, diff), e(topn, diff));
  if (haveStore && haveRetail) edges.push(e(diff, action));

  return { nodes, edges };
}

export { pickTbl };