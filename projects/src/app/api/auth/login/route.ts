import { NextResponse } from 'next/server';
import { login, SESSION_COOKIE, SESSION_TTL_MS, purgeExpiredSessions } from '@/lib/server/auth';
import { writeAudit } from '@/lib/server/repo';
import { fail, clientIp } from '@/lib/server/api';

const REASON_MSG: Record<string, string> = {
  invalid: '账号或密码错误',
  disabled: '账号已停用，请联系管理员',
  locked: '连续失败次数过多，账号已临时锁定，请稍后再试',
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { username?: string; password?: string };
    const username = String(body.username ?? '').trim();
    const password = String(body.password ?? '');
    if (!username || !password) {
      return NextResponse.json({ error: '请输入账号和密码' }, { status: 400 });
    }

    const ip = clientIp(req);
    const ua = req.headers.get('user-agent');
    const result = await login(username, password, ip, ua);
    if (!result.ok) {
      await writeAudit(username, 'auth.login.failed', 'account', null, { reason: result.reason }, ip);
      // 统一文案，不泄露「账号是否存在」
      const status = result.reason === 'locked' ? 429 : 401;
      return NextResponse.json({ error: REASON_MSG[result.reason] ?? '登录失败' }, { status });
    }

    // 顺手清理过期会话（低成本、避免表无限增长）
    purgeExpiredSessions().catch(() => {});
    await writeAudit(result.account.displayName || username, 'auth.login', 'account', result.account.id, null, ip);

    const res = NextResponse.json({ success: true, account: result.account });
    res.cookies.set(SESSION_COOKIE, result.token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: Math.floor(SESSION_TTL_MS / 1000),
    });
    return res;
  } catch (err) {
    return fail(err);
  }
}
