import type { ExamReview } from '@/app/types/review';
import { apiGet } from './client';

/**
 * Review hasil ujian untuk siswa. Menggantikan `app/actions/exam-review.ts`.
 *
 * Tidak lagi menerima `userId`: NestJS membandingkan pemilik pengerjaan dengan
 * identitas di token. Versi lama menyaring memakai UUID kiriman browser, jadi
 * seluruh jawaban siswa lain — berikut kunci jawabannya — bisa diambil hanya
 * dengan menukar UUID itu.
 *
 * Mengembalikan pesan galat apa adanya supaya layar bisa membedakan "hasil
 * belum dibuka guru" dari "Anda tidak punya akses", bukan satu pesan umum.
 */
export async function getExamReview(
    attemptId: string,
): Promise<{ review: ExamReview | null; error?: string }> {
    const res = await apiGet<{ review: ExamReview }>(
        `/api/exam-review/attempts/${encodeURIComponent(attemptId)}`,
    );
    return res.success ? { review: res.review } : { review: null, error: res.error };
}
