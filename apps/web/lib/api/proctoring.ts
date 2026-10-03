import { getDeviceId } from '../device-id';
import { apiIdempotentMutation, apiSend } from './client';

/**
 * Pemantauan keamanan ujian. Menggantikan `app/actions/security.ts`.
 *
 * `userId` tidak lagi dikirim pada terminasi: NestJS membacanya dari token dan
 * memutuskan sendiri apakah pemanggil adalah pemilik pengerjaan (siswa yang
 * menghentikan dirinya sendiri) atau proktor.
 */

/**
 * Catat pelanggaran. Mengembalikan `warningCount` dari server — angka itu
 * OTORITATIF karena dihitung dari baris log di database, tahan terhadap balapan
 * dan reload. Hitungan lokal hanya cadangan bila permintaannya gagal.
 */
export function logSecurityViolation(
    attemptId: string,
    eventType: string,
    metadata: Record<string, unknown> = {},
    clientEventId?: string,
) {
    return apiSend<{
        warningCount: number;
        duplicate?: boolean;
        maxViolations: number | null;
        terminated: boolean;
    }>(
        `/api/proctoring/attempts/${encodeURIComponent(attemptId)}/violations`,
        { eventType, metadata, clientEventId },
        'POST',
        { timeoutMs: 15_000 },
    );
}

/** Heartbeat server dipakai layar pengawas untuk membedakan aktif dan terputus. */
export interface ClientSyncHealth {
    localAnswerCount: number;
    pendingAnswerCount: number;
    storageState: 'healthy' | 'fallback' | 'unavailable' | 'unknown';
}

export function heartbeatExamAttempt(attemptId: string, syncHealth?: ClientSyncHealth) {
    return apiSend<{ lastSeenAt: string }>(
        `/api/proctoring/attempts/${encodeURIComponent(attemptId)}/heartbeat`,
        { deviceId: getDeviceId(), syncHealth },
        'POST',
        { timeoutMs: 15_000 },
    );
}

export interface AttemptRecoveryResult {
    attemptId: string;
    previousStatus: string;
    recoveryUntil: string | null;
    serverAnswerCount: number;
}

export function resetExamAttempt(attemptId: string, reason: string) {
    return apiSend<AttemptRecoveryResult>(
        `/api/proctoring/attempts/${encodeURIComponent(attemptId)}/reset`,
        { reason },
    );
}

export interface MakeupExamResult {
    attemptId: string;
    previousStatus: string;
    recoveryUntil: string;
    durationMinutes: number;
    deletedAnswerCount: number;
}

export function startMakeupExam(
    attemptId: string,
    reason: string,
    durationMinutes: number,
) {
    return apiIdempotentMutation<MakeupExamResult>(
        `/api/proctoring/attempts/${encodeURIComponent(attemptId)}/makeup`,
        { reason, durationMinutes },
        'POST',
        { timeoutMs: 30_000 },
    );
}

/** Minta alasan yang akan disimpan permanen pada jejak audit pemulihan. */
export function promptRecoveryReason(studentName: string): string | null {
    const value = window.prompt(
        `Tuliskan alasan pemulihan ujian untuk ${studentName}.\n\n` +
        'Contoh: jaringan terputus sampai melewati batas waktu.',
        '',
    );
    if (value === null) return null;
    const reason = value.trim();
    if (reason.length < 5) {
        window.alert('Alasan pemulihan minimal 5 karakter.');
        return null;
    }
    if (reason.length > 500) {
        window.alert('Alasan pemulihan maksimal 500 karakter.');
        return null;
    }
    return reason;
}

export function promptRecoveryDuration(studentName: string): number | null {
    const value = window.prompt(
        `Berapa menit waktu ujian susulan untuk ${studentName}?\n\n` +
        'Waktu dihitung sejak ujian susulan diaktifkan. Masukkan 1–1440 menit.',
        '60',
    );
    if (value === null) return null;
    const duration = Number(value);
    if (!Number.isInteger(duration) || duration < 1 || duration > 1440) {
        window.alert('Waktu ujian susulan harus berupa angka bulat antara 1 dan 1440 menit.');
        return null;
    }
    return duration;
}

export function forceTerminateAttempt(attemptId: string, reason: string) {
    return apiSend<{ attemptId: string }>(
        `/api/proctoring/attempts/${encodeURIComponent(attemptId)}/terminate`,
        { reason },
        'POST',
        { timeoutMs: 30_000 },
    );
}
