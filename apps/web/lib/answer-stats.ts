import { hasStoredAnswer } from '@acca-cbt/shared';

export interface AnswerOutcome {
    is_correct?: boolean | null;
    is_answered?: boolean;
    essay_answer?: unknown;
    selected_option_id?: unknown;
    bank_questions?: { type?: string | null } | null;
}

export interface AnswerOutcomeSummary {
    total: number;
    correct: number;
    wrong: number;
    essays: number;
    answered: number;
    unanswered: number;
    ungraded: number;
}

const ESSAY_TYPES = new Set(['essay', 'esay', 'uraian']);

export type AnswerOutcomeFilter = 'all' | 'correct' | 'wrong' | 'unanswered';

export function isAnswerUnanswered(answer: AnswerOutcome): boolean {
    return answer.is_answered === false || !hasStoredAnswer(answer);
}

export function matchesAnswerOutcome(answer: AnswerOutcome, filter: AnswerOutcomeFilter): boolean {
    if (filter === 'all') return true;
    const unanswered = isAnswerUnanswered(answer);
    if (filter === 'unanswered') return unanswered;
    if (unanswered) return false;
    if (ESSAY_TYPES.has(answer.bank_questions?.type || '')) return false;
    return answer.is_correct === (filter === 'correct');
}

/** Hitung benar/salah hanya untuk soal objektif; esai tetap menunggu penilaian. */
export function summarizeAnswerOutcomes(answers: AnswerOutcome[]): AnswerOutcomeSummary {
    const answered = answers.filter(answer => !isAnswerUnanswered(answer));
    const objective = answered.filter(answer => !ESSAY_TYPES.has(answer.bank_questions?.type || ''));
    return {
        total: answers.length,
        correct: objective.filter(answer => answer.is_correct === true).length,
        wrong: objective.filter(answer => answer.is_correct === false).length,
        essays: answered.length - objective.length,
        answered: answered.length,
        unanswered: answers.length - answered.length,
        ungraded: objective.filter(answer => answer.is_correct == null).length,
    };
}
