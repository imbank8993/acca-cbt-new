export const STUDENT_SCORE_TYPES = ['classical', 'irt_1pl', 'irt_2pl', 'irt_3pl'] as const;
export type StudentScoreType = typeof STUDENT_SCORE_TYPES[number];
export const STUDENT_SCORE_LABELS: Record<StudentScoreType, string> = {
    classical: 'Klasikal', irt_1pl: 'IRT 1PL', irt_2pl: 'IRT 2PL', irt_3pl: 'IRT 3PL',
};
type ScoreExam = { scoring_type?: string | null; show_results?: boolean; metadata?: Record<string, unknown> | null };
type ScoreAttempt = { total_score?: unknown; score_irt?: unknown; detailed_scores?: Record<string, unknown> | null;
    needs_manual_grading?: boolean; metadata?: Record<string, unknown> | null; status?: string };

export function availableStudentScoreTypes(scoringType?: string | null): StudentScoreType[] {
    const enabled = (scoringType || '').split(',').map(value => value.trim());
    return STUDENT_SCORE_TYPES.filter(type => type === 'classical' || enabled.includes(type));
}
export function studentScoreType(exam?: ScoreExam | null): StudentScoreType {
    const enabled = availableStudentScoreTypes(exam?.scoring_type);
    const requested = exam?.metadata?.student_score_type as StudentScoreType;
    if (enabled.includes(requested)) return requested;
    return (['irt_3pl', 'irt_2pl', 'irt_1pl'] as StudentScoreType[]).find(type => enabled.includes(type)) || 'classical';
}
/**
 * Skala pelaporan IRT lokal: 500 + 100θ, dibatasi 200–800.
 * θ asli tetap tersimpan (score_irt, irt_theta, detailed_scores); skala ini hanya untuk
 * dilaporkan. 500 adalah titik acuan θ = 0, bukan jaminan rerata peserta atau nasional.
 */
export const IRT_REPORT_SCALE = { mean: 500, sd: 100, min: 200, max: 800 } as const;
export function irtScaledScore(theta: number): number {
    const scaled = IRT_REPORT_SCALE.mean + IRT_REPORT_SCALE.sd * theta;
    return Math.round(Math.min(IRT_REPORT_SCALE.max, Math.max(IRT_REPORT_SCALE.min, scaled)) * 100) / 100;
}
export function hasThetaIrtScale(attempt: Pick<ScoreAttempt, 'metadata'>): boolean {
    return attempt.metadata?.irt_score_scale === 'theta';
}
function finiteScore(value: unknown, classical = false): number | null {
    if (!(typeof value === 'number' || typeof value === 'string') || (typeof value === 'string' && !value.trim())) return null;
    const score = Number(value);
    return Number.isFinite(score) && (!classical || (score >= 0 && score <= 100)) ? score : null;
}
export function selectedStudentScore(attempt: ScoreAttempt, exam?: ScoreExam | null): number | null {
    if (attempt.needs_manual_grading || attempt.metadata?.relative_scoring_pending === true) return null;
    const type = studentScoreType(exam);
    if (type === 'classical') return finiteScore(attempt.total_score, true);
    // Legacy 0–100 scores cannot be inverted reliably (clipping/essay blending).
    if (!hasThetaIrtScale(attempt)) return null;
    // Nilai siswa IRT dilaporkan pada skala 200–800, bukan θ mentah.
    const detailed = finiteScore(attempt.detailed_scores?.[type]);
    if (detailed !== null) return irtScaledScore(detailed);
    const defaultType = studentScoreType({ scoring_type: exam?.scoring_type });
    const theta = type === defaultType ? finiteScore(attempt.score_irt) : null;
    return theta === null ? null : irtScaledScore(theta);
}
export function publicStudentScores(attempt: ScoreAttempt, exam?: ScoreExam | null) {
    const type = studentScoreType(exam);
    const score = exam?.show_results === true && ['submitted', 'auto_submitted'].includes(attempt.status || '')
        ? selectedStudentScore(attempt, exam) : null;
    return { display_score: score, score_type: type, score_label: STUDENT_SCORE_LABELS[type],
        total_score: type === 'classical' ? score : null, score_irt: type !== 'classical' ? score : null };
}
