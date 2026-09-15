'use client';

import { useMemo, useState } from 'react';
import { Users, Phone, Plus, Pencil, Trash2, Crosshair, KeyRound } from 'lucide-react';
import { useStore } from '@/lib/store';
import { resolvePerm, canOper } from '@/lib/perm';
import type { Organization, Person } from '@/lib/types';
import { toast } from 'sonner';

export function PeopleManage() {
  const { state, addPerson, updatePerson, removePerson, addOrg, updateOrg, removeOrg, moveOrg } = useStore();
  const { orgs, persons, hrAttributes } = state;
  const meName = typeof window !== 'undefined' ? localStorage.getItem('dn_auth') || '' : '';
  const me = state.persons.find((p) => p.name === meName) ?? null;
  const perm = resolvePerm(me, state.config);
  const can = (op: Parameters<typeof canOper>[2], _rid?: string) => canOper(perm, 'people', op);
  const [activeOrg, setActiveOrg] = useState<string | null>(null);
  const [editing, setEditing] = useState<Person | null>(null);
  const [showEditor, setShowEditor] = useState(false);
  const [confirmDel, setConfirmDel] = useState<Person | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [orgModal, setOrgModal] = useState<Organization | null>(null);
  const [fName, setFName] = useState('');
  const [fUsername, setFUsername] = useState('');
  const [fPhone, setFPhone] = useState('');
  const [fTitle, setFTitle] = useState('');
  const [fPost, setFPost] = useState('');
  const [fScope, setFScope] = useState('');

  const scopeOptions = useMemo(() => {
    const set = new Set<string>();
    for (const p of persons) if (p.manageScope?.desc) set.add(p.manageScope.desc);
    return [...set];
  }, [persons]);

  const sortedOrgs = [...orgs].sort((a, b) => a.sort - b.sort || a.createdAt - b.createdAt);
  const childrenByParent = useMemo(() => {
    const m = new Map<string | undefined, Organization[]>();
    for (const o of sortedOrgs) {
      const k = o.parentId || undefined;
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(o);
    }
    return m;
  }, [sortedOrgs]);
  const rootOrgs = childrenByParent.get(undefined) ?? [];

  const personAttrs = hrAttributes.filter((a) => (a.category ?? 'person') === 'person');
  const jobLabels = personAttrs.find((a) => a.name.includes('职位'))?.items ?? [];
  const postLabels = personAttrs.find((a) => a.name.includes('岗位'))?.items ?? [];

  const orgList = useMemo(() => {
    const list: Organization[] = [];
    const walk = (parentId?: string) => {
      for (const o of childrenByParent.get(parentId) ?? []) {
        list.push(o);
        walk(o.id);
      }
    };
    walk(undefined);
    return list;
  }, [childrenByParent]);

  const shown = (activeOrg ? persons.filter((p) => p.orgId === activeOrg) : persons).filter(
    (p) =>
      (!fName || p.name.includes(fName.trim())) &&
      (!fUsername || (p.username || '').toLowerCase().includes(fUsername.trim().toLowerCase())) &&
      (!fPhone || (p.phone || '').includes(fPhone.trim())) &&
      (!fTitle || (p.title || '').includes(fTitle.trim())) &&
      (!fPost || (p.post || '').includes(fPost.trim())) &&
      (!fScope || (p.manageScope?.desc || '').includes(fScope))
  );

  const hasFilter = fName || fUsername || fPhone || fTitle || fPost || fScope;

  return (
    <div className="flex h-full flex-col overflow-y-auto px-8 pb-10 pt-6">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-1.5 text-xs text-gray-400">
            <span className="text-gray-500">系统管理</span>
            <span>/</span>
            <span className="text-gray-500">人事管理</span>
            <span>/</span>
            <span>用户管理</span>
          </div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-gray-900">用户管理</h1>
          <p className="mt-1 text-sm text-gray-400">添加人员：选择部门 / 职位 / 岗位，填写基础信息与管理范围</p>
        </div>
        {can('create') && (
        <button
          onClick={() => {
            setEditing(null);
            setShowEditor(true);
          }}
          className="inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-700"
        >
          <Plus size={15} />
          新增人员
        </button>
        )}
      </header>

      <div className="grid gap-6 grid-cols-[280px_1fr]">
        {/* 左侧：部门（组织）列表 */}
        <div className="rounded-xl border border-gray-200 bg-white p-2">
          <div className="flex items-center justify-between px-2 py-2">
            <div className="text-xs font-semibold text-gray-400">部门列表（{orgs.length}）</div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setOrgModal({ id: '__new', name: '', kind: '部门', parentId: undefined, sort: orgs.length, createdAt: 0 })}
                className="rounded-md border border-gray-200 px-1.5 py-0.5 text-[11px] text-gray-500 hover:bg-gray-50"
              >
                + 新增
              </button>
              <button
                onClick={() => setEditMode(!editMode)}
                className={`rounded-md border px-1.5 py-0.5 text-[11px] transition ${editMode ? 'border-blue-200 bg-blue-50 text-blue-600' : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`}
              >
                编辑
              </button>
            </div>
          </div>
          {rootOrgs.length === 0 && <div className="px-2 py-6 text-center text-xs text-gray-400">暂无部门，点击「+ 新增」添加</div>}
          <div className="space-y-0.5">
            {orgList.map((o) => (
              <div
                key={o.id}
                onClick={() => setActiveOrg((cur) => (cur === o.id ? null : o.id))}
                style={{ paddingLeft: `${(o.parentId ? 1 : 0) * 10 + 8}px`, paddingRight: '6px' }}
                className={`flex w-full cursor-pointer items-center gap-1.5 rounded-lg py-1.5 text-left text-xs transition ${
                  activeOrg === o.id ? 'bg-blue-50 font-medium text-blue-700' : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                <span className="text-gray-300">{o.parentId ? '└' : '⊞'}</span>
                <span className="flex-1 truncate">{o.name}</span>
                {editMode ? (
                  <span className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
                    <button onClick={() => moveOrg(o.id, -1)} className="rounded px-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700" title="上移">
                      ↑
                    </button>
                    <button onClick={() => moveOrg(o.id, 1)} className="rounded px-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700" title="下移">
                      ↓
                    </button>
                    <button
                      onClick={() => {
                        setOrgModal(o);
                      }}
                      className="rounded px-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                      title="编辑部门"
                    >
                      ✎
                    </button>
                    <button
                      onClick={() => {
                        if (confirm(`确定删除部门「${o.name}」？`)) {
                          removeOrg(o.id);
                          if (activeOrg === o.id) setActiveOrg(null);
                        }
                      }}
                      className="rounded px-0.5 text-gray-400 hover:bg-red-50 hover:text-red-500"
                      title="删除"
                    >
                      ✕
                    </button>
                  </span>
                ) : (
                  <span className="text-[10px] text-gray-300">{persons.filter((p) => p.orgId === o.id).length}</span>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* 右侧：人员列表 */}
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="mb-3 flex flex-wrap items-end gap-2 rounded-lg border border-gray-100 bg-gray-50/60 p-3">
            <FilterInput label="姓名" value={fName} onChange={setFName} placeholder="搜索姓名" />
            <FilterInput label="账号" value={fUsername} onChange={setFUsername} placeholder="搜索账号" />
            <FilterInput label="电话" value={fPhone} onChange={setFPhone} placeholder="搜索电话" />
            <label className="flex items-center gap-1.5">
              <span className="text-[11px] text-gray-400">职位</span>
              <select
                value={fTitle}
                onChange={(e) => setFTitle(e.target.value)}
                className="h-8 rounded-md border border-gray-200 bg-white px-2 text-xs text-gray-700 outline-none focus:border-gray-300"
              >
                <option value="">全部</option>
                {jobLabels.map((it) => (
                  <option key={typeof it === 'string' ? it : it.id} value={typeof it === 'string' ? it : it.name}>{typeof it === 'string' ? it : it.name}</option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-1.5">
              <span className="text-[11px] text-gray-400">岗位</span>
              <select
                value={fPost}
                onChange={(e) => setFPost(e.target.value)}
                className="h-8 rounded-md border border-gray-200 bg-white px-2 text-xs text-gray-700 outline-none focus:border-gray-300"
              >
                <option value="">全部</option>
                {postLabels.map((it) => (
                  <option key={typeof it === 'string' ? it : it.id} value={typeof it === 'string' ? it : it.name}>{typeof it === 'string' ? it : it.name}</option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-1.5">
              <span className="text-[11px] text-gray-400">管理范围</span>
              <select
                value={fScope}
                onChange={(e) => setFScope(e.target.value)}
                className="h-8 rounded-md border border-gray-200 bg-white px-2 text-xs text-gray-700 outline-none focus:border-gray-300"
              >
                <option value="">全部</option>
                {scopeOptions.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </label>
            {hasFilter && (
              <button
                onClick={() => { setFName(''); setFUsername(''); setFPhone(''); setFTitle(''); setFPost(''); setFScope(''); }}
                className="ml-auto rounded-md border border-gray-200 px-2.5 py-1.5 text-[11px] text-gray-500 hover:bg-white"
              >
                重置
              </button>
            )}
          </div>
          <div className="mb-3 flex items-center justify-between">
            <div className="text-sm font-semibold text-gray-800">{activeOrg ? orgList.find((o) => o.id === activeOrg)?.name : '全部人员'}</div>
            <div className="text-xs text-gray-400">共 {shown.length} 人 {activeOrg && <button onClick={() => setActiveOrg(null)} className="ml-2 text-blue-600 hover:underline">查看全部</button>}</div>
          </div>
          {shown.length === 0 && (
            <div className="flex h-[300px] flex-col items-center justify-center rounded-lg border border-dashed border-gray-200 text-sm text-gray-400">
              <Users size={28} strokeWidth={1.4} className="mb-3 text-gray-300" />
              暂无人员，点击右上角「新增人员」添加
            </div>
          )}
          <div className="space-y-2">
            {shown.map((p) => (
              <div key={p.id} className="flex items-center gap-3 rounded-lg border border-gray-100 bg-gray-50/50 p-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gray-900 text-xs font-semibold text-white">
                  {p.name.slice(0, 1)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-800">{p.name}</span>
                    {p.title && <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] text-blue-600">{p.title}</span>}
                    {p.post && <span className="rounded bg-purple-50 px-1.5 py-0.5 text-[10px] text-purple-600">{p.post}</span>}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-gray-400">
                    <span className="flex items-center gap-0.5"><span className="text-gray-300">⊞</span>{orgList.find((o) => o.id === p.orgId)?.name || '未分配部门'}</span>
                    {p.username && <span className="flex items-center gap-0.5"><span className="font-mono">@</span>{p.username}</span>}
                    {p.phone && <span className="flex items-center gap-0.5"><Phone size={10} />{p.phone}</span>}
                    {p.manageScope?.desc && <span className="flex items-center gap-0.5 text-blue-500"><Crosshair size={10} />{p.manageScope.desc}</span>}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {can('resetPwd', p.id) && (
                  <button
                    onClick={() => {
                      const np = window.prompt(`为「${p.name}」设置新的登录密码：`, p.password || '');
                      if (np !== null) { updatePerson({ ...p, password: np }); toast.success('已重置登录密码'); }
                    }}
                    className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                    title="重置密码"
                  >
                    <KeyRound size={14} />
                  </button>
                  )}
                  {can('edit', p.id) && (
                  <button
                    onClick={() => { setEditing(p); setShowEditor(true); }}
                    className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                    title="编辑"
                  >
                    <Pencil size={14} />
                  </button>
                  )}
                  {can('delete', p.id) && (
                  <button onClick={() => setConfirmDel(p)} className="rounded-md p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-500" title="删除">
                    <Trash2 size={14} />
                  </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {orgModal && (
        <OrgModal
          key={orgModal.id}
          initial={orgModal}
          orgs={orgList}
          onCancel={() => setOrgModal(null)}
          onSave={(o) => {
            if (orgModal.id === '__new') {
              addOrg({ name: o.name, kind: o.kind, parentId: o.parentId, sort: o.sort });
              toast.success('已新增部门');
            } else {
              updateOrg(o);
              toast.success('已更新部门');
            }
            setOrgModal(null);
          }}
        />
      )}

      {showEditor && (
        <PersonEditor
          initial={editing}
          orgs={orgList}
          persons={persons}
          stores={state.stores}
          storeAttrs={state.hrAttributes.filter((a) => (a.category ?? 'person') === 'store')}
          jobLabels={jobLabels}
          postLabels={postLabels}
          onCancel={() => setShowEditor(false)}
          onSave={(p) => {
            if (editing) updatePerson(p);
            else addPerson(p);
            toast.success(editing ? '已更新人员' : '已新增人员');
            setShowEditor(false);
          }}
        />
      )}

      {confirmDel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={() => setConfirmDel(null)}>
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-gray-900">删除人员</h3>
            <p className="mt-2 text-sm text-gray-500">确定删除「{confirmDel.name}」吗？</p>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setConfirmDel(null)} className="rounded-lg border border-gray-200 px-3.5 py-2 text-sm text-gray-600 hover:bg-gray-50">取消</button>
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

function PersonEditor({
  initial,
  orgs,
  stores,
  storeAttrs,
  jobLabels,
  postLabels,
  onCancel,
  onSave,
}: {
  initial: Person | null;
  orgs: Organization[];
  persons: Person[];
  stores: { id: string; name: string; attrs?: Record<string, string> }[];
  storeAttrs: { id: string; name: string; items: { id: string; name: string }[] }[];
  jobLabels: { id: string; name: string }[];
  postLabels: { id: string; name: string }[];
  onCancel: () => void;
  onSave: (p: Person) => void;
}) {
  const [name, setName] = useState(initial?.name || '');
  const [orgId, setOrgId] = useState(initial?.orgId || '');
  const [title, setTitle] = useState(initial?.title || '');
  const [post, setPost] = useState(initial?.post || '');
  const [phone, setPhone] = useState(initial?.phone || '');
  const [email, setEmail] = useState(initial?.email || '');
  const [username, setUsername] = useState(initial?.username || '');
  const [idCard, setIdCard] = useState(initial?.idCard || '');
  const [address, setAddress] = useState(initial?.address || '');
  const [birthday, setBirthday] = useState(initial?.birthday || '');
  const [password, setPassword] = useState(initial?.password || '');
  const [filters, setFilters] = useState<{ attrId: string; values: string[] }[]>(
    initial?.manageScope?.filters?.map((f) => ({ attrId: storeAttrs.find((a) => a.name === f.attrName)?.id || '', values: f.values })) ??
      (initial?.manageScope?.storeAttrId ? [{ attrId: initial.manageScope.storeAttrId, values: initial.manageScope.storeAttrValues ?? [] }] : [])
  );
  const [selectedStoreIds, setSelectedStoreIds] = useState<string[]>(initial?.manageScope?.storeIds || []);
  const [enabled, setEnabled] = useState(initial ? initial.enabled : true);

  const matchedStores = useMemo(() => {
    const activeFilters = filters.filter((f) => {
      const a = storeAttrs.find((x) => x.id === f.attrId);
      return a && f.values.length > 0;
    });
    if (activeFilters.length === 0) return [];
    return stores.filter((s) =>
      activeFilters.every((f) => {
        const a = storeAttrs.find((x) => x.id === f.attrId);
        return f.values.includes(s.attrs?.[a!.name] ?? '');
      })
    );
  }, [filters, stores, storeAttrs]);
  const visibleStores = filters.some((f) => f.values.length > 0) ? matchedStores : (filters.length ? stores : []);
  const activeDesc = filters
    .map((f) => {
      const a = storeAttrs.find((x) => x.id === f.attrId);
      return a && f.values.length ? `${a.name}（${f.values.join('、')}）` : null;
    })
    .filter(Boolean)
    .join('；');
  const scopeDesc = activeDesc;
  const valid = name.trim().length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="flex max-h-[calc(100vh-32px)] w-full max-w-5xl flex-col rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <h3 className="text-base font-semibold text-gray-900">{initial ? '编辑人员' : '新增人员'}</h3>
        </div>

        <div className="grid flex-1 grid-cols-1 gap-3 overflow-y-auto px-6 py-4">
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-gray-500">账号</label>
              <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="登录账号" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-gray-900" />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-gray-500">姓名 *</label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="人员姓名" autoFocus className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-gray-900" />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-gray-500">电话</label>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="联系电话" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-gray-900" />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-gray-500">归属部门 *</label>
              <select value={orgId} onChange={(e) => setOrgId(e.target.value)} className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-gray-900">
                <option value="">请选择部门</option>
                {orgs.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-gray-500">职位</label>
              <input value={title} onChange={(e) => setTitle(e.target.value)} list="job-options" placeholder={jobLabels.length ? '请选择或输入职位' : '如 运营经理 / 区域督导'} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-gray-900" />
              <datalist id="job-options">
                {jobLabels.map((x) => <option key={x.id} value={x.name} />)}
              </datalist>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-gray-500">岗位</label>
              <input value={post} onChange={(e) => setPost(e.target.value)} list="post-options" placeholder={postLabels.length ? '请选择或输入岗位' : '如 门店导购 / 督导'} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-gray-900" />
              <datalist id="post-options">
                {postLabels.map((x) => <option key={x.id} value={x.name} />)}
              </datalist>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-gray-500">邮箱</label>
              <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="邮箱" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-gray-900" />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-gray-500">{initial ? '重置密码' : '初始密码'}</label>
              <input value={password} onChange={(e) => setPassword(e.target.value)} type="text" placeholder={initial ? '留空保持原密码' : '设置初始登录密码'} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-gray-900" />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-gray-500">身份证号</label>
              <input value={idCard} onChange={(e) => setIdCard(e.target.value)} placeholder="身份证号" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-gray-900" />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-gray-500">生日</label>
              <input value={birthday} onChange={(e) => setBirthday(e.target.value)} type="date" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-gray-900" />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-gray-500">联系地址</label>
              <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="联系地址" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-gray-900" />
            </div>
          </div>

          <div className="flex items-center gap-6 rounded-lg border border-gray-100 bg-gray-50/50 px-3 py-2.5">
            <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-600">
              <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="accent-gray-900" />
              启用（参与预警通知）
            </label>
            <span className="text-xs text-gray-400">状态：{enabled ? '启用' : '停用'}</span>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-gray-500">机构管理范围（多个筛选条件组合筛选 → 勾选管辖门店）</label>
            <div className="space-y-2 rounded-lg border border-gray-200 p-2">
              {filters.map((fl, fi) => {
                const attr = storeAttrs.find((a) => a.id === fl.attrId);
                return (
                  <div key={fi} className="grid grid-cols-[150px_1fr_28px] items-center gap-2">
                    <select
                      value={fl.attrId}
                      onChange={(e) => {
                        const nf = [...filters];
                        nf[fi] = { attrId: e.target.value, values: [] };
                        setFilters(nf);
                        setSelectedStoreIds([]);
                      }}
                      className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs outline-none focus:border-gray-900"
                    >
                      <option value="">选择条件</option>
                      {storeAttrs.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                    <div className="flex flex-wrap items-center gap-1 rounded-md border border-gray-200 px-2 py-1">
                      {attr?.items.length ? (
                        attr.items.map((it) => {
                          const on = fl.values.includes(it.name);
                          return (
                            <button
                              key={it.id}
                              type="button"
                              onClick={() => {
                                const nf = [...filters];
                                nf[fi] = { ...fl, values: on ? fl.values.filter((x) => x !== it.name) : [...fl.values, it.name] };
                                setFilters(nf);
                              }}
                              className={`rounded px-2 py-0.5 text-[11px] transition ${on ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                            >
                              {it.name}
                            </button>
                          );
                        })
                      ) : (
                        <span className="text-[11px] text-gray-400">请先选择筛选条件</span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => { setFilters(filters.filter((_, i) => i !== fi)); setSelectedStoreIds([]); }}
                      className="text-gray-300 hover:text-red-500"
                      title="移除条件"
                    >
                      ✕
                    </button>
                  </div>
                );
              })}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setFilters([...filters, { attrId: '', values: [] }])}
                  className="rounded-md border border-dashed border-gray-300 px-2.5 py-1 text-[11px] text-gray-500 hover:bg-gray-50"
                >
                  + 添加筛选条件
                </button>
                <span className="text-[11px] text-gray-300">支持 主营品牌 / 分公司 / 部门 等店仓属性组合筛选</span>
              </div>
            </div>
            {scopeDesc && (
              <p className="mt-1.5 text-[11px] text-blue-500">筛选：{scopeDesc}</p>
            )}
            {filters.length > 0 && (
              <div className="mt-2 rounded-lg border border-gray-200">
                <div className="flex items-center justify-between border-b border-gray-100 px-2.5 py-1.5">
                  <span className="text-[11px] text-gray-400">筛选出 {matchedStores.length}/{stores.length} 家门店，选择管辖门店：</span>
                  {visibleStores.length > 0 && (
                    <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-gray-600">
                      <input
                        type="checkbox"
                        checked={visibleStores.every((s) => selectedStoreIds.includes(s.id)) && visibleStores.length > 0}
                        onChange={(e) => setSelectedStoreIds(e.target.checked ? visibleStores.map((s) => s.id) : [])}
                        className="accent-gray-900"
                      />
                      全选
                    </label>
                  )}
                </div>
                <div className="flex max-h-32 flex-wrap gap-1.5 overflow-y-auto p-2">
                  {visibleStores.length ? (
                    visibleStores.map((s) => {
                      const on = selectedStoreIds.includes(s.id);
                      return (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => setSelectedStoreIds((v) => (on ? v.filter((x) => x !== s.id) : [...v, s.id]))}
                          className={`rounded-md border px-2 py-0.5 text-xs transition ${on ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}
                        >
                          {s.name}
                        </button>
                      );
                    })
                  ) : (
                    <span className="px-2 py-1 text-[11px] text-gray-400">请设置筛选条件并选择属性值</span>
                  )}
                </div>
              </div>
            )}
            {selectedStoreIds.length > 0 && (
              <p className="mt-1.5 text-[11px] text-gray-400">已选 {selectedStoreIds.length} 家管辖门店</p>
            )}
          </div>

          </div>

        <div className="flex justify-end gap-2 border-t border-gray-100 px-6 py-3">
          <button onClick={onCancel} className="rounded-lg border border-gray-200 px-3.5 py-2 text-sm text-gray-600 hover:bg-gray-50">取消</button>
          <button
            disabled={!valid}
            onClick={() =>
              onSave({
                id: initial?.id || 'p_' + Math.random().toString(36).slice(2, 10),
                name: name.trim(),
                orgId,
                title: title.trim() || undefined,
                post: post.trim() || undefined,
                manageScope:
                  activeDesc
                    ? { filters: filters.map((f) => ({ attrName: storeAttrs.find((a) => a.id === f.attrId)?.name || '', values: f.values })).filter((f) => f.attrName && f.values.length > 0), storeIds: selectedStoreIds, desc: activeDesc }
                    : initial?.manageScope,
                phone: phone.trim() || undefined,
                email: email.trim() || undefined,
                username: username.trim() || undefined,
                idCard: idCard.trim() || undefined,
                address: address.trim() || undefined,
                birthday: birthday || undefined,
                password: password || undefined,
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

function FilterInput({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="flex items-center gap-1.5">
      <span className="text-[11px] text-gray-400">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-8 w-32 rounded-md border border-gray-200 bg-white px-2 text-xs text-gray-700 outline-none placeholder:text-gray-300 focus:border-gray-300"
      />
    </label>
  );
}

function OrgModal({
  initial,
  orgs,
  onCancel,
  onSave,
}: {
  initial: Organization;
  orgs: Organization[];
  onCancel: () => void;
  onSave: (o: Organization) => void;
}) {
  const isNew = initial.id === '__new';
  const [name, setName] = useState(initial.name || '');
  const [parentId, setParentId] = useState<string>(initial.parentId || '');
  const valid = name.trim().length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onCancel}>
      <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-semibold text-gray-900">{isNew ? '新增部门' : '编辑部门'}</h3>
        <div className="mt-5 grid grid-cols-1 gap-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-gray-500">部门名称 *</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              placeholder="如 直联营事业部"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-gray-900"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-gray-500">上级部门</label>
            <select
              value={parentId}
              onChange={(e) => setParentId(e.target.value)}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-gray-900"
            >
              <option value="">（无上级，作为一层部门）</option>
              {orgs.filter((o) => o.id !== initial.id).map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button onClick={onCancel} className="rounded-lg border border-gray-200 px-3.5 py-2 text-sm text-gray-600 hover:bg-gray-50">取消</button>
          <button
            disabled={!valid}
            onClick={() => onSave({ ...initial, name: name.trim(), kind: '部门', parentId: parentId || undefined })}
            className="rounded-lg bg-gray-900 px-3.5 py-2 text-sm text-white transition-colors hover:bg-gray-700 disabled:opacity-40"
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
}