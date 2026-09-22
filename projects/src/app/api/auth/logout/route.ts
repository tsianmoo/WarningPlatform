import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { SESSION_COOKIE, destroySession, currentAccount } from '@/lib/server/auth';
import { writeAudit } from '@/lib/server/repo';
import { fail, clientIp } from '@/lib/server/api';

export async function POST(req: Request) {
  try {
    const store = await cookies();
    const token = store.get(SESSION_COOKIE)?.value;
    const acc = await currentAccount();
    if (acc) {
      await writeAudit(acc.displayName || acc.username, 'auth.logout', 'account', acc.id, null, clientIp(req));
    }
    if (token) await destroySession(token);

    const res = NextResponse.json({ success: true });
    res.cookies.set(SESSION_COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 });
    return res;
  } catch (err) {
    return fail(err);
  }
}
