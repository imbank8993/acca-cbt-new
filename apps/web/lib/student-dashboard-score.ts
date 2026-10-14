import { selectedStudentScore } from '@acca-cbt/shared';
import type { StudentResult } from './api/students';

export function dashboardResultScore(result: StudentResult): number | null {
    if (!result.exams?.show_results || result.needs_manual_grading ||
        !['submitted', 'auto_submitted'].includes(result.status)) return null;
    const score = result.display_score !== undefined
        ? result.display_score : selectedStudentScore(result, result.exams);
    return typeof score === 'number' && Number.isFinite(score) && score >= 0 && score <= 100 ? score : null;
}

export function dashboardAverageScore(results: StudentResult[]): number | null {
    const scores = results.map(dashboardResultScore).filter((score): score is number => score !== null);
    return scores.length ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length) : null;
}
