import { NextRequest } from 'next/server';
import { proxyGet } from '@/lib/nest-proxy';

export async function GET(
    request: NextRequest,
    context: { params: Promise<{ classId: string }> },
) {
    const { classId } = await context.params;
    const additional = request.nextUrl.searchParams.get('additional') === 'true';
    return proxyGet(
        request,
        `/proctor/classes/${encodeURIComponent(classId)}/students?additional=${additional}`,
    );
}
