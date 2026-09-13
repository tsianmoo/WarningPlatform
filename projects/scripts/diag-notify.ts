import { buildAlertsForRule } from '@/lib/store';
import type { AlertRule, DataTable } from '@/lib/types';

const table: DataTable = {
  id: 't1',
  name: '门店销售',
  fields: [
    { key: '店仓名称', name: '店仓名称', type: 'text' },
    { key: '未开单天数', name: '未开单天数', type: 'number' },
  ],
  rows: [
    { 店仓名称: '万悦城', 未开单天数: 5 },
    { 店仓名称: '万达', 未开单天数: 8 },
  ],
};

const rule: AlertRule = {
  id: 'r1',
  name: '周未开单预警',
  level: 'warn',
  status: 'enabled',
  description: '',
  flow: {
    nodes: [
      {
        id: 'n_notify_1',
        kind: 'notify',
        position: { x: 0, y: 0 },
        data: {
          stores: [],
          staff: ['张伟'],
          departments: ['风控部'],
          positions: ['经理'],
          custom: ['王强'],
          timeoutStores: ['万达'],
          timeoutStaff: [],
          timeoutDepartments: ['风控部'],
          timeoutPositions: [],
          timeoutCustom: ['王强'],
          notifyLabel: '',
        },
      },
      {
        id: 'n_action_1',
        kind: 'action',
        position: { x: 0, y: 0 },
        data: {
          type: 'alert',
          priority: 'Urgent',
          title: '未开单预警',
          content: '{店仓名称} 未开单，请处理',
          notify: {},
          refNotifyNode: { nodeId: 'n_notify_1', label: '通知对象' },
        },
      },
    ],
    edges: [],
  },
  targets: { departments: [], personnel: [] },
  createdAt: 0,
  updatedAt: 0,
};

const alerts = buildAlertsForRule(rule, [table], () => undefined);
const a = alerts[0];
console.log('dept =', JSON.stringify(a.dept));
console.log('assignee =', JSON.stringify(a.assignee));
console.log('timeoutNotify =', JSON.stringify(a.preview?.timeoutNotify));
const ok =
  a.dept === '风控部、经理' &&
  a.assignee === '张伟、王强' &&
  a.preview?.timeoutNotify?.stores?.length === 1 &&
  a.preview.timeoutNotify.stores[0] === '万达' &&
  a.preview.timeoutNotify.custom.includes('王强');
console.log(ok ? 'PASS' : 'FAIL');