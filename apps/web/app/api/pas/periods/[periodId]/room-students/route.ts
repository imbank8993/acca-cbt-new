import { proxyJson } from '@/lib/nest-proxy';
import { NextRequest } from 'next/server';

export async function PUT(
    request: NextRequest,
    context: { params: Promise<{ periodId: string }> },
) {
    const { periodId } = await context.params;
    return proxyJson(request, `/pas/periods/${encodeURIComponent(periodId)}/room-students`, 'PUT');
}
