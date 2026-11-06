// Editor rich text dan soal hasil impor dapat menyimpan elipsis sebagai karakter
// tunggal atau entitas HTML, bukan deretan titik biasa.
export const SHORT_ANSWER_BLANK_RE = /(?:\.{3,}|…\.?|&hellip;\.?|&#8230;\.?|&#x2026;\.?)/gi;

export function countShortAnswerBlanks(questionText: string): number {
    return (questionText.match(SHORT_ANSWER_BLANK_RE) || []).length;
}
