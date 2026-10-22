/**
 * Soal yang dibatalkan (cacat) untuk satu ujian.
 *
 * Disimpan di `cbt_exams.metadata.voided_questions` lewat koreksi kunci, lalu
 * ditandai `metadata.score_excluded` pada salinan soal beku oleh
 * `applyCorrections`. Soal bertanda ini dikeluarkan dari skor yang diperoleh
 * MAUPUN skor maksimum: dari 40 soal dengan satu dibatalkan, nilai dihitung
 * dari 39 soal. Siswa tidak dirugikan, apa pun jawabannya.
 */
export const SCORE_EXCLUDED_FLAG = 'score_excluded';

export interface VoidedQuestion {
    at: string;
    actorId: string;
    reason: string;
}

export function isScoreExcluded(question: { metadata?: unknown } | null | undefined): boolean {
    const metadata = question?.metadata;
    return !!metadata && typeof metadata === 'object' && (metadata as Record<string, unknown>)[SCORE_EXCLUDED_FLAG] === true;
}

/** Tandai salinan soal; tidak pernah mengubah objek asli. */
export function markScoreExcluded<T extends { metadata?: unknown }>(question: T): T {
    const metadata = question.metadata && typeof question.metadata === 'object' ? question.metadata as Record<string, unknown> : {};
    return { ...question, metadata: { ...metadata, [SCORE_EXCLUDED_FLAG]: true } };
}
