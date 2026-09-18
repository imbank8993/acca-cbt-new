import { NextRequest } from 'next/server';
import { proxy } from '@/lib/nest-proxy';

export async function DELETE(
    request: NextRequest,
    context: { params: Promise<{ classId: string }> },
) {
    const { classId } = await context.params;
    return proxy(request, `/students/classes/${encodeURIComponent(classId)}`, {
        method: 'DELETE',
    });
}
