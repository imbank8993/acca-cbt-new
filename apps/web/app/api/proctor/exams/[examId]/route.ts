import { proxyJson } from '@/lib/nest-proxy';
import { NextRequest } from 'next/server';

export async function PATCH(
    request: NextRequest,
    context: { params: Promise<{ examId: string }> },
) {
    const { examId } = await context.params;
    return proxyJson(request, `/proctor/exams/${encodeURIComponent(examId)}`, 'PATCH');
}
