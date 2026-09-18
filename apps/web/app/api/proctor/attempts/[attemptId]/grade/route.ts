import { NextRequest } from 'next/server';
import { proxyJson } from '@/lib/nest-proxy';

export async function POST(
    request: NextRequest,
    context: { params: Promise<{ attemptId: string }> },
) {
    const { attemptId } = await context.params;
    return proxyJson(request, `/proctor/attempts/${encodeURIComponent(attemptId)}/grade`);
}
