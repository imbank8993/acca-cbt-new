import { NextRequest } from 'next/server';
import { proxy } from '@/lib/nest-proxy';

export async function POST(
    request: NextRequest,
    context: { params: Promise<{ examId: string }> },
) {
    const { examId } = await context.params;
    return proxy(request, `/grading/irt/${encodeURIComponent(examId)}`, { method: 'POST' });
}
