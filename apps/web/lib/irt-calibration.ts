/** Parameter butir hasil Kalkulasi IRT (cermin `apps/api/src/common/irt-calibration.ts`). */
export interface IrtCalibrationItem {
    item_id: string;
    question_id: string;
    option_id: string | null;
    number: number;
    part: string | null;
    type: string;
    text: string;
    total: number;
    correct: number;
    /** Proporsi peserta yang menjawab benar (0–1). */
    p: number;
    /** Tingkat kesulitan; negatif = mudah, positif = sulit. */
    b: number;
    /** Daya beda (2PL/3PL); makin besar makin membedakan siswa pandai dan kurang. */
    a: number;
    /** Peluang menebak (3PL) = 1 ÷ jumlah opsi. */
    c: number;
    flags: string[];
}

export interface IrtCalibration {
    calculated_at: string;
    participant_count: number;
    models: string[];
    warnings: string[];
    items: IrtCalibrationItem[];
}

export function difficultyLabel(b: number): { label: string; tone: 'easy' | 'medium' | 'hard' } {
    if (b < -1) return { label: 'Mudah', tone: 'easy' };
    if (b > 1) return { label: 'Sulit', tone: 'hard' };
    return { label: 'Sedang', tone: 'medium' };
}

export function discriminationLabel(a: number): { label: string; tone: 'low' | 'fair' | 'good' } {
    if (a < 0.5) return { label: 'Rendah', tone: 'low' };
    if (a < 1) return { label: 'Cukup', tone: 'fair' };
    return { label: 'Baik', tone: 'good' };
}

/** Nilai IRT siswa berkemampuan θ: 50 + 15θ, dibatasi 0–100 (sama dengan layanan penilaian). */
export const irtScaledScore = (theta: number) => Math.min(100, Math.max(0, 50 + 15 * theta));
