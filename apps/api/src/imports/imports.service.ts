import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { AuthUser } from '@acca-cbt/shared';
import { AuthorizationService } from '../auth/authorization.service';
import { DbService } from '../prisma/prisma-db-adapter';
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

/**
 * Impor massal soal ke satu bank.
 *
 * Dipindahkan dari `apps/web/app/actions/bulk-import.ts`. Yang TIDAK ikut pindah
 * adalah perenderan persamaan MathML menjadi SVG dan pengunggahannya ke R2: itu
 * urusan berkas, dan NestJS memang tidak pernah menyentuh berkas. Langkah itu
 * tetap di route handler Next.js, yang mengirim ke sini teks soal yang
 * persamaannya sudah berupa `<img>`.
 *
 * Tiga perbedaan lain dengan versi lama:
 *
 *  - `organization_id` DITURUNKAN dari bank soalnya, bukan diterima dari
 *    browser. Versi lama memakai `orgId` kiriman pemanggil, sehingga soal bisa
 *    ditulis dengan organisasi yang bukan pemilik banknya.
 *  - Opsi jawaban dipasangkan lewat indeks sumber yang dicatat, bukan lewat
 *    posisi dalam array hasil insert. Versi lama memakai `questions[i]` untuk
 *    `insertedQuestions[i]`, padahal baris yang gagal validasi tidak ikut
 *    di-insert — begitu ada satu baris kosong, seluruh opsi sesudahnya menempel
 *    pada soal yang salah.
 *  - Dimensi dicari dengan `maybeSingle`, bukan `single`. `single` melempar
 *    ketika tidak ada baris yang cocok, dan galat itu dulu tertelan diam-diam
 *    sehingga dimensi selalu dibuat ulang.
 */
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

        const result: BulkImportResult = {
            success: false,
            imported: 0,
            failed: 0,
            errors: [],
            questionIds: [],
        };

        const context: ImportContext = {
            bankId,
            organizationId,
            stimuli: new Map(),
            instructions: new Map(),
            kisiKisi: new Map(),
            dimensions: new Map(),
        };

        // `sourceIndexes[n]` adalah posisi asli dari `rows[n]`, dipakai untuk
        // memasangkan opsi ke soal yang benar setelah insert.
        const rows: Record<string, unknown>[] = [];
        const sourceIndexes: number[] = [];

        for (let index = 0; index < questions.length; index++) {
            const question = questions[index];

            try {
                if (!question.question_text?.trim()) {
                    result.errors.push({ index, message: `Baris ${index + 1}: teks soal kosong` });
                    result.failed++;
                    continue;
                }

                rows.push({
                    bank_id: bankId,
                    organization_id: organizationId,
                    type: question.type || 'mcq',
                    question_text: question.question_text.trim(),
                    difficulty: question.difficulty || 'medium',
                    score_default: question.score_default || 1,
                    metadata: question.metadata || {},
                    stimulus_id: await this.resolveStimulus(context, question),
                    instruction_id: await this.resolveInstruction(context, question),
                    kisi_kisi_id: await this.resolveKisiKisi(context, question),
                    dimension_id: question.metadata?.dimension
                        ? await this.resolveDimension(context, question.metadata.dimension)
                        : null,
                });
                sourceIndexes.push(index);
            } catch (err) {
                result.errors.push({
                    index,
                    message: `Baris ${index + 1}: ${(err as Error).message}`,
                });
                result.failed++;
            }
        }

        if (rows.length === 0) return result;

        const { data: inserted, error } = await this.db
            .from('cbt_bank_questions')
            .insert(rows)
            .select('id');

        if (error || !inserted) {
            this.logger.error(`Gagal menyimpan soal impor: ${error?.message}`);
            result.errors.push({
                index: -1,
                message: `Gagal menyimpan soal: ${error?.message ?? 'tidak diketahui'}`,
            });
            result.failed += rows.length;
            return result;
        }

        const insertedIds = (inserted as Array<{ id: string }>).map((row) => row.id);
        const options: Record<string, unknown>[] = [];

        for (let position = 0; position < insertedIds.length; position++) {
            const questionId = insertedIds[position];
            const source = questions[sourceIndexes[position]];

            for (const option of source.options || []) {
                const metadata = { ...(option.metadata || {}) } as Record<string, unknown>;
                if (metadata.dimension) {
                    const dimensionId = await this.resolveDimension(
                        context,
                        String(metadata.dimension),
                    );
                    if (dimensionId) metadata.dimension_id = dimensionId;
                }

                options.push({
                    question_id: questionId,
                    option_text: option.option_text,
                    is_correct: option.is_correct || false,
                    order: option.order || 0,
                    weight: option.weight ?? (option.is_correct ? 1 : 0),
                    metadata,
                });
            }

            result.questionIds.push(questionId);
            result.imported++;
        }

        if (options.length > 0) {
            const { error: optionsError } = await this.db
                .from('cbt_bank_question_options')
                .insert(options);

            if (optionsError) {
                // Soalnya sudah masuk; melaporkan gagal total akan membuat guru
                // mengimpor ulang dan menggandakan seluruh soal.
                this.logger.error(`Gagal menyimpan opsi impor: ${optionsError.message}`);
                result.errors.push({
                    index: -1,
                    message: `Soal berhasil diimpor tetapi opsinya gagal: ${optionsError.message}`,
                });
            }
        }

        result.success = result.imported > 0;
        return result;
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
        const cacheKey = question.metadata?._stimulus_code || title;

        return this.findOrCreate(context.stimuli, cacheKey, async () => {
            const { data: existing } = await this.db
                .from('cbt_question_stimuli')
                .select('id')
                .eq('bank_id', context.bankId)
                .ilike('title', title)
                .limit(1);

            const found = ((existing as Array<{ id: string }>) || [])[0];
            if (found) return found.id;

            const { data: created } = await this.db
                .from('cbt_question_stimuli')
                .insert({
                    organization_id: context.organizationId,
                    bank_id: context.bankId,
                    title,
                    content,
                })
                .select('id')
                .maybeSingle();

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
        const cacheKey = question.metadata?._instruction_code || title;

        return this.findOrCreate(context.instructions, cacheKey, async () => {
            const { data: existing } = await this.db
                .from('cbt_question_instructions')
                .select('id')
                .eq('bank_id', context.bankId)
                .ilike('title', title)
                .limit(1);

            const found = ((existing as Array<{ id: string }>) || [])[0];
            if (found) return found.id;

            const { data: created } = await this.db
                .from('cbt_question_instructions')
                .insert({
                    organization_id: context.organizationId,
                    bank_id: context.bankId,
                    title,
                    content,
                })
                .select('id')
                .maybeSingle();

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
            const { data: existing } = await this.db
                .from('cbt_question_kisi_kisi')
                .select('id')
                .eq('bank_id', context.bankId)
                .eq('nomor_kd', nomorKd)
                .limit(1);

            const found = ((existing as Array<{ id: string }>) || [])[0];
            if (found) return found.id;

            const { data: created } = await this.db
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
            const { data: existing } = await this.db
                .from('cbt_question_dimensions')
                .select('id')
                .eq('bank_id', context.bankId)
                .ilike('name', name)
                .maybeSingle();

            if (existing) return (existing as { id: string }).id;

            const { data: created } = await this.db
                .from('cbt_question_dimensions')
                .insert({ bank_id: context.bankId, name, description: '' })
                .select('id')
                .maybeSingle();

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
    bankId: string;
    organizationId: string;
    stimuli: Map<string, string>;
    instructions: Map<string, string>;
    kisiKisi: Map<string, string>;
    dimensions: Map<string, string>;
}
