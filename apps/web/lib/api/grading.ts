import { apiSend } from './client';

/**
 * Hitung skor IRT seluruh peserta satu ujian.
 *
 * Menggantikan `calculateExamIRT(examId, orgId)`. `orgId` tidak lagi dikirim:
 * otorisasinya diturunkan dari ujiannya sendiri di NestJS.
 */
export function calculateExamIRT(examId: string) {
    return apiSend<{ count: number; warnings: string[] }>(
        `/api/grading/irt/${encodeURIComponent(examId)}`,
        undefined,
    );
}
