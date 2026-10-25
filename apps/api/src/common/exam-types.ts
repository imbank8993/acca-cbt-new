/** Semester/year assessments share creation, recovery and invigilator policies. */
export const SEMESTER_ASSESSMENT_TYPES = ['pas', 'pat', 'am'] as const;

export function isSemesterAssessmentExam(exam: { exam_type?: string | null }): boolean {
    return (SEMESTER_ASSESSMENT_TYPES as readonly string[]).includes(exam.exam_type || '');
}

/**
 * Ujian yang sudah dibuka untuk siswa dan berjalan menurut jendela waktunya.
 * Ujian biasa memakai status `active`; ujian dari jadwal ASAS/ASAT/AM dibuat
 * dengan status `scheduled` lalu diaktifkan lewat `is_published`. Keduanya
 * harus dihitung sama di dashboard (dulu ASAS/AM tidak pernah masuk
 * "Ujian Mendatang"/"Ujian Aktif").
 */
export const RUNNABLE_EXAM_STATUSES = ['active', 'scheduled'] as const;

export function isRunnableExamStatus(status?: string | null): boolean {
    return (RUNNABLE_EXAM_STATUSES as readonly string[]).includes(status || '');
}

/** Label pengganti "pembuat" untuk ujian yang dibangkitkan dari jadwal, mis. "ASAS/ASAT · Kelas XII A". */
export function semesterAssessmentSourceLabel(exam: {
    exam_type?: string | null; description?: string | null; metadata?: Record<string, unknown> | null;
}): string | null {
    if (!isSemesterAssessmentExam(exam) && exam.metadata?.is_pas_exam !== true) return null;
    const type = (exam.exam_type || '').toLowerCase();
    const kind = type === 'am' ? 'AM' : type === 'pas' || type === 'pat' ? 'ASAS/ASAT' : type.toUpperCase() || 'ASAS/ASAT';
    const className = /Kelas\s+([^|•]+)/.exec(exam.description || '')?.[1]?.trim();
    return [kind, className ? `Kelas ${className}` : null].filter(Boolean).join(' · ');
}
