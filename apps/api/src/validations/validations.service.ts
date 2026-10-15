import {
    BadRequestException,
    ForbiddenException,
    Injectable,
    Logger,
    NotFoundException,
} from '@nestjs/common';
import type { AuthUser } from '@acca-cbt/shared';
import { AuthorizationService } from '../auth/authorization.service';
import { DbService } from '../prisma/prisma-db-adapter';
import { advisoryTransactionLock } from '../common/transaction-lock';
import { compareQuestions } from '../common/bank-question-order';
import {
    CreateValidationDto,
    SaveValidationNoteDto,
    SubmitValidationDto,
} from './dto/validations.dto';

@Injectable()
export class ValidationsService {
    private readonly logger = new Logger(ValidationsService.name);

    constructor(
        private readonly db: DbService,
        private readonly authz: AuthorizationService,
    ) {}

    private async notifyOwner(tx: Pick<DbService, 'from'>, validationId: string, organizationId: string, bankId: string, onlyIfMissing = false) {
        const { data: bank, error } = await tx.from('cbt_question_banks').select('created_by, title').eq('id', bankId).eq('organization_id', organizationId).single();
        if (error || !bank) throw new BadRequestException('Pemilik bank soal tidak dapat dibaca.');
        if (!bank.created_by) return;
        if (onlyIfMissing) {
            const { data: existing, error: lookupError } = await tx.from('cbt_notifications')
                .select('id').eq('user_id', bank.created_by).eq('organization_id', organizationId)
                .contains('data', { validationId }).limit(1);
            if (lookupError) throw new BadRequestException('Pemberitahuan sebelumnya tidak dapat diperiksa.');
            if (existing?.length) return;
        }
        const { error: notificationError } = await tx.from('cbt_notifications').insert({
            user_id: bank.created_by, organization_id: organizationId, type: 'system',
            title: 'Hasil validasi soal diperbarui',
            message: `Hasil validasi untuk bank soal "${bank.title || 'Bank Soal'}" tersedia. Buka Catatan Validasi untuk melihat koreksi.`,
            priority: 'normal', is_read: false,
            data: { validationId, bankId },
            action_url: `/dashboard/guru/questions/${bankId}?tab=validations&validation=${validationId}`,
        });
        if (notificationError) throw new BadRequestException('Pemberitahuan hasil validasi gagal disimpan. Silakan coba lagi.');
    }

    /**
     * Buat sesi penugasan validasi baru untuk bank soal.
     * Hanya dapat dilakukan oleh Admin atau Proktor.
     */
    async create(user: AuthUser, dto: CreateValidationDto) {
        const { data: bank, error: bankErr } = await this.db
            .from('cbt_question_banks')
            .select('id, organization_id, title')
            .eq('id', dto.bankId)
            .maybeSingle();

        if (bankErr || !bank) {
            throw new NotFoundException('Bank soal tidak ditemukan.');
        }

        const organizationId = (bank as { organization_id: string }).organization_id;
        await this.authz.assertProktor(user, organizationId);
        await this.authz.assertBankAccess(user, dto.bankId, 'read');

        if (!dto.validatorIds || dto.validatorIds.length === 0) {
            throw new BadRequestException('Pilih minimal 1 orang guru sebagai validator.');
        }

        const title = dto.title?.trim() || `Validasi: ${(bank as { title: string }).title}`;

        const validation = await this.db.transaction(async (tx) => {
            const { data: valRow, error: valErr } = await tx
                .from('cbt_question_bank_validations')
                .insert({
                    organization_id: organizationId,
                    bank_id: dto.bankId,
                    created_by: user.id,
                    title,
                    instructions: dto.instructions?.trim() || '',
                    deadline: dto.deadline ? new Date(dto.deadline).toISOString() : null,
                    approval_rule: dto.approvalRule || 'unanimous',
                    status: 'pending',
                    allow_edit_during_exam: dto.allowEditDuringExam ?? true,
                })
                .select('id')
                .single();

            if (valErr || !valRow) {
                throw new BadRequestException(`Gagal membuat sesi validasi: ${valErr?.message}`);
            }

            const validationId = (valRow as { id: string }).id;

            const validatorRows = dto.validatorIds.map((vId) => ({
                validation_id: validationId,
                validator_id: vId,
                status: 'assigned',
            }));

            const { error: vInsertErr } = await tx
                .from('cbt_question_bank_validators')
                .insert(validatorRows);

            if (vInsertErr) {
                throw new BadRequestException(
                    `Gagal menugaskan validator: ${vInsertErr.message}`,
                );
            }

            return { id: validationId };
        });

        return validation;
    }

    /**
     * Daftar seluruh penugasan validasi di sekolah (Admin & Proktor).
     */
    async list(user: AuthUser, bankId?: string) {
        await this.authz.assertProktor(user, user.organizationId);

        let query = this.db
            .from('cbt_question_bank_validations')
            .select(
                `id, bank_id, title, instructions, deadline, approval_rule, status, allow_edit_during_exam, created_at, updated_at,
                 bank:cbt_question_banks(id, title, subject, class_level, is_published, created_by, creator:cbt_profiles!cbt_question_banks_created_by_fkey(full_name, email)),
                 creator:cbt_profiles!cbt_question_bank_validations_created_by_fkey(full_name),
                 validators:cbt_question_bank_validators(id, validator_id, status, general_recommendation, general_comment, profile:cbt_profiles(full_name, email))`,
            )
            .eq('organization_id', user.organizationId)
            .order('created_at', { ascending: false });

        if (bankId) {
            query = query.eq('bank_id', bankId);
        }

        const { data, error } = await query;
        if (error) {
            this.logger.error(`Gagal membaca daftar validasi: ${error.message}`);
            return [];
        }

        const rows = (data as any[]) || [];
        if (!await this.authz.isRestrictedProctor(user, user.organizationId!)) return rows;
        return rows.filter(row => row.bank?.created_by === user.id || row.bank?.is_published === true);
    }

    /**
     * Detail satu sesi validasi beserta daftar validator dan catatan perbaikan.
     */
    async getDetail(user: AuthUser, validationId: string) {
        await this.authz.assertOrgStaff(user, user.organizationId);

        const { data: val, error } = await this.db
            .from('cbt_question_bank_validations')
            .select(
                `*,
                 bank:cbt_question_banks(*),
                 creator:cbt_profiles!cbt_question_bank_validations_created_by_fkey(full_name, email),
                 validators:cbt_question_bank_validators(*, profile:cbt_profiles(full_name, email)),
                 notes:cbt_question_validation_notes(*, validator:cbt_profiles!cbt_question_validation_notes_validator_id_fkey(full_name))`
            )
            .eq('id', validationId)
            .maybeSingle();

        if (error || !val) {
            throw new NotFoundException('Sesi validasi tidak ditemukan.');
        }

        if ((val as any).organization_id !== user.organizationId && !user.isPlatformAdmin) {
            throw new ForbiddenException('Akses ke sesi validasi sekolah lain ditolak.');
        }

        await this.authz.assertOrgStaff(user, (val as any).organization_id);
        if (await this.authz.isRestrictedProctor(user, (val as any).organization_id)) {
            await this.authz.assertBankAccess(user, (val as any).bank_id, 'read');
        }
        const { data: assignment, error: assignmentError } = await this.db
            .from('cbt_question_bank_validators').select('id')
            .eq('validation_id', validationId).eq('validator_id', user.id).maybeSingle();
        if (assignmentError) throw new BadRequestException('Gagal memeriksa penugasan validator.');
        if (!assignment) await this.authz.assertBankAccess(user, (val as any).bank_id, 'read');

        return val;
    }

    /**
     * Daftar tugas validasi yang diberikan kepada guru yang sedang login.
     */
    async listMyAssignedTasks(user: AuthUser) {
        const { data, error } = await this.db
            .from('cbt_question_bank_validators')
            .select(
                `id, status, general_recommendation, general_comment, submitted_at, created_at,
                 validation:cbt_question_bank_validations(
                    id, title, instructions, deadline, approval_rule, status, created_at,
                    bank:cbt_question_banks(id, title, subject, class_level, created_by, is_published, creator:cbt_profiles!cbt_question_banks_created_by_fkey(full_name)),
                    assigned_by:cbt_profiles!cbt_question_bank_validations_created_by_fkey(full_name)
                 )`,
            )
            .eq('validator_id', user.id)
            .order('created_at', { ascending: false });

        if (error) {
            this.logger.error(`Gagal membaca tugas validasi guru: ${error.message}`);
            return [];
        }

        const rows = (data as any[]) || [];
        if (!await this.authz.isRestrictedProctor(user, user.organizationId!)) return rows;
        return rows.filter(row => row.validation?.bank?.created_by === user.id || row.validation?.bank?.is_published === true);
    }

    /**
     * Data lengkap untuk layar review simulasi validasi soal bagi guru validator.
     */
    async getReviewData(user: AuthUser, validationId: string) {
        const validation = await this.getDetail(user, validationId);

        // Pastikan user adalah validator atau proktor/admin
        const { data: vAssignment } = await this.db
            .from('cbt_question_bank_validators')
            .select('*')
            .eq('validation_id', validationId)
            .eq('validator_id', user.id)
            .maybeSingle();

        // Ambil butir soal lengkap
        const bankId = (validation as any).bank_id;
        const { data: questions, error: qErr } = await this.db
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

        if (qErr) {
            throw new BadRequestException(`Gagal memuat soal: ${qErr.message}`);
        }

        // Ambil catatan-catatan yang sudah dibuat
        const { data: notes, error: notesErr } = await this.db
            .from('cbt_question_validation_notes')
            .select('*, validator:cbt_profiles!cbt_question_validation_notes_validator_id_fkey(full_name)')
            .eq('validation_id', validationId)
            .order('created_at', { ascending: true });

        if (notesErr) {
            this.logger.error(`Gagal membaca catatan validasi: ${notesErr.message}`);
        }

        return {
            validation,
            myValidatorStatus: vAssignment,
            questions: ((questions as any[]) || []).filter(q => !q.metadata?._deleted).sort(compareQuestions),
            notes: (notes as any[]) || [],
        };
    }

    /**
     * Simpan catatan penandaan teks / per butir soal oleh validator.
     */
    async saveNote(user: AuthUser, validationId: string, dto: SaveValidationNoteDto) {
        // Pastikan user adalah validator yang ditugaskan
        const { data: validator } = await this.db
            .from('cbt_question_bank_validators')
            .select('id, status')
            .eq('validation_id', validationId)
            .eq('validator_id', user.id)
            .maybeSingle();

        if (!validator) {
            throw new ForbiddenException('Anda bukan validator yang ditugaskan untuk sesi ini.');
        }

        const note = await this.db.transaction(async (tx) => {
            await advisoryTransactionLock(tx, `validation:${validationId}`);
            const { data: session, error: sessionError } = await tx
                .from('cbt_question_bank_validations').select('bank_id, organization_id')
                .eq('id', validationId).single();
            if (sessionError || !session) throw new NotFoundException('Sesi validasi tidak ditemukan.');
            await this.authz.assertOrgStaff(user, session.organization_id);
            const { data: question, error: questionError } = await tx
                .from('cbt_bank_questions').select('id, metadata')
                .eq('id', dto.questionId).eq('bank_id', session.bank_id).maybeSingle();
            if (questionError || !question || question.metadata?._deleted) {
                throw new BadRequestException('Soal tidak ditemukan pada bank yang divalidasi.');
            }
            if (dto.targetScope === 'option') {
                if (!dto.targetOptionId) throw new BadRequestException('Pilih opsi jawaban yang diberi catatan.');
                const { data: option, error: optionError } = await tx
                    .from('cbt_bank_question_options').select('id')
                    .eq('id', dto.targetOptionId).eq('question_id', dto.questionId).maybeSingle();
                if (optionError || !option) throw new BadRequestException('Opsi bukan bagian dari soal ini.');
            } else if (dto.targetOptionId) {
                throw new BadRequestException('Opsi hanya boleh disertakan untuk catatan opsi jawaban.');
            }
            if (!dto.comment.trim()) throw new BadRequestException('Catatan tidak boleh kosong.');

            // Update status validator dan validasi ke in_progress jika masih assigned/pending
            if ((validator as any).status === 'assigned') {
                const { error: assignmentError } = await tx
                    .from('cbt_question_bank_validators')
                    .update({ status: 'in_progress', updated_at: new Date().toISOString() })
                    .eq('id', (validator as any).id)
                    .eq('status', 'assigned');
                if (assignmentError) throw new BadRequestException('Gagal memperbarui penugasan validator.');

                const { error: statusError } = await tx
                    .from('cbt_question_bank_validations')
                    .update({ status: 'in_progress', updated_at: new Date().toISOString() })
                    .eq('id', validationId)
                    .eq('status', 'pending');
                if (statusError) throw new BadRequestException('Gagal memperbarui status validasi.');
            }

            const { data: newNote, error } = await tx
                .from('cbt_question_validation_notes')
                .insert({
                    validation_id: validationId,
                    question_id: dto.questionId,
                    validator_id: user.id,
                    target_scope: dto.targetScope,
                    target_option_id: dto.targetOptionId || null,
                    selected_text: dto.selectedText?.trim() || '',
                    comment: dto.comment.trim(),
                    category: dto.category || 'typo',
                    status_item: dto.statusItem || 'revision',
                })
                .select('*')
                .single();

            if (error) {
                throw new BadRequestException(`Gagal menyimpan catatan: ${error.message}`);
            }

            return newNote;
        });

        return note;
    }

    /**
     * Hapus catatan yang dibuat oleh validator tersebut.
     */
    async deleteNote(user: AuthUser, validationId: string, noteId: string) {
        const { error } = await this.db
            .from('cbt_question_validation_notes')
            .delete()
            .eq('id', noteId)
            .eq('validation_id', validationId)
            .eq('validator_id', user.id);

        if (error) {
            throw new BadRequestException(`Gagal menghapus catatan: ${error.message}`);
        }

        return { id: noteId, deleted: true };
    }

    /**
     * Selesaikan proses validasi oleh seorang validator (kirim rekomendasi umum).
     */
    async submitReview(user: AuthUser, validationId: string, dto: SubmitValidationDto) {
        const { data: vAssignment } = await this.db
            .from('cbt_question_bank_validators')
            .select('id')
            .eq('validation_id', validationId)
            .eq('validator_id', user.id)
            .maybeSingle();

        if (!vAssignment) {
            throw new ForbiddenException('Anda bukan validator untuk tugas ini.');
        }

        await this.db.transaction(async (tx) => {
            await advisoryTransactionLock(tx, `validation:${validationId}`);
            const { data: session, error: sessionError } = await tx
                .from('cbt_question_bank_validations').select('approval_rule, organization_id, status, bank_id')
                .eq('id', validationId).single();
            if (sessionError || !session) throw new NotFoundException('Sesi validasi tidak ditemukan.');
            await this.authz.assertOrgStaff(user, session.organization_id);
            const { data: previous, error: previousError } = await tx.from('cbt_question_bank_validators').select('status, general_recommendation, general_comment').eq('id', (vAssignment as any).id).single();
            if (previousError || !previous) throw new BadRequestException('Rekomendasi sebelumnya tidak dapat dibaca.');
            const changed = previous.status !== 'submitted' || previous.general_recommendation !== dto.generalRecommendation || (previous.general_comment || '') !== (dto.generalComment?.trim() || '');
            const now = new Date().toISOString();
            const { error: submitError } = await tx
                .from('cbt_question_bank_validators')
                .update({
                    status: 'submitted', general_recommendation: dto.generalRecommendation,
                    general_comment: dto.generalComment?.trim() || '', submitted_at: now, updated_at: now,
                }).eq('id', (vAssignment as any).id);
            if (submitError) throw new BadRequestException('Gagal menyimpan rekomendasi validator.');

            const { data: validators, error: validatorsError } = await tx
                .from('cbt_question_bank_validators').select('status, general_recommendation')
                .eq('validation_id', validationId);
            if (validatorsError || !validators?.length) throw new BadRequestException('Gagal membaca rekomendasi validator.');
            const allSubmitted = validators.every((v: any) => v.status === 'submitted');
            const hasApproved = validators.some((v: any) => v.status === 'submitted' && v.general_recommendation === 'approved');
            const hasRevision = validators.some((v: any) => v.status === 'submitted' && v.general_recommendation === 'revision_needed');
            let status = 'in_progress';
            if (session.approval_rule === 'any') {
                if (hasApproved) status = 'approved';
                else if (allSubmitted) status = hasRevision ? 'revision_needed' : 'rejected';
            } else if (session.approval_rule === 'unanimous') {
                if (hasRevision) status = 'revision_needed';
                else if (allSubmitted) status = validators.every((v: any) => v.general_recommendation === 'approved') ? 'approved' : 'rejected';
            } else {
                // Rekomendasi guru tidak menimpa keputusan Admin/Proktor.
                status = session.status === 'pending' ? 'in_progress' : session.status;
            }
            const { error: statusError } = await tx.from('cbt_question_bank_validations')
                .update({ status, updated_at: now }).eq('id', validationId);
            if (statusError) throw new BadRequestException('Gagal memperbarui status validasi.');
            // Older reviews predate owner notifications. Identical resubmissions
            // recover a missing notification while retaining retry deduplication.
            await this.notifyOwner(tx, validationId, session.organization_id, session.bank_id, !changed);
        });
        return { success: true };
    }

    async decide(user: AuthUser, validationId: string, status: 'approved' | 'revision_needed' | 'rejected') {
        await this.db.transaction(async (tx) => {
            await advisoryTransactionLock(tx, `validation:${validationId}`);
            const { data: session, error } = await tx.from('cbt_question_bank_validations')
                .select('organization_id, approval_rule, status, bank_id').eq('id', validationId).single();
            if (error || !session) throw new NotFoundException('Sesi validasi tidak ditemukan.');
            await this.authz.assertProktor(user, session.organization_id);
            if (session.approval_rule !== 'admin_decides') {
                throw new BadRequestException('Sesi ini menggunakan keputusan otomatis dari rekomendasi validator.');
            }
            const { data: validators, error: validatorsError } = await tx.from('cbt_question_bank_validators')
                .select('status').eq('validation_id', validationId);
            if (validatorsError || !validators?.length || validators.some((v: any) => v.status !== 'submitted')) {
                throw new BadRequestException('Tunggu seluruh validator menyelesaikan rekomendasinya.');
            }
            const decisionChanged = session.status !== status;
            const { error: updateError } = await tx.from('cbt_question_bank_validations')
                .update({ status, updated_at: new Date().toISOString() }).eq('id', validationId);
            if (updateError) throw new BadRequestException('Gagal menyimpan keputusan validasi.');
            await this.notifyOwner(tx, validationId, session.organization_id, session.bank_id, !decisionChanged);
        });
        return { success: true };
    }

    /**
     * Tandai catatan sudah diperbaiki oleh guru pembuat soal (Resolve Note).
     */
    async resolveNote(user: AuthUser, noteId: string, resolved: boolean) {
        const { data: note, error: nErr } = await this.db
            .from('cbt_question_validation_notes')
            .select('validation_id, validation:cbt_question_bank_validations(bank_id, organization_id)')
            .eq('id', noteId)
            .maybeSingle();

        if (nErr || !note) {
            throw new NotFoundException('Catatan validasi tidak ditemukan.');
        }

        const bankId = (note as any).validation?.bank_id;
        if (bankId) {
            await this.authz.assertBankAccess(user, bankId);
        } else {
            await this.authz.assertOrgStaff(user, user.organizationId);
        }

        const now = resolved ? new Date().toISOString() : null;

        const { data: updated, error } = await this.db
            .from('cbt_question_validation_notes')
            .update({
                is_resolved: resolved,
                resolved_by: resolved ? user.id : null,
                resolved_at: now,
                updated_at: new Date().toISOString(),
            })
            .eq('id', noteId)
            .select('*')
            .single();

        if (error) {
            throw new BadRequestException(`Gagal memperbarui status perbaikan: ${error.message}`);
        }

        return updated;
    }

    /**
     * Seluruh catatan perbaikan untuk satu bank soal (untuk ditampilkan di editor guru pembuat).
     */
    async getBankFeedback(user: AuthUser, bankId: string) {
        await this.authz.assertBankAccess(user, bankId, 'read');

        const { data: validations, error: valErr } = await this.db
            .from('cbt_question_bank_validations')
            .select(
                `id, title, status, deadline, created_at,
                 validators:cbt_question_bank_validators(
                    id, validator_id, status, general_recommendation, general_comment, submitted_at,
                    profile:cbt_profiles(full_name)
                 ),
                 notes:cbt_question_validation_notes(
                    id, validation_id, validator_id, created_at, question_id, target_scope, target_option_id, selected_text, comment, category, status_item, is_resolved, resolved_at,
                    validator:cbt_profiles!cbt_question_validation_notes_validator_id_fkey(full_name)
                 )`
            )
            .eq('bank_id', bankId)
            .order('created_at', { ascending: false });

        if (valErr) {
            this.logger.error(`Gagal membaca umpan balik validasi bank ${bankId}: ${valErr.message}`);
            throw new BadRequestException('Catatan validasi belum dapat dimuat. Silakan coba lagi.');
        }

        return (validations as any[]) || [];
    }
}
