import { NextRequest } from 'next/server';
import { proxyJson } from '@/lib/nest-proxy';

export async function PUT(
    request: NextRequest,
    context: { params: Promise<{ bankId: string }> },
) {
    const { bankId } = await context.params;
    return proxyJson(
        request,
        `/question-banks/${encodeURIComponent(bankId)}/questions/order`,
        'PUT',
    );
}
