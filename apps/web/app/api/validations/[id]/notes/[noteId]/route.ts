import { proxyJson } from '@/lib/nest-proxy';
import { NextRequest } from 'next/server';

export async function DELETE(
    request: NextRequest,
    context: { params: Promise<{ id: string; noteId: string }> },
) {
    const { id, noteId } = await context.params;
    return proxyJson(
        request,
        `/validations/${encodeURIComponent(id)}/notes/${encodeURIComponent(noteId)}`,
        'DELETE',
    );
}
