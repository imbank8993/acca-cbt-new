import { NextRequest } from 'next/server';
import { proxy } from '@/lib/nest-proxy';

export async function DELETE(
    request: NextRequest,
    context: { params: Promise<{ sessionId: string }> },
) {
    const { sessionId } = await context.params;
    return proxy(request, `/pas/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' });
}
