'use client';

import { useState } from 'react';
import { Table2, BellRing, ShieldAlert, LayoutDashboard, Activity } from 'lucide-react';
import { StoreProvider, useStore } from '@/lib/store';
import { DataTableManager } from '@/components/DataTableManager';
import { RuleList } from '@/components/RuleList';
import { NewRule, RuleConfigurator } from '@/components/RuleConfigurator';
import { Dashboard } from '@/components/Dashboard';
import { Toaster } from 'sonner';
import { AlertList } from '@/components/AlertList';

type View = 'home' | 'tables' | 'rules' | 'new' | 'edit' | 'alerts';

function Shell() {
  const { state } = useStore();
  const [view, setView] = useState<View>('home');
  const [editingId, setEditingId] = useState<string | null>(null);

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
  } else {
    content = <RuleList onNew={startNew} onEdit={startEdit} onHome={goHome} />;
  }

  // 预警配置页（new / edit）隐藏左侧导航栏，聚焦画布编辑
  const withSidebar = view === 'home' || view === 'tables' || view === 'rules' || view === 'alerts';
  const currentView = view;
  const pendingAlerts = state.alerts.filter((a) => a.status === 'new' || a.status === 'processing').length;

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
            <NavItem active={view === 'home'} icon={<LayoutDashboard size={17} />} label="首页" onClick={goHome} />
            <NavItem active={currentView === 'tables'} icon={<Table2 size={17} />} label="数据表管理" onClick={() => setView('tables')} />
            <NavItem
              active={currentView === 'rules' || currentView === 'new' || currentView === 'edit'}
              icon={<BellRing size={17} />}
              label="预警规则"
              badge={state.rules.length}
              onClick={() => goRules()}
            />
            <NavItem
              active={currentView === 'alerts'}
              icon={<Activity size={17} />}
              label="预警列表"
              badge={pendingAlerts}
              onClick={() => setView('alerts')}
            />
          </nav>
          <div className="border-t p-3 text-[10px] leading-relaxed text-gray-400">
            将数据表标签化字段，拖拽构建可视化规则，自定义触发调度与通知对象，并跟踪每次执行。
          </div>
        </aside>
      )}

      {/* 主内容 */}
      <main className="min-w-0 flex-1">{content}</main>
    </div>
  );
}

function NavItem({
  active,
  icon,
  label,
  badge,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  badge?: number;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition ${
        active ? 'bg-blue-50 font-medium text-blue-700' : 'text-gray-600 hover:bg-gray-50'
      }`}
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
  return (
    <StoreProvider>
      <Shell />
      <Toaster position="top-center" richColors closeButton />
    </StoreProvider>
  );
}