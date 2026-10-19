import { proxyJson } from '@/lib/nest-proxy';
import { NextRequest } from 'next/server';

export async function PUT(request: NextRequest, context: { params: Promise<{ examId: string; studentId: string }> }) {
    const { examId, studentId } = await context.params;
    return proxyJson(request,
        `/proctor/exams/${encodeURIComponent(examId)}/screen-share-exceptions/${encodeURIComponent(studentId)}`,
        'PUT');
}
