import type { ExamAttemptRecord } from './api/proctor';

export function savedAnswerCount(attempt: ExamAttemptRecord): number | null {
    const count = attempt.saved_answer_count;
    return typeof count === 'number' && Number.isSafeInteger(count) && count >= 0 ? count : null;
}

export function matchesAnswerCount(attempt: ExamAttemptRecord, filter: string): boolean {
    if (!filter) return true;
    const count = savedAnswerCount(attempt);
    if (filter === 'unknown') return count === null;
    if (count === null) return false;
    if (filter === 'incomplete' || filter === 'complete') {
        const total = attempt.total_questions;
        if (typeof total !== 'number' || !Number.isSafeInteger(total) || total <= 0) return false;
        return filter === 'complete' ? count >= total : count < total;
    }
    return /^\d+$/.test(filter) && count === Number(filter);
}

export function sortByAnswerCount(attempts: ExamAttemptRecord[]): ExamAttemptRecord[] {
    return [...attempts].sort((a, b) => {
        const left = savedAnswerCount(a), right = savedAnswerCount(b);
        if (left === null && right !== null) return 1;
        if (right === null && left !== null) return -1;
        return (left ?? 0) - (right ?? 0) ||
            (a.profiles?.full_name || '').localeCompare(b.profiles?.full_name || '', 'id', { sensitivity: 'base' }) ||
            a.id.localeCompare(b.id);
    });
}
