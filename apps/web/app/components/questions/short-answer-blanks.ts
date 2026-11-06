// Satu isian ditandai tepat empat titik. Editor rich text dapat menyimpan
// tiga titik pertama sebagai elipsis tipografis atau entitas HTML.
export const SHORT_ANSWER_BLANK_RE = /(?<!\.)\.{4}(?!\.)|…\.(?!\.)|&hellip;\.(?!\.)|&#8230;\.(?!\.)|&#x2026;\.(?!\.)/gi;

export function countShortAnswerBlanks(questionText: string): number {
    return (questionText.match(SHORT_ANSWER_BLANK_RE) || []).length;
}
