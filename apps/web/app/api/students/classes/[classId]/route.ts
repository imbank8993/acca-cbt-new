import { proxy } from '@/lib/nest-proxy';
import { NextRequest } from 'next/server';

export async function DELETE(
    request: NextRequest,
    context: { params: Promise<{ classId: string }> },
) {
    const { classId } = await context.params;
    return proxy(request, `/students/classes/${encodeURIComponent(classId)}`, {
        method: 'DELETE',
    });
}
