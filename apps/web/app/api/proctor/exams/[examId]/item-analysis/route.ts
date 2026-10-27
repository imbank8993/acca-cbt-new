import { proxyGet } from '@/lib/nest-proxy';
import { NextRequest } from 'next/server';

export async function GET(
    request: NextRequest,
    context: { params: Promise<{ examId: string }> },
) {
    const { examId } = await context.params;
    const combineWith = request.nextUrl.searchParams.get('with');
    const query = combineWith ? `?with=${encodeURIComponent(combineWith)}` : '';
    return proxyGet(request, `/proctor/exams/${encodeURIComponent(examId)}/item-analysis${query}`);
}
