import { NextRequest } from 'next/server';
import { proxy } from '@/lib/nest-proxy';

export async function DELETE(
    request: NextRequest,
    context: { params: Promise<{ scheduleId: string }> },
) {
    const { scheduleId } = await context.params;
    return proxy(request, `/exam-configs/schedules/${encodeURIComponent(scheduleId)}`, {
        method: 'DELETE',
    });
}
