import { proxyGet } from '@/lib/nest-proxy';
import { NextRequest } from 'next/server';

export async function GET(
    request: NextRequest,
    context: { params: Promise<{ id: string }> },
) {
    const { id } = await context.params;
    return proxyGet(request, `/validations/${encodeURIComponent(id)}/review`);
}
