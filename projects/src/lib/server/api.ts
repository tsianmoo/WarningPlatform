import { NextResponse } from 'next/server';
import { UnauthorizedError } from '@/lib/server/auth';
import { ForbiddenError } from '@/lib/server/authz';

/**
 * 统一错误响应：
 *   未登录 → 401；已登录但无权限 → 403；其它 → 500（不外泄内部细节）
 * 403 的文案是主动写的业务提示，可以安全外露；500 的原始信息只进服务端日志。
 */
export function fail(err: unknown, status = 500) {
  if (err instanceof UnauthorizedError) {
    return NextResponse.json({ error: err.message }, { status: 401 });
  }
  if (err instanceof ForbiddenError) {
    return NextResponse.json({ error: err.message }, { status: 403 });
  }
  const msg = err instanceof Error ? err.message : 'unknown error';
  console.error('[api]', msg);
  return NextResponse.json({ error: msg }, { status });
}

export function ok(data: unknown) {
  return NextResponse.json(data);
}

/** 从请求取客户端 IP（用于审计） */
export function clientIp(req: Request): string | null {
  const h = req.headers;
  const fwd = h.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return h.get('x-real-ip') || null;
}
