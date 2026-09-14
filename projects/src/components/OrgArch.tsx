'use client';

import React, { useState } from 'react';
import { Plus, Building2, Pencil, Trash2, Users } from 'lucide-react';
import { ORG_KIND_OPTIONS, type Organization } from '@/lib/types';
import { useStore } from '@/lib/store';
import { toast } from 'sonner';

const KIND_CLS: Record<string, string> = {
  总部: 'bg-indigo-50 text-indigo-600',
  分公司: 'bg-sky-50 text-sky-600',
  部门: 'bg-emerald-50 text-emerald-600',
  门店: 'bg-amber-50 text-amber-600',
  区域: 'bg-violet-50 text-violet-600',
  其他: 'bg-gray-100 text-gray-500',
};

export function OrgArch() {
  const { state, addOrg, updateOrg, removeOrg } = useStore();
  const { orgs, persons } = state;
  const [editing, setEditing] = useState<Organization | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmDel, setConfirmDel] = useState<Organization | null>(null);

  const personCount = (orgId: string) => persons.filter((p) => p.orgId === orgId).length;
  const sorted = [...orgs].sort((a, b) => a.sort - b.sort || a.createdAt - b.createdAt);

  return (
    <div className="flex h-full flex-col overflow-y-auto px-8 pb-10 pt-6">
      <header className="mb-7 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-1.5 text-xs text-gray-400">
            <Building2 size={13} strokeWidth={1.8} />
            <span>系统管理</span>
            <span>/</span>
            <span className="text-gray-500">组织架构</span>
          </div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-gray-900">组织架构</h1>
          <p className="mt-1 text-sm text-gray-400">机构 / 分公司 / 部门等平级分类，供新增人员时选择所属组织</p>
        </div>
        <button
          onClick={() => {
            setCreating(true);
            setEditing(null);
          }}
          className="inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-700"
        >
          <Plus size={15} strokeWidth={2.2} />
          新增组织
        </button>
      </header>

      {(creating || editing) && (
        <OrgEditor
          orgs={orgs}
          initial={editing}
          onCancel={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSave={(o) => {
            if (editing) updateOrg(o);
            else addOrg(o);
            toast.success(editing ? '已更新组织' : '已新增组织');
            setCreating(false);
            setEditing(null);
          }}
        />
      )}

      <div className="flex flex-wrap gap-3">
        {sorted.map((o) => (
          <div
            key={o.id}
            className="group flex w-[240px] flex-col rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md"
          >
            <div className="flex items-start justify-between">
              <span
                className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium ${KIND_CLS[o.kind] || KIND_CLS['其他']}`}
              >
                {o.kind}
              </span>
              <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                <button
                  onClick={() => {
                    setEditing({ ...o });
                    setCreating(false);
                  }}
                  className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                >
                  <Pencil size={14} />
                </button>
                <button
                  onClick={() => setConfirmDel(o)}
                  className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-500"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
            <div className="mt-2 text-[15px] font-semibold text-gray-900">{o.name}</div>
            <div className="mt-3 flex items-center gap-1 text-xs text-gray-400">
              <Users size={12} strokeWidth={1.8} />
              <span>{personCount(o.id)} 名人员</span>
            </div>
          </div>
        ))}
        {sorted.length === 0 && (
          <div className="w-full rounded-xl border border-dashed border-gray-200 py-16 text-center text-sm text-gray-400">
            暂无组织，点击右上角「新增组织」开始维护
          </div>
        )}
      </div>

      {confirmDel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={() => setConfirmDel(null)}>
          <div
            className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold text-gray-900">删除组织</h3>
            <p className="mt-2 text-sm text-gray-500">
              确定删除「{confirmDel.name}」吗？其下 {personCount(confirmDel.id)} 名人员将被解除归属。
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setConfirmDel(null)}
                className="rounded-lg border border-gray-200 px-3.5 py-2 text-sm text-gray-600 hover:bg-gray-50"
              >
                取消
              </button>
              <button
                onClick={() => {
                  removeOrg(confirmDel.id);
                  toast.success('已删除组织');
                  setConfirmDel(null);
                }}
                className="rounded-lg bg-red-500 px-3.5 py-2 text-sm text-white hover:bg-red-600"
              >
                删除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function OrgEditor({
  initial,
  orgs,
  onCancel,
  onSave,
}: {
  initial: Organization | null;
  orgs: Organization[];
  onCancel: () => void;
  onSave: (o: Organization) => void;
}) {
  const [name, setName] = useState(initial?.name || '');
  const [kind, setKind] = useState<string>(initial?.kind || '分公司');
  const [parentId, setParentId] = useState(initial?.parentId || '');
  const valid = name.trim().length > 0;

  return (
    <div className="mb-5 rounded-xl border border-gray-200 bg-gray-50 p-5">
      <h3 className="mb-4 text-sm font-semibold text-gray-800">{initial ? '编辑组织' : '新增组织'}</h3>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-xs font-medium text-gray-500">组织名称 *</label>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="如 总部 / 河南分公司 / 加盟事业部"
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-gray-900"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-gray-500">分类 *</label>
          <div className="flex flex-wrap gap-1.5">
            {ORG_KIND_OPTIONS.map((k) => (
              <button
                key={k.value}
                onClick={() => setKind(k.value)}
                className={`rounded-full px-3 py-1.5 text-xs transition-colors ${
                  kind === k.value ? 'bg-gray-900 text-white' : 'bg-white text-gray-500 border border-gray-200 hover:bg-gray-100'
                }`}
              >
                {k.label}
              </button>
            ))}
          </div>
        </div>
      <div>
          <label className="mb-1.5 block text-xs font-medium text-gray-500">上级组织</label>
          <select
            value={parentId}
            onChange={(e) => setParentId(e.target.value)}
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-gray-900"
          >
            <option value="">（无 / 顶级）</option>
            {orgs
              .filter((o) => o.id !== initial?.id)
              .map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
          </select>
        </div>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <button onClick={onCancel} className="rounded-lg border border-gray-200 bg-white px-3.5 py-2 text-sm text-gray-600 hover:bg-gray-100">
          取消
        </button>
        <button
          disabled={!valid}
          onClick={() =>
            onSave({
              id: initial?.id || 'org_' + Math.random().toString(36).slice(2, 10),
              name: name.trim(),
              kind: kind as Organization['kind'],
              parentId: parentId || undefined,
              sort: initial?.sort ?? Date.now(),
              createdAt: initial?.createdAt ?? Date.now(),
            })
          }
          className="rounded-lg bg-gray-900 px-3.5 py-2 text-sm text-white transition-colors hover:bg-gray-700 disabled:opacity-40"
        >
          保存
        </button>
      </div>
    </div>
  );
}