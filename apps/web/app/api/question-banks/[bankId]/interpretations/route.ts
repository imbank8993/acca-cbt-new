import { proxyGet } from '@/lib/nest-proxy';
import { NextRequest } from 'next/server';

export async function GET(
    request: NextRequest,
    context: { params: Promise<{ bankId: string }> },
) {
    const { bankId } = await context.params;
    return proxyGet(request, `/question-banks/${encodeURIComponent(bankId)}/interpretations`);
}
