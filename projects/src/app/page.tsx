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
import ApiDataTablePage from '@/components/sync/ApiDataTablePage';
import { resolvePerm, canView, resolveAuthAccount } from '@/lib/perm';

type View = 'home' | 'tables' | 'apitable' | 'formtable' | 'rules' | 'new' | 'edit' | 'alerts' | 'people' | 'attrs' | 'dealer' | 'store' | 'emp' | 'homecfg' | 'perms' | 'navcfg' | 'brandcfg';

/** 当前登录账号（来自 /api/auth/me）。注意它和「人事档案 Person」是两回事：
 *  系统管理员只有账号、没有人事档案，所以「修改资料」不能依赖 Person 是否存在。 */
interface LoginAccount {
  id: string;
  username: string;
  displayName: string;
  subjectType: 'person' | 'dealer' | 'store' | 'employee' | 'admin';
  subjectId: string | null;
  mustChangePassword: boolean;
}

const SUBJECT_LABEL: Record<string, string> = {
  admin: '系统管理员',
  person: '员工账号',
  employee: '员工账号',
  dealer: '经销商账号',
  store: '店仓账号',
};

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
  const VIEWS = ['home', 'tables', 'apitable', 'formtable', 'rules', 'new', 'edit', 'alerts', 'people', 'attrs', 'dealer', 'store', 'emp', 'homecfg', 'perms', 'navcfg', 'brandcfg'] as const;
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
    store: ['工作台', '组织架构', '店仓管理'],
    emp: ['工作台', '组织架构', '员工管理'],
    people: ['工作台', '人事管理', '用户管理'],
    attrs: ['工作台', '人事管理', '属性管理'],
    homecfg: ['工作台', '系统管理', '首页管理'],
    navcfg: ['工作台', '系统管理', '导航栏管理'],
    brandcfg: ['工作台', '系统管理', '基础信息管理'],
    perms: ['工作台', '系统管理', '权限管理'],
  };
  // view 初始恒为 'home'（避免 SSR 与客户端首次渲染哈希不一致导致 hydration 告警），挂载后再按 URL hash 恢复视图
  const [view, setView] = useState<View>('home');
  useEffect(() => {
    const applyHash = () => {
      const h = window.location.hash.replace(/^#/, '');
      if ((VIEWS as readonly string[]).includes(h)) setView(h as View);
    };
    applyHash(); // 挂载后按当前 URL hash 恢复视图，确保 SSR 首帧与客户端一致
    window.addEventListener('hashchange', applyHash);
    return () => window.removeEventListener('hashchange', applyHash);
  }, []);
  const navigate = (v: View) => {
    setView(v);
    if (typeof window !== 'undefined' && window.location.hash !== '#' + v) window.location.hash = v;
  };
  // editingId 初始恒为 null（避免 SSR 与客户端读取 sessionStorage 不一致），挂载后再恢复；刷新/edit 恢复编辑上下文
  const [editingId, setEditingId] = useState<string | null>(null);
  const router = useRouter();
  const [fsOn, setFsOn] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const toggleGroup = (g: string) => setOpenGroup((cur) => (cur === g ? null : g));
  const [showProfile, setShowProfile] = useState(false);
  const [draft, setDraft] = useState<Person | null>(null);
  const [acct, setAcct] = useState<LoginAccount | null>(null);
  const [pwd, setPwd] = useState({ old: '', next: '', confirm: '' });
  const [pwdMsg, setPwdMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pwdBusy, setPwdBusy] = useState(false);
  // 旧版这里用 `draft` 是否为空决定弹窗是否渲染，而 draft 来自「人事档案 Person」，
  // 管理员账号没有人事档案 → 点「修改资料」弹窗一片空白。
  // 现在弹窗恒显示，账号信息与改密码不依赖 Person。
  const openProfile = () => {
    setDraft(me ? { ...me } : null);
    setPwd({ old: '', next: '', confirm: '' });
    setPwdMsg(null);
    setShowProfile(true);
    void fetch('/api/auth/me', { cache: 'no-store' })
      .then((r) => (r.ok ? (r.json() as Promise<{ account?: LoginAccount }>) : null))
      .then((j) => setAcct(j?.account ?? null))
      .catch(() => setAcct(null));
  };
  const saveProfile = () => {
    if (draft) { updatePerson(draft); localStorage.setItem('dn_auth', draft.name); setMeName(draft.name); setShowProfile(false); setDraft(null); }
  };
  const submitPassword = async () => {
    if (pwdBusy) return;
    if (!pwd.old || !pwd.next) { setPwdMsg({ ok: false, text: '请填写原密码与新密码' }); return; }
    if (pwd.next !== pwd.confirm) { setPwdMsg({ ok: false, text: '两次输入的新密码不一致' }); return; }
    setPwdBusy(true);
    try {
      const res = await fetch('/api/auth/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldPassword: pwd.old, newPassword: pwd.next }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setPwdMsg({ ok: false, text: j.error || '修改失败，请稍后重试' });
        return;
      }
      setPwd((c) => ({ ...c, old: '', next: '', confirm: '' }));
      setPwdMsg({ ok: true, text: '密码修改成功，其它设备上的登录已失效。' });
    } catch {
      setPwdMsg({ ok: false, text: '网络异常，请重试' });
    } finally {
      setPwdBusy(false);
    }
  };

  const [meName, setMeName] = useState('');
  useEffect(() => {
    if (typeof window !== 'undefined') setMeName(localStorage.getItem('dn_auth') || '');
  }, []);
  // 刷新落在 #edit 时的兜底：恢复正在编辑的规则；若无任何可编辑规则，回退到带导航/页头的规则列表页
  useEffect(() => {
    if (view !== 'edit' || !ready) return;
    const restorable = sessionStorage.getItem('dn_editing_rule');
    if (restorable && state.rules.some((r) => r.id === restorable)) {
      setEditingId(restorable);
      return;
    }
    setEditingId(null);
    navigate('rules');
  }, [view, ready]);
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
    // 关键：先让服务端销毁会话（清 dn_session Cookie + sessions 记录）。
    // 旧版只清了 localStorage 里的显示名，会话 Cookie 仍然有效，
    // 换个人打开浏览器 / 拿到 Cookie 依旧是登录态，等于没有退出。
    void fetch('/api/auth/logout', { method: 'POST', keepalive: true }).catch(() => {});
    localStorage.removeItem('dn_auth');
    localStorage.removeItem('dn_auth_type');
    localStorage.removeItem('dn_auth_id');
    localStorage.removeItem('dn_account_id');
    router.push('/login');
  };

  const goHome = () => navigate('home');
  const goRules = (t?: View) => {
    navigate(t ?? 'rules');
  };

  // 当前视图无权限时回退到第一个有权限的落地页（例如店仓账号未授权首页时直接落到预警列表）
  const viewPermitted = (v: View): boolean => {
    switch (v) {
      case 'home': return can('home');
      case 'tables': case 'apitable': case 'formtable': return can('datatables');
      case 'new': case 'edit': return can('rules');
      case 'rules': return can('rules');
      case 'alerts': return can('alerts');
      case 'dealer': return can('dealer');
      case 'store': return can('store');
      case 'emp': return can('dealer');
      case 'people': return can('people');
      case 'attrs': return can('attrs');
      case 'homecfg': return can('homecfg');
      case 'perms': return can('perms');
      case 'navcfg': return can('navcfg');
      case 'brandcfg': return can('brandcfg');
      default: return true;
    }
  };
  useEffect(() => {
    if (!viewPermitted(view)) {
      const first = (['home', 'alerts', 'rules', 'datatables', 'dealer', 'store', 'people', 'attrs', 'homecfg', 'perms', 'navcfg', 'brandcfg'] as View[]).find(viewPermitted);
      navigate(first ?? 'home');
    }
  }, [view, perm]);

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
    if (typeof window !== 'undefined') sessionStorage.setItem('dn_editing_rule', id);
    navigate('edit');
  };

  let content;
  if (!viewPermitted(view)) {
    content = null;
  } else if (view === 'home') {
    content = <Dashboard />;
  } else if (view === 'tables') {
    content = <DataTableManager />;
  } else if (view === 'apitable') {
    content = <ApiDataTablePage />;
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
    content = <BrandConfig />;
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

  // 练习场—预警配置页（new / edit）与首页管理（homecfg）隐藏左侧导航栏，聚焦画布编辑
  const withSidebar = view === 'home' || view === 'tables' || view === 'apitable' || view === 'formtable' || view === 'rules' || view === 'alerts' || view === 'people' || view === 'attrs' || view === 'dealer' || view === 'store' || view === 'emp' || view === 'perms' || view === 'navcfg' || view === 'brandcfg';
  const currentView = view;

  const renderMenu = (key: NavMenuKey, label: string): React.ReactNode => {
    switch (key) {
      case 'home':
        return can('home') ? (
          <NavItem active={view === 'home'} icon={<LayoutDashboard size={18} strokeWidth={1.75} />} label={label} onClick={goHome} />
        ) : null;
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
        return can('dealer') || can('store') ? (
          <div className="pt-1">
            <button onClick={() => toggleGroup('org')} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] font-medium text-gray-800 hover:bg-gray-50">
              <Briefcase size={17} strokeWidth={1.75} className="text-gray-400" />
              <span className="flex-1">{label}</span>
              <ChevronRight size={16} className={`text-gray-400 transition-transform ${openGroup === 'org' ? 'rotate-90' : ''}`} />
            </button>
            {openGroup === 'org' && (
              <>
                {can('dealer') && <NavItem nested active={currentView === 'dealer'} icon={<span className="text-gray-400">·</span>} label="经销商管理" onClick={() => navigate('dealer')} />}
                {can('store') && <NavItem nested active={currentView === 'store'} icon={<span className="text-gray-400">·</span>} label="店仓管理" onClick={() => navigate('store')} />}
                {can('dealer') && <NavItem nested active={currentView === 'emp'} icon={<span className="text-gray-400">·</span>} label="员工管理" onClick={() => navigate('emp')} />}
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
        return can('navcfg') || can('homecfg') || can('brandcfg') || can('perms') ? (
          <div className="pt-1">
            <button onClick={() => toggleGroup('sys')} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] font-medium text-gray-800 hover:bg-gray-50">
              <Settings size={17} strokeWidth={1.75} className="text-gray-400" />
              <span className="flex-1">{label}</span>
              <ChevronRight size={16} className={`text-gray-400 transition-transform ${openGroup === 'sys' ? 'rotate-90' : ''}`} />
            </button>
            {openGroup === 'sys' && (
              <>
                {can('navcfg') && <NavItem active={currentView === 'navcfg'} icon={<ListOrdered size={16} strokeWidth={1.75} />} label="导航栏管理" nested onClick={() => navigate('navcfg')} />}
                {can('homecfg') && <NavItem active={currentView === 'homecfg'} icon={<LayoutDashboard size={16} strokeWidth={1.75} />} label="首页管理" nested onClick={() => navigate('homecfg')} />}
                {can('brandcfg') && <NavItem active={currentView === 'brandcfg'} icon={<Settings2 size={16} strokeWidth={1.75} />} label="基础信息管理" nested onClick={() => navigate('brandcfg')} />}
                {can('perms') && <NavItem active={currentView === 'perms'} icon={<Shield size={16} strokeWidth={1.75} />} label="权限管理" nested onClick={() => navigate('perms')} />}
              </>
            )}
          </div>
        ) : null;
      default:
        return null;
    }
  };

  return (
    <div className="flex h-screen w-full overflow-hidden bg-[#F7F8FA] text-gray-900">
      {/* 侧边栏 */}
      {withSidebar && (
        <aside className="flex w-56 shrink-0 flex-col border-r bg-white">
          <div
            className="flex items-center"
            style={{
              paddingTop: brand.padding?.top ?? 20,
              paddingRight: brand.padding?.right ?? 16,
              paddingBottom: brand.padding?.bottom ?? 20,
              paddingLeft: brand.padding?.left ?? 16,
            }}
          >
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

      {showProfile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowProfile(false)}>
          <div
            className="max-h-[86vh] w-[440px] overflow-y-auto rounded-xl bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-base font-semibold">修改资料</h3>
              <button
                onClick={() => setShowProfile(false)}
                className="rounded-md px-2 py-0.5 text-lg leading-none text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                title="关闭"
              >
                ×
              </button>
            </div>

            {/* 当前登录账号：不依赖人事档案，管理员也一定有内容 */}
            <div className="mb-4 flex items-center gap-3 rounded-lg border border-gray-100 bg-gray-50/70 p-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-600 text-sm font-semibold text-white">
                {(acct?.displayName || draft?.name || meName || '用').slice(0, 1)}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-gray-800">
                  {acct?.displayName || draft?.name || meName || '—'}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-gray-400">
                  <span className="font-mono">@{acct?.username || '—'}</span>
                  <span className="rounded bg-white px-1.5 py-0.5 text-gray-500">
                    {SUBJECT_LABEL[acct?.subjectType ?? ''] ?? '登录账号'}
                  </span>
                  {acct?.mustChangePassword && (
                    <span className="rounded bg-amber-50 px-1.5 py-0.5 text-amber-600">待修改初始密码</span>
                  )}
                </div>
              </div>
            </div>

            {/* 个人资料：仅当人事档案里存在对应记录时才可编辑 */}
            {draft ? (
              <>
                <div className="mb-2 text-xs font-semibold text-gray-400">个人资料</div>
                <div className="space-y-3">
                  {([
                    ['姓名', 'name', true],
                    ['账号', 'username', true],
                    ['职位', 'title', true],
                    ['岗位', 'post', true],
                    ['手机', 'phone', true],
                    ['邮箱', 'email', false],
                    ['地址', 'address', false],
                    ['生日', 'birthday', false],
                  ] as const).map(([label, key, locked]) => (
                    <label key={key} className="flex items-center gap-3 text-sm">
                      <span className="w-20 shrink-0 text-gray-500">{label}</span>
                      <input
                        value={(draft as unknown as Record<string, string>)[key] ?? ''}
                        onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
                        readOnly={locked}
                        title={locked ? '该字段由管理员在人事管理中维护，此处不可修改' : undefined}
                        className={`flex-1 rounded-md border px-2 py-1.5 outline-none ${
                          locked
                            ? 'cursor-not-allowed border-gray-100 bg-gray-50 text-gray-400'
                            : 'focus:border-blue-400'
                        }`}
                      />
                    </label>
                  ))}
                  <div className="text-[11px] text-gray-400">
                    姓名、账号、职位、岗位、手机由管理员在「人事管理」中统一维护，如需修改请联系管理员。
                  </div>
                </div>
              </>
            ) : (
              <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50/50 p-3 text-xs leading-relaxed text-gray-500">
                当前是系统管理员账号，没有对应的人事档案，因此没有可编辑的个人资料。
                日常改密请用下方的「修改密码」。
              </div>
            )}

            {/* 修改密码：所有账号都可用 */}
            <div className="mt-5 mb-2 text-xs font-semibold text-gray-400">修改密码</div>
            <div className="space-y-3">
              {([
                ['原密码', 'old', 'current-password'],
                ['新密码', 'next', 'new-password'],
                ['确认新密码', 'confirm', 'new-password'],
              ] as const).map(([label, key, autoComplete]) => (
                <label key={key} className="flex items-center gap-3 text-sm">
                  <span className="w-20 shrink-0 text-gray-500">{label}</span>
                  <input
                    type="password"
                    autoComplete={autoComplete}
                    value={pwd[key]}
                    onChange={(e) => setPwd((c) => ({ ...c, [key]: e.target.value }))}
                    className="flex-1 rounded-md border px-2 py-1.5 outline-none focus:border-blue-400"
                  />
                </label>
              ))}
              <div className="pl-[92px] text-[11px] text-gray-400">至少 8 位，且需同时包含字母和数字</div>
              {pwdMsg && (
                <div className={`pl-[92px] text-xs ${pwdMsg.ok ? 'text-green-600' : 'text-red-500'}`}>{pwdMsg.text}</div>
              )}
            </div>

            <div className="mt-5 flex items-center justify-end gap-2">
              <button onClick={() => setShowProfile(false)} className="rounded-md px-4 py-1.5 text-sm text-gray-500 hover:bg-gray-100">
                关闭
              </button>
              {draft && (
                <button onClick={saveProfile} className="rounded-md border border-gray-200 px-4 py-1.5 text-sm text-gray-700 hover:bg-gray-50">
                  保存资料
                </button>
              )}
              <button
                onClick={() => void submitPassword()}
                disabled={pwdBusy}
                className="rounded-md bg-blue-600 px-4 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-60"
              >
                {pwdBusy ? '提交中…' : '修改密码'}
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