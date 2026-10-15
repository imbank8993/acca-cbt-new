export interface AnswerOutcome {
    is_correct?: boolean | null;
    bank_questions?: { type?: string | null } | null;
}

export interface AnswerOutcomeSummary {
    total: number;
    correct: number;
    wrong: number;
    essays: number;
}

const ESSAY_TYPES = new Set(['essay', 'esay', 'uraian']);

export type AnswerOutcomeFilter = 'all' | 'correct' | 'wrong';

export function matchesAnswerOutcome(answer: AnswerOutcome, filter: AnswerOutcomeFilter): boolean {
    if (filter === 'all') return true;
    if (ESSAY_TYPES.has(answer.bank_questions?.type || '')) return false;
    return answer.is_correct === (filter === 'correct');
}

/** Hitung benar/salah hanya untuk soal objektif; esai tetap menunggu penilaian. */
export function summarizeAnswerOutcomes(answers: AnswerOutcome[]): AnswerOutcomeSummary {
    const objective = answers.filter(answer => !ESSAY_TYPES.has(answer.bank_questions?.type || ''));
    return {
        total: answers.length,
        correct: objective.filter(answer => answer.is_correct === true).length,
        wrong: objective.filter(answer => answer.is_correct === false).length,
        essays: answers.length - objective.length,
    };
}
