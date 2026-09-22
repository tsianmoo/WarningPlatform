import { NextResponse } from 'next/server';
import { requireAccount, listAccounts, resetPassword, isPasswordStrong, DEFAULT_INITIAL_PASSWORD } from '@/lib/server/auth';
import { writeAudit } from '@/lib/server/repo';
import { fail, clientIp } from '@/lib/server/api';

function ensureAdmin(subjectType: string) {
  if (subjectType !== 'admin') {
    const err = new Error('仅管理员可执行此操作');
    (err as Error & { status?: number }).status = 403;
    throw err;
  }
}

/** 账号列表（仅管理员）。绝不返回 password_hash。 */
export async function GET() {
  try {
    const acc = await requireAccount();
    ensureAdmin(acc.subjectType);
    const rows = await listAccounts();
    return NextResponse.json({
      accounts: rows.map((r) => ({
        id: r.id,
        username: r.username,
        displayName: r.display_name,
        subjectType: r.subject_type,
        subjectId: r.subject_id,
        enabled: r.enabled,
        mustChangePassword: r.must_change_password,
        lastLoginAt: r.last_login_at,
      })),
    });
  } catch (err) {
    const status = (err as Error & { status?: number }).status;
    return fail(err, status === 403 ? 403 : 500);
  }
}

/** 管理员重置某账号密码 → 不传 newPassword 时回到初始密码，两种情况都强制下次登录修改 */
export async function POST(req: Request) {
  try {
    const acc = await requireAccount();
    ensureAdmin(acc.subjectType);
    const body = (await req.json()) as { accountId?: string; newPassword?: string };
    const accountId = String(body.accountId ?? '');
    if (!accountId) return NextResponse.json({ error: '缺少 accountId' }, { status: 400 });

    const custom = String(body.newPassword ?? '').trim();
    if (custom && !isPasswordStrong(custom)) {
      return NextResponse.json({ error: '新密码至少 8 位，且需同时包含字母和数字' }, { status: 400 });
    }

    await resetPassword(accountId, custom || undefined);
    await writeAudit(
      acc.displayName || acc.username,
      custom ? 'auth.password.set' : 'auth.password.reset',
      'account',
      accountId,
      null,
      clientIp(req)
    );
    return NextResponse.json({
      success: true,
      password: custom || DEFAULT_INITIAL_PASSWORD,
      message: custom
        ? '已设置新密码，该用户下次登录须修改'
        : '已重置为初始密码，该用户下次登录须修改',
    });
  } catch (err) {
    const status = (err as Error & { status?: number }).status;
    return fail(err, status === 403 ? 403 : 500);
  }
}
