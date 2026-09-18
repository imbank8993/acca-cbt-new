import { NextRequest } from 'next/server';
import { proxyJson } from '@/lib/nest-proxy';

export async function PUT(
    request: NextRequest,
    context: { params: Promise<{ attemptId: string; questionId: string }> },
) {
    const { attemptId, questionId } = await context.params;
    return proxyJson(
        request,
        `/students/attempts/${encodeURIComponent(attemptId)}/answers/${encodeURIComponent(questionId)}`,
        'PUT',
    );
}
