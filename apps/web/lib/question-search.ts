import { stripHtml } from './answer-display';

export function matchesQuestionSearch(text: string | null | undefined, number: number, query: string): boolean {
    const search = query.trim().toLowerCase();
    if (!search) return true;
    const ordinal = search.match(/^(?:soal\s*)?(\d+)$/);
    if (ordinal) return number === Number(ordinal[1]);
    const plain = stripHtml(text || '').toLowerCase();
    return search.split(/\s+/).every(word => plain.includes(word));
}
