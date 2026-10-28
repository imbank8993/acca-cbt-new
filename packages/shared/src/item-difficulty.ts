/** Classical facility P, not IRT b or theta. Fixed interpretive bands, never quantiles. */
export const ITEM_DIFFICULTY_CATEGORIES = [
    'Sangat Sulit', 'Sulit', 'Sedang', 'Mudah', 'Sangat Mudah',
] as const;

export type ItemDifficultyCategory = typeof ITEM_DIFFICULTY_CATEGORIES[number];

/** Only scored binary responses enter P; pending grading is not a wrong answer. */
export function classicalDifficultyIndex(correct: number, incorrect: number): number | null {
    if (![correct, incorrect].every(value => Number.isSafeInteger(value) && value >= 0)) return null;
    const graded = correct + incorrect;
    return graded > 0 ? correct / graded : null;
}

export function classicalDifficulty(p: number | null | undefined): ItemDifficultyCategory | null {
    if (typeof p !== 'number' || !Number.isFinite(p) || p < 0 || p > 1) return null;
    if (p <= 0.1) return 'Sangat Sulit';
    if (p <= 0.3) return 'Sulit';
    if (p <= 0.7) return 'Sedang';
    if (p <= 0.9) return 'Mudah';
    return 'Sangat Mudah';
}
