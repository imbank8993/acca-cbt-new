import { NextRequest } from 'next/server';
import { proxyJson } from '@/lib/nest-proxy';

export async function PATCH(
    request: NextRequest,
    context: { params: Promise<{ questionId: string }> },
) {
    const { questionId } = await context.params;
    return proxyJson(
        request,
        `/question-banks/questions/${encodeURIComponent(questionId)}/metadata`,
        'PATCH',
    );
}
