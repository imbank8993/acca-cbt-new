import { proxyJson } from '@/lib/nest-proxy';
import { NextRequest } from 'next/server';

/** Susulan untuk siswa yang belum pernah memulai ujian. */
export async function POST(
    request: NextRequest,
    context: { params: Promise<{ examId: string; studentId: string }> },
) {
    const { examId, studentId } = await context.params;
    return proxyJson(request,
        `/proctoring/exams/${encodeURIComponent(examId)}/participants/${encodeURIComponent(studentId)}/makeup`);
}
