/**
 * Parameter butir hasil "Kalkulasi IRT", disimpan di `cbt_exams.metadata.irt_calibration`
 * supaya guru dapat melihat ciri tiap soal: proporsi benar (p), tingkat kesulitan (b),
 * daya beda (a), dan peluang menebak (c).
 *
 * Benar-Salah, Menjodohkan, dan Kategori dihitung per pernyataan/pasangan; butirnya
 * berbentuk `<questionId>_<optionId>` dan diberi label nomor soal + pernyataannya.
 */

export interface IrtItemParameterInput {
    item_id: string;
    total: number;
    correct: number;
    p_value: number;
    b: number;
    a: number;
    c: number;
}

export interface IrtCalibrationItem {
    item_id: string;
    question_id: string;
    option_id: string | null;
    number: number;
    /** Label pernyataan untuk butir pecahan (B/S, menjodohkan, kategori). */
    part: string | null;
    type: string;
    text: string;
    total: number;
    correct: number;
    p: number;
    b: number;
    a: number;
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

type QuestionLike = { id: string; type?: string | null; question_text?: unknown; bank_question_options?: unknown[] };

/** Teks polos singkat dari HTML soal (tanpa tag, entitas umum, dan spasi ganda). */
export function plainSnippet(value: unknown, max = 140): string {
    const text = String(value ?? '')
        .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
        .replace(/\s+/g, ' ')
        .trim();
    return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** Catatan untuk guru, memakai batas yang lazim dalam analisis butir. */
export function irtItemFlags(item: { p: number; a: number }, withDiscrimination: boolean): string[] {
    const flags: string[] = [];
    if (item.p >= 0.9) flags.push('Terlalu mudah');
    else if (item.p <= 0.2) flags.push('Terlalu sulit');
    if (withDiscrimination && item.a < 0.5) flags.push('Daya beda rendah');
    return flags;
}

export function buildIrtCalibration(
    questions: QuestionLike[],
    items: IrtItemParameterInput[],
    options: { calculatedAt: string; participantCount: number; models: string[]; warnings?: string[] },
): IrtCalibration {
    const numberById = new Map(questions.map((question, index) => [question.id, index + 1]));
    const questionById = new Map(questions.map(question => [question.id, question]));
    const withDiscrimination = options.models.some(model => model === 'irt_2pl' || model === 'irt_3pl');
    const round = (value: number, digits = 3) => Number.isFinite(value) ? Number(value.toFixed(digits)) : 0;

    const result = items.map((item): IrtCalibrationItem | null => {
        // Butir pecahan: "<uuid soal>_<uuid opsi>" (UUID tidak memuat garis bawah).
        const [questionId, optionId = null] = item.item_id.split('_');
        const question = questionById.get(questionId);
        if (!question) return null;
        const option = optionId
            ? (question.bank_question_options as Array<{ id?: string; option_text?: unknown }> | undefined)?.find(row => row.id === optionId)
            : undefined;
        const p = round(item.p_value, 4);
        const a = round(item.a);
        return {
            item_id: item.item_id,
            question_id: questionId,
            option_id: optionId,
            number: numberById.get(questionId) || 0,
            part: optionId ? plainSnippet(option?.option_text, 80) || 'Pernyataan' : null,
            type: String(question.type || 'mcq'),
            text: plainSnippet(question.question_text),
            total: item.total,
            correct: item.correct,
            p,
            b: round(item.b),
            a,
            c: round(item.c),
            flags: irtItemFlags({ p, a }, withDiscrimination),
        };
    }).filter((item): item is IrtCalibrationItem => item !== null);

    result.sort((x, y) => x.number - y.number || String(x.part || '').localeCompare(String(y.part || ''), 'id', { numeric: true }));
    return {
        calculated_at: options.calculatedAt,
        participant_count: options.participantCount,
        models: options.models,
        warnings: options.warnings || [],
        items: result,
    };
}
