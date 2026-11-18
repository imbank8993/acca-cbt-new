import type { ExamAttemptRecord } from '@/lib/api/proctor';

const FINISHED = ['submitted', 'auto_submitted'];

/** Jumlah jawaban lokal yang dilaporkan perangkat belum masuk ke server. */
export function uncountedAnswers(attempt: Pick<ExamAttemptRecord, 'offline_review'>): number {
    return attempt.offline_review?.uncounted_local_answers?.count ?? 0;
}

/**
 * Peserta yang perlu dipulihkan agar jawaban lokalnya terkirim (hanya yang boleh
 * direset oleh pengguna ini dan sudah selesai/ditutup).
 * - confirmed: perangkat melaporkan jawaban lokal yang belum masuk server.
 * - possible: perangkat tanpa kontak saat waktu habis; belum ada laporan.
 */
export function pendingRecoveryCandidates<T extends Pick<ExamAttemptRecord, 'canReset' | 'status' | 'offline_review'>>(attempts: T[]) {
    const eligible = attempts.filter(attempt => attempt.canReset === true && FINISHED.includes(attempt.status));
    const confirmed = eligible.filter(attempt => uncountedAnswers(attempt) > 0);
    const possible = eligible.filter(attempt => uncountedAnswers(attempt) === 0 && Boolean(attempt.offline_review?.connection_lost_at_close));
    return { confirmed, possible };
}
