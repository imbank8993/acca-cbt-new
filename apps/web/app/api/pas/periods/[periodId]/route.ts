import { proxy,proxyGet } from '@/lib/nest-proxy';
import { NextRequest } from 'next/server';

type Context = { params: Promise<{ periodId: string }> };

export async function GET(request: NextRequest, context: Context) {
    const { periodId } = await context.params;
    return proxyGet(request, `/pas/periods/${encodeURIComponent(periodId)}`);
}

export async function DELETE(request: NextRequest, context: Context) {
    const { periodId } = await context.params;
    return proxy(request, `/pas/periods/${encodeURIComponent(periodId)}`, { method: 'DELETE' });
}

export async function PATCH(request: NextRequest, context: Context) {
    const { periodId } = await context.params;
    const body = await request.text();
    return proxy(request, `/pas/periods/${encodeURIComponent(periodId)}`, {
        method: 'PATCH',
        body: body || undefined,
    });
}
