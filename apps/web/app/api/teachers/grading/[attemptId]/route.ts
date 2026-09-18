import { NextRequest } from 'next/server';
import { proxyGet, proxyJson } from '@/lib/nest-proxy';

export async function GET(
    request: NextRequest,
    context: { params: Promise<{ attemptId: string }> },
) {
    const { attemptId } = await context.params;
    return proxyGet(request, `/teachers/grading/${encodeURIComponent(attemptId)}`);
}

export async function PUT(
    request: NextRequest,
    context: { params: Promise<{ attemptId: string }> },
) {
    const { attemptId } = await context.params;
    return proxyJson(request, `/teachers/grading/${encodeURIComponent(attemptId)}`, 'PUT');
}
