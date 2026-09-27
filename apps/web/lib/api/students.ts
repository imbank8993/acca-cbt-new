import { apiGet, apiSend } from './client';
import { getDeviceId } from '../device-id';

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
    questionId: string;
    selected_option_id?: string;
    essay_answer?: string;
    is_doubtful?: boolean;
}

// ── Kelas ────────────────────────────────────────────────────────────────────

export async function listStudentClasses(): Promise<any[]> {
    const res = await apiGet<{ classes: any[] }>('/api/students/classes');
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

export async function getStudentExams(): Promise<any[]> {
    const res = await getStudentExamsResult();
    return res.success ? res.exams : [];
}

export async function getStudentExamsResult() {
    const res = await apiGet<{ exams: any[] }>('/api/students/exams');
    return res.success
        ? { success: true as const, exams: res.exams }
        : { success: false as const, error: res.error };
}

export async function getStudentResultsAction(): Promise<any[]> {
    const res = await getStudentResultsResult();
    return res.success ? res.results : [];
}

export async function getStudentResultsResult() {
    const res = await apiGet<{ results: any[] }>('/api/students/results');
    return res.success
        ? { success: true as const, results: res.results }
        : { success: false as const, error: res.error };
}

/**
 * Mengembalikan `null` saat gagal, sama seperti versi lama — layar hasil
 * memakai itu untuk menampilkan "hasil belum dibuka" tanpa membedakan sebabnya.
 */
export async function getAttemptDetailsAction(attemptId: string) {
    const res = await apiGet<{
        attempt: any;
        dimensions: any[];
        interpretations: any[];
        answers: any[];
    }>(`/api/students/attempts/${encodeURIComponent(attemptId)}`);

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

/**
 * Keterangan ujian untuk layar pengerjaan, beserta identitas peserta.
 *
 * Menggantikan query langsung dari browser ke `cbt_exams` dan `cbt_profiles` —
 * jalur terakhir di aplikasi ini yang menyentuh basis data tanpa melewati
 * NestJS.
 */
export async function getExamForAttempt(examId: string) {
    const res = await apiGet<{ exam: any; profile: StudentProfile | null }>(
        `/api/students/exams/${encodeURIComponent(examId)}`,
    );
    return res.success
        ? { success: true as const, exam: res.exam, profile: res.profile }
        : { success: false as const, error: res.error, retryable: res.retryable === true };
}

export async function getExamQuestionsAction(examId: string) {
    const res = await apiGet<{ questions: any[] }>(
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
        attempt?: any;
        answers?: any[];
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
    if (!res.started) {
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
    data: { selected_option_id?: string; essay_answer?: string; is_doubtful?: boolean },
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
) {
    const res = await apiSend<{ score: number; alreadySubmitted?: boolean; savedAnswersOnly?: boolean }>(
        `/api/students/exams/${encodeURIComponent(examId)}/submit`,
        { answers: studentAnswers, assignmentData, attemptId, deviceId: getDeviceId() },
        'POST',
        { timeoutMs: 30_000 },
    );

    return res.success
        ? {
              success: true as const,
              score: res.score,
              alreadySubmitted: res.alreadySubmitted ?? false,
              savedAnswersOnly: res.savedAnswersOnly ?? false,
          }
        : { success: false as const, error: res.error };
}
