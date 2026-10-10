import { proxy } from '@/lib/nest-proxy';
import { NextRequest } from 'next/server';

export async function GET(
    request: NextRequest,
    context: { params: Promise<{ examId: string }> },
) {
    const { examId } = await context.params;
    return proxy(request, `/students/exams/${encodeURIComponent(examId)}/questions`, {
        method: 'GET', headers: { 'x-exam-device': request.headers.get('x-exam-device') || '' },
    });
}
