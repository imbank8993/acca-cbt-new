import { proxyJson } from '@/lib/nest-proxy';
import { NextRequest } from 'next/server';

export async function PUT(
    request: NextRequest,
    context: { params: Promise<{ roomId: string }> },
) {
    const { roomId } = await context.params;
    return proxyJson(request, `/pas/rooms/${encodeURIComponent(roomId)}/invigilators`, 'PUT');
}
