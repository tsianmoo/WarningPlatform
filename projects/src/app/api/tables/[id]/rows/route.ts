import { NextResponse } from 'next/server';
import { getAllTableRows, replaceTableRows } from '@/lib/server/repo';

/** 读取某数据表的全量行数据（rows 已与元数据分离存储，故此处单独提供） */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const rows = await getAllTableRows(id);
    return NextResponse.json({ id, rows, count: rows.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/** 覆盖式保存某数据表的全量行（删除旧行后分批写入） */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = (await req.json()) as { rows?: unknown };
    const rows = (Array.isArray(body.rows) ? (body.rows as Record<string, unknown>[]) : []) as Parameters<typeof replaceTableRows>[1];
    await replaceTableRows(id, rows);
    return NextResponse.json({ success: true, id, count: rows.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}