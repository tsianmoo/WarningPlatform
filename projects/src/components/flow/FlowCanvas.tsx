'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type CSSProperties } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useReactFlow,
  ReactFlowProvider,
  MarkerType,
  ConnectionMode,
  type Connection,
  type Edge,
  type Node as RFNode,
} from '@xyflow/react';
import {
  Table2,
  Trash2,
  Play,
  Database,
  Link,
  Search,
  CalendarDays,
  Hourglass,
  TrendingUp,
  ListOrdered,
  Filter,
  GitCompareArrows,
  Combine,
  Calculator,
  Layers,
  BarChart3,
  GitBranch,
  Waypoints,
  Bell,
} from 'lucide-react';
import type { FlowEdge, FlowNode, Schedule, TargetSetting } from '@/lib/types';
import { KIND_COLOR, uid } from '@/lib/types';
import { useStore } from '@/lib/store';
import { BuildCtx, createNodeData, nodeTypes } from './nodes';
import { NodePreviewProvider } from './NodePreview';

type DragPayload = {
  kind: FlowNode['kind'];
  fieldKey?: string;
  fieldLabel?: string;
  tableId?: string;
  tableName?: string;
};

function toRfNodes(nodes: FlowNode[]): RFNode[] {
  return nodes.map((n) => ({ ...n, type: n.kind, data: n.data }) as RFNode);
}
function toRfEdges(edges: FlowEdge[]): Edge[] {
  return edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    animated: true,
    reconnectable: true,
    interactionWidth: 24,
    type: 'default',
    markerEnd: { type: MarkerType.ArrowClosed },
    style: { stroke: '#94A3B8', strokeWidth: 1.6 },
  }));
}

// ---------- 画布内部组件（本地状态驱动，拖拽流畅） ----------
function CanvasInner({
  nodes,
  edges,
  onFlowChange,
}: {
  nodes: FlowNode[];
  edges: FlowEdge[];
  onFlowChange: (nodes: FlowNode[], edges: FlowEdge[]) => void;
}) {
  const [localNodes, setLocalNodes] = useState<FlowNode[]>(nodes);
  const [localEdges, setLocalEdges] = useState<FlowEdge[]>(edges);
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);
  const synced = useRef(true);
  const rf = useReactFlow();

  // 外部数据变化时同步进本地（仅当画布空闲时，避免拖动中被覆盖）
  useEffect(() => {
    if (synced.current) {
      setLocalNodes(nodes);
      setLocalEdges(edges);
    }
  }, [nodes, edges]);

  const onNodesChange = useCallback(
    (changes: unknown) => {
      const rfChanges = changes as {
        type: string;
        id: string;
        position?: { x: number; y: number };
        item?: FlowNode;
      }[];
      let next = localNodes;
      const posMap = new Map<string, { x: number; y: number }>();
      const replaceMap = new Map<string, FlowNode>();
      const removes: string[] = [];
      for (const c of rfChanges) {
        if (c.type === 'position' && c.position) posMap.set(c.id, c.position);
        else if (c.type === 'replace' && c.item) replaceMap.set(c.id, c.item);
        else if (c.type === 'remove') removes.push(c.id);
      }
      let needCommit = false;
      if (posMap.size) {
        // 拖动过程中不提交，仅更新本地位置保证流畅
        synced.current = false;
        next = next.map((n) => (posMap.has(n.id) ? { ...n, position: posMap.get(n.id)! } : n));
      }
      if (replaceMap.size) {
        // ReactFlow updateNodeData 回发的是 RF 节点（含 type、data），需归一成应用内部 FlowNode（kind/position/data），
        // 否则保存后节点丢失 kind，重新打开时渲染不出来（表现为配置“消失”）。
        next = next.map((n) => {
          const rf = replaceMap.get(n.id);
          if (!rf) return n;
          return {
            id: n.id,
            kind: n.kind,
            position: rf.position ?? n.position,
            data: (rf.data ?? n.data) as FlowNode['data'],
          };
        });
        needCommit = true; // 节点数据变更（选字段/算子/阈值等）需要持久化
      }
      if (removes.length) {
        next = next.filter((n) => !removes.includes(n.id));
        needCommit = true;
      }
      setLocalNodes(next);
      if (needCommit) {
        synced.current = true;
        onFlowChange(
          next,
          removes.length
            ? edges.filter((e) => !removes.includes(e.target) && !removes.includes(e.source))
            : edges
        );
      }
    },
    [localNodes, edges, onFlowChange]
  );

  // 拖动结束 → 提交位置到父级
  const onNodeDragStop = useCallback(
    (_: unknown, node: RFNode) => {
      synced.current = true;
      onFlowChange(
        localNodes.map((n) => (n.id === node.id ? { ...n, position: node.position } : n)),
        localEdges
      );
    },
    [localNodes, localEdges, onFlowChange]
  );

  const onConnect = useCallback(
    (conn: Connection) => {
      if (!conn.source || !conn.target) return;
      const es = [...localEdges, { id: uid('edge'), source: conn.source, target: conn.target }];
      setLocalEdges(es);
      onFlowChange(localNodes, es);
    },
    [localNodes, localEdges, onFlowChange]
  );

  const onEdgesChange = useCallback(
    (changes: unknown) => {
      const l = changes as { type: string; id: string }[];
      for (const c of l) {
        if (c.type === 'remove') {
          const es = localEdges.filter((e) => e.id !== c.id);
          setLocalEdges(es);
          onFlowChange(localNodes, es);
          if (selectedEdge === c.id) setSelectedEdge(null);
          return;
        }
      }
    },
    [localNodes, localEdges, onFlowChange, selectedEdge]
  );

  const onReconnect = useCallback(
    (oldEdge: { id: string }, newConn: { source: string | null; target: string | null }) => {
      setSelectedEdge(null);
      let next = localEdges.map((e) =>
        e.id === oldEdge.id
          ? {
              ...e,
              source: newConn.source ?? e.source,
              target: newConn.target ?? e.target,
            }
          : e
      );
      // 过滤掉未真正重连（源头/终点未变）的边，避免重复
      next = next.filter((e, i) => {
        if (e.id !== oldEdge.id) return true;
        return e.source !== localEdges[i].source || e.target !== localEdges[i].target;
      });
      setLocalEdges(next);
      onFlowChange(localNodes, next);
    },
    [localEdges, localNodes, onFlowChange]
  );

  const deleteSelectedEdge = useCallback(() => {
    if (!selectedEdge) return;
    const es = localEdges.filter((e) => e.id !== selectedEdge);
    setLocalEdges(es);
    onFlowChange(localNodes, es);
    setSelectedEdge(null);
  }, [selectedEdge, localEdges, localNodes, onFlowChange]);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const raw = e.dataTransfer.getData('application/json');
      if (!raw) return;
      try {
        const payload = JSON.parse(raw) as DragPayload;
        const kind = payload.kind;
        const data = createNodeData(kind, payload as { fieldKey?: string; fieldLabel?: string; tableId?: string; tableName?: string }) as FlowNode['data'] & { resultLabel?: string };
        // 计算节点：自动生成递增的默认结果名，避免多个计算节点默认同名难以区分
        if (kind === 'compute') {
          const computeCount = localNodes.filter((n) => n.kind === 'compute').length;
          data.resultLabel = data.resultLabel || (computeCount === 0 ? '计算结果' : `计算结果 ${computeCount + 1}`);
        }
        const position = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
        const nd: FlowNode = { id: uid('node'), kind, data, position };
        const ns = [...localNodes, nd];
        // 不再默认连线：新节点落画布后由用户手动从端点拖出连线
        setLocalNodes(ns);
        setLocalEdges(localEdges);
        onFlowChange(ns, localEdges);
      } catch {
        /* ignore */
      }
    },
    [localNodes, localEdges, rf, onFlowChange]
  );

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const handleDeleteNode = useCallback(
    (_: unknown, node: RFNode) => {
      const ns = localNodes.filter((n) => n.id !== node.id);
      const es = localEdges.filter((e) => e.source !== node.id && e.target !== node.id);
      setLocalNodes(ns);
      setLocalEdges(es);
      onFlowChange(ns, es);
    },
    [localNodes, localEdges, onFlowChange]
  );

  const rfNodes = useMemo(() => toRfNodes(localNodes), [localNodes]);
  const rfEdges = useMemo(() => toRfEdges(localEdges), [localEdges]);

  return (
    <div
      className="h-full w-full"
      onDrop={onDrop}
      onDragOver={onDragOver}
    >
      {selectedEdge && (
        <div
          className="absolute left-1/2 top-3 z-20 flex -translate-x-1/2 items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-1.5 shadow-lg"
        >
          <span className="text-xs text-gray-500">已选中一条连线</span>
          <button
            type="button"
            onClick={deleteSelectedEdge}
            className="inline-flex items-center gap-1 rounded-md bg-rose-500 px-2.5 py-1 text-xs font-medium text-white hover:bg-rose-600"
          >
            <Trash2 className="h-3.5 w-3.5" /> 删除该连线
          </button>
        </div>
      )}
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onEdgeClick={(_, e) => setSelectedEdge(e.id)}
        onPaneClick={() => setSelectedEdge(null)}
        onConnect={onConnect}
        onReconnect={onReconnect}
        onReconnectStart={() => setSelectedEdge(null)}
        onNodeDragStop={onNodeDragStop}
        onNodeContextMenu={handleDeleteNode}
        connectionMode={ConnectionMode.Loose}
        defaultEdgeOptions={{ type: 'default', reconnectable: true }}
        elevateEdgesOnSelect
        deleteKeyCode={['Backspace', 'Delete']}
        minZoom={0.3}
        maxZoom={1.8}
        fitView
        fitViewOptions={{ padding: 0.25 }}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#E5E7EB" gap={20} size={1.4} />
        <Controls showInteractive={false} />
        <MiniMap
          pannable
          zoomable
          nodeColor={(n) => KIND_COLOR[n.type as FlowNode['kind']]?.dot ?? '#94A3B8'}
          style={{ width: 140, height: 90 }}
        />
      </ReactFlow>
    </div>
  );
}

// ---------- 空态引导 ----------
// ---------- 对外组件 ----------
export function FlowEditor({
  nodes,
  edges,
  onChange,
  schedule,
  targets,
  onSchedule,
  onTargets,
}: {
  nodes: FlowNode[];
  edges: FlowEdge[];
  onChange: (nodes: FlowNode[], edges: FlowEdge[]) => void;
  schedule: Schedule;
  targets: TargetSetting;
  onSchedule: (s: Schedule) => void;
  onTargets: (t: TargetSetting) => void;
}) {
  const ctx = useMemo(
    () => ({ schedule, targets, setSchedule: onSchedule, setTargets: onTargets }),
    [schedule, targets, onSchedule, onTargets]
  );

  return (
    <ReactFlowProvider>
      <NodePreviewProvider>
        <BuildCtx.Provider value={ctx}>
        <div className="relative h-full w-full">
          <CanvasInner nodes={nodes} edges={edges} onFlowChange={onChange} />
          {nodes.length === 0 && (
            <div className="pointer-events-none absolute inset-0 z-0 flex items-center justify-center">
              <div className="text-sm text-gray-400">从左侧拖拽流程节点到画布，开始构建预警规则</div>
            </div>
          )}
        </div>
        </BuildCtx.Provider>
      </NodePreviewProvider>
    </ReactFlowProvider>
  );
}

// ---------- 拖拽组件库面板 ----------
const draggable = (payload: DragPayload) => ({
  draggable: true,
  onDragStart: (e: React.DragEvent) => {
    e.dataTransfer.setData('application/json', JSON.stringify(payload));
    e.dataTransfer.effectAllowed = 'move';
  },
});

interface PaletteItem {
  kind: FlowNode['kind'];
  label: string;
  desc?: string;
  payload: Record<string, unknown>;
  color: string;
  dot: string;
}

export function PalettePanel({
  selectedTableIds = [],
  onToggleTable,
}: {
  selectedTableIds?: string[];
  onToggleTable?: (id: string) => void;
}) {
  const { state } = useStore();
  const [showAdd, setShowAdd] = useState(false);
  // 仅展示规则已选择的数据表，其余通过「添加数据表」展开加入
  const selected = state.tables.filter((t) => selectedTableIds.includes(t.id));
  const candidates = state.tables.filter((t) => !selectedTableIds.includes(t.id));

  const flowItems: PaletteItem[] = [
    { kind: 'trigger', label: '开始', desc: '规则入口', payload: { kind: 'trigger' }, color: KIND_COLOR.trigger.border, dot: KIND_COLOR.trigger.dot },
    { kind: 'condition', label: '判断', desc: '比较·阈值·持续', payload: { kind: 'condition' }, color: KIND_COLOR.condition.border, dot: KIND_COLOR.condition.dot },
    { kind: 'logic', label: '逻辑·如果/且/或', desc: '条件串联关联', payload: { kind: 'logic' }, color: KIND_COLOR.logic.border, dot: KIND_COLOR.logic.dot },
    { kind: 'compute', label: '计算', desc: '聚合 + 结果对比', payload: { kind: 'compute' }, color: KIND_COLOR.compute.border, dot: KIND_COLOR.compute.dot },
    { kind: 'base', label: '基础数据', desc: '取一列去重值·如全部店仓', payload: { kind: 'base' }, color: KIND_COLOR.base.border, dot: KIND_COLOR.base.dot },
    { kind: 'topn', label: '排名取数', desc: '分组排序·取前N名', payload: { kind: 'topn' }, color: KIND_COLOR.topn.border, dot: KIND_COLOR.topn.dot },
    { kind: 'lookup', label: '查找', desc: '跨表匹配·字段/聚合带回', payload: { kind: 'lookup' }, color: KIND_COLOR.lookup.border, dot: KIND_COLOR.lookup.dot },
    { kind: 'diff', label: '反匹配排查', desc: '找出无匹配记录的行', payload: { kind: 'diff' }, color: KIND_COLOR.diff.border, dot: KIND_COLOR.diff.dot },
    { kind: 'groupby', label: '分组聚合', desc: '按维度汇总指标', payload: { kind: 'groupby' }, color: KIND_COLOR.groupby.border, dot: KIND_COLOR.groupby.dot },
    { kind: 'baseline', label: '基准统计', desc: '序列求平均/中位等', payload: { kind: 'baseline' }, color: KIND_COLOR.baseline.border, dot: KIND_COLOR.baseline.dot },
    { kind: 'rank', label: '排名', desc: '按列升/降序排名·TOP分档', payload: { kind: 'rank' }, color: KIND_COLOR.rank.border, dot: KIND_COLOR.rank.dot },
    { kind: 'filljoin', label: '左关联补全', desc: '全集补零·缺失填充', payload: { kind: 'filljoin' }, color: KIND_COLOR.filljoin.border, dot: KIND_COLOR.filljoin.dot },
    { kind: 'filter', label: '数据过滤', desc: '多条件·搜索多选', payload: { kind: 'filter' }, color: KIND_COLOR.filter.border, dot: KIND_COLOR.filter.dot },
    { kind: 'relation', label: '关联', desc: '联表', payload: { kind: 'relation' }, color: KIND_COLOR.relation.border, dot: KIND_COLOR.relation.dot },
    { kind: 'time', label: '时间窗口', desc: '今天/本周/本月…', payload: { kind: 'time' }, color: KIND_COLOR.time.border, dot: KIND_COLOR.time.dot },
    { kind: 'elapsed', label: '已过天数', desc: '本周/月/季/年/区间已过天数', payload: { kind: 'elapsed' }, color: KIND_COLOR.elapsed.border, dot: KIND_COLOR.elapsed.dot },
    { kind: 'calc', label: '添加列', desc: '公式计算追加新列·IF/拼接/日期差', payload: { kind: 'calc' }, color: KIND_COLOR.calc.border, dot: KIND_COLOR.calc.dot },
    { kind: 'action', label: '预警动作', desc: '终点·通知', payload: { kind: 'action' }, color: KIND_COLOR.action.border, dot: KIND_COLOR.action.dot },
    { kind: 'linkanalysis', label: '关联分析', desc: '选表·配置款色/店仓/销量列，预警详情做关联洞察', payload: { kind: 'linkanalysis' }, color: KIND_COLOR.linkanalysis.border, dot: KIND_COLOR.linkanalysis.dot },
  ];

  // 按功能分组（kinds 引用 flowItems），便于直观选择
  const NODE_GROUPS: { title: string; kinds: FlowNode['kind'][] }[] = [
    { title: '数据与窗口', kinds: ['trigger', 'base', 'relation', 'lookup', 'time', 'elapsed'] },
    { title: '筛选与排名', kinds: ['topn', 'rank', 'filter', 'diff', 'filljoin'] },
    { title: '计算与统计', kinds: ['compute', 'groupby', 'baseline', 'calc'] },
    { title: '条件与输出', kinds: ['condition', 'logic', 'action', 'linkanalysis'] },
  ];

  const NODE_ICON: Record<string, ComponentType<{ size?: number; className?: string; style?: CSSProperties }>> = {
    trigger: Play,
    base: Database,
    relation: Link,
    lookup: Search,
    time: CalendarDays,
    elapsed: Hourglass,
    topn: TrendingUp,
    rank: ListOrdered,
    filter: Filter,
    diff: GitCompareArrows,
    filljoin: Combine,
    compute: Calculator,
    groupby: Layers,
    baseline: BarChart3,
    condition: GitBranch,
    logic: Waypoints,
    action: Bell,
    linkanalysis: BarChart3,
  };
  const flowByKind = new Map(flowItems.map((it) => [it.kind, it]));

  return (
    <div className="w-60 shrink-0 overflow-y-auto border-r bg-white p-3">
      {/* 规则使用数据表：仅显示已选，可通过「添加数据表」加入 */}
      <div className="mb-4">
        <div className="mb-1.5 flex items-center justify-between text-xs font-semibold text-gray-600">
          <span>规则使用数据表</span>
          <span className="rounded bg-gray-100 px-1.5 text-[10px] text-gray-500">{selectedTableIds.length} 张</span>
        </div>
        {state.tables.length === 0 && (
          <div className="rounded-md border border-dashed p-2 text-[11px] leading-relaxed text-gray-400">
            暂无数据表，请先到「数据表管理」上传。
          </div>
        )}
        {selected.length === 0 && state.tables.length > 0 && (
          <div className="mb-1.5 rounded-md border border-dashed p-2 text-[11px] leading-relaxed text-gray-400">
            尚未选择数据表，点击下方「添加数据表」加入。
          </div>
        )}
        <div className="space-y-1">
          {selected.map((t) => (
            <div
              key={t.id}
              className="flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-2 py-1.5"
            >
              <Table2 size={13} className="text-blue-600" />
              <span className="truncate text-xs font-medium text-blue-700">{t.name}</span>
              <span className="ml-auto text-[10px] text-gray-400">{t.fields.length} 字段</span>
              {onToggleTable && (
                <button
                  onClick={() => onToggleTable?.(t.id)}
                  className="text-gray-400 transition hover:text-red-500"
                  title="移除该数据表"
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
        <button
          onClick={() => setShowAdd((v) => !v)}
          className="mt-2 flex w-full items-center justify-center gap-1 rounded-lg border border-dashed border-gray-300 px-2 py-1.5 text-xs text-gray-600 transition hover:border-blue-300 hover:text-blue-600"
        >
          {showAdd ? '收起' : '＋ 添加数据表'}
        </button>
        {showAdd && (
          <div className="mt-1 space-y-1">
            {candidates.length === 0 && <div className="text-[11px] text-gray-400">没有更多可添加的数据表。</div>}
            {candidates.map((t) => (
              <label
                key={t.id}
                className="flex cursor-pointer items-center gap-2 rounded-lg border border-gray-100 px-2 py-1.5 transition hover:bg-gray-50"
              >
                <input
                  type="checkbox"
                  checked={false}
                  onChange={() => onToggleTable?.(t.id)}
                  className="h-3.5 w-3.5 accent-blue-600"
                />
                <Table2 size={13} className="text-gray-400" />
                <span className="truncate text-xs text-gray-700">{t.name}</span>
                <span className="ml-auto text-[10px] text-gray-400">{t.fields.length} 字段</span>
              </label>
            ))}
          </div>
        )}
        </div>

      <div className="mb-1.5 text-xs font-semibold text-gray-600">流程节点</div>
      <div className="space-y-3">
        {NODE_GROUPS.map((g) => (
          <div key={g.title}>
            <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-gray-500">
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: flowByKind.get(g.kinds[0])?.dot ?? '#94A3B8' }}
              />
              {g.title}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {g.kinds.map((kind) => {
                const it = flowByKind.get(kind);
                if (!it) return null;
                const Icon = NODE_ICON[kind];
                return (
                  <div
                    key={it.kind}
                    {...draggable(it.payload as DragPayload)}
                    className="group flex cursor-grab items-center gap-1.5 rounded-lg border bg-white px-2.5 py-1.5 text-xs text-gray-700 shadow-sm transition hover:-translate-y-px hover:shadow-md active:cursor-grabbing"
                    style={{ borderColor: it.color }}
                    title={it.desc}
                  >
                    {Icon ? (
                      <Icon size={13} className="shrink-0" style={{ color: it.dot }} />
                    ) : (
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: it.dot }} />
                    )}
                    {it.label}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}