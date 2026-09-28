import { proxyJson } from '@/lib/nest-proxy';
import { NextRequest } from 'next/server';

export async function POST(
    request: NextRequest,
    context: { params: Promise<{ id: string }> },
) {
    const { id } = await context.params;
    return proxyJson(request, `/teachers/classes/${encodeURIComponent(id)}/students`);
}
