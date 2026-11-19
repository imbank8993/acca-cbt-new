import { proxyGet } from '@/lib/nest-proxy';
import { NextRequest } from 'next/server';
type Context = { params: Promise<{ examId: string }> };
/** Semua screenshot satu ujian untuk tab Screenshot di monitoring; izin diperiksa di server. */
export async function GET(request: NextRequest, context: Context) {
    const { examId } = await context.params;
    return proxyGet(request, `/proctoring/exams/${encodeURIComponent(examId)}/screenshots`);
}
