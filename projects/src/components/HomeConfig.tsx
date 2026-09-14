'use client';

import { useEffect, useRef, useState } from 'react';
import LoginPage from '../app/login/page';
import {
  ChevronDown,
  Image as ImageIcon,
  ImagePlus,
  Pencil,
  Plus,
  RotateCcw,
  ShieldCheck,
  Trash2,
  Type,
  X,
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
      <span className="w-16 shrink-0 text-right text-xs font-medium text-gray-500">{label}</span>
      {children}
    </div>
  );
}

const inputCls = 'h-7 min-w-[120px] rounded-lg border border-gray-200 px-2 text-sm outline-none focus:border-blue-400';

function NumBox({
  value,
  onChange,
  min,
  max,
  step = 1,
  unit,
}: {
  value: number;
  onChange: (n: number) => void;
  min: number;
  max: number;
  step?: number;
  unit: string;
}) {
  return (
    <div className="flex h-7 w-[74px] shrink-0 items-center rounded-lg border border-gray-200 bg-white pl-1 transition focus-within:border-blue-400">
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (!Number.isNaN(v)) onChange(Math.min(max, Math.max(min, v)));
        }}
        className="w-12 border-none px-0 text-center text-xs text-gray-700 outline-none"
      />
      <span className="pr-1.5 text-[10px] text-gray-400">{unit}</span>
    </div>
  );
}

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
        className="w-28 accent-blue-600"
      />
      <NumBox value={value} min={min} max={max} step={step} unit={unit} onChange={onChange} />
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
        className="w-20 accent-blue-600"
      />
      <NumBox value={Math.round(value * 100)} min={0} max={100} step={5} unit="%" onChange={(v) => onChange(v / 100)} />
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
  const [selected, setSelected] = useState<SelKey | null>(null);
  const [editing, setEditing] = useState<SelKey | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [hover, setHover] = useState<SelKey | null>(null);
  const [preview, setPreview] = useState(false);
  const [modalPos, setModalPos] = useState<{ x: number; y: number } | null>(null);
  const modalDragRef = useRef<{ startX: number; startY: number; ox: number; oy: number } | null>(null);

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

  // 打开配置弹窗时居中定位
  useEffect(() => {
    if (editing) {
      const w = Math.min(580, window.innerWidth - 32);
      const h = Math.min(window.innerHeight * 0.82, window.innerHeight - 48);
      setModalPos({ x: (window.innerWidth - w) / 2, y: (window.innerHeight - h) / 2 });
    }
  }, [editing]);

  // 支持拖动配置弹窗位置，便于边配置边看画布效果
  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = modalDragRef.current;
      if (!d) return;
      setModalPos((p) => {
        if (!p) return p;
        return {
          x: Math.min(Math.max(0, d.ox + e.clientX - d.startX), window.innerWidth - 60),
          y: Math.min(Math.max(0, d.oy + e.clientY - d.startY), window.innerHeight - 40),
        };
      });
    };
    const up = () => {
      modalDragRef.current = null;
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, []);

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

  const selectedElemId = selected?.startsWith(ELEM_PREFIX) ? selected.slice(ELEM_PREFIX.length) : null;

  const updateElement = (id: string, patch: Partial<HomeElement>) =>
    updateHomeConfig((c) => ({
      ...c,
      elements: c.elements.map((el) => (el.id === id ? ({ ...el, ...patch } as HomeElement) : el)),
    }));

  const removeElement = (id: string) => {
    updateHomeConfig((c) => ({ ...c, elements: c.elements.filter((el) => el.id !== id) }));
    setSelected(null);
    setEditing(null);
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
    setEditing(`elem:${id}`);
  };

  const addImageElement = (src: string) => {
    const id = uid('img');
    const el: HomeElement = { id, type: 'image', src, x: 55, y: 50, width: 240, height: 150, borderRadius: 0, opacity: 1 };
    updateHomeConfig((c) => ({ ...c, elements: [...c.elements, el] }));
    setSelected(`elem:${id}`);
    setEditing(`elem:${id}`);
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

  const labelOf = (t: SelKey): string => {
    if (t === 'bg') return '背景';
    if (t === 'login') return '登录框';
    if (t === 'title') return '主标题';
    if (t === 'subtitle') return '副标题';
    if (t.startsWith(ELEM_PREFIX)) {
      const el = elemById(t.slice(ELEM_PREFIX.length));
      if (el) return el.type === 'text' ? '文本组件' : '图片组件';
    }
    return '组件';
  };

  /** 弹窗内：按目标渲染对应配置控件 */
  const fields = (t: SelKey): React.ReactNode => {
    if (t === 'bg') {
      return (
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
            <>
              <button
                onClick={() => bgFileRef.current?.click()}
                className="flex items-center gap-1.5 rounded-lg bg-blue-50 px-3 py-1.5 text-xs text-blue-600 hover:bg-blue-100"
              >
                <ImagePlus size={13} /> {cfg.bgImage ? '更换图片' : '上传图片'}
              </button>
              {cfg.bgImage && (
                <button onClick={() => setBg({ bgImage: '' })} className="text-xs text-red-500 hover:underline">
                  移除图片
                </button>
              )}
            </>
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
        </>
      );
    }
    if (t === 'login') {
      return (
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
        </>
      );
    }
    if (t === 'title' || t === 'subtitle') {
      return (
        <TextFields
          value={t === 'title' ? cfg.title : cfg.subtitle}
          onChange={(p) => {
            const k = t === 'subtitle' ? 'subtitle' : 'title';
            updateHomeConfig((c) => ({ ...c, [k]: { ...c[k], ...p } }));
          }}
        />
      );
    }
    if (t.startsWith(ELEM_PREFIX)) {
      const el = elemById(t.slice(ELEM_PREFIX.length));
      if (!el) return null;
      return el.type === 'text' ? (
        <>
          <TextFields value={el} onChange={(p) => updateElement(el.id, p)} />
          <button
            onClick={() => removeElement(el.id)}
            className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-red-500 hover:bg-red-50"
          >
            <Trash2 size={13} /> 删除该组件
          </button>
        </>
      ) : (
        <>
          <ImageFields
            value={el}
            onChange={(p) => updateElement(el.id, p)}
            fileRef={imageFileRef}
            onPickFile={() => imageFileRef.current?.click()}
            onInputChange={onImageFile}
          />
          <button
            onClick={() => removeElement(el.id)}
            className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-red-500 hover:bg-red-50"
          >
            <Trash2 size={13} /> 删除该组件
          </button>
        </>
      );
    }
    return null;
  };

  const bgStyle =
    cfg.bgMode === 'image' && cfg.bgImage
      ? { backgroundImage: `url(${cfg.bgImage})`, backgroundSize: 'cover', backgroundPosition: 'center' }
      : { backgroundColor: cfg.bgColor };

  const editingElem =
    editing && editing.startsWith(ELEM_PREFIX) ? elemById(editing.slice(ELEM_PREFIX.length)) : undefined;
  // 悬停或选中时的活动组件（bg 不是可编辑组件）
  const activeKey: SelKey | null =
    (hover && hover !== 'bg' ? hover : null) || (selected && selected !== 'bg' ? selected : null);
  const editBtn = (gkey: SelKey) =>
    activeKey === gkey ? (
      <button
        onClick={(e) => {
          e.stopPropagation();
          setSelected(gkey);
          setEditing(gkey);
        }}
        className="absolute z-30 flex cursor-pointer items-center gap-1 rounded-full bg-blue-600 px-2.5 py-1 text-xs text-white shadow-md hover:bg-blue-700"
        style={{ left: '100%', top: '50%', transform: 'translate(6px,-50%)' }}
      >
        <Pencil size={12} /> 编辑
      </button>
    ) : null;

  return (
    <div className="relative h-full w-full overflow-hidden bg-black">
      {/* 全屏画布 = 首页实际效果 */}
      <div
        ref={previewRef}
        className="absolute inset-0 overflow-hidden"
        style={bgStyle}
        onClick={() => setSelected(null)}
      >
        <div
          className="pointer-events-none absolute inset-0"
          style={{ backdropFilter: `blur(${cfg.bgBlur}px)`, WebkitBackdropFilter: `blur(${cfg.bgBlur}px)` }}
        />

        {/* 登录框 */}
        <div
          className="absolute select-none"
          style={{
            left: `${cfg.loginBox.x}%`,
            top: `${cfg.loginBox.y}%`,
            transform: 'translate(-50%, -50%)',
            outline: activeKey === 'login' ? '2px dashed rgba(59,130,246,0.9)' : 'none',
            outlineOffset: '2px',
          }}
          onMouseEnter={() => setHover('login')}
          onMouseLeave={() => setHover((k) => (k === 'login' ? null : k))}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            className="cursor-move"
            style={{
              width: cfg.loginBox.width,
              height: cfg.loginBox.height,
              borderRadius: cfg.loginBox.radius,
              background: toRgba(cfg.loginBox.bgColor, cfg.loginBox.bgOpacity),
              backdropFilter: `blur(${cfg.loginBox.blur}px)`,
              WebkitBackdropFilter: `blur(${cfg.loginBox.blur}px)`,
              boxShadow: '0 8px 30px rgba(0,0,0,0.18)',
              padding: `${cfg.loginBox.padY}px ${cfg.loginBox.padX}px`,
            }}
            onPointerDown={(e) => startDrag('login', e)}
            title="点击选中登录框"
          >
            <div className="flex h-full flex-col justify-evenly">
              <div className="flex items-center gap-2 text-blue-600">
                <ShieldCheck size={24} />
                <span className="text-lg font-bold text-gray-800">店牛预警平台</span>
              </div>
              <div className="text-xs text-gray-400">请登录您的账号</div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-gray-500">账号</label>
                <input
                  readOnly
                  placeholder="请输入账号"
                  style={{ height: cfg.loginBox.fieldHeight }}
                  className="rounded-lg border border-gray-200 px-3 text-sm outline-none focus:border-blue-400"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-gray-500">密码</label>
                <input
                  readOnly
                  type="password"
                  placeholder="请输入密码"
                  style={{ height: cfg.loginBox.fieldHeight }}
                  className="rounded-lg border border-gray-200 px-3 text-sm outline-none focus:border-blue-400"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-gray-500">验证码</label>
                <div className="flex items-center gap-2">
                  <input
                    readOnly
                    placeholder="验证码"
                    maxLength={4}
                    style={{ height: cfg.loginBox.fieldHeight }}
                    className="flex-1 rounded-lg border border-gray-200 px-3 text-sm outline-none focus:border-blue-400"
                  />
                  <div
                    className="rounded-md bg-gradient-to-br from-blue-100 to-gray-200 text-center text-xs font-semibold text-blue-600"
                    style={{ width: 90, height: Math.max(30, cfg.loginBox.fieldHeight - 4) }}
                  >
                    验证码
                  </div>
                </div>
              </div>
              <button
                disabled
                className="h-11 w-full rounded-lg bg-blue-600 text-sm font-medium text-white"
              >
                登录
              </button>
              <div className="text-center text-[11px] text-gray-300">© 店牛预警平台 · 零售终端数据预警与通知</div>
            </div>
          </div>
          {editBtn('login')}
        </div>

        {/* 主标题 */}
        <div
          className="absolute select-none"
          style={{
            left: `${cfg.title.x}%`,
            top: `${cfg.title.y}%`,
            transform: 'translateY(-50%)',
            marginLeft: cfg.title.marginLeft,
            outline: activeKey === 'title' ? '2px dashed rgba(59,130,246,0.9)' : 'none',
            outlineOffset: '3px',
          }}
          onMouseEnter={() => setHover('title')}
          onMouseLeave={() => setHover((k) => (k === 'title' ? null : k))}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            className="cursor-move leading-tight"
            style={{
              whiteSpace: 'nowrap',
              fontFamily: cfg.title.font,
              fontSize: cfg.title.size,
              fontWeight: cfg.title.weight,
              letterSpacing: `${cfg.title.letterSpacing}px`,
              color: cfg.title.color,
              opacity: cfg.title.opacity,
            }}
            onPointerDown={(e) => startDrag('title', e)}
            title="点击选中主标题"
          >
            {cfg.title.text}
          </div>
          {editBtn('title')}
        </div>

        {/* 副标题 */}
        <div
          className="absolute select-none"
          style={{
            left: `${cfg.subtitle.x}%`,
            top: `${cfg.subtitle.y}%`,
            transform: 'translateY(-50%)',
            marginLeft: cfg.subtitle.marginLeft,
            outline: activeKey === 'subtitle' ? '2px dashed rgba(59,130,246,0.9)' : 'none',
            outlineOffset: '3px',
          }}
          onMouseEnter={() => setHover('subtitle')}
          onMouseLeave={() => setHover((k) => (k === 'subtitle' ? null : k))}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            className="cursor-move mt-2"
            style={{
              whiteSpace: 'nowrap',
              fontFamily: cfg.subtitle.font,
              fontSize: cfg.subtitle.size,
              fontWeight: cfg.subtitle.weight,
              letterSpacing: `${cfg.subtitle.letterSpacing}px`,
              color: cfg.subtitle.color,
              opacity: cfg.subtitle.opacity,
            }}
            onPointerDown={(e) => startDrag('subtitle', e)}
            title="点击选中副标题"
          >
            {cfg.subtitle.text}
          </div>
          {editBtn('subtitle')}
        </div>

        {/* 添加的画布元素 */}
        {cfg.elements.map((el) =>
          el.type === 'text' ? (
            <div
              key={el.id}
              className="absolute select-none"
              style={{
                left: `${el.x}%`,
                top: `${el.y}%`,
                transform: 'translate(-50%,-50%)',
                outline: activeKey === `elem:${el.id}` ? '2px dashed rgba(59,130,246,0.9)' : 'none',
                outlineOffset: '3px',
              }}
              onMouseEnter={() => setHover(`elem:${el.id}`)}
              onMouseLeave={() => setHover((k) => (k === `elem:${el.id}` ? null : k))}
              onClick={(e) => e.stopPropagation()}
            >
              <div
                className="cursor-move leading-tight"
                style={{
                  whiteSpace: 'nowrap',
                  fontFamily: el.font,
                  fontSize: el.size,
                  fontWeight: el.weight,
                  letterSpacing: `${el.letterSpacing}px`,
                  color: el.color,
                  opacity: el.opacity,
                }}
                onPointerDown={(e) => startDrag(`elem:${el.id}`, e)}
                title="点击选中文本"
              >
                {el.text}
              </div>
              {editBtn(`elem:${el.id}`)}
            </div>
          ) : (
            <div
              key={el.id}
              className="absolute select-none"
              style={{
                left: `${el.x}%`,
                top: `${el.y}%`,
                transform: 'translate(-50%,-50%)',
                outline: activeKey === `elem:${el.id}` ? '2px dashed rgba(59,130,246,0.9)' : 'none',
                outlineOffset: '2px',
                lineHeight: 0,
              }}
              onMouseEnter={() => setHover(`elem:${el.id}`)}
              onMouseLeave={() => setHover((k) => (k === `elem:${el.id}` ? null : k))}
              onClick={(e) => e.stopPropagation()}
            >
              <img
                src={el.src}
                alt=""
                className="cursor-move object-cover"
                style={{
                  width: el.width,
                  height: el.height,
                  borderRadius: el.borderRadius,
                  opacity: el.opacity,
                }}
                onPointerDown={(e) => startDrag(`elem:${el.id}`, e)}
                title="点击选中图片"
              />
              {editBtn(`elem:${el.id}`)}
            </div>
          ),
        )}

        {/* 顶部浮动工具条 */}
        <div className="absolute left-1/2 top-3 z-40 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-black/55 px-3 py-1.5 text-white shadow-lg backdrop-blur">
          <div className="relative">
            <button
              onClick={() => setMenuOpen((v) => !v)}
              className="flex items-center gap-1 rounded-full px-2.5 py-1 text-sm hover:bg-white/15"
            >
              <Plus size={15} /> 组件 <ChevronDown size={14} className="opacity-70" />
            </button>
            {menuOpen && (
              <div className="absolute left-0 top-full z-50 mt-1 w-36 overflow-hidden rounded-lg border border-white/10 bg-[#1f2937] py-1 shadow-2xl">
                <button
                  onClick={addTextElement}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-white/90 hover:bg-white/10"
                >
                  <Type size={15} /> 添加文本
                </button>
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    addImageFileRef.current?.click();
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-white/90 hover:bg-white/10"
                >
                  <ImageIcon size={15} /> 添加图片
                </button>
              </div>
            )}
          </div>
          <button
            onClick={() => {
              setMenuOpen(false);
              setEditing('bg');
            }}
            className="rounded-full px-2.5 py-1 text-sm hover:bg-white/15"
            title="设置背景"
          >
            背景
          </button>
          <button
            onClick={() => {
              save();
              setPreview(true);
            }}
            className="rounded-full px-3 py-1 text-sm hover:bg-white/15"
            title="预览登录页实际效果"
          >
            预览
          </button>
          <button onClick={save} className="rounded-full px-3 py-1 text-sm text-white hover:bg-white/15">
            {saved ? '✓ 已保存' : '保存'}
          </button>
          {onBack && (
            <button onClick={onBack} className="rounded-full px-2.5 py-1 text-sm text-white/80 hover:bg-white/15">
              ← 返回
            </button>
          )}
        </div>

        {/* 提示 */}
        <div className="pointer-events-none absolute left-3 top-3 z-20 rounded-full bg-black/30 px-3 py-1 text-[11px] text-white/80 backdrop-blur">
          悬停组件显示「编辑」，点击配置；可直接拖拽移动组件
        </div>
      </div>

      <input ref={addImageFileRef} type="file" accept="image/*" className="hidden" onChange={onAddImageFile} />

      {/* 配置弹窗 */}
      {editing && (
        <div
          className="fixed inset-0 z-[60] bg-black/50"
          onClick={() => setEditing(null)}
        >
          <div
            className="absolute max-h-[82vh] w-[580px] max-w-full overflow-auto rounded-2xl bg-white p-5 shadow-2xl"
            style={{ left: modalPos?.x ?? 0, top: modalPos?.y ?? 0 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="mb-4 flex cursor-move select-none items-center justify-between"
              onPointerDown={(e) => {
                e.stopPropagation();
                modalDragRef.current = { startX: e.clientX, startY: e.clientY, ox: modalPos?.x ?? 0, oy: modalPos?.y ?? 0 };
              }}
              title="拖动标题可移动弹窗"
            >
              <h3 className="flex items-center gap-2 text-base font-semibold text-gray-800">
                <Pencil size={16} className="text-blue-600" /> 配置 · {labelOf(editing)}
              </h3>
              <button onClick={() => setEditing(null)} className="text-gray-400 hover:text-gray-600" title="关闭">
                <X size={18} />
              </button>
            </div>
            <div className="grid grid-cols-2 items-end gap-x-6 gap-y-4">
              {fields(editing)}
              {editingElem && <span className="col-span-2 text-xs text-gray-400">位置可在画布上拖拽调整</span>}
            </div>
          </div>
        </div>
      )}
      {preview && (
        <div className="fixed inset-0 z-[100] bg-white" data-preview="login">
          <button
            onClick={() => setPreview(false)}
            className="absolute right-4 top-4 z-20 flex cursor-pointer items-center gap-2 rounded-full bg-gray-900/85 px-4 py-2 text-sm text-white shadow-lg backdrop-blur hover:bg-gray-900"
            title="退出预览，返回配置"
          >
            退出预览 ← 返回配置
          </button>
          <LoginPage />
        </div>
      )}
    </div>
  );
}