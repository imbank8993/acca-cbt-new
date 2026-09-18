import type { ExamAnalyticsSummary, StudentPerformance } from '@/app/types';
import { apiGet } from './client';

/**
 * Analisis hasil ujian untuk staf. Menggantikan `app/actions/analytics.ts`.
 *
 * Kontrak nilai kembalinya dipertahankan persis seperti server action lama
 * (`null` / `[]` saat gagal, `getExamExportData` melempar) supaya halaman
 * analitik tidak perlu diubah penanganan galatnya.
 */

export async function getExamsWithStats(organizationId: string): Promise<any[]> {
    const res = await apiGet<{ exams: any[] }>(
        `/api/analytics/exams?organizationId=${encodeURIComponent(organizationId)}`,
    );
    return res.success ? res.exams : [];
}

export async function getExamAnalytics(examId: string): Promise<ExamAnalyticsSummary | null> {
    const res = await apiGet<{ analytics: ExamAnalyticsSummary }>(
        `/api/analytics/exams/${encodeURIComponent(examId)}`,
    );
    return res.success ? res.analytics : null;
}

export async function getStudentPerformance(examId: string): Promise<StudentPerformance[]> {
    const res = await apiGet<{ students: StudentPerformance[] }>(
        `/api/analytics/exams/${encodeURIComponent(examId)}/students`,
    );
    return res.success ? res.students : [];
}

export async function getAttemptReviewForStaff(attemptId: string) {
    const res = await apiGet<{ attempt: any; answers: any[] }>(
        `/api/analytics/attempts/${encodeURIComponent(attemptId)}/review`,
    );
    return res.success ? { attempt: res.attempt, answers: res.answers } : null;
}

export async function getQuestionResponsesAction(examId: string, questionId: string) {
    const res = await apiGet<{
        question: any;
        optionCounts: Record<string, number>;
        responses: any[];
        unanswered: string[];
    }>(
        `/api/analytics/exams/${encodeURIComponent(examId)}/questions/${encodeURIComponent(questionId)}/responses`,
    );
    if (!res.success) return null;
    const { success: _success, ...detail } = res;
    return detail;
}

/**
 * Melempar saat gagal, bukan mengembalikan null — pemanggilnya (tombol unduh
 * Excel) membungkusnya dalam try/catch dan menampilkan pesannya ke guru.
 */
export async function getExamExportData(examId: string) {
    const res = await apiGet<{ exam: any; questions: any[]; attempts: any[] }>(
        `/api/analytics/exams/${encodeURIComponent(examId)}/export`,
    );
    if (!res.success) throw new Error(res.error);
    return { exam: res.exam, questions: res.questions, attempts: res.attempts };
}
