import { classicalDifficultyIndex } from '@acca-cbt/shared';

type AnalysisCounts = { correct: number; incorrect: number; number?: number };

/** Tersulit (P terkecil) dahulu; jika sama, dahulukan lebih banyak jawaban salah.
 * Respons yang belum dinilai tidak memengaruhi kesulitan; soal tanpa data di akhir. */
export function compareItemAnalysisDifficulty(a: AnalysisCounts, b: AnalysisCounts): number {
    const pa = classicalDifficultyIndex(a.correct, a.incorrect);
    const pb = classicalDifficultyIndex(b.correct, b.incorrect);
    if (pa === null || pb === null) {
        if (pa !== pb) return pa === null ? 1 : -1;
        return (a.number ?? Number.MAX_SAFE_INTEGER) - (b.number ?? Number.MAX_SAFE_INTEGER);
    }
    return (pa - pb) || (b.incorrect - a.incorrect) ||
        ((b.correct + b.incorrect) - (a.correct + a.incorrect)) ||
        ((a.number ?? Number.MAX_SAFE_INTEGER) - (b.number ?? Number.MAX_SAFE_INTEGER));
}
