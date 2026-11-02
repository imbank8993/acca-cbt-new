import { proxyJson } from '@/lib/nest-proxy';
import { NextRequest } from 'next/server';

export async function PUT(request: NextRequest, context: { params: Promise<{ id: string; questionId: string }> }) {
    const { id, questionId } = await context.params;
    return proxyJson(request, `/validations/${encodeURIComponent(id)}/items/${encodeURIComponent(questionId)}`, 'PUT');
}
