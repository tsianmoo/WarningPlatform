'use client';

import React, { memo, useEffect, useState, useMemo, useRef, createContext, useContext } from 'react';
import { Handle, Position, useReactFlow, useEdges, useNodes, type NodeProps } from '@xyflow/react';
import { Play, Braces, GitFork, Calculator, Link2, Bell, Search, CalendarClock, Trophy, GitPullRequestArrow, Scale, Layers, Merge, ListFilter, Filter, Database, X, Eye, CalendarRange, Users, TrendingUp } from 'lucide-react';
import {
  KIND_COLOR,
  KIND_LABEL,
  OPERATOR_OPTIONS,
  LEVEL_OPTIONS,
  AGG_FN_OPTIONS,
  ELAPSED_SCOPE_OPTIONS,
  type ElapsedScope,
  type ActionNodeData,
  type ComputeNodeData,
  type ConditionNodeData,
  type FieldNodeData,
  type FieldRef,
  type FlowNode,
  type FlowEdge,
  type NodeResultRef,
  type LookupNodeData,
  type RelationNodeData,
  type TimeNodeData,
  type TopNNodeData,
  type DiffNodeData,
  type GroupByNodeData,
  type GroupMetric,
  type BaselineNodeData,
  type FillJoinNodeData,
  type BaseNodeData,
  type LogicNodeData,
  type FilterNodeData,
  type FilterCondition,
  type FilterOp,
  type ElapsedNodeData,
  type TimeUnit,
  type DataTable,
  type Operator,
  type ArithmeticOp,
  type ComputeExpr,
  type ExprToken,
  type Schedule,
  type TargetSetting,
  type RepeatType,
  type RankNodeData,
  type RankItem,
  DEPARTMENTS,
  PERSONNEL,
} from '@/lib/types';
import { useStore } from '@/lib/store';
import TimeComponent from './TimeComponent';
import { useNodePreview } from './NodePreview';
import { evaluateFlow } from '@/lib/evaluate';

type AnyData =
  | FieldNodeData
  | ConditionNodeData
  | ComputeNodeData
  | LookupNodeData
  | RelationNodeData
  | ActionNodeData
  | TimeNodeData
  | TopNNodeData
  | DiffNodeData
  | GroupByNodeData
  | BaselineNodeData
  | FillJoinNodeData
  | BaseNodeData
  | LogicNodeData
  | FilterNodeData
  | ElapsedNodeData
  | RankNodeData;

const KIND_ICON: Record<FlowNode['kind'], React.ReactNode> = {
  trigger: <Play size={13} strokeWidth={2.5} />,
  field: <Braces size={13} strokeWidth={2.5} />,
  condition: <GitFork size={13} strokeWidth={2.5} />,
  compute: <Calculator size={13} strokeWidth={2.5} />,
  lookup: <Search size={13} strokeWidth={2.5} />,
  relation: <Link2 size={13} strokeWidth={2.5} />,
  action: <Bell size={13} strokeWidth={2.5} />,
  time: <CalendarClock size={13} strokeWidth={2.5} />,
  topn: <Trophy size={13} strokeWidth={2.5} />,
  diff: <GitPullRequestArrow size={13} strokeWidth={2.5} />,
  groupby: <Layers size={13} strokeWidth={2.5} />,
  baseline: <Scale size={13} strokeWidth={2.5} />,
  filljoin: <Merge size={13} strokeWidth={2.5} />,
  base: <Database size={13} strokeWidth={2.5} />,
  logic: <ListFilter size={13} strokeWidth={2.5} />,
  filter: <Filter size={13} strokeWidth={2.5} />,
  elapsed: <CalendarRange size={13} strokeWidth={2.5} />,
  rank: <TrendingUp size={13} strokeWidth={2.5} />,
};

function useNodeUpdater(id: string) {
  const { updateNodeData } = useReactFlow();
  return (patch: Partial<AnyData>) => updateNodeData(id, patch as never);
}

/** 读取本规则用到的表（来自构建上下文） */
function useRuleTables(): DataTable[] {
  const { state } = useStore();
  const ids = state.builderTableIds;
  return ids.length ? state.tables.filter((t) => ids.includes(t.id)) : state.tables;
}

/** 规则级配置（触发调度 / 通知对象）构建上下文，供开始、预警动作节点内嵌配置 */
export type RuleMetaValue = {
  schedule: Schedule;
  targets: TargetSetting;
  setSchedule: (s: Schedule) => void;
  setTargets: (t: TargetSetting) => void;
};
export const BuildCtx = createContext<RuleMetaValue | null>(null);
function useRuleMeta(): RuleMetaValue | null {
  return useContext(BuildCtx);
}

/** 通用样式（与各节点保持一致） */
let uidSeq = 0;
const nextUid = (prefix: string) => `${prefix}_${(++uidSeq).toString(36)}`;
const SRC_INPUT_CLS =
  'w-full rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-700 focus:outline-none focus:ring-1 focus:ring-violet-400';
const SRC_ROW_CLS = 'mb-1 mt-2 text-[11px] font-medium text-gray-500 first:mt-0';

/** 数据源切换条：数据表 / 节点结果 */
function SourceSwitch({
  value,
  onChange,
}: {
  value: 'table' | 'node';
  onChange: (v: 'table' | 'node') => void;
}) {
  return (
    <div className="mb-1 flex items-center gap-1">
      <span className="text-[11px] text-gray-500">数据来源</span>
      <div className="ml-auto flex rounded-lg border bg-gray-50 p-0.5">
        {(
          [
            { v: 'table', t: '数据表' },
            { v: 'node', t: '节点结果' },
          ] as const
        ).map((s) => (
          <button
            key={s.v}
            type="button"
            onClick={() => onChange(s.v)}
            className={`rounded-md px-2 py-0.5 text-[11px] transition ${
              value === s.v ? 'bg-violet-600 text-white shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {s.t}
          </button>
        ))}
      </div>
    </div>
  );
}

/** 数据来源选择块：节点结果模式选上游节点；数据表模式由 children 渲染表/字段选择 */
function DataSourcePicker({
  source,
  sourceNode,
  nodeOptions,
  onSourceChange,
  onNodeChange,
  tableBlock,
  nodeLabel = '① 引用上游节点输出',
  nodePlaceholder = '选择上一步节点结果…',
}: {
  source: 'table' | 'node';
  sourceNode?: string;
  nodeOptions: { ref: NodeResultRef }[];
  onSourceChange: (v: 'table' | 'node') => void;
  onNodeChange: (ref: NodeResultRef | undefined) => void;
  tableBlock: React.ReactNode;
  nodeLabel?: string;
  nodePlaceholder?: string;
}) {
  return (
    <div>
      <SourceSwitch value={source} onChange={onSourceChange} />
      {source === 'node' ? (
        <>
          <div className={SRC_ROW_CLS}>{nodeLabel}</div>
          <select
            value={sourceNode ?? ''}
            onChange={(e) => {
              const o = nodeOptions.find((x) => x.ref.nodeId === e.target.value);
              onNodeChange(o?.ref);
            }}
            className={SRC_INPUT_CLS}
          >
            <option value="">{nodePlaceholder}</option>
            {nodeOptions.map((o) => (
              <option key={o.ref.nodeId} value={o.ref.nodeId}>
                {KIND_LABEL[o.ref.nodeKind]} · {o.ref.label}
              </option>
            ))}
          </select>
          {nodeOptions.length === 0 && (
            <div className="mt-1.5 rounded-md bg-amber-50 px-2 py-1 text-[10px] leading-relaxed text-amber-700">
              画布上还没有可引用的节点结果。请先添加「基础数据 / 过滤 / 分组聚合 / 查找」等节点并连到本节点之前。
            </div>
          )}
        </>
      ) : (
        tableBlock
      )}
    </div>
  );
}

function nodeKindCn(kind: FlowNode['kind']) {
  const map: Record<FlowNode['kind'], string> = {
    trigger: '开始',
    field: '数据字段',
    condition: '判断',
    compute: '计算',
    lookup: '查找',
    relation: '关联',
    action: '预警动作',
    time: '时间窗口',
    topn: '排名取数',
    diff: '反匹配排查',
    groupby: '分组聚合',
    baseline: '基准统计',
    filljoin: '左关联补全',
    base: '基础数据',
    filter: '过滤',
    elapsed: '已过天数',
    logic: '逻辑关联',
    rank: '排名',
  };
  return map[kind];
}

function nodeTitle(fnode: FlowNode) {
  const base = nodeKindCn(fnode.kind);
  if (fnode.kind === 'baseline' || fnode.kind === 'groupby' || fnode.kind === 'condition') {
    const rl = (fnode.data as { resultLabel?: string } | undefined)?.resultLabel;
    if (rl && rl.trim()) return `${base}（${rl.trim()}）`;
  }
  return base;
}

function NodeShell({ fnode, children }: { fnode: FlowNode; children: React.ReactNode }) {
  const color = KIND_COLOR[fnode.kind];
  const hasSource = true; // 所有节点（含开始）都开放右侧出口，用于连向后继
  const { deleteElements, getNodes, getEdges } = useReactFlow();
  const tables = useRuleTables();
  const preview = useNodePreview();
  const handlePreview = (e: React.MouseEvent) => {
    e.stopPropagation();
    preview.open(fnode, getNodes() as unknown as FlowNode[], getEdges() as unknown as FlowEdge[], tables);
  };
  return (
    <div className="w-[300px] max-w-[300px] rounded-xl border bg-white shadow-sm" style={{ borderColor: color.border }}>
      <div
        className="group/head flex items-center gap-1.5 rounded-t-[11px] px-3 py-1.5"
        style={{ backgroundColor: color.bg }}
      >
        <span
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md"
          style={{ backgroundColor: color.dot, color: '#fff' }}
        >
          {KIND_ICON[fnode.kind]}
        </span>
        <span className="min-w-0 flex-1 truncate text-xs font-semibold" style={{ color: color.text }}>
          {nodeTitle(fnode)}
        </span>
        <button
          type="button"
          title="预览该步结果"
          onClick={handlePreview}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-gray-500/70 transition hover:bg-white/80 hover:text-blue-600"
        >
          <Eye className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          title="删除该组件"
          onClick={(e) => {
            e.stopPropagation();
            deleteElements({ nodes: [{ id: fnode.id }] });
          }}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-gray-400 opacity-0 transition hover:bg-white/70 hover:text-rose-500 group-hover/head:opacity-100"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="nodrag px-3 py-2">{children}</div>
      <Handle type="target" position={Position.Left} style={{ background: color.dot, width: 10, height: 10 }} />
      {hasSource && (
        <Handle type="source" position={Position.Right} style={{ background: color.dot, width: 10, height: 10 }} />
      )}
    </div>
  );
}

/** 表 + 字段 两级选择器 */
function FieldSelect({
  value,
  onChange,
  placeholder,
  tables,
}: {
  value?: Partial<FieldRef>;
  onChange: (ref: FieldRef) => void;
  placeholder?: string;
  tables: DataTable[];
}) {
  const curTable = tables.find((t) => t.id === value?.tableId) ?? tables[0];
  const fields = curTable?.fields ?? [];
  const sel = (fieldKey: string) => {
    const f = fields.find((x) => x.key === fieldKey);
    onChange({ tableId: curTable!.id, tableName: curTable!.name, fieldKey, fieldLabel: f?.alias ?? f?.key ?? fieldKey });
  };
  return (
    <div className="flex items-center gap-1">
      <select
        value={value?.tableId || (tables[0]?.id ?? '')}
        onChange={(e) => {
          const t = tables.find((x) => x.id === e.target.value);
          if (t) onChange({ tableId: t.id, tableName: t.name, fieldKey: '', fieldLabel: '' });
        }}
        className="max-w-[96px] shrink-0 rounded-md border bg-white px-1.5 py-1 text-[11px] text-gray-600 focus:outline-none focus:ring-1 focus:ring-blue-300"
      >
        {tables.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name.length > 6 ? t.name.slice(0, 6) + '…' : t.name}
          </option>
        ))}
      </select>
      <select
        value={value?.fieldKey ?? ''}
        onChange={(e) => sel(e.target.value)}
        className="min-w-0 flex-1 rounded-md border bg-white px-2 py-1 text-[11px] text-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-300"
      >
        <option value="">{placeholder ?? '选择字段…'}</option>
        {fields.map((f) => (
          <option key={f.key} value={f.key}>
            {f.alias || f.key}
          </option>
        ))}
      </select>
    </div>
  );
}

// ---------- 开始节点 ----------
const REPEAT_OPTIONS: { value: RepeatType; label: string }[] = [
  { value: 'once', label: '仅一次' },
  { value: 'daily', label: '每日' },
  { value: 'weekly', label: '每周' },
  { value: 'monthly', label: '每月' },
  { value: 'custom', label: '自定义间隔' },
];
const WEEKDAYS = [
  { n: 1, label: '一' },
  { n: 2, label: '二' },
  { n: 3, label: '三' },
  { n: 4, label: '四' },
  { n: 5, label: '五' },
  { n: 6, label: '六' },
  { n: 7, label: '日' },
];
function SchedulePanel({ schedule }: { schedule: Schedule }) {
  const meta = useRuleMeta();
  if (!meta) return null;
  const set = (patch: Partial<Schedule>) => meta.setSchedule({ ...meta.schedule, ...patch });
  const toggleW = (n: number) =>
    set({ weekdays: schedule.weekdays.includes(n) ? schedule.weekdays.filter((w) => w !== n) : [...schedule.weekdays, n].sort() });
  const toggleD = (d: number) =>
    set({ monthDays: schedule.monthDays.includes(d) ? schedule.monthDays.filter((x) => x !== d) : [...schedule.monthDays, d].sort((a, b) => a - b) });
  const row = 'mb-1.5';
  const label = 'mb-1 text-[10px] text-gray-400';
  return (
    <div className="mt-1 rounded-lg border border-blue-100 bg-blue-50/40 p-1.5">
      <div className="mb-1 flex items-center gap-1 text-[10px] font-semibold text-blue-700">
        <CalendarClock size={11} /> 触发调度
      </div>
      <div className={row}>
        <div className="flex flex-wrap gap-1">
          {REPEAT_OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => set({ repeatType: o.value })}
              className={`rounded px-1.5 py-0.5 text-[10px] transition ${
                schedule.repeatType === o.value ? 'bg-blue-600 text-white' : 'bg-white text-gray-500 hover:bg-blue-100'
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>
      <div className={row}>
        <div className={label}>每日触发时刻</div>
        <input
          type="time"
          value={schedule.timeOfDay}
          onChange={(e) => set({ timeOfDay: e.target.value })}
          className="rounded-md border bg-white px-1.5 py-0.5 text-[11px] text-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-300"
        />
      </div>
      {schedule.repeatType === 'weekly' && (
        <div className={row}>
          <div className={label}>重复星期</div>
          <div className="flex gap-1">
            {WEEKDAYS.map((w) => (
              <button
                key={w.n}
                type="button"
                onClick={() => toggleW(w.n)}
                className={`h-6 w-6 rounded text-[10px] transition ${
                  schedule.weekdays.includes(w.n) ? 'bg-blue-600 text-white' : 'bg-white text-gray-500 hover:bg-blue-100'
                }`}
              >
                {w.label}
              </button>
            ))}
          </div>
        </div>
      )}
      {schedule.repeatType === 'monthly' && (
        <div className={row}>
          <div className={label}>重复日期（号）</div>
          <div className="flex flex-wrap gap-1">
            {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => toggleD(d)}
                className={`h-6 w-6 rounded text-[10px] transition ${
                  schedule.monthDays.includes(d) ? 'bg-blue-600 text-white' : 'bg-white text-gray-500 hover:bg-blue-100'
                }`}
              >
                {d}
              </button>
            ))}
          </div>
        </div>
      )}
      {schedule.repeatType === 'custom' && (
        <div className={row}>
          <div className={label}>间隔天数</div>
          <input
            type="number"
            min={1}
            value={String(schedule.customInterval ?? 1)}
            onChange={(e) => set({ customInterval: Math.max(1, Number(e.target.value) || 1) })}
            className="w-20 rounded-md border bg-white px-1.5 py-0.5 text-[11px] text-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-300"
          />
        </div>
      )}
    </div>
  );
}
const TriggerNode = memo(({ id, data }: NodeProps) => {
  const fnode = { id, kind: 'trigger' as const, data, position: { x: 0, y: 0 } } as FlowNode;
  const meta = useRuleMeta();
  return (
    <NodeShell fnode={fnode}>
      <div className="text-sm font-medium text-gray-700">开始监测</div>
      <div className="mt-1 text-xs text-gray-400">规则触发入口 · 在此配置调度</div>
      {meta && <SchedulePanel schedule={meta.schedule} />}
    </NodeShell>
  );
});

// ---------- 字段节点 ----------
const FieldNode = memo(({ id, data }: NodeProps) => {
  const fnode = { id, kind: 'field' as const, data, position: { x: 0, y: 0 } } as FlowNode;
  const d = data as unknown as FieldNodeData;
  const update = useNodeUpdater(id);
  const tables = useRuleTables();
  return (
    <NodeShell fnode={fnode}>
      <div className="mb-1 text-xs text-gray-400">监测字段 / 数据源</div>
      <FieldSelect
        value={d}
        tables={tables}
        placeholder="选择字段…"
        onChange={(ref) => update({ ...ref })}
      />
    </NodeShell>
  );
});

// ---------- 判断节点 ----------

/** 从画布节点中提取"可作为节点结果引用"的输出节点（标量基准值 / 逐组列） */
function getNodeOutputs(allNodes: ReturnType<typeof useNodes>, selfId: string): { ref: NodeResultRef }[] {
  const out: { ref: NodeResultRef }[] = [];
  for (const n of allNodes) {
    if (n.id === selfId) continue;
    const fn = n as unknown as FlowNode;
    const str = (v: unknown): string => (typeof v === 'string' && v ? v : '');
    switch (fn.kind) {
      case 'baseline': {
        const b = n.data as unknown as BaselineNodeData;
        out.push({
          ref: { nodeId: n.id, nodeKind: 'baseline', outputKind: 'scalar', label: b.resultLabel || '基准值' },
        });
        break;
      }
      case 'rank': {
        const rk = n.data as unknown as RankNodeData;
        out.push({
          ref: { nodeId: n.id, nodeKind: 'rank', outputKind: 'column', label: rk.resultLabel || '排名结果' },
        });
        break;
      }
      case 'groupby': {
        const g = n.data as unknown as GroupByNodeData;
        out.push({
          ref: { nodeId: n.id, nodeKind: 'groupby', outputKind: 'column', label: g.resultLabel || g.metricFieldLabel || '分组聚合结果' },
        });
        const noDims = !(Array.isArray(g.dims) && g.dims.length);
        if (noDims) {
          const scalarLabel = (Array.isArray(g.metrics) && g.metrics[0]?.resultLabel) || g.resultLabel || g.metricFieldLabel || '聚合结果';
          out.push({
            ref: { nodeId: n.id, nodeKind: 'groupby', outputKind: 'scalar', label: scalarLabel },
          });
        }
        break;
      }
      case 'lookup': {
        const l = n.data as unknown as LookupNodeData;
        out.push({
          ref: {
            nodeId: n.id,
            nodeKind: 'lookup',
            outputKind: 'column',
            label: l.mode === 'aggregate' ? l.aggLabel || '查找汇总结果' : l.returnLabel || '查找结果',
          },
        });
        break;
      }
      case 'compute': {
        const c = n.data as unknown as ComputeNodeData;
        const clabel = c.resultLabel || '计算结果';
        // 计算节点可能输出逐行结果列（如每个店仓一行的"未开单天数"），也可作为标量基准：
        // 同时注册 column（可作判断对象/逐行引用）与 scalar（可作基准/右值）。
        out.push({ ref: { nodeId: n.id, nodeKind: 'compute', outputKind: 'column', label: clabel } });
        out.push({ ref: { nodeId: n.id, nodeKind: 'compute', outputKind: 'scalar', label: clabel } });
        break;
      }
      case 'elapsed': {
        const el = n.data as unknown as ElapsedNodeData;
        out.push({
          ref: { nodeId: n.id, nodeKind: 'elapsed', outputKind: 'scalar', label: el.resultLabel || '已过天数' },
        });
        break;
      }
      case 'topn': {
        const t = n.data as unknown as TopNNodeData;
        out.push({ ref: { nodeId: n.id, nodeKind: 'topn', outputKind: 'column', label: t.resultLabel || '排名结果' } });
        break;
      }
      case 'filljoin': {
        const f = n.data as unknown as FillJoinNodeData;
        out.push({ ref: { nodeId: n.id, nodeKind: 'filljoin', outputKind: 'column', label: f.resultLabel || '补全结果' } });
        break;
      }
      case 'base': {
        const bn = n.data as unknown as BaseNodeData;
        const cols = Array.isArray(bn.columns) && bn.columns.length ? bn.columns : [];
        const label = bn.resultLabel || (cols.length ? cols.map((c) => c.label || c.key).join('、') : (bn.fieldLabel || '基础数据'));
        out.push({ ref: { nodeId: n.id, nodeKind: 'base', outputKind: 'column', label } });
        break;
      }
      case 'diff': {
        const df = n.data as unknown as DiffNodeData;
        out.push({ ref: { nodeId: n.id, nodeKind: 'diff', outputKind: 'column', label: str(df.resultLabel) || '反匹配结果' } });
        break;
      }
      case 'filter': {
        const fl = n.data as unknown as FilterNodeData;
        out.push({ ref: { nodeId: n.id, nodeKind: 'filter', outputKind: 'column', label: fl.resultLabel || '过滤结果' } });
        break;
      }
      default:
        break;
    }
  }
  return out;
}

type ColOpt = { key: string; label: string };
// 推断某节点结果的输出列（供过滤/左关联补全选择匹配键等复用）。filter 的列动态继承其上游 source。
function inferNodeCols(allNodes: ReadonlyArray<{ id: string; data: unknown }>, tables: Array<{ id: string; fields: Array<{ key: string; alias?: string }> }>, nid: string, visited?: Set<string>): ColOpt[] {
  const fn = allNodes.find((n) => n.id === nid);
  if (!fn) return [];
  const seen = visited ?? new Set<string>();
  if (seen.has(nid)) return []; // 防止环：递归带出上游列时若再次回到本节点则截断
  seen.add(nid);
  const data = fn.data as unknown as Record<string, unknown>;
  const kind = (fn as unknown as FlowNode).kind;
  const s = (v: unknown): string => (typeof v === 'string' && v ? v : '');
  switch (kind) {
    case 'topn':
      // 输出列名 = 分组列展示名 + 结果命名(resultLabel)；key 必须对齐真实输出列
      return [
        { key: s(data.groupFieldLabel) || s(data.groupField) || 'key', label: s(data.groupFieldLabel) || s(data.groupField) || '分组' },
        { key: s(data.resultLabel) || s(data.metricField) || 'val', label: s(data.resultLabel) || '结果' },
      ];
    case 'groupby': {
      const cols = Array.isArray(data.dims)
        ? (data.dims as Record<string, unknown>[])
            .map((x) => {
              const lab = s(x.fieldLabel) || s(x.label) || s(x.fieldKey);
              return { key: lab, label: lab };
            })
            .filter((x) => x.key)
        : [];
      // 时间窗起止列（与 evaluate groupby 输出对齐：dateField+timeWindow 且非 all 时前置两列）
      const gtw = data.timeWindow as { preset?: string; dateUnit?: string; unit?: string } | undefined;
      if (s(data.dateField) && gtw && gtw.preset !== 'all') {
        const granDay = (() => {
          const p = gtw.preset || '';
          const u = gtw.dateUnit || gtw.unit || '';
          if (p === 'all' || p === 'custom') return u ? (u === 'week' ? 'week' : u === 'month' ? 'month' : u === 'year' ? 'year' : u === 'quarter' ? 'quarter' : u === 'day' ? 'day' : null) : null;
          if (/week|Week/.test(p)) return 'week';
          if (/Quarter|quarter/.test(p)) return 'quarter';
          if (/Year|year/.test(p)) return 'year';
          if (/Month|month/.test(p)) return 'month';
          return 'day';
        })();
        const GRAN_COL: Record<string, string> = { week: '本周天数', quarter: '本季天数', year: '本年天数', month: '本月天数', day: '本日天数' };
        const dateCols = [{ key: '开始日期', label: '开始日期' }, { key: '结束日期', label: '结束日期' }, { key: '已过天数', label: '已过天数' }];
        if (granDay && GRAN_COL[granDay]) dateCols.push({ key: GRAN_COL[granDay], label: GRAN_COL[granDay] });
        dateCols.push(
          { key: '当前日期', label: '当前日期' },
          { key: '周几', label: '周几' },
          { key: '第几周', label: '第几周' },
          { key: '剩余天数', label: '剩余天数' },
        );
        cols.unshift(...dateCols);
      }
      // 指标列：多指标 metrics 优先；否则单指标 resultLabel / metricFieldLabel
      const fnTxt = (fn: unknown) =>
        fn === 'activeDays' ? '开单天数'
        : fn === 'countDistinct' ? '去重计数'
        : fn === 'sum' ? '求和'
        : fn === 'avg' ? '平均'
        : fn === 'max' ? '最大'
        : fn === 'min' ? '最小'
        : fn === 'count' ? '计数'
        : s(fn) || '求和';
      const metrics = Array.isArray(data.metrics) && (data.metrics as Record<string, unknown>[]).length
        ? (data.metrics as Record<string, unknown>[])
        : data.metricField
          ? [{ fieldKey: data.metricField, fieldLabel: data.metricFieldLabel, fn: data.metricFn || 'sum', resultLabel: '' }]
          : [];
      for (const m of metrics) {
        const key =
          s(m.resultLabel) || `${fnTxt(m.fn)}(${s(m.fieldLabel) || s(m.fieldKey)})`;
        if (key) cols.push({ key, label: key });
      }
      if (!cols.some((c) => c.key === s(data.resultLabel))) {
        // 兼容旧：无多指标时兜底结果命名列
        if (!metrics.length && s(data.resultLabel)) cols.push({ key: s(data.resultLabel), label: s(data.resultLabel) });
      }
      return cols;
    }
    case 'base': {
      const cols = Array.isArray(data.columns) && data.columns.length
        ? (data.columns as { key: string; label: string }[]).map((c) => ({ key: c.label || c.key, label: c.label || c.key }))
        : [];
      if (cols.length) return cols;
      return [{ key: s(data.fieldKey) || 'key', label: s(data.fieldLabel) || s(data.resultLabel) || '值' }];
    }
    case 'compute': {
      // 计算节点结果列 = 上游主表透传列 + 自身结果列（与 evaluate 输出 columns: [...main.columns, label] 对齐）
      const cKey = s(data.resultLabel) || s(data.fieldLabel) || (s(data.sourceField) || 'value');
      const cols: ColOpt[] = [{ key: cKey, label: s(data.resultLabel) || '结果' }];
      const upstreams: string[] = [];
      // 字段聚合模式的主表来源（数据表或上游节点输出）
      const aggNode = s(data.source) === 'node' ? s(data.sourceNode) : '';
      if (aggNode) upstreams.push(aggNode);
      // 两节点结果运算的基准（左值）节点
      const e = data.expr as { leftType?: string; left?: { nodeId?: string } } | undefined;
      if (e && e.leftType === 'node' && e.left?.nodeId) upstreams.push(e.left.nodeId);
      for (const up of upstreams) {
        if (up === nid) continue;
        const seen2 = new Set(seen);
        seen2.add(nid);
        for (const c of inferNodeCols(allNodes, tables, up, seen2)) {
          if (!cols.some((x) => x.key === c.key)) cols.push(c);
        }
      }
      return cols;
    }
    case 'elapsed':
      return [{ key: s(data.resultLabel) || 'value', label: s(data.resultLabel) || '结果' }];
    case 'diff':
      return [{ key: s(data.baseField) || 'key', label: s(data.baseFieldLabel) || '结果' }];
    case 'filljoin': {
      const tag: ColOpt[] = [];
      const pushUniq = (c: ColOpt) => { if (!tag.some((t) => t.key === c.key)) tag.push(c); };
      // 匹配键（全集侧）+ 主键，用于去重全额带出的列
      const uniKey = s(data.universeField);
      const extras = Array.isArray(data.extraKeys) ? (data.extraKeys as Record<string, unknown>[]) : [];
      const uniKeySet = new Set([uniKey, ...extras.map((k) => s(k.universeField)).filter(Boolean)]);
      // 1) 全集主键列（label 优先取全集字段展示名）
      if (uniKey) pushUniq({ key: uniKey, label: s(data.universeFieldLabel) || uniKey });
      // 2) 追加匹配键（复合键）—— 全集侧标签
      for (const k of extras) {
        const uf = s(k.universeField);
        if (!uf) continue;
        pushUniq({ key: uf, label: s(k.universeFieldLabel) || uf });
      }
      // 3) 全集来源其余业务列（与 evaluate filljoin 输出对齐：默认带回全集全部非键列，供下游选字段）
      if (s(data.universeSource) === 'node') {
        const uniNode = s(data.universeNodeId);
        if (uniNode) for (const c of inferNodeCols(allNodes, tables, uniNode)) if (!uniKeySet.has(c.key)) pushUniq(c);
      } else {
        const ut = tables.find((x) => x.id === s(data.universeTableId));
        if (ut) for (const f of ut.fields) if (!uniKeySet.has(f.key)) pushUniq({ key: f.key, label: f.alias || f.key });
      }
      // 4) 全集额外返回列（如把"店铺成交"命名为"数量"）—— 用命名后的列名作为输出 key
      const retFields: ColOpt[] = (Array.isArray(data.universeReturnFields) ? data.universeReturnFields as Record<string, unknown>[] : [])
        .filter((f) => s(f.key) && !uniKeySet.has(s(f.key)))
        .map((f) => ({ key: s(f.label) || s(f.key), label: s(f.label) || s(f.key) }));
      for (const rf of retFields) pushUniq(rf);
      const retField = s(data.universeReturnField);
      if (retField) {
        const retLabel = s(data.universeReturnLabel) || retField;
        pushUniq({ key: retLabel, label: retLabel });
      }
      // 4) 事实来源带来的列（按事实匹配键过滤，且只带"事实带回指标列"）
      const factSrc = s(data.factSource);
      const factNode = s(data.factNode);
      const factTid = s(data.factTableId);
      const factKey = s(data.factKeyField);
      const factExtraFields = extras.map((k) => s(k.factField)).filter(Boolean);
      const factKeys = [factKey, ...factExtraFields].filter(Boolean);
      const factRet = s(data.factReturnField);
      const allowFact = (key: string) => {
        if (!key) return false;
        if (factKeys.includes(key)) return false;
        if (factRet && key !== factRet && key !== s(data.factReturnLabel)) return false;
        return true;
      };
      if (factSrc === 'node' && factNode) {
        for (const c of inferNodeCols(allNodes, tables, factNode)) {
          if (allowFact(c.key)) pushUniq(c);
        }
      } else if (factTid) {
        const t = tables.find((x) => x.id === factTid);
        if (t) for (const f of t.fields) if (allowFact(f.key)) pushUniq({ key: f.key, label: f.alias || f.key });
      }
      return tag;
    }
    case 'filter': {
      const src = s(data.source);
      const srcNode = s(data.sourceNode);
      if (src === 'node' && srcNode) return inferNodeCols(allNodes, tables, srcNode);
      const tid = s(data.tableId);
      let t = tid ? tables.find((x) => x.id === tid) : undefined;
      // 来源表缺失时用过滤字段匹配包含这些字段的表（避免误取首表）
      if (!t && !tid) {
        const conds = (data.conditions ?? []) as { fieldKey?: string }[];
        const keys = conds.map((c) => c.fieldKey).filter(Boolean) as string[];
        if (keys.length) t = tables.find((x) => keys.every((k) => x.fields.some((f) => f.key === k)));
      }
      if (!t) t = tables[0];
      return t ? t.fields.map((f) => ({ key: f.key, label: f.alias || f.key })) : [];
    }
    case 'condition': {
      // 判断节点输出列 = 左值来源节点的列（透传上游 rowset），供下游（如预警动作）选字段
      const cn = data.leftNode as { nodeId?: string } | undefined;
      const ln = data.leftType === 'node' || data.leftSource === 'node' ? cn?.nodeId : '';
      if (ln) {
        const up = inferNodeCols(allNodes, tables, ln);
        if (up.length) return up;
      }
      return [];
    }
    case 'rank': {
      const cols: ColOpt[] = [];
      // 基础列 = 数据源列（表或节点）
      if (s(data.source) === 'node') {
        const ref = data.refNode as Record<string, unknown> | undefined;
        const srcNode = ref && typeof ref.nodeId === 'string' && ref.nodeId ? ref.nodeId : '';
        if (srcNode) {
          const up = inferNodeCols(allNodes, tables, srcNode);
          for (const c of up) cols.push(c);
        }
      } else {
        const tid = s(data.tableId);
        const t = tables.find((x) => x.id === tid);
        if (t) for (const f of t.fields) cols.push({ key: f.key, label: f.alias || f.key });
      }
      // 每个排名项生成「排名」「TOP档」两列
      if (Array.isArray(data.items)) {
        for (const it of data.items as Record<string, unknown>[]) {
          const fl = s(it.fieldLabel) || s(it.fieldKey);
          if (!fl) continue;
          const rlab = s(it.rankLabel) || `排名(${fl})`;
          cols.push({ key: rlab, label: rlab });
          cols.push({ key: `TOP档(${fl})`, label: `TOP档(${fl})` });
        }
      }
      return cols;
    }
    default:
      return [];
  }
}

const ConditionNode = memo(({ id, data }: NodeProps) => {
  const fnode = { id, kind: 'condition' as const, data, position: { x: 0, y: 0 } } as FlowNode;
  const d = data as unknown as ConditionNodeData;
  const update = useNodeUpdater(id);
  const tables = useRuleTables();
  const op = OPERATOR_OPTIONS.find((o) => o.value === d.operator);
  const noValueOp = d.operator === 'empty' || d.operator === 'notEmpty';
  const edges = useEdges();
  const allNodes = useNodes();
  const rangeOp = d.operator === 'between' || d.operator === 'notBetween';
  const isDateOp = d.operator === 'before' || d.operator === 'after';
  const valueInputCls =
    'min-w-0 flex-1 rounded-md border bg-white px-2 py-1 text-xs text-gray-700 focus:outline-none focus:ring-1 focus:ring-violet-400';

  // 可引用的节点输出（全部节点结果），按标量/列分组
  const nodeOutputs = getNodeOutputs(allNodes, id);
  const scalarOutputs = nodeOutputs.filter((o) => o.ref.outputKind === 'scalar');
  const columnOutputs = nodeOutputs.filter((o) => o.ref.outputKind === 'column');

  // 左值（判断对象）候选：逐列节点（每行一个值，如每个店仓的未开单天数）+ 标量节点（单值，如已过天数）。
  // 计算节点同时注册了 column 与 scalar，需按 nodeId 去重。
  const leftOptions = [...columnOutputs, ...scalarOutputs].filter(
    (o, i, arr) => arr.findIndex((x) => x.ref.nodeId === o.ref.nodeId) === i,
  );

  // 左值（被比较对象）：上游直连的列输出节点优先；其次用户在"节点结果"里选中的节点。
  const upColumn = edges
    .filter((e) => e.target === id)
    .map((e) => leftOptions.find((o) => o.ref.nodeId === e.source))
    .find(Boolean);
  const leftMode: 'field' | 'node' = d.leftSource === 'field' ? 'field' : 'node';
  const leftNodeRef =
    leftOptions.find((o) => o.ref.nodeId === d.leftNode?.nodeId)?.ref ??
    upColumn?.ref ??
    leftOptions[0]?.ref;

  // 右值来源标签
  const rightNodeRef = scalarOutputs.find((o) => o.ref.nodeId === d.refNode?.nodeId)?.ref ?? d.refNode;
  // 判断条件组：判断对象（左值节点）的列候选
  const conditionCols = leftNodeRef?.nodeId ? inferNodeCols(allNodes, tables, leftNodeRef.nodeId) : [];
  const setCond = (i: number, patch: Partial<NonNullable<ConditionNodeData['conditions']>[number]>) => {
    const arr = (d.conditions && d.conditions.length ? d.conditions : []).map((c, idx) => (idx === i ? { ...c, ...patch } : c));
    update({ conditions: arr });
  };
  const removeCond = (i: number) => {
    const arr = (d.conditions && d.conditions.length ? d.conditions : []).filter((_, idx) => idx !== i);
    update({ conditions: arr.length ? arr : undefined });
  };
  const condValues = (i: number): string[] => (d.conditions || [])[i]?.values || [];
  const toggleEmpty = (i: number) => {
    const v = condValues(i);
    setCond(i, { values: v.includes('') ? v.filter((x) => x !== '') : [...v, ''] });
  };
  const toggleZero = (i: number) => {
    const v = condValues(i);
    setCond(i, { values: v.includes('0') ? v.filter((x) => x !== '0') : [...v, '0'] });
  };
  const addVal = (i: number, val: string) => {
    const v = condValues(i);
    if (v.includes(val)) return;
    setCond(i, { values: [...v, val] });
  };
  const removeVal = (i: number, val: string) => setCond(i, { values: condValues(i).filter((x) => x !== val) });

  return (
    <NodeShell fnode={fnode}>
      {/* 结果命名：区分多个判断节点 */}
      <div className="mb-1 flex items-center gap-1.5">
        <span className="shrink-0 text-[11px] text-gray-400">命名</span>
        <input
          value={d.resultLabel ?? ''}
          onChange={(e) => update({ resultLabel: e.target.value })}
          placeholder="如：本月未开单判断"
          className="min-w-0 flex-1 rounded-md border px-2 py-1 text-xs text-gray-700 focus:outline-none focus:ring-1 focus:ring-violet-400"
        />
      </div>
      {/* 左值：判断对象 —— 先选来源（节点结果/表字段） */}
      <div className="mb-1 flex items-center gap-1.5">
        <span className="shrink-0 text-[11px] text-gray-400">判断</span>
        <div className="flex shrink-0 overflow-hidden rounded-md border">
          <button
            onClick={() => update({ leftSource: 'node' })}
            className={`px-2 py-0.5 text-[11px] ${leftMode === 'node' ? 'bg-violet-100 text-violet-700' : 'bg-white text-gray-400'}`}
          >
            节点结果
          </button>
          <button
            onClick={() => update({ leftSource: 'field' })}
            className={`px-2 py-0.5 text-[11px] ${leftMode === 'field' ? 'bg-violet-100 text-violet-700' : 'bg-white text-gray-400'}`}
          >
            表字段
          </button>
        </div>
      </div>

      {leftMode === 'node' ? (
        leftOptions.length > 0 ? (
          <select
            value={leftNodeRef?.nodeId ?? ''}
            onChange={(e) =>
              update({
                leftSource: 'node',
                leftNode: leftOptions.find((o) => o.ref.nodeId === e.target.value)?.ref,
              })
            }
            className={valueInputCls}
          >
            <option value="">选择节点结果…</option>
            {leftOptions.map((o) => (
              <option key={o.ref.nodeId} value={o.ref.nodeId}>
                {o.ref.label}
              </option>
            ))}
          </select>
        ) : (
          <p className="rounded bg-amber-50 px-2 py-1 text-[10px] text-amber-600">
            暂无可引用的节点结果，请先在画布上连接「基础数据 / 分组聚合 / 补全 / 计算」等节点。
          </p>
        )
      ) : (
        <FieldSelect value={d} tables={tables} placeholder="选择字段…" onChange={(ref) => update({ ...ref })} />
      )}

      {leftMode !== 'node' && (
        <>
      {/* 运算符选择 */}
      {!noValueOp && (
        <div className="mt-1.5 flex items-center gap-1.5">
          <span className="shrink-0 text-[11px] text-gray-400">条件</span>
          <select
            value={d.operator || 'gt'}
            onChange={(e) => update({ operator: e.target.value as ConditionNodeData['operator'] })}
            className="min-w-0 flex-1 rounded-md border bg-white px-2 py-1 text-xs text-gray-700 focus:outline-none focus:ring-1 focus:ring-violet-400"
          >
            {OPERATOR_OPTIONS.filter((o) => ['gt', 'gte', 'lt', 'lte', 'eq', 'neq', 'contains', 'between', 'notBetween', 'before', 'after'].includes(o.value)).map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      )}

        {/* 区间：双值 */}
        {rangeOp && (
          <div className="flex items-center gap-1.5">
            <input
              value={d.value}
              onChange={(e) => update({ value: e.target.value })}
              placeholder="下界"
              type={isDateOp ? 'date' : undefined}
              className={valueInputCls}
            />
            <span className="text-xs text-gray-400">~</span>
            <input
              value={d.valueMax}
              onChange={(e) => update({ valueMax: e.target.value })}
              placeholder="上界"
              className={valueInputCls}
            />
          </div>
        )}

        {/* 单值 */}
        {!rangeOp && !noValueOp && (
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5">
              <span className="shrink-0 text-[11px] text-gray-400">比较值</span>
              <div className="flex shrink-0 overflow-hidden rounded-md border">
                <button
                  onClick={() => update({ valueSource: 'const' })}
                  className={`px-1.5 py-0.5 text-[11px] ${d.valueSource === 'const' ? 'bg-violet-100 text-violet-700' : 'bg-white text-gray-400'}`}
                >
                  常量
                </button>
                <button
                  onClick={() => update({ valueSource: 'field' })}
                  className={`px-1.5 py-0.5 text-[11px] ${d.valueSource === 'field' ? 'bg-violet-100 text-violet-700' : 'bg-white text-gray-400'}`}
                >
                  表字段
                </button>
                <button
                  onClick={() => update({ valueSource: 'node' })}
                  className={`px-1.5 py-0.5 text-[11px] ${d.valueSource === 'node' ? 'bg-violet-100 text-violet-700' : 'bg-white text-gray-400'}`}
                >
                  节点结果
                </button>
              </div>
              {d.valueSource === 'const' && (
                <input
                  value={d.value}
                  onChange={(e) => update({ value: e.target.value })}
                  placeholder={isDateOp ? '选择日期' : '阈值 / 值'}
                  type={isDateOp ? 'date' : undefined}
                  className="flex-1 rounded-md border px-2 py-1 text-xs text-gray-700 focus:outline-none focus:ring-1 focus:ring-violet-400"
                />
              )}
            </div>
            {d.valueSource === 'field' && (
              <FieldSelect
                value={d.refValue}
                tables={tables}
                placeholder="与其它字段对比…"
                onChange={(ref) => update({ refValue: ref })}
              />
            )}
            {d.valueSource === 'node' &&
              (scalarOutputs.length > 0 ? (
                <select
                  value={rightNodeRef?.nodeId ?? ''}
                  onChange={(e) => update({ refNode: scalarOutputs.find((o) => o.ref.nodeId === e.target.value)?.ref })}
                  className={valueInputCls}
                >
                  <option value="">选择基准/节点结果…</option>
                  {scalarOutputs.map((o) => (
                    <option key={o.ref.nodeId} value={o.ref.nodeId}>
                      {o.ref.label}
                    </option>
                  ))}
                </select>
              ) : (
                <div className="rounded-md bg-amber-50 px-2 py-1 text-[10px] leading-snug text-amber-600">
                  画布上还没有可引用的基准值。请先添加「基准统计」节点（如对成交求平均）。
                </div>
              ))}
          </div>
        )}
        </>
      )}

      {/* 条件组（节点结果模式）：对该结果的每一行逐条件判断 */}
      {leftMode === 'node' && (
        <div className="mt-1.5 space-y-1.5">
          <div className="flex items-center gap-1.5">
            <span className="shrink-0 text-[11px] text-gray-400">命中</span>
            <select
              value={d.conditionJoin || 'and'}
              onChange={(e) => update({ conditionJoin: e.target.value as 'and' | 'or' })}
              className="min-w-0 flex-1 rounded-md border bg-white px-1.5 py-0.5 text-[11px] text-gray-700 focus:outline-none focus:ring-1 focus:ring-violet-400"
            >
              <option value="and">全部条件（且）</option>
              <option value="or">任一条件（或）</option>
            </select>
            <button
              onClick={() =>
                update({
                  conditions: [
                    ...(d.conditions && d.conditions.length ? d.conditions : []),
                    { col: conditionCols[0]?.key, colLabel: conditionCols[0]?.label, op: 'eq', values: [] },
                  ],
                })
              }
              className="shrink-0 rounded-md border px-1.5 py-0.5 text-[11px] text-violet-600 hover:bg-violet-50"
            >
              + 条件
            </button>
          </div>
          <p className="text-[10px] leading-snug text-gray-400">
            对「{leftNodeRef?.label || '判断对象'}」的每一行逐条件判断；断言值可分别勾选「空」或「0」，也可再手动输入其它数值，命中任一即可。
          </p>
          {conditionCols.length === 0 && (
            <p className="rounded-md bg-amber-50 px-2 py-1 text-[10px] text-amber-600">
              请先在「判断→节点结果」里选择「补全结果 / 分组聚合」等含数据列的节点作为判断对象。
            </p>
          )}
          {(d.conditions && d.conditions.length ? d.conditions : []).map((c, i) => {
            const isNoValue = c.op === 'empty' || c.op === 'notEmpty' || c.op === 'eq' || c.op === 'gt' || c.op === 'gte' || c.op === 'lt' || c.op === 'lte';
            return (
              <div key={i} className="space-y-1 rounded-md border border-gray-200 p-1.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  <select
                    value={c.col ?? ''}
                    onChange={(e) => {
                      const clo = conditionCols.find((x) => x.key === e.target.value);
                      setCond(i, { col: e.target.value, colLabel: clo?.label });
                    }}
                    className={valueInputCls}
                  >
                    <option value="">选择判断列…</option>
                    {conditionCols.map((x) => (
                      <option key={x.key} value={x.key}>
                        {x.label}
                      </option>
                    ))}
                  </select>
                  <select
                    value={c.op || 'eq'}
                    onChange={(e) => setCond(i, { op: e.target.value as ConditionNodeData['operator'] })}
                    className="shrink-0 rounded-md border bg-white px-1 py-0.5 text-[11px] text-gray-700 focus:outline-none focus:ring-1 focus:ring-violet-400"
                  >
                    <option value="eq">等于(任一值)</option>
                    <option value="neq">不等于</option>
                    <option value="contains">包含</option>
                    <option value="gt">大于</option>
                    <option value="gte">大于等于</option>
                    <option value="lt">小于</option>
                    <option value="lte">小于等于</option>
                    <option value="empty">为空</option>
                    <option value="notEmpty">不为空</option>
                  </select>
                  {(c.op === 'eq' || c.op === 'gt' || c.op === 'gte' || c.op === 'lt' || c.op === 'lte') && (
                    <div className="flex shrink-0 items-center gap-1">
                      <span
                        onClick={() => setCond(i, { refNode: undefined, values: [] })}
                        className={`cursor-pointer rounded px-1 py-0.5 text-[10px] ${!c.refNode?.nodeId ? 'bg-violet-100 text-violet-700' : 'text-gray-400 hover:bg-gray-100'}`}
                        title="直接输入数字比较"
                      >
                        数字
                      </span>
                      <span
                        onClick={() => setCond(i, { refNode: scalarOutputs[0]?.ref, values: [] })}
                        className={`cursor-pointer rounded px-1 py-0.5 text-[10px] ${c.refNode?.nodeId ? 'bg-violet-100 text-violet-700' : 'text-gray-400 hover:bg-gray-100'}`}
                        title="引用其他节点结果作比较值"
                      >
                        节点
                      </span>
                      {!c.refNode?.nodeId ? (
                        <input
                          value={c.values?.[0] ?? ''}
                          onChange={(e) => setCond(i, { values: e.target.value ? [e.target.value] : [] })}
                          placeholder="输入数值"
                          type="number"
                          className="w-20 shrink-0 rounded-md border bg-white px-1 py-0.5 text-[11px] text-gray-700 focus:outline-none focus:ring-1 focus:ring-violet-400"
                        />
                      ) : (
                        <select
                          value={c.refNode?.nodeId ?? ''}
                          onChange={(e) => {
                            const ref = scalarOutputs.find((o) => o.ref.nodeId === e.target.value)?.ref;
                            setCond(i, { refNode: e.target.value ? ref : undefined, values: [] });
                          }}
                          className="max-w-40 shrink-0 rounded-md border bg-white px-1 py-0.5 text-[11px] text-gray-700 focus:outline-none focus:ring-1 focus:ring-violet-400"
                          title="引用基准统计/节点标量作比较值"
                        >
                          <option value="">比较值选择…</option>
                          {scalarOutputs.map((o) => (
                            <option key={o.ref.nodeId} value={o.ref.nodeId}>
                              {o.ref.label}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  )}
                  <button onClick={() => removeCond(i)} className="shrink-0 rounded px-1 text-[12px] text-gray-400 hover:text-red-500" title="删除条件">
                    ×
                  </button>
                </div>
                {!isNoValue && (
                  <div className="flex flex-wrap items-center gap-1">
                    <span className="shrink-0 text-[10px] text-gray-400">断言值</span>
                    <button
                      onClick={() => toggleEmpty(i)}
                      className={`shrink-0 rounded-md border px-1.5 py-0.5 text-[11px] ${condValues(i).includes('') ? 'bg-violet-100 text-violet-700' : 'bg-white text-gray-400'}`}
                    >
                      空
                    </button>
                    <button
                      onClick={() => toggleZero(i)}
                      className={`shrink-0 rounded-md border px-1.5 py-0.5 text-[11px] ${condValues(i).includes('0') ? 'bg-violet-100 text-violet-700' : 'bg-white text-gray-400'}`}
                    >
                      0
                    </button>
                    {condValues(i)
                      .filter((v) => v !== '' && v !== '0')
                      .map((v) => (
                        <span key={v} className="flex items-center gap-1 rounded-md bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-600">
                          {v}
                          <button onClick={() => removeVal(i, v)} className="text-gray-400 hover:text-red-500">
                            ×
                          </button>
                        </span>
                      ))}
                    <input
                      placeholder="输入值回车，可多个"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          const inp = e.currentTarget.value.trim();
                          if (inp) addVal(i, inp);
                          e.currentTarget.value = '';
                        }
                      }}
                      className="min-w-16 flex-1 rounded-md border bg-white px-1.5 py-0.5 text-[11px] text-gray-700 focus:outline-none focus:ring-1 focus:ring-violet-400"
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

        <div className="mt-1 pl-0.5 leading-relaxed text-[10px] text-gray-400">
          {leftMode === 'node' && d.conditions && d.conditions.length ? (
            `即：命中（${d.conditionJoin === 'or' ? '任一' : '全部'}）` +
            d.conditions
              .map((c) => {
                const opN = OPERATOR_OPTIONS.find((o2) => o2.value === (c.op || 'eq'))?.label || c.op || '等于';
                const noV = c.op === 'empty' || c.op === 'notEmpty';
                const vs = (c.values || []).map((v) => (v === '' ? '空/0' : String(v))).join('/');
                return `${c.colLabel || c.col || '列'} ${opN}${noV ? '' : vs ? ` ∈{${vs}}` : ''}`;
              })
              .join(d.conditionJoin === 'or' ? ' 或 ' : ' 且 ')
          ) : (
            `即：${leftNodeRef?.label || d.fieldLabel || d.fieldKey || '判断对象'} ${op?.label ?? ''} ${
              d.valueSource === 'node'
                ? rightNodeRef?.label || '节点结果'
                : d.valueSource === 'field'
                  ? d.refValue?.fieldLabel || '其它字段'
                  : d.value || '常量'
            }`
          )}
        </div>

        {/* 持续条件：连续 N 天/周/月 */}
        <div className="rounded-md border border-violet-100 bg-violet-50/40 p-1.5">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[11px] text-gray-500">持续条件</span>
            <button
              onClick={() => update({ durationEnabled: !d.durationEnabled })}
              className="text-[11px] text-violet-600 hover:underline"
            >
              {d.durationEnabled ? '移除' : '添加'}
            </button>
          </div>
          {d.durationEnabled && (
            <div className="flex items-center gap-1">
              <input
                type="number"
                min={1}
                value={d.durationN ?? 1}
                onChange={(e) => update({ durationN: Math.max(1, Number(e.target.value) || 1) })}
                className="w-14 rounded-md border px-1.5 py-1 text-center text-[11px] text-gray-700 focus:outline-none focus:ring-1 focus:ring-violet-400"
              />
              <span className="text-xs text-gray-500">个连续</span>
              <select
                value={d.durationUnit ?? 'day'}
                onChange={(e) => update({ durationUnit: e.target.value as TimeUnit })}
                className="rounded-md border bg-white px-1.5 py-1 text-[11px] text-gray-700 focus:outline-none focus:ring-1 focus:ring-violet-400"
              >
                <option value="day">天</option>
                <option value="week">周</option>
                <option value="month">月</option>
              </select>
              <span className="text-xs text-gray-500">都满足</span>
            </div>
          )}
        </div>

        {(() => {
          const label = (() => {
            try {
              const leftId = (d as { leftNode?: NodeResultRef | null }).leftNode?.nodeId;
              const op = d.operator as string;
              if (!leftId || !['gt', 'gte', 'lt', 'lte', 'between'].includes(op)) return null;
              const num = (s: string | number | undefined | null): number | null => {
                const n = typeof s === 'number' ? s : parseFloat(String(s ?? ''));
                return Number.isFinite(n) ? n : null;
              };
              const a = num(d.value);
              const b = num(d.valueMax);
              if (a === null) return null;
              const range = (o: string, x: number, y: number | null) => {
                switch (o) {
                  case 'gt':
                  case 'gte':
                    return { lo: x, hi: Number.POSITIVE_INFINITY };
                  case 'lt':
                  case 'lte':
                    return { lo: Number.NEGATIVE_INFINITY, hi: x };
                  case 'between':
                    return { lo: Math.min(x, y ?? x), hi: Math.max(x, y ?? x) };
                  default:
                    return null;
                }
              };
              const selfR = range(op, a, b);
              if (!selfR) return null;
              const overlap = (p: { lo: number; hi: number }) => p.lo < selfR.hi && selfR.lo < p.hi;
              const same = allNodes.filter(
                (nd) =>
                  nd.id !== id &&
                  nd.type === 'condition' &&
                  ['gt', 'gte', 'lt', 'lte', 'between'].includes((nd.data as { operator?: string }).operator ?? '') &&
                  (nd.data as { leftNode?: NodeResultRef | null }).leftNode?.nodeId === leftId
              );
              const clash = same.find((nd) => {
                const av = num((nd.data as { value?: string | number }).value);
                if (av === null) return false;
                const bv = num((nd.data as { valueMax?: string | number }).valueMax);
                const r = range((nd.data as { operator?: string }).operator ?? '', av, bv);
                return r !== null && overlap(r);
              });
              if (!clash) return null;
              return (
                (clash.data as { resultLabel?: string }).resultLabel ||
                (clash.data as { label?: string }).label ||
                '另一条判断'
              );
            } catch {
              return null;
            }
          })();
          if (!label) return null;
          return (
              <div className="rounded-md bg-amber-50 px-2 py-1 text-[10px] leading-snug text-amber-600">
                与「{label}」判断区间重叠，可能重复告警。建议拆分为互斥区间（如 A: ≥15 ；B: 7~14）。
              </div>
            );
        })()}
    </NodeShell>
  );
});

// ---------- 计算节点（聚合 + 对比） ----------
const ComputeNode = memo(({ id, data }: NodeProps) => {
  const fnode = { id, kind: 'compute' as const, data, position: { x: 0, y: 0 } } as FlowNode;
  const d = data as unknown as ComputeNodeData;
  const update = useNodeUpdater(id);
  const tables = useRuleTables();
  const hasCompare = d.compare != null;
  const expr = d.expr ?? null;
  // 可引用的节点输出（含标量单值与列结果，如已过天数/开单天数等）
  const allNodes = useNodes();
  const rawRefs = getNodeOutputs(allNodes, id).filter((o) => o.ref.outputKind === 'scalar' || o.ref.outputKind === 'column');
  // 同一节点可能同时注册 column/scalar（如计算节点），下拉只需按节点去重，避免出现两个同名项
  const refOutputs = rawRefs.filter((o, i) => rawRefs.findIndex((x) => x.ref.nodeId === o.ref.nodeId) === i);
  const colsOfNode = (nid: string) => inferNodeCols(allNodes, tables, nid);
  // 计算方式：field=字段聚合（可再与节点运算）；node=两个节点结果直接运算（如 已过天数-开单天数）
  const mode: 'field' | 'node' = expr && expr.leftType === 'node' ? 'node' : 'field';
  const exprRefNode = refOutputs.find((o) => o.ref.nodeId === expr?.ref?.nodeId)?.ref ?? expr?.ref ?? undefined;
  const exprLeftNode = refOutputs.find((o) => o.ref.nodeId === expr?.left?.nodeId)?.ref ?? expr?.left ?? undefined;
  // 点选式表达式：token 序列 + 常量输入框
  const [constVal, setConstVal] = useState('');
  const exprTokens: ExprToken[] = Array.isArray(expr?.tokens) ? (expr!.tokens as ExprToken[]) : [];
  const exprSrcCols = colsOfNode(expr?.left?.nodeId ?? '');
  const setTokens = (tk: ExprToken[]) => update({ expr: { ...(expr as ComputeExpr), tokens: tk, exprText: '' } });
  const addToken = (t: ExprToken) => setTokens([...exprTokens, t]);
  const popToken = () => setTokens(exprTokens.slice(0, -1));
  const tokenText = (t: ExprToken): string => {
    switch (t.kind) {
      case 'field': return t.label || t.col;
      case 'op': return t.op === 'add' ? '＋' : t.op === 'sub' ? '－' : t.op === 'mul' ? '×' : '÷';
      case 'paren': return t.paren;
      case 'num': return t.value;
      default: return '';
    }
  };
  const OP_OPTIONS = [
    { value: 'sub', label: '－' },
    { value: 'add', label: '＋' },
    { value: 'mul', label: '×' },
    { value: 'div', label: '÷' },
  ];
  const opSym = (op?: string) => OP_OPTIONS.find((o) => o.value === op)?.label ?? '－';
  // 切换计算方式：节点间运算时构造一份默认 expr
  const setMode = (m: 'field' | 'node') => {
    if (m === 'node') {
      update({ expr: { op: 'sub', leftType: 'node', left: undefined, refType: 'node', ref: undefined, constValue: '' } });
    } else {
      update({ expr: null });
    }
  };
  return (
    <NodeShell fnode={fnode}>
      <div className="space-y-1.5">
        {/* 计算方式切换 */}
        <div className="flex items-center gap-1 rounded-md border border-cyan-100 bg-cyan-50/50 p-0.5">
          <button
            type="button"
            onClick={() => setMode('field')}
            className={`flex-1 rounded px-2 py-1 text-[11px] transition ${mode === 'field' ? 'bg-cyan-600 text-white shadow-sm' : 'text-gray-500 hover:text-cyan-700'}`}
          >
            字段聚合
          </button>
          <button
            type="button"
            onClick={() => setMode('node')}
            className={`flex-1 rounded px-2 py-1 text-[11px] transition ${mode === 'node' ? 'bg-cyan-600 text-white shadow-sm' : 'text-gray-500 hover:text-cyan-700'}`}
          >
            两节点结果运算
          </button>
        </div>

        {mode === 'node' ? (
          <>
            <div className="rounded-md border border-cyan-100 bg-cyan-50/40 p-1.5">
              <div className="mb-1 flex items-center gap-1">
                <span className="text-[11px] text-gray-500">两个节点结果直接运算</span>
              </div>
              <div className="space-y-1.5">
                {/* 点选式组合表达式：先在下方「左侧」选节点，再点字段/运算符/括号拼公式 */}
                <div className="rounded-md border border-cyan-200 bg-white p-1.5">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-[11px] font-medium text-cyan-700">组合表达式（点选拼装，单节点即可）</span>
                    <div className="flex items-center gap-1">
                      <button type="button" onClick={popToken} className="rounded border border-gray-200 px-1.5 py-0.5 text-[10px] text-gray-500 hover:bg-gray-50">退格</button>
                      <button type="button" onClick={() => setTokens([])} className="rounded border border-gray-200 px-1.5 py-0.5 text-[10px] text-gray-500 hover:bg-gray-50">清空</button>
                    </div>
                  </div>
                  {/* 第1步：先选数据节点（只需一个节点，公式引用它的字段逐行运算） */}
                  <div className="mb-1.5 flex items-center gap-1">
                    <span className="shrink-0 text-[11px] text-gray-400">数据节点</span>
                    <select
                      value={expr?.left?.nodeId ?? ''}
                      onChange={(e) => {
                        const ref = refOutputs.find((o) => o.ref.nodeId === e.target.value)?.ref;
                        update({ expr: { op: expr?.op ?? 'sub', leftType: 'node', left: ref, refType: expr?.refType ?? 'node', ref: expr?.ref, constValue: expr?.constValue ?? '', tokens: [] } });
                      }}
                      className="min-w-0 flex-1 rounded-md border border-cyan-200 bg-white px-2 py-1 text-[11px] text-gray-700 focus:outline-none focus:ring-1 focus:ring-cyan-400"
                    >
                      <option value="">选择节点（如：店仓销售与库存）…</option>
                      {refOutputs.map((o) => (
                        <option key={o.ref.nodeId} value={o.ref.nodeId}>{o.ref.label}</option>
                      ))}
                    </select>
                  </div>
                  {/* 当前表达式 */}
                  <div className="flex min-h-[26px] flex-wrap items-center gap-1 rounded bg-cyan-50/60 px-1.5 py-1">
                    {exprTokens.length === 0 ? (
                      <span className="text-[10px] text-gray-400">先在下方「左侧」选节点，然后点字段与运算符拼公式，如 数量 ÷ ( 数量 ＋ 库存汇总 )</span>
                    ) : (
                      exprTokens.map((t, i) => (
                        <button
                          key={i}
                          type="button"
                          title="点击删除该片段"
                          onClick={() => setTokens(exprTokens.filter((_, idx) => idx !== i))}
                          className={`rounded px-1.5 py-0.5 text-[11px] leading-none ${
                            t.kind === 'field'
                              ? 'bg-cyan-600 text-white'
                              : t.kind === 'op'
                                ? 'bg-amber-100 font-bold text-amber-700'
                                : t.kind === 'paren'
                                  ? 'bg-gray-300 font-bold text-gray-700'
                                  : 'bg-emerald-100 text-emerald-700'
                          }`}
                        >
                          {tokenText(t)}
                        </button>
                      ))
                    )}
                  </div>
                  {/* 字段 chips */}
                  {exprSrcCols.length > 0 ? (
                    <div className="mt-1.5">
                      <div className="text-[10px] text-gray-400">点字段加入：</div>
                      <div className="mt-0.5 flex flex-wrap gap-1">
                        {exprSrcCols.map((c) => (
                          <button
                            key={c.key}
                            type="button"
                            onClick={() => addToken({ kind: 'field', col: c.key, label: c.label })}
                            className="rounded border border-cyan-200 bg-cyan-50 px-1.5 py-0.5 text-[10px] text-cyan-700 hover:bg-cyan-100"
                          >
                            {c.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="mt-1 text-[10px] text-gray-400">← 请先在下方「左侧」选择一个节点结果（如：店仓销售与库存），这里会出现可点选的字段</div>
                  )}
                  {/* 运算符 / 括号 / 常量 */}
                  <div className="mt-1.5 flex flex-wrap items-center gap-1">
                    {([
                      { op: 'add' as ArithmeticOp, s: '＋' },
                      { op: 'sub' as ArithmeticOp, s: '－' },
                      { op: 'mul' as ArithmeticOp, s: '×' },
                      { op: 'div' as ArithmeticOp, s: '÷' },
                    ]).map((o) => (
                      <button key={o.op} type="button" onClick={() => addToken({ kind: 'op', op: o.op })}
                        className="h-6 w-6 rounded border border-amber-200 bg-amber-50 text-[12px] font-bold text-amber-700 hover:bg-amber-100">
                        {o.s}
                      </button>
                    ))}
                    <button type="button" onClick={() => addToken({ kind: 'paren', paren: '(' })}
                      className="h-6 w-6 rounded border border-gray-300 bg-gray-100 text-[12px] font-bold text-gray-700 hover:bg-gray-200">(</button>
                    <button type="button" onClick={() => addToken({ kind: 'paren', paren: ')' })}
                      className="h-6 w-6 rounded border border-gray-300 bg-gray-100 text-[12px] font-bold text-gray-700 hover:bg-gray-200">)</button>
                    <span className="mx-0.5 text-gray-200">|</span>
                    <input
                      value={constVal}
                      onChange={(e) => setConstVal(e.target.value.replace(/[^0-9.\-]/g, ''))}
                      placeholder="常量"
                      className="h-6 w-14 rounded border border-emerald-200 bg-white px-1.5 text-[11px] text-gray-700 focus:outline-none focus:ring-1 focus:ring-emerald-400"
                    />
                    <button
                      type="button"
                      onClick={() => { if (constVal.trim()) { addToken({ kind: 'num', value: constVal.trim() }); setConstVal(''); } }}
                      className="h-6 rounded border border-emerald-200 bg-emerald-50 px-2 text-[10px] text-emerald-700 hover:bg-emerald-100"
                    >
                      加常量
                    </button>
                  </div>
                  <div className="mt-1 text-[10px] text-gray-400">点击上方公式中的片段可删除；结果列名在最下方「结果名」设置（如：售罄率）。</div>
                </div>
                {/* 两节点/常量 简单运算（高级，可选）：当已使用上方点选公式时隐藏，公式优先 */}
                {exprTokens.some((t) => t.kind === 'field') ? (
                  <div className="rounded-md border border-emerald-100 bg-emerald-50/50 px-2 py-1.5 text-[10px] text-emerald-700">
                    已使用上方组合公式（单个数据节点逐行运算）。若要改用「两个节点结果 / 与常量」的简单 A 运算 B，请先「清空」上方公式。
                  </div>
                ) : (
                <>
                <div className="rounded-md border border-dashed border-cyan-200 px-1.5 py-1.5">
                  <div className="mb-1 text-[10px] text-gray-400">高级（可选）：不用公式时，可做两个节点结果 / 与常量的简单 A 运算 B</div>
                {expr?.left?.nodeId ? (
                  <div className="flex items-center gap-1">
                    <span className="shrink-0 text-[11px] text-gray-400">左列</span>
                    <select
                      value={expr?.left?.col ?? ''}
                      onChange={(e) => {
                        const c = colsOfNode(expr?.left?.nodeId || '').find((x) => x.key === e.target.value);
                        update({ expr: { ...(expr as ComputeExpr), left: { ...(expr?.left as NodeResultRef), col: e.target.value || undefined, colLabel: c?.label } } });
                      }}
                      className="min-w-0 flex-1 rounded-md border bg-white px-2 py-1 text-[11px] text-gray-700 focus:outline-none focus:ring-1 focus:ring-cyan-400"
                    >
                      <option value="">（整表）选择列以做同节点两列运算…</option>
                      {colsOfNode(expr?.left?.nodeId).map((c) => (
                        <option key={c.key} value={c.key}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}
                <div className="flex items-center gap-1">
                  <span className="shrink-0 text-[11px] text-gray-400">运算</span>
                  <select
                    value={expr?.op ?? 'sub'}
                    onChange={(e) => update({ expr: { ...(expr as ComputeExpr), op: e.target.value as ArithmeticOp } })}
                    className="rounded-md border bg-white px-1.5 py-1 text-[11px] text-gray-700 focus:outline-none focus:ring-1 focus:ring-cyan-400"
                  >
                    {OP_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex items-center gap-1">
                  <span className="shrink-0 text-[11px] text-gray-400">右侧</span>
                  {expr?.refType === 'const' ? (
                    <input
                      value={expr.constValue ?? ''}
                      onChange={(e) => update({ expr: { ...expr, constValue: e.target.value } })}
                      placeholder="输入常量数字"
                      className="min-w-0 flex-1 rounded-md border px-2 py-1 text-[11px] text-gray-700 focus:outline-none focus:ring-1 focus:ring-cyan-400"
                    />
                  ) : (
                    <select
                      value={expr?.ref?.nodeId ?? ''}
                      onChange={(e) => {
                        const ref = refOutputs.find((o) => o.ref.nodeId === e.target.value)?.ref;
                        update({ expr: { ...(expr as ComputeExpr), refType: 'node', ref } });
                      }}
                      className="min-w-0 flex-1 rounded-md border bg-white px-2 py-1 text-[11px] text-gray-700 focus:outline-none focus:ring-1 focus:ring-cyan-400"
                    >
                      <option value="">选择节点（如：本月开单天数）…</option>
                      {refOutputs.map((o) => (
                        <option key={o.ref.nodeId} value={o.ref.nodeId}>
                          {o.ref.label}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
                {expr?.refType === 'node' && expr?.ref?.nodeId ? (
                  <div className="flex items-center gap-1">
                    <span className="shrink-0 text-[11px] text-gray-400">右列</span>
                    <select
                      value={expr?.ref?.col ?? ''}
                      onChange={(e) => {
                        const c = colsOfNode(expr?.ref?.nodeId || '').find((x) => x.key === e.target.value);
                        update({ expr: { ...(expr as ComputeExpr), ref: { ...(expr?.ref as NodeResultRef), col: e.target.value || undefined, colLabel: c?.label } } });
                      }}
                      className="min-w-0 flex-1 rounded-md border bg-white px-2 py-1 text-[11px] text-gray-700 focus:outline-none focus:ring-1 focus:ring-cyan-400"
                    >
                      <option value="">（整表）选择列以做同节点两列运算…</option>
                      {colsOfNode(expr?.ref?.nodeId || '').map((c) => (
                        <option key={c.key} value={c.key}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}
                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => update({ expr: { ...(expr as ComputeExpr), refType: expr?.refType === 'const' ? 'node' : 'const' } })}
                    className="text-[11px] text-cyan-600 hover:underline"
                  >
                    {expr?.refType === 'const' ? '改用节点结果' : '改用常量'}
                  </button>
                </div>
                <div className="rounded bg-white/70 px-2 py-1 text-[11px] text-gray-600">
                  {exprLeftNode?.label ?? '左侧节点'} {opSym(expr?.op)} {expr?.refType === 'const' ? (expr?.constValue || '常量') : (exprRefNode?.label ?? '右侧节点')}
                </div>
                </div>
                </>
                )}
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-gray-400">结果名</span>
              <input
                value={d.resultLabel}
                onChange={(e) => update({ resultLabel: e.target.value })}
                placeholder="如：未开单天数"
                className="min-w-0 flex-1 rounded-md border px-2 py-1 text-xs text-gray-700 focus:outline-none focus:ring-1 focus:ring-cyan-400"
              />
            </div>
          </>
        ) : (
          <>
        <div className="mb-0.5 flex items-center gap-1">
          <span className="shrink-0 text-[10px] uppercase tracking-wide text-gray-400">统计时间窗口</span>
        </div>
        <TimeComponent
          value={d.timeWindow}
          onChange={(tw) => update({ timeWindow: tw })}
        />
        <FieldSelect value={d} tables={tables} placeholder="选择计算字段…" onChange={(ref) => update({ ...ref })} />
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-gray-400">聚合</span>
          <select
            value={d.fn}
            onChange={(e) => update({ fn: e.target.value as ComputeNodeData['fn'] })}
            className="min-w-0 flex-1 rounded-md border bg-white px-2 py-1 text-xs text-gray-700 focus:outline-none focus:ring-1 focus:ring-cyan-400"
          >
            {AGG_FN_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-gray-400">结果名</span>
          <input
            value={d.resultLabel}
            onChange={(e) => update({ resultLabel: e.target.value })}
            placeholder="如：近7日总金额"
            className="min-w-0 flex-1 rounded-md border px-2 py-1 text-xs text-gray-700 focus:outline-none focus:ring-1 focus:ring-cyan-400"
          />
        </div>
        {/* 参与运算的其它节点结果 */}
        <div className="rounded-md border border-cyan-100 bg-cyan-50/40 p-1.5">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[11px] text-gray-500">参与运算的其它节点结果</span>
            <button
              onClick={() => update({ expr: expr ? null : { op: 'sub', leftType: 'self', order: 'self_first', refType: 'node', ref: undefined, constValue: '' } })}
              className="text-[11px] text-cyan-600 hover:underline"
            >
              {expr ? '移除' : '添加'}
            </button>
          </div>
          {expr && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-1">
                <span className="text-[11px] text-gray-400">与</span>
                {expr.refType === 'const' ? (
                  <input
                    value={expr.constValue ?? ''}
                    onChange={(e) => update({ expr: { ...expr, constValue: e.target.value } })}
                    placeholder="输入常量数字"
                    className="min-w-0 flex-1 rounded-md border px-2 py-1 text-[11px] text-gray-700 focus:outline-none focus:ring-1 focus:ring-cyan-400"
                  />
                ) : (
                  <select
                    value={expr.ref?.nodeId ?? ''}
                    onChange={(e) => update({ expr: { ...expr, refType: 'node', ref: refOutputs.find((o) => o.ref.nodeId === e.target.value)?.ref } })}
                    className="min-w-0 flex-1 rounded-md border bg-white px-2 py-1 text-[11px] text-gray-700 focus:outline-none focus:ring-1 focus:ring-cyan-400"
                  >
                    <option value="">选择节点结果…</option>
                    {refOutputs.map((o) => (
                      <option key={o.ref.nodeId} value={o.ref.nodeId}>
                        {o.ref.label}
                      </option>
                    ))}
                  </select>
                )}
                <button
                  type="button"
                  onClick={() => update({ expr: { ...expr, refType: expr.refType === 'const' ? 'node' : 'const' } })}
                  className="shrink-0 text-[11px] text-cyan-600 hover:underline"
                >
                  {expr.refType === 'const' ? '节点' : '常量'}
                </button>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-[11px] text-gray-400">顺序</span>
                <select
                  value={expr.order ?? 'self_first'}
                  onChange={(e) => update({ expr: { ...expr, order: e.target.value as 'self_first' | 'ref_first' } })}
                  className="min-w-0 flex-1 rounded-md border bg-white px-2 py-1 text-[11px] text-gray-700 focus:outline-none focus:ring-1 focus:ring-cyan-400"
                >
                  <option value="self_first">聚合结果 在前</option>
                  <option value="ref_first">节点结果 在前</option>
                </select>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-[11px] text-gray-400">运算</span>
                <select
                  value={expr.op}
                  onChange={(e) => update({ expr: { ...expr, op: e.target.value as ArithmeticOp } })}
                  className="rounded-md border bg-white px-1.5 py-1 text-[11px] text-gray-700 focus:outline-none focus:ring-1 focus:ring-cyan-400"
                >
                  {OP_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <span
                  className="truncate text-[11px] text-gray-500"
                >
                  {expr.order === 'ref_first'
                    ? `${expr.refType === 'const' ? (expr.constValue || '常量') : (exprRefNode?.label ?? '节点结果')} ${opSym(expr.op)} 聚合结果`
                    : `聚合结果 ${opSym(expr.op)} ${expr.refType === 'const' ? (expr.constValue || '常量') : (exprRefNode?.label ?? '节点结果')}`}
                </span>
              </div>
            </div>
          )}
        </div>
          </>
        )}
        {/* 聚合结果对比 */}
        <div className="rounded-md border border-cyan-100 bg-cyan-50/40 p-1.5">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[11px] text-gray-500">结果对比条件</span>
            <button
              onClick={() => update({ compare: hasCompare ? null : { op: 'gt', value: '' } })}
              className="text-[11px] text-cyan-600 hover:underline"
            >
              {hasCompare ? '移除' : '添加'}
            </button>
          </div>
          {hasCompare && (
            <div className="flex items-center gap-1">
              <select
                value={d.compare?.op}
                onChange={(e) => update({ compare: { op: e.target.value as Operator, value: d.compare?.value ?? '' } })}
                className="rounded-md border bg-white px-1.5 py-1 text-[11px] text-gray-700 focus:outline-none focus:ring-1 focus:ring-cyan-400"
              >
                {['gt', 'gte', 'lt', 'lte', 'eq', 'neq'].map((o) => (
                  <option key={o} value={o}>
                    {OPERATOR_OPTIONS.find((x) => x.value === o)?.label}
                  </option>
                ))}
              </select>
              <input
                value={d.compare?.value ?? ''}
                onChange={(e) => update({ compare: { op: d.compare?.op ?? 'gt', value: e.target.value } })}
                placeholder="阈值"
                className="min-w-0 flex-1 rounded-md border px-2 py-1 text-[11px] text-gray-700 focus:outline-none focus:ring-1 focus:ring-cyan-400"
              />
            </div>
          )}
        </div>
      </div>
    </NodeShell>
  );
});

// ---------- 基础数据节点（取一列去重值，维度全集，如店仓表→店仓） ----------
const BaseNode = memo(({ id, data }: NodeProps) => {
  const fnode = { id, kind: 'base' as const, data, position: { x: 0, y: 0 } } as FlowNode;
  const d = data as unknown as BaseNodeData;
  const update = useNodeUpdater(id);
  const tables = useRuleTables();
  const allNodes = useNodes();
  const source = d.source ?? 'table';
  const nodeOutputs = getNodeOutputs(allNodes, id).filter((o) => o.ref.outputKind === 'column');

  // 数据表模式：当前表与字段
  const table = tables.find((t) => t.id === d.tableId) ?? tables[0];
  const tableFields = table?.fields ?? [];
  // 节点结果模式：上游节点输出的列（取自画布上该节点配置的结果列，预览时由虚拟表推导）
  const srcNodeOut = source === 'node' ? nodeOutputs.find((o) => o.ref.nodeId === d.sourceNode) : undefined;
  const nodeFields = useMemo<{ key: string; alias: string }[]>(() => {
    // 节点输出列：用引用 label 作为一列（逐行值列），其余列由预览虚拟表补全
    if (srcNodeOut) return [{ key: srcNodeOut.ref.label, alias: srcNodeOut.ref.label }];
    return [];
  }, [srcNodeOut]);
  const fields = source === 'node' ? nodeFields : tableFields;
  const rowLabel = SRC_ROW_CLS;

  // 未显式选表时，把兜底显示的第一张表同步进 data，保证预览/执行能取到 tableId
  useEffect(() => {
    if (source === 'table' && !d.tableId && tables[0]) {
      update({ tableId: tables[0].id, tableName: tables[0].name } as Partial<BaseNodeData>);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d.tableId, tables, source]);

  return (
    <NodeShell fnode={fnode}>
      <div className="space-y-1.5">
        <DataSourcePicker
          source={source}
          sourceNode={d.sourceNode}
          nodeOptions={nodeOutputs}
          onSourceChange={(v) => update({ source: v, sourceNode: v === 'node' ? (d.sourceNode ?? nodeOutputs[0]?.ref.nodeId) : undefined, sourceNodeLabel: v === 'node' ? nodeOutputs.find((o) => o.ref.nodeId === (d.sourceNode ?? nodeOutputs[0]?.ref.nodeId))?.ref.label : undefined } as Partial<BaseNodeData>)}
          onNodeChange={(ref) => update({ sourceNode: ref?.nodeId, sourceNodeLabel: ref?.label, fieldKey: ref?.label ?? '', fieldLabel: ref?.label ?? '' } as Partial<BaseNodeData>)}
          tableBlock={
            <div>
              <div className={rowLabel}>基础数据表（维度全集来源）</div>
              <select
                value={table?.id ?? ''}
                onChange={(e) => {
                  const t = tables.find((x) => x.id === e.target.value);
                  if (t)
                    update({
                      tableId: t.id,
                      tableName: t.name,
                      fieldKey: '',
                      fieldLabel: '',
                    } as Partial<BaseNodeData>);
                }}
                className={SRC_INPUT_CLS}
              >
                {tables.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
          }
        />
        {source === 'table' && (
          <div>
            <div className={rowLabel}>取用列（勾选要输出的列）</div>
            <div className="field-list-scroll max-h-36 space-y-0.5 overflow-y-auto rounded-md border border-slate-200 bg-slate-50/50 p-1.5">
              {fields.map((f) => {
                const sel = Array.isArray(d.columns) ? d.columns : [];
                const inList = sel.some((c) => c.key === f.key);
                return (
                  <label
                    key={f.key}
                    className="flex cursor-pointer select-none items-center gap-1.5 rounded px-1 py-0.5 text-[11px] text-slate-700 hover:bg-slate-100"
                  >
                    <input
                      type="checkbox"
                      className="h-3.5 w-3.5 accent-orange-500"
                      checked={inList}
                      onChange={(e) => {
                        const next = e.target.checked
                          ? [...sel, { key: f.key, label: f.alias || f.key }]
                          : sel.filter((c) => c.key !== f.key);
                        update({
                          columns: next,
                          distinct: next.length !== 1 ? (d.distinct ? false : undefined) : d.distinct,
                          fieldKey: next.length === 1 ? next[0].key : d.fieldKey,
                          fieldLabel: next.length === 1 ? next[0].label : d.fieldLabel,
                        } as Partial<BaseNodeData>);
                      }}
                    />
                    <span className="truncate">{f.alias || f.key}</span>
                  </label>
                );
              })}
            </div>
            {(() => {
              const sel = Array.isArray(d.columns) ? d.columns : [];
              const single = sel.length === 1;
              const oldSingle = !Array.isArray(d.columns) && !!d.fieldKey;
              return (single || oldSingle) ? (
                <label className="mt-1 flex cursor-pointer select-none items-center gap-1.5 text-[11px] text-slate-600">
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 accent-orange-500"
                    checked={!!d.distinct}
                    onChange={(e) => update({ distinct: e.target.checked } as Partial<BaseNodeData>)}
                  />
                  去重（仅当勾选单列时可用）
                </label>
              ) : (
                <div className="mt-1 text-[10px] text-slate-400">勾选多列时不支持去重。</div>
              );
            })()}
          </div>
        )}
        <input
          value={d.resultLabel}
          onChange={(e) => update({ resultLabel: e.target.value } as Partial<BaseNodeData>)}
          placeholder="结果命名，如：全部店仓"
          className="w-full rounded-md border px-2 py-1 text-xs text-gray-700 focus:outline-none focus:ring-1 focus:ring-orange-400"
        />
        <div className="text-[10px] text-gray-400">
          {source === 'node'
            ? `取自节点结果「${d.sourceNodeLabel || '上一步'}」的去重值，作为后续匹配/补全的基础集合`
            : `取 ${table?.name || '?'} 中「${d.fieldLabel || '维度列'}」的全部去重值，作为后续匹配/补全的基础集合`}
        </div>
      </div>
    </NodeShell>
  );
});

// ---------- 查找节点（跨表匹配） ----------
const LookupNode = memo(({ id, data }: NodeProps) => {
  const fnode = { id, kind: 'lookup' as const, data, position: { x: 0, y: 0 } } as FlowNode;
  const d = data as unknown as LookupNodeData;
  const mode = d.mode ?? 'field';
  const update = useNodeUpdater(id);
  const tables = useRuleTables();
  const allNodes = useNodes();
  const source = d.source ?? 'table';
  const nodeOutputs = getNodeOutputs(allNodes, id).filter((o) => o.ref.outputKind === 'column');
  const tableTarget = tables.find((t) => t.id === d.tableId) ?? tables[0];
  const tableTargetFields = tableTarget?.fields ?? [];
  // 节点结果作为"目标表"：字段取该结果列
  const srcNodeOut = source === 'node' ? nodeOutputs.find((o) => o.ref.nodeId === d.sourceNode) : undefined;
  const nodeTargetFields = srcNodeOut
    ? [{ key: srcNodeOut.ref.label, alias: srcNodeOut.ref.label, type: 'string' as const }]
    : [];
  const targetFields = source === 'node' ? nodeTargetFields : tableTargetFields;
  const targetName = source === 'node' ? d.sourceNodeLabel || '上游结果' : tableTarget?.name;
  const hasDate = targetFields.some((f) => f.type === 'date');
  const dateFields = hasDate ? targetFields.filter((f) => f.type === 'date') : targetFields;
  const numFields = targetFields.filter((f) => f.type === 'number');
  const rowLabel = 'mb-1 mt-2 text-[11px] font-medium text-gray-500 first:mt-0';

  const upd = (patch: Partial<LookupNodeData>) => update({ ...d, ...patch });

  // 未显式选目标表时，同步兜底表 id，保证预览/执行取到 tableId
  useEffect(() => {
    if (source === 'table' && !d.tableId && tables[0]) {
      upd({ tableId: tables[0].id, tableName: tables[0].name });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d.tableId, tables, source]);

  return (
    <NodeShell fnode={fnode}>
      <div className="space-y-1.5">
        <div className="flex gap-1 rounded-lg bg-gray-100 p-0.5">
          {(['field', 'aggregate'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => upd({ mode: m })}
              className={`flex-1 rounded-md py-1 text-[11px] font-medium transition ${
                mode === m ? 'bg-white text-emerald-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {m === 'field' ? '返回字段值' : '聚合带回（汇总）'}
            </button>
          ))}
        </div>

        <DataSourcePicker
          source={source}
          sourceNode={d.sourceNode}
          nodeOptions={nodeOutputs}
          onSourceChange={(v) =>
            upd({
              source: v,
              sourceNode: v === 'node' ? d.sourceNode ?? nodeOutputs[0]?.ref.nodeId : undefined,
              sourceNodeLabel: v === 'node' ? nodeOutputs.find((o) => o.ref.nodeId === (d.sourceNode ?? nodeOutputs[0]?.ref.nodeId))?.ref.label : undefined,
              matchField: '',
              matchFieldLabel: '',
              returnField: '',
              returnFieldLabel: '',
              aggField: '',
              aggFieldLabel: '',
            })
          }
          onNodeChange={(ref) =>
            upd({ sourceNode: ref?.nodeId, sourceNodeLabel: ref?.label, matchField: '', matchFieldLabel: '', returnField: '', returnFieldLabel: '', aggField: '', aggFieldLabel: '' })
          }
          nodeLabel="查询目标节点（在其输出结果里找）"
          nodePlaceholder="选择上一步节点结果作为查找目标…"
          tableBlock={
            <div>
              <div className={rowLabel}>查询目标表（在这张表里找）</div>
              <select
                value={tableTarget?.id ?? ''}
                onChange={(e) => {
                  const t = tables.find((x) => x.id === e.target.value);
                  if (t)
                    upd({
                      tableId: t.id,
                      tableName: t.name,
                      matchField: '',
                      matchFieldLabel: '',
                      returnField: '',
                      returnFieldLabel: '',
                      dateField: '',
                      dateFieldLabel: '',
                      aggField: '',
                      aggFieldLabel: '',
                    });
                }}
                className="w-full rounded-md border bg-white px-2 py-1 text-xs text-gray-700 focus:outline-none focus:ring-1 focus:ring-green-400"
              >
                {tables.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
          }
        />

        {source === 'node' && mode === 'aggregate' && (
          <div className="rounded-md bg-emerald-50 px-2 py-1 text-[10px] leading-relaxed text-emerald-700">
            节点结果模式：在「{targetName}」的输出里按匹配键聚合带回，时间范围以上游为准。
          </div>
        )}

        <div>
          <div className={rowLabel}>{targetName || '目标'}里的匹配字段（如：店仓）</div>
          <select
            value={d.matchField}
            onChange={(e) => {
              const f = targetFields.find((x) => x.key === e.target.value);
              upd({ matchField: e.target.value, matchFieldLabel: f?.alias ?? f?.key ?? '' });
            }}
            className="w-full rounded-md border bg-white px-2 py-1 text-xs text-gray-700 focus:outline-none focus:ring-1 focus:ring-green-400"
          >
            <option value="">选择匹配字段…</option>
            {targetFields.map((f) => (
              <option key={f.key} value={f.key}>
                {f.alias || f.key}
              </option>
            ))}
          </select>
        </div>
        <div>
          <div className={rowLabel}>按哪个值去匹配（基础数据/上游字段）</div>
          <FieldSelect
            value={d.key}
            tables={tables}
            placeholder="选择匹配键字段，如：店仓…"
            onChange={(ref) => upd({ key: ref })}
          />
        </div>

        {mode === 'field' ? (
          <>
            <div>
              <div className={rowLabel}>{targetName || '目标表'}里要带回的字段</div>
              <select
                value={d.returnField}
                onChange={(e) => {
                  const f = targetFields.find((x) => x.key === e.target.value);
                  upd({ returnField: e.target.value, returnFieldLabel: f?.alias ?? f?.key ?? '' });
                }}
                className="w-full rounded-md border bg-white px-2 py-1 text-xs text-gray-700 focus:outline-none focus:ring-1 focus:ring-green-400"
              >
                <option value="">选择返回字段…</option>
                {targetFields.map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.alias || f.key}
                  </option>
                ))}
              </select>
            </div>
            <input
              value={d.returnLabel}
              onChange={(e) => upd({ returnLabel: e.target.value })}
              placeholder="结果标签，如：负责人"
              className="w-full rounded-md border px-2 py-1 text-xs text-gray-700 focus:outline-none focus:ring-1 focus:ring-green-400"
            />
            <div className="text-[10px] text-gray-400">
              按 {d.key?.fieldLabel || '?'} = {targetName || 'B'}.{d.matchField || '?'} 查找，带回{' '}
              {d.returnFieldLabel || '?'}
            </div>
          </>
        ) : (
          <>
            <div>
              <div className={rowLabel}>{targetName || '目标表'}的日期字段</div>
              <select
                value={d.dateField ?? ''}
                onChange={(e) => {
                  const f = dateFields.find((x) => x.key === e.target.value);
                  upd({ dateField: e.target.value, dateFieldLabel: f?.alias ?? f?.key ?? '' });
                }}
                className="w-full rounded-md border bg-white px-2 py-1 text-xs text-gray-700 focus:outline-none focus:ring-1 focus:ring-green-400"
              >
                <option value="">{hasDate ? '选择日期字段…' : '选择字段（未识别到日期类型）…'}</option>
                {dateFields.map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.alias || f.key}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <div className={rowLabel}>统计日期范围</div>
              <TimeComponent
                value={d.timeWindow ?? { preset: 'specificMonth' }}
                onChange={(tw) => upd({ timeWindow: tw })}
              />
            </div>
            <div>
              <div className={rowLabel}>汇总方式与汇总字段</div>
              <div className="flex gap-1.5">
                <select
                  value={d.aggFn ?? 'sum'}
                  onChange={(e) => upd({ aggFn: e.target.value as LookupNodeData['aggFn'] })}
                  className="w-24 shrink-0 rounded-md border bg-white px-1.5 py-1 text-xs text-gray-700 focus:outline-none focus:ring-1 focus:ring-green-400"
                >
                  {AGG_FN_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <select
                  value={d.aggField ?? ''}
                  onChange={(e) => {
                    const f = targetFields.find((x) => x.key === e.target.value);
                    upd({ aggField: e.target.value, aggFieldLabel: f?.alias ?? f?.key ?? '' });
                  }}
                  className="min-w-0 flex-1 rounded-md border bg-white px-2 py-1 text-xs text-gray-700 focus:outline-none focus:ring-1 focus:ring-green-400"
                >
                  <option value="">选择汇总字段，如：成交金额…</option>
                  {(numFields.length ? numFields : targetFields).map((f) => (
                    <option key={f.key} value={f.key}>
                      {f.alias || f.key}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <label className="flex cursor-pointer items-center gap-1.5 pt-0.5 text-[11px] text-gray-600">
              <input
                type="checkbox"
                checked={d.fillZero ?? true}
                onChange={(e) => upd({ fillZero: e.target.checked })}
                className="h-3.5 w-3.5 accent-emerald-600"
              />
              匹配不到记录的按 0 计入（如该店当期无成交）
            </label>
            <input
              value={d.aggLabel ?? ''}
              onChange={(e) => upd({ aggLabel: e.target.value })}
              placeholder="汇总结果命名，如：8月成交金额"
              className="w-full rounded-md border px-2 py-1 text-xs text-gray-700 focus:outline-none focus:ring-1 focus:ring-green-400"
            />
            <div className="text-[10px] text-gray-400">
              在{targetName || '目标表'}中按 {d.matchFieldLabel || '?'}={d.key?.fieldLabel || '?'} 匹配，时间窗内{' '}
              {(d.aggFn ? AGG_FN_OPTIONS.find((o) => o.value === d.aggFn)?.label : '求和') || '求和'}({d.aggFieldLabel || '汇总字段'}
              )，{d.fillZero === false ? '无记录忽略' : '无记录记0'}
            </div>
          </>
        )}
      </div>
    </NodeShell>
  );
});

// ---------- 关联节点 ----------
const RelationNode = memo(({ id, data }: NodeProps) => {
  const fnode = { id, kind: 'relation' as const, data, position: { x: 0, y: 0 } } as FlowNode;
  const d = data as unknown as RelationNodeData;
  const update = useNodeUpdater(id);
  const tables = useRuleTables();
  const upd = (patch: Partial<RelationNodeData>) => update({ ...d, ...patch });
  const target = tables.find((t) => t.id === d.targetTableId) ?? tables[1];
  const targetFields = target?.fields ?? [];
  return (
    <NodeShell fnode={fnode}>
      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5 text-xs text-gray-400">
          类型
          <select
            value={d.relationType}
            onChange={(e) => upd({ relationType: e.target.value as RelationNodeData['relationType'] })}
            className="flex-1 rounded-md border bg-white px-2 py-1 text-xs text-gray-700 focus:outline-none focus:ring-1 focus:ring-slate-400"
          >
            <option value="inner">内连接 INNER</option>
            <option value="left">左连接 LEFT</option>
          </select>
        </div>
        <div>
          <div className="mb-0.5 text-xs text-gray-400">本表关联字段</div>
          <FieldSelect value={d} tables={tables} onChange={(ref) => update({ ...ref })} />
        </div>
        <div>
          <div className="mb-0.5 text-xs text-gray-400">关联目标表</div>
          <select
            value={d.targetTableId}
            onChange={(e) => {
              const t = tables.find((x) => x.id === e.target.value);
              if (t) upd({ targetTableId: t.id, targetTable: t.name, targetField: '' });
            }}
            className="w-full rounded-md border bg-white px-2 py-1 text-xs text-gray-700 focus:outline-none focus:ring-1 focus:ring-slate-400"
          >
            {tables.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <div className="mb-0.5 text-xs text-gray-400">目标表关联字段</div>
          <select
            value={d.targetField}
            onChange={(e) => upd({ targetField: e.target.value })}
            className="w-full rounded-md border bg-white px-2 py-1 text-xs text-gray-700 focus:outline-none focus:ring-1 focus:ring-slate-400"
          >
            <option value="">选择目标字段…</option>
            {targetFields.map((f) => (
              <option key={f.key} value={f.key}>
                {f.alias || f.key}
              </option>
            ))}
          </select>
        </div>
        <input
          value={d.name}
          onChange={(e) => upd({ name: e.target.value })}
          placeholder="关联名称（可选）"
          className="w-full rounded-md border px-2 py-1 text-xs text-gray-700 focus:outline-none focus:ring-1 focus:ring-slate-400"
        />
      </div>
    </NodeShell>
  );
});

// ---------- 时间窗口节点 ----------
const TimeNode = memo(({ id, data }: NodeProps) => {
  const fnode = { id, kind: 'time' as const, data, position: { x: 0, y: 0 } } as FlowNode;
  const d = data as unknown as TimeNodeData;
  const update = useNodeUpdater(id);
  return (
    <NodeShell fnode={fnode}>
      <div className="mb-0.5 text-xs text-gray-400">规则覆盖时间窗</div>
      <TimeComponent value={d.timeWindow} onChange={(tw) => update({ timeWindow: tw })} />
      <div className="mt-1.5 text-[10px] text-gray-400">
        为下游判断 / 聚合限定统计区间，如：本周、近7天
      </div>
    </NodeShell>
  );
});

// ---------- 已过天数节点 ----------
const ElapsedNode = memo(({ id, data }: NodeProps) => {
  const fnode = { id, kind: 'elapsed' as const, data, position: { x: 0, y: 0 } } as FlowNode;
  const d = data as unknown as ElapsedNodeData;
  const update = useNodeUpdater(id);
  const scope = d.scope || 'month';
  const scopeLabel =
    scope === 'week' ? '本周' : scope === 'month' ? '本月' : scope === 'quarter' ? '本季' : scope === 'year' ? '本年' : '时间区间';
  const inputCls = 'w-full rounded-md border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700 focus:outline-none focus:ring-1 focus:ring-cyan-400';
  const rowLabel = 'mb-1 text-[11px] font-medium text-gray-500';
  return (
    <NodeShell fnode={fnode}>
      <div className={rowLabel}>统计范围</div>
      <select
        value={scope}
        onChange={(e) => update({ scope: e.target.value as ElapsedScope })}
        className={inputCls}
      >
        {ELAPSED_SCOPE_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>

      {scope === 'custom' && (
        <>
          <div className={`${rowLabel} mt-2`}>区间起始（含）</div>
          <input
            type="date"
            value={d.customStart || ''}
            onChange={(e) => update({ customStart: e.target.value })}
            className={inputCls}
          />
          <div className={`${rowLabel} mt-2`}>区间结束（含，默认今天）</div>
          <input
            type="date"
            value={d.customEnd || ''}
            onChange={(e) => update({ customEnd: e.target.value })}
            className={inputCls}
          />
        </>
      )}

      <label className="mt-2 flex cursor-pointer select-none items-center gap-2 rounded-md border border-gray-200 bg-white px-2 py-1.5">
        <input
          type="checkbox"
          checked={d.includeToday !== false}
          onChange={(e) => update({ includeToday: e.target.checked })}
          className="h-3.5 w-3.5 accent-cyan-600"
        />
        <span className="text-[11px] text-gray-700">当天计入已过天数</span>
        <span className="ml-auto text-[10px] text-gray-400">
          {d.includeToday !== false ? '含今天' : '统计到昨天'}
        </span>
      </label>

      <div className={`${rowLabel} mt-2`}>结果命名</div>
      <input
        value={d.resultLabel || ''}
        onChange={(e) => update({ resultLabel: e.target.value })}
        placeholder={`如：${scopeLabel}已过天数`}
        className={inputCls}
      />
      <div className="mt-1.5 rounded-md bg-cyan-50 px-2 py-1 text-[10px] leading-relaxed text-cyan-700">
        输出「{scopeLabel}已过天数」一个数字（{d.includeToday !== false ? '含当天' : '不含当天，统计到昨天'}）；下游用「已过天数 − 开单天数」即得未开单天数。
      </div>
    </NodeShell>
  );
});

// ---------- 预警动作节点 ----------
const ACTION_TYPES = [
  { value: 'remind', label: '提醒' },
  { value: 'alert', label: '预警' },
] as const;
const ACTION_PRIORITIES = [
  { value: 'Important&Urgent', label: '重要且紧急' },
  { value: 'Important', label: '重要不紧急' },
  { value: 'Urgent', label: '紧急但不重要' },
  { value: 'Info', label: '一般' },
] as const;

const ActionNode = memo(({ id, data }: NodeProps) => {
  const d = data as unknown as ActionNodeData;
  const update = useNodeUpdater(id);
  const allNodes = useNodes();
  const tables = useRuleTables();
  const { deleteElements, getNodes, getEdges } = useReactFlow();
  const preview = useNodePreview();
  const type = d.type ?? (d.level === 'critical' || d.level === 'warn' ? 'alert' : 'remind');
  const prio = d.priority ?? 'ImportantNotUrgent';
  const typeMeta = ACTION_TYPES.find((t) => t.value === type);
  // 通知对象独立保存
  const notify = d.notify ?? { departments: [] as string[], personnel: [] as string[] };
  // 可插入字段：优先用 evaluateFlow 的真实输出列（=预览数据字段，保证完整），失败时回退 inferNodeCols 推断
  // 只依赖"其它节点的配置数据 + edges 结构"，用内容签名缓存：action 自身 content/title 输入不触发重算，
  // 避免每次敲键都全量 evaluate 导致输入卡顿
  const edges = useEdges();
  const fieldsCache = useRef<{ signature: string; value: Record<string, unknown> | undefined }>({ signature: '', value: undefined });
  const fieldsSignature =
    JSON.stringify(
      allNodes
        .filter((n) => (n as unknown as FlowNode).id !== id)
        .map((n) => ((n as unknown as FlowNode).data ?? {}))
    ) + '|' + JSON.stringify(edges.map((e) => [e.source, e.target]));
  const evalOuts = useMemo<Record<string, unknown> | undefined>(() => {
    if (fieldsSignature === fieldsCache.current.signature) return fieldsCache.current.value;
    let value: Record<string, unknown> | undefined;
    try {
      const flowNodes = allNodes as unknown as FlowNode[];
      const flowEdges = edges as unknown as FlowEdge[];
      value = evaluateFlow(flowNodes, flowEdges, tables);
    } catch {
      value = undefined;
    }
    fieldsCache.current = { signature: fieldsSignature, value };
    return value;
  }, [fieldsSignature]);
  const nodeOptions: { id: string; label: string; kind: FlowNode['kind'] }[] = [];
  const fieldsByNode: Record<string, ColOpt[]> = {};
  for (const n of allNodes) {
    if (n.id === id) continue;
    const fn = n as unknown as FlowNode;
    const ev = evalOuts?.[n.id] as { columns?: Array<{ key: string; label?: string } | string> } | undefined;
    let cols: ColOpt[];
    if (ev && Array.isArray(ev.columns) && ev.columns.length) {
      cols = (ev.columns as unknown as Array<{ key?: string; label?: string } | string>).map((c) => {
        if (typeof c === 'string') return { key: c, label: c };
        return { key: c.key || c.label || '', label: c.label || c.key || '' };
      }).filter((c) => !!c.key);
    } else {
      cols = inferNodeCols(allNodes as unknown as ReadonlyArray<{ id: string; data: unknown }>, tables as unknown as Array<{ id: string; fields: Array<{ key: string; alias?: string }> }>, n.id);
    }
    if (!cols.length) continue;
    const label =
      (fn.data && typeof fn.data === 'object') ?
        ((fn.data as Record<string, unknown>).resultLabel as string) ||
        ((fn.data as Record<string, unknown>).resultName as string) ||
        '' : '';
    nodeOptions.push({ id: n.id, label, kind: fn.kind });
    fieldsByNode[n.id] = cols;
  }
  const [pickNode, setPickNode] = useState(nodeOptions[0]?.id ?? '');
  const selNodeId = nodeOptions.some((o) => o.id === pickNode) ? pickNode : (nodeOptions[0]?.id ?? '');
  const contentRef = useRef<HTMLTextAreaElement | null>(null);
  const curPosRef = useRef<number>(0);
  const availFields = selNodeId ? (fieldsByNode[selNodeId] ?? []) : [];
  const insertField = (k: string) => {
    const tok = `{${k}}`;
    const el = contentRef.current;
    const cur = el ? el.value : (d.content ?? '');
    const pos = curPosRef.current >= 0 ? Math.min(curPosRef.current, cur.length) : cur.length;
    const next = `${cur.slice(0, pos)}${tok}${cur.slice(pos)}`;
    if (el) {
      el.value = next;
      el.focus();
      try { el.setSelectionRange(pos + tok.length, pos + tok.length); } catch { /* ignore */ }
    }
    update({ content: next });
  };
  return (
    <div className="w-[300px] overflow-hidden rounded-xl border border-amber-500/50 bg-white shadow-sm">
      <div className="group/head flex items-center gap-1.5 bg-amber-50 px-3 py-1.5">
        <span className="flex h-5 w-5 items-center justify-center rounded-md bg-amber-500 text-white">
          <Bell size={13} strokeWidth={2.5} />
        </span>
        <span className="min-w-0 flex-1 truncate text-xs font-semibold text-amber-700">预警动作</span>
        <button
          type="button"
          title="预览触发的店铺预警数据"
          onClick={(e) => {
            e.stopPropagation();
            const fnode = allNodes.find((n) => (n as unknown as FlowNode).id === id) as unknown as FlowNode;
            if (fnode) preview.open(fnode, getNodes() as unknown as FlowNode[], getEdges() as unknown as FlowEdge[], tables);
          }}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-gray-500/70 transition hover:bg-white/80 hover:text-blue-600"
        >
          <Eye className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          title="删除该组件"
          onClick={(e) => {
            e.stopPropagation();
            deleteElements({ nodes: [{ id }] });
          }}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-gray-400 opacity-0 transition hover:bg-white/70 hover:text-rose-500 group-hover/head:opacity-100"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="nodrag px-3 py-2">
        {/* 动作开关：关闭则不生成对应预警 */}
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-xs text-gray-400">启用动作</span>
          <button
            type="button"
            onClick={() => update({ enabled: d.enabled === false ? true : false })}
            className={`relative h-4.5 w-8 rounded-full transition ${d.enabled === false ? 'bg-gray-300' : 'bg-emerald-500'}`}
            title={d.enabled === false ? '当前关闭：激活时不生成该预警' : '当前开启：激活时生成该预警'}
          >
            <span
              className={`absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white shadow transition ${d.enabled === false ? 'left-0.5' : 'left-4'}`}
            />
          </button>
        </div>
        {/* 类型：提醒 / 预警 */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-gray-400">类型</span>
          <div className="flex flex-1 overflow-hidden rounded-md border">
            {ACTION_TYPES.map((t) => (
              <button
                key={t.value}
                type="button"
                onClick={() => update({ type: t.value, priority: t.value === 'remind' ? undefined : d.priority })}
                className={`flex-1 py-1 text-xs transition ${type === t.value ? 'bg-amber-500 text-white' : 'bg-white text-gray-500 hover:bg-amber-100'}`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
        {/* 预警类型时：重要等级 */}
        {type === 'alert' && (
          <div className="mt-1.5 flex items-center gap-1.5">
            <span className="text-xs text-gray-400">重要等级</span>
            <select
              value={prio}
              onChange={(e) => update({ priority: e.target.value as ActionNodeData['priority'] })}
              className="flex-1 rounded-md border bg-white px-2 py-1 text-xs text-gray-700 focus:outline-none focus:ring-1 focus:ring-amber-400"
            >
              {ACTION_PRIORITIES.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
            <span
              className="rounded px-1.5 py-0.5 text-[10px] font-semibold text-white"
              style={{ backgroundColor: typeMeta?.value === 'alert' ? (prio === 'Important&Urgent' ? '#DC2626' : prio === 'Important' ? '#D97706' : prio === 'Urgent' ? '#EA580C' : '#64748B') : '#F59E0B' }}
            >
              {ACTION_PRIORITIES.find((p) => p.value === prio)?.label}
            </span>
          </div>
        )}
        <input
          value={d.title}
          onChange={(e) => update({ title: e.target.value })}
          placeholder="预警标题，如：店仓超期未开单预警"
          className="mt-1.5 w-full rounded-md border px-2 py-1 text-xs text-gray-700 focus:outline-none focus:ring-1 focus:ring-amber-400"
        />
        <div className="mt-1.5 flex items-start gap-1.5">
          <textarea
            ref={contentRef}
            defaultValue={d.content ?? ''}
            onChange={(e) => { curPosRef.current = e.target.selectionStart; }}
            onBlur={() => {
              const el = contentRef.current;
              const v = el ? el.value : (d.content ?? '');
              update({ content: v });
            }}
            onSelect={(e) => { curPosRef.current = (e.target as HTMLTextAreaElement).selectionStart; }}
            onClick={(e) => { curPosRef.current = (e.currentTarget as HTMLTextAreaElement).selectionStart; }}
            placeholder="预警消息，支持插入字段，如：本周已过去 {已过天数} 天，{店铺名称} 店仓超过3天未开单了，请务必分析原因"
            rows={3}
            className="w-full resize-none rounded-md border px-2 py-1 text-xs text-gray-700 focus:outline-none focus:ring-1 focus:ring-amber-400"
          />
        </div>
        {nodeOptions.length > 0 && (
          <div className="mt-1 rounded-md bg-amber-50/60 p-1.5">
            <div className="mb-1 flex items-center gap-1 text-[10px] font-semibold text-amber-700">
              插入字段
            </div>
            <select
              value={selNodeId}
              onChange={(e) => setPickNode(e.target.value)}
              className="w-full rounded-md border bg-white px-2 py-1 text-[11px] text-gray-700 focus:outline-none focus:ring-1 focus:ring-amber-400"
            >
              <option value="">选择节点…</option>
              {nodeOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {nodeKindCn(o.kind)}
                  {o.label ? `（${o.label}）` : ''}
                </option>
              ))}
            </select>
            {availFields.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {availFields.map((f) => (
                  <button
                    key={f.key}
                    type="button"
                    onClick={() => insertField(f.key)}
                    title={`点击插入 {${f.label ?? f.key}}`}
                    className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700 hover:bg-amber-200"
                  >
                    {f.label ?? f.key}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        <div className="mt-1 text-[10px] text-gray-400">
          规则终点：输入位置插入 {`{字段名}`}，触发时替换为命中行的实际值
        </div>
        <TargetPanel targets={notify} onChange={(next) => update({ notify: next })} />
      </div>
      <Handle type="target" position={Position.Left} style={{ background: '#F59E0B', width: 10, height: 10 }} />
    </div>
  );
});

/** 通知对象配置（部门 + 人员），供预警动作节点内嵌 */
function TargetPanel({ targets, onChange }: { targets: TargetSetting; onChange: (t: TargetSetting) => void }) {
  const toggleDept = (d: string) =>
    onChange({
      ...targets,
      departments: targets.departments.includes(d) ? targets.departments.filter((x) => x !== d) : [...targets.departments, d],
    });
  const togglePerson = (p: string) =>
    onChange({
      ...targets,
      personnel: targets.personnel.includes(p) ? targets.personnel.filter((x) => x !== p) : [...targets.personnel, p],
    });
  const groupLabel = 'mb-1 text-[10px] text-gray-400';
  return (
    <div className="mt-1.5 rounded-lg border border-amber-200/70 bg-amber-50/50 p-1.5">
      <div className="mb-1 flex items-center gap-1 text-[10px] font-semibold text-amber-700">
        <Users size={11} /> 通知对象
      </div>
      <div className="mb-1.5">
        <div className={groupLabel}>适用部门</div>
        <div className="flex flex-wrap gap-1">
          {DEPARTMENTS.map((dt) => (
            <button
              key={dt}
              type="button"
              onClick={() => toggleDept(dt)}
              className={`rounded px-1.5 py-0.5 text-[10px] transition ${
                targets.departments.includes(dt) ? 'bg-amber-500 text-white' : 'bg-white text-gray-500 hover:bg-amber-100'
              }`}
            >
              {dt}
            </button>
          ))}
        </div>
      </div>
      <div>
        <div className={groupLabel}>适用人员</div>
        <div className="flex flex-wrap gap-1">
          {PERSONNEL.map((p) => (
            <button
              key={p.name}
              type="button"
              onClick={() => togglePerson(p.name)}
              className={`rounded px-1.5 py-0.5 text-[10px] transition ${
                targets.personnel.includes(p.name) ? 'bg-amber-500 text-white' : 'bg-white text-gray-500 hover:bg-amber-100'
              }`}
            >
              {p.name}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------- 排名取数（TopN）节点 ----------
const TopNNode = memo(({ id, data }: NodeProps) => {  const fnode = { id, kind: 'topn' as const, data, position: { x: 0, y: 0 } } as FlowNode;
  const d = data as unknown as TopNNodeData;
  const update = useNodeUpdater(id);
  const tables = useRuleTables();
  const curTable = tables.find((t) => t.id === d.tableId);
  const fields = curTable?.fields ?? [];

  const rowLabel = 'mb-1 mt-2 text-[11px] font-medium text-gray-500 first:mt-0';
  return (
    <NodeShell fnode={fnode}>
      <div className={rowLabel}>数据源表</div>
      <select
        value={d.tableId}
        onChange={(e) => {
          const t = tables.find((x) => x.id === e.target.value);
          update({ tableId: e.target.value, tableName: t?.name ?? '', groupField: '', groupFieldLabel: '', metricField: '', metricFieldLabel: '', dateField: '', dateFieldLabel: '' });
        }}
        className="w-full rounded-md border bg-white px-2 py-1 text-[11px] text-gray-700 focus:outline-none focus:ring-1 focus:ring-sky-400"
      >
        <option value="">选择数据表…</option>
        {tables.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>

      <div className={rowLabel}>
        日期字段
        <span className="ml-1 font-normal text-gray-400">（时间窗按这列日期圈定）</span>
      </div>
      <select
        value={d.dateField}
        onChange={(e) => {
          const f = fields.find((x) => x.key === e.target.value);
          update({ dateField: e.target.value, dateFieldLabel: f?.alias || f?.key || e.target.value });
        }}
        className="w-full rounded-md border bg-white px-2 py-1 text-[11px] text-gray-700 focus:outline-none focus:ring-1 focus:ring-sky-400"
      >
        <option value="">选择日期列，如：日期…</option>
        {(fields.some((f) => f.type === 'date') ? fields.filter((f) => f.type === 'date') : fields).map((f) => (
          <option key={f.key} value={f.key}>
            {f.alias || f.key}
          </option>
        ))}
      </select>

      <div className={rowLabel}>分组维度（按什么排名）</div>
      <select
        value={d.groupField}
        onChange={(e) => {
          const f = fields.find((x) => x.key === e.target.value);
          update({ groupField: e.target.value, groupFieldLabel: f?.alias || f?.key || e.target.value });
        }}
        className="w-full rounded-md border bg-white px-2 py-1 text-[11px] text-gray-700 focus:outline-none focus:ring-1 focus:ring-sky-400"
      >
        <option value="">选择维度，如：款色…</option>
        {fields.map((f) => (
          <option key={f.key} value={f.key}>
            {f.alias || f.key}
          </option>
        ))}
      </select>

      <div className={rowLabel}>排名指标</div>
      <div className="flex items-center gap-1">
        <select
          value={d.metricFn}
          onChange={(e) => update({ metricFn: e.target.value as TopNNodeData['metricFn'] })}
          className="shrink-0 rounded-md border bg-white px-1.5 py-1 text-[11px] text-gray-700 focus:outline-none focus:ring-1 focus:ring-sky-400"
        >
          {AGG_FN_OPTIONS.filter((a) => ['sum', 'count', 'avg', 'max'].includes(a.value)).map((a) => (
            <option key={a.value} value={a.value}>
              {a.label.split(' ')[0]}
            </option>
          ))}
        </select>
        <select
          value={d.metricField}
          onChange={(e) => {
            const f = fields.find((x) => x.key === e.target.value);
            update({ metricField: e.target.value, metricFieldLabel: f?.alias || f?.key || e.target.value });
          }}
          className="min-w-0 flex-1 rounded-md border bg-white px-2 py-1 text-[11px] text-gray-700 focus:outline-none focus:ring-1 focus:ring-sky-400"
        >
          <option value="">选择指标，如：销量…</option>
          {fields.map((f) => (
            <option key={f.key} value={f.key}>
              {f.alias || f.key}
            </option>
          ))}
        </select>
      </div>

      <div className={rowLabel}>取数规则</div>
      <div className="flex items-center gap-1">
        <select
          value={d.order}
          onChange={(e) => update({ order: e.target.value as TopNNodeData['order'] })}
          className="rounded-md border bg-white px-1.5 py-1 text-[11px] text-gray-700 focus:outline-none focus:ring-1 focus:ring-sky-400"
        >
          <option value="desc">降序（从高到低）</option>
          <option value="asc">升序（从低到高）</option>
        </select>
        <span className="text-[11px] text-gray-500">取前</span>
        <input
          type="number"
          min={1}
          value={d.topN}
          onChange={(e) => update({ topN: Math.max(1, Number(e.target.value) || 1) })}
          className="w-14 rounded-md border px-2 py-1 text-center text-[11px] text-gray-700 focus:outline-none focus:ring-1 focus:ring-sky-400"
        />
        <span className="text-[11px] text-gray-500">名</span>
      </div>

      <div className={rowLabel}>统计时间窗</div>
      <TimeComponent value={d.timeWindow ?? { preset: 'thisWeek' }} onChange={(tw) => update({ timeWindow: tw })} />

      <div className={rowLabel}>结果命名</div>
      <input
        value={d.resultLabel}
        onChange={(e) => update({ resultLabel: e.target.value })}
        placeholder="如：本周销量第一款色"
        className="w-full rounded-md border px-2 py-1 text-[11px] text-gray-700 focus:outline-none focus:ring-1 focus:ring-sky-400"
      />
    </NodeShell>
  );
});

// ---------- 反匹配/差集（Diff）节点 ----------
const DiffNode = memo(({ id, data }: NodeProps) => {
  const fnode = { id, kind: 'diff' as const, data, position: { x: 0, y: 0 } } as FlowNode;
  const d = data as unknown as DiffNodeData;
  const update = useNodeUpdater(id);
  const tables = useRuleTables();
  const baseTable = tables.find((t) => t.id === d.baseTableId);
  const checkTable = tables.find((t) => t.id === d.checkTableId);
  const baseFields = baseTable?.fields ?? [];
  const checkFields = checkTable?.fields ?? [];

  const fieldSelect = (
    table: DataTable | undefined,
    fieldList: DataTable['fields'],
    value: string,
    onPick: (key: string, label: string) => void,
    placeholder: string
  ) => (
    <div className="flex items-center gap-1">
      <span className="shrink-0 rounded bg-gray-100 px-1.5 py-1 text-[10px] text-gray-500">
        {table?.name ? (table.name.length > 6 ? table.name.slice(0, 6) + '…' : table.name) : '—'}
      </span>
      <select
        value={value}
        onChange={(e) => {
          const f = fieldList.find((x) => x.key === e.target.value);
          onPick(e.target.value, f?.alias || f?.key || e.target.value);
        }}
        className="min-w-0 flex-1 rounded-md border bg-white px-2 py-1 text-[11px] text-gray-700 focus:outline-none focus:ring-1 focus:ring-rose-400"
      >
        <option value="">{placeholder}</option>
        {fieldList.map((f) => (
          <option key={f.key} value={f.key}>
            {f.alias || f.key}
          </option>
        ))}
      </select>
    </div>
  );

  const rowLabel = 'mb-1 mt-2 text-[11px] font-medium text-gray-500 first:mt-0';
  return (
    <NodeShell fnode={fnode}>
      <div className={rowLabel}>① 基准表（全集，如全部店仓）</div>
      <select
        value={d.baseTableId}
        onChange={(e) => {
          const t = tables.find((x) => x.id === e.target.value);
          update({ baseTableId: e.target.value, baseTableName: t?.name ?? '', baseField: '', baseFieldLabel: '' });
        }}
        className="w-full rounded-md border bg-white px-2 py-1 text-[11px] text-gray-700 focus:outline-none focus:ring-1 focus:ring-rose-400"
      >
        <option value="">选择基准表…</option>
        {tables.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
      <div className="mt-1">
        {fieldSelect(baseTable, baseFields, d.baseField, (k, l) => update({ baseField: k, baseFieldLabel: l }), '对照键，如：店仓编码')}
      </div>

      <div className={rowLabel}>② 排查表（明细，如销售记录）</div>
      <select
        value={d.checkTableId}
        onChange={(e) => {
          const t = tables.find((x) => x.id === e.target.value);
          update({ checkTableId: e.target.value, checkTableName: t?.name ?? '', checkField: '', checkFieldLabel: '', filterField: '', filterFieldLabel: '', dateField: '', dateFieldLabel: '' });
        }}
        className="w-full rounded-md border bg-white px-2 py-1 text-[11px] text-gray-700 focus:outline-none focus:ring-1 focus:ring-rose-400"
      >
        <option value="">选择排查表…</option>
        {tables.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
      <div className="mt-1 space-y-1">
        {fieldSelect(checkTable, checkFields, d.checkField, (k, l) => update({ checkField: k, checkFieldLabel: l }), '匹配键，如：店仓编码')}
        {fieldSelect(checkTable, checkFields, d.filterField, (k, l) => update({ filterField: k, filterFieldLabel: l }), '过滤维度，如：款色（可选）')}
      </div>

      <div className={rowLabel}>③ 过滤维度取值</div>
      <div className="flex items-center gap-1">
        <select
          value={d.filterValueSource}
          onChange={(e) => update({ filterValueSource: e.target.value as DiffNodeData['filterValueSource'] })}
          className="shrink-0 rounded-md border bg-white px-1.5 py-1 text-[11px] text-gray-700 focus:outline-none focus:ring-1 focus:ring-rose-400"
        >
          <option value="topn">取排名结果</option>
          <option value="const">指定值</option>
        </select>
        {d.filterValueSource === 'const' ? (
          <input
            value={d.filterValue}
            onChange={(e) => update({ filterValue: e.target.value })}
            placeholder="如：款色 A001"
            className="min-w-0 flex-1 rounded-md border px-2 py-1 text-[11px] text-gray-700 focus:outline-none focus:ring-1 focus:ring-rose-400"
          />
        ) : (
          <span className="flex-1 rounded-md border border-dashed border-rose-300 bg-rose-50/50 px-2 py-1 text-[11px] text-rose-600">
            连接上游「排名取数」结果
          </span>
        )}
      </div>

      <div className={rowLabel}>④ 排查表日期字段（时间窗按这列圈定）</div>
      <select
        value={d.dateField}
        onChange={(e) => {
          const f = checkFields.find((x) => x.key === e.target.value);
          update({ dateField: e.target.value, dateFieldLabel: f?.alias || f?.key || e.target.value });
        }}
        className="w-full rounded-md border bg-white px-2 py-1 text-[11px] text-gray-700 focus:outline-none focus:ring-1 focus:ring-rose-400"
      >
        <option value="">选择日期列，如：销售日期…</option>
        {(checkFields.some((f) => f.type === 'date') ? checkFields.filter((f) => f.type === 'date') : checkFields).map((f) => (
          <option key={f.key} value={f.key}>
            {f.alias || f.key}
          </option>
        ))}
      </select>

      <div className={rowLabel}>⑤ 统计时间窗</div>
      <TimeComponent value={d.timeWindow ?? { preset: 'thisWeek' }} onChange={(tw) => update({ timeWindow: tw })} />

      <div className={rowLabel}>结果命名</div>
      <input
        value={d.resultLabel}
        onChange={(e) => update({ resultLabel: e.target.value })}
        placeholder="如：本周无销售店仓"
        className="w-full rounded-md border px-2 py-1 text-[11px] text-gray-700 focus:outline-none focus:ring-1 focus:ring-rose-400"
      />
      <div className="mt-1.5 rounded-md bg-rose-50 px-2 py-1 text-[10px] leading-relaxed text-rose-600">
        输出：基准表中在排查表里【找不到匹配记录】的行（差集），命中即预警
      </div>
    </NodeShell>
  );
});

const LOGIC_OPTS: [LogicNodeData['logic'], string][] = [
  ['if', '如果'],
  ['and', '且'],
  ['or', '或'],
];

const LogicNode = memo(({ id, data }: NodeProps) => {
  const fnode = {
    id,
    kind: 'logic' as const,
    data: data as unknown as FlowNode['data'],
    position: { x: 0, y: 0 },
  } as FlowNode;
  const d = data as unknown as LogicNodeData;
  const update = useNodeUpdater(id);
  return (
    <NodeShell fnode={fnode}>
      <div className="flex items-center gap-1">
        {LOGIC_OPTS.map(([val, label]) => (
          <button
            key={val}
            type="button"
            onClick={() => update({ logic: val })}
            className={`flex-1 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors ${
              d.logic === val
                ? 'border-gray-600 text-white'
                : 'border-gray-300 text-gray-500 hover:border-gray-400'
            }`}
            style={{ backgroundColor: d.logic === val ? '#4b5563' : 'transparent' }}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="mt-1.5 text-center text-[10px] leading-none text-gray-400">
        用 如果 / 且 / 或 关联前后判断
      </div>
    </NodeShell>
  );
});

// ---------- 分组聚合节点（搭积木原子：按维度分组，对指标聚合，输出每组的值） ----------
const GroupByNode = memo(({ id, data }: NodeProps) => {
  const fnode = { id, kind: 'groupby' as const, data, position: { x: 0, y: 0 } } as FlowNode;
  const d = data as unknown as GroupByNodeData;
  const update = useNodeUpdater(id);
  const tables = useRuleTables();
  const allNodes = useNodes();
  const source = d.source ?? 'table';
  const nodeOutputs = getNodeOutputs(allNodes, id).filter((o) => o.ref.outputKind === 'column');
  const curTable = tables.find((t) => t.id === d.tableId);
  const tableFields = curTable?.fields ?? [];
  // 节点结果模式：字段取上游节点的全部输出列（如排名取数的「款色 / 排名第一」），用真实列名对齐引擎
  const inferredCols = source === 'node' && d.sourceNode ? inferNodeCols(allNodes, tables, d.sourceNode) : [];
  const srcNodeOut = source === 'node' ? nodeOutputs.find((o) => o.ref.nodeId === d.sourceNode) : undefined;
  const nodeFields = inferredCols.length
    ? inferredCols.map((c, i) => ({
        key: c.key,
        alias: c.label || c.key,
        // 节点输出里除维度外的指标列可作为聚合指标：默认末列为数值（如 排名第一/店铺成交/销量/库存）
        type: (i === inferredCols.length - 1 ? 'number' : 'string') as 'number' | 'string',
      }))
    : srcNodeOut
      ? [{ key: srcNodeOut.ref.label, alias: srcNodeOut.ref.label, type: 'string' as const }]
      : [];
  const fields = source === 'node' ? nodeFields : tableFields;
  const dateFields = fields.some((f) => f.type === 'date') ? fields.filter((f) => f.type === 'date') : fields;

  const rowLabel = 'mb-1 mt-2 text-[11px] font-medium text-gray-500 first:mt-0';
  const inputCls =
    'w-full rounded-md border bg-white px-2 py-1 text-[11px] text-gray-700 focus:outline-none focus:ring-1 focus:ring-indigo-400';

  return (
    <NodeShell fnode={fnode}>
      <DataSourcePicker
        source={source}
        sourceNode={d.sourceNode}
        nodeOptions={nodeOutputs}
        onSourceChange={(v) =>
          update({
            source: v,
            sourceNode: v === 'node' ? d.sourceNode ?? nodeOutputs[0]?.ref.nodeId : undefined,
            sourceNodeLabel: v === 'node' ? nodeOutputs.find((o) => o.ref.nodeId === (d.sourceNode ?? nodeOutputs[0]?.ref.nodeId))?.ref.label : undefined,
            dims: [],
            metricField: '',
            metricFieldLabel: '',
            metrics: [],
          } as Partial<GroupByNodeData>)
        }
        onNodeChange={(ref) => update({ sourceNode: ref?.nodeId, sourceNodeLabel: ref?.label, dims: [], metricField: '', metricFieldLabel: '', metrics: [] } as Partial<GroupByNodeData>)}
        nodeLabel="① 数据来源节点（对其输出结果分组聚合）"
        nodePlaceholder="选择上一步节点结果，如：过滤后的明细…"
        tableBlock={
          <>
            <div className={rowLabel}>① 数据表（明细，如：零售工作薄5）</div>
            <select
              value={d.tableId}
              onChange={(e) => {
                const t = tables.find((x) => x.id === e.target.value);
                update({
                  tableId: e.target.value,
                  tableName: t?.name ?? '',
                  dateField: '',
                  dateFieldLabel: '',
                  groupField: '',
                  groupFieldLabel: '',
                  dims: [],
                  metricField: '',
                  metricFieldLabel: '',
                  metrics: [],
                } as Partial<GroupByNodeData>);
              }}
              className={inputCls}
            >
              <option value="">选择事实表，如：零售工作薄5…</option>
              {tables.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>

            <div className={rowLabel}>
              ② 日期字段
              <span className="ml-1 font-normal text-gray-400">（按这列圈定时间窗）</span>
            </div>
            <select
              value={d.dateField}
              onChange={(e) => {
                const f = tableFields.find((x) => x.key === e.target.value);
                update({ dateField: e.target.value, dateFieldLabel: f?.alias || f?.key || e.target.value } as Partial<GroupByNodeData>);
              }}
              className={inputCls}
            >
              <option value="">选择日期列，如：日期/销售日期…</option>
              {dateFields.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.alias || f.key}
                </option>
              ))}
            </select>

            <div className={rowLabel}>③ 统计时间窗</div>
            <div className="w-full min-w-0">
              <TimeComponent
                value={d.timeWindow ?? { preset: 'specificMonth' }}
                onChange={(tw) => update({ timeWindow: tw } as Partial<GroupByNodeData>)}
              />
            </div>
          </>
        }
      />

      {source === 'node' && (
        <div className="mt-1 rounded-md bg-indigo-50/70 px-2 py-1 text-[10px] leading-relaxed text-indigo-700">
          节点结果模式：直接对上一步「{d.sourceNodeLabel || '节点'}」的输出分组聚合，时间范围以上游节点为准。
        </div>
      )}

      <div className={rowLabel}>④ 分组维度（可多个，可上下拖动调整分组层级）</div>
      <div className="space-y-1">
        {(d.dims && d.dims.length ? d.dims : [{ fieldKey: '', fieldLabel: '' }]).map((dim, idx) => (
          <div key={idx} className="flex items-center gap-1">
            <div className="flex shrink-0 flex-col">
              <button
                type="button"
                disabled={idx === 0}
                onClick={() => {
                  if (idx === 0) return;
                  const next = [...(d.dims || [])];
                  [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
                  update({ dims: next });
                }}
                className="px-1 text-[9px] leading-[10px] text-gray-400 hover:text-indigo-600 disabled:opacity-30"
                title="上移（更外层分组）"
              >
                ▲
              </button>
              <button
                type="button"
                disabled={idx === (d.dims || []).length - 1}
                onClick={() => {
                  const arr = d.dims || [];
                  if (idx === arr.length - 1) return;
                  const next = [...arr];
                  [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
                  update({ dims: next });
                }}
                className="px-1 text-[9px] leading-[10px] text-gray-400 hover:text-indigo-600 disabled:opacity-30"
                title="下移（更内层分组）"
              >
                ▼
              </button>
            </div>
            <select
              value={dim.fieldKey}
              onChange={(e) => {
                const f = fields.find((x) => x.key === e.target.value);
                const next = [...(d.dims || [])];
                next[idx] = { fieldKey: e.target.value, fieldLabel: f?.alias || f?.key || '', granularity: dim.granularity };
                update({ dims: next });
              }}
              className="min-w-0 flex-1 rounded-md border bg-white px-2 py-1 text-[11px] text-gray-700 focus:outline-none focus:ring-1 focus:ring-indigo-400"
            >
              <option value="">选择分组列…</option>
              {fields.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.alias || f.key}
                </option>
              ))}
            </select>
            {dim.fieldKey &&
              fields.find((x) => x.key === dim.fieldKey)?.type === 'date' && (
                <select
                  value={dim.granularity || 'day'}
                  onChange={(e) => {
                    const next = [...(d.dims || [])];
                    next[idx] = { ...dim, granularity: e.target.value as GroupByNodeData['dims'][number]['granularity'] };
                    update({ dims: next });
                  }}
                  className="shrink-0 rounded-md border bg-white px-1.5 py-1 text-[11px] text-gray-700 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                >
                  <option value="year">按年</option>
                  <option value="month">按月</option>
                  <option value="week">按周</option>
                  <option value="day">按天</option>
                </select>
              )}
            {(d.dims || []).length > 1 && (
              <button
                type="button"
                onClick={() => update({ dims: (d.dims || []).filter((_, i) => i !== idx) })}
                className="shrink-0 rounded px-1 text-[11px] text-red-500 hover:bg-red-50"
              >
                ✕
              </button>
            )}
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={() => update({ dims: [...(d.dims || []), { fieldKey: '', fieldLabel: '' }] })}
        className="text-[11px] text-indigo-600 hover:text-indigo-800"
      >
        + 添加分组维度
      </button>

      {(d.dims || []).length === 0 && (
        <div className="mb-2 rounded-md border border-dashed border-amber-300 bg-amber-50 px-2 py-1.5 text-[10px] leading-relaxed text-amber-700">
          未填写分组维度：将对整张表做<span className="font-semibold">全局聚合</span>，自动对所有数值字段计算聚合结果（如各数值字段求和）。
          <span className="block text-amber-600/80">如需按字段分组后再聚合，请在上方添加分组维度。</span>
        </div>
      )}
      <div className={rowLabel}>⑤ 聚合指标（可添加多个，支持对文本字段做 计数 / 去重计数）</div>
      {(() => {
        // 多指标：优先 d.metrics；否则回退到单指标 metricField/metricFn（兼容旧规则）
        const metrics: GroupMetric[] =
          Array.isArray(d.metrics) && d.metrics.length
            ? d.metrics
            : d.metricField
              ? [{ id: 'legacy', fieldKey: d.metricField, fieldLabel: d.metricFieldLabel, fn: d.metricFn || 'sum', resultLabel: '' }]
              : [];
        const shown = metrics.length ? metrics : [{ id: 'legacy', fieldKey: '', fieldLabel: '', fn: 'sum' as const, resultLabel: '' }];
        const setMetrics = (m: GroupMetric[]) => update({ metrics: m } as Partial<GroupByNodeData>);
        return (
          <div className="space-y-1">
            {shown.map((mt, idx) => (
              <div key={mt.id || idx} className="flex flex-wrap items-center gap-1">
                <select
                  value={mt.fieldKey}
                  onChange={(e) => {
                    const f = fields.find((x) => x.key === e.target.value);
                    const next = [...shown];
                    next[idx] = { ...mt, fieldKey: e.target.value, fieldLabel: f?.alias || f?.key || '', id: mt.id || `gm_${Date.now()}_${idx}` };
                    setMetrics(next);
                  }}
                  className="min-w-[5.5rem] flex-1 rounded-md border bg-white px-2 py-1 text-[11px] text-gray-700 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                  title={mt.fieldLabel || mt.fieldKey || '选择指标字段'}
                >
                  <option value="">选择指标字段…</option>
                  {fields.map((f) => (
                    <option key={f.key} value={f.key}>
                      {f.alias || f.key}
                      {f.type === 'number' ? '' : '（文本）'}
                    </option>
                  ))}
                </select>
                <select
                  value={mt.fn}
                  onChange={(e) => {
                    const next = [...shown];
                    next[idx] = { ...mt, fn: e.target.value as GroupMetric['fn'], id: mt.id || `gm_${Date.now()}_${idx}` };
                    setMetrics(next);
                  }}
                  className="shrink min-w-[4.5rem] max-w-[8.5rem] truncate rounded-md border bg-white px-1.5 py-1 text-[10px] text-gray-700 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                  title={AGG_FN_OPTIONS.find((a) => a.value === mt.fn)?.label || mt.fn}
                >
                  {AGG_FN_OPTIONS.map((a) => (
                    <option key={a.value} value={a.value}>
                      {a.label}
                    </option>
                  ))}
                </select>
                {(shown.length > 1 || metrics.length > 0) && (
                  <button
                    type="button"
                    onClick={() => setMetrics(shown.filter((_, i) => i !== idx))}
                    className="shrink-0 rounded px-1 text-[11px] text-red-500 hover:bg-red-50"
                  >
                    ✕
                  </button>
                )}
                <input
                  value={mt.resultLabel || ''}
                  onChange={(e) => {
                    const next = [...shown];
                    next[idx] = { ...mt, resultLabel: e.target.value, id: mt.id || `gm_${Date.now()}_${idx}` };
                    setMetrics(next);
                  }}
                  placeholder={
                    mt.fieldKey
                      ? `结果字段名（默认：${AGG_FN_OPTIONS.find((a) => a.value === mt.fn)?.label.split(' ')[0] || ''}(${mt.fieldLabel || mt.fieldKey})）`
                      : '结果字段名…'
                  }
                  className="w-full rounded-md border bg-white px-2 py-1 text-[11px] text-gray-700 placeholder:text-gray-300 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                />
              </div>
            ))}
            <button
              type="button"
              onClick={() => setMetrics([...shown.filter((m) => m.fieldKey), { id: `gm_${Date.now()}_${shown.length}`, fieldKey: '', fieldLabel: '', fn: 'countDistinct', resultLabel: '' }])}
              className="text-[11px] text-indigo-600 hover:text-indigo-800"
            >
              + 添加聚合指标
            </button>
            <div className="text-[10px] leading-relaxed text-gray-400">
              提示：求和/平均/最大/最小需选数值字段；计数、去重计数可用于任何字段（如 单据编号 / 店仓名称）。
            </div>
          </div>
        );
      })()}

      <div className={rowLabel}>结果命名</div>
      <input
        value={d.resultLabel}
        onChange={(e) => update({ resultLabel: e.target.value })}
        placeholder="如：8月各店仓成交金额"
        className={inputCls}
      />

      {((d.dims && d.dims.length ? d.dims : []).some((x) => x.fieldKey)) && d.metricField && (
        <div className="mt-2 rounded-md bg-indigo-50/70 px-2 py-1.5 text-[10px] leading-relaxed text-indigo-700">
          按「{((d.dims || []).filter((x) => x.fieldKey).map((x) => x.fieldLabel || x.fieldKey) || ['']).join(' · ')}」分组，
          对 {AGG_FN_OPTIONS.find((a) => a.value === d.metricFn)?.label.split(' ')[0]}({d.metricFieldLabel}) 汇总，
          得到每组在时间窗内的指标值
        </div>
      )}
    </NodeShell>
  );
});

// ---------- 过滤节点（多条件：字段 + 算子 + 可搜索多选/单选值） ----------
const FilterNode = memo(({ id, data }: NodeProps) => {
  const fnode = { id, kind: 'filter' as const, data, position: { x: 0, y: 0 } } as FlowNode;
  const d = data as unknown as FilterNodeData;
  const update = useNodeUpdater(id);
  const tables = useRuleTables();
  const allNodes = useNodes();
  const source = d.source ?? 'table';
  const nodeOutputs = getNodeOutputs(allNodes, id).filter((o) => o.ref.outputKind === 'column');

  const table = tables.find((t) => t.id === d.tableId) ?? tables[0];
  // 数据表字段
  const tableFields: { key: string; label: string; type?: string }[] = table
    ? table.fields.map((f) => ({ key: f.key, label: f.alias || f.key, type: f.type }))
    : [];
  // 根据上游节点的类型与配置，推断其输出列
  const colsOfNode = (nid: string): ColOpt[] => inferNodeCols(allNodes, tables, nid);

  // 节点结果字段：优先给出该节点全部输出列；无列信息时退化为其 label 单列
  const srcNodeOut = source === 'node' ? nodeOutputs.find((o) => o.ref.nodeId === d.sourceNode) : undefined;
  const nodeCols = source === 'node' && d.sourceNode ? colsOfNode(d.sourceNode) : [];
  const nodeFields: { key: string; label: string; type?: string }[] = nodeCols.length
    ? nodeCols.map((x) => ({ key: x.key, label: x.label }))
    : srcNodeOut
      ? [{ key: srcNodeOut.ref.label, label: srcNodeOut.ref.label }]
      : [];
  const fields = source === 'node' ? nodeFields : tableFields;

  const conds = d.conditions && d.conditions.length ? d.conditions : [];
  const hintCls = 'rounded-md bg-amber-50 px-2 py-1 text-[10px] leading-relaxed text-amber-700';
  const rowLabel = 'mb-1 text-[11px] font-medium text-gray-500';
  const inputCls =
    'w-full rounded-md border bg-white px-2 py-1 text-[11px] text-gray-700 focus:outline-none focus:ring-1 focus:ring-amber-400';

  const setCond = (i: number, patch: Partial<FilterCondition>) => {
    const next = conds.map((c, j) => (j === i ? { ...c, ...patch } : c));
    update({ conditions: next });
  };
  const removeCond = (i: number) => {
    update({ conditions: conds.filter((_, j) => j !== i) });
  };

  // 取某字段的去重候选值：数据表用全量行；节点结果无前端行数据时给空（运行时按上游结果）
  const distinctValues = (fieldKey: string): string[] => {
    if (source === 'node') return [];
    if (!table) return [];
    const set = new Set<string>();
    const src = table.rows && table.rows.length ? table.rows : table.previewRows;
    for (const r of src) {
      if (r[fieldKey] != null && r[fieldKey] !== '') set.add(String(r[fieldKey]));
    }
    return [...set];
  };

  const sourceName = source === 'node' ? d.sourceNodeLabel || '上一步结果' : table?.name || '数据表';

  return (
    <NodeShell fnode={fnode}>
      <div className="flex flex-col gap-1.5">
        <DataSourcePicker
          source={source}
          sourceNode={d.sourceNode}
          nodeOptions={nodeOutputs}
          onSourceChange={(v) =>
            update({
              source: v,
              sourceNode: v === 'node' ? d.sourceNode ?? nodeOutputs[0]?.ref.nodeId : undefined,
              sourceNodeLabel: v === 'node' ? nodeOutputs.find((o) => o.ref.nodeId === (d.sourceNode ?? nodeOutputs[0]?.ref.nodeId))?.ref.label : undefined,
              conditions: [],
            } as Partial<FilterNodeData>)
          }
          onNodeChange={(ref) => update({ sourceNode: ref?.nodeId, sourceNodeLabel: ref?.label, conditions: [] } as Partial<FilterNodeData>)}
          nodeLabel="数据来源节点（取其输出结果进行过滤）"
          nodePlaceholder="选择上一步节点结果，如：过滤后的明细 / 分组结果…"
          tableBlock={
            <div>
              <div className={rowLabel}>数据来源表</div>
              <select
                value={d.tableId || table?.id || ''}
                onChange={(e) => {
                  const t = tables.find((x) => x.id === e.target.value);
                  update({ tableId: e.target.value, tableName: t?.name || '', conditions: [] } as Partial<FilterNodeData>);
                }}
                className={inputCls}
              >
                <option value="">选择表…</option>
                {tables.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
          }
        />

        {source === 'node' && (
          <div className={hintCls}>
            节点结果模式：将对「{d.sourceNodeLabel || '上一步节点'}」的输出行按条件过滤。字段候选在运行时按上游结果列生成；可直接输入要匹配的值。
          </div>
        )}

        {conds.map((c, i) => {
          const f = fields.find((x) => x.key === c.fieldKey);
          const values = c.fieldKey ? distinctValues(c.fieldKey) : [];
          const multi = c.op === 'in' || c.op === 'nin';
          const nodeValue = c.valueSource === 'node';
          return (
            <div key={c.id} className="flex flex-col gap-1 rounded-md border border-gray-200 bg-gray-50/60 p-2">
              {!nodeValue && (
              <div className="flex items-center gap-1">
                <select
                  value={c.fieldKey}
                  onChange={(e) => {
                    const ff = fields.find((x) => x.key === e.target.value);
                    setCond(i, { fieldKey: e.target.value, fieldLabel: ff?.label || e.target.value, value: '', values: [] });
                  }}
                  className="h-6 min-w-0 flex-1 rounded-md border bg-white px-1.5 text-[11px] text-gray-700 focus:outline-none focus:ring-1 focus:ring-amber-400"
                >
                  <option value="">字段…</option>
                  {fields.map((x) => (
                    <option key={x.key} value={x.key}>
                      {x.label}
                    </option>
                  ))}
                  {source === 'node' && <option value={c.fieldKey}>{c.fieldLabel || '（输入列名）'}</option>}
                </select>
                <button
                  type="button"
                  onClick={() => removeCond(i)}
                  className="ml-auto h-5 w-5 shrink-0 rounded-full text-[11px] leading-none text-amber-500 hover:bg-amber-50"
                  title="删除该过滤条件"
                >
                  ✕
                </button>
              </div>
              )}

              {!nodeValue && (
              <select
                value={c.op}
                onChange={(e) => setCond(i, { op: e.target.value as FilterOp, value: '', values: [] })}
                className={inputCls}
              >
                <option value="eq">等于（单选）</option>
                <option value="neq">不等于（单选）</option>
                <option value="contains">包含文字（单选）</option>
                <option value="in">属于（多选｜可搜索）</option>
                <option value="nin">不属于（多选｜可搜索）</option>
              </select>
              )}

              {!multi && (
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setCond(i, { valueSource: 'const', value: '', refNodeId: undefined, refNodeLabel: undefined })}
                    className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                      (c.valueSource ?? 'const') !== 'node' ? 'bg-amber-100 text-amber-700' : 'text-gray-500 hover:bg-gray-100'
                    }`}
                  >
                    固定值
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setCond(i, {
                        valueSource: 'node',
                        value: '',
                        refNodeId: nodeOutputs[0]?.ref.nodeId,
                        refNodeLabel: nodeOutputs[0]?.ref.label,
                        refColumn: undefined,
                      })
                    }
                    className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                      c.valueSource === 'node' ? 'bg-indigo-100 text-indigo-700' : 'text-gray-500 hover:bg-gray-100'
                    }`}
                  >
                    引用节点结果
                  </button>
                </div>
              )}

              {multi ? (
                <FilterMultiSelect
                  values={values}
                  selected={c.values || []}
                  placeholder={f ? `选择 ${f.label} 的值…` : '请先选择字段…'}
                  onChange={(vals) => setCond(i, { values: vals })}
                />
              ) : c.valueSource === 'node' ? (
                (() => {
                  const refCols = c.refNodeId ? colsOfNode(c.refNodeId) : [];
                  return (
                    <div className="flex flex-col gap-1">
                      <select
                        value={c.refNodeId || ''}
                        onChange={(e) => {
                          const o = nodeOutputs.find((x) => x.ref.nodeId === e.target.value);
                          const first = e.target.value ? colsOfNode(e.target.value)[0] : undefined;
                          setCond(i, {
                            op: 'eq',
                            refNodeId: o?.ref.nodeId,
                            refNodeLabel: o?.ref.label,
                            refColumn: first ? first.key : undefined,
                            refColumnLabel: first ? first.label : '',
                            fieldKey: first ? first.key : c.fieldKey,
                            fieldLabel: first ? first.label : c.fieldLabel,
                          });
                        }}
                        className={inputCls}
                      >
                        <option value="">选择节点结果…（如排名取数·销量第一名款色）</option>
                        {nodeOutputs.map((o) => (
                          <option key={o.ref.nodeId} value={o.ref.nodeId}>
                            {KIND_LABEL[o.ref.nodeKind] ?? o.ref.nodeKind} · {o.ref.label || '未命名结果'}
                          </option>
                        ))}
                      </select>
                      {refCols.length > 0 && (
                        <select
                          value={c.refColumn || refCols[0]?.key || ''}
                          onChange={(e) => {
                            const k = e.target.value;
                            const l = refCols.find((x) => x.key === k)?.label;
                            setCond(i, { refColumn: k, refColumnLabel: l, fieldKey: k, fieldLabel: l || k, op: 'eq', value: '', values: [] });
                          }}
                          className={inputCls}
                        >
                          {refCols.map((col) => (
                            <option key={col.key} value={col.key}>
                              {col.label || col.key}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  );
                })()
              ) : (
                <ComboSelect
                  value={c.value || ''}
                  options={values}
                  placeholder={f ? `选择 ${f.label} 的值…` : '请先选择字段…'}
                  onChange={(v) => setCond(i, { value: v })}
                />
              )}
            </div>
          );
        })}

        <button
          type="button"
          onClick={() => update({ conditions: [...conds, { id: `fc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, fieldKey: '', fieldLabel: '', op: 'eq', value: '', values: [] }] })}
          className="mt-0.5 rounded-md border border-dashed border-amber-300 py-1 text-[11px] font-medium text-amber-600 hover:bg-amber-50"
        >
          + 添加过滤条件
        </button>

        <div className={rowLabel}>结果命名</div>
        <input
          value={d.resultLabel || ''}
          onChange={(e) => update({ resultLabel: e.target.value })}
          placeholder="如：仅保留华北区域"
          className={inputCls}
        />

        {conds.length > 0 && (
          <div className="mt-1 rounded-md bg-amber-50/70 px-2 py-1.5 text-[10px] leading-relaxed text-amber-700">
            保留「{sourceName}」中同时满足 {conds.length} 个条件的行（条件之间为「且」关系）
          </div>
        )}
      </div>
    </NodeShell>
  );
});
FilterNode.displayName = 'FilterNode';

// 可搜索多选下拉
function FilterMultiSelect({ values, selected, placeholder, onChange }: { values: string[]; selected: string[]; placeholder: string; onChange: (v: string[]) => void }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const list = q ? values.filter((v) => v.toLowerCase().includes(q.toLowerCase())) : values;
  const reflist = useMemo(() => list.slice(0, 200), [list]);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="min-w-0 w-full truncate rounded-md border bg-white px-2 py-1 text-left text-[11px] text-gray-700 focus:outline-none focus:ring-1 focus:ring-amber-400"
      >
        {selected.length ? `已选 ${selected.length} 项` : placeholder}
      </button>
      {open && (
        <div className="absolute left-0 right-0 top-full z-20 mt-1 rounded-md border border-gray-200 bg-white p-1.5 shadow-lg">
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索…"
            className="mb-1 w-full rounded-md border px-2 py-1 text-[11px] outline-none focus:ring-1 focus:ring-amber-400"
          />
          <div className="field-list-scroll max-h-56 overflow-y-auto pr-1">
            {reflist.length === 0 && <div className="px-1 py-1 text-[10px] text-gray-400">无匹配值</div>}
            {reflist.map((v) => {
              const on = selected.includes(v);
              return (
                <label
                  key={v}
                  className="flex cursor-pointer items-center gap-1.5 rounded px-1 py-0.5 text-[11px] text-gray-700 hover:bg-gray-50"
                >
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => onChange(on ? selected.filter((x) => x !== v) : [...selected, v])}
                    className="h-3 w-3"
                  />
                  <span className="truncate">{v}</span>
                </label>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// 可搜索单选下拉（字段值从数据去重候选中选择）
function ComboSelect({ value, options, placeholder, onChange }: { value: string; options: string[]; placeholder: string; onChange: (v: string) => void }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const list = q ? options.filter((v) => v.toLowerCase().includes(q.toLowerCase())) : options;
  const reflist = useMemo(() => list.slice(0, 200), [list]);
  const total = options.length;
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="min-w-0 w-full truncate rounded-md border bg-white px-2 py-1 text-left text-[11px] text-gray-700 focus:outline-none focus:ring-1 focus:ring-amber-400"
      >
        {value ? <span className="text-amber-700">{value}</span> : placeholder}
      </button>
      {open && (
        <div className="absolute left-0 right-0 top-full z-20 mt-1 rounded-md border border-gray-200 bg-white p-1.5 shadow-lg">
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={total ? `搜索 ${total} 个值…` : '搜索…'}
            className="mb-1 w-full rounded-md border px-2 py-1 text-[11px] outline-none focus:ring-1 focus:ring-amber-400"
          />
          <div className="field-list-scroll max-h-56 overflow-y-auto pr-1">
            <button
              type="button"
              onClick={() => {
                onChange('');
                setOpen(false);
              }}
              className="mb-0.5 w-full truncate rounded bg-gray-50 px-1 py-0.5 text-left text-[11px] text-gray-400 hover:bg-gray-100"
            >
              （不限 / 清除）
            </button>
            {reflist.length === 0 && <div className="px-1 py-1 text-[10px] text-gray-400">无匹配值</div>}
            {reflist.map((v) => (
              <button
                type="button"
                key={v}
                onClick={() => {
                  onChange(v);
                  setOpen(false);
                }}
                className={`flex w-full items-center rounded px-1 py-0.5 text-left text-[11px] hover:bg-gray-50 ${
                  value === v ? 'text-amber-700' : 'text-gray-700'
                }`}
              >
                <span className="truncate">{v}</span>
              </button>
            ))}
          </div>
          {total > 200 && (
            <div className="mt-1 border-t pt-1 text-[10px] text-gray-400">共 {total} 个值，输入关键字可搜索</div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------- 基准统计节点（搭积木原子：对一组数值统计 平均/中位/最高/最低） ----------
const BaselineNode = memo(({ id, data }: NodeProps) => {
  const fnode = { id, kind: 'baseline' as const, data, position: { x: 0, y: 0 } } as FlowNode;
  const d = data as unknown as BaselineNodeData;
  const update = useNodeUpdater(id);
  const tables = useRuleTables();
  const allNodes = useNodes();
  const source = d.source ?? 'node';
  const nodeOutputs = getNodeOutputs(allNodes, id);
  // 基准要对"每个分组的一个值"求统计，因此取逐组列（column），如查找/分组聚合输出的每店成交
  const columnOutputs = nodeOutputs.filter((o) => o.ref.outputKind === 'column');
  const curTable = tables.find((t) => t.id === d.tableId);
  const fields = curTable?.fields ?? [];
  const numFields = fields.filter((f) => f.type === 'number');

  const rowLabel = 'mb-1 mt-2 text-[11px] font-medium text-gray-500 first:mt-0';
  const inputCls =
    'w-full rounded-md border bg-white px-2 py-1 text-[11px] text-gray-700 focus:outline-none focus:ring-1 focus:ring-violet-400';
  const baselineOpts = [
    { value: 'avg', label: '所有分组的平均值（如全店平均）' },
    { value: 'topAvg', label: '按指标降序，取前 N% 店铺的平均值' },
    { value: 'bottomAvg', label: '按指标降序，取后 N% 店铺的平均值' },
    { value: 'median', label: '所有分组的中位数' },
    { value: 'max', label: '所有分组的最高值' },
    { value: 'min', label: '所有分组的最低值' },
  ] as const;
  const isTailAvg = d.baselineFn === 'topAvg' || d.baselineFn === 'bottomAvg';
  const percent = typeof d.percent === 'number' && d.percent > 0 ? d.percent : 20;
  const pickedLabel = source === 'node' ? d.refNode?.label : d.valueFieldLabel;
  const chosenNodeId = source === 'node' ? d.refNode?.nodeId || '' : '';
  // 选定节点结果后，其 output 列即为可选"统计列"（与 evaluate 输出对齐）
  const statCols =
    source === 'node' && chosenNodeId
      ? inferNodeCols(
          allNodes as unknown as ReadonlyArray<{ id: string; data: unknown }>,
          tables as unknown as Array<{ id: string; fields: Array<{ key: string; alias?: string }> }>,
          chosenNodeId,
        )
      : [];
  // 需先选定节点结果并选定其统计列，才可选择统计方式
  const hasStatField = source === 'node' ? !!chosenNodeId && !!d.refNode?.col : !!d.valueField;

  return (
    <NodeShell fnode={fnode}>
      {/* 数据来源切换 */}
      <div className="mb-1 flex items-center gap-1">
        <span className="text-[11px] text-gray-500">数据来源</span>
        <div className="ml-auto flex rounded-lg border bg-gray-50 p-0.5">
          {(
            [
              { v: 'node', t: '节点结果' },
              { v: 'table', t: '数据表' },
            ] as const
          ).map((s) => (
            <button
              key={s.v}
              type="button"
              onClick={() => update({ source: s.v })}
              className={`rounded-md px-2 py-0.5 text-[11px] transition ${
                source === s.v ? 'bg-violet-600 text-white shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {s.t}
            </button>
          ))}
        </div>
      </div>

      {source === 'node' ? (
        <>
          <div className={rowLabel}>① 统计字段（选择节点结果）</div>
          <select
            value={chosenNodeId}
            onChange={(e) => {
              const o = columnOutputs.find((x) => x.ref.nodeId === e.target.value);
              update({
                refNode: o ? { ...o.ref, col: '', colLabel: '' } : undefined,
                resultLabel: o
                  ? `${o.ref.label}${isTailAvg ? `前/后${percent}%` : ''}的平均值`
                  : d.resultLabel,
              });
            }}
            className={inputCls}
          >
            <option value="">选择节点结果，如：店仓售罄率…</option>
            {columnOutputs.map((o) => (
              <option key={o.ref.nodeId} value={o.ref.nodeId}>
                {KIND_LABEL[o.ref.nodeKind]} · {o.ref.label}
              </option>
            ))}
          </select>

          {chosenNodeId && statCols.length > 0 && (
            <>
              <div className={rowLabel}>② 统计列（选择要统计的数值列）</div>
              <select
                value={d.refNode?.col ?? ''}
                onChange={(e) => {
                  const c = statCols.find((x) => x.key === e.target.value);
                  update({
                    refNode: {
                      ...(d.refNode as NonNullable<BaselineNodeData['refNode']>),
                      col: c?.key ?? '',
                      colLabel: c?.label ?? '',
                    },
                  });
                }}
                className={inputCls}
              >
                <option value="">选择统计列，如：售罄率…</option>
                {statCols.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.label}
                  </option>
                ))}
              </select>
            </>
          )}
          {columnOutputs.length === 0 && (
            <div className="mt-1.5 rounded-md bg-amber-50 px-2 py-1 text-[10px] leading-relaxed text-amber-700">
              画布上还没有&quot;逐组指标&quot;节点。请先添加「查找·聚合带回」或「分组聚合」，输出每个店仓的成交金额。
            </div>
          )}
        </>
      ) : (
        <>
          <div className={rowLabel}>① 数据表（分组聚合所在表）</div>
          <select
            value={d.tableId}
            onChange={(e) => {
              const t = tables.find((x) => x.id === e.target.value);
              update({ tableId: e.target.value, tableName: t?.name ?? '', valueField: '', valueFieldLabel: '' });
            }}
            className={inputCls}
          >
            <option value="">选择表，如：零售工作薄5…</option>
            {tables.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>

          <div className={rowLabel}>② 统计字段（选择要统计的数值列）</div>
          <select
            value={d.valueField}
            onChange={(e) => {
              const f = fields.find((x) => x.key === e.target.value);
              update({ valueField: e.target.value, valueFieldLabel: f?.alias || f?.key || e.target.value });
            }}
            className={inputCls}
          >
            <option value="">选择数值列，如：成交金额…</option>
            {(numFields.length ? numFields : fields).map((f) => (
              <option key={f.key} value={f.key}>
                {f.alias || f.key}
              </option>
            ))}
          </select>
        </>
      )}

      <div className={rowLabel}>{source === 'node' ? '③' : '③'} 统计方式（对该统计列的所有值求基准）</div>
      <select
        value={d.baselineFn}
        disabled={!hasStatField}
        onChange={(e) => {
          const fn = e.target.value as BaselineNodeData['baselineFn'];
          update({
            baselineFn: fn,
            // 切换到前/后 N% 时给默认百分比与命名
            ...(fn === 'topAvg' || fn === 'bottomAvg'
              ? { percent: typeof d.percent === 'number' && d.percent > 0 ? d.percent : 20 }
              : {}),
          });
        }}
        className={inputCls}
      >
        {baselineOpts.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>

      {isTailAvg && (
        <div className="mt-1.5 flex items-center gap-1.5">
          <span className="shrink-0 text-[11px] text-gray-500">
            取{d.baselineFn === 'topAvg' ? '前' : '后'}
          </span>
          <input
            type="number"
            min={1}
            max={100}
            value={percent}
            onChange={(e) => {
              const v = Number(e.target.value);
              update({ percent: Number.isFinite(v) && v > 0 ? Math.min(100, Math.round(v)) : 20 });
            }}
            className="w-16 rounded-md border bg-white px-2 py-1 text-[11px] text-gray-700 focus:outline-none focus:ring-1 focus:ring-violet-400"
          />
          <span className="shrink-0 text-[11px] text-gray-500">% 的店铺（按连带率{d.baselineFn === 'topAvg' ? '从高到低' : '从低到高'}）</span>
        </div>
      )}

      <div className={rowLabel}>结果命名</div>
      <input
        value={d.resultLabel}
        onChange={(e) => update({ resultLabel: e.target.value })}
        placeholder="如：全店平均成交金额"
        className={inputCls}
      />

      {pickedLabel && (
        <div className="mt-2 rounded-md bg-violet-50/70 px-2 py-1.5 text-[10px] leading-relaxed text-violet-700">
          对「{pickedLabel}」这一列的全部值
          {isTailAvg ? (
            <>
              按{d.baselineFn === 'topAvg' ? '高→低' : '低→高'}排序，取
              <b className="mx-0.5">{percent}%</b>
              的店铺（{d.baselineFn === 'topAvg' ? '表现最优的一批' : '表现最差的一批'}）再求平均值
            </>
          ) : (
            <>求{baselineOpts.find((o) => o.value === d.baselineFn)?.label}</>
          )}
          ，得到基准值「{d.resultLabel || '基准'}」
        </div>
      )}
    </NodeShell>
  );
});

// ---------- 左关联补全节点（搭积木原子：全集表 ⟕ 事实结果，缺失键补固定值） ----------
const FillJoinNode = memo(({ id, data }: NodeProps) => {
  const fnode = { id, kind: 'filljoin' as const, data, position: { x: 0, y: 0 } } as FlowNode;
  const d = data as unknown as FillJoinNodeData;
  const update = useNodeUpdater(id);
  const tables = useRuleTables();
  const allNodes = useNodes();
  // 可作为"事实结果"引用的节点：逐列输出（分组聚合/查找/补全/计算结果列/基础数据等）
  const factNodeOptions = getNodeOutputs(allNodes, id).filter((o) => o.ref.outputKind === 'column');
  const factSource: 'table' | 'node' = d.factSource === 'table' ? 'table' : 'node';
  const uniTable = tables.find((t) => t.id === d.universeTableId);
  const uniFields = uniTable?.fields ?? [];
  const factTable = tables.find((t) => t.id === d.factTableId);
  const factFields = factTable?.fields ?? [];

  const rowLabel = 'mb-1 mt-2 text-[11px] font-medium text-gray-500 first:mt-0';
  const inputCls =
    'w-full rounded-md border bg-white px-2 py-1 text-[11px] text-gray-700 focus:outline-none focus:ring-1 focus:ring-slate-400';
  const universeNodeOptions = factNodeOptions.filter((o, i, arr) => arr.findIndex((x) => x.ref.nodeId === o.ref.nodeId) === i);
  const uniIsNode = d.universeSource === 'node';
  const uniSrcCols: Array<{ key: string; label: string }> = uniIsNode
    ? d.universeNodeId
      ? inferNodeCols(allNodes, tables, d.universeNodeId)
      : []
    : uniFields.map((f) => ({ key: f.key, label: f.alias || f.key }));

  const factNodeRef =
    factNodeOptions.find((o) => o.ref.nodeId === d.factNode)?.ref ??
    (d.factNode ? { nodeId: d.factNode, nodeKind: 'groupby' as const, outputKind: 'column' as const, label: d.factNodeLabel || '节点结果' } : undefined);

  return (
    <NodeShell fnode={fnode}>
      <div className="mb-1 mt-2 flex items-center gap-1">
        <span className="shrink-0 text-[11px] text-gray-400">全集来源</span>
        <select
          value={d.universeSource || 'table'}
          onChange={(e) => {
            const s = e.target.value as 'table' | 'node';
            update({ universeSource: s, universeTableId: '', universeTableName: '', universeNodeId: '', universeField: '', universeFieldLabel: '', universeReturnField: '', universeReturnLabel: '' });
          }}
          className={inputCls}
        >
          <option value="table">数据表</option>
          <option value="node">节点结果</option>
        </select>
      </div>

      {d.universeSource === 'node' ? (
        <>
          <div className={rowLabel}>① 全集节点（作为全集，如：第一个补全结果）</div>
          <select
            value={d.universeNodeId || ''}
            onChange={(e) => update({ universeNodeId: e.target.value || undefined, universeField: '', universeFieldLabel: '' })}
            className={inputCls}
          >
            <option value="">选择全集节点…</option>
            {universeNodeOptions.map((o) => (
              <option key={o.ref.nodeId} value={o.ref.nodeId}>
                {o.ref.label || o.ref.nodeId}
              </option>
            ))}
          </select>
        </>
      ) : (
        <>
          <div className={rowLabel}>① 全集表（主数据，含所有店仓）</div>
          <select
            value={d.universeTableId}
            onChange={(e) => {
              const t = tables.find((x) => x.id === e.target.value);
              update({ universeTableId: e.target.value, universeTableName: t?.name ?? '', universeField: '', universeFieldLabel: '' });
            }}
            className={inputCls}
          >
            <option value="">选择全集表，如：店仓表…</option>
            {tables.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </>
      )}

      <div className="mt-1.5 rounded-md bg-slate-50 px-2 py-1 text-[10px] leading-relaxed text-slate-500">
        匹配键请在下方「④ 匹配字段」中成对选择（全集键 = 事实键，支持店仓 + 款色等多个字段同时匹配）。
      </div>

      <div className="mb-1 mt-2 flex items-center gap-1">
        <span className="shrink-0 text-[11px] text-gray-400">全集返回列(可选，空=返回全部)</span>
      </div>
      <div className="max-h-36 overflow-y-auto rounded-md border border-gray-200 p-1 field-list-scroll">
        <label className="flex cursor-pointer items-center gap-1.5 px-1 py-0.5 text-[12px]">
          <input
            type="checkbox"
            checked={!(d.universeReturnFields && d.universeReturnFields.length > 0) && !d.universeReturnField}
            onChange={() => update({ universeReturnFields: [], universeReturnField: undefined, universeReturnLabel: undefined } as any)}
          />
          <span className="text-gray-600">全部返回（不带回键列）</span>
        </label>
        {uniSrcCols.filter((f) => f.key !== d.universeField).map((f) => {
          const checked = (d.universeReturnFields || [])
            .map((x) => x.key)
            .concat(d.universeReturnField ? [d.universeReturnField] : [])
            .includes(f.key);
          return (
            <label key={f.key} className="flex cursor-pointer items-center gap-1.5 px-1 py-0.5 text-[12px]">
              <input
                type="checkbox"
                checked={checked}
                onChange={() => {
                  const cur = (d.universeReturnFields || []).filter((x) => x.key !== f.key);
                  if (!checked) cur.push({ key: f.key, label: f.label });
                  update({ universeReturnFields: cur, universeReturnField: undefined, universeReturnLabel: undefined } as any);
                }}
              />
              <span className="text-gray-700">{f.label}</span>
            </label>
          );
        })}
      </div>

      <div className="mt-2">
        <DataSourcePicker
          source={factSource}
          sourceNode={d.factNode}
          nodeOptions={factNodeOptions}
          onSourceChange={(v) => update({ factSource: v } as Partial<FillJoinNodeData>)}
          onNodeChange={(ref) =>
            update({ factNode: ref?.nodeId ?? '', factNodeLabel: ref?.label ?? '', factKeyField: '', factKeyFieldLabel: '' } as Partial<FillJoinNodeData>)
          }
          nodeLabel="③ 事实结果节点（取其逐行结果左关联，如：9月店仓开单天数 / 计算·未开单天数）"
          nodePlaceholder="选择上一步节点结果，如：分组聚合/计算…"
          tableBlock={
            <>
              <div className={rowLabel}>③ 事实结果表（数据表）</div>
              <select
                value={d.factTableId}
                onChange={(e) => {
                  const t = tables.find((x) => x.id === e.target.value);
                  update({ factTableId: e.target.value, factTableName: t?.name ?? '', factKeyField: '', factKeyFieldLabel: '' });
                }}
                className={inputCls}
              >
                <option value="">选择事实结果表，如：零售工作薄…</option>
                {tables.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </>
          }
        />
      </div>

      <div className={rowLabel}>④ 匹配字段（全集键 = 事实键，可多对，如：店仓 + 款色）</div>
      {(() => {
        const uniCols: Array<{ key: string; label: string }> =
          d.universeSource === 'node' && d.universeNodeId
            ? inferNodeCols(allNodes, tables, d.universeNodeId)
            : uniFields.map((f) => ({ key: f.key, label: f.alias || f.key }));
        const factCols: Array<{ key: string; label: string }> =
          factSource === 'node'
            ? d.factNode
              ? inferNodeCols(allNodes, tables, d.factNode)
              : []
            : factFields.map((f) => ({ key: f.key, label: f.alias || f.key }));
        const exKeys: NonNullable<FillJoinNodeData['extraKeys']> = Array.isArray(d.extraKeys) ? d.extraKeys : [];

        if (!uniCols.length && !factCols.length) {
          return (
            <div className="rounded-md bg-slate-50 px-2 py-1 text-[10px] text-slate-400">
              请先在上面选择全集与事实数据来源；节点结果列由上游计算确定（如过滤）时默认取结果首列作为匹配键。
            </div>
          );
        }

        const uniLabel = (key: string) => uniCols.find((c) => c.key === key)?.label || key;
        const factLabel = (key: string) => factCols.find((c) => c.key === key)?.label || key;
        const updateEx = (i: number, patch: Partial<NonNullable<FillJoinNodeData['extraKeys']>[number]>) => {
          const arr = exKeys.map((k) => ({ ...k }));
          arr[i] = { ...arr[i], ...patch };
          update({ extraKeys: arr } as Partial<FillJoinNodeData>);
        };

        const renderPair = (
          isPrimary: boolean,
          uniVal: string,
          factVal: string,
          keyStr: string,
          onUni: (v: string) => void,
          onFact: (v: string) => void,
          onRemove?: () => void,
        ) => (
          <div key={keyStr} className="mb-1 flex items-center gap-1">
            <select
              value={uniVal}
              onChange={(e) => onUni(e.target.value)}
              className="min-w-0 flex-1 rounded-md border bg-white px-2 py-1 text-[11px] text-gray-700 focus:outline-none focus:ring-1 focus:ring-violet-400"
            >
              <option value="">{isPrimary ? '全集主匹配键（如：店仓名称）' : '全集键…'}</option>
              {uniCols.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </select>
            <span className="shrink-0 text-slate-300">=</span>
            <select
              value={factVal}
              onChange={(e) => onFact(e.target.value)}
              className="min-w-0 flex-1 rounded-md border bg-white px-2 py-1 text-[11px] text-gray-700 focus:outline-none focus:ring-1 focus:ring-violet-400"
            >
              <option value="">{isPrimary ? '事实主匹配键（如：店仓名称）' : '事实键…'}</option>
              {factCols.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </select>
            {!isPrimary && (
              <button
                type="button"
                onClick={onRemove}
                className="shrink-0 rounded-md px-1 text-xs text-slate-400 hover:text-red-500"
                title="删除该匹配字段"
              >
                ×
              </button>
            )}
          </div>
        );

        return (
          <div>
            {renderPair(
              true,
              d.universeField || '',
              d.factKeyField || '',
              'join-key-primary',
              (v: string) => update({ universeField: v, universeFieldLabel: uniLabel(v) } as Partial<FillJoinNodeData>),
              (v: string) => update({ factKeyField: v, factKeyFieldLabel: factLabel(v) } as Partial<FillJoinNodeData>),
              undefined,
            )}
            {exKeys.map((k, i) =>
              renderPair(
                false,
                k.universeField || '',
                k.factField || '',
                `join-key-ex-${i}`,
                (v: string) => updateEx(i, { universeField: v, universeFieldLabel: uniLabel(v) }),
                (v: string) => updateEx(i, { factField: v, factFieldLabel: factLabel(v) }),
                () => update({ extraKeys: exKeys.filter((_, j) => j !== i) } as Partial<FillJoinNodeData>),
              ),
            )}
            <button
              type="button"
              onClick={() =>
                update({
                  extraKeys: [...exKeys, { universeField: '', universeFieldLabel: '', factField: '', factFieldLabel: '' }],
                } as Partial<FillJoinNodeData>)
              }
              className="mt-0.5 text-[11px] text-violet-500 hover:underline"
            >
              + 追加匹配字段
            </button>
            <div className="mt-1 rounded-md bg-slate-50 px-2 py-1 text-[10px] leading-relaxed text-slate-500">
              多对字段会同时参与匹配（如：全集.店仓名称 = 事实.店仓名称 且 全集.款色 = 事实.款色）；缺失匹配的事实侧按下方填充值补行。
            </div>
          </div>
        );
      })()}

      {factSource === 'node' &&
        (() => {
          const nodeCols = d.factNode ? inferNodeCols(allNodes, tables, d.factNode) : [];
          return nodeCols.length > 0 ? (
            <>
              <div className={rowLabel}>事实带回指标列（默认带回全部非键列；只需库存等单列时在此指定）</div>
              <select
                value={d.factReturnField || ''}
                onChange={(e) => {
                  const c = nodeCols.find((x) => x.key === e.target.value);
                  update({ factReturnField: e.target.value || undefined, factReturnLabel: c?.label || e.target.value || undefined } as Partial<FillJoinNodeData>);
                }}
                className={inputCls}
              >
                <option value="">带回全部列</option>
                {nodeCols
                  .filter((c) => c.key !== d.factKeyField)
                  .map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.label}
                    </option>
                  ))}
              </select>
            </>
          ) : null;
        })()}

      <div className={rowLabel}>⑤ 缺失填充值</div>
      <input
        value={d.fillValue}
        onChange={(e) => update({ fillValue: e.target.value })}
        placeholder="缺成交的店按 0 计入"
        className={inputCls}
      />

      <div className={rowLabel}>结果命名</div>
      <input
        value={d.resultLabel}
        onChange={(e) => update({ resultLabel: e.target.value })}
        placeholder="如：含 0 成交的全部门店"
        className={inputCls}
      />

      {d.universeField && (factSource === 'node' ? d.factNode : d.factKeyField) && (
        <div className="mt-2 rounded-md bg-slate-100 px-2 py-1.5 text-[10px] leading-relaxed text-slate-600">
          以「{d.universeTableName}」的全部{d.universeFieldLabel}为全集，左关联{' '}
          {factSource === 'node' ? `节点「${factNodeRef?.label || d.factNodeLabel || '上一步'}」` : `${d.factTableName}（按${d.factKeyFieldLabel}匹配）`}
          ，缺失键按 {d.fillValue || 0} 补全
        </div>
      )}
    </NodeShell>
  );
});

// ---------- 排名节点（对若干指标列按升/降序算排名，并生成可配置的 TOP 分档） ----------
const RankNode = memo(({ id, data }: NodeProps) => {
  const fnode = { id, kind: 'rank' as const, data, position: { x: 0, y: 0 } } as FlowNode;
  const d = data as unknown as RankNodeData;
  const update = useNodeUpdater(id);
  const tables = useRuleTables();
  const allNodes = useNodes();
  const source = d.source ?? 'table';
  const nodeOutputs = getNodeOutputs(allNodes, id);
  const columnOutputs = nodeOutputs.filter((o) => o.ref.outputKind === 'column');
  const curTable = tables.find((t) => t.id === d.tableId);
  const fields = curTable?.fields ?? [];
  // 节点结果模式：优先实时推断引用节点的输出列（含链式 rank 透传的全部字段），保证排名项能选到上游节点结果字段
  const nodeCols = d.refNode?.nodeId
    ? inferNodeCols(allNodes as unknown as ReadonlyArray<{ id: string; data: unknown }>, tables as unknown as Array<{ id: string; fields: Array<{ key: string; alias?: string }> }>, d.refNode.nodeId)
    : [];
  // incomingCols 仅是历史快照，实时 nodeCols 更可靠；两者并集去重，保证评分项/分组维度能选到上游全部字段
  const mergedCols = [...nodeCols];
  for (const c of d.incomingCols ?? []) {
    if (!mergedCols.some((x) => x.key === c.key)) mergedCols.push(c);
  }
  const pickedCols = source === 'node' ? mergedCols : fields.map((f) => ({ key: f.key, label: f.alias || f.key }));

  const rowLabel = 'mb-1 mt-2 text-[11px] font-medium text-gray-500 first:mt-0';
  const inputCls =
    'w-full rounded-md border bg-white px-2 py-1 text-[11px] text-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-400';
  const defaultItems = d.items && d.items.length ? d.items : [];

  const addItem = () => {
    const item: RankItem = {
      id: nextUid('rank'),
      fieldKey: '',
      fieldLabel: '',
      order: 'desc',
      mode: 'whole',
      groupBy: [],
      topTiersEnabled: true,
      topTiers: [
        { label: 'TOP1', from: 0, to: 10 },
        { label: 'TOP2', from: 10, to: 20 },
      ],
      rankLabel: '',
    };
    update({ items: [...defaultItems, item] });
  };
  const updateItem = (i: number, patch: Partial<RankItem>) => {
    const items = defaultItems.slice();
    items[i] = { ...items[i], ...patch };
    update({ items });
  };
  const removeItem = (i: number) => update({ items: defaultItems.filter((_, index) => index !== i) });
  const onColChange = (i: number, key: string, label: string) =>
    updateItem(i, {
      fieldKey: key,
      fieldLabel: label,
      rankLabel: '',
    });

  const applyNode = (nodeId: string) => {
    const o = columnOutputs.find((x) => x.ref.nodeId === nodeId);
    update({
      refNode: o?.ref,
      resultLabel: o ? `${o.ref.label}的排名` : d.resultLabel,
      incomingCols: inferNodeCols(allNodes as unknown as ReadonlyArray<{ id: string; data: unknown }>, tables as unknown as Array<{ id: string; fields: Array<{ key: string; alias?: string }> }>, nodeId),
    });
  };

  return (
    <NodeShell fnode={fnode}>
      {/* 数据来源切换 */}
      <div className="mb-1 flex items-center gap-1">
        <span className="text-[11px] text-gray-500">数据来源</span>
        <div className="ml-auto flex rounded-lg border bg-gray-50 p-0.5">
          {(
            [
              { v: 'table', t: '数据表' },
              { v: 'node', t: '节点结果' },
            ] as const
          ).map((s) => (
            <button
              key={s.v}
              type="button"
              onClick={() => update({ source: s.v, refNode: undefined, incomingCols: [] })}
              className={`rounded-md px-2 py-0.5 text-[11px] transition ${
                source === s.v ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {s.t}
            </button>
          ))}
        </div>
      </div>

      {source === 'node' ? (
        <>
          <div className={rowLabel}>① 引用节点输出（要排名的数据）</div>
          <select
            value={d.refNode?.nodeId ?? ''}
            onChange={(e) => applyNode(e.target.value)}
            className={inputCls}
          >
            <option value="">选择节点结果，如：每家店的连带率…</option>
            {columnOutputs.map((o) => (
              <option key={o.ref.nodeId} value={o.ref.nodeId}>
                {KIND_LABEL[o.ref.nodeKind]} · {o.ref.label}
              </option>
            ))}
          </select>
          {columnOutputs.length === 0 && (
            <div className="mt-1.5 rounded-md bg-amber-50 px-2 py-1 text-[10px] leading-relaxed text-amber-700">
              画布上还没有&quot;逐行/逐组&quot;节点。请先添加「分组聚合」「计算」等节点，再引用它做排名。
            </div>
          )}
        </>
      ) : (
        <>
          <div className={rowLabel}>① 数据表（要排名的数据）</div>
          <select
            value={d.tableId}
            onChange={(e) => {
              const t = tables.find((x) => x.id === e.target.value);
              update({ tableId: e.target.value, tableName: t?.name ?? '', items: [] });
            }}
            className={inputCls}
          >
            <option value="">选择表，如：零售工作薄5…</option>
            {tables.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          {/* 统计日期窗（可选）：数据表有日期字段时按时间窗圈定排名范围；无则留空=不限时间 */}
          {fields.some((f) => f.type === 'date') ? (
            <>
              <div className={rowLabel}>①② 日期字段（可选，按这列圈定排名范围）</div>
              <select
                value={d.dateField ?? ''}
                onChange={(e) => {
                  const f = fields.find((x) => x.key === e.target.value);
                  update({ dateField: e.target.value || undefined, dateFieldLabel: f?.alias || f?.key || '' });
                }}
                className={inputCls}
              >
                <option value="">不限时间（不按日期窗过滤）</option>
                {fields.filter((f) => f.type === 'date').map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.alias || f.key}
                  </option>
                ))}
              </select>
              {d.dateField && (
                <>
                  <div className={rowLabel}>①③ 统计时间窗</div>
                  <TimeComponent
                    value={d.timeWindow ?? { preset: 'thisMonth' }}
                    onChange={(tw) => update({ timeWindow: tw })}
                  />
                </>
              )}
            </>
          ) : (
            <div className="mt-1.5 rounded-md bg-slate-50 px-2 py-1 text-[10px] text-gray-400">
              该表无日期字段，排名覆盖全量数据（不限时间）。
            </div>
          )}
        </>
      )}

      <div className={rowLabel}>② 排名项（可为多个指标各算一次排名）</div>
      {defaultItems.length === 0 && (
        <div className="rounded-md bg-slate-50 px-2 py-1.5 text-[10px] text-gray-500">
          还没有排名项。点击下方&quot;＋ 添加排名&quot;开始配置。
        </div>
      )}
      {defaultItems.map((it, i) => (
        <div key={it.id} className="mt-1.5 rounded-md border border-blue-100 bg-blue-50/40 p-2">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[10px] font-semibold text-blue-700">排名项 {i + 1}</span>
            <button
              type="button"
              onClick={() => removeItem(i)}
              className="flex h-4 w-4 items-center justify-center rounded text-gray-400 hover:bg-red-50 hover:text-red-500"
            >
              <X className="h-3 w-3" />
            </button>
          </div>

          {/* 指标列 */}
          <div className={rowLabel}>待排名指标列</div>
          <select value={it.fieldKey} onChange={(e) => {
            const c = pickedCols.find((x) => x.key === e.target.value);
            onColChange(i, e.target.value, c?.label ?? e.target.value);
          }} className={inputCls}>
            <option value="">选择指标列，如：连带率…</option>
            {(pickedCols.length ? pickedCols : source === 'table' ? fields.map((f) => ({ key: f.key, label: f.alias || f.key })) : []).map((c) => (
              <option key={c.key} value={c.key}>{c.label}</option>
            ))}
          </select>

          {/* 排序方向 + 排名方式 */}
          <div className="mt-2 flex items-center gap-2">
            <select
              value={it.order}
              onChange={(e) => updateItem(i, { order: e.target.value as 'asc' | 'desc' })}
              className={inputCls}
            >
              <option value="desc">降序（值大→名次靠前）</option>
              <option value="asc">升序（值小→名次靠前）</option>
            </select>
            <select
              value={it.mode}
              onChange={(e) => updateItem(i, { mode: e.target.value as 'whole' | 'group' })}
              className={inputCls}
            >
              <option value="whole">按指标值整体排名</option>
              <option value="group">按分组排名</option>
            </select>
          </div>

          {/* 分组维度 */}
          {it.mode === 'group' && (
            <>
              <div className={rowLabel}>分组维度（按此分组，组内排名）</div>
              <select value={''} onChange={(e) => {
                if (!e.target.value) return;
                const c = pickedCols.find((x) => x.key === e.target.value);
                const gs = [...(it.groupBy || [])];
                if (!gs.some((g) => g.key === e.target.value)) gs.push({ key: e.target.value, label: c?.label ?? e.target.value });
                updateItem(i, { groupBy: gs });
              }} className={inputCls}>
                <option value="">＋ 添加分组维度</option>
                {(pickedCols.length ? pickedCols : []).map((c) => (
                  <option key={c.key} value={c.key}>{c.label}</option>
                ))}
              </select>
              {it.groupBy && it.groupBy.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {it.groupBy.map((g) => (
                    <span key={g.key} className="flex items-center gap-0.5 rounded bg-blue-100 px-1.5 py-0.5 text-[10px] text-blue-700">
                      {g.label}
                      <button type="button" onClick={() => updateItem(i, { groupBy: (it.groupBy || []).filter((x) => x.key !== g.key) })}>
                        <X className="h-2.5 w-2.5" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </>
          )}

          {/* TOP 档位 */}
          <div className="mt-2 flex items-center justify-between">
            <span className="text-[11px] text-gray-500">生成 TOP 档位</span>
            <button
              type="button"
              onClick={() => updateItem(i, { topTiersEnabled: !it.topTiersEnabled })}
              className={`rounded px-1.5 py-0.5 text-[10px] ${it.topTiersEnabled ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-500'}`}
            >
              {it.topTiersEnabled ? '开启' : '关闭'}
            </button>
          </div>
          {it.topTiersEnabled && (
            <div className="mt-1 space-y-1">
              {it.topTiers.map((tt, ti) => (
                <div key={ti} className="flex items-center gap-1">
                  <input
                    value={tt.label}
                    onChange={(e) => {
                      const tiers = (it.topTiers || []).slice();
                      tiers[ti] = { ...tiers[ti], label: e.target.value };
                      updateItem(i, { topTiers: tiers });
                    }}
                    className="w-16 rounded border bg-white px-1 py-0.5 text-[10px]"
                    placeholder="TOP1"
                  />
                  <span className="text-[10px] text-gray-400">前</span>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={tt.from}
                    onChange={(e) => {
                      const tiers = (it.topTiers || []).slice();
                      tiers[ti] = { ...tiers[ti], from: Number(e.target.value) || 0 };
                      updateItem(i, { topTiers: tiers });
                    }}
                    className="w-12 rounded border bg-white px-1 py-0.5 text-[10px]"
                  />
                  <span className="text-[10px] text-gray-400">%~</span>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={tt.to}
                    onChange={(e) => {
                      const tiers = (it.topTiers || []).slice();
                      tiers[ti] = { ...tiers[ti], to: Number(e.target.value) || 100 };
                      updateItem(i, { topTiers: tiers });
                    }}
                    className="w-12 rounded border bg-white px-1 py-0.5 text-[10px]"
                  />
                  <span className="text-[10px] text-gray-400">%</span>
                  <button
                    type="button"
                    onClick={() => updateItem(i, { topTiers: (it.topTiers || []).filter((_, k) => k !== ti) })}
                    className="text-[10px] text-red-400 hover:text-red-600"
                  >
                    删
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => updateItem(i, { topTiers: [...(it.topTiers || []), { label: 'TOP', from: 0, to: 100 }] })}
                className="text-[10px] text-blue-500 hover:text-blue-700"
              >
                ＋ 档位
              </button>
            </div>
          )}

          {/* 结果命名 */}
          <div className={rowLabel}>排名结果命名（如：连带率排名）</div>
          <input
            value={it.rankLabel}
            onChange={(e) => updateItem(i, { rankLabel: e.target.value })}
            placeholder={it.fieldLabel ? `如：${it.fieldLabel}排名` : '如：连带率排名'}
            className={inputCls}
          />
        </div>
      ))}

      <button
        type="button"
        onClick={addItem}
        className="mt-2 w-full rounded-md border border-dashed border-blue-300 bg-blue-50/50 py-1 text-[11px] text-blue-600 transition hover:bg-blue-100"
      >
        ＋ 添加排名项
      </button>

      <div className={rowLabel}>结果命名</div>
      <input
        value={d.resultLabel}
        onChange={(e) => update({ resultLabel: e.target.value })}
        placeholder="如：连带率排名结果"
        className={inputCls}
      />

      {defaultItems.length > 0 && (
        <div className="mt-2 rounded-md bg-blue-50/70 px-2 py-1.5 text-[10px] leading-relaxed text-blue-700">
          将为 {defaultItems.map((x) => x.fieldLabel).filter(Boolean).join('、') || '各指标'}{' '}
          生成「排名(列名)」与「TOP档(列名)」两列，可作为后续判断（如 TOP1 名）的依据。
        </div>
      )}
    </NodeShell>
  );
});

export const nodeTypes = {
  trigger: TriggerNode,
  field: FieldNode,
  condition: ConditionNode,
  compute: ComputeNode,
  lookup: LookupNode,
  relation: RelationNode,
  action: ActionNode,
  time: TimeNode,
  topn: TopNNode,
  diff: DiffNode,
  groupby: GroupByNode,
  baseline: BaselineNode,
  filljoin: FillJoinNode,
  base: BaseNode,
  filter: FilterNode,
  elapsed: ElapsedNode,
  logic: LogicNode,
  rank: RankNode,
};

TopNNode.displayName = 'TopNNode';
DiffNode.displayName = 'DiffNode';
GroupByNode.displayName = 'GroupByNode';
BaselineNode.displayName = 'BaselineNode';
FillJoinNode.displayName = 'FillJoinNode';
BaseNode.displayName = 'BaseNode';
LogicNode.displayName = 'LogicNode';

TriggerNode.displayName = 'TriggerNode';
FieldNode.displayName = 'FieldNode';
ConditionNode.displayName = 'ConditionNode';
ComputeNode.displayName = 'ComputeNode';
LookupNode.displayName = 'LookupNode';
RelationNode.displayName = 'RelationNode';
ActionNode.displayName = 'ActionNode';
TimeNode.displayName = 'TimeNode';
ElapsedNode.displayName = 'ElapsedNode';
RankNode.displayName = 'RankNode';

/** 依据 kind 创建默认数据 */
export function createNodeData(
  kind: FlowNode['kind'],
  extra?: { fieldKey?: string; fieldLabel?: string; tableId?: string; tableName?: string }
): FlowNode['data'] {
  switch (kind) {
    case 'trigger':
      return {};
    case 'field':
      return { tableId: extra?.tableId ?? '', tableName: extra?.tableName ?? '', fieldKey: extra?.fieldKey ?? '', fieldLabel: extra?.fieldLabel ?? '' };
    case 'condition':
      return {
        logic: 'AND',
        tableId: extra?.tableId ?? '',
        tableName: extra?.tableName ?? '',
        fieldKey: extra?.fieldKey ?? '',
        fieldLabel: extra?.fieldLabel ?? '',
        operator: 'gt',
        valueSource: 'const',
        value: '',
        valueMax: '',
        refValue: undefined,
        refNode: undefined,
        leftSource: 'auto',
        leftNode: undefined,
      };
    case 'compute':
      return {
        fn: 'sum',
        tableId: extra?.tableId ?? '',
        tableName: extra?.tableName ?? '',
        fieldKey: '',
        fieldLabel: '',
        resultLabel: '',
        compare: null,
      };
    case 'lookup':
      return {
        mode: 'field',
        tableId: '',
        tableName: '',
        matchField: '',
        matchFieldLabel: '',
        key: { tableId: '', tableName: '', fieldKey: '', fieldLabel: '' },
        returnField: '',
        returnFieldLabel: '',
        returnLabel: '',
        dateField: '',
        dateFieldLabel: '',
        timeWindow: { preset: 'specificMonth' },
        aggFn: 'sum',
        aggField: '',
        aggFieldLabel: '',
        fillZero: true,
        aggLabel: '',
      };
    case 'base':
      return {
        tableId: extra?.tableId ?? '',
        tableName: extra?.tableName ?? '',
        fieldKey: extra?.fieldKey ?? '',
        fieldLabel: extra?.fieldLabel ?? '',
        resultLabel: '',
      };
    case 'relation':
      return { tableId: '', tableName: '', fieldKey: '', fieldLabel: '', targetTableId: '', targetTable: '', targetField: '', relationType: 'inner', name: '' };
    case 'action':
      return { type: 'alert', priority: 'Important', level: 'warn', title: '触发预警通知', content: '', notify: { departments: [], personnel: [] } };
    case 'time':
      return { timeWindow: { preset: 'thisWeek' } };
    case 'topn':
      return {
        tableId: extra?.tableId ?? '',
        tableName: extra?.tableName ?? '',
        groupField: '',
        groupFieldLabel: '',
        metricField: '',
        metricFieldLabel: '',
        metricFn: 'sum',
        order: 'desc',
        topN: 1,
        dateField: '',
        dateFieldLabel: '',
        timeWindow: { preset: 'thisWeek' },
        resultLabel: '排名结果',
      };
    case 'diff':
      return {
        baseTableId: '',
        baseTableName: '',
        baseField: '',
        baseFieldLabel: '',
        checkTableId: '',
        checkTableName: '',
        checkField: '',
        checkFieldLabel: '',
        filterField: '',
        filterFieldLabel: '',
        filterValueSource: 'topn',
        filterValue: '',
        dateField: '',
        dateFieldLabel: '',
        timeWindow: { preset: 'thisWeek' },
        resultLabel: '无匹配记录',
      };
    case 'groupby':
      return {
        tableId: '',
        tableName: '',
        dateField: '',
        dateFieldLabel: '',
        timeWindow: { preset: 'specificMonth' },
        dims: [],
        groupField: '',
        groupFieldLabel: '',
        metricField: '',
        metricFieldLabel: '',
        metricFn: 'sum',
        resultLabel: '',
      };
    case 'baseline':
      return {
        source: 'node',
        refNode: undefined,
        tableId: '',
        tableName: '',
        valueField: '',
        valueFieldLabel: '',
        dims: [],
        baselineFn: 'avg',
        resultLabel: '',
      };
    case 'filljoin':
      return {
        universeTableId: '',
        universeTableName: '',
        universeField: '',
        universeFieldLabel: '',
        factSource: 'node',
        factNode: '',
        factNodeLabel: '',
        factTableId: '',
        factTableName: '',
        factKeyField: '',
        factKeyFieldLabel: '',
        fillValue: '0',
        resultLabel: '',
      };
    case 'logic':
      return { logic: 'if' };
    case 'filter':
      return {
        tableId: '',
        tableName: '',
        conditions: [],
        resultLabel: '',
      };
    case 'elapsed':
      return {
        scope: 'month',
        includeToday: true,
        resultLabel: '',
        customStart: '',
        customEnd: '',
      };
    case 'rank':
      return {
        source: 'table',
        tableId: '',
        tableName: '',
        refNode: undefined,
        items: [],
        resultLabel: '排名结果',
      };
    default:
      return {};
  }
}