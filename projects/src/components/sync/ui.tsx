'use client';

import { createContext, useCallback, useContext, useMemo, useState } from 'react';

/** 数据同步权限门禁：容器注入 can(op) 回调（op: create/edit/delete/run/download/view） */
export const PermCtx = createContext<(op: string) => boolean>(() => true);
export const usePerm = () => useContext(PermCtx);

export const inputCls =
  'w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 bg-white';
export const btnPrimary =
  'inline-flex items-center gap-1 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50';
export const btnGhost =
  'inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50';

export function Field({ label, children, className = '' }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-xs font-medium text-gray-600">{label}</span>
      {children}
    </label>
  );
}

export function Badge({ color = 'gray', children }: { color?: 'green' | 'red' | 'yellow' | 'gray' | 'blue'; children: React.ReactNode }) {
  const map: Record<string, string> = {
    green: 'bg-green-100 text-green-700',
    red: 'bg-red-100 text-red-700',
    yellow: 'bg-yellow-100 text-yellow-700',
    blue: 'bg-blue-100 text-blue-700',
    gray: 'bg-gray-200 text-gray-600',
  };
  return <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ${map[color]}`}>{children}</span>;
}

/** 轻量弹窗 */
export function Modal({ title, open, onClose, children, wide }: { title: string; open: boolean; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div
        className={`flex max-h-[90vh] w-full flex-col overflow-hidden rounded-lg bg-white shadow-xl ${wide ? 'max-w-4xl' : 'max-w-2xl'}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-2.5">
          <h3 className="text-sm font-semibold text-gray-800">{title}</h3>
          <button onClick={onClose} className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600">✕</button>
        </div>
        <div className="overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  );
}

/** 简单 toast：push 用 useCallback 稳定化，避免作为 useEffect/useCallback 依赖时每次渲染变化导致无限循环 */
export function useToast() {
  const [toasts, setToasts] = useState<{ id: number; msg: string; kind: 'ok' | 'err' }[]>([]);
  const push = useCallback((msg: string, kind: 'ok' | 'err' = 'ok') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, msg, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
  }, []);
  return useMemo(
    () => ({
      toast: push,
      ToastView: toasts.length ? (
        <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2">
          {toasts.map((t) => (
            <div key={t.id} className={`rounded-md px-3 py-2 text-sm text-white shadow-lg ${t.kind === 'ok' ? 'bg-green-600' : 'bg-red-600'}`}>
              {t.msg}
            </div>
          ))}
        </div>
      ) : null,
    }),
    [push, toasts]
  );
}

export function Empty({ text }: { text: string }) {
  return <div className="py-12 text-center text-sm text-gray-400">{text}</div>;
}