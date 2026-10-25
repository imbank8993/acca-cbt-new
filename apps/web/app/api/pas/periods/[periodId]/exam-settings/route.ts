import { proxy } from '@/lib/nest-proxy';
import { NextRequest } from 'next/server';

type Context = { params: Promise<{ periodId: string }> };

export async function PUT(request: NextRequest, context: Context) {
    const { periodId } = await context.params;
    const body = await request.text();
    return proxy(request, `/pas/periods/${encodeURIComponent(periodId)}/exam-settings`, {
        method: 'PUT',
        body: body || undefined,
    });
}
