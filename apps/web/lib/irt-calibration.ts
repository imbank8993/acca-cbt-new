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

/** Use complete question text from the same analysis response, without changing parameters. */
export function withIrtQuestionText(calibration: IrtCalibration, questions: readonly {
    id: string; qText: string; options?: readonly { id?: string; option_text?: string | null }[];
}[] = []): IrtCalibration {
    const byId = new Map(questions.map(question => [question.id, question]));
    return { ...calibration, items: calibration.items.map(item => {
        const question = byId.get(item.question_id);
        const option = item.option_id ? question?.options?.find(option => option.id === item.option_id) : undefined;
        return { ...item, text: question?.qText || item.text, part: option?.option_text || item.part };
    }) };
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
