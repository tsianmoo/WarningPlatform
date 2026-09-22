import { NextResponse, type NextRequest } from 'next/server';

/**
 * 访问网关。
 *
 * 修正旧设计：旧版完全没有 middleware，状态接口、数据表行接口、
 * 同步接口全部匿名可访问，且服务端用高权限密钥直连数据库，
 * 因此一条 curl 即可清空业务数据。
 *
 * 这里做「有无会话 Cookie」的轻量闸门（不做数据库查询，保持 Edge 兼容）；
 * 真实有效性由各 Route Handler 内的 requireAccount() 查库校验。
 */

const SESSION_COOKIE = 'dn_session';

/** 无需登录即可访问 */
const PUBLIC_PATHS = ['/login'];
const PUBLIC_API = ['/api/auth/login'];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (PUBLIC_API.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next();
  }
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next();
  }

  const hasSession = !!req.cookies.get(SESSION_COOKIE)?.value;

  if (pathname.startsWith('/api/')) {
    if (!hasSession) {
      return NextResponse.json({ error: '未登录或会话已过期' }, { status: 401 });
    }
    return NextResponse.next();
  }

  if (!hasSession) {
    // 用 req.url 而不是 req.nextUrl.clone()：后者在自定义 server 下会退化成
    // 配置里的 hostname（曾出现从 127.0.0.1 跳去 localhost 的情况）。
    return NextResponse.redirect(new URL('/login', req.url));
  }

  return NextResponse.next();
}

export const config = {
  // 排除静态资源与图片优化
  matcher: ['/((?!_next/static|_next/image|favicon.ico|robots.txt|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|css|js|woff2?)$).*)'],
};
