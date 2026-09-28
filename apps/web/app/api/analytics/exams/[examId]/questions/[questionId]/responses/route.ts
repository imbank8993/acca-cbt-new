import { proxyGet } from '@/lib/nest-proxy';
import { NextRequest } from 'next/server';

export async function GET(
    request: NextRequest,
    context: { params: Promise<{ examId: string; questionId: string }> },
) {
    const { examId, questionId } = await context.params;
    return proxyGet(
        request,
        `/analytics/exams/${encodeURIComponent(examId)}/questions/${encodeURIComponent(questionId)}/responses`,
    );
}
