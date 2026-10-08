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

/** Nilai `cbt_exams.metadata.question_order` untuk ujian yang memakai pengacakan lama (tanpa grup). */
export const LEGACY_QUESTION_ORDER = 'legacy';

/** Ujian memakai pengacakan berkelompok kecuali ditandai legacy oleh migrasi. */
export function examUsesQuestionGroups(examMetadata: unknown): boolean {
    return (examMetadata as { question_order?: unknown } | null | undefined)?.question_order !== LEGACY_QUESTION_ORDER;
}

/**
 * Kunci grup sebuah soal, atau `null` bila soal berdiri sendiri.
 *
 * - Penanda manual `metadata.group_key` didahulukan — guru dapat menyatukan
 *   soal yang tidak berbagi stimulus (mis. soal bertahap 5a, 5b, 5c), atau
 *   memisahkan soal dari grup stimulusnya dengan memberi kunci berbeda.
 * - Selain itu, soal yang memakai stimulus yang sama otomatis satu grup.
 *
 * Kunci manual dicakup per bank: ujian yang menggabungkan beberapa bank tidak
 * boleh menyatukan "Grup A" bank satu dengan "Grup A" bank lain.
 */
export function questionGroupKey(question: {
    metadata?: any;
    bank_id?: unknown;
    stimulus_id?: unknown;
    stimulus?: { id?: unknown } | null;
}): string | null {
    const manual = typeof question.metadata?.group_key === 'string' ? question.metadata.group_key.trim() : '';
    if (manual) return `manual:${String(question.bank_id ?? '')}:${manual.toLowerCase()}`;
    const stimulusId = question.stimulus?.id ?? question.stimulus_id;
    if (stimulusId) return `stimulus:${String(stimulusId)}`;
    return null;
}

/**
 * Acak dua tingkat: urutan blok diacak, lalu isi tiap blok diacak. Soal dalam
 * satu grup selalu berdampingan; posisi blok pada urutan dasar mengikuti soal
 * pertamanya.
 *
 * Bila tidak ada grup berisi lebih dari satu soal, setiap blok berukuran satu
 * dan pengacakan isi blok tidak memakai angka acak sama sekali — hasilnya
 * identik dengan `shuffle(ordered, rand)` versi lama.
 */
function shuffleInGroups<T extends { metadata?: any }>(ordered: T[], rand: () => number): T[] {
    const blocks: T[][] = [];
    const byKey = new Map<string, T[]>();
    for (const question of ordered) {
        const key = questionGroupKey(question as any);
        if (key === null) {
            blocks.push([question]);
            continue;
        }
        let block = byKey.get(key);
        if (!block) {
            block = [];
            byKey.set(key, block);
            blocks.push(block);
        }
        block.push(question);
    }
    return shuffle(blocks, rand).flatMap(block => shuffle(block, rand));
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
 *
 * Dengan `groups` aktif (bawaan), soal satu grup — stimulus yang sama atau
 * `metadata.group_key` yang sama — tetap berdampingan; lihat `shuffleInGroups`.
 * `groups: false` hanya untuk ujian lama yang attempt-nya sudah memakai urutan
 * tanpa grup, agar nomor soal di review tidak bergeser.
 */
export function orderQuestionsForStudent<T extends { metadata?: any; __exam_source_order?: number }>(
    questions: T[],
    options: { userId: string; examId: string; randomize?: boolean | null; groups?: boolean },
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
    const rand = mulberry32(`${options.userId}:${options.examId}`);
    return options.groups === false ? shuffle(ordered, rand) : shuffleInGroups(ordered, rand);
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
