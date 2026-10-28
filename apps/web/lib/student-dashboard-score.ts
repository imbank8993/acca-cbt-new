import { selectedStudentScore, studentScoreType, STUDENT_SCORE_LABELS, STUDENT_SCORE_TYPES } from '@acca-cbt/shared';
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

/** Summaries never average IRT (200–800) and classical points, or different IRT models. */
export function dashboardScoreSummaries(results: StudentResult[]) {
    const valid = results.filter(result => dashboardResultScore(result) !== null);
    return STUDENT_SCORE_TYPES.flatMap(type => {
        const scores = valid.filter(result => (result.score_type || studentScoreType(result.exams)) === type)
            .map(result => dashboardResultScore(result)!);
        if (!scores.length) return [];
        const average = scores.reduce((sum, score) => sum + score, 0) / scores.length;
        return [{ type, label: STUDENT_SCORE_LABELS[type], count: scores.length,
            average: type === 'classical' ? Math.round(average) : Math.round(average * 100) / 100 }];
    });
}

export function dashboardScoreSummary(results: StudentResult[]) {
    const first = results.find(result => dashboardResultScore(result) !== null);
    const type = first?.score_type || studentScoreType(first?.exams);
    return dashboardScoreSummaries(results).find(summary => summary.type === type) ?? {
        type, label: STUDENT_SCORE_LABELS[type], count: 0, average: null,
    };
}
