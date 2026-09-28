import { proxy,proxyJson } from '@/lib/nest-proxy';
import { NextRequest } from 'next/server';

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, context: Context) {
    const { id } = await context.params;
    return proxyJson(request, `/question-banks/kisi-kisi/${encodeURIComponent(id)}`, 'PATCH');
}

export async function DELETE(request: NextRequest, context: Context) {
    const { id } = await context.params;
    return proxy(request, `/question-banks/kisi-kisi/${encodeURIComponent(id)}`, {
        method: 'DELETE',
    });
}
