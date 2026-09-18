import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { AuthUser } from '@acca-cbt/shared';
import { AuthorizationService } from '../auth/authorization.service';
import { GradingService } from '../grading/grading.service';
import { DbService } from '../prisma/prisma-db-adapter';
import type { SaveQuestionDto } from './dto/questions.dto';

/** Menemukan `src` setiap `<img>` di dalam HTML soal maupun opsinya. */
const IMAGE_SRC_PATTERN = /<img[^>]+src=["']([^"']+)["']/g;

/**
 * Soal di dalam bank: menyimpan, menghapus, dan mengurutkan.
 *
 * Dipindahkan dari `apps/web/app/actions/question.ts`. Tiga catatan penting:
 *
 *  - Penghapusan berkas gambar TIDAK dikerjakan di sini. NestJS tidak pernah
 *    menyentuh penyimpanan; `remove` mengembalikan daftar URL gambar yang menjadi
 *    yatim, dan route handler Next.js — satu-satunya yang memegang kredensial
 *    R2 — yang menghapusnya.
 *  - Siaran realtime `supabase.channel(...).send(...)` yang dulu memberitahu
 *    siswa saat soal berubah di tengah ujian TIDAK ikut pindah: Supabase sudah
 *    tidak ada, dan penggantinya (SSE dari NestJS) belum dikerjakan. Daftar
 *    ujian aktif tetap dikembalikan supaya guru tetap diperingatkan sebelum
 *    menyimpan. Ini penurunan kemampuan yang disengaja, bukan kelalaian —
 *    dicatat di docs/MIGRASI_BACKEND.md.
 *  - Penilaian ulang dijalankan MENUNGGU selesai, bukan dilepas ke latar.
 *    Versi lama memanggilnya tanpa `await` di dalam server action; saat
 *    permintaannya berakhir, prosesnya bisa ikut terhenti di tengah, dan
 *    sebagian peserta tertinggal dengan nilai berdasarkan kunci jawaban lama.
 */
@Injectable()
export class QuestionsService {
    private readonly logger = new Logger(QuestionsService.name);

    constructor(
        private readonly db: DbService,
        private readonly authz: AuthorizationService,
        private readonly grading: GradingService,
    ) {}

    /**
     * Seluruh soal sebuah bank, dalam urutan yang dilihat guru di layar
     * penyusunan.
     */
    async listByBank(user: AuthUser, bankId: string) {
        await this.authz.assertBankAccess(user, bankId);

        const { data, error } = await this.db
            .from('cbt_bank_questions')
            .select(
                `*,
                 bank_question_options:cbt_bank_question_options(*),
                 stimulus:cbt_question_stimuli(*),
                 instruction:cbt_question_instructions(*),
                 dimension:cbt_question_dimensions(*),
                 kisi_kisi:cbt_question_kisi_kisi(*)`,
            )
            .eq('bank_id', bankId)
            .order('created_at', { ascending: true });

        if (error) {
            this.logger.error(`Gagal membaca soal bank ${bankId}: ${error.message}`);
            return [];
        }

        return ((data as any[]) || [])
            .map((question) => ({
                ...question,
                bank_question_options: dedupeOptions(question.bank_question_options || []),
            }))
            .sort(compareQuestions);
    }

    /**
     * Simpan satu soal beserta opsinya.
     *
     * Mengembalikan `activeExams`: ujian yang SEDANG berjalan memakai bank ini.
     * Layar penyusunan memakainya untuk memperingatkan bahwa perubahan menyentuh
     * ujian yang sedang dikerjakan orang.
     */
    async save(user: AuthUser, dto: SaveQuestionDto) {
        const organizationId = await this.authz.assertBankAccess(user, dto.bankId);

        const { data, error } = await this.db
            .from('cbt_bank_questions')
            .upsert({
                id: dto.id,
                bank_id: dto.bankId,
                // Organisasi dari banknya, bukan dari `orgId` kiriman klien —
                // yang pada mode admin platform bahkan berisi 'all'.
                organization_id: organizationId,
                type: dto.type,
                question_text: dto.questionText,
                difficulty: dto.difficulty,
                score_default: dto.scoreDefault,
                metadata: dto.metadata || {},
                stimulus_id: dto.stimulusId || null,
                instruction_id: dto.instructionId || null,
                dimension_id: dto.dimensionId || null,
                kisi_kisi_id: dto.kisi_kisi_id || null,
            })
            .select('id')
            .single();

        if (error) throw new BadRequestException(error.message);

        const questionId = (data as { id: string }).id;

        if (dto.options && dto.options.length > 0) {
            await this.replaceOptions(questionId, dto.options);
        }

        await this.touchBank(dto.bankId);

        // Hanya untuk soal yang DIUBAH. Soal baru belum pernah dijawab siapa pun,
        // jadi tidak ada yang perlu dinilai ulang.
        if (dto.id) {
            try {
                await this.grading.regradeExamAttemptsByQuestion(questionId);
            } catch (err) {
                // Soalnya sudah tersimpan; kegagalan penilaian ulang tidak boleh
                // membuat guru mengira suntingannya batal.
                this.logger.error(
                    `Penilaian ulang setelah menyimpan soal ${questionId} gagal: ${(err as Error).message}`,
                );
            }
        }

        return { id: questionId, activeExams: await this.activeExamsUsing(dto.bankId) };
    }

    /** Tambal satu kunci di `metadata` tanpa menyentuh kunci lainnya. */
    async updateMetadata(user: AuthUser, questionId: string, updates: Record<string, unknown>) {
        await this.authz.assertBankAccessByChild(user, 'cbt_bank_questions', questionId);

        const { data } = await this.db
            .from('cbt_bank_questions')
            .select('metadata, bank_id')
            .eq('id', questionId)
            .maybeSingle();

        if (!data) throw new NotFoundException('Soal tidak ditemukan.');

        const row = data as { metadata: Record<string, unknown> | null; bank_id: string };

        const { error } = await this.db
            .from('cbt_bank_questions')
            .update({ metadata: { ...(row.metadata || {}), ...updates } })
            .eq('id', questionId);

        if (error) throw new BadRequestException(error.message);

        await this.touchBank(row.bank_id);

        return { id: questionId };
    }

    /**
     * Hapus sebuah soal.
     *
     * Soal yang sudah pernah dijawab TIDAK dihapus, melainkan ditandai terhapus
     * di metadata: menghapusnya berarti menghapus jawaban siswa yang menunjuk
     * padanya. Penandanya digabungkan ke metadata yang ada, bukan menimpanya —
     * di sana tersimpan konfigurasi soal kompleks (kunci menjodohkan, urutan
     * benar, `order_index`) yang ikut musnah bila objeknya diganti.
     *
     * `orphanedImages` berisi URL gambar yang tidak lagi dirujuk siapa pun.
     * Penghapusan berkasnya dikerjakan pemanggil di sisi Next.js.
     */
    async remove(user: AuthUser, questionId: string, bankId: string) {
        await this.authz.assertBankAccess(user, bankId);

        // Penjagaan IDOR: pastikan soalnya memang milik bank yang barusan
        // diotorisasi. Tanpa ini, bankId milik sendiri bisa dipakai untuk
        // menghapus soal di bank guru lain.
        const { data: target } = await this.db
            .from('cbt_bank_questions')
            .select('id, question_text, metadata')
            .eq('id', questionId)
            .eq('bank_id', bankId)
            .maybeSingle();

        if (!target) throw new NotFoundException('Soal tidak ditemukan di bank soal ini.');

        const question = target as {
            question_text: string | null;
            metadata: Record<string, unknown> | null;
        };

        const { data: answered } = await this.db
            .from('cbt_exam_attempt_questions')
            .select('id')
            .eq('question_id', questionId)
            .limit(1);

        if (((answered as any[]) || []).length > 0) {
            await this.db
                .from('cbt_bank_questions')
                .update({
                    metadata: {
                        ...(question.metadata || {}),
                        _deleted: true,
                        _deleted_at: new Date().toISOString(),
                    },
                })
                .eq('id', questionId);

            await this.touchBank(bankId);

            return {
                id: questionId,
                softDeleted: true,
                orphanedImages: [] as string[],
                message:
                    'Soal sudah dipakai di jawaban ujian siswa, jadi ia disembunyikan dan ' +
                    'bukan dihapus — jawaban yang merujuk padanya tetap utuh.',
            };
        }

        const { data: options } = await this.db
            .from('cbt_bank_question_options')
            .select('option_text')
            .eq('question_id', questionId);

        const orphanedImages = extractImageUrls([
            question.question_text || '',
            ...((options as Array<{ option_text: string | null }>) || []).map(
                (o) => o.option_text || '',
            ),
        ]);

        // Opsinya lebih dulu: relasinya menunjuk ke soal.
        const { error: optionsError } = await this.db
            .from('cbt_bank_question_options')
            .delete()
            .eq('question_id', questionId);

        if (optionsError) {
            this.logger.warn(`Gagal menghapus opsi soal ${questionId}: ${optionsError.message}`);
        }

        const { error } = await this.db
            .from('cbt_bank_questions')
            .delete()
            .eq('id', questionId);

        if (error) throw new BadRequestException(error.message);

        await this.touchBank(bankId);

        return { id: questionId, softDeleted: false, orphanedImages };
    }

    /**
     * Simpan urutan soal yang disusun guru.
     *
     * Disimpan di `metadata.order_index` dan bukan di kolom tersendiri, supaya
     * urutannya bertahan tanpa perubahan skema. Id di luar bank diabaikan, tetapi
     * posisinya tetap dihitung agar urutan sisanya tidak bergeser.
     */
    async reorder(user: AuthUser, bankId: string, orderedIds: string[]) {
        await this.authz.assertBankAccess(user, bankId);

        const { data } = await this.db
            .from('cbt_bank_questions')
            .select('id, metadata')
            .eq('bank_id', bankId)
            .in('id', orderedIds);

        const owned = new Map<string, Record<string, unknown> | null>(
            ((data as Array<{ id: string; metadata: Record<string, unknown> | null }>) || []).map(
                (q) => [q.id, q.metadata],
            ),
        );

        let updated = 0;
        for (let index = 0; index < orderedIds.length; index++) {
            const id = orderedIds[index];
            if (!owned.has(id)) continue;

            await this.db
                .from('cbt_bank_questions')
                .update({ metadata: { ...(owned.get(id) || {}), order_index: index } })
                .eq('id', id);

            updated++;
        }

        await this.touchBank(bankId);

        return { bankId, updated };
    }

    // ── Pembantu ─────────────────────────────────────────────────────────────

    /**
     * Ganti seluruh opsi sebuah soal dengan daftar yang dikirim.
     *
     * Opsi yang dihapus guru di layar harus benar-benar hilang, jadi yang tidak
     * ada dalam daftar dibuang lebih dulu. Opsi dengan `id` dianggap sudah ada
     * dan diperbarui; yang tanpa `id` disisipkan baru.
     */
    private async replaceOptions(
        questionId: string,
        options: NonNullable<SaveQuestionDto['options']>,
    ): Promise<void> {
        // Opsi kembar (teks dan status benar yang sama) dibuang di sini, bukan
        // hanya saat ditampilkan: sumbernya biasanya salin-tempel berulang, dan
        // membiarkannya membuat soal punya dua jawaban benar yang identik.
        const seen = new Set<string>();
        const unique = options.filter((option) => {
            const text = (option.text || '').trim();
            if (text === '') return true; // opsi kosong sengaja dipertahankan
            const key = `${text}_${option.isCorrect}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });

        const rows = unique.map((option, index) => ({
            id: option.id,
            question_id: questionId,
            option_text: option.text,
            is_correct: option.isCorrect,
            order: index,
            weight: option.weight || 1,
            metadata: option.metadata || {},
        }));

        const existing = rows.filter((row) => row.id);
        const created = rows.filter((row) => !row.id).map(({ id, ...rest }) => rest);
        const keepIds = existing.map((row) => row.id as string);

        if (keepIds.length > 0) {
            await this.db
                .from('cbt_bank_question_options')
                .delete()
                .eq('question_id', questionId)
                .not('id', 'in', `(${keepIds.join(',')})`);
        } else {
            await this.db
                .from('cbt_bank_question_options')
                .delete()
                .eq('question_id', questionId);
        }

        if (created.length > 0) {
            const { error } = await this.db.from('cbt_bank_question_options').insert(created);
            if (error) throw new BadRequestException(error.message);
        }

        if (existing.length > 0) {
            const { error } = await this.db
                .from('cbt_bank_question_options')
                .upsert(existing, { onConflict: 'id' });
            if (error) throw new BadRequestException(error.message);
        }
    }

    /** Ujian yang sedang berjalan dan memakai bank ini. */
    private async activeExamsUsing(bankId: string) {
        const { data } = await this.db
            .from('cbt_exams')
            .select('id, title')
            .eq('question_bank_id', bankId)
            .eq('is_published', true)
            .eq('status', 'active');

        return (data as Array<{ id: string; title: string }>) || [];
    }

    /** Daftar bank soal diurutkan menurut perubahan terakhir. */
    private async touchBank(bankId: string): Promise<void> {
        await this.db
            .from('cbt_question_banks')
            .update({ updated_at: new Date().toISOString() })
            .eq('id', bankId);
    }
}

/**
 * Buang opsi kembar, lalu urutkan menurut `order`.
 *
 * Kembarnya berasal dari hasil join berlapis maupun dari salin-tempel guru.
 * Opsi berteks kosong dipertahankan: itu opsi yang memang belum diisi, dan
 * membuangnya membuat barisnya hilang dari layar penyuntingan.
 */
function dedupeOptions(options: any[]): any[] {
    const seen = new Set<string>();

    return options
        .filter((option) => {
            const text = (option.option_text || '').trim();
            if (text === '') return true;
            const key = `${text}_${option.is_correct}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        })
        .sort((a, b) => (a.order || 0) - (b.order || 0));
}

/**
 * Urutan soal di layar penyusunan: `metadata.order_index` bila ada, lalu
 * `created_at`, lalu `id`.
 *
 * Pemutus terakhir berdasarkan id itu bukan hiasan: soal hasil impor massal
 * berbagi `created_at` yang sama persis, dan tanpa pemutus yang pasti, menyimpan
 * satu soal bisa mengacak nomor soal lainnya.
 */
function compareQuestions(a: any, b: any): number {
    const orderA = a.metadata?.order_index;
    const orderB = b.metadata?.order_index;

    if (orderA !== undefined && orderB !== undefined) {
        if (orderA !== orderB) return orderA - orderB;
    } else if (orderA !== undefined) {
        return -1;
    } else if (orderB !== undefined) {
        return 1;
    }

    const timeA = a.created_at ? new Date(a.created_at).getTime() : 0;
    const timeB = b.created_at ? new Date(b.created_at).getTime() : 0;
    if (timeA !== timeB) return timeA - timeB;

    return String(a.id).localeCompare(String(b.id));
}

/** Kumpulkan URL gambar unik dari sekumpulan potongan HTML. */
function extractImageUrls(htmlChunks: string[]): string[] {
    const urls = new Set<string>();

    for (const html of htmlChunks) {
        if (!html) continue;
        // `exec` berulang memakai `lastIndex` bersama, jadi regexnya direset
        // untuk tiap potongan.
        IMAGE_SRC_PATTERN.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = IMAGE_SRC_PATTERN.exec(html)) !== null) {
            if (match[1]) urls.add(match[1]);
        }
    }

    return [...urls];
}
