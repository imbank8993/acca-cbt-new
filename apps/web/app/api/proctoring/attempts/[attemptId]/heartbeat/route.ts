import { proxy } from '@/lib/nest-proxy';
import { NextRequest } from 'next/server';
import { examClientHeaders } from '@/lib/exam-client-headers';

export async function POST(
    request: NextRequest,
    context: { params: Promise<{ attemptId: string }> },
) {
    const { attemptId } = await context.params;
    // The ingress proxy supplies the network address; never use body fields
    // submitted by the student as evidence of the current connection.
    return proxy(request, `/proctoring/attempts/${encodeURIComponent(attemptId)}/heartbeat`, {
        method: 'POST', body: await request.text(),
        headers: examClientHeaders(request.headers, process.env.INTERNAL_API_KEY || ''),
    });
}
