import { proxyJson } from '@/lib/nest-proxy';
import { NextRequest } from 'next/server';

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
