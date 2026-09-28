import { proxy,proxyGet,proxyJson } from '@/lib/nest-proxy';
import { NextRequest } from 'next/server';

type Context = { params: Promise<{ bankId: string }> };

export async function GET(request: NextRequest, context: Context) {
    const { bankId } = await context.params;
    return proxyGet(request, `/question-banks/${encodeURIComponent(bankId)}`);
}

export async function PATCH(request: NextRequest, context: Context) {
    const { bankId } = await context.params;
    return proxyJson(request, `/question-banks/${encodeURIComponent(bankId)}`, 'PATCH');
}

export async function DELETE(request: NextRequest, context: Context) {
    const { bankId } = await context.params;
    return proxy(request, `/question-banks/${encodeURIComponent(bankId)}`, { method: 'DELETE' });
}
