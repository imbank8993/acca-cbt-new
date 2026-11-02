import { proxyGet, proxyJson } from '@/lib/nest-proxy';
import { NextRequest } from 'next/server';

type Context = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: Context) {
    const { id } = await context.params;
    return proxyGet(request, `/validations/${encodeURIComponent(id)}`);
}

/** Admin/Proktor mengubah judul, instruksi, batas waktu, atau validator. */
export async function PATCH(request: NextRequest, context: Context) {
    const { id } = await context.params;
    return proxyJson(request, `/validations/${encodeURIComponent(id)}`, 'PATCH');
}

export async function DELETE(request: NextRequest, context: Context) {
    const { id } = await context.params;
    return proxyJson(request, `/validations/${encodeURIComponent(id)}`, 'DELETE');
}
