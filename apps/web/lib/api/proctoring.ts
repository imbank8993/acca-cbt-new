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
) {
    return apiSend<{ warningCount: number }>(
        `/api/proctoring/attempts/${encodeURIComponent(attemptId)}/violations`,
        { eventType, metadata },
    );
}

export function resetExamAttempt(attemptId: string) {
    return apiSend<{ attemptId: string }>(
        `/api/proctoring/attempts/${encodeURIComponent(attemptId)}/reset`,
        {},
    );
}

export function forceTerminateAttempt(attemptId: string, reason: string) {
    return apiSend<{ attemptId: string }>(
        `/api/proctoring/attempts/${encodeURIComponent(attemptId)}/terminate`,
        { reason },
    );
}
