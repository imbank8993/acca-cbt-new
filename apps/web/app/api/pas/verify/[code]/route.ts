import { nestFetchInternal } from '@/lib/nest-api';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(
    _request: NextRequest,
    context: { params: Promise<{ code: string }> },
) {
    const { code } = await context.params;
    const { status, body } = await nestFetchInternal<Record<string, unknown>>(
        `/pas/verify/${encodeURIComponent(code)}`,
        { method: 'GET' },
    );

    if (status < 200 || status >= 300) {
        return NextResponse.json(
            {
                success: false,
                valid: false,
                error: (body?.error as string) || (body?.message as string) || 'Gagal memverifikasi dokumen.',
            },
            { status },
        );
    }

    return NextResponse.json({ success: true, ...(body || {}) }, { status: 200 });
}
