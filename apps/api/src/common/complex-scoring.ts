/**
 * Aturan penskoran Benar-Salah dan Kategorisasi untuk satu ujian.
 *
 * `official` (bawaan): satu soal dinilai sebagai satu soal, mengikuti Kepdirjen
 * Pendis 781/2021 dan Desain Pengembangan Soal AKM 2020 — soal ≤ 5 pernyataan
 * semua-atau-nol; soal > 5 pernyataan skor penuh / setengah (salah 1–2) / nol.
 *
 * `proportional`: aturan lama, skor = pernyataan benar ÷ jumlah pernyataan.
 * Dipasang oleh migrasi 20261030_01 pada setiap ujian yang sudah memiliki
 * pengerjaan saat aturan resmi diberlakukan, supaya nilai yang sudah ada tidak
 * bergeser bila ujian itu dinilai ulang.
 *
 * Aturan disimpan di `cbt_exams.metadata.complex_scoring_rule`, lalu dicap pada
 * SALINAN soal beku (`metadata.complex_scoring`) sehingga setiap pemanggil
 * layanan penilaian dan IRT membawanya tanpa mengubah payload masing-masing.
 * Snapshot tersimpan tidak pernah ditulis ulang.
 *
 * Penanda yang sama juga mempertahankan parameter tebakan IRT 3PL lama untuk
 * PG Kompleks, Isian Singkat, dan Urutan, sehingga Kalkulasi IRT ulang pada
 * ujian lama memberi hasil yang sama seperti sebelumnya.
 */
export const COMPLEX_SCORING_RULE_KEY = 'complex_scoring_rule';
export const COMPLEX_SCORING_FLAG = 'complex_scoring';
/** Tipe yang penilaian atau parameter IRT-nya berbeda antara aturan lama dan baru. */
export const LEGACY_MARKED_TYPES = ['true_false', 'categorization', 'mcq_complex', 'short_answer', 'ordering'];

export type ComplexScoringRule = 'official' | 'proportional';

export function examComplexScoringRule(examMetadata: unknown): ComplexScoringRule {
    return !!examMetadata && typeof examMetadata === 'object' &&
        (examMetadata as Record<string, unknown>)[COMPLEX_SCORING_RULE_KEY] === 'proportional'
        ? 'proportional' : 'official';
}

/** Cap aturan lama pada salinan soal bertipe terkait; tidak pernah mengubah objek asli. */
export function applyComplexScoringRule<T extends { type?: unknown; metadata?: unknown }>(
    question: T,
    rule: ComplexScoringRule,
): T {
    if (rule !== 'proportional' || !LEGACY_MARKED_TYPES.includes(String(question.type || '').toLowerCase())) {
        return question;
    }
    const metadata = question.metadata && typeof question.metadata === 'object'
        ? question.metadata as Record<string, unknown> : {};
    return { ...question, metadata: { ...metadata, [COMPLEX_SCORING_FLAG]: 'proportional' } };
}
