'use client';

import { useRef } from 'react';
import { ImagePlus, RotateCcw } from 'lucide-react';
import { useStore } from '@/lib/store';
import { DEFAULT_HOME_CONFIG, FONT_OPTIONS, type HomeConfig } from '@/lib/types';

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

export function HomeConfig() {
  const { state, updateHomeConfig } = useStore();
  const cfg = state.config ?? DEFAULT_HOME_CONFIG;
  const fileRef = useRef<HTMLInputElement>(null);

  const set = (patch: Partial<HomeConfig>) => updateHomeConfig(patch);
  const setTitle = (k: 'title' | 'subtitle', patch: Partial<HomeConfig['title']>) =>
    updateHomeConfig((c) => ({ ...c, [k]: { ...c[k], ...patch } }));

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
    <div className="flex h-full gap-6 p-6">
      {/* 左侧：配置表单 */}
      <div className="h-full w-[460px] shrink-0 space-y-5 overflow-y-auto rounded-2xl bg-white p-5 shadow-sm">
        <div className="text-base font-semibold text-gray-800">首页管理</div>
        <p className="text-xs text-gray-400">配置「店牛预警平台」登录页的展示效果，保存后即时生效。</p>

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

        {/* 标题位置（极简对齐） */}
        <div className="rounded-xl border border-gray-100 p-4">
          <div className="mb-3 text-sm font-medium text-gray-700">标题位置</div>
          <div className="space-y-3">
            <Field label="水平">
              <div className="flex gap-1">
                {(['left', 'center', 'right'] as const).map((x) => (
                  <button
                    key={x}
                    onClick={() => set({ titleX: x })}
                    className={`flex-1 rounded-lg py-1.5 text-xs transition ${
                      cfg.titleX === x ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                    }`}
                  >
                    {x === 'left' ? '左对齐' : x === 'center' ? '居中' : '右对齐'}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="垂直">
              <div className="flex gap-1">
                {(['top', 'middle', 'bottom'] as const).map((y) => (
                  <button
                    key={y}
                    onClick={() => set({ titleY: y })}
                    className={`flex-1 rounded-lg py-1.5 text-xs transition ${
                      cfg.titleY === y ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                    }`}
                  >
                    {y === 'top' ? '置顶' : y === 'middle' ? '居中' : '置底'}
                  </button>
                ))}
              </div>
            </Field>
          </div>
          <p className="mt-3 text-[11px] text-gray-400">调整标题与大标题在登录页左侧区域的位置，极简风格下自动生效。</p>
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
        <div className="flex h-[calc(100%-2rem)]">
          <div className="relative min-w-0 flex-1" style={bgStyle}>
            <div
              className="flex h-full w-full px-12"
              style={{
                justifyContent: cfg.titleX === 'left' ? 'flex-start' : cfg.titleX === 'center' ? 'center' : 'flex-end',
                alignItems: cfg.titleY === 'top' ? 'flex-start' : cfg.titleY === 'middle' ? 'center' : 'flex-end',
              }}
            >
              <div className="max-w-lg">
                <div
                  className="font-bold leading-tight"
                  style={{
                    fontFamily: cfg.title.font,
                    fontSize: cfg.title.size,
                    color: cfg.title.color,
                    opacity: cfg.title.opacity,
                  }}
                >
                  {cfg.title.text}
                </div>
                <div
                  className="mt-3"
                  style={{
                    fontFamily: cfg.subtitle.font,
                    fontSize: cfg.subtitle.size,
                    color: cfg.subtitle.color,
                    opacity: cfg.subtitle.opacity,
                  }}
                >
                  {cfg.subtitle.text}
                </div>
              </div>
            </div>
          </div>
          <div className="flex w-40 shrink-0 flex-col justify-center bg-white px-6">
            <div className="text-sm font-bold text-gray-800">登录</div>
            <div className="mt-1 h-8 rounded bg-gray-100" />
            <div className="mt-2 h-8 rounded bg-gray-100" />
            <div className="mt-2 h-8 rounded bg-gray-100" />
            <div className="mt-3 h-9 rounded-lg bg-blue-600" />
          </div>
        </div>
      </div>
    </div>
  );
}