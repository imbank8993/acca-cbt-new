import { proxy } from '@/lib/nest-proxy';
import { NextRequest } from 'next/server';

export async function DELETE(
    request: NextRequest,
    context: { params: Promise<{ roomId: string }> },
) {
    const { roomId } = await context.params;
    return proxy(request, `/pas/rooms/${encodeURIComponent(roomId)}`, { method: 'DELETE' });
}
