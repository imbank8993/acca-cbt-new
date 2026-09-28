import { proxyGet,proxyJson } from '@/lib/nest-proxy';
import { NextRequest } from 'next/server';

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
