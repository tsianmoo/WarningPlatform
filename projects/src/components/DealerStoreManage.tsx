'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp, KeyRound, Pencil, Plus, Trash2 } from 'lucide-react';
import { useStore } from '@/lib/store';
import type { AttrCategory, Dealer, HrAttribute, ManageScope, Person, Store } from '@/lib/types';
import { toast } from 'sonner';

const SCOPE_VALUES = ['华东大区', '华南大区', '总部直营', '河南分公司'];

type Kind = 'dealer' | 'store';

const KIND_CATEGORY: Record<Kind, AttrCategory> = { dealer: 'dealer', store: 'store' };

const META: Record<Kind, { unit: string; leftLabel: string; rightLabel: string }> = {
  dealer: { unit: '经销商', leftLabel: '经销商列表', rightLabel: '经销商人员' },
  store: { unit: '店仓', leftLabel: '店仓列表', rightLabel: '店仓人员' },
};

export function DealerStoreManage({ kind }: { kind: Kind }) {
  const { state, addPerson, updatePerson, removePerson, addDealer, updateDealer, removeDealer, moveDealer, addStore, updateStore, removeStore, moveStore } = useStore();
  const { dealers, stores, persons, orgs, hrAttributes, tables } = state;

  const list: (Dealer | Store)[] = (kind === 'dealer' ? dealers : stores).slice().sort((a, b) => a.sort - b.sort);
  const unit = META[kind].unit;
  const [activeId, setActiveId] = useState<string>(list[0]?.id || '');
  const [editMode, setEditMode] = useState(false);
  const [editor, setEditor] = useState<Person | null>(null);
  const [showEditor, setShowEditor] = useState(false);
  const [dictForm, setDictForm] = useState<{ item: (Dealer | Store) | null } | null>(null);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);

  const people = persons.filter((p) => (kind === 'dealer' ? p.dealerId === activeId : p.storeId === activeId));
  const categoryAttrs = hrAttributes.filter((a) => (a.category ?? 'person') === KIND_CATEGORY[kind]);

  const field = (d: Dealer | Store) => (kind === 'dealer' ? updateDealer(d as Dealer) : updateStore(d as Store));
  const remove = (id: string) => (kind === 'dealer' ? removeDealer(id) : removeStore(id));
  const move = (id: string, dir: -1 | 1) => (kind === 'dealer' ? moveDealer(id, dir) : moveStore(id, dir));

  const saveUnit = (draft: Omit<Dealer, 'id' | 'createdAt'> | Omit<Store, 'id' | 'createdAt'>) => {
    const active: Dealer | Store | undefined = dictForm?.item ?? list.find((x) => x.id === activeId);
    if (active) {
      field({ ...(active as object), ...(draft as object) } as Dealer);
      toast.success(`已更新${unit}`);
    } else {
      (kind === 'dealer' ? addDealer : addStore)(draft as never);
      toast.success(`已新增${unit}`);
    }
  };

  const resetPwd = (p: Person) => {
    const n = prompt(`重置「${p.name}」的登录密码`);
    if (!n?.trim()) return;
    updatePerson({ ...p, password: n.trim() });
    toast.success('密码已重置');
  };

  return (
    <div className="flex h-full overflow-hidden">
      {/* 左侧：经销商 / 店仓 列表 */}
      <aside className={`${kind === 'dealer' ? 'flex w-72' : 'flex flex-1'} shrink-0 flex-col border-r border-gray-200 bg-white`}>
        <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
          <div className="flex items-center gap-1.5 text-sm font-medium text-gray-700">
            <span>{META[kind].leftLabel}</span>
            <span className="rounded-full bg-gray-100 px-1.5 text-[11px] text-gray-500">{list.length}</span>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => setDictForm({ item: null })} title={`新增${unit}`} className="rounded-md p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-900"><Plus size={15} /></button>
            <button title="编辑模式" onClick={() => setEditMode((v) => !v)} className={`rounded-md p-1.5 hover:bg-gray-100 ${editMode ? 'bg-gray-900 text-white' : 'text-gray-500 hover:text-gray-900'}`}><Pencil size={14} /></button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {list.map((d) => (
            <div key={d.id} className={`group flex items-center justify-between border-b border-gray-50 px-4 py-2.5 text-sm ${activeId === d.id ? 'bg-gray-900 text-white' : 'text-gray-700 hover:bg-gray-50'}`}>
              <button className="flex flex-1 items-center gap-2 text-left" onClick={() => setActiveId(d.id)}>
                <span className={`h-1.5 w-1.5 rounded-full ${activeId === d.id ? 'bg-white' : d.enabled === false ? 'bg-red-300' : 'bg-gray-300'}`} />
                <span className="flex-1 truncate">{d.name}</span>
                {d.enabled === false && <span className="rounded bg-red-50 px-1 text-[10px] text-red-500">停用</span>}
              </button>
              {editMode && (
                <span className={`flex items-center gap-0.5 ${activeId === d.id ? 'text-white/80' : 'text-gray-400'}`}>
                  <button title="上移" onClick={() => move(d.id, -1)} className="rounded p-0.5 hover:text-gray-900 hover:bg-gray-200"><ChevronUp size={13} /></button>
                  <button title="下移" onClick={() => move(d.id, 1)} className="rounded p-0.5 hover:text-gray-900 hover:bg-gray-200"><ChevronDown size={13} /></button>
                  <button title="编辑" onClick={() => setDictForm({ item: d })} className="rounded p-0.5 hover:text-gray-900 hover:bg-gray-200"><Pencil size={12} /></button>
                  <button title="删除" onClick={() => setConfirmDel(d.id)} className="rounded p-0.5 hover:text-red-600 hover:bg-red-50"><Trash2 size={12} /></button>
                </span>
              )}
            </div>
          ))}
          {list.length === 0 && <div className="px-4 py-8 text-center text-xs text-gray-400">暂无{unit}，点击右上角 + 新增</div>}
        </div>
      </aside>

      {/* 右侧：人员（仅经销商模式；店仓管理只管理店仓本身，不在此新增人员） */}
      {kind === 'dealer' && (
      <section className="flex flex-1 flex-col overflow-hidden">
        {!activeId ? (
          <div className="flex flex-1 items-center justify-center text-sm text-gray-400">请先选择左侧{unit}</div>
        ) : (
          <>
            <div className="flex items-center justify-between border-b border-gray-100 px-6 py-3">
              <div className="text-sm font-medium text-gray-700">
                {unit}人员
                <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-500">{people.length}</span>
              </div>
              <button onClick={() => { setEditor(null); setShowEditor(true); }} className="inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-3 py-1.5 text-sm text-white hover:bg-gray-700"><Plus size={14} />新增人员</button>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              <div className="grid grid-cols-1 gap-4">
                {people.map((p) => (
                  <div key={p.id} className="rounded-xl border border-gray-100 p-4 shadow-sm">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-900 text-xs font-medium text-white">{p.name.slice(0, 1)}</span>
                        <div>
                          <div className="text-sm font-medium text-gray-900">{p.name} {p.username && <span className="text-xs font-normal text-gray-400">@{p.username}</span>}</div>
                          <div className="text-xs text-gray-400">
                            {p.title} {p.post && `· ${p.post}`} {p.phone && `· ${p.phone}`}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 text-gray-400">
                        <button title="重置密码" onClick={() => resetPwd(p)} className="rounded-md p-1.5 hover:bg-gray-100 hover:text-gray-900"><KeyRound size={14} /></button>
                        <button title="编辑" onClick={() => { setEditor(p); setShowEditor(true); }} className="rounded-md p-1.5 hover:bg-gray-100 hover:text-gray-900"><Pencil size={14} /></button>
                        <button title="删除" onClick={() => setConfirmDel(p.id)} className="rounded-md p-1.5 hover:bg-red-100 hover:text-red-600"><Trash2 size={14} /></button>
                      </div>
                    </div>
                    {p.manageScope?.field && (
                      <div className="mt-2 text-[11px] text-gray-400">管理范围：{p.manageScope.field} = {p.manageScope.value}</div>
                    )}
                  </div>
                ))}
                {people.length === 0 && <div className="py-12 text-center text-sm text-gray-400">该{unit}下暂无人员</div>}
              </div>
            </div>
          </>
        )}
      </section>
      )}

      {dictForm && (
        <DictForm
          key={dictForm.item?.id ?? 'new'}
          kind={kind}
          initial={dictForm.item as (Dealer | Store) | null}
          categoryAttrs={categoryAttrs}
          onClose={() => setDictForm(null)}
          onSave={saveUnit}
        />
      )}

      {showEditor && (
        <PersonForm
          key={editor?.id ?? 'new'}
          kind={kind}
          initial={editor}
          unit={unit}
          defaultUnitId={activeId}
          orgs={orgs}
          persons={persons}
          hrAttributes={hrAttributes}
          tables={tables}
          unitOptions={kind === 'dealer' ? dealers : stores}
          onClose={() => setShowEditor(false)}
          onSave={(draft) => {
            if (editor) {
              updatePerson({ ...(draft as object), id: editor.id, createdAt: editor.createdAt } as Person);
              toast.success('已更新人员');
            } else {
              addPerson(draft);
              toast.success('已新增人员');
            }
          }}
        />
      )}

      {confirmDel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
            <h3 className="text-base font-semibold text-gray-900">删除确认</h3>
            <p className="mt-2 text-sm text-gray-500">确定删除该记录吗？删除后不可恢复。</p>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setConfirmDel(null)} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm">取消</button>
              <button
                onClick={() => {
                  const asPerson = persons.find((x) => x.id === confirmDel);
                  if (asPerson) removePerson(confirmDel);
                  else remove(confirmDel);
                  setConfirmDel(null);
                }}
                className="rounded-lg bg-red-600 px-3 py-1.5 text-sm text-white hover:bg-red-500"
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

/** 经销商/店仓 新增或编辑弹窗 */
function DictForm(props: {
  kind: Kind;
  initial: (Dealer | Store) | null;
  categoryAttrs: HrAttribute[];
  onClose: () => void;
  onSave: (d: Omit<Dealer, 'id' | 'createdAt'> | Omit<Store, 'id' | 'createdAt'>) => void;
}) {
  const { kind, initial, categoryAttrs, onClose, onSave } = props;
  const unit = META[kind].unit;
  const [code, setCode] = useState(initial?.code ?? '');
  const [name, setName] = useState(initial?.name ?? '');
  const [contact, setContact] = useState(initial?.contact ?? '');
  const [phone, setPhone] = useState(initial?.phone ?? '');
  const [address, setAddress] = useState(initial?.address ?? '');
  const [password, setPassword] = useState(initial?.password ?? '');
  const [birthday, setBirthday] = useState(initial?.birthday ?? '');
  const [enabled, setEnabled] = useState(initial ? (initial.enabled !== false) : true);
  const [attrs, setAttrs] = useState<Record<string, string>>(initial?.attrs ?? {});

  const save = () => {
    if (!name.trim()) return toast.error('请填写名称');
    onSave({
      name: name.trim(), code: code.trim() || undefined, contact: contact.trim() || undefined,
      phone: phone.trim() || undefined, address: address.trim() || undefined,
      password: password || undefined, birthday: birthday || undefined,
      enabled, attrs, sort: initial?.sort ?? 0,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
        <h3 className="text-base font-semibold text-gray-900">{initial ? `编辑${unit}` : `新增${unit}`}</h3>

        <div className="mt-5 grid grid-cols-2 gap-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-gray-500">{unit}编号</label>
            <input value={code} onChange={(e) => setCode(e.target.value)} placeholder={`请输入${unit}编号`} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-gray-900" />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-gray-500">{unit}名称 *</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder={`请输入${unit}名称`} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-gray-900" />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-gray-500">联系人</label>
            <input value={contact} onChange={(e) => setContact(e.target.value)} placeholder="联系人姓名" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-gray-900" />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-gray-500">电话</label>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="联系电话" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-gray-900" />
          </div>
          <div className="col-span-2">
            <label className="mb-1.5 block text-xs font-medium text-gray-500">地址</label>
            <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="详细地址" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-gray-900" />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-gray-500">{initial ? '重置密码' : '初始密码'}</label>
            <input value={password} onChange={(e) => setPassword(e.target.value)} type="text" placeholder={initial ? '留空保持原密码' : '设置初始登录密码'} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-gray-900" />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-gray-500">生日</label>
            <input value={birthday} onChange={(e) => setBirthday(e.target.value)} type="date" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-gray-900" />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-gray-500">启用</label>
            <label className="flex h-9 items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="h-4 w-4" />
              是否启用
            </label>
          </div>
        </div>

        {categoryAttrs.length > 0 && (
          <div className="mt-5">
            <div className="mb-2 border-t border-gray-100 pt-4 text-xs font-medium text-gray-400">{unit}属性：{categoryAttrs.map((a) => a.name).join(' / ')}</div>
            <div className="grid grid-cols-2 gap-4">
              {categoryAttrs.map((a) => (
                <div key={a.id}>
                  <label className="mb-1.5 block text-xs font-medium text-gray-500">{a.name}</label>
                  <input value={attrs[a.name] ?? ''} onChange={(e) => setAttrs((v) => ({ ...v, [a.name]: e.target.value }))} list={`f-${kind}-${a.id}`} placeholder={`请选择或输入${a.name}`} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-gray-900" />
                  <datalist id={`f-${kind}-${a.id}`}>{a.items.map((x) => <option key={x.id} value={x.name} />)}</datalist>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm">取消</button>
          <button onClick={save} className="rounded-lg bg-gray-900 px-3 py-1.5 text-sm text-white hover:bg-gray-700">保存</button>
        </div>
      </div>
    </div>
  );
}

function PersonForm(props: {
  kind: Kind; initial: Person | null; unit: string; defaultUnitId: string; unitOptions: { id: string; name: string }[];
  orgs: { id: string; name: string }[]; persons: Person[];
  hrAttributes: { id: string; name: string; items: { id: string; name: string }[] }[];
  tables: { id: string; name: string; columns?: { key: string; name?: string }[] }[];
  onClose: () => void; onSave: (d: Omit<Person, 'id' | 'createdAt'>) => void;
}) {
  const { kind, initial, unit, defaultUnitId, unitOptions, orgs, persons, hrAttributes, tables, onClose, onSave } = props;
  const [name, setName] = useState(initial?.name ?? '');
  const [username, setUsername] = useState(initial?.username ?? '');
  const [phone, setPhone] = useState(initial?.phone ?? '');
  const [orgId, setOrgId] = useState(initial?.orgId ?? '');
  const [title, setTitle] = useState(initial?.title ?? '');
  const [post, setPost] = useState(initial?.post ?? '');
  const [supervisorId, setSupervisorId] = useState(initial?.supervisorId ?? '');
  const [dealerId, setDealerId] = useState(initial?.dealerId ?? (kind === 'dealer' ? defaultUnitId : ''));
  const [storeId, setStoreId] = useState(initial?.storeId ?? (kind === 'store' ? defaultUnitId : ''));
  const [password, setPassword] = useState(initial?.password ?? '');
  const [enable, setEnable] = useState(initial ? initial.enabled : true);

  const [scopeTable, setScopeTable] = useState(initial?.manageScope?.tableId ?? '');
  const [scopeField, setScopeField] = useState(initial?.manageScope?.field ?? '');
  const [scopeValue, setScopeValue] = useState(initial?.manageScope?.value ?? '');

  const table = tables.find((t) => t.id === scopeTable);
  const jobLabels = hrAttributes.filter((a) => a.name.includes('职位')).flatMap((a) => a.items);
  const postLabels = hrAttributes.filter((a) => a.name.includes('岗位')).flatMap((a) => a.items);
  const mgr: ManageScope = { tableId: scopeTable, field: scopeField, value: scopeValue, desc: [scopeField, scopeValue].filter(Boolean).join('=') };

  const save = () => {
    if (!name.trim()) return toast.error('请填写姓名');
    onSave({
      name: name.trim(), orgId, title: title || undefined, post: post || undefined,
      username: username || undefined, password: password || undefined,
      dealerId: dealerId || undefined, storeId: storeId || undefined,
      supervisorId: supervisorId || undefined,
      manageScope: scopeTable && scopeField ? mgr : undefined,
      phone: phone || undefined, enabled: enable, sort: initial?.sort ?? 0,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
        <h3 className="text-base font-semibold text-gray-900">{initial ? '编辑人员' : `新增${unit}人员`}</h3>

        <div className="mt-5 grid grid-cols-1 gap-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-gray-500">姓名 *</label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="人员姓名" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-gray-900" />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-gray-500">归属{unit}</label>
              <select value={kind === 'dealer' ? dealerId : storeId} onChange={(e) => { const v = e.target.value; if (kind === 'dealer') setDealerId(v); else setStoreId(v); }} className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-gray-900">
                <option value="">请选择归属{unit}</option>
                {unitOptions.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-gray-500">部门</label>
              <select value={orgId} onChange={(e) => { setOrgId(e.target.value); setSupervisorId(''); }} className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-gray-900">
                <option value="">请选择部门</option>
                {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-gray-500">上级领导</label>
              <select value={supervisorId} onChange={(e) => setSupervisorId(e.target.value)} className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-gray-900">
                <option value="">（无上级）</option>
                {persons.filter((p) => p.orgId === orgId && p.id !== initial?.id).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-gray-500">职位</label>
              <input value={title} onChange={(e) => setTitle(e.target.value)} list="f-job" placeholder="请选择或输入职位" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-gray-900" />
              <datalist id="f-job">{jobLabels.map((x) => <option key={x.id} value={x.name} />)}</datalist>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-gray-500">岗位</label>
              <input value={post} onChange={(e) => setPost(e.target.value)} list="f-post" placeholder="请选择或输入岗位" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-gray-900" />
              <datalist id="f-post">{postLabels.map((x) => <option key={x.id} value={x.name} />)}</datalist>
            </div>
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
              <input value={scopeValue} onChange={(e) => setScopeValue(e.target.value)} list="f-scope" placeholder="分类值" className="rounded-lg border border-gray-300 px-2 py-2 text-xs outline-none focus:border-gray-900" />
            </div>
            <datalist id="f-scope">{SCOPE_VALUES.map((v) => <option key={v} value={v} />)}</datalist>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-gray-500">账号</label>
              <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="登录账号" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-gray-900" />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-gray-500">{initial ? '重置密码' : '初始密码'}</label>
              <input value={password} onChange={(e) => setPassword(e.target.value)} type="text" placeholder={initial ? '留空保持原密码' : '设置初始登录密码'} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-gray-900" />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-gray-500">手机</label>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="联系电话" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-gray-900" />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-gray-500">启用</label>
              <label className="flex h-9 items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={enable} onChange={(e) => setEnable(e.target.checked)} className="h-4 w-4" />
                是否启用
              </label>
            </div>
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm">取消</button>
          <button onClick={save} className="rounded-lg bg-gray-900 px-3 py-1.5 text-sm text-white hover:bg-gray-700">保存</button>
        </div>
      </div>
    </div>
  );
}