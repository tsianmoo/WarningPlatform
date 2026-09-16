'use client';

import { useEffect, useState, Fragment } from 'react';
import type { Person } from '@/lib/types';
import { useRouter } from 'next/navigation';
import { Table2, BellRing, Shield, LayoutDashboard, Activity, Briefcase, Users, Settings, Maximize, Minimize, LogOut, UploadCloud, ClipboardList, ChevronRight, ListOrdered, Settings2 } from 'lucide-react';
import { StoreProvider, useStore } from '@/lib/store';
import { DEFAULT_HOME_CONFIG, DEFAULT_NAV_MENUS, NavMenuEntry, NavMenuKey } from '@/lib/types';
import NavConfig from '@/components/NavConfig';
import BrandConfig from '@/components/BrandConfig';
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
import DataSyncPlatform from '@/components/sync/DataSyncPlatform';
import { resolvePerm, canView, resolveAuthAccount } from '@/lib/perm';

type View = 'home' | 'tables' | 'apitable' | 'formtable' | 'rules' | 'new' | 'edit' | 'alerts' | 'people' | 'attrs' | 'dealer' | 'store' | 'dattrs' | 'sattrs' | 'emp' | 'eattrs' | 'homecfg' | 'perms' | 'navcfg' | 'brandcfg';

function hexToRgba(hex: string, alpha: number): string {
  const h = (hex || '#000000').replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  if (Number.isNaN(n)) return `rgba(0,0,0,${alpha})`;
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
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
  const navMenus: NavMenuEntry[] = state.config.navMenus?.length ? state.config.navMenus : DEFAULT_NAV_MENUS;
  const brand = state.config.brand || DEFAULT_HOME_CONFIG.brand;
  const VIEWS = ['home', 'tables', 'apitable', 'formtable', 'rules', 'new', 'edit', 'alerts', 'people', 'attrs', 'dealer', 'store', 'dattrs', 'sattrs', 'emp', 'eattrs', 'homecfg', 'perms', 'navcfg', 'brandcfg'] as const;
  const CRUMBS: Record<string, string[]> = {
    home: ['工作台'],
    tables: ['工作台', '数据表管理', '上传数据表'],
    apitable: ['工作台', '数据表管理', 'API数据表'],
    formtable: ['工作台', '数据表管理', '在线填报表'],
    rules: ['工作台', '预警规则'],
    new: ['工作台', '预警规则', '新建预警'],
    edit: ['工作台', '预警规则', '编辑预警'],
    alerts: ['工作台', '预警列表'],
    dealer: ['工作台', '组织架构', '经销商管理'],
    dattrs: ['工作台', '组织架构', '经销商属性'],
    store: ['工作台', '组织架构', '店仓管理'],
    sattrs: ['工作台', '组织架构', '店仓属性'],
    emp: ['工作台', '组织架构', '员工管理'],
    eattrs: ['工作台', '组织架构', '员工属性'],
    people: ['工作台', '人事管理', '用户管理'],
    attrs: ['工作台', '人事管理', '属性管理'],
    homecfg: ['工作台', '系统管理', '首页管理'],
    navcfg: ['工作台', '系统管理', '导航栏管理'],
    brandcfg: ['工作台', '系统管理', '基础信息管理'],
    perms: ['工作台', '系统管理', '权限管理'],
  };
  const [view, setView] = useState<View>(() => {
    if (typeof window === 'undefined') return 'home';
    const h = window.location.hash.replace(/^#/, '');
    return (VIEWS as readonly string[]).includes(h) ? (h as View) : 'home';
  });
  useEffect(() => {
    const onHash = () => {
      const h = window.location.hash.replace(/^#/, '');
      if ((VIEWS as readonly string[]).includes(h)) setView(h as View);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const navigate = (v: View) => {
    setView(v);
    if (typeof window !== 'undefined' && window.location.hash !== '#' + v) window.location.hash = v;
  };
  const [editingId, setEditingId] = useState<string | null>(null);
  const router = useRouter();
  const [fsOn, setFsOn] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const toggleGroup = (g: string) => setOpenGroup((cur) => (cur === g ? null : g));
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
    navigate('home');
    localStorage.removeItem('dn_auth');
    router.push('/login');
  };

  const goHome = () => navigate('home');
  const goRules = (t?: View) => {
    navigate(t ?? 'rules');
  };

  const startNew = () => {
    if (state.tables.length === 0) {
      alert('请先在「数据表管理」中上传一张数据表，之后即可创建预警规则');
      navigate('tables');
      return;
    }
    navigate('new');
  };

  const startEdit = (id: string) => {
    setEditingId(id);
    navigate('edit');
  };

  let content;
  if (view === 'home') {
    content = <Dashboard />;
  } else if (view === 'tables') {
    content = <DataTableManager />;
  } else if (view === 'apitable') {
    content = <DataSyncPlatform />;
  } else if (view === 'formtable') {
    content = <FormFillPlaceholder onHome={goHome} />;
  } else if (view === 'new') {
    content = <NewRule onBack={() => goRules()} meName={meName} />;
  } else if (view === 'edit') {
    const rule = state.rules.find((r) => r.id === editingId);
    content = rule ? (
      <RuleConfigurator key={rule.id} draft={rule} onBack={() => goRules()} meName={meName} />
    ) : (
      <RuleList onNew={startNew} onEdit={startEdit} />
    );
  } else if (view === 'alerts') {
    content = <AlertList />;
  } else if (view === 'dealer') {
    content = <DealerStoreManage kind="dealer" />;
  } else if (view === 'emp') {
    content = <EmployeeManage onBack={() => navigate('dealer')} />;
  } else if (view === 'store') {
    content = <DealerStoreManage kind="store" />;
  } else if (view === 'dattrs') {
    content = <AttrManage category="dealer" />;
  } else if (view === 'sattrs') {
    content = <AttrManage category="store" />;
  } else if (view === 'eattrs') {
    content = <AttrManage category="employee" />;
  } else if (view === 'people') {
    content = <PeopleManage />;
  } else if (view === 'attrs') {
    content = <AttrManage />;
  } else if (view === 'homecfg') {
    content = <HomeConfig onBack={() => navigate('home')} />;
  } else if (view === 'perms') {
    content = <PermissionManage />;
  } else if (view === 'navcfg') {
    content = <NavConfig onHome={() => navigate('home')} />;
  } else if (view === 'brandcfg') {
    content = <BrandConfig onHome={() => navigate('home')} />;
  } else {
    content = <RuleList onNew={startNew} onEdit={startEdit} />;
  }

  // 登录态/数据未就绪时，主内容与菜单统一显示加载态，避免退出或切换账号时闪出旧首页/默认页
  const readyUI = !!meName && ready;
  const loadingUI = (
    <div className="flex h-full min-h-[240px] w-full items-center justify-center text-sm text-gray-400">
      正在加载…
    </div>
  );

  // 预警配置页（new / edit）隐藏左侧导航栏，聚焦画布编辑
  const withSidebar = view === 'home' || view === 'tables' || view === 'rules' || view === 'alerts' || view === 'people' || view === 'attrs' || view === 'dealer' || view === 'store' || view === 'dattrs' || view === 'sattrs' || view === 'emp' || view === 'eattrs' || view === 'homecfg' || view === 'perms' || view === 'navcfg' || view === 'brandcfg';
  const currentView = view;

  const renderMenu = (key: NavMenuKey, label: string): React.ReactNode => {
    switch (key) {
      case 'home':
        return <NavItem active={view === 'home'} icon={<LayoutDashboard size={18} strokeWidth={1.75} />} label={label} onClick={goHome} />;
      case 'rules':
        return can('rules') ? (
          <NavItem active={currentView === 'rules' || currentView === 'new' || currentView === 'edit'} icon={<BellRing size={18} strokeWidth={1.75} />} label={label} onClick={() => goRules()} />
        ) : null;
      case 'alerts':
        return can('alerts') ? (
          <NavItem active={currentView === 'alerts'} icon={<Activity size={18} strokeWidth={1.75} />} label={label} onClick={() => navigate('alerts')} />
        ) : null;
      case 'datatables':
        return can('datatables') ? (
          <div className="pt-1">
            <button onClick={() => toggleGroup('datatables')} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] font-medium text-gray-800 hover:bg-gray-50">
              <Table2 size={17} strokeWidth={1.75} className="text-gray-400" />
              <span className="flex-1">{label}</span>
              <ChevronRight size={16} className={`text-gray-400 transition-transform ${openGroup === 'datatables' ? 'rotate-90' : ''}`} />
            </button>
            {openGroup === 'datatables' && (
              <>
                <NavItem nested active={currentView === 'tables'} icon={<span className="text-gray-400">·</span>} label="上传数据表" onClick={() => navigate('tables')} />
                <NavItem nested active={currentView === 'apitable'} icon={<span className="text-gray-400">·</span>} label="API数据表" onClick={() => navigate('apitable')} />
                <NavItem nested active={currentView === 'formtable'} icon={<span className="text-gray-400">·</span>} label="在线填报表" onClick={() => navigate('formtable')} />
              </>
            )}
          </div>
        ) : null;
      case 'org':
        return can('dealer') || can('store') || can('dattrs') || can('sattrs') ? (
          <div className="pt-1">
            <button onClick={() => toggleGroup('org')} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] font-medium text-gray-800 hover:bg-gray-50">
              <Briefcase size={17} strokeWidth={1.75} className="text-gray-400" />
              <span className="flex-1">{label}</span>
              <ChevronRight size={16} className={`text-gray-400 transition-transform ${openGroup === 'org' ? 'rotate-90' : ''}`} />
            </button>
            {openGroup === 'org' && (
              <>
                {can('dealer') && <NavItem nested active={currentView === 'dealer'} icon={<span className="text-gray-400">·</span>} label="经销商管理" onClick={() => navigate('dealer')} />}
                {can('dattrs') && <NavItem nested active={currentView === 'dattrs'} icon={<span className="text-gray-400">·</span>} label="经销商属性" onClick={() => navigate('dattrs')} />}
                {can('store') && <NavItem nested active={currentView === 'store'} icon={<span className="text-gray-400">·</span>} label="店仓管理" onClick={() => navigate('store')} />}
                {can('sattrs') && <NavItem nested active={currentView === 'sattrs'} icon={<span className="text-gray-400">·</span>} label="店仓属性" onClick={() => navigate('sattrs')} />}
                {can('dealer') && <NavItem nested active={currentView === 'emp'} icon={<span className="text-gray-400">·</span>} label="员工管理" onClick={() => navigate('emp')} />}
                {can('dealer') && <NavItem nested active={currentView === 'eattrs'} icon={<span className="text-gray-400">·</span>} label="员工属性" onClick={() => navigate('eattrs')} />}
              </>
            )}
          </div>
        ) : null;
      case 'hr':
        return can('people') || can('attrs') ? (
          <div className="pt-1">
            <button onClick={() => toggleGroup('hr')} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] font-medium text-gray-800 hover:bg-gray-50">
              <Users size={17} strokeWidth={1.75} className="text-gray-400" />
              <span className="flex-1">{label}</span>
              <ChevronRight size={16} className={`text-gray-400 transition-transform ${openGroup === 'hr' ? 'rotate-90' : ''}`} />
            </button>
            {openGroup === 'hr' && (
              <>
                {can('people') && <NavItem nested active={currentView === 'people'} icon={<span className="text-gray-400">·</span>} label="用户管理" onClick={() => navigate('people')} />}
                {can('attrs') && <NavItem nested active={currentView === 'attrs'} icon={<span className="text-gray-400">·</span>} label="属性管理" onClick={() => navigate('attrs')} />}
              </>
            )}
          </div>
        ) : null;
      case 'sys':
        return (
          <div className="pt-1">
            <button onClick={() => toggleGroup('sys')} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] font-medium text-gray-800 hover:bg-gray-50">
              <Settings size={17} strokeWidth={1.75} className="text-gray-400" />
              <span className="flex-1">{label}</span>
              <ChevronRight size={16} className={`text-gray-400 transition-transform ${openGroup === 'sys' ? 'rotate-90' : ''}`} />
            </button>
            {openGroup === 'sys' && (
              <>
                <NavItem active={currentView === 'navcfg'} icon={<ListOrdered size={16} strokeWidth={1.75} />} label="导航栏管理" nested onClick={() => navigate('navcfg')} />
                {can('homecfg') && <NavItem active={currentView === 'homecfg'} icon={<LayoutDashboard size={16} strokeWidth={1.75} />} label="首页管理" nested onClick={() => navigate('homecfg')} />}
                <NavItem active={currentView === 'brandcfg'} icon={<Settings2 size={16} strokeWidth={1.75} />} label="基础信息管理" nested onClick={() => navigate('brandcfg')} />
                {can('perms') && <NavItem active={currentView === 'perms'} icon={<Shield size={16} strokeWidth={1.75} />} label="权限管理" nested onClick={() => navigate('perms')} />}
              </>
            )}
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="flex h-screen w-full overflow-hidden bg-[#F7F8FA] text-gray-900">
      {/* 侧边栏 */}
      {withSidebar && (
        <aside className="flex w-56 shrink-0 flex-col border-r bg-white">
          <div className="flex items-center px-4 py-5">
            {brand.logo && <img src={brand.logo} alt="logo" className="mr-2 h-7 w-7 object-contain" />}
            <div
              className="truncate"
              style={{
                fontFamily: brand.font || 'system-ui',
                fontSize: brand.size || 15,
                fontWeight: brand.weight || 700,
                letterSpacing: (brand.letterSpacing || 0) + 'px',
                color: hexToRgba(brand.color || '#000000', brand.opacity ?? 1),
              }}
            >
              {brand.text || 'DIANNIU.YJ'}
            </div>
          </div>
          <nav className="flex-1 space-y-1 px-2 py-2">
            {!ready ? (
              <div className="px-3 py-3 text-xs text-gray-400">正在加载菜单…</div>
            ) : (
            <>
            {navMenus.map((m) => <Fragment key={m.key}>{renderMenu(m.key, m.label)}</Fragment>)}
            </>
            )}
          </nav>
        </aside>
      )}

      {/* 主内容 */}
      <main className={`min-w-0 flex-1 ${withSidebar ? 'overflow-auto' : ''}`}>
        {readyUI && withSidebar && (
          <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-200 bg-white pl-5 pr-3 py-2">
            <div className="flex items-center gap-1.5 text-[13px]">
              {(CRUMBS[view] ?? [view]).map((c, i, arr) => (
                <Fragment key={i}>
                  {i > 0 && <span className="text-gray-300">/</span>}
                  <span className={i === arr.length - 1 ? 'font-medium text-gray-700' : 'text-gray-400'}>{c}</span>
                </Fragment>
              ))}
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={toggleFs}
                title={fsOn ? '退出全屏' : '全屏'}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-gray-600 hover:bg-gray-100"
              >
                {fsOn ? <Minimize size={16} /> : <Maximize size={16} />}
              </button>
              <div className="relative">
                <button
                  onClick={() => setMenuOpen((o) => !o)}
                  title="账号"
                  className="flex items-center gap-1.5 rounded-lg px-2 py-1 hover:bg-gray-100"
                >
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-semibold text-white">
                    {(me?.name || meName || '用').slice(0, 1)}
                  </span>
                  <span className="max-w-[120px] truncate text-left text-sm text-gray-700">
                    {me?.name || meName || '未登录'}
                  </span>
                </button>
                {menuOpen && (
                  <>
                    <div className="fixed inset-0 z-30" onClick={() => setMenuOpen(false)} />
                    <div className="absolute right-0 top-full z-40 mt-1 w-44 rounded-lg border bg-white p-1 shadow-lg">
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
                  </>
                )}
              </div>
            </div>
          </div>
        )}
        {readyUI ? content : loadingUI}
      </main>

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
      className={`flex w-full items-center gap-2.5 rounded-lg py-2 text-[13px] transition ${
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