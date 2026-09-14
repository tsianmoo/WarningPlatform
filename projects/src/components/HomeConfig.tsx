'use client';

import { useEffect, useRef, useState } from 'react';
import {
  ChevronDown,
  Image as ImageIcon,
  ImagePlus,
  Plus,
  RotateCcw,
  Trash2,
  Type,
} from 'lucide-react';
import { useStore } from '@/lib/store';
import {
  DEFAULT_HOME_CONFIG,
  FONT_OPTIONS,
  uid,
  type HomeConfig,
  type HomeElement,
  type HomeImageElement,
  type HomeTitleStyle,
} from '@/lib/types';

/** 文本类配置共有的字段（主/副标题与新增文本元素） */
type TextCfg = Pick<HomeTitleStyle, 'text' | 'font' | 'size' | 'weight' | 'letterSpacing' | 'color' | 'opacity'>;
type TextPatch = Partial<TextCfg>;

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-12 shrink-0 text-right text-xs text-gray-500">{label}</span>
      {children}
    </div>
  );
}

const inputCls = 'h-7 min-w-[120px] rounded-lg border border-gray-200 px-2 text-sm outline-none focus:border-blue-400';

function NumberInput({
  value,
  onChange,
  min = 12,
  max = 120,
  step = 1,
  unit = 'px',
}: {
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-32 accent-blue-600"
      />
      <span className="w-12 shrink-0 text-xs text-gray-500">
        {value}
        {unit}
      </span>
    </div>
  );
}

function ColorPick({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex items-center gap-1.5 text-xs text-gray-500">
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="h-7 w-10 cursor-pointer rounded border border-gray-200" />
      {value}
    </label>
  );
}

function OpacityPick({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-24 accent-blue-600"
      />
      <span className="w-9 text-xs text-gray-500">{Math.round(value * 100)}%</span>
    </div>
  );
}

function FontPick({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={inputCls}>
      {FONT_OPTIONS.map((f) => (
        <option key={f.value} value={f.value}>
          {f.label}
        </option>
      ))}
    </select>
  );
}

function WeightPick({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(Number(e.target.value))} className={inputCls}>
      {[400, 500, 600, 700, 800, 900].map((w) => (
        <option key={w} value={w}>
          {w}
        </option>
      ))}
    </select>
  );
}

/** 文本类配置控件（主/副标题、新增文本元素共用） */
function TextFields({ value, onChange }: { value: TextCfg; onChange: (p: TextPatch) => void }) {
  return (
    <>
      <Field label="文字">
        <input value={value.text} onChange={(e) => onChange({ text: e.target.value })} className={inputCls} />
      </Field>
      <Field label="字体">
        <FontPick value={value.font} onChange={(v) => onChange({ font: v })} />
      </Field>
      <Field label="字号">
        <NumberInput value={value.size} onChange={(n) => onChange({ size: n })} />
      </Field>
      <Field label="字重">
        <WeightPick value={value.weight} onChange={(v) => onChange({ weight: v })} />
      </Field>
      <Field label="字宽">
        <NumberInput value={value.letterSpacing} min={0} max={40} onChange={(n) => onChange({ letterSpacing: n })} />
      </Field>
      <Field label="颜色">
        <ColorPick value={value.color} onChange={(v) => onChange({ color: v })} />
      </Field>
      <Field label="透明度">
        <OpacityPick value={value.opacity} onChange={(v) => onChange({ opacity: v })} />
      </Field>
    </>
  );
}

function ImageFields({
  value,
  onChange,
  fileRef,
  onPickFile,
  onInputChange,
}: {
  value: Pick<HomeImageElement, 'src' | 'width' | 'height' | 'borderRadius' | 'opacity'>;
  onChange: (p: Partial<HomeImageElement>) => void;
  fileRef: React.RefObject<HTMLInputElement | null>;
  onPickFile: () => void;
  onInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <>
      <button
        onClick={onPickFile}
        className="flex items-center gap-1.5 rounded-lg bg-blue-50 px-3 py-1.5 text-xs text-blue-600 hover:bg-blue-100"
      >
        <ImagePlus size={13} /> {value.src ? '更换图片' : '上传图片'}
      </button>
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onInputChange} />
      <Field label="宽度">
        <NumberInput value={value.width} min={40} max={800} onChange={(n) => onChange({ width: n })} />
      </Field>
      <Field label="高度">
        <NumberInput value={value.height} min={40} max={600} onChange={(n) => onChange({ height: n })} />
      </Field>
      <Field label="圆角">
        <NumberInput value={value.borderRadius} min={0} max={80} onChange={(n) => onChange({ borderRadius: n })} />
      </Field>
      <Field label="透明度">
        <OpacityPick value={value.opacity} onChange={(v) => onChange({ opacity: v })} />
      </Field>
    </>
  );
}

type SelKey = 'bg' | 'login' | 'title' | 'subtitle' | (string & {});
const ELEM_PREFIX = 'elem:';

export function HomeConfig({ onBack }: { onBack?: () => void }) {
  const { state, updateHomeConfig } = useStore();
  const cfg = state.config ?? DEFAULT_HOME_CONFIG;
  const [saved, setSaved] = useState(false);
  const [selected, setSelected] = useState<SelKey | null>('bg');
  const [menuOpen, setMenuOpen] = useState(false);

  const bgFileRef = useRef<HTMLInputElement | null>(null);
  const addImageFileRef = useRef<HTMLInputElement | null>(null);
  const imageFileRef = useRef<HTMLInputElement | null>(null);
  const previewRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ key: string; startX: number; startY: number; originX: number; originY: number } | null>(null);

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

  const elemById = (id: string): HomeElement | undefined => cfg.elements.find((e) => e.id === id);

  const getPos = (key: string) => {
    if (key === 'login') return { x: cfg.loginBox.x, y: cfg.loginBox.y };
    if (key === 'title') return { x: cfg.title.x, y: cfg.title.y };
    if (key === 'subtitle') return { x: cfg.subtitle.x, y: cfg.subtitle.y };
    if (key.startsWith(ELEM_PREFIX)) {
      const el = elemById(key.slice(ELEM_PREFIX.length));
      if (el) return { x: el.x, y: el.y };
    }
    return { x: 0, y: 0 };
  };

  const setPos = (key: string, x: number, y: number) => {
    if (key === 'login') updateHomeConfig((c) => ({ ...c, loginBox: { ...c.loginBox, x, y } }));
    else if (key === 'title') updateHomeConfig((c) => ({ ...c, title: { ...c.title, x, y } }));
    else if (key === 'subtitle') updateHomeConfig((c) => ({ ...c, subtitle: { ...c.subtitle, x, y } }));
    else if (key.startsWith(ELEM_PREFIX)) {
      const id = key.slice(ELEM_PREFIX.length);
      updateHomeConfig((c) => ({
        ...c,
        elements: c.elements.map((el) => (el.id === id ? ({ ...el, x, y } as HomeElement) : el)),
      }));
    }
  };

  const startDrag = (key: string, e: React.PointerEvent) => {
    if (key === 'bg') return;
    e.preventDefault();
    e.stopPropagation();
    setSelected(key);
    const o = getPos(key);
    dragRef.current = { key, startX: e.clientX, startY: e.clientY, originX: o.x, originY: o.y };
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
      setPos(d.key, nx, ny);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [updateHomeConfig]);

  const save = () => {
    updateHomeConfig((c) => c);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1500);
  };

  const setBg = (patch: Partial<HomeConfig>) => updateHomeConfig((c) => ({ ...c, ...patch }));

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') setBg({ bgMode: 'image', bgImage: reader.result });
    };
    reader.readAsDataURL(f);
  };

  const onImageFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== 'string') return;
      if (selectedElemId) updateElement(selectedElemId, { src: reader.result } as Partial<HomeElement>);
      else addImageElement(reader.result);
    };
    reader.readAsDataURL(f);
  };

  const onAddImageFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') addImageElement(reader.result);
    };
    reader.readAsDataURL(f);
  };

  const selectedElemId = selected?.startsWith(ELEM_PREFIX) ? selected.slice(ELEM_PREFIX.length) : null;
  const selectedElem = selectedElemId ? elemById(selectedElemId) : undefined;

  const updateElement = (id: string, patch: Partial<HomeElement>) =>
    updateHomeConfig((c) => ({
      ...c,
      elements: c.elements.map((el) => (el.id === id ? ({ ...el, ...patch } as HomeElement) : el)),
    }));

  const removeElement = (id: string) => {
    updateHomeConfig((c) => ({ ...c, elements: c.elements.filter((el) => el.id !== id) }));
    setSelected('bg');
  };

  const addTextElement = () => {
    const id = uid('text');
    const el: HomeElement = {
      id,
      type: 'text',
      text: '双击编辑文案',
      font: 'system-ui',
      size: 22,
      weight: 600,
      letterSpacing: 0,
      color: '#ffffff',
      opacity: 1,
      x: 40,
      y: 55,
    };
    updateHomeConfig((c) => ({ ...c, elements: [...c.elements, el] }));
    setSelected(`elem:${id}`);
    setMenuOpen(false);
  };

  const addImageElement = (src: string) => {
    const id = uid('img');
    const el: HomeElement = { id, type: 'image', src, x: 55, y: 50, width: 240, height: 150, borderRadius: 0, opacity: 1 };
    updateHomeConfig((c) => ({ ...c, elements: [...c.elements, el] }));
    setSelected(`elem:${id}`);
  };

  const bgStyle =
    cfg.bgMode === 'image' && cfg.bgImage
      ? { backgroundImage: `url(${cfg.bgImage})`, backgroundSize: 'cover', backgroundPosition: 'center' }
      : { backgroundColor: cfg.bgColor };

  // 元素选择条
  const chips: { key: string; label: string; icon?: React.ReactNode }[] = [
    { key: 'bg', label: '背景' },
    { key: 'login', label: '登录框' },
    { key: 'title', label: '主标题' },
    { key: 'subtitle', label: '副标题' },
    ...cfg.elements.map((el) =>
      el.type === 'text'
        ? { key: `elem:${el.id}`, label: `文本 · ${el.text.trim() ? el.text.trim() : '未命名'}` }
        : { key: `elem:${el.id}`, label: '图片' },
    ),
  ];

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[#F7F8FA]">
      {/* 顶部操作栏 */}
      <div className="z-10 shrink-0 border-b border-gray-200 bg-white px-5 py-3 shadow-sm">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="text-base font-semibold text-gray-800">首页管理</div>
            <p className="truncate text-xs text-gray-400">点击画布组件进行配置，保存后即时生效。</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {saved && <span className="flex items-center gap-1 text-xs text-green-600">✓ 已保存</span>}
            {/* 组件按钮 */}
            <div className="relative">
              <button
                onClick={() => setMenuOpen((v) => !v)}
                className="flex items-center gap-1.5 rounded-lg bg-white border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
              >
                <Plus size={15} /> 组件 <ChevronDown size={14} className="text-gray-400" />
              </button>
              {menuOpen && (
                <div className="absolute right-0 top-full z-20 mt-1 w-40 overflow-hidden rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
                  <button
                    onClick={addTextElement}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
                  >
                    <Type size={15} /> 添加文本
                  </button>
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      addImageFileRef.current?.click();
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
                  >
                    <ImageIcon size={15} /> 添加图片
                  </button>
                </div>
              )}
              <input ref={addImageFileRef} type="file" accept="image/*" className="hidden" onChange={onAddImageFile} />
            </div>
            <button
              onClick={onBack}
              className="rounded-lg border border-gray-300 px-4 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
            >
              ← 返回
            </button>
            <button onClick={save} className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm text-white hover:bg-blue-700">
              保存
            </button>
          </div>
        </div>

        {/* 元素选择 + 配置栏（所有配置按钮集中在此） */}
        <div className="mt-3 flex items-start gap-3">
          <div className="flex shrink-0 flex-wrap content-start gap-1.5">
            {chips.map((c) => (
              <button
                key={c.key}
                onClick={() => setSelected(c.key)}
                className={`max-w-[140px] truncate rounded-md border px-2.5 py-1 text-xs ${
                  selected === c.key
                    ? 'border-blue-600 bg-blue-600 text-white'
                    : 'border-gray-200 bg-white text-gray-600 hover:border-blue-300 hover:text-blue-600'
                }`}
                title={c.label}
              >
                {c.label}
              </button>
            ))}
          </div>

          {/* 选中组件的配置控件 */}
          <div className="min-w-0 flex-1 border-l border-gray-100 pl-3">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              {selected === 'bg' && (
                <>
                  <Field label="模式">
                    <div className="flex items-center gap-2 text-xs text-gray-600">
                      <label className="flex items-center gap-1">
                        <input type="radio" checked={cfg.bgMode === 'color'} onChange={() => setBg({ bgMode: 'color' })} /> 纯色
                      </label>
                      <label className="flex items-center gap-1">
                        <input type="radio" checked={cfg.bgMode === 'image'} onChange={() => setBg({ bgMode: 'image' })} /> 图片
                      </label>
                    </div>
                  </Field>
                  {cfg.bgMode === 'color' && (
                    <Field label="颜色">
                      <ColorPick value={cfg.bgColor} onChange={(v) => setBg({ bgColor: v })} />
                    </Field>
                  )}
                  {cfg.bgMode === 'image' && (
                    <button
                      onClick={() => bgFileRef.current?.click()}
                      className="flex items-center gap-1.5 rounded-lg bg-blue-50 px-3 py-1.5 text-xs text-blue-600 hover:bg-blue-100"
                    >
                      <ImagePlus size={13} /> {cfg.bgImage ? '更换图片' : '上传图片'}
                    </button>
                  )}
                  <input ref={bgFileRef} type="file" accept="image/*" className="hidden" onChange={onFile} />
                  <Field label="毛玻璃">
                    <NumberInput value={cfg.bgBlur} min={0} max={24} step={1} onChange={(n) => setBg({ bgBlur: n })} />
                  </Field>
                  <button
                    onClick={() => setBg({ bgMode: 'color', bgColor: DEFAULT_HOME_CONFIG.bgColor, bgImage: '' })}
                    className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-gray-400 hover:bg-gray-50"
                    title="恢复默认背景"
                  >
                    <RotateCcw size={12} /> 重置
                  </button>
                  {cfg.bgMode === 'image' && cfg.bgImage && (
                    <button onClick={() => setBg({ bgImage: '' })} className="text-xs text-red-500 hover:underline">
                      移除图片
                    </button>
                  )}
                </>
              )}

              {selected === 'login' && (
                <>
                  <Field label="宽度">
                    <NumberInput value={cfg.loginBox.width} min={200} max={600} onChange={(n) => updateHomeConfig((c) => ({ ...c, loginBox: { ...c.loginBox, width: n } }))} />
                  </Field>
                  <Field label="高度">
                    <NumberInput value={cfg.loginBox.height} min={200} max={600} onChange={(n) => updateHomeConfig((c) => ({ ...c, loginBox: { ...c.loginBox, height: n } }))} />
                  </Field>
                  <Field label="背景色">
                    <ColorPick value={cfg.loginBox.bgColor} onChange={(v) => updateHomeConfig((c) => ({ ...c, loginBox: { ...c.loginBox, bgColor: v } }))} />
                  </Field>
                  <Field label="透明度">
                    <OpacityPick value={cfg.loginBox.bgOpacity} onChange={(v) => updateHomeConfig((c) => ({ ...c, loginBox: { ...c.loginBox, bgOpacity: v } }))} />
                  </Field>
                  <Field label="毛玻璃">
                    <NumberInput value={cfg.loginBox.blur} max={40} onChange={(n) => updateHomeConfig((c) => ({ ...c, loginBox: { ...c.loginBox, blur: n } }))} />
                  </Field>
                  <Field label="圆角">
                    <NumberInput value={cfg.loginBox.radius} max={40} onChange={(n) => updateHomeConfig((c) => ({ ...c, loginBox: { ...c.loginBox, radius: n } }))} />
                  </Field>
                  <Field label="内边距X">
                    <NumberInput value={cfg.loginBox.padX} min={0} max={80} onChange={(n) => updateHomeConfig((c) => ({ ...c, loginBox: { ...c.loginBox, padX: n } }))} />
                  </Field>
                  <Field label="内边距Y">
                    <NumberInput value={cfg.loginBox.padY} min={0} max={80} onChange={(n) => updateHomeConfig((c) => ({ ...c, loginBox: { ...c.loginBox, padY: n } }))} />
                  </Field>
                  <Field label="输入框高">
                    <NumberInput value={cfg.loginBox.fieldHeight} min={24} max={72} onChange={(n) => updateHomeConfig((c) => ({ ...c, loginBox: { ...c.loginBox, fieldHeight: n } }))} />
                  </Field>
                  <span className="text-xs text-gray-400">拖拽登录框可移动位置</span>
                </>
              )}

              {(selected === 'title' || selected === 'subtitle') && (
                <TextFields
                  value={selected === 'title' ? cfg.title : cfg.subtitle}
                  onChange={(p) => {
                    const k = selected === 'subtitle' ? 'subtitle' : 'title';
                    updateHomeConfig((c) => ({ ...c, [k]: { ...c[k], ...p } }));
                  }}
                />
              )}

              {selectedElem &&
                (selectedElem.type === 'text' ? (
                  <>
                    <TextFields value={selectedElem} onChange={(p) => updateElement(selectedElem.id, p)} />
                    <button
                      onClick={() => removeElement(selectedElem.id)}
                      className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-red-500 hover:bg-red-50"
                    >
                      <Trash2 size={13} /> 删除
                    </button>
                  </>
                ) : (
                  <>
                    <ImageFields
                      value={selectedElem}
                      onChange={(p) => updateElement(selectedElem.id, p)}
                      fileRef={imageFileRef}
                      onPickFile={() => imageFileRef.current?.click()}
                      onInputChange={onImageFile}
                    />
                    <button
                      onClick={() => removeElement(selectedElem.id)}
                      className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-red-500 hover:bg-red-50"
                    >
                      <Trash2 size={13} /> 删除
                    </button>
                  </>
                ))}

              {!selected && <span className="text-xs text-gray-400">从顶部选择「组件」添加文本 / 图片，或点击画布组件进行配置。</span>}
            </div>
          </div>
        </div>
      </div>

      {/* 画布 */}
      <div className="flex-1 min-h-0 p-5">
        <div className="flex h-full flex-col overflow-hidden rounded-2xl shadow-sm">
          <div className="flex h-8 shrink-0 items-center justify-between bg-black/80 px-3">
            <span className="text-[11px] text-white/70">登录页画布 · 点选组件配置 · 拖拽移动</span>
            <span className="flex gap-1.5">
              <span className="h-2 w-2 rounded-full bg-red-400" />
              <span className="h-2 w-2 rounded-full bg-yellow-400" />
              <span className="h-2 w-2 rounded-full bg-green-400" />
            </span>
          </div>
          <div className="flex flex-1 min-h-0 p-4" onClick={() => setSelected(null)}>
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
                  padding: `${cfg.loginBox.padY}px ${cfg.loginBox.padX}px`,
                  outline: selected === 'login' ? '2px dashed #3b82f6' : 'none',
                  outlineOffset: '2px',
                }}
                onPointerDown={(e) => startDrag('login', e)}
                title="点击选中，拖拽移动登录框"
              >
                <div className="text-sm font-semibold text-white/95">登录</div>
                <div className="mt-2 rounded bg-white/30" style={{ height: cfg.loginBox.fieldHeight }} />
                <div className="mt-2 rounded bg-white/30" style={{ height: cfg.loginBox.fieldHeight }} />
                <div className="mt-2 rounded bg-white/30" style={{ height: cfg.loginBox.fieldHeight }} />
                <div className="mt-3 rounded-lg bg-blue-500/90" style={{ height: cfg.loginBox.fieldHeight }} />
              </div>
              {/* 主标题 */}
              <div
                className="absolute cursor-move select-none leading-tight"
                style={{
                  left: `${cfg.title.x}%`,
                  top: `${cfg.title.y}%`,
                  transform: 'translateY(-50%)',
                  whiteSpace: 'nowrap',
                  fontFamily: cfg.title.font,
                  fontSize: cfg.title.size,
                  fontWeight: cfg.title.weight,
                  letterSpacing: `${cfg.title.letterSpacing}px`,
                  color: cfg.title.color,
                  opacity: cfg.title.opacity,
                  marginLeft: cfg.title.marginLeft,
                  outline: selected === 'title' ? '2px dashed #3b82f6' : 'none',
                  outlineOffset: '3px',
                }}
                onPointerDown={(e) => startDrag('title', e)}
                title="点击选中，拖拽移动主标题"
              >
                {cfg.title.text}
              </div>
              {/* 副标题 */}
              <div
                className="absolute cursor-move select-none mt-2"
                style={{
                  left: `${cfg.subtitle.x}%`,
                  top: `${cfg.subtitle.y}%`,
                  transform: 'translateY(-50%)',
                  whiteSpace: 'nowrap',
                  fontFamily: cfg.subtitle.font,
                  fontSize: cfg.subtitle.size,
                  fontWeight: cfg.subtitle.weight,
                  letterSpacing: `${cfg.subtitle.letterSpacing}px`,
                  color: cfg.subtitle.color,
                  opacity: cfg.subtitle.opacity,
                  marginLeft: cfg.subtitle.marginLeft,
                  outline: selected === 'subtitle' ? '2px dashed #3b82f6' : 'none',
                  outlineOffset: '3px',
                }}
                onPointerDown={(e) => startDrag('subtitle', e)}
                title="点击选中，拖拽移动副标题"
              >
                {cfg.subtitle.text}
              </div>
              {/* 添加的画布组件元素 */}
              {cfg.elements.map((el) =>
                el.type === 'text' ? (
                  <div
                    key={el.id}
                    className="absolute cursor-move select-none leading-tight"
                    style={{
                      left: `${el.x}%`,
                      top: `${el.y}%`,
                      transform: 'translate(-50%,-50%)',
                      whiteSpace: 'nowrap',
                      fontFamily: el.font,
                      fontSize: el.size,
                      fontWeight: el.weight,
                      letterSpacing: `${el.letterSpacing}px`,
                      color: el.color,
                      opacity: el.opacity,
                      outline: selected === `elem:${el.id}` ? '2px dashed #3b82f6' : 'none',
                      outlineOffset: '3px',
                    }}
                    onPointerDown={(e) => startDrag(`elem:${el.id}`, e)}
                    title="点击选中，拖拽移动文本"
                  >
                    {el.text}
                  </div>
                ) : (
                  <img
                    key={el.id}
                    src={el.src}
                    alt=""
                    className="absolute cursor-move select-none object-cover"
                    style={{
                      left: `${el.x}%`,
                      top: `${el.y}%`,
                      transform: 'translate(-50%,-50%)',
                      width: el.width,
                      height: el.height,
                      borderRadius: el.borderRadius,
                      opacity: el.opacity,
                      outline: selected === `elem:${el.id}` ? '2px dashed #3b82f6' : 'none',
                      outlineOffset: '2px',
                    }}
                    onPointerDown={(e) => startDrag(`elem:${el.id}`, e)}
                    title="点击选中，拖拽移动图片"
                  />
                ),
              )}
              <div className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-black/30 px-3 py-0.5 text-[10px] text-white/80">
                点击画布中的组件选中，通过顶部配置栏调整样式
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}