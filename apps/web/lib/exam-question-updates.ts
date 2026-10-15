/** Merge only newer revisions; preserve question numbering and every option's visible position. */
export function mergeExamQuestionUpdates<T extends {
    id: string; revision?: number; bank_question_options?: { id: string; order?: number }[];
}>(current: T[], updates: T[]): T[] {
    const revisions = new Map(updates.map(question => [question.id, question]));
    return current.map(question => {
        const next = revisions.get(question.id);
        if (!next || (next.revision || 1) <= (question.revision || 1)) return question;
        if (!question.bank_question_options || !next.bank_question_options) return next;
        const options = new Map(next.bank_question_options.map(option => [option.id, option]));
        return { ...next, bank_question_options: question.bank_question_options.map(option => ({
            ...(options.get(option.id) || option), order: option.order,
        })) };
    });
}
