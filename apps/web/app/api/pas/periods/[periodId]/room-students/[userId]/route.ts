import { NextRequest } from 'next/server';
import { proxy } from '@/lib/nest-proxy';

export async function DELETE(
    request: NextRequest,
    context: { params: Promise<{ periodId: string; userId: string }> },
) {
    const { periodId, userId } = await context.params;
    return proxy(
        request,
        `/pas/periods/${encodeURIComponent(periodId)}/room-students/${encodeURIComponent(userId)}`,
        { method: 'DELETE' },
    );
}
