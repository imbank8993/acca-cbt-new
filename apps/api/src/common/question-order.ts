/**
 * Urutan soal yang DILIHAT SISWA saat mengerjakan ujian.
 *
 * Ini satu-satunya sumber kebenaran urutan soal. Review hasil ujian memakainya
 * supaya "soal nomor 7" di layar review adalah soal nomor 7 yang benar-benar
 * dikerjakan siswa; tanpa itu, penomorannya tidak berarti apa-apa pada ujian
 * yang diacak — dan kedua ujian di basis data saat ini memakai
 * `randomize_questions`.
 *
 * Aslinya di `getExamQuestionsAction` (`apps/web/app/actions/siswa.ts`).
 * Ketika modul `siswa` ikut dipindahkan, ia HARUS memanggil fungsi ini, bukan
 * menyalin ulang logikanya: begitu keduanya berbeda satu langkah saja, nomor
 * soal di review berhenti cocok dengan nomor soal di ujian, dan tidak ada yang
 * akan menyadarinya sampai ada siswa yang protes.
 */

/** Generator mulberry32 — cepat, deterministik, dan cukup untuk pengacakan urutan. */
function mulberry32(seedStr: string): () => number {
    let seed = 0;
    for (let i = 0; i < seedStr.length; i++) {
        seed = (seed * 31 + seedStr.charCodeAt(i)) >>> 0;
    }
    return () => {
        seed = (seed + 0x6d2b79f5) >>> 0;
        let t = seed;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function shuffle<T>(arr: T[], rand: () => number): T[] {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

/**
 * Susun soal persis seperti yang diterima siswa.
 *
 * `questions` harus sudah terurut `created_at ASC` dari query — urutan itu jadi
 * dasar, lalu `metadata.order_index` dipakai bila KEDUA soal memilikinya
 * (pengurutannya stabil, jadi soal tanpa order_index tetap di tempatnya).
 *
 * Pengacakan diseed dengan `userId:examId`, bukan angka acak: siswa yang memuat
 * ulang halaman di tengah ujian harus menerima urutan yang sama.
 */
export function orderQuestionsForStudent<T extends { metadata?: any; __exam_source_order?: number }>(
    questions: T[],
    options: { userId: string; examId: string; randomize?: boolean | null },
): T[] {
    const ordered = [...questions].sort((a, b) => {
        if (a.__exam_source_order !== undefined && b.__exam_source_order !== undefined &&
            a.__exam_source_order !== b.__exam_source_order) {
            return a.__exam_source_order - b.__exam_source_order;
        }
        const oa = a.metadata?.order_index;
        const ob = b.metadata?.order_index;
        if (oa !== undefined && ob !== undefined) return oa - ob;
        return 0; // sort stabil — pertahankan urutan created_at
    });

    if (!options.randomize) return ordered;
    return shuffle(ordered, mulberry32(`${options.userId}:${options.examId}`));
}

/** Hanya tipe ini yang urutan opsinya tidak membawa makna. */
const SHUFFLEABLE_OPTION_TYPES = ['mcq', 'mcq_complex'];

/**
 * Acak urutan opsi jawaban, untuk tipe soal yang urutannya memang tidak
 * bermakna. Soal mengurutkan/merangking dikecualikan: di sana urutan opsi ADALAH
 * datanya.
 *
 * `order` ditulis ulang berurutan setelah diacak karena klien menyortir opsi
 * berdasarkan kolom itu — tanpa penulisan ulang, hasil acaknya langsung
 * dikembalikan ke urutan semula di layar.
 *
 * Seed-nya sama dengan `orderQuestionsForStudent` sehingga susunan yang diterima
 * seorang siswa tetap sama setiap kali halaman dimuat ulang.
 */
export function shuffleOptionsForStudent<T extends { type?: string; bank_question_options?: any[] }>(
    questions: T[],
    options: { userId: string; examId: string; randomize?: boolean | null },
): T[] {
    if (!options.randomize) return questions;

    const rand = mulberry32(`${options.userId}:${options.examId}`);

    return questions.map((question) =>
        SHUFFLEABLE_OPTION_TYPES.includes(question.type || '')
            ? {
                  ...question,
                  bank_question_options: shuffle(question.bank_question_options || [], rand).map(
                      (option: any, index: number) => ({ ...option, order: index }),
                  ),
              }
            : question,
    );
}
