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

export function isFolderExamCategory(category?: string | null): category is 'asas_asat' | 'am' {
    return category === 'asas_asat' || category === 'am';
}
