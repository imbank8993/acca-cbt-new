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

/** Small event manifest; image delivery is kept separate from answer submission. */
export interface SubmissionSecurityEvent {
    id: string;
    eventType: string;
    metadata: Record<string, unknown>;
    createdAt: string;
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
    /** Jendela pemulihan dari proktor; berlaku walau jadwal ujian sudah berakhir. */
    recoveryUntil?: string | null;
    /** Pemulihan hanya untuk mengirim jawaban yang tersimpan di perangkat. */
    recoverySubmitOnly?: boolean;
    /** Jendela pribadi ini adalah ujian susulan (bukan pemulihan). */
    isMakeup?: boolean;
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
    const res = await apiGet<{ exams: StudentScheduledExam[]; serverTime: string; userId: string }>('/api/students/exams');
    return res.success
        ? { success: true as const, exams: res.exams, serverTime: res.serverTime, userId: res.userId }
        : { success: false as const, error: res.error, retryable: res.retryable };
}

export interface StudentResultExam {
    title: string;
    duration_minutes?: number;
    show_results: boolean;
    scoring_type?: string | null;
}

export interface StudentResult {
    display_score?: number | null;
    score_type?: 'classical' | 'irt_1pl' | 'irt_2pl' | 'irt_3pl';
    score_label?: string;
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
    answerKeysReleased: boolean;
    answerKeysMessage?: string | null;
    attempt: {
        display_score?: number | null;
        score_type?: 'classical' | 'irt_1pl' | 'irt_2pl' | 'irt_3pl';
        score_label?: string;
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

/** Mempertahankan alasan kegagalan agar halaman bisa menjelaskan izin pembahasan. */
export async function getAttemptDetailsResult(attemptId: string) {
    const res = await apiGet<StudentAttemptDetails>(`/api/students/attempts/${encodeURIComponent(attemptId)}`);

    if (!res.success) return res;

    return {
        success: true as const,
        details: {
            answerKeysReleased: res.answerKeysReleased,
            answerKeysMessage: res.answerKeysMessage,
            attempt: res.attempt,
            dimensions: res.dimensions,
            interpretations: res.interpretations,
            answers: res.answers,
        },
    };
}

export async function getAttemptDetailsAction(attemptId: string) {
    const res = await getAttemptDetailsResult(attemptId);
    return res.success ? res.details : null;
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
    const res = await apiGet<{ exam: StudentExam; profile: StudentProfile | null; hasStartedAttempt: boolean }>(
        `/api/students/exams/${encodeURIComponent(examId)}`,
    );
    return res.success
        ? { success: true as const, exam: res.exam, profile: res.profile, hasStartedAttempt: res.hasStartedAttempt }
        : { success: false as const, error: res.error, retryable: res.retryable === true };
}

export async function getExamQuestionsAction(examId: string) {
    const res = await apiGet<{ questions: StudentExamQuestion[] }>(
        `/api/students/exams/${encodeURIComponent(examId)}/questions`,
        { headers: { 'x-exam-device': getDeviceId() } },
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
export async function startExamAttemptAction(examId: string, deviceId?: string, screenCaptureReady = false) {
    const res = await apiSend<{
        started: boolean;
        error?: string;
        expiredAttemptId?: string;
        attempt?: StudentExamAttempt;
        answers?: StudentSavedAnswer[];
        remainingSeconds?: number;
    }>(`/api/students/exams/${encodeURIComponent(examId)}/attempts`, { deviceId, screenCaptureReady });

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

/** Ditampilkan bila server menolak karena sesi login berakhir (HTTP 401), walau jaringan normal. */
export const SESSION_ENDED_MESSAGE = 'Sesi login Anda berakhir, sehingga jawaban tidak dapat dikirim walaupun jaringan normal. ' +
    'Jangan tutup halaman ujian ini. Buka tab baru di browser yang sama, login kembali, lalu kembali ke tab ini; ' +
    'jawaban yang tersimpan di perangkat akan terkirim otomatis. Bila ragu, hubungi pengawas.';

/** Perpanjang sesi login selama ujian berlangsung (ditolak bila tidak sedang mengerjakan). */
export function refreshExamSessionAction() {
    return apiSend<Record<string, never>>('/api/auth/refresh', {}, 'POST', { timeoutMs: 15_000 });
}

export function saveAnswerAction(
    attemptId: string,
    questionId: string,
    data: { selected_option_id?: string; essay_answer?: string; is_doubtful?: boolean; revision?: number },
    sessionStartedAt?: string,
) {
    return apiSend<{ attemptId: string }>(
        `/api/students/attempts/${encodeURIComponent(attemptId)}/answers/${encodeURIComponent(questionId)}`,
        { ...data, deviceId: getDeviceId(), sessionStartedAt },
        'PUT',
        { timeoutMs: 15_000 },
    );
}

export async function syncAnswersBulkAction(attemptId: string, answers: AnswerPayload[], sessionStartedAt?: string) {
    if (answers.length === 0) return { success: true as const };

    return apiSend<{ attemptId: string; saved: number }>(
        `/api/students/attempts/${encodeURIComponent(attemptId)}/answers`,
        { answers, deviceId: getDeviceId(), sessionStartedAt },
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

export async function beginSubmitAction(attemptId: string, submission?: {
    answers: Record<string, string>; answerRevisions?: Record<string, number>;
    assignmentData?: Record<string, unknown>; frozenSubmission?: { startedAt: string; personalEndTime: string };
    securityEvents?: SubmissionSecurityEvent[];
}) {
    return apiSend<{ attemptId: string; startedAt: string | null; alreadySubmitted?: boolean; savedAnswersOnly?: boolean;
        acceptedSecurityEventIds?: string[] }>(
        `/api/students/attempts/${encodeURIComponent(attemptId)}/submit-intent`,
        { deviceId: getDeviceId(), submission },
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
    securityEvents?: SubmissionSecurityEvent[],
) {
    const finalAnswers = { ...studentAnswers };
    const finalRevisions = answerRevisions ? { ...answerRevisions } : undefined;
    // Capture the exact request before waiting for another delivery's lock.
    const payload = JSON.parse(JSON.stringify({ answers: finalAnswers, answerRevisions: finalRevisions,
        assignmentData, attemptId, deviceId: getDeviceId(), frozenSubmission, securityEvents }));
    return withExamSubmissionLock(attemptId || examId, async () => {
        // Catatan pengawasan yang diakui server boleh dihapus dari antrean
        // perangkat, termasuk yang disimpan sebagai bukti susulan.
        let acceptedSecurityEventIds: string[] = [];
        const pendingConfirmation = () => ({ success: false as const, retryable: true,
            confirmationPending: true as const, acceptedSecurityEventIds,
            error: 'Pengumpulan belum dapat dikonfirmasi. Jawaban mungkin sudah tersimpan di server. Sistem akan memeriksa ulang; salinan lokal tetap disimpan.' });
        const sendOnce = async () => {
            if (attemptId) {
                const intent = await beginSubmitAction(attemptId, payload);
                if (!intent.success) return intent.retryable !== false ? pendingConfirmation()
                    : { success: false as const, retryable: false, acceptedSecurityEventIds,
                        ...(intent.unauthorized ? { error: SESSION_ENDED_MESSAGE, unauthorized: true as const } : { error: intent.error }) };
                acceptedSecurityEventIds = [...new Set([...acceptedSecurityEventIds,
                    ...(Array.isArray(intent.acceptedSecurityEventIds) ? intent.acceptedSecurityEventIds : [])])];
            }

            const res = await apiSend<{ score: number | null; alreadySubmitted?: boolean; savedAnswersOnly?: boolean; gradingPending?: boolean;
                submissionVerified?: boolean; verifiedAttemptId?: string; localAnswersNotCounted?: number }>(
                `/api/students/exams/${encodeURIComponent(examId)}/submit`,
                payload,
                'POST',
                { timeoutMs: 30_000 },
            );

            if (res.success && (res.savedAnswersOnly || res.submissionVerified !== true || !attemptId || res.verifiedAttemptId !== attemptId)) {
                const pending = Number(res.localAnswersNotCounted) || 0;
                // A missing/wrong receipt is uncertainty, not evidence that answers
                // were lost. Only an explicit server comparison can report a mismatch.
                if (attemptId && res.submissionVerified !== false && pending === 0) return pendingConfirmation();
                return { success: false as const, retryable: false, acceptedSecurityEventIds,
                    error: pending > 0
                        ? `Ujian sudah ditutup, tetapi ${pending} jawaban di perangkat ini berbeda dari yang tersimpan di server dan belum dinilai. Jawaban yang sudah tersimpan di server tetap dinilai. Salinan lokal dipertahankan; hubungi proktor untuk membuka pemulihan.`
                        : 'Pengumpulan belum terverifikasi lengkap. Lampiran atau data di server belum dikonfirmasi sesuai kiriman ini. Cadangan lokal dipertahankan; hubungi proktor.' };
            }
            return res.success
                ? {
                      success: true as const,
                      submissionVerified: true as const,
                      score: res.score,
                      alreadySubmitted: res.alreadySubmitted ?? false,
                      savedAnswersOnly: res.savedAnswersOnly ?? false,
                      gradingPending: res.gradingPending ?? false,
                      acceptedSecurityEventIds,
                  }
                : res.retryable !== false ? pendingConfirmation()
                    : { success: false as const, retryable: false, acceptedSecurityEventIds,
                        ...(res.unauthorized ? { error: SESSION_ENDED_MESSAGE, unauthorized: true as const } : { error: res.error }) };
        };
        const first = await sendOnce();
        // The endpoint is idempotent and compares persisted contents. Re-send the
        // exact frozen payload once to resolve a lost acknowledgement promptly;
        // continued outages use the existing foreground/background retry backoff.
        if (attemptId && 'confirmationPending' in first &&
            (typeof navigator === 'undefined' || navigator.onLine !== false)) return sendOnce();
        return first;
    }, JSON.stringify(payload));
}
