'use client';

import { useEffect, useState } from 'react';
import type { Person } from '@/lib/types';
import { useRouter } from 'next/navigation';
import { Table2, BellRing, ShieldAlert, Shield, LayoutDashboard, Activity, Briefcase, Users, Settings, Maximize, Minimize, LogOut, UploadCloud, Server, ClipboardList } from 'lucide-react';
import { StoreProvider, useStore } from '@/lib/store';
import { DataTableManager } from '@/components/DataTableManager';
import { RuleList } from '@/components/RuleList';
import { NewRule, RuleConfigurator } from '@/components/RuleConfigurator';
import { Dashboard } from '@/components/Dashboard';
import { Toaster } from 'sonner';
import { AlertList } from '@/components/AlertList';
import { PeopleManage } from '@/components/PeopleManage';
import { AttrManage } from '@/components/AttrManage';
import { DealerStoreManage } from '@/components/DealerStoreManage';
import EmployeeManage from '@/components/EmployeeManage';
import { HomeConfig } from '@/components/HomeConfig';
import PermissionManage from '@/components/PermissionManage';
import { resolvePerm, canView, resolveAuthAccount } from '@/lib/perm';

type View = 'home' | 'tables' | 'apitable' | 'formtable' | 'rules' | 'new' | 'edit' | 'alerts' | 'people' | 'attrs' | 'dealer' | 'store' | 'dattrs' | 'sattrs' | 'emp' | 'eattrs' | 'homecfg' | 'perms';

function ApiDataPlaceholder({ onHome }: { onHome: () => void }) {
  return (
    <div className="flex h-full min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
      <Server size={40} className="text-gray-300" />
      <div className="text-lg font-medium text-gray-700">API数据表</div>
      <div className="max-w-sm text-sm text-gray-400">通过 API 接入外部数据表的模块即将上线，敬请期待。</div>
      <button onClick={onHome} className="mt-2 rounded-md bg-blue-600 px-4 py-1.5 text-sm text-white hover:bg-blue-700">
        返回首页
      </button>
    </div>
  );
}

function FormFillPlaceholder({ onHome }: { onHome: () => void }) {
  return (
    <div className="flex h-full min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
      <ClipboardList size={40} className="text-gray-300" />
      <div className="text-lg font-medium text-gray-700">在线填报表</div>
      <div className="max-w-sm text-sm text-gray-400">在线填报收集数据的功能即将上线，敬请期待。</div>
      <button onClick={onHome} className="mt-2 rounded-md bg-blue-600 px-4 py-1.5 text-sm text-white hover:bg-blue-700">
        返回首页
      </button>
    </div>
  );
}

function Shell() {
  const { state, updatePerson, ready } = useStore();
  const [view, setView] = useState<View>('home');
  const [editingId, setEditingId] = useState<string | null>(null);
  const router = useRouter();
  const [fsOn, setFsOn] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [draft, setDraft] = useState<Person | null>(null);
  const openProfile = () => { setDraft(me ? { ...me } : null); setShowProfile(true); };
  const saveProfile = () => {
    if (draft) { updatePerson(draft); localStorage.setItem('dn_auth', draft.name); setMeName(draft.name); setShowProfile(false); setDraft(null); }
  };

  const [meName, setMeName] = useState('');
  useEffect(() => {
    if (typeof window !== 'undefined') setMeName(localStorage.getItem('dn_auth') || '');
  }, []);
  const me = state.persons.find((p) => p.name === meName) ?? null;
  const { subject: meSubject } = resolveAuthAccount(state.stores ?? [], state.dealers ?? [], state.employees ?? [], meName, me);
  const perm = resolvePerm(me, state.config, meSubject);
  const can = (m: Parameters<typeof canView>[1]) => canView(perm, m);
  const toggleFs = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.();
      setFsOn(true);
    } else {
      document.exitFullscreen?.();
      setFsOn(false);
    }
  };
  const logout = () => {
    setMeName('');
    setView('home');
    localStorage.removeItem('dn_auth');
    router.push('/login');
  };

  const goHome = () => setView('home');
  const goRules = (t?: View) => {
    setView(t ?? 'rules');
  };

  const startNew = () => {
    if (state.tables.length === 0) {
      alert('请先在「数据表管理」中上传一张数据表，之后即可创建预警规则');
      setView('tables');
      return;
    }
    setView('new');
  };

  const startEdit = (id: string) => {
    setEditingId(id);
    setView('edit');
  };

  let content;
  if (view === 'home') {
    content = <Dashboard onGoTables={() => setView('tables')} onGoRules={() => setView('rules')} />;
  } else if (view === 'tables') {
    content = <DataTableManager onHome={goHome} />;
  } else if (view === 'apitable') {
    content = <ApiDataPlaceholder onHome={goHome} />;
  } else if (view === 'formtable') {
    content = <FormFillPlaceholder onHome={goHome} />;
  } else if (view === 'new') {
    content = <NewRule onBack={() => goRules()} />;
  } else if (view === 'edit') {
    const rule = state.rules.find((r) => r.id === editingId);
    content = rule ? (
      <RuleConfigurator key={rule.id} draft={rule} onBack={() => goRules()} />
    ) : (
      <RuleList onNew={startNew} onEdit={startEdit} onHome={goHome} />
    );
  } else if (view === 'alerts') {
    content = <AlertList onBack={goHome} />;
  } else if (view === 'dealer') {
    content = <DealerStoreManage kind="dealer" />;
  } else if (view === 'emp') {
    content = <EmployeeManage onBack={() => setView('dealer')} />;
  } else if (view === 'store') {
    content = <DealerStoreManage kind="store" />;
  } else if (view === 'dattrs') {
    content = <AttrManage category="dealer" title="经销商属性" parent="组织架构" hint="先给属性命名，再在属性下添加子标签（如 经销商级别 / 区域 → 标签）" />;
  } else if (view === 'sattrs') {
    content = <AttrManage category="store" title="店仓属性" parent="组织架构" hint="先给属性命名，再在属性下添加子标签（如 门店类型 / 仓库 → 标签）" />;
  } else if (view === 'eattrs') {
    content = <AttrManage category="employee" title="员工属性" parent="组织架构" hint="先给属性命名，再在属性下添加子标签（如 岗位 / 喜好 → 标签）" />;
  } else if (view === 'people') {
    content = <PeopleManage />;
  } else if (view === 'attrs') {
    content = <AttrManage />;
  } else if (view === 'homecfg') {
    content = <HomeConfig onBack={() => setView('home')} />;
  } else if (view === 'perms') {
    content = <PermissionManage />;
  } else {
    content = <RuleList onNew={startNew} onEdit={startEdit} onHome={goHome} />;
  }

  // 登录态/数据未就绪时，主内容与菜单统一显示加载态，避免退出或切换账号时闪出旧首页/默认页
  const readyUI = !!meName && ready;
  const loadingUI = (
    <div className="flex h-full min-h-[240px] w-full items-center justify-center text-sm text-gray-400">
      正在加载…
    </div>
  );

  // 预警配置页（new / edit）隐藏左侧导航栏，聚焦画布编辑
  const withSidebar = view === 'home' || view === 'tables' || view === 'rules' || view === 'alerts' || view === 'people' || view === 'attrs' || view === 'dealer' || view === 'store' || view === 'dattrs' || view === 'sattrs' || view === 'emp' || view === 'eattrs' || view === 'homecfg' || view === 'perms';
  const currentView = view;

  return (
    <div className="flex h-screen w-full overflow-hidden bg-[#F7F8FA] text-gray-900">
      {/* 侧边栏 */}
      {withSidebar && (
        <aside className="flex w-56 shrink-0 flex-col border-r bg-white">
          <div className="flex items-center gap-2.5 px-4 py-4">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-600 text-white">
              <ShieldAlert size={20} />
            </span>
            <div>
              <div className="text-sm font-bold text-gray-800">预警规则平台</div>
              <div className="text-[10px] text-gray-400">Alert Rule Config</div>
            </div>
          </div>
          <nav className="flex-1 space-y-1 px-2 py-2">
            {!ready ? (
              <div className="px-3 py-3 text-xs text-gray-400">正在加载菜单…</div>
            ) : (
            <>
            <NavItem active={view === 'home'} icon={<LayoutDashboard size={17} />} label="首页" onClick={goHome} />
            {can('datatables') && (
            <div className="pt-1">
              <div className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-gray-800">
                <Table2 size={17} className="text-gray-400" />
                <span className="flex-1">数据表管理</span>
              </div>
              <NavItem
                nested
                active={currentView === 'tables'}
                icon={<span className="text-gray-400">·</span>}
                label="上传数据表"
                onClick={() => setView('tables')}
              />
              <NavItem
                nested
                active={currentView === 'apitable'}
                icon={<span className="text-gray-400">·</span>}
                label="API数据表"
                onClick={() => setView('apitable')}
              />
              <NavItem
                nested
                active={currentView === 'formtable'}
                icon={<span className="text-gray-400">·</span>}
                label="在线填报表"
                onClick={() => setView('formtable')}
              />
            </div>
            )}
            {can('rules') && (
            <NavItem
              active={currentView === 'rules' || currentView === 'new' || currentView === 'edit'}
              icon={<BellRing size={17} />}
              label="预警规则"
              onClick={() => goRules()}
            />
            )}
            {can('alerts') && (
            <NavItem
              active={currentView === 'alerts'}
              icon={<Activity size={17} />}
              label="预警列表"
              onClick={() => setView('alerts')}
            />
            )}
            {(can('dealer') || can('store') || can('dattrs') || can('sattrs')) && (
            <div className="pt-1">
              <div className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-gray-800">
                <Briefcase size={17} className="text-gray-400" />
                <span className="flex-1">组织架构</span>
              </div>
              {can('dealer') && (
              <NavItem
                nested
                active={currentView === 'dealer'}
                icon={<span className="text-gray-400">·</span>}
                label="经销商管理"
                onClick={() => setView('dealer')}
              />
              )}
              {can('dattrs') && (
              <NavItem
                nested
                active={currentView === 'dattrs'}
                icon={<span className="text-gray-400">·</span>}
                label="经销商属性"
                onClick={() => setView('dattrs')}
              />
              )}
              {can('store') && (
              <NavItem
                nested
                active={currentView === 'store'}
                icon={<span className="text-gray-400">·</span>}
                label="店仓管理"
                onClick={() => setView('store')}
              />
              )}
              {can('sattrs') && (
              <NavItem
                nested
                active={currentView === 'sattrs'}
                icon={<span className="text-gray-400">·</span>}
                label="店仓属性"
                onClick={() => setView('sattrs')}
              />
              )}
              {can('dealer') && (
              <NavItem
                nested
                active={currentView === 'emp'}
                icon={<span className="text-gray-400">·</span>}
                label="员工管理"
                onClick={() => setView('emp')}
              />
              )}
              {can('dealer') && (
              <NavItem
                nested
                active={currentView === 'eattrs'}
                icon={<span className="text-gray-400">·</span>}
                label="员工属性"
                onClick={() => setView('eattrs')}
              />
              )}
            </div>
            )}
            {(can('people') || can('attrs')) && (
            <div className="pt-1">
              <div className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-gray-800">
                <Users size={17} className="text-gray-400" />
                <span className="flex-1">人事管理</span>
              </div>
              {can('people') && (
              <NavItem
                nested
                active={currentView === 'people'}
                icon={<span className="text-gray-400">·</span>}
                label="用户管理"
                onClick={() => setView('people')}
              />
              )}
              {can('attrs') && (
              <NavItem
                nested
                active={currentView === 'attrs'}
                icon={<span className="text-gray-400">·</span>}
                label="属性管理"
                onClick={() => setView('attrs')}
              />
              )}
            </div>
            )}

            {/* 系统管理 */}
            <div className="pt-1">
              <div className="mb-1 flex items-center gap-1.5 px-3 py-1">
                <Settings size={14} className="text-gray-500" />
                <span className="flex-1 text-xs font-medium text-gray-500">系统管理</span>
              </div>
              {can('homecfg') && (
              <NavItem
                active={currentView === 'homecfg'}
                icon={<LayoutDashboard size={15} />}
                label="首页管理"
                nested
                onClick={() => setView('homecfg')}
              />
              )}
              {can('perms') && (
              <NavItem
                active={currentView === 'perms'}
                icon={<Shield size={15} />}
                label="权限管理"
                nested
                onClick={() => setView('perms')}
              />
              )}
            </div>
            </>
            )}
          </nav>
          <div className="border-t p-3 text-[10px] leading-relaxed text-gray-400">
            将数据表标签化字段，拖拽构建可视化规则，自定义触发调度与通知对象，并跟踪每次执行。
          </div>
        </aside>
      )}

      {/* 主内容 */}
      {withSidebar ? (
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-12 shrink-0 items-center justify-end gap-2 border-b bg-white px-4">
            <button
              onClick={toggleFs}
              title={fsOn ? '退出全屏' : '全屏'}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-600 hover:bg-gray-100"
            >
              {fsOn ? <Minimize size={17} /> : <Maximize size={17} />}
            </button>
            <div className="relative">
              <button
                onClick={() => setMenuOpen((o) => !o)}
                title="账号"
                className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-600 text-sm font-semibold text-white hover:ring-2 hover:ring-blue-200"
              >
                {(me?.name || meName || '用').slice(0, 1)}
              </button>
              {menuOpen && (
                <div className="absolute right-0 top-10 z-30 w-44 rounded-lg border bg-white p-1 shadow-lg">
                  <div className="border-b px-3 py-1.5 text-xs text-gray-400">
                    {`${me?.name || meName}${me?.username ? ` · ${me.username}` : ''}`}
                  </div>
                  <button
                    onClick={() => { setMenuOpen(false); openProfile(); }}
                    className="block w-full rounded-md px-3 py-1.5 text-left text-sm hover:bg-gray-50"
                  >
                    修改资料
                  </button>
                  <button
                    onClick={logout}
                    className="flex w-full items-center gap-1.5 rounded-md px-3 py-1.5 text-left text-sm text-red-600 hover:bg-red-50"
                  >
                    <LogOut size={14} /> 退出系统
                  </button>
                </div>
              )}
            </div>
          </header>
          <main className="min-w-0 flex-1 overflow-auto">{readyUI ? content : loadingUI}</main>
        </div>
      ) : (
        <main className="min-w-0 flex-1">{readyUI ? content : loadingUI}</main>
      )}

      {showProfile && draft && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-96 rounded-xl bg-white p-5 shadow-xl">
            <h3 className="mb-4 text-base font-semibold">修改资料</h3>
            <div className="space-y-3">
              {[
                ['姓名', 'name'],
                ['账号', 'username'],
                ['职位', 'title'],
                ['岗位', 'post'],
                ['手机', 'phone'],
                ['邮箱', 'email'],
                ['地址', 'address'],
                ['生日', 'birthday'],
              ].map(([label, key]) => (
                <label key={key} className="flex items-center gap-3 text-sm">
                  <span className="w-12 shrink-0 text-gray-500">{label}</span>
                  <input
                    value={(draft as unknown as Record<string, string>)[key] ?? ''}
                    onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
                    className="flex-1 rounded-md border px-2 py-1.5 outline-none focus:border-blue-400"
                  />
                </label>
              ))}
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setShowProfile(false)} className="rounded-md px-4 py-1.5 text-sm text-gray-500 hover:bg-gray-100">
                取消
              </button>
              <button onClick={saveProfile} className="rounded-md bg-blue-600 px-4 py-1.5 text-sm text-white hover:bg-blue-700">
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function NavItem({
  active,
  icon,
  label,
  badge,
  onClick,
  nested,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  badge?: number;
  onClick: () => void;
  nested?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 rounded-lg py-2 text-sm transition ${
        nested ? 'pl-8 pr-3' : 'px-3'
      } ${active ? 'bg-blue-50 font-medium text-blue-700' : 'text-gray-600 hover:bg-gray-50'}`}
    >
      <span className={active ? 'text-blue-600' : 'text-gray-400'}>{icon}</span>
      <span className="flex-1 text-left">{label}</span>
      {typeof badge === 'number' && badge > 0 && (
        <span className="rounded-full bg-blue-600 px-1.5 py-0.5 text-[10px] text-white">{badge}</span>
      )}
    </button>
  );
}

export default function Home() {
  const router = useRouter();
  useEffect(() => {
    if (typeof window !== 'undefined' && !localStorage.getItem('dn_auth')) router.replace('/login');
  }, [router]);
  return (
    <StoreProvider>
      <Shell />
      <Toaster position="top-center" richColors closeButton />
    </StoreProvider>
  );
}