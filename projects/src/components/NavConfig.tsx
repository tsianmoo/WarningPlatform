'use client';
import { ArrowDown, ArrowUp, ListOrdered } from 'lucide-react';
import { useStore } from '@/lib/store';
import { DEFAULT_NAV_MENUS, NavMenuEntry } from '@/lib/types';

export default function NavConfig({ onHome }: { onHome: () => void }) {
  const { state, updateHomeConfig } = useStore();
  const menus: NavMenuEntry[] = state.config.navMenus?.length ? state.config.navMenus : DEFAULT_NAV_MENUS;

  const rename = (i: number, label: string) => {
    const next = menus.map((m, idx) => (idx === i ? { ...m, label } : m));
    updateHomeConfig((c) => ({ ...c, navMenus: next }));
  };
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= menus.length) return;
    const next = menus.slice();
    const [it] = next.splice(i, 1);
    next.splice(j, 0, it);
    updateHomeConfig((c) => ({ ...c, navMenus: next }));
  };

  return (
    <div className="h-full w-full overflow-y-auto bg-[#F7F8FA]">
      <div className="mx-auto max-w-3xl p-6">
        <div className="mb-5 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-600 text-white">
            <ListOrdered size={20} />
          </span>
          <div>
            <h1 className="text-lg font-bold text-gray-800">导航栏管理</h1>
            <p className="text-xs text-gray-400">修改左侧导航菜单的名称，或上移/下移调整菜单位置，保存后左侧导航实时生效。</p>
          </div>
        </div>
        <div className="space-y-2">
          {menus.map((m, i) => (
            <div key={m.key} className="flex items-center gap-3 rounded-xl border border-gray-100 bg-white p-3 shadow-sm">
              <span className="w-6 shrink-0 text-center text-xs text-gray-300">{i + 1}</span>
              <input
                value={m.label}
                onChange={(e) => rename(i, e.target.value)}
                className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-400"
              />
              <div className="flex gap-1">
                <button
                  onClick={() => move(i, -1)}
                  disabled={i === 0}
                  title="上移"
                  className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 disabled:opacity-30"
                >
                  <ArrowUp size={16} />
                </button>
                <button
                  onClick={() => move(i, 1)}
                  disabled={i === menus.length - 1}
                  title="下移"
                  className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 disabled:opacity-30"
                >
                  <ArrowDown size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>
        <button onClick={onHome} className="mt-6 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm text-gray-600 hover:bg-gray-50">
          ← 返回
        </button>
      </div>
    </div>
  );
}