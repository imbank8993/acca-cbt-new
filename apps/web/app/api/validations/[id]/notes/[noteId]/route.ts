import { proxyJson } from '@/lib/nest-proxy';
import { NextRequest } from 'next/server';

type Context = { params: Promise<{ id: string; noteId: string }> };

export async function PATCH(request: NextRequest, context: Context) {
    const { id, noteId } = await context.params;
    return proxyJson(
        request,
        `/validations/${encodeURIComponent(id)}/notes/${encodeURIComponent(noteId)}`,
        'PATCH',
    );
}

export async function DELETE(request: NextRequest, context: Context) {
    const { id, noteId } = await context.params;
    return proxyJson(
        request,
        `/validations/${encodeURIComponent(id)}/notes/${encodeURIComponent(noteId)}`,
        'DELETE',
    );
}
