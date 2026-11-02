import { proxyJson } from '@/lib/nest-proxy';
import { NextRequest } from 'next/server';

type Context = { params: Promise<{ folderId: string }> };

export async function PATCH(request: NextRequest, context: Context) {
    const { folderId } = await context.params;
    return proxyJson(request, `/validations/folders/${encodeURIComponent(folderId)}`, 'PATCH');
}

export async function DELETE(request: NextRequest, context: Context) {
    const { folderId } = await context.params;
    return proxyJson(request, `/validations/folders/${encodeURIComponent(folderId)}`, 'DELETE');
}
