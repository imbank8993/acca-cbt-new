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

/** Hapus eksplisit ujian uji coba yang sudah tidak dipublikasikan beserta hasilnya. */
export function purgeTrialExam(examId: string, confirmationTitle: string) {
    return apiSend<{ id: string; purgedAttempts: number }>(
        `/api/exams/${encodeURIComponent(examId)}/purge-trial`,
        { confirmationTitle },
    );
}
