import { NextRequest } from 'next/server';
import { proxy, proxyJson } from '@/lib/nest-proxy';

type Context = { params: Promise<{ classId: string }> };

export async function PATCH(request: NextRequest, context: Context) {
    const { classId } = await context.params;
    return proxyJson(request, `/proctor/classes/${encodeURIComponent(classId)}`, 'PATCH');
}

export async function DELETE(request: NextRequest, context: Context) {
    const { classId } = await context.params;
    return proxy(request, `/proctor/classes/${encodeURIComponent(classId)}`, {
        method: 'DELETE',
    });
}
