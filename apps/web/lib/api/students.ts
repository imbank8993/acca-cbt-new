import { withExamSubmissionLock } from '../exam-submission-lock';
import { getDeviceId } from '../device-id';
import { apiGet,apiSend } from './client';
import type { Question } from '@/app/types';

/**
 * Semua yang dilakukan siswa atas dirinya sendiri.
 * Menggantikan `app/actions/siswa.ts`.
 *
 * TIDAK satu pun fungsi di sini menerima `userId`. Versi lama menerimanya pada
 * hampir setiap pemanggilan — daftar kelas, riwayat nilai, rincian jawaban,
 * bahkan pengumpulan ujian — dan sebagian mempercayainya begitu saja, sehingga
 * data siswa lain bisa dibaca hanya dengan menukar UUID. Identitasnya kini
 * selalu dari token.
 *
 * Bentuk nilai kembalinya dipertahankan seperti server action lama supaya layar
 * ujian tidak perlu diubah penanganan galatnya — khususnya `startExamAttempt`,
 * yang mengembalikan `expiredAttemptId` agar jawaban yang tertinggal di
 * perangkat masih bisa disusulkan.
 */

export interface AnswerPayload {
    revision?: number;
    questionId: string;
    selected_option_id?: string;
    essay_answer?: string;
    is_doubtful?: boolean;
}

// ── Kelas ────────────────────────────────────────────────────────────────────

export interface StudentClass {
    id: string;
    name: string;
    program?: string | null;
    type?: string | null;
}

export interface StudentScheduledExam {
    id: string;
    title: string;
    exam_type?: string | null;
    duration_minutes?: number | null;
    start_time?: string | null;
    end_time?: string | null;
    status?: string | null;
    is_published: boolean;
    isCompleted: boolean;
    isInProgress?: boolean;
}

export async function listStudentClasses(): Promise<StudentClass[]> {
    const res = await apiGet<{ classes: StudentClass[] }>('/api/students/classes');
    return res.success ? res.classes : [];
}

export function joinClassAction(joinCode: string) {
    return apiSend<{ className: string }>('/api/students/classes/join', { joinCode });
}

export function leaveClassAction(classId: string) {
    return apiSend<{ className: string }>(
        `/api/students/classes/${encodeURIComponent(classId)}`,
        undefined,
        'DELETE',
    );
}

// ── Jadwal & hasil ───────────────────────────────────────────────────────────

export async function getStudentExams(): Promise<StudentScheduledExam[]> {
    const res = await getStudentExamsResult();
    return res.success ? res.exams : [];
}

export async function getStudentExamsResult() {
    const res = await apiGet<{ exams: StudentScheduledExam[] }>('/api/students/exams');
    return res.success
        ? { success: true as const, exams: res.exams }
        : { success: false as const, error: res.error, retryable: res.retryable };
}

export interface StudentResultExam {
    title: string;
    duration_minutes?: number;
    show_results: boolean;
    scoring_type?: string | null;
}

export interface StudentResult {
    id: string;
    total_score: number | null;
    score_irt: number | null;
    finished_at: string | null;
    status: string;
    needs_manual_grading: boolean;
    exams?: StudentResultExam | null;
}

export interface StudentResultQuestion extends Omit<Question, 'bank_question_options'> {
    options: Question['bank_question_options'];
    bank_question_options?: Question['bank_question_options'];
}

export interface StudentAttemptAnswer {
    id: string;
    questionId: string;
    selectedOptionId?: string | null;
    essayAnswer?: string | Record<string, unknown> | null;
    isCorrect?: boolean | null;
    score?: number | null;
    metadata?: { dimension_scores?: Record<string, number>; [key: string]: unknown } | null;
    question: StudentResultQuestion | null;
}

export interface StudentAttemptDetails {
    attempt: {
        id: string;
        total_score?: number | null;
        score_irt?: number | null;
        status: string;
        needs_manual_grading?: boolean;
        started_at?: string | null;
        finished_at?: string | null;
        personal_end_time?: string | null;
        metadata?: { dimension_scores?: Record<string, number>; [key: string]: unknown } | null;
        exams?: { id: string; title: string; show_results: boolean; question_bank_id?: string | null; scoring_type?: string | null } | null;
    };
    dimensions: { id: string; name: string }[];
    interpretations: { dimension_id: string; min_score: number; max_score: number; title?: string | null; interpretation?: string | null }[];
    answers: StudentAttemptAnswer[];
}

export async function getStudentResultsAction(): Promise<StudentResult[]> {
    const res = await getStudentResultsResult();
    return res.success ? res.results : [];
}

export async function getStudentResultsResult() {
    const res = await apiGet<{ results: StudentResult[] }>('/api/students/results');
    return res.success
        ? { success: true as const, results: res.results }
        : { success: false as const, error: res.error };
}

/**
 * Mengembalikan `null` saat gagal, sama seperti versi lama — layar hasil
 * memakai itu untuk menampilkan "hasil belum dibuka" tanpa membedakan sebabnya.
 */
export async function getAttemptDetailsAction(attemptId: string) {
    const res = await apiGet<StudentAttemptDetails>(`/api/students/attempts/${encodeURIComponent(attemptId)}`);

    if (!res.success) return null;

    return {
        attempt: res.attempt,
        dimensions: res.dimensions,
        interpretations: res.interpretations,
        answers: res.answers,
    };
}

// ── Mengerjakan ──────────────────────────────────────────────────────────────

export interface StudentProfile {
    full_name: string | null;
    identity_number: string | null;
}

export interface StudentExam {
    id: string;
    title: string;
    exam_type: string;
    duration_minutes: number;
    metadata?: {
        is_safe_mode?: boolean;
        max_violations?: number | null;
        assignment_description?: string;
        videoUrl?: string;
        documentUrl?: string;
        allow_file_upload?: boolean;
        allowed_file_types?: string[];
        [key: string]: unknown;
    } | null;
}

export type StudentExamQuestion = Question;

export interface StudentExamAttempt {
    started_at?: string;
    personal_end_time?: string;
    id: string;
    status: string;
    warning_count?: number;
    metadata?: { proctor_recovery_until?: string; [key: string]: unknown } | null;
}

export interface StudentSavedAnswer {
    metadata?: { answer_revision?: number } | null;
    question_id: string;
    selected_option_id?: string | null;
    essay_answer?: string | null;
    is_doubtful?: boolean;
}

/**
 * Keterangan ujian untuk layar pengerjaan, beserta identitas peserta.
 *
 * Menggantikan query langsung dari browser ke `cbt_exams` dan `cbt_profiles` —
 * jalur terakhir di aplikasi ini yang menyentuh basis data tanpa melewati
 * NestJS.
 */
export async function getExamForAttempt(examId: string) {
    const res = await apiGet<{ exam: StudentExam; profile: StudentProfile | null }>(
        `/api/students/exams/${encodeURIComponent(examId)}`,
    );
    return res.success
        ? { success: true as const, exam: res.exam, profile: res.profile }
        : { success: false as const, error: res.error, retryable: res.retryable === true };
}

export async function getExamQuestionsAction(examId: string) {
    const res = await apiGet<{ questions: StudentExamQuestion[] }>(
        `/api/students/exams/${encodeURIComponent(examId)}/questions`,
    );
    return res.success
        ? { success: true as const, questions: res.questions }
        : { success: false as const, error: res.error, retryable: res.retryable === true };
}

/**
 * Mulai atau lanjutkan pengerjaan.
 *
 * `expiredAttemptId` diteruskan apa adanya: layar ujian memakainya untuk
 * menyusulkan jawaban yang hanya sempat tersimpan di localStorage ketika waktu
 * habis saat perangkat sedang offline.
 */
export async function startExamAttemptAction(examId: string, deviceId?: string) {
    const res = await apiSend<{
        started: boolean;
        error?: string;
        expiredAttemptId?: string;
        attempt?: StudentExamAttempt;
        answers?: StudentSavedAnswer[];
        remainingSeconds?: number;
    }>(`/api/students/exams/${encodeURIComponent(examId)}/attempts`, { deviceId });

    // Permintaannya sendiri gagal — sesi habis, jaringan putus, backend mati.
    if (!res.success) {
        return { success: false as const, error: res.error, retryable: res.retryable === true };
    }

    // Permintaan berhasil tetapi ujian menolak dibuka: belum waktunya, sudah
    // lewat, atau sudah pernah dikerjakan. Penandanya `started`, terpisah dari
    // `success`, supaya `expiredAttemptId` tidak ikut terbuang oleh penanganan
    // galat umum — layar ujian memakainya untuk menyusulkan jawaban yang
    // tertinggal di perangkat.
    if (!res.started || !res.attempt) {
        return {
            success: false as const,
            error: res.error || 'Ujian tidak dapat dimulai.',
            expiredAttemptId: res.expiredAttemptId,
            retryable: false as const,
        };
    }

    return {
        success: true as const,
        attempt: res.attempt,
        answers: res.answers || [],
        remainingSeconds: res.remainingSeconds || 0,
    };
}

export function saveAnswerAction(
    attemptId: string,
    questionId: string,
    data: { selected_option_id?: string; essay_answer?: string; is_doubtful?: boolean; revision?: number },
) {
    return apiSend<{ attemptId: string }>(
        `/api/students/attempts/${encodeURIComponent(attemptId)}/answers/${encodeURIComponent(questionId)}`,
        { ...data, deviceId: getDeviceId() },
        'PUT',
        { timeoutMs: 15_000 },
    );
}

export async function syncAnswersBulkAction(attemptId: string, answers: AnswerPayload[]) {
    if (answers.length === 0) return { success: true as const };

    return apiSend<{ attemptId: string; saved: number }>(
        `/api/students/attempts/${encodeURIComponent(attemptId)}/answers`,
        { answers, deviceId: getDeviceId() },
        'PUT',
        { timeoutMs: 30_000 },
    );
}

export function getExamSubmissionStatus(attemptId: string) {
    return apiSend<{
        examId: string; status: string; startedAt: string; personalEndTime: string;
        remainingSeconds: number; submissionOnly: boolean; canRecover: boolean;
    }>(
        `/api/students/attempts/${encodeURIComponent(attemptId)}/submission-status`,
        { deviceId: getDeviceId() }, 'POST', { timeoutMs: 15_000 },
    );
}

export async function beginSubmitAction(attemptId: string) {
    return apiSend<{ attemptId: string; startedAt: string | null; alreadySubmitted?: boolean; savedAnswersOnly?: boolean }>(
        `/api/students/attempts/${encodeURIComponent(attemptId)}/submit-intent`,
        { deviceId: getDeviceId() },
        'POST',
        { timeoutMs: 15_000 },
    );
}

export async function syncLateAnswersAction(
    attemptId: string,
    answers: AnswerPayload[],
    deviceId?: string,
) {
    if (answers.length === 0) return { success: true as const, restored: 0 };

    const res = await apiSend<{ restored: number }>(
        `/api/students/attempts/${encodeURIComponent(attemptId)}/late-answers`,
        { answers, deviceId },
    );

    return res.success
        ? { success: true as const, restored: res.restored }
        : { success: false as const, restored: 0, error: res.error };
}

export async function submitExamAction(
    examId: string,
    studentAnswers: Record<string, string>,
    assignmentData?: {
        documentUrl?: string;
        videoUrl?: string;
        fileUrls?: string[];
        textSubmission?: string;
    },
    attemptId?: string,
    answerRevisions?: Record<string, number>,
    frozenSubmission?: { startedAt: string; personalEndTime: string },
) {
    const finalAnswers = { ...studentAnswers };
    const finalRevisions = answerRevisions ? { ...answerRevisions } : undefined;
    return withExamSubmissionLock(attemptId || examId, async () => {
        if (attemptId) {
            const intent = await beginSubmitAction(attemptId);
            if (!intent.success) return { success: false as const, error: intent.error, retryable: intent.retryable };
        }

        const res = await apiSend<{ score: number | null; alreadySubmitted?: boolean; savedAnswersOnly?: boolean; gradingPending?: boolean }>(
            `/api/students/exams/${encodeURIComponent(examId)}/submit`,
            { answers: finalAnswers, answerRevisions: finalRevisions, assignmentData, attemptId, deviceId: getDeviceId(), frozenSubmission },
            'POST',
            { timeoutMs: 30_000 },
        );

        return res.success
            ? {
                  success: true as const,
                  score: res.score,
                  alreadySubmitted: res.alreadySubmitted ?? false,
                  savedAnswersOnly: res.savedAnswersOnly ?? false,
                  gradingPending: res.gradingPending ?? false,
              }
            : { success: false as const, error: res.error, retryable: res.retryable };
    });
}
