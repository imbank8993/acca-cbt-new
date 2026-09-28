import { proxy } from '@/lib/nest-proxy';
import { NextRequest } from 'next/server';

export async function DELETE(
    request: NextRequest,
    context: { params: Promise<{ sessionId: string }> },
) {
    const { sessionId } = await context.params;
    return proxy(request, `/pas/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' });
}
