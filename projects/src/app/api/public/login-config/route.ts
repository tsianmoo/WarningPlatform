import { NextResponse } from 'next/server';
import { getHomeConfig } from '@/lib/server/repo';
import { DEFAULT_HOME_CONFIG } from '@/lib/types';
import { fail } from '@/lib/server/api';

/**
 * 登录页样式配置（无需登录）。
 *
 * 旧版登录页直接调 /api/state 拿配置，导致匿名调用方能拿到全部业务数据
 * （包括 persons/dealers/stores/employees 的明文密码列）。
 * 这里只返回渲染登录页必需的视觉字段。
 */
function publicPart(cfg: Record<string, unknown> | null) {
  const src = (cfg ?? DEFAULT_HOME_CONFIG) as Record<string, unknown>;
  return {
    title: src.title,
    subtitle: src.subtitle,
    loginBox: src.loginBox,
    elements: Array.isArray(src.elements) ? src.elements : [],
    bgMode: src.bgMode,
    bgColor: src.bgColor,
    bgImage: src.bgImage,
    bgBlur: src.bgBlur,
  };
}

export async function GET() {
  try {
    const cfg = await getHomeConfig();
    return NextResponse.json({ config: publicPart(cfg as Record<string, unknown> | null) });
  } catch (err) {
    // 数据库不可用时仍要能打开登录页，退回内置默认样式
    try {
      return NextResponse.json({ config: publicPart(null) });
    } catch {
      return fail(err);
    }
  }
}
