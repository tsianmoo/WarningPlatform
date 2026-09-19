import { NextResponse } from 'next/server';
import { gunzipSync } from 'zlib';
import { putTablesDirect } from '@/lib/server/repo';
import type { DataTable } from '@/lib/types';

export const runtime = 'nodejs';

// 大表独立上传通道：单独接收一张（可 gzip）数据表，Postgres 直连写入，避免混入 /api/state 超大 body。
export async function POST(req: Request) {
  try {
    let raw: unknown;
    if (req.headers.get('content-encoding') === 'gzip') {
      const buf = Buffer.from(await req.arrayBuffer());
      raw = JSON.parse(gunzipSync(buf).toString('utf8'));
    } else {
      raw = await req.json();
    }
    const t = (raw as { table?: DataTable }).table;
    if (!t || !t.id || !Array.isArray(t.rows)) {
      return NextResponse.json({ error: '缺少有效的数据表内容' }, { status: 400 });
    }
    await putTablesDirect([
      {
        id: t.id,
        name: t.name,
        file_name: t.fileName ?? '',
        row_count: t.rowCount ?? 0,
        created_at: t.createdAt ?? Date.now(),
        data: t,
      },
    ]);
    return NextResponse.json({ success: true, id: t.id, rowCount: t.rowCount ?? 0 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}