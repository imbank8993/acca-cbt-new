import { NextRequest } from 'next/server';
import { proxyGet } from '@/lib/nest-proxy';

export async function GET(
    request: NextRequest,
    context: { params: Promise<{ examId: string }> },
) {
    const { examId } = await context.params;
    return proxyGet(request, `/analytics/exams/${encodeURIComponent(examId)}/export`);
}
