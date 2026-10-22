import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { AuthUser } from '@acca-cbt/shared';
import { AuthorizationService } from '../auth/authorization.service';
import { GradingService } from '../grading/grading.service';
import { insertIdempotentlyWithStatus } from '../common/idempotent-create';
import { advisoryTransactionLock } from '../common/transaction-lock';
import { syncLiveExamQuestion } from '../common/live-exam-question-updates';
import { compareQuestions } from '../common/bank-question-order';
import { dedupeOptions } from '../common/question-options';
import { DbService, type DbSession } from '../prisma/prisma-db-adapter';
import type { SaveQuestionDto } from './dto/questions.dto';


/** Saves and deletes question content atomically. Media is retained because HTML
 * cannot prove ownership or exclusive use of an attachment. */
/**
 * Pemeriksaan struktur minimum per tipe soal, sama dengan yang dicek editor.
 * Klien lain (atau editor lama) tidak boleh menyimpan soal yang tidak mungkin
 * dinilai, misalnya pilihan ganda tanpa kunci benar.
 */
export function assertQuestionStructure(dto: Pick<SaveQuestionDto, 'type' | 'options' | 'metadata'>): void {
    const options = dto.options;
    if (options === undefined) return; // opsi lama dipertahankan
    const fail = (message: string): never => { throw new BadRequestException(message); };
    switch (dto.type) {
        case 'mcq':
        case 'mcq_complex':
            if (options.length < 2) fail('Soal pilihan ganda membutuhkan minimal 2 opsi.');
            if (!options.some(option => option.isCorrect)) fail('Pilih minimal satu jawaban yang benar.');
            break;
        case 'true_false':
            if (!options.length) fail('Soal benar/salah membutuhkan minimal satu pernyataan.');
            break;
        case 'matching':
            if (!options.length) fail('Soal menjodohkan membutuhkan minimal satu pasangan.');
            if (options.some(option => !Array.isArray(option.metadata?.match_texts) || !option.metadata!.match_texts.some((text: unknown) => typeof text === 'string' && text.trim()))) {
                fail('Setiap item kiri harus dipasangkan dengan jawaban.');
            }
            break;
        case 'categorization':
            if (!options.length) fail('Soal pengelompokan membutuhkan minimal satu item.');
            if (options.some(option => !Array.isArray(option.metadata?.category_names) || !option.metadata!.category_names.some((name: unknown) => typeof name === 'string' && name.trim()))) {
                fail('Pilih kategori untuk setiap item.');
            }
            break;
        case 'ordering':
            if (options.length < 2) fail('Soal mengurutkan membutuhkan minimal 2 item.');
            break;
        default:
            break;
    }
}

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
        await this.authz.assertBankAccess(user, bankId, 'read');

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
     * Revisi diteruskan ke ujian yang belum selesai; arsip tetap memakai versi lamanya.
     */
    async save(user: AuthUser, dto: SaveQuestionDto) {
        const organizationId = await this.authz.assertBankAccess(user, dto.bankId);
        assertQuestionStructure(dto);

        // Menambah soal baru pada bank yang sudah memiliki attempt tidak diizinkan
        // karena akan mengubah jumlah butir dan urutan ujian yang sedang berjalan.
        if (!dto.id && await this.bankHasAttempts(dto.bankId)) {
            throw new ConflictException(
                'Bank soal sudah dipakai dalam pengerjaan ujian dan tidak dapat menambah butir baru. ' +
                'Buat bank baru untuk penambahan butir.',
            );
        }

        if (dto.id) {
            const { data: existing, error } = await this.db.from('cbt_bank_questions')
                .select('id').eq('id', dto.id).eq('bank_id', dto.bankId).maybeSingle();
            if (error) throw new BadRequestException(error.message);
            if (!existing) throw new NotFoundException('Soal tidak ditemukan di bank soal ini.');
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
                score_default: dto.scoreDefault,
                metadata: dto.metadata || {},
                stimulus_id: dto.stimulusId || null,
                instruction_id: dto.instructionId || null,
                dimension_id: dto.dimensionId || null,
            } as Record<string, unknown>;
        // Kolom yang tidak dikirim klien tidak boleh ditimpa saat menyunting.
        // Editor lama selalu mengirim difficulty "medium" dan tidak pernah
        // mengirim kisi_kisi_id, sehingga setiap suntingan mereset tingkat
        // kesulitan dan memutus tautan kisi-kisi hasil impor.
        if (dto.difficulty !== undefined || !dto.id) payload.difficulty = dto.difficulty ?? 'medium';
        if (dto.kisi_kisi_id !== undefined || !dto.id) payload.kisi_kisi_id = dto.kisi_kisi_id || null;
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
                await advisoryTransactionLock(
                    db,
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
            const updatedExams = dto.id
                ? await syncLiveExamQuestion(db, questionId, organizationId, user.id) : 0;
            return { questionId, replayed: false, updatedExams };
        });

        const questionId = saved.questionId;

        return { id: questionId, activeExams: await this.activeExamsUsing(dto.bankId),
            updatedExams: saved.updatedExams || 0 };
    }

    /** Tambal satu kunci di `metadata` tanpa menyentuh kunci lainnya. */
    async updateMetadata(
        user: AuthUser,
        questionId: string,
        updates: Record<string, unknown>,
        expectedRevision?: number,
    ) {
        await this.authz.assertBankAccessByChild(user, 'cbt_bank_questions', questionId);

        return this.db.transaction(async db => {
            await db.raw(
                'SELECT id FROM public.cbt_bank_questions WHERE id = $1::uuid FOR UPDATE',
                questionId,
            );

            const { data, error: readError } = await db
                .from('cbt_bank_questions')
                .select('metadata, bank_id, revision')
                .eq('id', questionId)
                .maybeSingle();

            if (readError) throw new BadRequestException(readError.message);
            if (!data) throw new NotFoundException('Soal tidak ditemukan.');

            const row = data as {
                metadata: Record<string, unknown> | null;
                bank_id: string;
                revision?: number;
            };

            const currentRevision = Number(row.revision) || 1;
            if (expectedRevision !== undefined && currentRevision !== expectedRevision) {
                throw new ConflictException(
                    'Soal telah diubah dari halaman atau tab lain. Muat ulang sebelum menyimpan lagi.',
                );
            }

            // Disengaja berbeda dari simpan penuh: endpoint ini dipakai untuk
            // metadata urutan/pengelompokan (order_index, group_key) yang
            // menentukan urutan review historis, sehingga dikunci setelah dipakai.
            if (await this.questionHasHistoricalUse(questionId, row.bank_id, db)) {
                throw new ConflictException(
                    'Metadata soal sudah dipakai dalam pengerjaan ujian dan tidak dapat diubah.',
                );
            }

            const nextRevision = currentRevision + 1;
            const { error } = await db
                .from('cbt_bank_questions')
                .update({
                    metadata: { ...(row.metadata || {}), ...updates },
                    revision: nextRevision,
                })
                .eq('id', questionId);

            if (error) throw new BadRequestException(error.message);

            await this.touchBank(row.bank_id, db);

            return { id: questionId, revision: nextRevision };
        });
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

        return this.db.transaction(async db => {
            // Match the editor lock order, then read metadata after concurrent edits finish.
            for (const id of [...new Set(orderedIds)].sort()) {
                await db.raw('SELECT id FROM public.cbt_bank_questions WHERE id = $1::uuid AND bank_id = $2::uuid FOR UPDATE', id, bankId);
            }
            const { data, error: readError } = await db
                .from('cbt_bank_questions')
                .select('id, metadata, revision')
                .eq('bank_id', bankId)
                .in('id', orderedIds);

            if (readError) {
                throw new BadRequestException(`Gagal membaca soal: ${readError.message}`);
            }

            const owned = new Map<string, { metadata: Record<string, unknown> | null; revision: number }>(
                ((data as Array<{ id: string; metadata: Record<string, unknown> | null; revision?: number }>) || []).map(
                    (q) => [q.id, { metadata: q.metadata, revision: Number(q.revision) || 1 }],
                ),
            );

            let updated = 0;
            for (let index = 0; index < orderedIds.length; index++) {
                const id = orderedIds[index];
                const current = owned.get(id);
                if (!current) continue;

                const nextRevision = current.revision + 1;
                const { error: updateError } = await db
                    .from('cbt_bank_questions')
                    .update({
                        metadata: { ...(current.metadata || {}), order_index: index },
                        revision: nextRevision,
                    })
                    .eq('id', id)
                    .eq('bank_id', bankId);

                if (updateError) {
                    throw new BadRequestException(`Gagal memperbarui urutan soal ${id}: ${updateError.message}`);
                }

                updated++;
            }

            await this.touchBank(bankId, db);

            return { bankId, updated };
        });
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

        // Snapshots can reference options that no student has selected yet, so
        // the answer FK alone cannot protect them. The question row is already
        // locked by save(); snapshot creation holds a shared lock on the same row.
        const { data: snapshots, error: snapshotError } = await db.from('cbt_exam_question_snapshots')
            .select('question_snapshot').eq('question_id', questionId);
        if (snapshotError) throw new BadRequestException('Pemakaian opsi ujian belum dapat diperiksa.');
        const protectedIds = new Set<string>((snapshots || []).flatMap((row: any) =>
            (row.question_snapshot?.bank_question_options || []).map((option: any) => option.id)));
        if ([...protectedIds].some(id => !keepIds.includes(id))) {
            throw new ConflictException('Opsi sudah dipakai dalam snapshot ujian dan tidak dapat dihapus. Salin soal ke bank baru untuk mengganti pilihan.');
        }

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

        const { data: frozen, error: frozenError } = await db.from('cbt_exam_question_snapshots')
            .select('id').eq('question_id', questionId).limit(1);
        if (frozenError) throw new BadRequestException('Snapshot soal belum dapat diperiksa.');
        if ((frozen || []).length > 0) return true;

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
