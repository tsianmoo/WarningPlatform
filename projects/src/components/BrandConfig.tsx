import { ChangeEvent } from 'react';
import { ImageIcon, Trash2 } from 'lucide-react';
import { useStore } from '@/lib/store';
import { DEFAULT_HOME_CONFIG, FONT_OPTIONS, HomeTitleStyle } from '@/lib/types';

type Pad = { top: number; right: number; bottom: number; left: number };
type Brand = HomeTitleStyle & { logo?: string; padding?: Pad };



function numClamp(v: number, min: number, max: number): number {
  if (Number.isNaN(v)) return min;
  return Math.min(max, Math.max(min, v));
}

export default function BrandConfig() {
  const { state, updateHomeConfig } = useStore();
  const brand: Brand = state.config.brand || DEFAULT_HOME_CONFIG.brand;
  const pad: Pad = brand.padding || { top: 20, right: 16, bottom: 20, left: 16 };
  const patch = (p: Partial<Brand>) => updateHomeConfig((c) => ({ ...c, brand: { ...c.brand, ...p } }));
  const patchPad = (k: keyof Pad, v: number) =>
    patch({ padding: { top: pad.top, right: pad.right, bottom: pad.bottom, left: pad.left, [k]: numClamp(v, 0, 80) } });

  const onLogo = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => patch({ logo: String(reader.result || '') });
    reader.readAsDataURL(f);
  };

  const num = (v: number) => (Number.isFinite(v) ? v : 0);

  return (
    <div className="p-6">
        <div className="text-[15px] font-semibold text-gray-900">基础信息管理</div>
        <div className="mt-0.5 mb-5 text-xs text-gray-400">配置品牌 LOGO、系统名称与文字样式</div>

        {/* LOGO */}
        <div className="mb-5 border-b border-gray-100 pb-5">
          <div className="mb-3 text-[13px] font-medium text-gray-500">LOGO</div>
          <div className="flex items-center gap-4">
            <label className="flex h-16 w-16 cursor-pointer items-center justify-center overflow-hidden rounded-xl border border-dashed border-gray-300 bg-gray-50 transition-colors hover:border-gray-400 hover:bg-gray-100">
              {brand.logo ? (
                <img src={brand.logo} alt="logo" className="h-full w-full object-contain" />
              ) : (
                <ImageIcon size={22} className="text-gray-400" />
              )}
              <input type="file" accept="image/*" className="hidden" onChange={onLogo} />
            </label>
            <div className="space-y-1.5 text-xs text-gray-500">
              <div>点击上传 LOGO 图片（png / jpg / webp）</div>
              {brand.logo && (
                <button onClick={() => patch({ logo: '' })} className="flex items-center gap-1 text-red-500 hover:text-red-600">
                  <Trash2 size={13} /> 移除 LOGO
                </button>
              )}
            </div>
          </div>
        </div>

        {/* 系统名称 */}
        <div className="mb-4">
          <label className="mb-1 block text-sm font-medium text-gray-700">系统名称</label>
          <input
            value={brand.text}
            onChange={(e) => patch({ text: e.target.value })}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-200"
            placeholder="请输入系统名称"
          />
        </div>

        {/* 字体样式 */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">字体</label>
            <select
              value={brand.font}
              onChange={(e) => patch({ font: e.target.value })}
              className="w-full rounded-lg border border-gray-300 px-2 py-2 text-sm outline-none focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-200"
            >
              {FONT_OPTIONS.map((f) => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">字重</label>
            <select
              value={String(num(brand.weight) || 700)}
              onChange={(e) => patch({ weight: Number(e.target.value) })}
              className="w-full rounded-lg border border-gray-300 px-2 py-2 text-sm outline-none focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-200"
            >
              {[100, 200, 300, 400, 500, 600, 700, 800, 900, 1000].map((w) => (
                <option key={w} value={w}>{w}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">字号：{Math.round(num(brand.size))}px</label>
            <div className="flex items-center gap-3">
              <input
                type="range" min={10} max={48} value={numClamp(num(brand.size), 10, 48)}
                onChange={(e) => patch({ size: Number(e.target.value) })}
                className="flex-1"
              />
              <input
                type="number" min={10} max={48} value={num(brand.size)}
                onChange={(e) => patch({ size: numClamp(Number(e.target.value), 10, 48) })}
                className="w-16 rounded-md border border-gray-300 px-2 py-1 text-center text-sm outline-none focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-200"
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">字间距：{Math.round(num(brand.letterSpacing))}px</label>
            <div className="flex items-center gap-3">
              <input
                type="range" min={0} max={20} value={numClamp(num(brand.letterSpacing), 0, 20)}
                onChange={(e) => patch({ letterSpacing: Number(e.target.value) })}
                className="flex-1"
              />
              <input
                type="number" min={0} max={20} value={num(brand.letterSpacing)}
                onChange={(e) => patch({ letterSpacing: numClamp(Number(e.target.value), 0, 20) })}
                className="w-16 rounded-md border border-gray-300 px-2 py-1 text-center text-sm outline-none focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-200"
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">字体颜色</label>
            <div className="flex items-center gap-2">
              <input
                type="color" value={brand.color || '#000000'}
                onChange={(e) => patch({ color: e.target.value })}
                className="h-8 w-10 cursor-pointer rounded-md border border-gray-200 bg-white"
              />
              <span className="rounded-md border border-gray-200 bg-gray-50 px-2 py-1 font-mono text-xs text-gray-500">{brand.color || '#000000'}</span>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">颜色透明度：{Math.round((brand.opacity ?? 1) * 100)}%</label>
            <input
              type="range" min={0} max={100} value={Math.round((brand.opacity ?? 1) * 100)}
              onChange={(e) => patch({ opacity: Number(e.target.value) / 100 })}
              className="w-full"
            />
          </div>
        </div>

        {/* 内边距（上 右 下 左） */}
        <div className="mt-4 border-t border-gray-100 pt-4">
          <div className="mb-1 text-sm font-medium text-gray-700">内边距（px）</div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {(
              [
                ['top', '上', numClamp(pad.top, 0, 80)],
                ['right', '右', numClamp(pad.right, 0, 80)],
                ['bottom', '下', numClamp(pad.bottom, 0, 80)],
                ['left', '左', numClamp(pad.left, 0, 80)],
              ] as [keyof Pad, string, number][]
            ).map(([k, label, v]) => (
              <div key={k}>
                <label className="mb-1 block text-xs text-gray-500">{label}：{Math.round(v)}</label>
                <div className="flex items-center gap-2">
                  <input
                    type="range" min={0} max={80} value={v}
                    onChange={(e) => patchPad(k, Number(e.target.value))}
                    className="flex-1"
                  />
                  <input
                    type="number" min={0} max={80} value={v}
                    onChange={(e) => patchPad(k, Number(e.target.value))}
                    className="w-14 rounded-md border border-gray-300 px-1 py-1 text-center text-xs outline-none focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-200"
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
    </div>
  );
}