import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { AuthUser } from '@acca-cbt/shared';
import { AuthorizationService } from '../auth/authorization.service';
import { GradingService } from '../grading/grading.service';
import { insertIdempotentlyWithStatus } from '../common/idempotent-create';
import { DbService, type DbSession } from '../prisma/prisma-db-adapter';
import type { SaveQuestionDto } from './dto/questions.dto';


/** Saves and deletes question content atomically. Media is retained because HTML
 * cannot prove ownership or exclusive use of an attachment. */
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
            .filter(question => !question.metadata?._deleted)
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

        // Begitu ada attempt, komposisi bank adalah bagian dari bukti ujian.
        // Menambah soal baru sama merusaknya dengan mengubah soal lama: review
        // historis akan memperoleh penyebut dan nomor soal yang berbeda.
        if (await this.bankHasAttempts(dto.bankId)) {
            throw new ConflictException(
                'Bank soal sudah dipakai dalam pengerjaan ujian dan tidak dapat diubah. ' +
                'Buat bank baru untuk perubahan berikutnya.',
            );
        }

        if (dto.id) {
            const { data: existing, error } = await this.db.from('cbt_bank_questions')
                .select('id').eq('id', dto.id).eq('bank_id', dto.bankId).maybeSingle();
            if (error) throw new BadRequestException(error.message);
            if (!existing) throw new NotFoundException('Soal tidak ditemukan di bank soal ini.');
            if (await this.questionHasHistoricalUse(dto.id, dto.bankId)) {
                throw new ConflictException(
                    'Soal sudah dipakai dalam pengerjaan ujian dan tidak dapat diubah. ' +
                    'Buat soal tersebut pada bank baru untuk versi berikutnya.',
                );
            }
        }
        // Validate every supplied option ID before changing the question or deleting options.
        const optionIds = (dto.options || []).flatMap(option => option.id ? [option.id] : []);
        if (optionIds.length) {
            if (!dto.id || new Set(optionIds).size !== optionIds.length) {
                throw new BadRequestException('ID opsi lama tidak valid.');
            }
            const { data: ownedOptions, error } = await this.db.from('cbt_bank_question_options')
                .select('id').eq('question_id', dto.id).in('id', optionIds);
            if (error) throw new BadRequestException(error.message);
            if ((ownedOptions || []).length !== optionIds.length) {
                throw new BadRequestException('Opsi tidak ditemukan pada soal ini.');
            }
        }

        for (const [id, table] of [
            [dto.stimulusId, 'cbt_question_stimuli'],
            [dto.instructionId, 'cbt_question_instructions'],
            [dto.dimensionId, 'cbt_question_dimensions'],
            [dto.kisi_kisi_id, 'cbt_question_kisi_kisi'],
        ]) {
            if (!id) continue;
            const { data: related, error } = await this.db.from(table!)
                .select('id').eq('id', id).eq('bank_id', dto.bankId).maybeSingle();
            if (error) throw new BadRequestException(error.message);
            if (!related) throw new BadRequestException('Referensi soal harus berasal dari bank yang sama.');
        }

        const payload = {
                bank_id: dto.bankId,
                // Organisasi selalu diambil dari banknya, bukan dipercaya dari
                // parameter tambahan kiriman klien.
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
            };
        const saved = await this.db.transaction(async db => {
            let questionId: string;

            if (dto.id) {
                await db.raw(
                    'SELECT id FROM public.cbt_bank_questions WHERE id = $1::uuid FOR UPDATE',
                    dto.id,
                );
                const { data: current, error: currentError } = await db
                    .from('cbt_bank_questions')
                    .select('id, revision')
                    .eq('id', dto.id)
                    .eq('bank_id', dto.bankId)
                    .maybeSingle();
                if (currentError) throw new BadRequestException(currentError.message);
                if (!current) throw new NotFoundException('Soal tidak ditemukan di bank soal ini.');
                const currentRevision = (current as { revision: number }).revision;
                if (currentRevision !== dto.expectedRevision) {
                    throw new ConflictException(
                        'Soal telah diubah dari halaman atau tab lain. Muat ulang sebelum menyimpan lagi.',
                    );
                }
                const { data, error } = await db.from('cbt_bank_questions')
                    .update({ ...payload, revision: currentRevision + 1 })
                    .eq('id', dto.id).eq('bank_id', dto.bankId)
                    .select('id').single();
                if (error) throw new BadRequestException(error.message);
                questionId = (data as { id: string }).id;
            } else {
                // Constraint error di dalam transaksi PostgreSQL membuat
                // transaksi aborted. Advisory lock menyerialkan request dengan
                // kunci sama sehingga retry kedua menemukan baris lama sebelum
                // mencoba insert.
                await db.raw(
                    'SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))',
                    `question:${dto.bankId}:${dto.clientRequestId}`,
                );
                const inserted = await insertIdempotentlyWithStatus<{ id: string }>(db, {
                    table: 'cbt_bank_questions',
                    scope: { column: 'bank_id', value: dto.bankId },
                    clientRequestId: dto.clientRequestId!,
                    fingerprint: dto,
                    payload,
                    select: 'id',
                });
                questionId = inserted.data.id;
                if (inserted.replayed) return { questionId, replayed: true };
            }

            if (dto.options !== undefined) {
                await this.replaceOptions(questionId, dto.options, db);
            }
            await this.touchBank(dto.bankId, db);
            return { questionId, replayed: false };
        });

        const questionId = saved.questionId;

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

        if (await this.questionHasHistoricalUse(questionId, row.bank_id)) {
            throw new ConflictException(
                'Metadata soal sudah dipakai dalam pengerjaan ujian dan tidak dapat diubah.',
            );
        }

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
     * Berkas gambar dipertahankan; URL dalam HTML bukan bukti kepemilikan.
     */
    async remove(user: AuthUser, questionId: string, bankId: string) {
        await this.authz.assertBankAccess(user, bankId);

        return this.db.transaction(async db => {
            await db.raw('SELECT id FROM public.cbt_bank_questions WHERE id = $1::uuid FOR UPDATE', questionId);
            // Penjagaan IDOR: pastikan soalnya memang milik bank yang barusan
            // diotorisasi. Tanpa ini, bankId milik sendiri bisa dipakai untuk
            // menghapus soal di bank guru lain.
            const { data: target } = await db
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

            // `cbt_answers` adalah relasi yang benar-benar ditulis oleh alur ujian.
            // Tabel snapshot lama dipertahankan sebagai lapisan kompatibilitas,
            // tetapi tidak boleh lagi menjadi satu-satunya bukti pemakaian.
            const historicallyUsed = await this.questionHasHistoricalUse(questionId, bankId, db);

            if (historicallyUsed) {
                const { error } = await db
                    .from('cbt_bank_questions')
                    .update({
                        metadata: {
                            ...(question.metadata || {}),
                            _deleted: true,
                            _deleted_at: new Date().toISOString(),
                        },
                    })
                    .eq('id', questionId);

                if (error) throw new BadRequestException(error.message);
                await this.touchBank(bankId, db);

                return {
                    id: questionId,
                    softDeleted: true,
                    orphanedImages: [] as string[],
                    message:
                        'Soal sudah dipakai di jawaban ujian siswa, jadi ia disembunyikan dan ' +
                        'bukan dihapus — jawaban yang merujuk padanya tetap utuh.',
                };
            }

            // Opsinya lebih dulu: relasinya menunjuk ke soal.
            const { error: optionsError } = await db
                .from('cbt_bank_question_options')
                .delete()
                .eq('question_id', questionId);

            if (optionsError) {
                throw new BadRequestException(optionsError.message);
            }

            const { error } = await db
                .from('cbt_bank_questions')
                .delete()
                .eq('id', questionId);

            if (error) throw new BadRequestException(error.message);

            await this.touchBank(bankId, db);

            return { id: questionId, softDeleted: false, orphanedImages: [] as string[] };
        });
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

        if (await this.bankHasAttempts(bankId)) {
            throw new ConflictException(
                'Urutan bank tidak dapat diubah setelah ada peserta yang mulai mengerjakan. ' +
                'Buat bank baru untuk susunan berikutnya.',
            );
        }

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
        db: DbSession = this.db,
    ): Promise<void> {
        // Identical text may legitimately have different weights or dimensions.
        const unique = options;

        const rows = unique.map((option, index) => ({
            id: option.id,
            question_id: questionId,
            option_text: option.text,
            is_correct: option.isCorrect,
            order: index,
            weight: option.weight ?? 1,
            metadata: option.metadata || {},
        }));

        const existing = rows.filter((row) => row.id);
        const created = rows.filter((row) => !row.id).map(({ id, ...rest }) => rest);
        const keepIds = existing.map((row) => row.id as string);

        if (keepIds.length > 0) {
            const { error } = await db
                .from('cbt_bank_question_options')
                .delete()
                .eq('question_id', questionId)
                .not('id', 'in', `(${keepIds.join(',')})`);
            if (error) throw new BadRequestException(error.message);
        } else {
            const { error } = await db
                .from('cbt_bank_question_options')
                .delete()
                .eq('question_id', questionId);
            if (error) throw new BadRequestException(error.message);
        }

        if (created.length > 0) {
            const { error } = await db.from('cbt_bank_question_options').insert(created);
            if (error) throw new BadRequestException(error.message);
        }

        if (existing.length > 0) {
            const { error } = await db
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

    /**
     * Apakah soal/bank sudah menjadi bagian dari pengerjaan nyata.
     *
     * Jawaban langsung adalah bukti terkuat. Pemeriksaan attempt pada bank juga
     * melindungi soal yang dilewati/tidak dijawab agar penyebut nilai dan urutan
     * review historis tidak berubah setelah ujian berlangsung.
     */
    private async questionHasHistoricalUse(
        questionId: string,
        bankId: string,
        db: DbSession = this.db,
    ): Promise<boolean> {
        const { data: answers, error: answerError } = await db
            .from('cbt_answers')
            .select('id')
            .eq('question_id', questionId)
            .limit(1);
        if (answerError) throw new BadRequestException(answerError.message);
        if (((answers as any[]) || []).length > 0) return true;

        // Data impor/versi lama mungkin memang memiliki snapshot ini.
        const { data: snapshots, error: snapshotError } = await db
            .from('cbt_exam_attempt_questions')
            .select('id')
            .eq('question_id', questionId)
            .limit(1);
        if (snapshotError) throw new BadRequestException(snapshotError.message);
        if (((snapshots as any[]) || []).length > 0) return true;

        return this.bankHasAttempts(bankId, db);
    }

    private async bankHasAttempts(bankId: string, db: DbSession = this.db): Promise<boolean> {
        const { data: direct, error: directError } = await db
            .from('cbt_exams')
            .select('id')
            .eq('question_bank_id', bankId);
        if (directError) throw new BadRequestException(directError.message);

        const { data: sources, error: sourceError } = await db
            .from('cbt_exam_question_sources')
            .select('exam_id')
            .eq('bank_id', bankId);
        if (sourceError) throw new BadRequestException(sourceError.message);

        const examIds = [...new Set([
            ...(((direct as Array<{ id: string }>) || []).map(row => row.id)),
            ...(((sources as Array<{ exam_id: string }>) || []).map(row => row.exam_id)),
        ])];
        if (examIds.length === 0) return false;

        const { data: attempts, error: attemptError } = await db
            .from('cbt_exam_attempts')
            .select('id')
            .in('exam_id', examIds)
            .limit(1);
        if (attemptError) throw new BadRequestException(attemptError.message);

        return ((attempts as any[]) || []).length > 0;
    }

    /** Daftar bank soal diurutkan menurut perubahan terakhir. */
    private async touchBank(bankId: string, db: DbSession = this.db): Promise<void> {
        const { error } = await db
            .from('cbt_question_banks')
            .update({ updated_at: new Date().toISOString() })
            .eq('id', bankId);
        if (error) throw new BadRequestException(error.message);
    }
}

/**
 * Remove duplicate join rows by ID, never by text or answer value.
 *
 */
function dedupeOptions(options: any[]): any[] {
    const seen = new Set<string>();

    return options
        .filter((option) => {
            if (!option.id) return true;
            const key = option.id;
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

