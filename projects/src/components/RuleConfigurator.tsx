'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Save, Rocket, Table2, Folder, Plus, Trash2 } from 'lucide-react';

const STEPS = [
  { key: 'flow', label: '流程搭建' },
  { key: 'schedule', label: '调度与通知' },
  { key: 'confirm', label: '确认激活' },
];

const LEVEL_META: Record<string, { label: string; bar: string }> = {
  info: { label: '提醒', bar: 'bg-blue-500' },
  warn: { label: '预警', bar: 'bg-amber-500' },
  critical: { label: '紧急', bar: 'bg-red-500' },
};

type ActionNodeDataLike = {
  title?: string;
  level?: string;
  type?: string;
  priority?: string;
  notify?: { departments?: string[]; personnel?: string[] };
};

const fmtList = (arr?: string[]) => (arr && arr.length ? arr.join('、') : '未配置');

const fmtSchedule = (s?: { repeatType?: string; timeOfDay?: string; nextTriggerAt?: string }) => {
  if (!s) return '未配置';
  const m = s.repeatType;
  const time = s.timeOfDay || '--:--';
  const labels: Record<string, string> = {
    once: '仅执行一次',
    daily: '每日',
    weekly: '每周',
    monthly: '每月',
    custom: '自定义间隔',
  };
  return `${labels[m ?? 'once'] ?? m} ${time}${s.nextTriggerAt ? ` · ${s.nextTriggerAt} 触发` : ''}`;
};
import type { AlertRule, DataTable, FlowEdge, FlowNode, RuleGroup } from '@/lib/types';
import { uid } from '@/lib/types';
import { useStore, makeDefaultRule, createPendingExecution, computeNextTrigger, buildAlertsForRule, validateRuleTimeout } from '@/lib/store';
import { PalettePanel, FlowEditor } from './flow/FlowCanvas';
import { toast } from 'sonner';

function collectTargets(
  nodes: FlowNode[]
): { departments: string[]; personnel: string[]; storeMode: boolean } {
  const departments: string[] = [];
  const personnel: string[] = [];
  let storeMode = false;
  for (const n of nodes) {
    if (n.kind === 'action') {
      const notify = (n.data as { notify?: { mode?: string; departments?: string[]; personnel?: string[] } } | undefined)
        ?.notify;
      if (notify) {
        if (notify.mode === 'store') storeMode = true;
        departments.push(...(notify.departments ?? []));
        personnel.push(...(notify.personnel ?? []));
      }
    }
  }
  return { departments: Array.from(new Set(departments)), personnel: Array.from(new Set(personnel)), storeMode };
}

export function RuleConfigurator({
  draft,
  onBack,
  meName = '',
}: {
  draft: AlertRule;
  onBack: () => void;
  meName?: string;
}) {
  const { state, addRule, setBuilderTables, addAlert, updateAlertStatus, addRuleGroup, removeRuleGroup } = useStore();
  const [rule, setRule] = useState<AlertRule>(draft);
  const [, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const finalTargets = useMemo(() => collectTargets(rule.flow.nodes), [rule.flow.nodes]);
  const hasTargets = finalTargets.storeMode || finalTargets.departments.length > 0 || finalTargets.personnel.length > 0;
  const hasFlow = rule.flow.nodes.length > 0;
  const hasAction = rule.flow.nodes.some((n) => n.kind === 'action');
  // 分步向导：0 流程搭建 / 1 调度与通知 / 2 确认激活
  const [step, setStep] = useState(0);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [groupName, setGroupName] = useState('');

  const set = (patch: Partial<AlertRule>) => {
    setRule((r) => ({ ...r, ...patch }));
    setSaved(false);
  };
  const setFlow = (nodes: FlowNode[], edges: FlowEdge[]) => set({ flow: { nodes, edges } });
  const setSchedule = (schedule: AlertRule['schedule']) => set({ schedule });
  const setTargets = (targets: AlertRule['targets']) => set({ targets });

  // 把规则的所选表注入构建上下文（供画布节点与字段面板读取）
  useEffect(() => {
    setBuilderTables(rule.tableIds);
  }, [rule.tableIds, setBuilderTables]);

  const toggleTable = (id: string) => {
    const has = rule.tableIds.includes(id);
    const next = has ? rule.tableIds.filter((x) => x !== id) : [...rule.tableIds, id];
    set({ tableIds: next });
  };

  const persist = (mode: 'save' | 'activate') => {
    const r = rule;
    if (saving) return; // 防双击/重复提交
    try {
      if (mode === 'activate') {
        if (r.tableIds.length === 0) {
          toast.error('请先添加至少一张数据表');
          return;
        }
        if (!hasFlow || !hasAction) {
          toast.error('规则画布需至少包含一个「预警动作」节点');
          return;
        }
        if (!hasTargets) {
          toast.error('请至少选择通知部门或人员');
          return;
        }
        const tErr = validateRuleTimeout(r);
        if (tErr) {
          toast.error(tErr);
          return;
        }
      }
      if (!r.name.trim()) {
        toast.error('请填写规则名称');
        return;
      }

      setSaving(true);
      const exists = state.rules.some((x) => x.id === r.id);
      const final: AlertRule = {
        ...r,
        name: r.name.trim(),
        createdBy: !r.createdBy && meName ? meName : r.createdBy,
        targets: finalTargets,
        status: mode === 'activate' ? 'active' : exists ? r.status : 'draft',
        executions:
          mode === 'activate' && r.executions.length === 0
            ? [createPendingExecution(r.id, computeNextTrigger(r.schedule))]
            : r.executions,
      };
      // 幂等保存：同 id 已存在则覆盖（addRule 内部按 id 去重），避免双击产生多条
      addRule(final);
      // 激活时按配置的预警动作生成/刷新预警到预警列表：
      // 同规则同级别已有“待处理/处理中”预警则刷新其标题/描述/判断/预览（保证旧数据也能补齐），否则新增；避免重复点击翻倍。
      if (final.status === 'active') {
        const existing = state.alerts ?? [];
        buildAlertsForRule(final, state.tables, { stores: state.stores ?? [], employees: state.employees ?? [], persons: state.persons ?? [] }).forEach((a) => {
          const hit = existing.find(
            (x) =>
              x.ruleId === a.ruleId &&
              x.level === a.level &&
              (x.status === 'new' || x.status === 'processing')
          );
          if (hit) {
            updateAlertStatus(hit.id, {
              title: a.title,
              content: a.content,
              reason: a.reason,
              conditionDesc: a.conditionDesc,
              preview: a.preview,
              ruleName: a.ruleName,
            });
          } else {
            addAlert(a);
          }
        });
      }
      setSaved(true);
      toast.success(mode === 'activate' ? (exists ? '规则已激活' : '规则已创建并激活') : '规则已保存');
      setTimeout(() => setSaving(false), 600);
    } catch (err) {
      console.error('保存规则失败', err);
      setSaving(false);
      toast.error('保存失败，请检查规则配置后重试');
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* 顶栏 */}
      <div className="flex flex-wrap items-center gap-2 border-b bg-white px-4 py-2.5">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm text-gray-500 hover:bg-gray-100"
        >
          <ArrowLeft size={16} /> 返回
        </button>
        <div className="mx-1 h-5 w-px bg-gray-200" />
        <input
          value={rule.name}
          onChange={(e) => set({ name: e.target.value })}
          className="w-64 truncate rounded-md border border-transparent px-2 py-1 text-base font-semibold text-gray-800 outline-none focus:border-blue-300"
          placeholder="未命名规则（点击命名）"
        />
        <div className="mx-0.5 hidden h-5 w-px bg-gray-200 md:block" />
        {/* 标题右侧：规则分组（可新建 / 删除） */}
        <div className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-gray-50/70 px-2 py-1 text-xs font-medium text-gray-600">
          <Folder size={14} className="shrink-0 text-gray-400" />
          <select
            value={rule.groupId ?? ''}
            onChange={(e) => set({ groupId: e.target.value })}
            className="bg-transparent pr-1 text-xs font-medium text-gray-700 outline-none"
          >
            <option value="">未分组</option>
            {state.ruleGroups.map((g) => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </select>
          {creatingGroup ? (
            <input
              autoFocus
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const g = addRuleGroup(groupName);
                  if (g) { set({ groupId: g.id }); setGroupName(''); setCreatingGroup(false); }
                }
                if (e.key === 'Escape') { setCreatingGroup(false); setGroupName(''); }
              }}
              placeholder="新分组名，回车确认"
              className="w-28 rounded border border-emerald-300 bg-white px-1.5 py-0.5 text-xs text-gray-700 outline-none"
            />
          ) : (
            <button
              type="button"
              onClick={() => setCreatingGroup(true)}
              title="新建分组"
              className="shrink-0 rounded px-1 text-gray-500 transition hover:bg-gray-200 hover:text-emerald-600"
            >
              <Plus size={13} />
            </button>
          )}
          {rule.groupId && (
            <button
              type="button"
              onClick={() => {
                const gid = rule.groupId;
                if (!gid) return;
                const gName = state.ruleGroups.find((g) => g.id === gid)?.name ?? '';
                if (window.confirm(`删除分组「${gName}」？其中的规则将归入未分组。`)) {
                  removeRuleGroup(gid);
                  set({ groupId: '' });
                }
              }}
              title="删除当前分组"
              className="shrink-0 rounded px-1 text-gray-400 transition hover:bg-gray-200 hover:text-red-500"
            >
              <Trash2 size={13} />
            </button>
          )}
        </div>
        <div className="ml-auto flex items-center gap-3">
          <div className="flex shrink-0 items-center gap-0.5">
          {STEPS.map((s, i) => {
            const done = i < step;
            const cur = i === step;
            return (
              <button
                key={s.key}
                onClick={() => {
                  persist('save');
                  setStep(Math.max(0, Math.min(i, STEPS.length - 1)));
                }}
                title={s.label}
                className="group flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium"
              >
                <span
                  className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] ${
                    done
                      ? 'bg-blue-600 text-white'
                      : cur
                        ? 'bg-white text-blue-600 ring-1 ring-blue-500'
                        : 'bg-gray-100 text-gray-400'
                  }`}
                >
                  {i + 1}
                </span>
                <span className={cur ? 'text-blue-600' : done ? 'text-gray-600' : 'text-gray-400'}>{s.label}</span>
              </button>
            );
          })}
          </div>
          <div className="flex items-center gap-2">
          <button
            onClick={() => persist('save')}
            disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Save size={15} /> {saving ? '保存中…' : '保存草稿'}
          </button>
          <button
            onClick={() => persist('activate')}
            disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Rocket size={15} /> {saving ? '提交中…' : '激活规则'}
          </button>
        </div>
        </div>
      </div>

      {/* 主体：按步骤切换 */}
      {step === 0 && (
        <div className="flex min-h-0 flex-1">
          <PalettePanel selectedTableIds={rule.tableIds} onToggleTable={toggleTable} />
          <div className="relative min-w-0 flex-1 bg-[#F7F8FA]">
            <FlowEditor
              nodes={rule.flow.nodes}
              edges={rule.flow.edges}
              onChange={setFlow}
              schedule={rule.schedule}
              targets={rule.targets}
              onSchedule={setSchedule}
              onTargets={setTargets}
            />
          </div>
        </div>
      )}

      {step === 1 && (
        <div className="min-h-0 flex-1 overflow-auto bg-[#F7F8FA] p-6">
          <div className="mx-auto max-w-2xl space-y-4">
            <div className="rounded-xl border bg-white p-4 shadow-sm">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-700">触发调度</h3>
                <button onClick={() => setStep(0)} className="text-xs text-blue-600 hover:underline">
                  去画布调整
                </button>
              </div>
              <div className="rounded-lg border bg-gray-50 px-3 py-2 text-sm text-gray-600">
                {fmtSchedule(rule.schedule)}
              </div>
            </div>
            <div className="rounded-xl border bg-white p-4 shadow-sm">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-700">预警动作（通知对象）</h3>
                <button onClick={() => setStep(0)} className="text-xs text-blue-600 hover:underline">
                  去画布调整
                </button>
              </div>
              {rule.flow.nodes.filter((n) => n.kind === 'action').length === 0 && (
                <p className="text-sm text-gray-400">尚未添加预警动作节点，回到步骤1从左侧拖入。</p>
              )}
              {rule.flow.nodes
                .filter((n) => n.kind === 'action')
                .map((n) => {
                  const ad = n.data as ActionNodeDataLike;
                  const lv = (ad.type === 'alert'
                    ? ad.priority === 'Important&Urgent' || ad.priority === 'Urgent'
                      ? LEVEL_META.critical ?? LEVEL_META.warn
                      : LEVEL_META.warn
                    : LEVEL_META[ad.level ?? 'warn'] ?? LEVEL_META.warn) ?? LEVEL_META.warn;
                  return (
                    <div key={n.id} className="mb-2 rounded-lg border bg-gray-50 px-3 py-2 text-sm">
                      <div className="flex items-center justify-between">
                        <span
                          className={`inline-flex items-center gap-1.5 rounded-full ${lv.bar} px-2 py-0.5 text-[11px] font-medium text-white`}
                        >
                          {lv.label}
                        </span>
                        <span className="font-medium text-gray-700">{ad.title || '预警通知'}</span>
                      </div>
                      <div className="mt-1 text-xs text-gray-500">
                        通知部门：{fmtList(ad.notify?.departments)} · 通知人员：{fmtList(ad.notify?.personnel)}
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="min-h-0 flex-1 overflow-auto bg-[#F7F8FA] p-6">
          <div className="mx-auto max-w-xl space-y-4">
            <div className="rounded-xl border bg-white p-5 text-center shadow-sm">
              <div className="text-sm font-semibold text-gray-700">
                已完成 {STEPS.length} 个步骤，可以激活规则了
              </div>
              <p className="mt-1 text-xs text-gray-500">激活后将按调度周期，对命中的预警对象发送通知。</p>
              <button
                onClick={() => persist('activate')}
                disabled={saving}
                className="mt-4 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"
              >
                <Rocket size={15} /> {saving ? '提交中…' : '立即激活规则'}
              </button>
            </div>
          </div>
        </div>
      )}

      </div>
  );
}

/** 新建规则的封装：mount 时生成一份全新草稿，key 保证每次进入都是干净的新规则 */
export function NewRule({ onBack, meName = '' }: { onBack: () => void; meName?: string }) {
  const { state, addRuleGroup } = useStore();
  const [draft] = useState<AlertRule>(() => makeDefaultRule());
  const [title, setTitle] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [started, setStarted] = useState(false);
  const [groupId, setGroupId] = useState('');
  const [creating, setCreating] = useState(false);
  const [groupName, setGroupName] = useState('');

  // 未通过引导前：必须先填写标题并选择数据表，才允许进入配置页
  if (!started) {
    return (
      <NewRuleGate
        tables={state.tables}
        title={title}
        setTitle={setTitle}
        selected={selected}
        toggle={(id) =>
          setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
        }
        canStart={title.trim().length > 0 && selected.length > 0}
        onStart={() => setStarted(true)}
        onCancel={onBack}
        groups={state.ruleGroups}
        groupId={groupId}
        setGroupId={setGroupId}
        creating={creating}
        setCreating={setCreating}
        groupName={groupName}
        setGroupName={setGroupName}
        onCreateGroup={(name) => {
          const g = addRuleGroup(name);
          if (g) {
            setGroupId(g.id);
            setGroupName('');
            setCreating(false);
          }
        }}
      />
    );
  }

  const final: AlertRule = { ...draft, name: title.trim(), tableIds: selected, groupId, createdBy: meName || draft.createdBy };
  return <RuleConfigurator key={final.id} draft={final} onBack={onBack} />;
}

/** 新建规则引导：填写标题 + 选择数据表（不默认全选，手动添加） */
function NewRuleGate({
  tables,
  title,
  setTitle,
  selected,
  toggle,
  canStart,
  onStart,
  onCancel,
  groups,
  groupId,
  setGroupId,
  creating,
  setCreating,
  groupName,
  setGroupName,
  onCreateGroup,
}: {
  tables: DataTable[];
  title: string;
  setTitle: (v: string) => void;
  selected: string[];
  toggle: (id: string) => void;
  canStart: boolean;
  onStart: () => void;
  onCancel: () => void;
  groups: RuleGroup[];
  groupId: string;
  setGroupId: (id: string) => void;
  creating: boolean;
  setCreating: (v: boolean) => void;
  groupName: string;
  setGroupName: (v: string) => void;
  onCreateGroup: (name: string) => void;
}) {
  return (
    <div className="flex h-full items-center justify-center bg-[#F7F8FA] p-6">
      <div className="w-full max-w-lg rounded-2xl border bg-white p-6 shadow-sm">
        <div className="mb-1 text-lg font-semibold text-gray-800">创建预警规则</div>
        <div className="mb-5 text-xs text-gray-500">
          请先填写规则标题并选择规则要使用的数据表，完成后即可进入画布配置。
        </div>

        <label className="mb-1.5 block text-xs font-medium text-gray-600">规则标题 <span className="text-red-500">*</span></label>
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && canStart) onStart(); }}
          className="mb-5 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-800 outline-none focus:border-blue-400"
          placeholder="例如：门店未开单天数监控"
        />

        <div className="mb-1.5 block text-xs font-medium text-gray-600">规则分组</div>
        <div className="mb-5 flex items-center gap-2">
          <span className="relative flex-1">
            <Folder
              size={14}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400"
            />
            <select
              value={groupId}
              onChange={(e) => setGroupId(e.target.value)}
              className="w-full appearance-none rounded-lg border border-gray-200 bg-white py-2 pl-8 pr-8 text-sm text-gray-800 outline-none focus:border-blue-400"
            >
              <option value="">未分组</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </span>
          {creating ? (
            <button
              type="button"
              onClick={() => onCreateGroup(groupName.trim())}
              disabled={!groupName.trim()}
              className="shrink-0 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700"
            >
              新建
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="shrink-0 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50"
            >
              + 新建分组
            </button>
          )}
        </div>
        {creating ? (
          <div className="mb-5 -mt-3 flex items-center gap-2 rounded-lg border border-dashed border-emerald-200 bg-emerald-50/60 px-3 py-2.5">
            <span className="text-xs font-medium text-emerald-700">新分组名称</span>
            <input
              autoFocus
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && groupName.trim()) onCreateGroup(groupName.trim()); }}
              placeholder="输入分组名称后点击「新建」"
              className="min-w-0 flex-1 rounded-lg border border-emerald-200 bg-white px-2.5 py-1.5 text-sm text-gray-800 outline-none focus:border-emerald-400"
            />
          </div>
        ) : null}

        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-xs font-medium text-gray-600">
            选择数据表 <span className="text-red-500">*</span>
          </span>
          <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-600">
            已选 {selected.length} 张
          </span>
        </div>

        {tables.length === 0 ? (
          <div className="mb-4 rounded-lg border border-dashed p-4 text-center text-xs text-gray-400">
            暂无数据表，请先到「数据表管理」上传，再回来新建规则。
          </div>
        ) : (
          <div className="field-list-scroll max-h-56 space-y-1.5 overflow-y-auto rounded-lg border p-2">
            {tables.map((t) => {
              const on = selected.includes(t.id);
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => toggle(t.id)}
                  className={`flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition ${
                    on ? 'border-blue-300 bg-blue-50' : 'border-gray-100 bg-white hover:bg-gray-50'
                  }`}
                >
                  <span
                    className={`flex h-4 w-4 items-center justify-center rounded border text-[10px] leading-none ${
                      on ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-300 text-transparent'
                    }`}
                  >
                    ✓
                  </span>
                  <Table2 size={14} className={on ? 'text-blue-600' : 'text-gray-400'} />
                  <span className={`truncate text-sm ${on ? 'font-medium text-blue-700' : 'text-gray-700'}`}>
                    {t.name}
                  </span>
                  <span className="ml-auto shrink-0 text-[10px] text-gray-400">{t.fields.length} 字段</span>
                </button>
              );
            })}
          </div>
        )}

        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-gray-200 bg-white px-4 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-50"
          >
            取消
          </button>
          <button
            onClick={onStart}
            disabled={!canStart}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Rocket size={15} /> 进入配置
          </button>
        </div>
        {!canStart && (
          <div className="mt-2 text-right text-[11px] text-amber-600">
            请先填写标题并至少选择一张数据表
          </div>
        )}
      </div>
    </div>
  );
}