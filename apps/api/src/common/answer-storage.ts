/**
 * Ke kolom mana sebuah jawaban disimpan.
 *
 * `cbt_answers` punya dua kolom jawaban, dan pembagiannya bukan soal selera:
 * `selected_option_id` adalah foreign key ke satu baris opsi, jadi hanya pilihan
 * ganda tunggal yang muat di sana. Semua tipe lain menyimpan jawabannya sebagai
 * teks/JSON di `essay_answer` — termasuk yang sama sekali bukan esai, seperti
 * benar/salah dan menjodohkan.
 *
 * Daftar ini harus sama di setiap jalur yang menulis atau membaca jawaban
 * (submit, susulan jawaban, penilaian ulang, review hasil). Begitu satu jalur
 * memakai daftar yang berbeda, jawaban ditulis ke kolom yang tidak dibaca jalur
 * lain — dan gejalanya adalah "jawaban siswa hilang", bukan galat.
 */

/** Dinilai manual oleh guru. */
export const ESSAY_TYPES = ['essay', 'esay', 'uraian'];

/** Jawabannya disimpan sebagai teks/JSON di `essay_answer`, bukan sebagai foreign key. */
export const COMPLEX_ANSWER_TYPES = [
    ...ESSAY_TYPES,
    'mcq_complex',
    'true_false',
    'categorization',
    'matching',
    'short_answer',
    'likert',
    'checklist',
    'ranking',
    'ordering',
];

export function isEssayType(type: string | null | undefined): boolean {
    return ESSAY_TYPES.includes(type || '');
}

/** True bila jawabannya masuk `essay_answer`, false bila masuk `selected_option_id`. */
export function usesTextColumn(type: string | null | undefined): boolean {
    return COMPLEX_ANSWER_TYPES.includes(type || '');
}

/**
 * Pecah satu jawaban mentah menjadi pasangan kolom yang benar untuk tipenya.
 * Kolom yang tidak dipakai selalu diisi null, bukan dibiarkan apa adanya —
 * mengganti jawaban dari tipe lain harus ikut mengosongkan kolom sebelumnya.
 */
export function toAnswerColumns(
    type: string | null | undefined,
    rawAnswer: string | null | undefined,
): { selected_option_id: string | null; essay_answer: string | null } {
    const value = rawAnswer || null;
    return usesTextColumn(type)
        ? { selected_option_id: null, essay_answer: value }
        : { selected_option_id: value, essay_answer: null };
}
