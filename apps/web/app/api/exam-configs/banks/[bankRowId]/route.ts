import { proxy,proxyJson } from '@/lib/nest-proxy';
import { NextRequest } from 'next/server';

type Context = { params: Promise<{ bankRowId: string }> };

export async function PATCH(request: NextRequest, context: Context) {
    const { bankRowId } = await context.params;
    return proxyJson(request, `/exam-configs/banks/${encodeURIComponent(bankRowId)}`, 'PATCH');
}

export async function DELETE(request: NextRequest, context: Context) {
    const { bankRowId } = await context.params;
    return proxy(request, `/exam-configs/banks/${encodeURIComponent(bankRowId)}`, {
        method: 'DELETE',
    });
}
