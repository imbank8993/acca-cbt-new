import { getDeviceId } from '../device-id';
import { apiSend } from './client';

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
    return apiSend<{ warningCount: number; duplicate?: boolean }>(
        `/api/proctoring/attempts/${encodeURIComponent(attemptId)}/violations`,
        { eventType, metadata, clientEventId },
        'POST',
        { timeoutMs: 15_000 },
    );
}

/** Heartbeat server dipakai layar pengawas untuk membedakan aktif dan terputus. */
export function heartbeatExamAttempt(attemptId: string) {
    return apiSend<{ lastSeenAt: string }>(
        `/api/proctoring/attempts/${encodeURIComponent(attemptId)}/heartbeat`,
        { deviceId: getDeviceId() },
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

export function forceTerminateAttempt(attemptId: string, reason: string) {
    return apiSend<{ attemptId: string }>(
        `/api/proctoring/attempts/${encodeURIComponent(attemptId)}/terminate`,
        { reason },
        'POST',
        { timeoutMs: 30_000 },
    );
}
