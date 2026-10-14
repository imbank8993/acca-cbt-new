import { availableStudentScoreTypes, selectedStudentScore, STUDENT_SCORE_LABELS } from '@acca-cbt/shared';
import type { ExamAttemptRecord } from './api/proctor';

/** Staff can inspect every configured model, independently of student publication. */
export function monitoringScoreModels(attempt: ExamAttemptRecord) {
    const finished = ['submitted', 'auto_submitted'].includes(attempt.status);
    return availableStudentScoreTypes(attempt.exams?.scoring_type).map(type => {
        const score = type !== 'classical' && !finished ? null : selectedStudentScore(attempt, {
            scoring_type: attempt.exams?.scoring_type, metadata: { student_score_type: type },
        });
        return {
            type, label: STUDENT_SCORE_LABELS[type], score,
            pendingLabel: attempt.needs_manual_grading ? 'Menunggu koreksi'
                : type === 'classical' ? 'Belum tersedia' : 'Menunggu perhitungan IRT',
        };
    });
}
