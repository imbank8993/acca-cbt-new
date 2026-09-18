import { NextRequest } from 'next/server';
import { proxyJson } from '@/lib/nest-proxy';

export async function PUT(
    request: NextRequest,
    context: { params: Promise<{ attemptId: string }> },
) {
    const { attemptId } = await context.params;
    return proxyJson(request, `/students/attempts/${encodeURIComponent(attemptId)}/answers`, 'PUT');
}
