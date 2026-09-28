import { proxy } from '@/lib/nest-proxy';
import { NextRequest } from 'next/server';

export async function POST(
    request: NextRequest,
    context: { params: Promise<{ examId: string }> },
) {
    const { examId } = await context.params;
    return proxy(request, `/grading/irt/${encodeURIComponent(examId)}`, { method: 'POST' });
}
