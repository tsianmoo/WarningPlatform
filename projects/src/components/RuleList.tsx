'use client';

import React, { useState } from 'react';
import { Plus, BellRing, ArrowLeft, Trash2, Users, CalendarClock, Table2, Pencil, PlayCircle, PauseCircle, Copy, Search, Zap, User, ChevronDown } from 'lucide-react';
import type { AlertRule, RuleGroup } from '@/lib/types';
import { useStore, useMyPerm, formatDateTime } from '@/lib/store';
import { canOper } from '@/lib/perm';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';

const RULE_STATUS: Record<AlertRule['status'], { label: string; cls: string }> = {
  draft: { label: '草稿', cls: 'bg-gray-100 text-gray-600' },
  active: { label: '进行中', cls: 'bg-green-50 text-green-600' },
  paused: { label: '已停用', cls: 'bg-amber-50 text-amber-600' },
  ended: { label: '已结束', cls: 'bg-red-50 text-red-500' },
};

export function RuleList({
  onNew,
  onEdit,
}: {
  onNew: () => void;
  onEdit: (id: string) => void;
}) {
  const { state, removeRule, updateRule, addRule, activateRule, addRuleGroup, removeRuleGroup, updateRuleGroup } = useStore();
  const [detailId, setDetailId] = useState<string | null>(null);
  const meName = typeof window !== 'undefined' ? localStorage.getItem('dn_auth') || '' : '';
  // 权限统一由「当前登录账号」解析（管理员全放行，其余按角色严格判定）
  const perm = useMyPerm();
  const can = (op: Parameters<typeof canOper>[2], _rid?: string) => canOper(perm, 'rules', op);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState<string>('all');
  const [statusId, setStatusId] = useState<'all' | AlertRule['status']>('all');
  const [search, setSearch] = useState('');
  const [confirm, setConfirm] = useState<{ kind: 'delete' | 'copy'; rule: AlertRule } | null>(null);
  const [catMgr, setCatMgr] = useState<{ open: boolean; editing: RuleGroup | null; name: string }>({ open: false, editing: null, name: '' });
  const ruleGroups = state.ruleGroups ?? [];

  const doCopy = (r: AlertRule) => {
    const copy = JSON.parse(JSON.stringify(r)) as AlertRule;
    copy.id = 'rule_' + Math.random().toString(36).slice(2, 10) + '_' + Date.now().toString(36);
    copy.name = `${r.name} 副本`;
    copy.status = 'draft';
    copy.executions = [];
    copy.createdAt = Date.now();
    copy.updatedAt = Date.now();
    if (copy.description) copy.description = `${copy.description}（副本）`;
    addRule(copy);
    toast.success('已复制为新规则');
  };

  if (detailId) {
    const rule = state.rules.find((r) => r.id === detailId);
    if (rule) {
      return <RuleDetail rule={rule} onBack={() => setDetailId(null)} onEdit={() => onEdit(rule.id)} />;
    }
  }

  const catOf = (r: AlertRule) => ruleGroups.find((g) => g.id === r.groupId) ?? null;

  const q = search.trim().toLowerCase();
  const visibleRules = state.rules.filter((r) =>
    (categoryId === 'all' || r.groupId === categoryId) &&
    (statusId === 'all' || r.status === statusId) &&
    (!q || r.name.toLowerCase().includes(q) || (r.description ?? '').toLowerCase().includes(q))
  );

  return (
    <div className="flex h-full flex-col overflow-y-auto px-8 pb-10 pt-6">
      <div className="mb-5 flex flex-col gap-2.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              onClick={() => setStatusId('all')}
              className={`rounded-md px-2.5 py-1 text-xs transition ${
                statusId === 'all' ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              全部
            </button>
            {(['draft', 'active', 'paused'] as const).map((s) => (
              <button
                key={s}
                onClick={() => setStatusId(s)}
                className={`rounded-md px-2.5 py-1 text-xs transition ${
                  statusId === s ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {RULE_STATUS[s].label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 focus-within:border-gray-400">
              <Search size={14} className="shrink-0 text-gray-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜索规则…"
                className="w-36 bg-transparent text-sm outline-none placeholder:text-gray-300 sm:w-44"
              />
            </div>
            {can('create') && (
              <button
                onClick={onNew}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-gray-900 px-3.5 py-1.5 text-sm font-medium text-white transition hover:bg-gray-700"
              >
                <Plus size={15} /> 新建规则
              </button>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            onClick={() => setCategoryId('all')}
            className={`rounded-md px-2.5 py-1 text-xs transition ${
              categoryId === 'all' ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            全部分类
          </button>
          {ruleGroups.map((g) => (
            <button
              key={g.id}
              onClick={() => setCategoryId(g.id)}
              className={`rounded-md px-2.5 py-1 text-xs transition ${
                categoryId === g.id ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {g.name}
            </button>
          ))}
          <button
            onClick={() => setCatMgr({ open: true, editing: null, name: '' })}
            className="inline-flex items-center gap-1 rounded-md border border-dashed border-gray-300 px-2.5 py-1 text-xs text-gray-500 transition hover:border-gray-400 hover:text-gray-700"
          >
            <Pencil size={12} /> 管理分类
          </button>
        </div>
      </div>

      {visibleRules.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed bg-white py-20 text-center">
          <BellRing size={44} strokeWidth={1.2} className="text-gray-300" />
          <div className="text-sm text-gray-500">{ruleGroups.length === 0 ? '还没有预警规则' : '该分类下暂无预警规则'}</div>
          {ruleGroups.length === 0 && (
            <button
              onClick={onNew}
              className="rounded-lg bg-blue-50 px-3 py-1.5 text-sm text-blue-600 hover:bg-blue-100"
            >
              立即创建
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {visibleRules.map((r) => {
            const st = RULE_STATUS[r.status];
            const tablesUsed = state.tables.filter((t) => r.tableIds?.includes(t.id));
            const pendingCount = r.executions.filter((e) => e.status === 'pending').length;
            const isOpen = expanded === r.id;
            return (
              <div key={r.id} className="group/card flex flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:border-gray-300 hover:shadow-md">
                <div className="flex flex-1 flex-col p-4">
                  {/* 标题置顶 */}
                  <div className="flex items-start justify-between gap-2">
                    <h3
                      className="min-w-0 flex-1 truncate text-[15px] font-semibold text-gray-800"
                      title={r.name}
                    >
                      {r.name}
                    </h3>
                    <div className="flex shrink-0 items-center gap-0.5">
                      {(r.status === 'active' || r.status === 'paused') && can('run', r.id) && (
                        <button
                          onClick={() => {
                            const next = r.status === 'active' ? 'paused' : 'active';
                            if (next === 'active') activateRule(r.id);
                            else updateRule(r.id, { status: next });
                            toast.success(next === 'paused' ? '已停用，不再生成新预警（已有预警保留）' : '已启用');
                          }}
                          className="rounded-lg p-1.5 text-slate-400 transition hover:bg-amber-50 hover:text-amber-500 active:scale-90"
                          title={r.status === 'active' ? '停用（不再生成新预警）' : '启用'}
                        >
                          {r.status === 'active' ? <PauseCircle size={16} /> : <PlayCircle size={16} />}
                        </button>
                      )}
                      <button
                        onClick={() => setExpanded(isOpen ? null : r.id)}
                        className={`rounded-lg p-1.5 text-slate-400 transition hover:bg-gray-100 hover:text-gray-600 active:scale-90 ${isOpen ? 'rotate-180 text-gray-600' : ''}`}
                        title={isOpen ? '收起详情' : '展开详情'}
                      >
                        <ChevronDown size={16} />
                      </button>
                      {can('create', r.id) && (
                      <button
                        onClick={() => setConfirm({ kind: 'copy', rule: r })}
                        className="rounded-lg p-1.5 text-slate-400 transition hover:bg-blue-50 hover:text-blue-500 active:scale-90"
                        title="复制为新规则"
                      >
                        <Copy size={16} />
                      </button>
                      )}
                      {can('delete', r.id) && (
                      <button
                        onClick={() => setConfirm({ kind: 'delete', rule: r })}
                        className="rounded-lg p-1.5 text-slate-400 transition hover:bg-red-50 hover:text-red-500 active:scale-90"
                        title="删除"
                      >
                        <Trash2 size={16} />
                      </button>
                      )}
                    </div>
                  </div>

                  {/* 状态 / 待处理 / 分类放标题下方 */}
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <span className={`rounded-md px-1.5 py-0.5 text-xs ${st.cls}`}>{st.label}</span>
                    {pendingCount > 0 && r.status === 'active' && (
                      <span className="rounded-md bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-600">
                        {pendingCount} 项待处理
                      </span>
                    )}
                    {(() => { const g = catOf(r); return g ? (
                      <span className="rounded-md bg-indigo-50 px-1.5 py-0.5 text-xs text-indigo-600">{g.name}</span>
                    ) : null; })()}{' '}
                    <span
                      className={`ml-auto inline-flex items-center justify-center rounded-full px-1.5 py-0.5 text-[11px] ${
                        r.status === 'active'
                          ? r.executions.length > 0
                            ? 'bg-emerald-50 text-emerald-500'
                            : 'bg-slate-100 text-slate-400'
                          : 'bg-slate-50 text-slate-300'
                      }`}
                    >
                      {r.executions.length} 次预警
                    </span>
                  </div>

                  {r.description && <p className="mt-2 line-clamp-2 text-xs text-gray-400">{r.description}</p>}

                  {/* 触发规则，注明清楚 */}
                  <div className="mt-3 rounded-lg border border-amber-100 bg-amber-50/50 px-2.5 py-2">
                    <div className="flex items-center gap-1.5 text-xs text-gray-600">
                      <Zap size={12} className="shrink-0 text-amber-500" />
                      <span className="shrink-0 text-gray-400">触发规则</span>
                      <span className="truncate font-medium text-gray-700">
                        {scheduleLabel(r.schedule.repeatType, r.schedule)}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
                      <span className="flex min-w-0 items-center gap-1">
                        <Table2 size={12} className="shrink-0 text-blue-400" />
                        <span className="truncate">{tablesUsed.map((t) => t.name).join('、') || '未绑定数据表'}</span>
                      </span>
                      <span className="flex items-center gap-1">
                        <Users size={12} className="text-blue-400" />
                        {r.targets.departments.length} 部门 / {r.targets.personnel.length} 人
                      </span>
                    </div>
                  </div>

                  {/* 创建人 / 创建时间 */}
                  <div className="mt-auto flex items-center justify-between border-t border-dashed border-gray-100 pt-2.5 text-xs text-gray-400">
                    <span className="flex min-w-0 items-center gap-1">
                      <User size={12} className="shrink-0" />
                      <span className="truncate">{r.createdBy || meName || '系统'}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1">
                      <CalendarClock size={12} />
                      {formatDateTime(r.createdAt)}
                    </span>
                  </div>
                </div>

                {isOpen && (
                  <div className="border-t bg-gray-50/60 p-3">
                    <div className="flex gap-2">
                      <button
                        onClick={() => onEdit(r.id)}
                        className="flex-1 rounded-lg bg-blue-600 py-1.5 text-sm text-white hover:bg-blue-700"
                      >
                        编辑 / 配置
                      </button>
                      <button
                        onClick={() => setDetailId(r.id)}
                        className="flex-1 rounded-lg border bg-white py-1.5 text-sm text-gray-600 hover:bg-gray-50"
                      >
                        查看详情
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <AlertDialog open={!!confirm} onOpenChange={(v) => !v && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm?.kind === 'copy' ? '复制预警规则' : '删除预警规则'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.kind === 'copy' ? (
                <>
                  将复制「<span className="font-semibold text-gray-700">{confirm?.rule.name}</span>」为新规则，复制后为草稿状态。
                </>
              ) : (
                <>
                  确定删除「<span className="font-semibold text-gray-700">{confirm?.rule.name}</span>」吗？删除后不可恢复。
                  <br />
                  该规则下已生成的预警需要如何处理？
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setConfirm(null)}>取消</AlertDialogCancel>
            {confirm?.kind === 'copy' ? (
              <AlertDialogAction
                onClick={() => {
                  if (confirm) doCopy(confirm.rule);
                  setConfirm(null);
                }}
              >
                确认复制
              </AlertDialogAction>
            ) : (
              <>
                <AlertDialogAction
                  onClick={() => {
                    if (confirm) {
                      removeRule(confirm.rule.id);
                      toast.success('已删除规则，已生成的预警全部保留');
                    }
                    setConfirm(null);
                  }}
                >
                  仅删规则（保留预警）
                </AlertDialogAction>
                <AlertDialogAction
                  className="bg-red-600 text-white hover:bg-red-700"
                  onClick={() => {
                    if (confirm) {
                      removeRule(confirm.rule.id, true);
                      toast.success('已删除规则并清空其下所有预警');
                    }
                    setConfirm(null);
                  }}
                >
                  删除并清空预警
                </AlertDialogAction>
              </>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={catMgr.open} onOpenChange={(v) => !v && setCatMgr((s) => ({ ...s, open: false, editing: null, name: '' }))}>
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>{catMgr.editing ? '编辑预警分类' : '新增预警分类'}</AlertDialogTitle>
            <AlertDialogDescription>
              预警分类可作为规则分组与筛选标签，区分不同预警场景。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="mb-4 flex items-center gap-2">
            <input
              value={catMgr.name}
              onChange={(e) => setCatMgr((s) => ({ ...s, name: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && catMgr.name.trim()) {
                  if (catMgr.editing) updateRuleGroup(catMgr.editing.id, catMgr.name.trim());
                  else addRuleGroup(catMgr.name.trim());
                  setCatMgr((s) => ({ ...s, name: '', editing: null }));
                  toast.success('已保存预警分类');
                }
              }}
              placeholder="输入分类名称"
              className="flex-1 min-w-0 rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              onClick={() => {
                const name = catMgr.name.trim();
                if (!name) return;
                if (catMgr.editing) updateRuleGroup(catMgr.editing.id, name);
                else addRuleGroup(name);
                setCatMgr((s) => ({ ...s, name: '', editing: null }));
                toast.success('已保存预警分类');
              }}
              disabled={!catMgr.name.trim()}
              className="shrink-0 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              保存
            </button>
          </div>
          <div className="max-h-60 space-y-1 overflow-y-auto">
            {ruleGroups.length === 0 && <p className="py-2 text-center text-sm text-gray-400">暂无预警分类</p>}
            {ruleGroups.map((g) => {
              const cnt = state.rules.filter((r) => r.groupId === g.id).length;
              return (
                <div key={g.id} className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm">
                  <span className="font-medium text-gray-700">{g.name} <span className="text-gray-400">({cnt} 条规则)</span></span>
                  <div className="flex gap-1.5">
                    <button
                      onClick={() => setCatMgr({ open: true, editing: g, name: g.name })}
                      className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-blue-600"
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      onClick={() => {
                        removeRuleGroup(g.id);
                        toast.success(`已删除分类「${g.name}」`);
                      }}
                      className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-red-600"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setCatMgr((s) => ({ ...s, open: false, editing: null, name: '' }))}>关闭</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** 规则详情：摘要 + 调度与通知 */
function RuleDetail({ rule, onBack, onEdit }: { rule: AlertRule; onBack: () => void; onEdit: () => void }) {
  const { state, updateRule, activateRule } = useStore();
  const tablesUsed = state.tables.filter((t) => rule.tableIds?.includes(t.id));
  const st = RULE_STATUS[rule.status];
  const pending = rule.executions.find((e) => e.status === 'pending');

  return (
    <div className="h-full overflow-y-auto">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button onClick={onBack} className="rounded-md p-1.5 text-gray-500 hover:bg-gray-100">
            <ArrowLeft size={18} />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-semibold text-gray-800">{rule.name}</h1>
              <span className={`rounded px-1.5 py-0.5 text-xs ${st.cls}`}>{st.label}</span>
            </div>
            <p className="text-xs text-gray-400">
              {tablesUsed.map((t) => t.name).join('、') || '未绑定表'} · 创建于 {formatDateTime(rule.createdAt)} · 更新于 {formatDateTime(rule.updatedAt)}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          {(rule.status === 'active' || rule.status === 'paused') && (
            <button
              onClick={() => {
                const next = rule.status === 'active' ? 'paused' : 'active';
                if (next === 'active') activateRule(rule.id);
                else updateRule(rule.id, { status: next });
                toast.success(next === 'paused' ? '已停用，不再自动生成新预警（已有预警保留）' : '已启用');
              }}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm ${
                rule.status === 'active'
                  ? 'border-amber-200 text-amber-600 hover:bg-amber-50'
                  : 'border-green-200 text-green-600 hover:bg-green-50'
              }`}
            >
              {rule.status === 'active' ? <PauseCircle size={14} /> : <PlayCircle size={14} />}
              {rule.status === 'active' ? '停用' : '启用'}
            </button>
          )}
          <button
            onClick={onEdit}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700"
          >
            <Pencil size={14} /> 编辑规则
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2">
          {rule.flow.nodes.length > 0 && (
            <div className="mt-4 rounded-xl border bg-white">
              <div className="border-b px-4 py-3 text-sm font-semibold text-gray-800">规则流程（{rule.flow.nodes.length} 节点）</div>
              <div className="flex flex-wrap gap-2 p-4">
                {rule.flow.nodes.map((n) => (
                  <span key={n.id} className="rounded-md border px-2 py-1 text-xs text-gray-600">
                    {nodeLabel(n)}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="space-y-3">
          {rule.schedule && (
            <div className="rounded-xl border bg-white p-4 text-sm">
              <div className="mb-2 text-sm font-semibold text-gray-800">调度</div>
              <div className="space-y-1 text-xs text-gray-500">
                <Row k="重复" v={scheduleLabel(rule.schedule.repeatType, rule.schedule)} />
                <Row k="时刻" v={rule.schedule.timeOfDay} />
                <Row k="开始" v={rule.schedule.startDate} />
                <Row k="结束" v={rule.schedule.endDate || '长期'} />
                <Row k="下次触发" v={pending?.scheduledAt ? formatDateTime(pending.scheduledAt) : (rule.schedule.nextTriggerAt ? formatDateTime(rule.schedule.nextTriggerAt) : '—')} />
              </div>
            </div>
          )}
          <div className="rounded-xl border bg-white p-4 text-sm">
            <div className="mb-2 text-sm font-semibold text-gray-800">通知对象</div>
            <div className="space-y-1 text-xs text-gray-500">
              <Row k="部门" v={rule.targets.departments.join('、') || '—'} />
              <Row k="人员" v={rule.targets.personnel.join('、') || '—'} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="shrink-0 text-gray-400">{k}</span>
      <span className="text-right text-gray-600">{v}</span>
    </div>
  );
}

function nodeLabel(n: AlertRule['flow']['nodes'][number]): string {
  const d = n.data as Record<string, unknown>;
  switch (n.kind) {
    case 'trigger':
      return '开始';
    case 'field':
      return `字段: ${(d.fieldLabel as string) || (d.fieldKey as string)}`;
    case 'condition':
      return `判断: ${(d.fieldLabel as string) || (d.fieldKey as string)} ${(d.operator as string) ?? ''}`;
    case 'compute':
      return `计算: ${(d.fn as string).toUpperCase()}`;
    case 'relation':
      return `关联: ${(d.targetTable as string) || ''}`;
    case 'action':
      return `${(d.level as string) === 'critical' ? '紧急' : (d.level as string) === 'warn' ? '预警' : '提醒'}: ${(d.title as string) || '触发通知'}`;
    default:
      return n.kind;
  }
}

function scheduleLabel(t: AlertRule['schedule']['repeatType'], s: AlertRule['schedule']): string {
  switch (t) {
    case 'once':
      return '仅一次';
    case 'daily':
      return '每日';
    case 'weekly':
      return s.weekdays.length ? `每周 ${s.weekdays.map((w) => `周${w === 7 ? '日' : w}`).join('、')}` : '每周';
    case 'monthly':
      return s.monthDays.length ? `每月 ${s.monthDays.join('、')} 号` : '每月';
    case 'custom':
      return `每 ${s.customInterval} 天`;
    default:
      return t;
  }
}