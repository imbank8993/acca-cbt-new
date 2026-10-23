export type ExamTypeCategory = 'daily' | 'am' | 'asas_asat' | 'tryout' | 'assignment' | 'lainnya';

const EXAM_TYPE_LABELS: Record<ExamTypeCategory, string> = {
    daily: 'Ulangan Harian',
    am: 'Asesmen Madrasah',
    asas_asat: 'ASAS/ASAT',
    tryout: 'Try Out',
    assignment: 'Tugas',
    lainnya: 'Lainnya',
};

export function examTypeCategory(type?: string | null): ExamTypeCategory {
    if (type === 'asas_asat' || type === 'am' || type === 'daily' || type === 'pas' || type === 'pat' || type === 'tryout' || type === 'assignment') {
        return type === 'pas' || type === 'pat' ? 'asas_asat' : type;
    }
    return 'lainnya';
}

export function examTypeLabel(type?: string | null): string {
    return EXAM_TYPE_LABELS[examTypeCategory(type)];
}

export function matchesExamType(type: string | null | undefined, category: string): boolean {
    return category === 'all' || examTypeCategory(type) === examTypeCategory(category);
}

/**
 * ASAS, ASAT dan AM diperlakukan sama: dibuat sebagai folder, memakai ruang &
 * sesi, pengawas, administrasi, dan tampilan folder ringkas. ASAS dan ASAT
 * adalah satu pilihan ("ASAS/ASAT"); `pat` hanya nilai lama yang tetap didukung.
 */
export const SEMESTER_ASSESSMENT_TYPES = ['pas', 'pat', 'am'] as const;

export function isSemesterAssessmentType(type?: string | null): boolean {
    return (SEMESTER_ASSESSMENT_TYPES as readonly string[]).includes((type || '').trim().toLowerCase());
}

/** Label folder/jenis asesmen untuk tampilan: AM atau ASAS/ASAT. */
export function semesterAssessmentLabel(type?: string | null, short = false): string {
    const normalized = (type || '').trim().toLowerCase();
    if (normalized === 'am') return short ? 'AM' : 'Asesmen Madrasah';
    if (normalized === 'pas' || normalized === 'pat') return 'ASAS/ASAT';
    if (normalized === 'pts') return 'PTS / UTS';
    if (normalized === 'pkn') return 'Asesmen Lainnya';
    return normalized.toUpperCase() || 'ASAS/ASAT';
}

export function isFolderExamCategory(category?: string | null): category is 'asas_asat' | 'am' {
    return category === 'asas_asat' || category === 'am';
}
