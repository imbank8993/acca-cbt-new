import { NextRequest } from 'next/server';
import { proxy, proxyJson } from '@/lib/nest-proxy';

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, context: Context) {
    const { id } = await context.params;
    return proxyJson(request, `/question-banks/stimuli/${encodeURIComponent(id)}`, 'PATCH');
}

export async function DELETE(request: NextRequest, context: Context) {
    const { id } = await context.params;
    return proxy(request, `/question-banks/stimuli/${encodeURIComponent(id)}`, {
        method: 'DELETE',
    });
}
