'use client';

import { useState } from 'react';
import { Plus, Trash2, Tags } from 'lucide-react';
import { useStore } from '@/lib/store';
import type { AttrCategory, HrAttribute } from '@/lib/types';
import { toast } from 'sonner';

function genItemId() {
  return 'itm_' + Math.random().toString(36).slice(2, 10);
}

type AttrManageProps = {
  category?: AttrCategory;
  title?: string;
  parent?: string;
  hint?: string;
};

export function AttrManage({
  category = 'person',
  title = '属性管理',
  parent = '人事管理',
  hint = '先给属性命名，再在属性下添加子标签（如 职位管理 → 职位标签）',
}: AttrManageProps) {
  const { state, addHrAttribute, updateHrAttribute, removeHrAttribute } = useStore();
  const { hrAttributes } = state;
  const [filter, setFilter] = useState('');
  const attrs = hrAttributes.filter((a) => (a.category ?? 'person') === category);
  const sorted = [...attrs].sort((a, b) => a.sort - b.sort || a.createdAt - b.createdAt).filter((x) => !filter || x.name.includes(filter));

  const addAttr = () => {
    const name = prompt('请输入属性名称（如：职位管理 / 岗位管理 / 部门管理）');
    if (!name?.trim()) return;
    addHrAttribute({ name: name.trim(), items: [], sort: attrs.length, category });
    toast.success('已新增属性');
  };

  const addItem = (attr: HrAttribute) => {
    const label = prompt(`请输入「${attr.name}」下的标签名称`);
    if (!label?.trim()) return;
    updateHrAttribute({ ...attr, items: [...attr.items, { id: genItemId(), name: label.trim() }] });
  };

  const delItem = (attr: HrAttribute, id: string) => {
    updateHrAttribute({ ...attr, items: attr.items.filter((i) => i.id !== id) });
  };

  const renameItem = (attr: HrAttribute, id: string) => {
    const item = attr.items.find((i) => i.id === id);
    const n = prompt('重命名标签', item?.name || '');
    if (n?.trim()) updateHrAttribute({ ...attr, items: attr.items.map((i) => (i.id === id ? { ...i, name: n.trim() } : i)) });
  };

  const moveItem = (attr: HrAttribute, idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    if (target < 0 || target >= attr.items.length) return;
    const items = [...attr.items];
    const t = items[idx];
    items[idx] = items[target];
    items[target] = t;
    updateHrAttribute({ ...attr, items });
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto px-8 pb-10 pt-6">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-1.5 text-xs text-gray-400">
            <span className="text-gray-500">系统管理</span>
            <span>/</span>
            <span className="text-gray-500">{parent}</span>
            <span>/</span>
            <span>{title}</span>
          </div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-gray-900">{title}</h1>
          <p className="mt-1 text-sm text-gray-400">{hint}</p>
        </div>
        <button
          onClick={addAttr}
          className="inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-700"
        >
          <Plus size={15} />
          新增属性
        </button>
      </header>

      {sorted.length === 0 && (
        <div className="flex h-[320px] flex-col items-center justify-center rounded-xl border border-dashed border-gray-200 text-center text-sm text-gray-400">
          <Tags size={28} strokeWidth={1.4} className="mb-3 text-gray-300" />
          暂无属性，点击右上角「新增属性」开始配置
        </div>
      )}

      {hrAttributes.length > 0 && (
        <div className="mb-4">
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="搜索属性…"
            className="w-64 rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-gray-900"
          />
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {sorted.map((attr) => (
          <div key={attr.id} className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="flex items-center justify-between border-b border-gray-100 pb-2">
              <span className="text-sm font-semibold text-gray-800">{attr.name}</span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => {
                    const n = prompt('重命名属性标题', attr.name);
                    if (n?.trim()) updateHrAttribute({ ...attr, name: n.trim() });
                  }}
                  className="rounded-md border border-gray-200 px-2 py-0.5 text-[11px] text-gray-500 hover:bg-gray-50"
                  title="重命名属性"
                >
                  ✎ 改名
                </button>
                <button
                  onClick={() => addItem(attr)}
                  className="rounded-md border border-gray-200 px-2 py-0.5 text-[11px] text-gray-500 hover:bg-gray-50"
                >
                  + 标签
                </button>
                <button
                  onClick={() => {
                    if (confirm(`确定删除属性「${attr.name}」及其全部标签？`)) {
                      removeHrAttribute(attr.id);
                      toast.success('已删除属性');
                    }
                  }}
                  className="rounded-md p-1 text-gray-300 hover:text-red-500"
                  title="删除属性"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
            <div className="mt-3 space-y-1">
              {(attr.items || []).map((it, idx) => (
                <div key={it.id} className="flex items-center gap-1.5 rounded-md bg-gray-50 px-2 py-1 text-xs text-gray-700">
                  <span className="w-4 shrink-0 text-center text-[10px] text-gray-400">{idx + 1}</span>
                  <span className="flex-1 truncate">{it.name}</span>
                  <button
                    onClick={() => moveItem(attr, idx, -1)}
                    disabled={idx === 0}
                    className="text-gray-400 hover:text-gray-700 disabled:opacity-30"
                    title="左移"
                  >
                    ‹
                  </button>
                  <button
                    onClick={() => moveItem(attr, idx, 1)}
                    disabled={idx === (attr.items || []).length - 1}
                    className="text-gray-400 hover:text-gray-700 disabled:opacity-30"
                    title="右移"
                  >
                    ›
                  </button>
                  <button onClick={() => renameItem(attr, it.id)} className="text-gray-400 hover:text-gray-700" title="重命名标签">
                    ✎
                  </button>
                  <button
                    onClick={() => {
                      if (confirm(`确认删除标签「${it.name}」？`)) delItem(attr, it.id);
                    }}
                    className="text-gray-400 hover:text-red-500"
                    title="删除标签"
                  >
                    ×
                  </button>
                </div>
              ))}
              {(attr.items || []).length === 0 && <span className="text-xs text-gray-300">暂无标签</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}