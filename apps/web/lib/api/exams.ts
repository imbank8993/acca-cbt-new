import { apiSend } from './client';

/**
 * Hapus ujian beserta seluruh data terkaitnya.
 *
 * Menggantikan `deleteExamAction` dari `app/actions/admin.ts`. Bentuk balasannya
 * dipertahankan (`{ success, error }`) agar penanganan di halaman ujian tidak
 * ikut berubah.
 */
export function deleteExam(examId: string) {
    return apiSend<{ id: string }>(`/api/exams/${encodeURIComponent(examId)}`, undefined, 'DELETE');
}
