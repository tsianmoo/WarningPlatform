'use client';

import { useMemo, useState } from 'react';
import { Plus, Save, Trash2, Users, Shield, Eye } from 'lucide-react';
import { useStore } from '@/lib/store';
import type { DataScope, PagePerm, PermModule, PermOp, RolePerm } from '@/lib/types';

const OP_LABELS: Record<PermOp, string> = {
  create: '新增',
  edit: '编辑',
  delete: '删除',
  run: '启用/停用',
  handle: '处理/转交',
  upload: '上传数据',
  download: '导出',
  assign: '分配岗位',
  resetPwd: '重置密码',
  manage: '维护',
};

interface PageSpec {
  m: PermModule;
  label: string;
  group: string;
  /** 页面级操作（可承载新增/处理/维护等粗粒度操作；整页统一，不细分到单个资源实例） */
  coarseOps?: PermOp[];
  resOps?: PermOp[];
}

const PAGE_SPECS: PageSpec[] = [
  { m: 'home', label: '首页', group: '首页' },
  {
    m: 'datatables', label: '数据表管理', group: '业务管理',
    coarseOps: ['create', 'download'], resOps: ['edit', 'delete', 'upload'],
  },
  {
    m: 'rules', label: '预警规则', group: '业务管理',
    coarseOps: ['create'], resOps: ['edit', 'delete', 'run'],
  },
  { m: 'alerts', label: '预警列表', group: '业务管理', coarseOps: ['handle', 'delete'] },
  {
    m: 'dealer', label: '经销商管理', group: '组织架构',
    coarseOps: ['create'], resOps: ['edit', 'delete'],
  },
  {
    m: 'store', label: '店仓管理', group: '组织架构',
    coarseOps: ['create'], resOps: ['edit', 'delete'],
  },
  { m: 'dattrs', label: '经销商属性', group: '组织架构', coarseOps: ['manage'] },
  { m: 'sattrs', label: '店仓属性', group: '组织架构', coarseOps: ['manage'] },
  {
    m: 'people', label: '用户管理', group: '人事管理',
    coarseOps: ['create'], resOps: ['edit', 'delete', 'assign', 'resetPwd'],
  },
  { m: 'attrs', label: '属性管理', group: '人事管理', coarseOps: ['manage'] },
  { m: 'homecfg', label: '首页管理', group: '系统管理', coarseOps: ['edit'] },
  { m: 'perms', label: '权限管理', group: '系统管理', coarseOps: ['edit'] },
];

const GROUP_ORDER = ['首页', '业务管理', '组织架构', '人事管理', '系统管理'];

function emptyPage(): PagePerm {
  return { view: true };
}

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

  const role = useMemo(
    () => (selected ? state.permissions.find((r) => r.post === selected) : undefined),
    [selected, state.permissions]
  );

  const select = (p: string) => {
    setSelected(p);
    const exist = state.permissions.find((r) => r.post === p);
    if (exist) setDraft({ ...exist, pages: { ...(exist.pages ?? {}) } });
    else setDraft({ post: p, pages: {}, dataScope: null });
  };

  const pageOf = (m: PermModule): PagePerm => draft?.pages[m] ?? emptyPage();

  const setPage = (m: PermModule, patch: Partial<PagePerm>) => {
    if (!draft) return;
    const cur = pageOf(m);
    const pages = { ...draft.pages, [m]: { ...cur, ...patch } };
    setDraft({ ...draft, pages });
  };

  const toggleView = (m: PermModule, v: boolean) => setPage(m, { view: v });

  const toggleOp = (m: PermModule, op: PermOp, v: boolean) => {
    if (!draft) return;
    const cur = pageOf(m);
    const ops = { ...(cur.ops ?? {}), [op]: v };
    setPage(m, { ops });
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
    const final: RolePerm = { ...draft, pages: draft.pages ?? {}, dataScope: draft.dataScope ?? null };
    setPermissions([...others, final]);
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
      s.attrs && Object.entries(s.attrs).forEach(([k, v]) => {
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

  const groups = useMemo(() => {
    const g: Record<string, PageSpec[]> = {};
    PAGE_SPECS.forEach((s) => (g[s.group] = [...(g[s.group] ?? []), s]));
    return GROUP_ORDER.filter((k) => g[k]).map((k) => ({ group: k, specs: g[k] }));
  }, []);

  return (
    <div className="flex h-full gap-4 p-4">
      {/* 左：岗位列表 */}
      <div className="w-60 shrink-0 rounded-2xl border border-gray-200 bg-white p-3 overflow-auto">
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
                setDraft(exist ? { ...exist, pages: { ...(exist.pages ?? {}) } } : { post: name, pages: {}, dataScope: null });
              }}
              className="mt-1 w-full rounded-md bg-blue-600 py-1.5 text-xs text-white hover:bg-blue-700"
            >确定</button>
          </div>
        )}
      </div>

      {/* 右：细粒度权限配置 */}
      <div className="flex-1 overflow-auto rounded-2xl border border-gray-200 bg-white p-4">
        {draft && draft.post !== '__new__' ? (
          <>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-base font-semibold text-gray-900">「{draft.post}」功能权限</h3>
              <div className="flex items-center gap-2">
                <button onClick={removeRole} className="flex items-center gap-1 rounded-md border border-red-200 px-2.5 py-1.5 text-xs text-red-600 hover:bg-red-50"><Trash2 className="h-3.5 w-3.5" />删除</button>
                <button onClick={save} className="flex items-center gap-1 rounded-md bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-700"><Save className="h-3.5 w-3.5" />保存配置</button>
              </div>
            </div>

            {/* 功能权限：按页面/资源/操作细分 */}
            <div className="space-y-4">
              {groups.map(({ group, specs }) => (
                <div key={group}>
                  <div className="mb-1.5 text-xs font-bold uppercase tracking-wide text-gray-400">{group}</div>
                  <div className="overflow-hidden rounded-lg border border-gray-200">
                    {specs.map((s, idx) => {
                      const view = pageOf(s.m).view;
                      const ops = [...(s.coarseOps ?? []), ...(s.resOps ?? [])];
                      return (
                        <div key={s.m} className={`${idx > 0 ? 'border-t border-gray-100' : ''}`}>
                          {/* 页面头部：页面可见 + 页面级操作（作用于整页资源，不细分到单个实例） */}
                          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 bg-gray-50/60 px-3 py-2">
                            <label className="flex w-40 shrink-0 items-center gap-1.5 text-[13px] font-semibold text-gray-700">
                              <input type="checkbox" checked={view} onChange={(e) => toggleView(s.m, e.target.checked)} className="accent-blue-600" />
                              <Eye className="h-3.5 w-3.5 text-gray-400" />
                              {s.label}
                            </label>
                            <span className="text-[11px] text-gray-400">页面可见</span>
                            <div className="flex flex-wrap items-center gap-3">
                              {ops.map((op) => (
                                <label key={op} className={`flex items-center gap-1 text-xs ${view ? 'text-gray-600' : 'text-gray-300'}`}>
                                  <input type="checkbox" disabled={!view} checked={!!pageOf(s.m).ops?.[op]} onChange={(e) => toggleOp(s.m, op, e.target.checked)} className="accent-blue-600 disabled:opacity-30" />
                                  {OP_LABELS[op]}
                                </label>
                              ))}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            {/* 数据权限 */}
            <div className="mt-5 border-t border-gray-100 pt-4">
              <div className="mb-2 text-sm font-medium text-gray-800">数据权限（预警可见范围）</div>
              <div className="mb-2 flex flex-wrap gap-2">
                {([
                  { value: 'all', label: '全部数据' },
                  { value: 'dealer', label: '所属经销商（及下级店仓）' },
                  { value: 'store', label: '所属门店（门店及以下）' },
                  { value: 'self', label: '仅本人相关预警' },
                  { value: 'managed', label: '按个人管理范围' },
                  { value: 'custom', label: '自定义范围' },
                ] as { value: DataScope['type']; label: string }[]).map((s) => (
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
                说明：
                1) 功能权限按「页面 → 操作」勾选：页面可见决定能否进入该页，具体操作（新增/编辑/删除/上传等）作用于该页面下的全部资源（经销商、店仓、规则、数据表等整页统一，不细分到单个实例）。
                2) 数据权限控制预警可见范围，按「岗位（Person.post）」配置并作用于该岗位所有用户；未配置的岗位默认可见全部页面、预警按所属自动推断（经销商→其下级、门店→门店及以下、其余→仅本人）。
              </div>
            </div>
          </>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-gray-400">请选择左侧岗位进行权限配置</div>
        )}
      </div>
    </div>
  );
}