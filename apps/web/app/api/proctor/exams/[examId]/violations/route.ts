import { proxyGet } from '@/lib/nest-proxy';
import { NextRequest } from 'next/server';

export async function GET(
    request: NextRequest,
    context: { params: Promise<{ examId: string }> },
) {
    const { examId } = await context.params;
    const limit = request.nextUrl.searchParams.get('limit') || '20';
    return proxyGet(
        request,
        `/proctor/exams/${encodeURIComponent(examId)}/violations?limit=${encodeURIComponent(limit)}`,
    );
}
