import { evaluateFlow } from '../src/lib/evaluate';
import type { FlowNode, FlowEdge, DataTable } from '../src/lib/types';

const table: DataTable = {
  id: 't1',
  name: '销售表',
  fields: [
    { key: '款色', name: '款色', type: 'string' },
    { key: '尺寸名', name: '尺寸名', type: 'string' },
    { key: '库存', name: '库存', type: 'number' },
    { key: '销量', name: '销量', type: 'number' },
  ],
  rows: [
    { 款色: 'A', 尺寸名: '170/88A', 库存: 10, 销量: 3 },
    { 款色: 'A', 尺寸名: '175/92A', 库存: 20, 销量: 6 },
    { 款色: 'B', 尺寸名: '170/88A', 库存: 5, 销量: 1 },
  ],
} as unknown as DataTable;

// 上游：基础数据节点透传全表明细（多列），含 款色/尺寸名/库存/销量
const up: FlowNode = {
  id: 'n1',
  kind: 'base',
  position: { x: 0, y: 0 },
  data: {
    tableId: 't1',
    columns: [
      { key: '款色', label: '款色' },
      { key: '尺寸名', label: '尺寸名' },
      { key: '库存', label: '库存' },
      { key: '销量', label: '销量' },
    ],
  },
} as unknown as FlowNode;

// rowsort：两块横排，均按「尺寸名」行转列；块1 值=库存(前缀 存)，块2 值=销量(前缀 销)
const rs: FlowNode = {
  id: 'n2',
  kind: 'rowsort',
  position: { x: 0, y: 0 },
  data: {
    sourceNode: 'n1',
    cols: [
      { key: '款色', label: '款色', show: true },
      { key: '尺寸名', label: '尺寸名', show: true },
      { key: '库存', label: '库存', show: true },
      { key: '销量', label: '销量', show: true },
    ],
    pivots: [
      { id: 'p1', rowField: '尺寸名', valueField: '库存', prefix: '存', enable: true, order: ['175/92A', '170/88A'], labels: { '175/92A': '加大', '170/88A': '标准' } },
      // 块2 故意不给 order/labels，验证 evaluate 同字段共享兜底（应复用块1的顺序与改名）
      { id: 'p2', rowField: '尺寸名', valueField: '销量', prefix: '销', enable: true },
    ],
  },
} as unknown as FlowNode;

const nodes = [up, rs];
const edges: FlowEdge[] = [{ id: 'e', source: 'n1', target: 'n2' }];
const outs = evaluateFlow(nodes, edges, [table]);

const o = outs['n2'] as any;
console.log('=== n2 ===');
console.log('columns:', JSON.stringify(o?.columns));
console.log('note:', o?.note);
console.log('rows:', JSON.stringify(o?.rows, null, 1));