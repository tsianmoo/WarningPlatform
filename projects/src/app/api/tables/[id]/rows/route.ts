import { NextResponse } from 'next/server';
import { getAllTableRows, replaceTableRows, clearTableRows, appendTableRows } from '@/lib/server/repo';
import { requireAccount } from '@/lib/server/auth';
import { assertModuleOp } from '@/lib/server/authz';
import { fail } from '@/lib/server/api';

/** 读取某数据表的全量行数据（rows 与元数据分离存储） */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAccount();
    const { id } = await params;
    const rows = await getAllTableRows(id);
    return NextResponse.json({ id, rows, count: rows.length });
  } catch (err) {
    return fail(err);
  }
}

/**
 * 保存某表行数据，支持两种模式：
 *   - 整包覆盖（不传 phase）：一次请求写全量，行为与旧版一致
 *   - 分片上传（phase='start' | 'append'）：大表分多次 POST，
 *     start 先清空再写第一片，append 按偏移量追加；任何一片失败客户端会重试
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const account = await requireAccount();
    // 覆盖式写行属于数据表管理的写操作，同样走服务端授权
    await assertModuleOp(account, 'datatables', ['create', 'edit', 'upload']);
    const { id } = await params;
    const body = (await req.json()) as { rows?: unknown; phase?: string; offset?: number };
    const rows = (Array.isArray(body.rows) ? body.rows : []) as Record<string, unknown>[];
    if (body.phase === 'start') {
      await clearTableRows(id);
      await appendTableRows(id, rows, 0);
    } else if (body.phase === 'append') {
      await appendTableRows(id, rows, Math.max(0, Number(body.offset ?? 0) || 0));
    } else {
      await replaceTableRows(id, rows);
    }
    return NextResponse.json({ success: true, id, count: rows.length });
  } catch (err) {
    return fail(err);
  }
}
