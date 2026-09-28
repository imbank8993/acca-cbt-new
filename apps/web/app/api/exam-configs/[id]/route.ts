import { proxy,proxyGet,proxyJson } from '@/lib/nest-proxy';
import { NextRequest } from 'next/server';

type Params = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Params) {
    const { id } = await params;
    return proxyGet(request, `/exam-configs/${encodeURIComponent(id)}`);
}

export async function PATCH(request: NextRequest, { params }: Params) {
    const { id } = await params;
    return proxyJson(request, `/exam-configs/${encodeURIComponent(id)}`, 'PATCH');
}

export async function DELETE(request: NextRequest, { params }: Params) {
    const { id } = await params;
    return proxy(request, `/exam-configs/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
