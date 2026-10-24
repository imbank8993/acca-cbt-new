/**
 * Status skor IRT pada monitoring.
 *
 * Skor IRT tidak dihitung ulang otomatis: tombol "Kalkulasi IRT" (atau koreksi
 * kunci) yang menghitungnya untuk seluruh peserta sekaligus. Pemulihan/susulan
 * menghapus skor IRT satu peserta, sehingga setelah peserta itu mengumpulkan
 * ulang, nilainya kosong, ia hilang dari peringkat, dan pembahasan seluruh
 * ujian tertahan sampai IRT dihitung ulang. Helper ini membuat keadaan itu
 * terlihat oleh pengelola.
 */
type IrtAttempt = {
    status?: string | null;
    score_irt?: number | string | null;
    metadata?: Record<string, unknown> | null;
};

export function usesIrtScoring(scoringType?: string | null): boolean {
    return String(scoringType || '').split(',').map(type => type.trim())
        .some(type => type === 'irt' || type.startsWith('irt_'));
}

export function hasIrtScore(attempt?: IrtAttempt | null): boolean {
    const value = attempt?.score_irt;
    if (value === null || value === undefined || (typeof value === 'string' && !value.trim())) return false;
    return Number.isFinite(Number(value));
}

export interface IrtRecalculationStatus {
    /** IRT pernah dihitung untuk ujian ini (minimal satu peserta punya skor). */
    calculated: boolean;
    /** Peserta selesai yang belum punya skor IRT. */
    missing: number;
    /** Peserta yang sedang dalam jendela pemulihan/susulan. */
    recovering: number;
}

export function irtRecalculationStatus(attempts: IrtAttempt[], scoringType?: string | null): IrtRecalculationStatus {
    if (!usesIrtScoring(scoringType)) return { calculated: false, missing: 0, recovering: 0 };
    const finished = attempts.filter(attempt => attempt.status === 'submitted' || attempt.status === 'auto_submitted');
    const calculated = finished.some(hasIrtScore);
    return {
        calculated,
        missing: calculated ? finished.filter(attempt => !hasIrtScore(attempt)).length : 0,
        recovering: calculated ? attempts.filter(attempt => attempt.status === 'in_progress' &&
            typeof attempt.metadata?.proctor_recovery_until === 'string').length : 0,
    };
}
