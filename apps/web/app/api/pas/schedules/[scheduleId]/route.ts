import { proxy } from '@/lib/nest-proxy';
import { NextRequest } from 'next/server';

export async function DELETE(
    request: NextRequest,
    context: { params: Promise<{ scheduleId: string }> },
) {
    const { scheduleId } = await context.params;
    return proxy(request, `/pas/schedules/${encodeURIComponent(scheduleId)}`, {
        method: 'DELETE',
    });
}
