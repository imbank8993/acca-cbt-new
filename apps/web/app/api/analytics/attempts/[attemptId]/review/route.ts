import { NextRequest } from 'next/server';
import { proxyGet } from '@/lib/nest-proxy';

export async function GET(
    request: NextRequest,
    context: { params: Promise<{ attemptId: string }> },
) {
    const { attemptId } = await context.params;
    return proxyGet(request, `/analytics/attempts/${encodeURIComponent(attemptId)}/review`);
}
