import { NextRequest } from 'next/server';
import { proxyJson } from '@/lib/nest-proxy';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
    const { id } = await context.params;
    return proxyJson(request, `/exams/${encodeURIComponent(id)}/archive`);
}
