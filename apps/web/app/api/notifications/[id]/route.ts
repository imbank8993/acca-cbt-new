import { NextRequest } from 'next/server';
import { proxy } from '@/lib/nest-proxy';

export async function DELETE(
    request: NextRequest,
    context: { params: Promise<{ id: string }> },
) {
    const { id } = await context.params;
    return proxy(request, `/notifications/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
