import type { BankValidationSummary } from '@/lib/api/questions';
import type { ValidationStatus } from '@/lib/api/validations';

/** Label status sesi validasi yang sama di semua halaman. */
export const VALIDATION_STATUS_LABELS: Record<ValidationStatus, string> = {
    pending: 'Menunggu validasi',
    in_progress: 'Sedang divalidasi',
    revision_needed: 'Perlu revisi',
    resubmitted: 'Menunggu telaah ulang',
    approved: 'Tervalidasi',
    rejected: 'Ditolak',
};

export type ValidationTone = 'slate' | 'blue' | 'amber' | 'teal' | 'violet' | 'emerald' | 'rose';

export interface ValidationBadgeInfo {
    label: string;
    tone: ValidationTone;
    title: string;
}

/**
 * Label status validasi pada kartu bank soal. Hanya informasi: hasil validasi
 * tidak membatasi publikasi maupun pemakaian bank soal dalam ujian.
 */
export function validationBadgeInfo(summary?: BankValidationSummary | null): ValidationBadgeInfo | null {
    if (!summary) return null;
    const round = summary.round > 1 ? ` (putaran ${summary.round})` : '';
    const note = 'Hanya informasi; bank soal tetap dapat dipublikasikan dan dipakai.';
    switch (summary.status) {
        case 'pending':
            return { label: 'Menunggu validasi', tone: 'slate', title: `Validator belum mulai menelaah. ${note}` };
        case 'in_progress':
            return { label: 'Sedang divalidasi', tone: 'blue', title: `Validator sedang menelaah${round}. ${note}` };
        case 'revision_needed':
            return summary.openNotes > 0
                ? { label: `Perlu revisi · ${summary.openNotes} catatan`, tone: 'amber', title: `${summary.openNotes} catatan belum ditandai diperbaiki${round}. ${note}` }
                : { label: 'Sudah diperbaiki · belum diajukan', tone: 'teal', title: `Semua catatan sudah ditandai diperbaiki; ajukan telaah ulang dari tab Catatan Validasi. ${note}` };
        case 'resubmitted':
            return { label: 'Menunggu telaah ulang', tone: 'violet', title: `Perbaikan sedang diperiksa validator${round}. ${note}` };
        case 'approved':
            return { label: 'Tervalidasi', tone: 'emerald', title: `Hasil validasi menyatakan layak${round}. ${note}` };
        case 'rejected':
            return summary.openNotes > 0
                ? { label: 'Ditolak', tone: 'rose', title: `Hasil validasi menyatakan ditolak${round}. ${note}` }
                : { label: 'Ditolak · sudah diperbaiki', tone: 'teal', title: `Semua catatan sudah ditandai diperbaiki; ajukan telaah ulang dari tab Catatan Validasi. ${note}` };
        default:
            return null;
    }
}

export const VALIDATION_TONE_CLASSES: Record<ValidationTone, string> = {
    slate: 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700',
    blue: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-900',
    amber: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900',
    teal: 'bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-950/40 dark:text-teal-300 dark:border-teal-900',
    violet: 'bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/40 dark:text-violet-300 dark:border-violet-900',
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900',
    rose: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-900',
};
