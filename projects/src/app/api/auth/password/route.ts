import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { requireAccount, changePassword, login, SESSION_COOKIE, SESSION_TTL_MS } from '@/lib/server/auth';
import { writeAudit } from '@/lib/server/repo';
import { fail, clientIp } from '@/lib/server/api';

/** 修改自己的密码。成功后旧会话全部失效，并为当前请求换发新会话。 */
export async function POST(req: Request) {
  try {
    const acc = await requireAccount();
    const body = (await req.json()) as { oldPassword?: string; newPassword?: string };
    const oldPassword = String(body.oldPassword ?? '');
    const newPassword = String(body.newPassword ?? '');

    if (!oldPassword || !newPassword) {
      return NextResponse.json({ error: '请填写原密码与新密码' }, { status: 400 });
    }
    if (newPassword === oldPassword) {
      return NextResponse.json({ error: '新密码不能与原密码相同' }, { status: 400 });
    }

    const result = await changePassword(acc.id, oldPassword, newPassword);
    if (!result.ok) {
      const msg =
        result.reason === 'weak'
          ? '新密码至少 8 位，且需同时包含字母和数字'
          : '原密码不正确';
      return NextResponse.json({ error: msg }, { status: 400 });
    }

    await writeAudit(acc.displayName || acc.username, 'auth.password.changed', 'account', acc.id, null, clientIp(req));

    // 改密会清空全部会话，这里为当前浏览器重新登录一次，避免用户被立刻踢出
    const relogin = await login(acc.username, newPassword, clientIp(req), req.headers.get('user-agent'));
    const res = NextResponse.json({ success: true });
    if (relogin.ok) {
      res.cookies.set(SESSION_COOKIE, relogin.token, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
        maxAge: Math.floor(SESSION_TTL_MS / 1000),
      });
    } else {
      const store = await cookies();
      void store;
      res.cookies.set(SESSION_COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 });
    }
    return res;
  } catch (err) {
    return fail(err);
  }
}
