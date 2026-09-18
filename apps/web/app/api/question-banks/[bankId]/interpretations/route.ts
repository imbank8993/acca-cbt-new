import { NextRequest } from 'next/server';
import { proxyGet } from '@/lib/nest-proxy';

export async function GET(
    request: NextRequest,
    context: { params: Promise<{ bankId: string }> },
) {
    const { bankId } = await context.params;
    return proxyGet(request, `/question-banks/${encodeURIComponent(bankId)}/interpretations`);
}
