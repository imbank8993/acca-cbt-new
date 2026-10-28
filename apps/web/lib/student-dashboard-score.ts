import { selectedStudentScore, studentScoreType, STUDENT_SCORE_LABELS } from '@acca-cbt/shared';
import type { StudentResult } from './api/students';

export function dashboardResultScore(result: StudentResult): number | null {
    if (!result.exams?.show_results || result.needs_manual_grading ||
        !['submitted', 'auto_submitted'].includes(result.status)) return null;
    const score = result.display_score !== undefined
        ? result.display_score : selectedStudentScore(result, result.exams);
    const type = result.score_type || studentScoreType(result.exams);
    return typeof score === 'number' && Number.isFinite(score) &&
        (type !== 'classical' || (score >= 0 && score <= 100)) ? score : null;
}

export function dashboardAverageScore(results: StudentResult[]): number | null {
    return dashboardScoreSummary(results).average;
}

/** Summaries never average theta and classical points, or different IRT models. */
export function dashboardScoreSummary(results: StudentResult[]) {
    const valid = results.filter(result => dashboardResultScore(result) !== null);
    const type = valid[0]?.score_type || studentScoreType(valid[0]?.exams);
    const scores = valid.filter(result => (result.score_type || studentScoreType(result.exams)) === type)
        .map(result => dashboardResultScore(result)!);
    const average = scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : null;
    return { type, label: STUDENT_SCORE_LABELS[type], count: scores.length,
        average: average === null ? null : type === 'classical' ? Math.round(average) : Math.round(average * 1000) / 1000 };
}
