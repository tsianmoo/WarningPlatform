'use client';

import React, { useMemo, useState } from 'react';
import { Plus, Network, Pencil, Trash2, ChevronDown, ChevronRight, User, Crosshair, Mail, Phone, Search } from 'lucide-react';
import type { Organization, Person, ManageScope, HrAttribute } from '@/lib/types';
import { ORG_KIND_OPTIONS } from '@/lib/types';
import { useStore } from '@/lib/store';
import { toast } from 'sonner';

export function HrArch() {
  const { state, addPerson, updatePerson, removePerson, addHrAttribute, updateHrAttribute, removeHrAttribute } = useStore();
  const { orgs, persons, tables, hrAttributes } = state;
  const [activeOrg, setActiveOrg] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ kind: 'create' | 'edit'; orgId: string; person?: Person } | null>(null);
  const [confirmDel, setConfirmDel] = useState<Person | null>(null);

  const orgMap = useMemo(() => new Map(orgs.map((o) => [o.id, o])), [orgs]);
  const sortedOrgs = [...orgs].sort((a, b) => a.sort - b.sort || a.createdAt - b.createdAt);
  const childrenByParent = useMemo(() => {
    const m = new Map<string | undefined, Organization[]>();
    for (const o of sortedOrgs) {
      const key = o.parentId || undefined;
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(o);
    }
    return m;
  }, [sortedOrgs]);
  const rootOrgs = childrenByParent.get(undefined) ?? [];
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  return (
    <div className="flex h-full flex-col overflow-y-auto px-8 pb-10 pt-6">
      <header className="mb-7 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-1.5 text-xs text-gray-400">
            <Network size={13} strokeWidth={1.8} />
            <span>系统管理</span>
            <span>/</span>
            <span className="text-gray-500">人事架构</span>
          </div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-gray-900">人事架构</h1>
          <p className="mt-1 text-sm text-gray-400">人员挂在组织节点下，可设职位 / 上级 / 管理范围</p>
        </div>
        {activeOrg && (
          <button
            onClick={() => setEditing({ kind: 'create', orgId: activeOrg })}
            className="inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-700"
          >
            <Plus size={15} strokeWidth={2.2} />
            新增人员
          </button>
        )}
      </header>

      <div className={`grid gap-6 ${activeOrg ? 'grid-cols-[300px_1fr]' : 'grid-cols-1'}`}>
        {/* 左侧：组织列表 */}
        <div className="rounded-xl border border-gray-200 bg-white p-2">
          <div className="flex items-center gap-1 px-2 py-2 text-xs font-semibold text-gray-400">
            <BuildingIcon />
            组织树（{orgs.length}）
          </div>
          {rootOrgs.length === 0 && (
            <div className="px-2 py-6 text-center text-xs text-gray-400">暂无组织，请先在「组织架构」维护</div>
          )}
          {rootOrgs.map((o) => (
            <OrgTreeNode
              key={o.id}
              org={o}
              depth={0}
              childrenByParent={childrenByParent}
              activeOrg={activeOrg}
              collapsed={collapsed}
              toggle={(id) =>
                setCollapsed((prev) => {
                  const next = new Set(prev);
                  if (next.has(id)) next.delete(id);
                  else next.add(id);
                  return next;
                })
              }
              onSelect={(id) => setActiveOrg((cur) => (cur === id ? null : id))}
            />
          ))}
          <HrAttributesPanel attrs={hrAttributes} onAdd={addHrAttribute} onUpdate={updateHrAttribute} onRemove={removeHrAttribute} />
        </div>

        {/* 右侧：人员列表 */}
        {activeOrg ? (
          <PersonPanel
            org={orgMap.get(activeOrg)}
            persons={persons.filter((p) => p.orgId === activeOrg)}
            allPersons={persons}
            onEdit={(p) => setEditing({ kind: 'edit', orgId: activeOrg, person: p })}
            onDelete={(p) => setConfirmDel(p)}
            onAdd={() => setEditing({ kind: 'create', orgId: activeOrg })}
          />
        ) : (
          <div className="flex h-[320px] flex-col items-center justify-center rounded-xl border border-dashed border-gray-200 text-center text-sm text-gray-400">
            <Network size={28} strokeWidth={1.4} className="mb-3 text-gray-300" />
            选中左侧组织后维护其下人员
          </div>
        )}
      </div>

      {editing && (
        <PersonEditor
          key={editing.person?.id || editing.orgId + 'new'}
          initial={editing.person}
          orgId={editing.orgId}
          org={activeOrg ? orgMap.get(activeOrg) : undefined}
          persons={persons}
          tables={tables}
          onCancel={() => setEditing(null)}
          onSave={(p) => {
            if (editing.person) updatePerson(p);
            else addPerson(p);
            toast.success(editing.person ? '已更新人员' : '已新增人员');
            setEditing(null);
          }}
        />
      )}

      {confirmDel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={() => setConfirmDel(null)}>
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-gray-900">删除人员</h3>
            <p className="mt-2 text-sm text-gray-500">确定删除「{confirmDel.name}」吗？若其存在下级，请先调整。</p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setConfirmDel(null)}
                className="rounded-lg border border-gray-200 px-3.5 py-2 text-sm text-gray-600 hover:bg-gray-50"
              >
                取消
              </button>
              <button
                onClick={() => {
                  removePerson(confirmDel.id);
                  toast.success('已删除人员');
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

function genItemId() {
  return 'itm_' + Math.random().toString(36).slice(2, 10);
}

function HrAttributesPanel({
  attrs,
  onAdd,
  onUpdate,
  onRemove,
}: {
  attrs: HrAttribute[];
  onAdd: (a: Omit<HrAttribute, 'id' | 'createdAt'>) => HrAttribute;
  onUpdate: (a: HrAttribute) => void;
  onRemove: (id: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const sorted = [...attrs].sort((a, b) => a.sort - b.sort || a.createdAt - b.createdAt);

  const addItem = (attr: HrAttribute) => {
    const name = prompt('请输入' + attr.name + '条目名称');
    if (!name?.trim()) return;
    onUpdate({ ...attr, items: [...attr.items, { id: genItemId(), name: name.trim() }] });
  };
  const removeItem = (attr: HrAttribute, id: string) => {
    onUpdate({ ...attr, items: attr.items.filter((i) => i.id !== id) });
  };

  return (
    <div className="mt-2 rounded-xl border border-gray-200 bg-white p-2">
      <div
        className="flex cursor-pointer items-center justify-between px-2 py-2"
        onClick={() => setOpen(!open)}
      >
        <div className="flex items-center gap-1 text-xs font-semibold text-gray-400">
          <span>⊞</span>人事属性（{attrs.length}）
        </div>
        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={() => {
              const n = prompt('请输入属性名称（如：部门管理 / 职位管理 / 岗位管理）');
              if (!n?.trim()) return;
              onAdd({ name: n.trim(), items: [], sort: attrs.length });
            }}
            className="rounded-md border border-gray-200 px-1.5 py-0.5 text-[11px] text-gray-500 hover:bg-gray-50"
          >
            新增属性
          </button>
          <span className="text-gray-300">{open ? '▾' : '▸'}</span>
        </div>
      </div>

      {open &&
        sorted.map((attr) => (
          <div key={attr.id} className="mb-1.5 rounded-lg bg-gray-50 p-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-gray-700">{attr.name}</span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => addItem(attr)}
                  className="rounded border border-gray-200 bg-white px-1.5 py-0.5 text-[11px] text-gray-500 hover:bg-gray-100"
                >
                  + 条目
                </button>
                <button
                  onClick={() => {
                    if (confirm(`确定删除人事属性「${attr.name}」？`)) onRemove(attr.id);
                  }}
                  className="rounded border border-red-100 bg-white px-1.5 py-0.5 text-[11px] text-red-400 hover:bg-red-50"
                >
                  删
                </button>
              </div>
            </div>
            <ul className="mt-1.5 space-y-1">
              {attr.items.map((it) => (
                <li key={it.id} className="flex items-center justify-between rounded bg-white px-2 py-1 text-xs text-gray-600">
                  <span>{it.name}</span>
                  <button
                    onClick={() => removeItem(attr, it.id)}
                    className="text-gray-300 hover:text-red-400"
                    title="删除条目"
                  >
                    ×
                  </button>
                </li>
              ))}
              {attr.items.length === 0 && (
                <li className="px-1 py-0.5 text-[11px] text-gray-300">暂无条目</li>
              )}
            </ul>
          </div>
        ))}

      {open && sorted.length === 0 && <div className="px-2 py-2 text-center text-[11px] text-gray-300">暂无属性，点击「新增属性」</div>}
    </div>
  );
}

function BuildingIcon() {
  return <span className="text-gray-300">⊞</span>;
}

function PersonPanel({
  org,
  persons,
  allPersons,
  onEdit,
  onDelete,
  onAdd,
}: {
  org?: Organization;
  persons: Person[];
  allPersons: Person[];
  onEdit: (p: Person) => void;
  onDelete: (p: Person) => void;
  onAdd: () => void;
}) {
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const byId = useMemo(() => new Map(allPersons.map((p) => [p.id, p])), [allPersons]);
  const subordinates = useMemo(() => {
    const map = new Map<string, Person[]>();
    for (const p of allPersons) {
      if (!p.supervisorId) continue;
      const list = map.get(p.supervisorId) || [];
      list.push(p);
      map.set(p.supervisorId, list);
    }
    return map;
  }, [allPersons]);

  const spacedPersons = persons
    .filter((p) => p.name.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => a.sort - b.sort);
  const roots = spacedPersons.filter((p) => !p.supervisorId);

  const renderNode = (p: Person, depth: number): React.ReactNode => {
    const kids = (subordinates.get(p.id) || []).filter((k) => k.name.toLowerCase().includes(query.toLowerCase()));
    const open = expanded.has(p.id);
    return (
      <div key={p.id}>
        <div
          className="group flex items-center gap-2 rounded-lg border border-gray-100 bg-white px-3 py-2.5"
          style={{ marginLeft: depth * 28 }}
        >
          <button onClick={() => setExpanded((s) => { const n = new Set(s); open ? n.delete(p.id) : n.add(p.id); return n; })}>
            {kids.length > 0 ? (open ? <ChevronDown size={14} className="text-gray-400" /> : <ChevronRight size={14} className="text-gray-400" />) : <span className="w-3.5" />}
          </button>
          <Avatar name={p.name} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-medium text-gray-900">{p.name}</span>
              {p.title && <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500">{p.title}</span>}
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-gray-400">
              {p.supervisorId && byId.get(p.supervisorId) && <span className="flex items-center gap-0.5"><User size={10} />上级 {byId.get(p.supervisorId)!.name}</span>}
              {p.manageScope?.desc && <span className="flex items-center gap-0.5"><Crosshair size={10} />{p.manageScope.desc}</span>}
            </div>
          </div>
          <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
            <button onClick={() => onEdit(p)} className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"><Pencil size={14} /></button>
            <button onClick={() => onDelete(p)} className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-500"><Trash2 size={14} /></button>
          </div>
        </div>
        {open &&
          kids
            .filter((k) => !query || k.name.toLowerCase().includes(query.toLowerCase()))
            .sort((a, b) => a.sort - b.sort)
            .map((k) => renderNode(k, depth + 1))}
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 text-base font-semibold text-gray-900">
          <span className="text-amber-500">▍</span>
          {org?.name}
        </div>
        <div className="relative ml-auto">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索人员"
            className="w-44 rounded-lg border border-gray-200 bg-white py-1.5 pl-8 pr-3 text-xs outline-none focus:border-gray-900"
          />
        </div>
        <button onClick={onAdd} className="inline-flex items-center gap-1 rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-700">
          <Plus size={13} />新增
        </button>
      </div>

      <div className="space-y-1.5">
        {query ? (
          spacedPersons.map((p) => renderNode(p, 0))
        ) : roots.length > 0 ? (
          roots.map((p) => renderNode(p, 0))
        ) : (
          <div className="rounded-lg border border-dashed border-gray-200 py-12 text-center text-sm text-gray-400">
            {spacedPersons.length === 0 ? '该组织暂无人员' : '未找到匹配人员'}
          </div>
        )}
      </div>
    </div>
  );
}

function Avatar({ name }: { name: string }) {
  return (
    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-gray-700 to-gray-900 text-[11px] font-semibold text-white">
      {name.slice(0, 1)}
    </span>
  );
}

function PersonEditor({
  initial,
  orgId,
  org,
  persons,
  tables,
  onCancel,
  onSave,
}: {
  initial?: Person;
  orgId: string;
  org?: Organization;
  persons: Person[];
  tables: { id: string; name: string; columns?: { key: string; name?: string }[] }[];
  onCancel: () => void;
  onSave: (p: Person) => void;
}) {
  const [name, setName] = useState(initial?.name || '');
  const [title, setTitle] = useState(initial?.title || '');
  const [supervisorId, setSupervisorId] = useState(initial?.supervisorId || '');
  const [phone, setPhone] = useState(initial?.phone || '');
  const [email, setEmail] = useState(initial?.email || '');
  const [scopeTable, setScopeTable] = useState(initial?.manageScope?.tableId || '');
  const [scopeField, setScopeField] = useState(initial?.manageScope?.field || '');
  const [scopeValue, setScopeValue] = useState(initial?.manageScope?.value || '');
  const [enabled, setEnabled] = useState(initial ? initial.enabled : true);

  const table = tables.find((t) => t.id === scopeTable);
  // 数据表是否有值枚举，暂手动输入分类值
  const sampleValues = table ? ['华东大区', '华南大区', '总部直营', '河南分公司'] : [];
  const scopeDesc = [scopeField, scopeValue].filter(Boolean).join('=');
  const valid = name.trim().length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
        <h3 className="text-base font-semibold text-gray-900">{initial ? '编辑人员' : '新增人员'} · {org?.name || '未选择组织'}</h3>

        <div className="mt-5 grid grid-cols-1 gap-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-gray-500">姓名 *</label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="人员姓名" autoFocus className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-gray-900" />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-gray-500">职位</label>
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="如 运营经理 / 区域督导" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-gray-900" />
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-gray-500">上级</label>
            <select value={supervisorId} onChange={(e) => setSupervisorId(e.target.value)} className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-gray-900">
              <option value="">（无上级，本组织最高层）</option>
              {persons.filter((p) => p.orgId === orgId && p.id !== initial?.id).map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-gray-500">管理范围（关联数据表字段 / 分类）</label>
            <div className="grid grid-cols-3 gap-2">
              <select value={scopeTable} onChange={(e) => { setScopeTable(e.target.value); setScopeField(''); }} className="rounded-lg border border-gray-300 bg-white px-2 py-2 text-xs outline-none focus:border-gray-900">
                <option value="">数据表</option>
                {tables.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              <select value={scopeField} onChange={(e) => setScopeField(e.target.value)} className="rounded-lg border border-gray-300 bg-white px-2 py-2 text-xs outline-none focus:border-gray-900">
                <option value="">数据表字段</option>
                {(table?.columns || []).map((c) => <option key={c.key} value={c.key}>{c.name || c.key}</option>)}
              </select>
              <input value={scopeValue} onChange={(e) => setScopeValue(e.target.value)} list="scope-values" placeholder="分类值" className="rounded-lg border border-gray-300 px-2 py-2 text-xs outline-none focus:border-gray-900" />
            </div>
            <datalist id="scope-values">
              {sampleValues.map((v) => <option key={v} value={v} />)}
            </datalist>
            {scopeDesc && <p className="mt-1.5 text-[11px] text-gray-400">管理范围：{scopeField} = {scopeValue}</p>}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-gray-500">手机</label>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="联系电话" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-gray-900" />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-gray-500">邮箱</label>
              <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="邮箱" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-gray-900" />
            </div>
          </div>

          <div className="flex items-center justify-between">
            <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-600">
              <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="accent-gray-900" />
              启用（参与预警通知）
            </label>
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button onClick={onCancel} className="rounded-lg border border-gray-200 px-3.5 py-2 text-sm text-gray-600 hover:bg-gray-50">取消</button>
          <button
            disabled={!valid}
            onClick={() =>
              onSave({
                id: initial?.id || 'p_' + Math.random().toString(36).slice(2, 10),
                name: name.trim(),
                orgId,
                title: title.trim() || undefined,
                supervisorId: supervisorId || undefined,
                manageScope: scopeField && scopeValue ? { tableId: scopeTable, field: scopeField, value: scopeValue, desc: `${scopeField} = ${scopeValue}` } : initial?.manageScope,
                phone: phone.trim() || undefined,
                email: email.trim() || undefined,
                enabled,
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
    </div>
  );
}

function OrgTreeNode({
  org,
  depth,
  childrenByParent,
  activeOrg,
  collapsed,
  toggle,
  onSelect,
}: {
  org: Organization;
  depth: number;
  childrenByParent: Map<string | undefined, Organization[]>;
  activeOrg: string | null;
  collapsed: Set<string>;
  toggle: (id: string) => void;
  onSelect: (id: string) => void;
}) {
  const kids = childrenByParent.get(org.id) ?? [];
  const hasKids = kids.length > 0;
  const isCollapsed = collapsed.has(org.id);
  return (
    <div>
      <button
        onClick={() => onSelect(org.id)}
        className={`flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
          activeOrg === org.id ? 'bg-gray-900 text-white' : 'text-gray-700 hover:bg-gray-100'
        }`}
        style={{ paddingLeft: 8 + depth * 14 }}
      >
        {hasKids ? (
          <span
            onClick={(e) => {
              e.stopPropagation();
              toggle(org.id);
            }}
            className="flex h-4 w-4 items-center justify-center rounded text-gray-400 hover:bg-gray-200"
          >
            {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
          </span>
        ) : (
          <span className="w-4" />
        )}
        <span className="truncate">{org.name}</span>
        <span className="ml-auto text-[10px] text-gray-400">{org.kind}</span>
      </button>
      {hasKids && !isCollapsed && (
        <div>
          {kids.map((k) => (
            <OrgTreeNode
              key={k.id}
              org={k}
              depth={depth + 1}
              childrenByParent={childrenByParent}
              activeOrg={activeOrg}
              collapsed={collapsed}
              toggle={toggle}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}