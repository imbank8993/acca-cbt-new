import { proxy } from '@/lib/nest-proxy';
import { NextRequest } from 'next/server';

export async function PATCH(
    request: NextRequest,
    context: { params: Promise<{ id: string }> },
) {
    const { id } = await context.params;
    return proxy(request, `/notifications/${encodeURIComponent(id)}/read`, { method: 'PATCH' });
}
