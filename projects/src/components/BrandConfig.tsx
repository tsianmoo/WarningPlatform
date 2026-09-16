import { ChangeEvent } from 'react';
import { ImageIcon, Trash2 } from 'lucide-react';
import { useStore } from '@/lib/store';
import { DEFAULT_HOME_CONFIG, FONT_OPTIONS, HomeTitleStyle } from '@/lib/types';

function hexToRgba(hex: string, alpha: number): string {
  const h = (hex || '#000000').replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  if (Number.isNaN(n)) return `rgba(0,0,0,${alpha})`;
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

function numClamp(v: number, min: number, max: number): number {
  if (Number.isNaN(v)) return min;
  return Math.min(max, Math.max(min, v));
}

export default function BrandConfig({ onHome }: { onHome: () => void }) {
  const { state, updateHomeConfig } = useStore();
  const brand: HomeTitleStyle & { logo?: string } = state.config.brand || DEFAULT_HOME_CONFIG.brand;
  const patch = (p: Partial<HomeTitleStyle & { logo?: string }>) =>
    updateHomeConfig((c) => ({ ...c, brand: { ...c.brand, ...p } }));

  const onLogo = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => patch({ logo: String(reader.result || '') });
    reader.readAsDataURL(f);
  };

  const num = (v: number) => (Number.isFinite(v) ? v : 0);

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="mb-4 text-base font-semibold text-gray-800">基础信息管理</div>

        {/* 实时预览 */}
        <div className="mb-5 rounded-xl border border-dashed border-gray-200 bg-gray-50/70 p-4">
          <div className="mb-2 text-xs text-gray-400">实时预览</div>
          <div className="flex items-center gap-2 px-2 py-3">
            {brand.logo && <img src={brand.logo} alt="logo" className="h-8 w-8 object-contain" />}
            <span
              style={{
                fontFamily: brand.font || 'system-ui',
                fontSize: num(brand.size),
                fontWeight: num(brand.weight),
                letterSpacing: num(brand.letterSpacing),
                color: hexToRgba(brand.color, brand.opacity ?? 1),
              }}
            >
              {brand.text || '系统名称'}
            </span>
          </div>
        </div>

        {/* LOGO */}
        <div className="mb-4 border-b border-gray-100 pb-4">
          <div className="mb-1 text-sm font-medium text-gray-700">LOGO</div>
          <div className="flex items-center gap-4">
            <label className="flex h-16 w-16 cursor-pointer items-center justify-center overflow-hidden rounded-xl border border-dashed border-gray-300 bg-gray-50 hover:border-blue-400">
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
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
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
              className="w-full rounded-lg border border-gray-300 px-2 py-2 text-sm outline-none focus:border-blue-500"
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
              className="w-full rounded-lg border border-gray-300 px-2 py-2 text-sm outline-none focus:border-blue-500"
            >
              <option value="400">常规 (400)</option>
              <option value="500">中等 (500)</option>
              <option value="600">半粗 (600)</option>
              <option value="700">加粗 (700)</option>
              <option value="800">特粗 (800)</option>
              <option value="900">黑体 (900)</option>
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
                className="w-16 rounded-md border border-gray-300 px-2 py-1 text-center text-sm outline-none focus:border-blue-500"
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
                className="w-16 rounded-md border border-gray-300 px-2 py-1 text-center text-sm outline-none focus:border-blue-500"
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
      </div>

      <button onClick={onHome} className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-600 hover:bg-gray-50">
        返回首页
      </button>
    </div>
  );
}