'use client';

import { useMemo, useState } from 'react';
import { Plus, Save, Trash2, Users, Shield } from 'lucide-react';
import { useStore } from '@/lib/store';
import type { DataScope, ModuleActionPerm, PermModule, RolePerm } from '@/lib/types';

const MODULE_LABELS: Record<PermModule, string> = {
  home: '首页',
  datatables: '数据表管理',
  rules: '预警规则',
  alerts: '预警列表',
  org: '组织架构',
  people: '人事管理',
  homecfg: '系统-首页管理',
  perms: '系统-权限管理',
};

const MODULES: PermModule[] = ['datatables', 'rules', 'alerts', 'org', 'people', 'homecfg', 'perms'];

/** 每个模块可勾选的操作项（除固定"查看"） */
const OPER_META: { key: keyof ModuleActionPerm; label: string; modules: PermModule[] }[] = [
  { key: 'create', label: '新增', modules: ['datatables', 'rules', 'org', 'people'] },
  { key: 'upload', label: '上传数据', modules: ['datatables'] },
  { key: 'edit', label: '编辑', modules: ['datatables', 'rules', 'people'] },
  { key: 'run', label: '启用/停用', modules: ['rules'] },
  { key: 'handle', label: '处理/转交', modules: ['alerts'] },
  { key: 'assign', label: '重置密码/分配岗位', modules: ['people'] },
  { key: 'delete', label: '删除', modules: ['datatables', 'rules', 'alerts', 'org', 'people'] },
];

const SCOPE_LABELS: { value: DataScope['type']; label: string }[] = [
  { value: 'all', label: '全部数据' },
  { value: 'dealer', label: '所属经销商（及下级店仓）' },
  { value: 'store', label: '所属门店（门店及以下）' },
  { value: 'self', label: '仅本人相关预警' },
  { value: 'managed', label: '按个人管理范围（manageScope）' },
  { value: 'custom', label: '自定义范围' },
];

export default function PermissionManage() {
  const { state, setPermissions } = useStore();
  const [posts, setPosts] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<RolePerm | null>(null);
  const [newPostName, setNewPostName] = useState('');

  const allPosts = useMemo(() => {
    const fromPersons = Array.from(new Set(state.persons.map((p) => p.post).filter(Boolean) as string[]));
    const fromAttr = (state.hrAttributes ?? [])
      .filter((a) => /岗位/.test(a.name))
      .flatMap((a) => a.items.map((i) => i.name))
      .filter(Boolean);
    return Array.from(new Set([...fromPersons, ...fromAttr, '系统管理员'])).sort();
  }, [state.persons, state.hrAttributes]);

  const effectivePosts = useMemo(() => Array.from(new Set([...allPosts, ...posts])), [allPosts, posts]);

  const role = useMemo(() => (selected ? state.permissions.find((r) => r.post === selected) : undefined), [selected, state.permissions]);

  const select = (p: string) => {
    setSelected(p);
    const exist = state.permissions.find((r) => r.post === p);
    if (exist) setDraft({ ...exist, modules: { ...exist.modules } });
    else setDraft({ post: p, modules: {}, dataScope: null });
  };

  const toggleView = (m: PermModule, v: boolean) => {
    if (!draft) return;
    const cur = { ...(draft.modules[m] ?? { view: true }), view: v };
    const modules = { ...draft.modules, [m]: cur };
    setDraft({ ...draft, modules });
  };

  const toggleOper = (m: PermModule, k: keyof ModuleActionPerm, v: boolean) => {
    if (!draft) return;
    const cur = { ...(draft.modules[m] ?? { view: true }), [k]: v } as ModuleActionPerm;
    const modules = { ...draft.modules, [m]: cur };
    setDraft({ ...draft, modules });
  };

  const setScopeType = (type: DataScope['type']) => {
    if (!draft) return;
    setDraft({ ...draft, dataScope: { type } as DataScope });
  };

  const toggleScopeItem = (kind: 'dealerIds' | 'storeIds', id: string) => {
    if (!draft?.dataScope || draft.dataScope.type !== 'custom') return;
    const cur = new Set(draft.dataScope[kind] ?? []);
    cur.has(id) ? cur.delete(id) : cur.add(id);
    setDraft({ ...draft, dataScope: { ...draft.dataScope, [kind]: Array.from(cur) } });
  };

  const save = () => {
    if (!draft || !draft.post) return;
    const others = state.permissions.filter((r) => r.post !== draft.post);
    // 无任何权限时仍需至少 view 原样保留；直接整体保存
    setPermissions([...others, draft]);
    setSelected(null);
    setDraft(null);
  };

  const removeRole = () => {
    if (!selected) return;
    setPermissions(state.permissions.filter((r) => r.post !== selected));
    setSelected(null);
    setDraft(null);
  };

  const attrOptions = useMemo(() => {
    const map = new Map<string, string[]>();
    (state.stores ?? []).forEach((s) => {
      (s.attrs ?? {}) && Object.entries(s.attrs ?? {}).forEach(([k, v]) => {
        if (!v) return;
        map.has(k) ? map.get(k)!.push(v) : map.set(k, [v]);
      });
    });
    ['销售区域', '区部', '所属分公司', '所属部门'].forEach((k) => {
      (state.stores ?? []).forEach((s) => {
        const v = k === '销售区域' ? s.salesArea : k === '区部' ? s.district : k === '所属分公司' ? s.company : s.department;
        if (!v) return;
        map.has(k) ? map.get(k)!.push(v) : map.set(k, [v]);
      });
    });
    return Array.from(map.entries()).map(([k, v]) => ({ attrName: k, values: Array.from(new Set(v)) }));
  }, [state.stores]);

  const scope = draft?.dataScope ?? role?.dataScope ?? null;

  return (
    <div className="flex h-full gap-4 p-4">
      {/* 左：岗位列表 */}
      <div className="w-64 shrink-0 rounded-2xl border border-gray-200 bg-white p-3">
        <div className="mb-2 flex items-center justify-between px-1">
          <span className="flex items-center gap-1.5 text-sm font-semibold text-gray-800"><Shield className="h-4 w-4 text-blue-600" />岗位权限</span>
          <button
            onClick={() => { setNewPostName(''); setSelected('__new__'); setDraft(null); }}
            className="flex items-center gap-1 rounded-md border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50"
          >
            <Plus className="h-3.5 w-3.5" />新建
          </button>
        </div>
        {effectivePosts.map((p) => (
          <button
            key={p}
            onClick={() => select(p)}
            className={`mb-1 flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-[13px] ${
              selected === p ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-700 hover:bg-gray-50'
            }`}
          >
            <span className="flex items-center gap-1.5"><Users className="h-3.5 w-3.5 text-gray-400" />{p}</span>
            {state.permissions.some((r) => r.post === p) && <span className="text-[10px] text-emerald-500">已配置</span>}
          </button>
        ))}
        {selected === '__new__' && (
          <div className="mt-1 px-1">
            <input
              value={newPostName}
              onChange={(e) => setNewPostName(e.target.value)}
              placeholder="输入新岗位名"
              className="w-full rounded-md border border-gray-200 px-2 py-1.5 text-xs"
              autoFocus
            />
            <button
              onClick={() => {
                const name = newPostName.trim();
                if (!name) return;
                setPosts((p) => Array.from(new Set([...p, name])));
                setNewPostName('');
                setSelected(name);
                const exist = state.permissions.find((r) => r.post === name);
                setDraft(exist ? { ...exist, modules: { ...exist.modules } } : { post: name, modules: {}, dataScope: null });
              }}
              className="mt-1 w-full rounded-md bg-blue-600 py-1.5 text-xs text-white hover:bg-blue-700"
            >确定</button>
          </div>
        )}
      </div>

      {/* 右：权限配置 */}
      <div className="flex-1 overflow-auto rounded-2xl border border-gray-200 bg-white p-4">
        {draft && draft.post !== '__new__' ? (
          <>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-base font-semibold text-gray-900">「{draft.post}」权限配置</h3>
              <div className="flex items-center gap-2">
                <button onClick={removeRole} className="flex items-center gap-1 rounded-md border border-red-200 px-2.5 py-1.5 text-xs text-red-600 hover:bg-red-50"><Trash2 className="h-3.5 w-3.5" />删除</button>
                <button onClick={save} className="flex items-center gap-1 rounded-md bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-700"><Save className="h-3.5 w-3.5" />保存配置</button>
              </div>
            </div>

            {/* 功能权限 */}
            <div className="mb-5">
              <div className="mb-2 text-sm font-medium text-gray-800">功能权限（查看 / 操作）</div>
              <div className="overflow-hidden rounded-lg border border-gray-200">
                <table className="w-full text-left text-xs">
                  <thead className="bg-gray-50 text-gray-500">
                    <tr>
                      <th className="px-3 py-2 font-medium">模块</th>
                      <th className="px-3 py-2 font-medium">查看</th>
                      {OPER_META.map((o) => <th key={o.key} className="px-3 py-2 font-medium">{o.label}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {MODULES.map((m) => {
                      const mp = draft.modules[m];
                      const view = mp?.view ?? true;
                      return (
                        <tr key={m} className="border-t border-gray-100">
                          <td className="px-3 py-2 font-medium text-gray-700">{MODULE_LABELS[m]}</td>
                          <td className="px-3 py-2">
                            <input type="checkbox" checked={view} onChange={(e) => toggleView(m, e.target.checked)} className="accent-blue-600" />
                          </td>
                          {OPER_META.map((o) => {
                            if (!o.modules.includes(m)) return <td key={o.key} />;
                            return (
                              <td key={o.key} className="px-3 py-2">
                                <input
                                  type="checkbox"
                                  disabled={!view}
                                  checked={mp?.[o.key] ?? false}
                                  onChange={(e) => toggleOper(m, o.key, e.target.checked)}
                                  className="accent-blue-600 disabled:opacity-30"
                                />
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* 数据权限 */}
            <div className="mb-2 text-sm font-medium text-gray-800">数据权限（预警可见范围）</div>
            <div className="mb-2 flex flex-wrap gap-2">
              {SCOPE_LABELS.map((s) => (
                <label key={s.value} className={`flex cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs ${scope?.type === s.value ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                  <input type="radio" name="scope" checked={scope?.type === s.value} onChange={() => setScopeType(s.value)} className="accent-blue-600" />
                  {s.label}
                </label>
              ))}
            </div>

            {scope?.type === 'custom' && (
              <div className="rounded-lg border border-gray-200 p-3">
                <div className="mb-2 text-xs font-medium text-gray-600">自定义范围</div>
                <div className="mb-3 grid grid-cols-2 gap-3">
                  <div className="max-h-40 overflow-auto rounded border border-gray-100 p-2">
                    <div className="mb-1 text-[11px] font-semibold text-gray-500">经销商</div>
                    {state.dealers.filter((d) => d.enabled !== false).map((d) => (
                      <label key={d.id} className="flex items-center gap-1.5 py-0.5 text-xs text-gray-700">
                        <input type="checkbox" checked={(scope.dealerIds ?? []).includes(d.id)} onChange={() => toggleScopeItem('dealerIds', d.id)} className="accent-blue-600" />{d.name}
                      </label>
                    ))}
                  </div>
                  <div className="max-h-40 overflow-auto rounded border border-gray-100 p-2">
                    <div className="mb-1 text-[11px] font-semibold text-gray-500">店仓</div>
                    {state.stores.filter((s) => s.enabled !== false).map((s) => (
                      <label key={s.id} className="flex items-center gap-1.5 py-0.5 text-xs text-gray-700">
                        <input type="checkbox" checked={(scope.storeIds ?? []).includes(s.id)} onChange={() => toggleScopeItem('storeIds', s.id)} className="accent-blue-600" />{s.name}
                      </label>
                    ))}
                  </div>
                </div>
                <div className="text-xs font-medium text-gray-600">按店仓属性筛选（区部 / 销售区域等，多条件为叠加）</div>
                <div className="mt-1.5 space-y-1.5">
                  {attrOptions.map((a) => (
                    <label key={a.attrName} className="flex items-center gap-2 text-xs text-gray-700">
                      <span className="w-20 shrink-0 font-medium">{a.attrName}</span>
                      <select
                        multiple
                        value={(scope.attrFilters ?? []).find((f) => f.attrName === a.attrName)?.values ?? []}
                        onChange={(e) => {
                          const vals = Array.from(e.target.selectedOptions).map((o) => o.value);
                          const rest = (scope.attrFilters ?? []).filter((f) => f.attrName !== a.attrName);
                          setDraft({ ...draft, dataScope: { ...scope, attrFilters: vals.length ? [...rest, { attrName: a.attrName, values: vals }] : rest } });
                        }}
                        className="h-auto min-h-[28px] flex-1 rounded border border-gray-200 px-1 text-xs"
                      >
                        {a.values.map((v) => <option key={v} value={v}>{v}</option>)}
                      </select>
                    </label>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-3 rounded-lg bg-blue-50 p-3 text-xs text-blue-700">
              说明：权限按「岗位（Person.post）」配置并作用于该岗位的所有用户；未配置的岗位默认可见全部模块、数据范围按用户归属自动推断（经销商→其下级、门店→门店及以下、其余→仅本人）。单用户自定义覆盖可在用户管理中设置。
            </div>
          </>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-gray-400">请选择左侧岗位进行权限配置</div>
        )}
      </div>
    </div>
  );
}