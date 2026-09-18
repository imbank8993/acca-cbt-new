/**
 * Utility function to safely parse answer values
 * Used across exam, results, and review pages
 */

export type AnswerValue = string | string[] | Record<string, any> | null | undefined;

/**
 * Safely parse JSON answer with fallback
 * @param val - The answer value (can be string, object, array, null, undefined)
 * @param fallback - Fallback value if parsing fails
 * @returns Parsed value or fallback
 */
export function parseAnswer<T>(val: AnswerValue, fallback: T): T {
    if (val === null || val === undefined || val === '') return fallback;
    if (typeof val !== 'string') return val as unknown as T;
    try {
        return JSON.parse(val);
    } catch {
        return fallback;
    }
}

/**
 * Parse answer for MCQ (single selection)
 */
export function parseMCQAnswer(val: AnswerValue): string | null {
    return parseAnswer<string | null>(val, null);
}

/**
 * Parse answer for MCQ Complex (multiple selections).
 *
 * Toleran terhadap dua bentuk warisan yang kalau di-fallback ke [] akan
 * MENGHAPUS jawaban siswa dari layar (dan dari centang berikutnya):
 * - id tunggal telanjang di kolom selected_option_id, sisa dari soal yang dulu
 *   bertipe `mcq` lalu diubah menjadi `mcq_complex`;
 * - string gabungan dipisah koma dari klien lama.
 */
export function parseMCQComplexAnswer(val: AnswerValue): string[] {
    if (val === null || val === undefined || val === '') return [];
    if (Array.isArray(val)) return val.map(String);

    if (typeof val === 'string') {
        const trimmed = val.trim();
        if (trimmed === '') return [];
        try {
            const parsed = JSON.parse(trimmed);
            if (Array.isArray(parsed)) return parsed.map(String);
            // JSON valid tapi bukan array (mis. sebuah id ber-tanda-kutip).
            return String(parsed).trim() === '' ? [] : [String(parsed)];
        } catch {
            return trimmed.split(',').map(s => s.trim()).filter(Boolean);
        }
    }

    return parseAnswer<string[]>(val, []);
}

/**
 * Parse answer for True/False
 */
export function parseTrueFalseAnswer(val: AnswerValue): Record<string, boolean> {
    return parseAnswer<Record<string, boolean>>(val, {});
}

/**
 * Parse answer for Categorization
 */
export function parseCategorizationAnswer(val: AnswerValue): Record<string, string[]> {
    return parseAnswer<Record<string, string[]>>(val, {});
}

/**
 * Parse answer for Matching
 */
export function parseMatchingAnswer(val: AnswerValue): Record<string, string[]> {
    return parseAnswer<Record<string, string[]>>(val, {});
}

/**
 * Parse answer for Short Answer (fill in the blanks)
 */
export function parseShortAnswer(val: AnswerValue): string[] {
    const parsed = parseAnswer<string[] | string>(val, []);
    // Handle legacy single string answers
    if (typeof parsed === 'string') {
        return [parsed];
    }
    return parsed;
}

/**
 * Normalize a short-answer string for comparison.
 *
 * Pencocokan sengaja PERSIS: hanya trim (buang spasi tepi) + lowercase.
 * Spasi di tengah TIDAK diubah — "x+y" dan "x + y" tetap dianggap berbeda.
 * Pembuat soal yang menuliskan sendiri setiap variasi jawaban yang diterima.
 * Fungsi ini dipakai baik oleh grading server maupun feedback client agar
 * alternatif yang terdaftar dinilai sama persis di kedua sisi.
 */
export function normalizeShortAnswer(val: string | null | undefined): string {
    return (val || '').trim().toLowerCase();
}

/**
 * Parse answer for Essay
 */
export function parseEssayAnswer(val: AnswerValue): string {
    return parseAnswer<string>(val, '');
}

/**
 * Parse answer for SJT — single selected option ID
 */
export function parseSJTAnswer(val: AnswerValue): string | null {
    return parseAnswer<string | null>(val, null);
}

/**
 * Parse answer for Ordering — ordered array of option IDs
 */
export function parseOrderingAnswer(val: AnswerValue): string[] {
    const parsed = parseAnswer<string[] | string>(val, []);
    if (typeof parsed === 'string') {
        try { return JSON.parse(parsed); } catch { return [parsed]; }
    }
    return parsed;
}
