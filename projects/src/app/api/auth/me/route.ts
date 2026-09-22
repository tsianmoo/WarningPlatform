import { NextResponse } from 'next/server';
import { currentAccount } from '@/lib/server/auth';
import { fail } from '@/lib/server/api';

/** 当前登录身份。未登录返回 401，供前端路由守卫使用。 */
export async function GET() {
  try {
    const acc = await currentAccount();
    if (!acc) return NextResponse.json({ error: '未登录' }, { status: 401 });
    return NextResponse.json({ account: acc });
  } catch (err) {
    return fail(err);
  }
}
