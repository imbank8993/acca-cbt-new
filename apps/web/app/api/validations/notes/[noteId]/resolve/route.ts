import { proxyJson } from '@/lib/nest-proxy';
import { NextRequest } from 'next/server';

export async function PATCH(
    request: NextRequest,
    context: { params: Promise<{ noteId: string }> },
) {
    const { noteId } = await context.params;
    return proxyJson(
        request,
        `/validations/notes/${encodeURIComponent(noteId)}/resolve`,
        'PATCH',
    );
}
