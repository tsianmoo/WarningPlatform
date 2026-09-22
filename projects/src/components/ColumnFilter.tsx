'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Search, X } from 'lucide-react';

/**
 * 列表列筛选下拉：支持在下拉面板内搜索选项，选中后按该列精确过滤。
 * 选项由调用方从当前列表数据取值去重后传入；value='' 表示不过滤（全部）。
 */
export function ColumnFilter({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  useEffect(() => {
    if (!open) setQ('');
  }, [open]);

  const uniq = Array.from(new Set(options.filter((o) => o !== ''))).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
  const kw = q.trim().toLowerCase();
  const hit = kw ? uniq.filter((o) => o.toLowerCase().includes(kw)) : uniq;

  return (
    <div ref={boxRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={`按「${label}」筛选`}
        className={`inline-flex h-[30px] w-40 items-center justify-between gap-1 rounded-md border px-2 text-xs outline-none ${
          value ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-gray-200 bg-white text-gray-500 hover:border-gray-300'
        }`}
      >
        <span className="flex min-w-0 items-center gap-1">
          <span className="shrink-0 text-gray-400">{label}</span>
          <span className="truncate font-medium">{value || '全部'}</span>
        </span>
        {value ? (
          <span
            role="button"
            tabIndex={-1}
            onClick={(e) => {
              e.stopPropagation();
              onChange('');
            }}
            className="shrink-0 rounded p-0.5 text-gray-400 hover:bg-gray-200 hover:text-gray-600"
          >
            <X size={12} />
          </span>
        ) : (
          <ChevronDown size={13} className="shrink-0 text-gray-400" />
        )}
      </button>

      {open && (
        <div className="absolute left-0 top-[34px] z-30 w-52 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg">
          <div className="flex items-center gap-1.5 border-b border-gray-100 px-2.5 py-2">
            <Search size={13} className="shrink-0 text-gray-400" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={`搜索${label}…`}
              className="w-full bg-transparent text-xs outline-none placeholder:text-gray-300"
            />
          </div>
          <div className="max-h-56 overflow-auto py-1">
            <button
              type="button"
              onClick={() => {
                onChange('');
                setOpen(false);
              }}
              className={`flex w-full items-center justify-between px-2.5 py-1.5 text-left text-xs hover:bg-gray-50 ${!value ? 'text-blue-600' : 'text-gray-600'}`}
            >
              全部
              {!value && <Check size={12} />}
            </button>
            {hit.map((o) => (
              <button
                key={o}
                type="button"
                onClick={() => {
                  onChange(o);
                  setOpen(false);
                }}
                className={`flex w-full items-center justify-between px-2.5 py-1.5 text-left text-xs hover:bg-gray-50 ${value === o ? 'text-blue-600' : 'text-gray-600'}`}
              >
                <span className="truncate">{o}</span>
                {value === o && <Check size={12} className="shrink-0" />}
              </button>
            ))}
            {hit.length === 0 && <div className="px-2.5 py-3 text-center text-xs text-gray-300">无匹配选项</div>}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * 登录开关：开启 = 允许该档案的登录账号登录；关闭 = 账号立即停用（现有会话一并失效）。
 */
export function LoginToggle({
  checked,
  disabled,
  title = '允许登录',
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  title?: string;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={title}
      title={checked ? `${title}（点击关闭）` : `${title}（点击开启）`}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!checked);
      }}
      className={`relative inline-flex h-[18px] w-[34px] shrink-0 items-center rounded-full transition-colors ${
        checked ? 'bg-green-500' : 'bg-gray-300'
      } ${disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer'}`}
    >
      <span
        className={`inline-block h-[14px] w-[14px] rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-[18px]' : 'translate-x-[2px]'
        }`}
      />
    </button>
  );
}
