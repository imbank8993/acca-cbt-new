import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { AuthUser } from '@acca-cbt/shared';
import { AuthorizationService } from '../auth/authorization.service';
import { randomUUID } from 'node:crypto';
import { DbService, type DbSession } from '../prisma/prisma-db-adapter';
import type { BulkQuestionDto } from './dto/bulk-import.dto';

export interface BulkImportResult {
    success: boolean;
    imported: number;
    failed: number;
    errors: { index: number; message: string }[];
    questionIds: string[];
}

/** Judul stimulus/petunjuk dipotong agar muat di daftar; isinya tetap utuh. */
const TITLE_MAX_LENGTH = 60;

/** Atomic question-bank import. Ownership is checked before any write; all
 * companion content, new option identifiers, keys and question rows commit together. */
@Injectable()
export class ImportsService {
    private readonly logger = new Logger(ImportsService.name);

    constructor(
        private readonly db: DbService,
        private readonly authz: AuthorizationService,
    ) {}

    /**
     * Izin impor ke satu bank soal. Dipakai `bulkImport` dan, terpisah, oleh
     * route handler Next.js sebelum ia mengunggah berkas persamaan.
     */
    async assertCanImport(user: AuthUser, bankId: string): Promise<void> {
        await this.authz.assertBankAccess(user, bankId);

        const [{ data: direct, error: directError }, { data: sources, error: sourceError }] =
            await Promise.all([
                this.db.from('cbt_exams').select('id').eq('question_bank_id', bankId),
                this.db.from('cbt_exam_question_sources').select('exam_id').eq('bank_id', bankId),
            ]);
        if (directError) throw new BadRequestException(directError.message);
        if (sourceError) throw new BadRequestException(sourceError.message);

        const examIds = [...new Set([
            ...(((direct as Array<{ id: string }>) || []).map(row => row.id)),
            ...(((sources as Array<{ exam_id: string }>) || []).map(row => row.exam_id)),
        ])];
        if (examIds.length === 0) return;

        const { data: attempts, error: attemptError } = await this.db
            .from('cbt_exam_attempts')
            .select('id')
            .in('exam_id', examIds)
            .limit(1);
        if (attemptError) throw new BadRequestException(attemptError.message);
        if (((attempts as any[]) || []).length > 0) {
            throw new ConflictException(
                'Bank soal sudah dipakai dalam pengerjaan ujian dan tidak dapat diimpor ulang. ' +
                'Buat bank baru untuk hasil impor berikutnya.',
            );
        }
    }

    async bulkImport(
        user: AuthUser,
        bankId: string,
        questions: BulkQuestionDto[],
    ): Promise<BulkImportResult> {
        await this.assertCanImport(user, bankId);

        const { data: bank } = await this.db
            .from('cbt_question_banks')
            .select('organization_id')
            .eq('id', bankId)
            .maybeSingle();

        if (!bank) throw new NotFoundException('Bank soal tidak ditemukan.');
        const organizationId = (bank as { organization_id: string }).organization_id;

        // One transaction includes companion records, questions and every option.
        // No partial success: a failed row rolls back the entire selected import.
        return this.db.transaction(async db => {
            const context: ImportContext = {
                db, bankId, organizationId,
                stimuli: new Map(), instructions: new Map(), kisiKisi: new Map(), dimensions: new Map(),
            };
            // Semua soal pada satu bulk import dapat memperoleh created_at yang
            // identik. Tanpa order_index, fallback UUID membuat urutannya acak
            // dan nomor soal tampak bertukar bersama stimulus/petunjuknya.
            // Normalisasi soal lama terlebih dahulu, lalu tambahkan hasil impor
            // tepat dalam urutan array hasil parser/template.
            const { data: existingQuestions, error: existingError } = await db
                .from('cbt_bank_questions')
                .select('id, metadata, created_at')
                .eq('bank_id', bankId)
                .order('created_at', { ascending: true });
            if (existingError) throw new BadRequestException(existingError.message);

            const activeExisting = ((existingQuestions as ExistingQuestionOrder[]) || [])
                .filter(question => !question.metadata?._deleted)
                .sort(compareExistingQuestionOrder);
            for (const [orderIndex, existing] of activeExisting.entries()) {
                const { error } = await db.from('cbt_bank_questions')
                    .update({ metadata: { ...(existing.metadata || {}), order_index: orderIndex } })
                    .eq('id', existing.id)
                    .eq('bank_id', bankId);
                if (error) throw new BadRequestException(error.message);
            }

            const questionIds: string[] = [];
            for (const [index, question] of questions.entries()) {
                if (!question.question_text?.trim()) {
                    throw new BadRequestException(`Baris ${index + 1}: teks soal kosong.`);
                }
                const type = question.type || 'mcq';
                const suppliedOptions = question.options || [];
                const correctCount = suppliedOptions.filter(o => o.is_correct).length;
                const invalidOptions =
                    (['mcq', 'mcq_complex', 'sjt', 'ordering', 'forced_choice', 'ranking', 'paired_comparison'].includes(type) && suppliedOptions.length < 2) ||
                    (type === 'mcq' && correctCount !== 1) ||
                    (type === 'mcq_complex' && correctCount < 1) ||
                    (['true_false', 'matching', 'categorization', 'checklist'].includes(type) && !suppliedOptions.length) ||
                    (type === 'matching' && suppliedOptions.some(o => !Array.isArray(o.metadata?.match_texts))) ||
                    (type === 'categorization' && suppliedOptions.some(o => !Array.isArray(o.metadata?.category_names))) ||
                    (type === 'short_answer' && !question.metadata?.blanks?.length);
                if (invalidOptions) throw new BadRequestException(`Baris ${index + 1}: opsi atau kunci jawaban belum lengkap.`);
                const questionId = randomUUID();
                const optionRows: Array<{ id: string; question_id: string; option_text: string;
                    is_correct: boolean; order: number; weight: number; metadata: Record<string, any> }> = [];
                for (const [order, option] of (question.options || []).entries()) {
                    const metadata = { ...(option.metadata || {}) };
                    // Never retain foreign-bank dimension identifiers on copies.
                    delete metadata.dimension_id;
                    if (metadata.dimension) {
                        metadata.dimension_id = await this.resolveDimension(context, String(metadata.dimension));
                    }
                    optionRows.push({
                        id: randomUUID(), question_id: questionId, option_text: option.option_text,
                        is_correct: option.is_correct ?? false, order,
                        weight: option.weight ?? (option.is_correct ? 1 : 0), metadata,
                    });
                }
                const metadata = { ...(question.metadata || {}) };
                delete metadata._deleted;
                delete metadata._deleted_at;
                delete metadata.order_index;
                metadata.order_index = activeExisting.length + index;
                if (question.type === 'ordering') {
                    const supplied = metadata.correct_order || optionRows.map((_, i) => String(i + 1));
                    const indexes = supplied.map((key: unknown) => {
                        const text = String(key).trim();
                        return /^[A-Z]$/i.test(text) ? text.toUpperCase().charCodeAt(0) - 65 : Number(text) - 1;
                    });
                    if (indexes.length !== optionRows.length || new Set(indexes).size !== optionRows.length ||
                        indexes.some((i: number) => !Number.isInteger(i) || !optionRows[i])) {
                        throw new BadRequestException(`Baris ${index + 1}: urutan kunci tidak sesuai opsi.`);
                    }
                    metadata.correct_order = indexes.map((i: number) => optionRows[i].id);
                }
                const { error } = await db.from('cbt_bank_questions').insert({
                    id: questionId, bank_id: bankId, organization_id: organizationId,
                    type: question.type || 'mcq', question_text: question.question_text.trim(),
                    difficulty: question.difficulty || 'medium', score_default: question.score_default ?? 1,
                    metadata,
                    stimulus_id: await this.resolveStimulus(context, question),
                    instruction_id: await this.resolveInstruction(context, question),
                    kisi_kisi_id: await this.resolveKisiKisi(context, question),
                    dimension_id: metadata.dimension ? await this.resolveDimension(context, metadata.dimension) : null,
                });
                if (error) throw new BadRequestException(`Baris ${index + 1}: ${error.message}`);
                if (optionRows.length) {
                    const { error } = await db.from('cbt_bank_question_options').insert(optionRows);
                    if (error) throw new BadRequestException(`Baris ${index + 1}: gagal menyimpan opsi: ${error.message}`);
                }
                questionIds.push(questionId);
            }
            const { error } = await db.from('cbt_question_banks')
                .update({ updated_at: new Date().toISOString() }).eq('id', bankId);
            if (error) throw new BadRequestException(error.message);
            return { success: true, imported: questionIds.length, failed: 0, errors: [], questionIds };
        });
    }

    // ── Entitas pendamping ───────────────────────────────────────────────────
    // Ketiganya dipakai bersama oleh banyak soal dalam satu berkas impor, jadi
    // hasilnya dicache per pemanggilan agar satu stimulus tidak dibuat puluhan
    // kali untuk soal-soal yang merujuk stimulus yang sama.

    private async resolveStimulus(
        context: ImportContext,
        question: BulkQuestionDto,
    ): Promise<string | null> {
        const content = question.metadata?.import_stimulus;
        if (!content) return null;

        const title = this.buildTitle(
            question.metadata?.stimulus_title || content,
            `Stimulus ${question.metadata?._stimulus_code || ''}`,
        );
        const cacheKey = JSON.stringify([title, content]);

        return this.findOrCreate(context.stimuli, cacheKey, async () => {
            const { data: existing, error: readError } = await context.db
                .from('cbt_question_stimuli')
                .select('id')
                .eq('bank_id', context.bankId)
                .eq('title', title).eq('content', content)
                .limit(1);

            if (readError) throw new BadRequestException(readError.message);
            const found = ((existing as Array<{ id: string }>) || [])[0];
            if (found) return found.id;

            const { data: created, error: createError } = await context.db
                .from('cbt_question_stimuli')
                .insert({
                    organization_id: context.organizationId,
                    bank_id: context.bankId,
                    title,
                    content,
                })
                .select('id')
                .maybeSingle();

            if (createError) throw new BadRequestException(createError.message);
            return (created as { id: string } | null)?.id ?? null;
        });
    }

    private async resolveInstruction(
        context: ImportContext,
        question: BulkQuestionDto,
    ): Promise<string | null> {
        const content = question.metadata?.import_instruction;
        if (!content) return null;

        const title = this.buildTitle(
            question.metadata?.instruction_title || content,
            `Petunjuk ${question.metadata?._instruction_code || ''}`,
        );
        const cacheKey = JSON.stringify([title, content]);

        return this.findOrCreate(context.instructions, cacheKey, async () => {
            const { data: existing, error: readError } = await context.db
                .from('cbt_question_instructions')
                .select('id')
                .eq('bank_id', context.bankId)
                .eq('title', title).eq('content', content)
                .limit(1);

            if (readError) throw new BadRequestException(readError.message);
            const found = ((existing as Array<{ id: string }>) || [])[0];
            if (found) return found.id;

            const { data: created, error: createError } = await context.db
                .from('cbt_question_instructions')
                .insert({
                    organization_id: context.organizationId,
                    bank_id: context.bankId,
                    title,
                    content,
                })
                .select('id')
                .maybeSingle();

            if (createError) throw new BadRequestException(createError.message);
            return (created as { id: string } | null)?.id ?? null;
        });
    }

    private async resolveKisiKisi(
        context: ImportContext,
        question: BulkQuestionDto,
    ): Promise<string | null> {
        const kisi = question.metadata?.kisi_kisi_data;
        const nomorKd = kisi?.nomor_kd ? String(kisi.nomor_kd).trim() : '';
        if (!nomorKd) return null;

        return this.findOrCreate(context.kisiKisi, nomorKd.toLowerCase(), async () => {
            const { data: existing, error: readError } = await context.db
                .from('cbt_question_kisi_kisi')
                .select('id')
                .eq('bank_id', context.bankId)
                .eq('nomor_kd', nomorKd)
                .limit(1);

            if (readError) throw new BadRequestException(readError.message);
            const found = ((existing as Array<{ id: string }>) || [])[0];
            if (found) return found.id;

            const { data: created, error: createError } = await context.db
                .from('cbt_question_kisi_kisi')
                .insert({
                    organization_id: context.organizationId,
                    bank_id: context.bankId,
                    nomor_kd: nomorKd,
                    kd_cp: kisi.kd_cp || '',
                    materi: kisi.materi || '',
                    indikator_soal: kisi.indikator_soal || '',
                    level_kognitif: kisi.level_kognitif || '',
                })
                .select('id')
                .maybeSingle();

            if (createError) throw new BadRequestException(createError.message);
            return (created as { id: string } | null)?.id ?? null;
        });
    }

    private async resolveDimension(
        context: ImportContext,
        rawName: string,
    ): Promise<string | null> {
        const name = String(rawName).trim();
        if (!name) return null;

        return this.findOrCreate(context.dimensions, name.toLowerCase(), async () => {
            const { data: existing, error: readError } = await context.db
                .from('cbt_question_dimensions')
                .select('id')
                .eq('bank_id', context.bankId)
                .ilike('name', name)
                .maybeSingle();

            if (readError) throw new BadRequestException(readError.message);
            if (existing) return (existing as { id: string }).id;

            const { data: created, error: createError } = await context.db
                .from('cbt_question_dimensions')
                .insert({ bank_id: context.bankId, name, description: '' })
                .select('id')
                .maybeSingle();

            if (createError) throw new BadRequestException(createError.message);
            return (created as { id: string } | null)?.id ?? null;
        });
    }

    private async findOrCreate(
        cache: Map<string, string>,
        key: string,
        resolve: () => Promise<string | null>,
    ): Promise<string | null> {
        const cached = cache.get(key);
        if (cached) return cached;

        const id = await resolve();
        if (id) cache.set(key, id);
        return id;
    }

    private buildTitle(raw: string, fallback: string): string {
        return String(raw).substring(0, TITLE_MAX_LENGTH).trim() || fallback;
    }
}

interface ImportContext {
    db: DbSession;
    bankId: string;
    organizationId: string;
    stimuli: Map<string, string>;
    instructions: Map<string, string>;
    kisiKisi: Map<string, string>;
    dimensions: Map<string, string>;
}

interface ExistingQuestionOrder {
    id: string;
    metadata?: Record<string, any> | null;
    created_at?: string | null;
}

function compareExistingQuestionOrder(a: ExistingQuestionOrder, b: ExistingQuestionOrder): number {
    const orderA = a.metadata?.order_index;
    const orderB = b.metadata?.order_index;
    if (Number.isFinite(orderA) && Number.isFinite(orderB) && orderA !== orderB) return orderA - orderB;
    if (Number.isFinite(orderA) !== Number.isFinite(orderB)) return Number.isFinite(orderA) ? -1 : 1;
    const timeA = a.created_at ? new Date(a.created_at).getTime() : 0;
    const timeB = b.created_at ? new Date(b.created_at).getTime() : 0;
    if (timeA !== timeB) return timeA - timeB;
    return a.id.localeCompare(b.id);
}
