import { NextRequest } from 'next/server';
import { proxy, proxyJson } from '@/lib/nest-proxy';

type Context = { params: Promise<{ folderId: string }> };

export async function PATCH(request: NextRequest, context: Context) {
    const { folderId } = await context.params;
    return proxyJson(request, `/question-banks/folders/${encodeURIComponent(folderId)}`, 'PATCH');
}

export async function DELETE(request: NextRequest, context: Context) {
    const { folderId } = await context.params;
    return proxy(request, `/question-banks/folders/${encodeURIComponent(folderId)}`, {
        method: 'DELETE',
    });
}
