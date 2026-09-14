'use client';

import { useEffect, useRef, useState } from 'react';
import { ImagePlus, RotateCcw } from 'lucide-react';
import { useStore } from '@/lib/store';
import { DEFAULT_HOME_CONFIG, FONT_OPTIONS, type HomeConfig } from '@/lib/types';

function Range({ value, min, max, step, onChange }: { value: number; min?: number; max: number; step?: number; onChange: (n: number) => void }) {
  return <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-blue-600" />;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-16 shrink-0 text-xs text-gray-500">{label}</span>
      <div className="flex-1">{children}</div>
    </div>
  );
}

function NumberInput({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="range"
        min={12}
        max={80}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-blue-600"
      />
      <span className="w-8 shrink-0 text-center text-xs text-gray-500">{value}px</span>
    </div>
  );
}

export function HomeConfig({ onBack }: { onBack?: () => void }) {
  const { state, updateHomeConfig } = useStore();
  const cfg = state.config ?? DEFAULT_HOME_CONFIG;
  const fileRef = useRef<HTMLInputElement>(null);
  const [saved, setSaved] = useState(false);

  const set = (patch: Partial<HomeConfig>) => updateHomeConfig(patch);
  const setTitle = (k: 'title' | 'subtitle', patch: Partial<HomeConfig['title']>) =>
    updateHomeConfig((c) => ({ ...c, [k]: { ...c[k], ...patch } }));

  const save = () => {
    updateHomeConfig((c) => c);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1500);
  };

  const previewRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ which: 'title' | 'subtitle' | 'login'; startX: number; startY: number; originX: number; originY: number } | null>(null);

  const toRgba = (hex: string, a: number) => {
    let h = hex.replace('#', '').trim();
    if (h.length === 3) h = h.split('').map((x) => x + x).join('');
    if (h.length !== 6 || /[^0-9a-fA-F]/.test(h)) return 'transparent';
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    const al = Number.isFinite(a) ? a : 1;
    return `rgba(${r}, ${g}, ${b}, ${al})`;
  };

  const startDrag = (which: 'title' | 'subtitle' | 'login', e: React.PointerEvent) => {
    e.preventDefault();
    const o = which === 'login' ? cfg.loginBox : which === 'title' ? cfg.title : cfg.subtitle;
    dragRef.current = { which, startX: e.clientX, startY: e.clientY, originX: o.x, originY: o.y };
  };

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = dragRef.current;
      const box = previewRef.current;
      if (!d || !box) return;
      const rect = box.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const nx = Math.max(0, Math.min(100, d.originX + ((e.clientX - d.startX) / rect.width) * 100));
      const ny = Math.max(0, Math.min(100, d.originY + ((e.clientY - d.startY) / rect.height) * 100));
      if (d.which === 'login') {
        updateHomeConfig((c) => ({ ...c, loginBox: { ...c.loginBox, x: nx, y: ny } }));
      } else if (d.which === 'title') {
        updateHomeConfig((c) => ({ ...c, title: { ...c.title, x: nx, y: ny } }));
      } else if (d.which === 'subtitle') {
        updateHomeConfig((c) => ({ ...c, subtitle: { ...c.subtitle, x: nx, y: ny } }));
      }
    };
    const up = () => {
      dragRef.current = null;
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [updateHomeConfig]);

  const hexA = (hex: string, a: number) => {
    const m = (hex || '').replace('#', '');
    const full = m.length === 3 ? m.split('').map((x) => x + x).join('') : m;
    const n = parseInt(full || 'ffffff', 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  };

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        set({ bgMode: 'image', bgImage: reader.result });
      }
    };
    reader.readAsDataURL(f);
    e.target.value = '';
  };

  const bgStyle =
    cfg.bgMode === 'image' && cfg.bgImage
      ? { backgroundImage: `url(${cfg.bgImage})`, backgroundSize: 'cover', backgroundPosition: 'center' }
      : { backgroundColor: cfg.bgColor };

  return (
    <div className="flex h-full flex-col gap-4 p-6">
      {/* 顶部操作栏 */}
      <div className="flex shrink-0 items-center justify-between rounded-2xl bg-white px-5 py-3 shadow-sm">
        <div>
          <div className="text-base font-semibold text-gray-800">首页管理</div>
          <p className="text-xs text-gray-400">配置「店牛预警平台」登录页的展示效果，保存后即时生效。</p>
        </div>
        <div className="flex items-center gap-2">
          {saved && <span className="flex items-center gap-1 text-xs text-green-600">✓ 已保存</span>}
          <button
            onClick={onBack}
            className="rounded-lg border border-gray-300 px-4 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
          >
            ← 返回
          </button>
          <button
            onClick={save}
            className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm text-white hover:bg-blue-700"
          >
            保存
          </button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 gap-6">
        {/* 左侧：配置表单 */}
        <div className="h-full w-[460px] shrink-0 space-y-5 overflow-y-auto rounded-2xl bg-white p-5 shadow-sm">

        {/* 背景 */}
        <div className="rounded-xl border border-gray-100 p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm font-medium text-gray-700">登录页背景</span>
            <button
              onClick={() => fileRef.current?.click()}
              className="flex items-center gap-1 rounded-lg bg-blue-50 px-2.5 py-1 text-xs text-blue-600 hover:bg-blue-100"
            >
              <ImagePlus size={13} /> 上传图片
            </button>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onFile} />
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-xs text-gray-600">
              <input
                type="radio"
                checked={cfg.bgMode === 'color'}
                onChange={() => set({ bgMode: 'color' })}
              />
              纯色
            </label>
            <input
              type="color"
              value={cfg.bgColor}
              disabled={cfg.bgMode === 'image'}
              onChange={(e) => set({ bgColor: e.target.value })}
              className="h-8 w-12 cursor-pointer rounded border border-gray-200"
            />
            <button
              onClick={() => {
                set({ bgMode: 'color', bgColor: DEFAULT_HOME_CONFIG.bgColor, bgImage: '' });
              }}
              className="ml-auto flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-gray-400 hover:bg-gray-50"
              title="恢复默认背景"
            >
              <RotateCcw size={12} /> 重置
            </button>
          </div>
          {cfg.bgMode === 'image' && cfg.bgImage && (
            <div className="mt-2 flex items-center gap-2">
              <span className="truncate text-[11px] text-gray-400">已选择图片</span>
              <button
                onClick={() => set({ bgImage: '' })}
                className="text-[11px] text-red-500 hover:underline"
              >
                移除
              </button>
            </div>
          )}
        </div>

        {/* 大标题 */}
        <div className="rounded-xl border border-gray-100 p-4">
          <div className="mb-3 text-sm font-medium text-gray-700">大标题</div>
          <div className="space-y-3">
            <Field label="文字">
              <input
                value={cfg.title.text}
                onChange={(e) => setTitle('title', { text: e.target.value })}
                className="h-8 w-full rounded-lg border border-gray-200 px-2.5 text-sm outline-none focus:border-blue-400"
              />
            </Field>
            <Field label="字体">
              <select
                value={cfg.title.font}
                onChange={(e) => setTitle('title', { font: e.target.value })}
                className="h-8 w-full rounded-lg border border-gray-200 px-2 text-sm outline-none"
              >
                {FONT_OPTIONS.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="字号">
              <NumberInput value={cfg.title.size} onChange={(n) => setTitle('title', { size: n })} />
            </Field>
            <Field label="字重">
              <select
                value={cfg.title.weight}
                onChange={(e) => setTitle('title', { weight: Number(e.target.value) })}
                className="h-8 w-full rounded-lg border border-gray-200 px-2 text-sm outline-none"
              >
                {[400, 500, 600, 700, 800, 900].map((w) => (
                  <option key={w} value={w}>
                    {w}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="字宽(px)">
              <NumberInput value={cfg.title.letterSpacing} onChange={(n) => setTitle('title', { letterSpacing: n })} />
            </Field>
            <Field label="左边距(px)">
              <NumberInput value={cfg.title.marginLeft} onChange={(n) => setTitle('title', { marginLeft: n })} />
            </Field>
            <Field label="不换行">
              <div className="h-8 flex items-center text-xs text-gray-400">标题默认单行显示（不换行）</div>
            </Field>
            <Field label="颜色">
              <label className="flex items-center gap-2 text-xs text-gray-500">
                <input
                  type="color"
                  value={cfg.title.color}
                  onChange={(e) => setTitle('title', { color: e.target.value })}
                  className="h-7 w-11 cursor-pointer rounded border border-gray-200"
                />
                {cfg.title.color}
              </label>
            </Field>
            <Field label="透明度">
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min={0.2}
                  max={1}
                  step={0.05}
                  value={cfg.title.opacity}
                  onChange={(e) => setTitle('title', { opacity: Number(e.target.value) })}
                  className="w-full accent-blue-600"
                />
                <span className="w-9 text-right text-xs text-gray-500">{Math.round(cfg.title.opacity * 100)}%</span>
              </div>
            </Field>
          </div>
        </div>

        {/* 副标题 */}
        <div className="rounded-xl border border-gray-100 p-4">
          <div className="mb-3 text-sm font-medium text-gray-700">副标题</div>
          <div className="space-y-3">
            <Field label="文字">
              <input
                value={cfg.subtitle.text}
                onChange={(e) => setTitle('subtitle', { text: e.target.value })}
                className="h-8 w-full rounded-lg border border-gray-200 px-2.5 text-sm outline-none focus:border-blue-400"
              />
            </Field>
            <Field label="字体">
              <select
                value={cfg.subtitle.font}
                onChange={(e) => setTitle('subtitle', { font: e.target.value })}
                className="h-8 w-full rounded-lg border border-gray-200 px-2 text-sm outline-none"
              >
                {FONT_OPTIONS.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="字号">
              <NumberInput value={cfg.subtitle.size} onChange={(n) => setTitle('subtitle', { size: n })} />
            </Field>
            <Field label="颜色">
              <label className="flex items-center gap-2 text-xs text-gray-500">
                <input
                  type="color"
                  value={cfg.subtitle.color}
                  onChange={(e) => setTitle('subtitle', { color: e.target.value })}
                  className="h-7 w-11 cursor-pointer rounded border border-gray-200"
                />
                {cfg.subtitle.color}
              </label>
            </Field>
            <Field label="透明度">
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min={0.2}
                  max={1}
                  step={0.05}
                  value={cfg.subtitle.opacity}
                  onChange={(e) => setTitle('subtitle', { opacity: Number(e.target.value) })}
                  className="w-full accent-blue-600"
                />
                <span className="w-9 text-right text-xs text-gray-500">{Math.round(cfg.subtitle.opacity * 100)}%</span>
              </div>
            </Field>
          </div>
        </div>

        {/* 登录框设置 */}
        <div className="rounded-xl border border-gray-100 p-4">
          <div className="mb-3 text-sm font-medium text-gray-700">登录框</div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="宽度">
              <NumberInput value={cfg.loginBox.width} onChange={(n) => set({ loginBox: { ...cfg.loginBox, width: n } })} />
            </Field>
            <Field label="高度">
              <NumberInput value={cfg.loginBox.height} onChange={(n) => set({ loginBox: { ...cfg.loginBox, height: n } })} />
            </Field>
            <Field label="背景颜色">
              <input type="color" value={cfg.loginBox.bgColor} onChange={(e) => set({ loginBox: { ...cfg.loginBox, bgColor: e.target.value } })} className="h-8 w-full rounded-lg border p-0.5" />
            </Field>
            <Field label="透明度">
              <Range value={cfg.loginBox.bgOpacity} min={0} max={1} step={0.05} onChange={(n) => set({ loginBox: { ...cfg.loginBox, bgOpacity: n } })} />
            </Field>
            <Field label="毛玻璃(模糊)">
              <NumberInput value={cfg.loginBox.blur} onChange={(n) => set({ loginBox: { ...cfg.loginBox, blur: n } })} />
            </Field>
            <Field label="圆角">
              <NumberInput value={cfg.loginBox.radius} onChange={(n) => set({ loginBox: { ...cfg.loginBox, radius: n } })} />
            </Field>
          </div>
          <div className="mt-2">
            <Field label="背景毛玻璃(模糊)">
              <Range value={cfg.bgBlur} min={0} max={24} step={1} onChange={(n) => set({ bgBlur: n })} />
            </Field>
          </div>
          <p className="mt-3 text-[11px] text-gray-400">登录框位置可直接在右侧预览中拖拽；宽高、背景颜色、透明度与毛玻璃见上方设置。</p>
        </div>
      </div>

      {/* 右侧：实时预览 */}
      <div className="min-w-0 flex-1 overflow-hidden rounded-2xl shadow-sm">
        <div className="flex h-8 items-center justify-between bg-black/80 px-3">
          <span className="text-[11px] text-white/70">登录页预览 · 实时生效</span>
          <span className="flex gap-1.5">
            <span className="h-2 w-2 rounded-full bg-red-400" />
            <span className="h-2 w-2 rounded-full bg-yellow-400" />
            <span className="h-2 w-2 rounded-full bg-green-400" />
          </span>
        </div>
        <div className="flex h-[calc(100%-2rem)] rounded-b-2xl p-4">
          <div ref={previewRef} className="relative min-w-0 flex-1 overflow-hidden rounded-xl" style={bgStyle}>
            <div
              className="pointer-events-none absolute inset-0"
              style={{ backdropFilter: `blur(${cfg.bgBlur}px)`, WebkitBackdropFilter: `blur(${cfg.bgBlur}px)` }}
            />
            {/* 登录框 */}
            <div
              className="absolute cursor-move select-none"
              style={{
                left: `${cfg.loginBox.x}%`,
                top: `${cfg.loginBox.y}%`,
                width: cfg.loginBox.width,
                height: cfg.loginBox.height,
                transform: 'translate(-50%, -50%)',
                borderRadius: cfg.loginBox.radius,
                background: toRgba(cfg.loginBox.bgColor, cfg.loginBox.bgOpacity),
                backdropFilter: `blur(${cfg.loginBox.blur}px)`,
                WebkitBackdropFilter: `blur(${cfg.loginBox.blur}px)`,
                boxShadow: '0 8px 30px rgba(0,0,0,0.18)',
                padding: '18px',
              }}
              onPointerDown={(e) => startDrag('login', e)}
              title="拖拽移动登录框"
            >
              <div className="text-sm font-semibold text-white/95">登录</div>
              <div className="mt-2 h-7 rounded bg-white/30" />
              <div className="mt-2 h-7 rounded bg-white/30" />
              <div className="mt-2 h-7 rounded bg-white/30" />
              <div className="mt-3 h-8 rounded-lg bg-blue-500/90" />
            </div>
            {/* 主标题 */}
            <div
              className="absolute cursor-move select-none leading-tight"
              style={{
                left: `${cfg.title.x}%`,
                top: `${cfg.title.y}%`,
                whiteSpace: 'nowrap',
                transform: 'translateY(-50%)',
                fontFamily: cfg.title.font,
                fontSize: cfg.title.size,
                fontWeight: cfg.title.weight,
                letterSpacing: `${cfg.title.letterSpacing}px`,
                color: cfg.title.color,
                opacity: cfg.title.opacity,
                marginLeft: cfg.title.marginLeft,
              }}
              onPointerDown={(e) => startDrag('title', e)}
              title="拖拽移动主标题"
            >
              {cfg.title.text}
            </div>
            {/* 副标题 */}
            <div
              className="absolute cursor-move select-none mt-2"
              style={{
                left: `${cfg.subtitle.x}%`,
                top: `${cfg.subtitle.y}%`,
                whiteSpace: 'nowrap',
                transform: 'translateY(-50%)',
                fontFamily: cfg.subtitle.font,
                fontSize: cfg.subtitle.size,
                fontWeight: cfg.subtitle.weight,
                letterSpacing: `${cfg.subtitle.letterSpacing}px`,
                color: cfg.subtitle.color,
                opacity: cfg.subtitle.opacity,
                marginLeft: cfg.subtitle.marginLeft,
              }}
              onPointerDown={(e) => startDrag('subtitle', e)}
              title="拖拽移动副标题"
            >
              {cfg.subtitle.text}
            </div>
            <div className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-black/30 px-3 py-0.5 text-[10px] text-white/80">
              拖拽登录框 / 主标题 / 副标题可调整位置
            </div>
          </div>
        </div>
        </div>
        </div>
    </div>
  );
}