import { NextRequest } from 'next/server';
import { proxyJson } from '@/lib/nest-proxy';

export async function POST(
    request: NextRequest,
    context: { params: Promise<{ examId: string }> },
) {
    const { examId } = await context.params;
    return proxyJson(request, `/students/exams/${encodeURIComponent(examId)}/submit`);
}
