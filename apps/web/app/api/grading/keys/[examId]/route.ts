import { proxy } from '@/lib/nest-proxy';
import { NextRequest } from 'next/server';
export async function GET(request: NextRequest, context: { params: Promise<{ examId: string }> }) {
    const { examId } = await context.params;
    return proxy(request, `/grading/keys/${encodeURIComponent(examId)}`);
}
export async function POST(request: NextRequest, context: { params: Promise<{ examId: string }> }) {
    const { examId } = await context.params;
    return proxy(request, `/grading/keys/${encodeURIComponent(examId)}`, { method: 'POST', body: await request.text() });
}
