import type { ExamAnalyticsSummary,StudentPerformance } from '@/app/types';
import type { DisplayOption,DisplayQuestion } from '@/lib/answer-display';
import { apiGet } from './client';

export interface ExamWithStats {
    id: string;
    title: string;
    status: string;
    is_published?: boolean;
    total_attempts: number;
    completed_attempts: number;
    average_score: number;
    created_at: string;
    question_banks?: { title: string } | null;
}

export interface AnalyticsQuestionOption extends DisplayOption {
    id: string;
}

export interface AnalyticsQuestion extends DisplayQuestion {
    id: string;
    type: string;
    score_default: number;
    created_at?: string;
    options?: AnalyticsQuestionOption[];
    bank_question_options?: AnalyticsQuestionOption[];
}

export interface AnalyticsAnswer {
    id: string;
    question_id?: string;
    questionId?: string;
    selected_option_id?: string | null;
    selectedOptionId?: string | null;
    essay_answer?: unknown;
    essayAnswer?: unknown;
    is_correct?: boolean | null;
    isCorrect?: boolean | null;
    score?: number | null;
    isDoubtful?: boolean;
    question?: AnalyticsQuestion;
}

export interface AnalyticsAttempt {
    id: string;
    status: string;
    total_score: number | null;
    needs_manual_grading?: boolean;
    started_at: string;
    finished_at?: string | null;
    profiles?: {
        full_name?: string | null;
        email?: string | null;
    } | null;
    answers?: AnalyticsAnswer[];
    metadata?: {
        assignment_submission?: {
            documentUrl?: string;
            videoUrl?: string;
        };
    } | null;
}

export interface AttemptReview {
    attempt: AnalyticsAttempt;
    answers: Array<AnalyticsAnswer & { question: AnalyticsQuestion }>;
}

export interface QuestionResponse {
    studentName: string;
    selectedOptionId?: string | null;
    essayAnswer?: unknown;
    isCorrect?: boolean | null;
    score?: number | null;
}

export interface QuestionResponseDetail {
    question: AnalyticsQuestion;
    optionCounts: Record<string, number>;
    responses: QuestionResponse[];
    unanswered: string[];
}

export interface ExamExportData {
    exam: { title?: string | null };
    questions: AnalyticsQuestion[];
    attempts: AnalyticsAttempt[];
}

/**
 * Analisis hasil ujian untuk staf. Menggantikan `app/actions/analytics.ts`.
 *
 * Kontrak nilai kembalinya dipertahankan persis seperti server action lama
 * (`null` / `[]` saat gagal, `getExamExportData` melempar) supaya halaman
 * analitik tidak perlu diubah penanganan galatnya.
 */

export async function getExamsWithStats(): Promise<ExamWithStats[]> {
    const res = await apiGet<{ exams: ExamWithStats[] }>('/api/analytics/exams');
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
    const res = await apiGet<AttemptReview>(
        `/api/analytics/attempts/${encodeURIComponent(attemptId)}/review`,
    );
    return res.success ? { attempt: res.attempt, answers: res.answers } : null;
}

export async function getQuestionResponsesAction(examId: string, questionId: string) {
    const res = await apiGet<QuestionResponseDetail>(
        `/api/analytics/exams/${encodeURIComponent(examId)}/questions/${encodeURIComponent(questionId)}/responses`,
    );
    if (!res.success) return null;
    return {
        question: res.question,
        optionCounts: res.optionCounts,
        responses: res.responses,
        unanswered: res.unanswered,
    };
}

/**
 * Melempar saat gagal, bukan mengembalikan null — pemanggilnya (tombol unduh
 * Excel) membungkusnya dalam try/catch dan menampilkan pesannya ke guru.
 */
export async function getExamExportData(examId: string) {
    const res = await apiGet<ExamExportData>(
        `/api/analytics/exams/${encodeURIComponent(examId)}/export`,
    );
    if (!res.success) throw new Error(res.error);
    return { exam: res.exam, questions: res.questions, attempts: res.attempts };
}
