import type { OrganizationExam } from './api/proctor';
import { isSemesterAssessmentType } from './exam-types';

/**
 * Tab Administrasi (absensi & berita acara per ruang) hanya untuk ujian yang
 * dibangkitkan dari folder ASAS/ASAT/AM. Ujian biasa yang jenisnya dipilih
 * "ASAS" atau "AM" tidak punya ruang, sesi, dan pengawas folder, sehingga tab
 * itu hanya akan menampilkan galat "periode tidak ditemukan".
 */
export function hasMonitoringAdministration(exam?: Pick<OrganizationExam, 'exam_type' | 'metadata'> | null): boolean {
    const periodId = exam?.metadata?.pas_period_id;
    return isSemesterAssessmentType(exam?.exam_type) && typeof periodId === 'string' && periodId.length > 0;
}
