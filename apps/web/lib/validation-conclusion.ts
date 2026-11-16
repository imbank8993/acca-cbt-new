/**
 * Kesimpulan akhir validator terdiri atas kesimpulan dan saran umum untuk seluruh bank soal.
 * Keduanya disimpan di satu kolom `general_comment` (tanpa perubahan skema) dengan
 * judul baris yang tetap, lalu dipisah lagi untuk ditampilkan dan disunting.
 */
export const GENERAL_SUGGESTION_HEADING = 'Saran umum untuk seluruh bank soal:';

export interface ValidationConclusion {
    conclusion: string;
    suggestion: string;
}

export function composeGeneralComment(conclusion: string, suggestion: string): string {
    const head = conclusion.trim();
    const tail = suggestion.trim();
    if (!tail) return head;
    return head ? `${head}\n\n${GENERAL_SUGGESTION_HEADING}\n${tail}` : `${GENERAL_SUGGESTION_HEADING}\n${tail}`;
}

export function splitGeneralComment(text: string | null | undefined): ValidationConclusion {
    const value = String(text ?? '').replace(/\r\n/g, '\n');
    const lines = value.split('\n');
    const index = lines.map(line => line.trim()).lastIndexOf(GENERAL_SUGGESTION_HEADING);
    if (index < 0) return { conclusion: value.trim(), suggestion: '' };
    return { conclusion: lines.slice(0, index).join('\n').trim(), suggestion: lines.slice(index + 1).join('\n').trim() };
}
