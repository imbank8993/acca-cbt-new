import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { AuthUser } from '@acca-cbt/shared';
import { AuthorizationService } from '../auth/authorization.service';
import { deriveRequestUuid, insertIdempotently } from '../common/idempotent-create';
import { advisoryTransactionLock } from '../common/transaction-lock';
import { DbService } from '../prisma/prisma-db-adapter';

/**
 * Isi pendamping sebuah bank soal: kisi-kisi, stimulus, petunjuk, dimensi, dan
 * tafsiran dimensi.
 *
 * Dipindahkan dari `apps/web/app/actions/question.ts`. Kelimanya punya bentuk
 * yang sama persis — daftar per bank, buat, ubah, hapus — jadi keduanya dilayani
 * satu service dengan satu pola otorisasi: `assertBankAccess` untuk yang
 * menyebut banknya, `assertBankAccessByChild` untuk yang menyebut barisnya.
 *
 * `orgId` tidak lagi diterima dari klien pada satu pun fungsi. Versi lama
 * menerimanya di hampir semua tanda tangan, lalu — pada sebagian, bukan semua —
 * menimpanya dengan organisasi bank yang sebenarnya. Di sini nilainya selalu
 * datang dari `assertBankAccess`.
 */
@Injectable()
export class BankContentService {
    private readonly logger = new Logger(BankContentService.name);

    constructor(
        private readonly db: DbService,
        private readonly authz: AuthorizationService,
    ) {}

    // ── Kisi-kisi ────────────────────────────────────────────────────────────

    async listKisiKisi(user: AuthUser, bankId: string) {
        await this.authz.assertBankAccess(user, bankId);
        return this.listByBank('cbt_question_kisi_kisi', bankId);
    }

    async createKisiKisi(
        user: AuthUser,
        bankId: string,
        data: Record<string, unknown>,
        clientRequestId: string,
    ) {
        const organizationId = await this.authz.assertBankAccess(user, bankId);
        return this.insert('cbt_question_kisi_kisi', bankId, clientRequestId, {
            organization_id: organizationId,
            bank_id: bankId,
            ...this.pickKisiKisiFields(data),
        });
    }

    async updateKisiKisi(user: AuthUser, id: string, data: Record<string, unknown>) {
        await this.authz.assertBankAccessByChild(user, 'cbt_question_kisi_kisi', id);
        return this.update('cbt_question_kisi_kisi', id, this.pickKisiKisiFields(data));
    }

    async removeKisiKisi(user: AuthUser, id: string) {
        await this.authz.assertBankAccessByChild(user, 'cbt_question_kisi_kisi', id);
        return this.remove('cbt_question_kisi_kisi', id);
    }

    private pickKisiKisiFields(data: Record<string, unknown>): Record<string, unknown> {
        const fields = ['materi', 'indikator_soal', 'level_kognitif'];
        return Object.fromEntries(fields
            .filter((field) => Object.prototype.hasOwnProperty.call(data, field))
            .map((field) => [field, data[field]]));
    }

    // ── Stimulus ─────────────────────────────────────────────────────────────

    async listStimuli(user: AuthUser, bankId: string) {
        await this.authz.assertBankAccess(user, bankId);
        return this.listByBank('cbt_question_stimuli', bankId);
    }

    async createStimulus(
        user: AuthUser, bankId: string, title: string, content: string, clientRequestId: string,
    ) {
        const organizationId = await this.authz.assertBankAccess(user, bankId);
        return this.insert('cbt_question_stimuli', bankId, clientRequestId, {
            organization_id: organizationId,
            bank_id: bankId,
            title,
            content,
        });
    }

    async updateStimulus(user: AuthUser, id: string, title: string, content: string) {
        await this.authz.assertBankAccessByChild(user, 'cbt_question_stimuli', id);
        return this.update('cbt_question_stimuli', id, { title, content });
    }

    async removeStimulus(user: AuthUser, id: string) {
        await this.authz.assertBankAccessByChild(user, 'cbt_question_stimuli', id);
        return this.remove('cbt_question_stimuli', id);
    }

    /**
     * Impor stimulus dari baris hasil pembacaan berkas XLS.
     *
     * Berkasnya sendiri dibaca di browser; yang sampai ke sini hanya barisnya.
     * Baris tanpa konten dilewati dan dilaporkan, bukan membatalkan seluruh
     * impor — satu baris kosong di tengah berkas adalah hal yang biasa terjadi.
     */
    async importStimuli(user: AuthUser, bankId: string, rows: ImportRow[], clientRequestId: string) {
        const organizationId = await this.authz.assertBankAccess(user, bankId);

        const { inserts, errors } = this.prepareImport(rows, (title, content) => ({
            organization_id: organizationId,
            bank_id: bankId,
            title,
            content,
        }));

        return this.runImport(
            'cbt_question_stimuli', bankId, inserts, errors, 'stimulus', clientRequestId,
        );
    }

    // ── Petunjuk ─────────────────────────────────────────────────────────────

    async listInstructions(user: AuthUser, bankId: string) {
        await this.authz.assertBankAccess(user, bankId);
        return this.listByBank('cbt_question_instructions', bankId);
    }

    async createInstruction(
        user: AuthUser, bankId: string, title: string, content: string, clientRequestId: string,
    ) {
        await this.authz.assertBankAccess(user, bankId);
        return this.insert('cbt_question_instructions', bankId, clientRequestId, {
            bank_id: bankId,
            title: title || null,
            content,
        });
    }

    async updateInstruction(user: AuthUser, id: string, title: string, content: string) {
        await this.authz.assertBankAccessByChild(user, 'cbt_question_instructions', id);
        return this.update('cbt_question_instructions', id, {
            title: title || null,
            content,
            updated_at: new Date().toISOString(),
        });
    }

    async removeInstruction(user: AuthUser, id: string) {
        await this.authz.assertBankAccessByChild(user, 'cbt_question_instructions', id);
        return this.remove('cbt_question_instructions', id);
    }

    async importInstructions(
        user: AuthUser, bankId: string, rows: ImportRow[], clientRequestId: string,
    ) {
        await this.authz.assertBankAccess(user, bankId);

        const { inserts, errors } = this.prepareImport(rows, (title, content) => ({
            bank_id: bankId,
            title,
            content,
        }));

        return this.runImport(
            'cbt_question_instructions', bankId, inserts, errors, 'petunjuk', clientRequestId,
        );
    }

    // ── Dimensi ──────────────────────────────────────────────────────────────

    async listDimensions(user: AuthUser, bankId: string) {
        await this.authz.assertBankAccess(user, bankId);
        return this.listByBank('cbt_question_dimensions', bankId);
    }

    async createDimension(
        user: AuthUser, bankId: string, name: string, description: string, clientRequestId: string,
    ) {
        await this.authz.assertBankAccess(user, bankId);
        return this.insert(
            'cbt_question_dimensions', bankId, clientRequestId,
            { bank_id: bankId, name, description },
        );
    }

    async updateDimension(user: AuthUser, id: string, name: string, description: string) {
        await this.authz.assertBankAccessByChild(user, 'cbt_question_dimensions', id);
        return this.update('cbt_question_dimensions', id, { name, description });
    }

    async removeDimension(user: AuthUser, id: string) {
        await this.authz.assertBankAccessByChild(user, 'cbt_question_dimensions', id);
        return this.remove('cbt_question_dimensions', id);
    }

    // ── Tafsiran dimensi ─────────────────────────────────────────────────────

    async listInterpretations(user: AuthUser, bankId: string) {
        await this.authz.assertBankAccess(user, bankId);

        const { data, error } = await this.db
            .from('cbt_dimension_interpretations')
            .select('*, question_dimensions:cbt_question_dimensions!inner(bank_id)')
            .eq('question_dimensions.bank_id', bankId)
            .order('min_score', { ascending: true });

        if (error) {
            this.logger.error(`Gagal membaca tafsiran dimensi: ${error.message}`);
            return [];
        }
        return (data as any[]) || [];
    }

    async createInterpretation(
        user: AuthUser,
        dimensionId: string,
        data: InterpretationInput,
        clientRequestId: string,
    ) {
        await this.authz.assertBankAccessByChild(user, 'cbt_question_dimensions', dimensionId);

        return this.insert('cbt_dimension_interpretations', dimensionId, clientRequestId, {
            dimension_id: dimensionId,
            min_score: data.minScore,
            max_score: data.maxScore,
            title: data.title,
            interpretation: data.interpretation,
        });
    }

    async updateInterpretation(user: AuthUser, id: string, data: InterpretationInput) {
        await this.assertInterpretationAccess(user, id);

        return this.update('cbt_dimension_interpretations', id, {
            min_score: data.minScore,
            max_score: data.maxScore,
            title: data.title,
            interpretation: data.interpretation,
            updated_at: new Date().toISOString(),
        });
    }

    async removeInterpretation(user: AuthUser, id: string) {
        await this.assertInterpretationAccess(user, id);
        return this.remove('cbt_dimension_interpretations', id);
    }

    /**
     * Organisasi sebuah tafsiran berjarak tiga lompatan: tafsiran → dimensi →
     * bank → organisasi. `assertBankAccessByChild` menempuh dua yang terakhir,
     * jadi yang pertama dikerjakan di sini.
     */
    private async assertInterpretationAccess(user: AuthUser, id: string): Promise<void> {
        const { data } = await this.db
            .from('cbt_dimension_interpretations')
            .select('dimension_id')
            .eq('id', id)
            .maybeSingle();

        await this.authz.assertBankAccessByChild(
            user,
            'cbt_question_dimensions',
            (data as { dimension_id: string | null } | null)?.dimension_id,
        );
    }

    // ── Operasi bersama ──────────────────────────────────────────────────────

    private async listByBank(table: string, bankId: string) {
        const { data, error } = await this.db
            .from(table)
            .select('*')
            .eq('bank_id', bankId)
            .order('created_at', { ascending: false });

        if (error) {
            this.logger.error(`Gagal membaca ${table}: ${error.message}`);
            return [];
        }
        return (data as any[]) || [];
    }

    private async insert(
        table: string,
        scopeId: string,
        clientRequestId: string,
        payload: Record<string, unknown>,
    ) {
        const scopeColumn = table === 'cbt_dimension_interpretations' ? 'dimension_id' : 'bank_id';
        const data = await insertIdempotently<{ id: string }>(this.db, {
            table,
            scope: { column: scopeColumn, value: scopeId },
            clientRequestId,
            fingerprint: payload,
            payload,
            select: 'id',
        });
        return { id: data.id, data };
    }

    /**
     * `id` saja sebagai penyaring sudah cukup: otorisasinya tadi memastikan baris
     * itu memang milik bank yang boleh disentuh pemanggil. Versi lama menambahkan
     * `.eq('organization_id', …)` pada sebagian tabel — tidak konsisten, dan pada
     * tabel yang tidak punya kolom itu (mis. dimensi) justru dihilangkan diam-diam.
     */
    private async update(table: string, id: string, payload: Record<string, unknown>) {
        const { error } = await this.db.from(table).update(payload).eq('id', id);
        if (error) throw new BadRequestException(error.message);
        return { id };
    }

    private async remove(table: string, id: string) {
        const { error } = await this.db.from(table).delete().eq('id', id);
        if (error) throw new BadRequestException(error.message);
        return { id };
    }

    private prepareImport(
        rows: ImportRow[],
        build: (title: string, content: string) => Record<string, unknown>,
    ) {
        const inserts: Record<string, unknown>[] = [];
        const errors: string[] = [];

        rows.forEach((row, index) => {
            // `Konten_HTML` didahulukan: kolom `Konten` sengaja berisi versi teks
            // polos agar berkasnya bisa dibaca manusia, jadi memakainya akan
            // menghapus seluruh format stimulus yang diekspor.
            const content = (row.Konten_HTML || row.Konten || '').trim();

            if (!content) {
                // +2: satu untuk baris judul, satu karena nomor baris di Excel
                // mulai dari 1 — supaya angkanya cocok dengan yang dilihat guru.
                errors.push(`Baris ${index + 2}: konten kosong, dilewati.`);
                return;
            }

            inserts.push(build((row.Judul || '').trim(), content));
        });

        return { inserts, errors };
    }

    private async runImport(
        table: string,
        bankId: string,
        inserts: Record<string, unknown>[],
        errors: string[],
        label: string,
        clientRequestId: string,
    ) {
        if (inserts.length === 0) {
            return {
                imported: 0,
                errors:
                    errors.length > 0
                        ? errors
                        : [`Tidak ada data ${label} yang valid untuk diimpor.`],
            };
        }

        await this.db.transaction(async db => {
            await advisoryTransactionLock(
                db,
                `content-import:${table}:${bankId}:${clientRequestId}`,
            );
            for (const [index, payload] of inserts.entries()) {
                await insertIdempotently(db, {
                    table,
                    scope: { column: 'bank_id', value: bankId },
                    clientRequestId: deriveRequestUuid(clientRequestId, index),
                    fingerprint: payload,
                    payload,
                    select: 'id',
                });
            }
        });

        return { imported: inserts.length, errors };
    }
}

export interface ImportRow {
    Judul?: string;
    Konten?: string;
    Konten_HTML?: string;
}

export interface InterpretationInput {
    minScore: number;
    maxScore: number;
    title: string;
    interpretation: string;
}
