import { NextRequest } from 'next/server';
import { proxy } from '@/lib/nest-proxy';

export async function PATCH(
    request: NextRequest,
    context: { params: Promise<{ id: string }> },
) {
    const { id } = await context.params;
    return proxy(request, `/notifications/${encodeURIComponent(id)}/read`, { method: 'PATCH' });
}
