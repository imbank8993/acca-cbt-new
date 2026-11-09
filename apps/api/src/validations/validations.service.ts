import {
    BadRequestException,
    ConflictException,
    ForbiddenException,
    Injectable,
    Logger,
    NotFoundException,
} from '@nestjs/common';
import { isUUID } from 'class-validator';
import type { AuthUser } from '@acca-cbt/shared';
import { AuthorizationService } from '../auth/authorization.service';
import { DbService, type DbSession } from '../prisma/prisma-db-adapter';
import { advisoryTransactionLock } from '../common/transaction-lock';
import { activeCollaboration, type CollaborationGrant } from '../common/collaboration-access';
import { compareQuestions } from '../common/bank-question-order';
import { dedupeOptions } from '../common/question-options';
import {
    CreateValidationDto,
    SaveValidationNoteDto,
    SubmitValidationDto,
    UpdateValidationDto,
    UpdateValidationNoteDto,
} from './dto/validations.dto';

const DAY_MS = 24 * 60 * 60 * 1000;

type SessionStatus = 'pending' | 'in_progress' | 'revision_needed' | 'resubmitted' | 'approved' | 'rejected';
interface SessionRow {
    id: string;
    bank_id: string;
    organization_id: string;
    approval_rule: 'unanimous' | 'any' | 'admin_decides';
    status: SessionStatus;
    deadline?: string | null;
    round?: number | null;
    created_by?: string | null;
}
interface AssignmentRow { id: string; status: 'assigned' | 'in_progress' | 'submitted'; validator_id?: string }
interface ValidatorRecommendation { status: string; general_recommendation?: string | null }

const SESSION_COLUMNS = 'id, bank_id, organization_id, approval_rule, status, deadline, round, created_by';
/** Sesi yang masih berjalan: keanggotaan validator boleh diubah. */
const RUNNING_STATUSES: SessionStatus[] = ['pending', 'in_progress', 'resubmitted'];

/** Tanggal lama 00:00 UTC (= 08:00 WITA) berlaku sampai akhir hari itu. */
export function isValidationDeadlinePassed(value: string | null | undefined, now = Date.now()): boolean {
    if (!value) return false;
    let deadline = new Date(value).getTime();
    if (!Number.isFinite(deadline)) return false;
    if (deadline % DAY_MS === 0) deadline += DAY_MS - 1;
    return deadline < now;
}

/**
 * Status sesi dari rekomendasi validator. `waiting` dipakai selama hasil belum
 * dapat ditentukan (mis. `in_progress`, atau `resubmitted` pada telaah ulang).
 */
export function computeValidationStatus(
    session: Pick<SessionRow, 'approval_rule' | 'status'>,
    validators: ValidatorRecommendation[],
    waiting: SessionStatus,
): SessionStatus {
    const submitted = validators.filter(v => v.status === 'submitted');
    const allSubmitted = validators.length > 0 && submitted.length === validators.length;
    const hasApproved = submitted.some(v => v.general_recommendation === 'approved');
    const hasRevision = submitted.some(v => v.general_recommendation === 'revision_needed');
    if (session.approval_rule === 'any') {
        if (hasApproved) return 'approved';
        if (allSubmitted) return hasRevision ? 'revision_needed' : 'rejected';
        return waiting;
    }
    if (session.approval_rule === 'unanimous') {
        // Tunggu SELURUH validator; satu rekomendasi awal (revisi maupun
        // tolak) tidak boleh langsung menentukan hasil sesi.
        if (!allSubmitted) return waiting;
        if (submitted.every(v => v.general_recommendation === 'approved')) return 'approved';
        return hasRevision ? 'revision_needed' : 'rejected';
    }
    // Rekomendasi guru tidak menimpa keputusan Admin/Proktor.
    return session.status === 'pending' ? waiting : session.status;
}

@Injectable()
export class ValidationsService {
    private readonly logger = new Logger(ValidationsService.name);

    constructor(
        private readonly db: DbService,
        private readonly authz: AuthorizationService,
    ) {}

    /** School-wide containers; they do not grant access to the validations inside. */
    async listFolders(user: AuthUser) {
        await this.authz.assertProktor(user, user.organizationId);
        const { data, error } = await this.db.from('cbt_validation_folders').select('*')
            .eq('organization_id', user.organizationId).order('name', { ascending: true });
        if (error) throw new BadRequestException('Folder validasi belum dapat dimuat.');
        const folders = (data || []) as Array<{ id: string; name: string; created_by: string | null }>;
        if (!folders.length) return [];
        const { data: sessions, error: contentsError } = await this.db.from('cbt_question_bank_validations')
            .select('folder_id').in('folder_id', folders.map(folder => folder.id));
        if (contentsError) throw new BadRequestException('Isi folder validasi belum dapat diperiksa.');
        const occupied = new Set((sessions || []).map((row: { folder_id: string }) => row.folder_id));
        const admin = !await this.authz.isRestrictedProctor(user, user.organizationId!);
        return folders.map(folder => ({ ...folder,
            canManage: admin || folder.created_by === user.id,
            canDelete: (admin || folder.created_by === user.id) && !occupied.has(folder.id),
        }));
    }

    private folderName(name: string) {
        const value = name.trim();
        if (!value || value.length > 120) throw new BadRequestException('Nama folder wajib diisi, maksimal 120 karakter.');
        return value;
    }

    async createFolder(user: AuthUser, name: string) {
        await this.authz.assertProktor(user, user.organizationId);
        const { data, error } = await this.db.from('cbt_validation_folders').insert({
            organization_id: user.organizationId, created_by: user.id, name: this.folderName(name),
        }).select('id').single();
        if (error?.code === '23505') throw new ConflictException('Nama folder validasi sudah digunakan.');
        if (error || !data) throw new BadRequestException('Folder validasi gagal dibuat.');
        return { id: data.id };
    }

    private async managedFolder(tx: DbSession, user: AuthUser, folderId: string) {
        await this.authz.assertProktor(user, user.organizationId);
        await tx.raw('SELECT id FROM public.cbt_validation_folders WHERE id = $1::uuid AND organization_id = $2::uuid FOR UPDATE', folderId, user.organizationId);
        const { data: folder, error } = await tx.from('cbt_validation_folders').select('*')
            .eq('id', folderId).eq('organization_id', user.organizationId).maybeSingle();
        if (error) throw new BadRequestException('Folder validasi belum dapat dibaca.');
        if (!folder) throw new NotFoundException('Folder validasi tidak ditemukan.');
        if (folder.created_by !== user.id && await this.authz.isRestrictedProctor(user, user.organizationId!)) {
            throw new ForbiddenException('Folder validasi hanya dapat diubah atau dihapus oleh pembuat folder atau Admin.');
        }
    }

    async updateFolder(user: AuthUser, folderId: string, name: string) {
        const value = this.folderName(name);
        await this.db.transaction(async tx => {
            await this.managedFolder(tx, user, folderId);
            const { error } = await tx.from('cbt_validation_folders').update({ name: value, updated_at: new Date().toISOString() }).eq('id', folderId);
            if (error?.code === '23505') throw new ConflictException('Nama folder validasi sudah digunakan.');
            if (error) throw new BadRequestException('Folder validasi gagal diperbarui.');
        });
        return { id: folderId };
    }

    async removeFolder(user: AuthUser, folderId: string) {
        await this.db.transaction(async tx => {
            await this.managedFolder(tx, user, folderId);
            const { data, error } = await tx.from('cbt_question_bank_validations').select('id').eq('folder_id', folderId).limit(1);
            if (error) throw new BadRequestException('Isi folder validasi belum dapat diperiksa.');
            if (data?.length) throw new BadRequestException('Folder masih berisi sesi validasi. Pindahkan seluruh sesi keluar sebelum menghapus folder.');
            const { error: deleteError } = await tx.from('cbt_validation_folders').delete().eq('id', folderId);
            if (deleteError) throw new BadRequestException('Folder validasi gagal dihapus.');
        });
        return { id: folderId };
    }

    private async assertFolderUsable(tx: DbSession, folderId: string | null | undefined, organizationId: string) {
        if (!folderId) return;
        // Share-lock with concurrent creates/moves, exclusive with deleting a folder.
        await tx.raw('SELECT id FROM public.cbt_validation_folders WHERE id = $1::uuid AND organization_id = $2::uuid FOR KEY SHARE', folderId, organizationId);
        const { data, error } = await tx.from('cbt_validation_folders').select('id')
            .eq('id', folderId).eq('organization_id', organizationId).maybeSingle();
        if (error || !data) throw new BadRequestException('Folder validasi tujuan tidak ditemukan di sekolah ini.');
    }

    /** Hydrate only already-authorized rows; the adapter's joins use single-column FKs. */
    private async withFolders(rows: any[], organizationId: string, tasks = false) {
        const ids = [...new Set(rows.map(row => (tasks ? row.validation : row)?.folder_id).filter(Boolean))];
        if (!ids.length) return rows;
        const { data, error } = await this.db.from('cbt_validation_folders').select('id, name')
            .in('id', ids).eq('organization_id', organizationId);
        if (error) throw new BadRequestException('Nama folder validasi belum dapat dimuat.');
        const names = new Map((data || []).map((folder: { id: string; name: string }) => [folder.id, { id: folder.id, name: folder.name }]));
        return rows.map(row => tasks
            ? { ...row, validation: { ...row.validation, folder: names.get(row.validation?.folder_id) || null } }
            : { ...row, folder: names.get(row.folder_id) || null });
    }

    /**
     * Validator tidak boleh mengubah catatan/rekomendasi setelah batas waktu
     * yang ditetapkan Admin/Proktor terlewati.
     */
    private assertWithinDeadline(session: { deadline?: string | null }) {
        if (isValidationDeadlinePassed(session.deadline)) {
            throw new ForbiddenException('Batas waktu validasi telah berakhir. Hubungi Admin/Proktor bila perlu diperpanjang.');
        }
    }

    /** Status sementara saat hasil belum dapat ditentukan, tanpa mengubah sesi yang belum disentuh. */
    private waitingStatus(session: Pick<SessionRow, 'status' | 'round'>, keepPending = false): SessionStatus {
        if (keepPending && session.status === 'pending') return 'pending';
        return (session.round ?? 1) > 1 ? 'resubmitted' : 'in_progress';
    }

    private async readSession(tx: Pick<DbService, 'from'>, validationId: string): Promise<SessionRow> {
        const { data, error } = await tx.from('cbt_question_bank_validations')
            .select(SESSION_COLUMNS).eq('id', validationId).maybeSingle();
        if (error) throw new BadRequestException('Sesi validasi belum dapat dibaca.');
        if (!data) throw new NotFoundException('Sesi validasi tidak ditemukan.');
        return data as SessionRow;
    }

    /**
     * Validator yang boleh mengubah catatan/status butir: ditugaskan, belum
     * mengirim hasil, dan masih dalam batas waktu. Perubahan setelah hasil
     * dikirim harus lewat "buka kembali" lalu kirim ulang, agar pembuat soal
     * selalu diberi tahu.
     */
    private async requireEditable(tx: Pick<DbService, 'from'>, user: AuthUser, validationId: string) {
        const session = await this.readSession(tx, validationId);
        await this.authz.assertOrgStaff(user, session.organization_id);
        const { data: assignment, error } = await tx.from('cbt_question_bank_validators')
            .select('id, status').eq('validation_id', validationId).eq('validator_id', user.id).maybeSingle();
        if (error) throw new BadRequestException('Gagal memeriksa penugasan validator.');
        if (!assignment) throw new ForbiddenException('Anda bukan validator yang ditugaskan untuk sesi ini.');
        if ((assignment as AssignmentRow).status === 'submitted') {
            throw new BadRequestException('Hasil validasi Anda sudah dikirim. Buka kembali lembar validasi untuk mengubah catatan.');
        }
        this.assertWithinDeadline(session);
        return { session, assignment: assignment as AssignmentRow };
    }

    /** Tandai validator (dan sesi yang belum disentuh) sedang bekerja. */
    private async markInProgress(tx: Pick<DbService, 'from'>, validationId: string, session: SessionRow, assignment: AssignmentRow) {
        if (assignment.status !== 'assigned') return;
        const now = new Date().toISOString();
        const { error: assignmentError } = await tx.from('cbt_question_bank_validators')
            .update({ status: 'in_progress', updated_at: now }).eq('id', assignment.id).eq('status', 'assigned');
        if (assignmentError) throw new BadRequestException('Gagal memperbarui penugasan validator.');
        if (session.status === 'pending') {
            const { error: statusError } = await tx.from('cbt_question_bank_validations')
                .update({ status: 'in_progress', updated_at: now }).eq('id', validationId).eq('status', 'pending');
            if (statusError) throw new BadRequestException('Gagal memperbarui status validasi.');
        }
    }

    private async questionInBank(tx: Pick<DbService, 'from'>, bankId: string, questionId: string) {
        const { data: question, error } = await tx.from('cbt_bank_questions').select('id, metadata, revision')
            .eq('id', questionId).eq('bank_id', bankId).maybeSingle();
        if (error || !question || (question as { metadata?: { _deleted?: boolean } }).metadata?._deleted) {
            throw new BadRequestException('Soal tidak ditemukan pada bank yang divalidasi.');
        }
        return question as { id: string; revision?: number | null };
    }

    /** Validator: staf aktif sekolah, bukan pembuat atau penyunting bank soal. */
    private async assertEligibleValidators(bankId: string, organizationId: string, validatorIds: string[], bankOwner: string | null) {
        if (bankOwner && validatorIds.includes(bankOwner)) {
            throw new BadRequestException('Pembuat bank soal tidak dapat ditunjuk sebagai validator bank soalnya sendiri.');
        }
        // Penyunting bersama ikut menyusun soal; validasinya tidak lagi independen.
        const { data: coAuthors, error: coAuthorError } = await this.db.from('cbt_bank_collaborators')
            .select('*').eq('bank_id', bankId);
        if (coAuthorError) throw new BadRequestException('Kolaborator bank soal belum dapat diperiksa.');
        if (((coAuthors || []) as CollaborationGrant[]).some(grant => activeCollaboration(grant) &&
            grant.permission !== 'viewer' && validatorIds.includes(grant.user_id))) {
            throw new BadRequestException('Editor atau pengelola bank soal ini tidak dapat ditunjuk sebagai validatornya.');
        }
        // Validator harus staf aktif (Guru/Proktor/Admin) di sekolah yang sama.
        // Tanpa pemeriksaan ini siswa atau akun sekolah lain dapat ditunjuk dan
        // melihat ringkasan tugas di daftar "tugas saya".
        for (const validatorId of validatorIds) {
            if (!await this.authz.hasOrgStaffRole(validatorId, organizationId)) {
                throw new BadRequestException('Validator harus guru atau staf aktif di sekolah ini.');
            }
        }
    }

    /** Pemberitahuan tugas untuk validator; gagal = seluruh perubahan dibatalkan. */
    private async notifyValidators(
        tx: Pick<DbService, 'from'>, organizationId: string, validationId: string,
        validatorIds: string[], title: string, message: string,
    ) {
        if (!validatorIds.length) return;
        const { error } = await tx.from('cbt_notifications').insert(validatorIds.map(userId => ({
            user_id: userId, organization_id: organizationId, type: 'system', title, message,
            priority: 'normal', is_read: false,
            data: { validationId, kind: 'validation_task' },
            action_url: `/dashboard/guru/validations/${validationId}/review`,
        })));
        if (error) throw new BadRequestException('Pemberitahuan untuk validator gagal disimpan. Silakan coba lagi.');
    }

    /**
     * Validator yang belum mengirim hasil hanya melihat catatan dan rekomendasinya
     * sendiri, supaya penilaian antar-validator tetap independen.
     */
    private hideOtherReviews<T extends { notes?: Array<{ validator_id?: string }>; validators?: Array<{ validator_id?: string }> }>(
        validation: T, userId: string,
    ): T {
        return {
            ...validation,
            notes: (validation.notes || []).filter(note => note.validator_id === userId),
            validators: (validation.validators || []).map(validator => validator.validator_id === userId
                ? validator : { ...validator, general_recommendation: null, general_comment: '' }),
        };
    }

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
            .select('id, organization_id, title, created_by')
            .eq('id', dto.bankId)
            .maybeSingle();

        if (bankErr || !bank) {
            throw new NotFoundException('Bank soal tidak ditemukan.');
        }

        const organizationId = (bank as { organization_id: string }).organization_id;
        await this.authz.assertProktor(user, organizationId);
        await this.authz.assertBankAccess(user, dto.bankId, 'read');

        const validatorIds = Array.from(new Set(dto.validatorIds || []));
        if (validatorIds.length === 0) {
            throw new BadRequestException('Pilih minimal 1 orang guru sebagai validator.');
        }

        const bankOwner = (bank as { created_by: string | null }).created_by;
        await this.assertEligibleValidators(dto.bankId, organizationId, validatorIds, bankOwner);

        let deadline: string | null = null;
        if (dto.deadline) {
            const parsed = new Date(dto.deadline);
            if (Number.isNaN(parsed.getTime())) {
                throw new BadRequestException('Format batas waktu tidak valid.');
            }
            if (parsed.getTime() <= Date.now()) {
                throw new BadRequestException('Batas waktu validasi harus di masa depan.');
            }
            deadline = parsed.toISOString();
        }

        const title = dto.title?.trim() || `Validasi: ${(bank as { title: string }).title}`;

        const validation = await this.db.transaction(async (tx) => {
            await this.assertFolderUsable(tx, dto.folderId, organizationId);
            const { data: valRow, error: valErr } = await tx
                .from('cbt_question_bank_validations')
                .insert({
                    organization_id: organizationId,
                    bank_id: dto.bankId,
                    folder_id: dto.folderId || null,
                    created_by: user.id,
                    title,
                    instructions: dto.instructions?.trim() || '',
                    deadline,
                    approval_rule: dto.approvalRule || 'unanimous',
                    status: 'pending',
                    allow_edit_during_exam: dto.allowEditDuringExam ?? true,
                })
                .select('id')
                .single();

            if (valErr || !valRow) {
                this.logger.error(`Gagal membuat sesi validasi: ${valErr?.message}`);
                throw new BadRequestException('Gagal membuat sesi validasi. Silakan coba lagi.');
            }

            const validationId = (valRow as { id: string }).id;

            const validatorRows = validatorIds.map((vId) => ({
                validation_id: validationId,
                validator_id: vId,
                status: 'assigned',
            }));

            const { error: vInsertErr } = await tx
                .from('cbt_question_bank_validators')
                .insert(validatorRows);

            if (vInsertErr) {
                this.logger.error(`Gagal menugaskan validator: ${vInsertErr.message}`);
                throw new BadRequestException('Gagal menugaskan validator. Silakan coba lagi.');
            }

            await this.notifyValidators(tx, organizationId, validationId, validatorIds,
                'Tugas validasi soal baru',
                `Anda ditunjuk menelaah bank soal "${(bank as { title: string }).title || 'Bank Soal'}"${deadline ? ` dengan batas waktu ${new Date(deadline).toLocaleDateString('id-ID', { timeZone: 'Asia/Makassar' })}` : ''}.`);

            return { id: validationId };
        });

        return validation;
    }

    /**
     * Daftar seluruh penugasan validasi di sekolah (Admin & Proktor).
     */
    async list(user: AuthUser, bankId?: string) {
        await this.authz.assertProktor(user, user.organizationId);
        if (bankId && !isUUID(bankId)) {
            throw new BadRequestException('ID bank soal tidak valid.');
        }

        let query = this.db
            .from('cbt_question_bank_validations')
            .select(
                `id, bank_id, folder_id, title, instructions, deadline, approval_rule, status, round, resubmitted_at, allow_edit_during_exam, created_at, updated_at,
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
            throw new BadRequestException('Daftar validasi belum dapat dimuat. Silakan coba lagi.');
        }

        const rows = (data as any[]) || [];
        const visible = await this.authz.isRestrictedProctor(user, user.organizationId!)
            ? rows.filter(row => row.bank?.created_by === user.id || row.bank?.is_published === true) : rows;
        return this.withFolders(visible, user.organizationId!);
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
                 bank:cbt_question_banks(*, creator:cbt_profiles!cbt_question_banks_created_by_fkey(full_name)),
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
            .from('cbt_question_bank_validators').select('id, status')
            .eq('validation_id', validationId).eq('validator_id', user.id).maybeSingle();
        if (assignmentError) throw new BadRequestException('Gagal memeriksa penugasan validator.');
        if (!assignment) {
            await this.authz.assertBankAccess(user, (val as any).bank_id, 'read');
            const permission = await this.authz.collaborationPermissions(user, 'bank', (val as any).bank_id);
            const publishedProctor = (val as any).bank?.is_published === true &&
                await this.authz.isRestrictedProctor(user, (val as any).organization_id);
            if (!permission.owner && !permission.admin && !permission.grant && !publishedProctor) {
                throw new ForbiddenException('Sesi validasi hanya tersedia bagi pembuat, kolaborator, atau validator yang ditugaskan.');
            }
            return val;
        }
        return (assignment as AssignmentRow).status === 'submitted' ? val : this.hideOtherReviews(val as any, user.id);
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
                    id, organization_id, folder_id, title, instructions, deadline, approval_rule, status, round, created_at,
                    bank:cbt_question_banks(id, title, subject, class_level, created_by, is_published, creator:cbt_profiles!cbt_question_banks_created_by_fkey(full_name)),
                    assigned_by:cbt_profiles!cbt_question_bank_validations_created_by_fkey(full_name)
                 )`,
            )
            .eq('validator_id', user.id)
            .order('created_at', { ascending: false });

        if (error) {
            this.logger.error(`Gagal membaca tugas validasi guru: ${error.message}`);
            throw new BadRequestException('Tugas validasi belum dapat dimuat. Silakan coba lagi.');
        }

        // Hanya tugas dari sekolah user sendiri; penugasan lintas sekolah tidak ditampilkan.
        const rows = ((data as any[]) || [])
            .filter(row => user.isPlatformAdmin || row.validation?.organization_id === user.organizationId);
        const visible = await this.authz.isRestrictedProctor(user, user.organizationId!)
            ? rows.filter(row => row.validation?.bank?.created_by === user.id || row.validation?.bank?.is_published === true) : rows;
        return this.withFolders(visible, user.organizationId!, true);
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
            this.logger.error(`Gagal memuat soal validasi ${validationId}: ${qErr.message}`);
            throw new BadRequestException('Soal belum dapat dimuat. Silakan coba lagi.');
        }

        // Ambil catatan-catatan yang sudah dibuat
        const { data: notes, error: notesErr } = await this.db
            .from('cbt_question_validation_notes')
            .select('*, validator:cbt_profiles!cbt_question_validation_notes_validator_id_fkey(full_name)')
            .eq('validation_id', validationId)
            .order('created_at', { ascending: true });

        if (notesErr) {
            this.logger.error(`Gagal membaca catatan validasi: ${notesErr.message}`);
            // Jangan tampilkan lembar seolah belum ada catatan.
            throw new BadRequestException('Catatan validasi belum dapat dimuat. Silakan coba lagi.');
        }

        const { data: items, error: itemsErr } = await this.db
            .from('cbt_question_validation_items')
            .select('*')
            .eq('validation_id', validationId);
        if (itemsErr) {
            this.logger.error(`Gagal membaca status butir validasi: ${itemsErr.message}`);
            throw new BadRequestException('Status butir validasi belum dapat dimuat. Silakan coba lagi.');
        }
        // Validator yang belum mengirim hasil hanya melihat penilaiannya sendiri.
        const seesAll = !vAssignment || (vAssignment as AssignmentRow).status === 'submitted';
        const visible = <T extends { validator_id?: string }>(rows: T[]) => seesAll ? rows : rows.filter(row => row.validator_id === user.id);

        // Use the same school profile and organization-logo fallback as PAS reports.
        const [{ data: schoolProfile }, { data: organization }] = await Promise.all([
            this.db.from('profil_sekolah')
                .select('nama, jenjang, jenis, alamat, desa_kelurahan, kecamatan, kabupaten_kota, provinsi, kode_pos, telepon, email, website, logo_url')
                .limit(1).maybeSingle(),
            this.db.from('cbt_organizations').select('name, logo_url')
                .eq('id', validation.organization_id).maybeSingle(),
        ]);

        return {
            validation,
            profil_sekolah: {
                ...(schoolProfile || {}),
                nama: schoolProfile?.nama || organization?.name || 'MADRASAH',
                logo_url: schoolProfile?.logo_url || organization?.logo_url || null,
            },
            myValidatorStatus: vAssignment,
            questions: ((questions as any[]) || [])
                .filter(q => !q.metadata?._deleted)
                .map(q => ({
                    ...q,
                    // Urutan opsi harus sama dengan editor & ujian agar huruf A/B/C
                    // yang dirujuk validator cocok dengan yang dilihat siswa.
                    bank_question_options: dedupeOptions(q.bank_question_options || []),
                }))
                .sort(compareQuestions),
            notes: visible((notes as any[]) || []),
            items: visible((items as any[]) || []),
        };
    }

    /**
     * Simpan catatan penandaan teks / per butir soal oleh validator.
     */
    async saveNote(user: AuthUser, validationId: string, dto: SaveValidationNoteDto) {
        const note = await this.db.transaction(async (tx) => {
            await advisoryTransactionLock(tx, `validation:${validationId}`);
            const { session, assignment } = await this.requireEditable(tx, user, validationId);
            const question = await this.questionInBank(tx, session.bank_id, dto.questionId);
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

            await this.markInProgress(tx, validationId, session, assignment);

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
                    round: session.round ?? 1,
                    // Versi soal saat dicatat: pembuat soal & validator dapat melihat
                    // apakah soal benar-benar diubah sesudahnya.
                    question_revision: question.revision ?? null,
                })
                .select('*')
                .single();

            if (error) {
                this.logger.error(`Gagal menyimpan catatan validasi: ${error.message}`);
                throw new BadRequestException('Gagal menyimpan catatan. Silakan coba lagi.');
            }

            return newNote;
        });

        return note;
    }

    /**
     * Hapus catatan yang dibuat oleh validator tersebut.
     */
    async deleteNote(user: AuthUser, validationId: string, noteId: string) {
        await this.db.transaction(async (tx) => {
            await advisoryTransactionLock(tx, `validation:${validationId}`);
            const { session } = await this.requireEditable(tx, user, validationId);

            const { data: note, error: noteError } = await tx
                .from('cbt_question_validation_notes').select('id, validator_id, is_resolved, round')
                .eq('id', noteId).eq('validation_id', validationId).maybeSingle();
            if (noteError) throw new BadRequestException('Catatan validasi tidak dapat dibaca.');
            if (!note) throw new NotFoundException('Catatan validasi tidak ditemukan.');
            if (note.validator_id !== user.id) {
                throw new ForbiddenException('Anda hanya dapat menghapus catatan milik sendiri.');
            }
            if (note.is_resolved) {
                throw new BadRequestException('Catatan yang sudah ditandai diperbaiki oleh pembuat soal tidak dapat dihapus.');
            }
            if ((note.round ?? 1) < (session.round ?? 1)) {
                throw new BadRequestException('Catatan dari putaran sebelumnya tidak dapat dihapus; nilai perbaikannya dengan Diterima atau Belum sesuai.');
            }

            const { error } = await tx
                .from('cbt_question_validation_notes')
                .delete()
                .eq('id', noteId)
                .eq('validation_id', validationId)
                .eq('validator_id', user.id);
            if (error) {
                this.logger.error(`Gagal menghapus catatan validasi ${noteId}: ${error.message}`);
                throw new BadRequestException('Gagal menghapus catatan. Silakan coba lagi.');
            }
        });

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
            const session = await this.readSession(tx, validationId);
            await this.authz.assertOrgStaff(user, session.organization_id);
            this.assertWithinDeadline(session);
            if ((session.round ?? 1) > 1) {
                // Telaah ulang: setiap perbaikan atas catatan sendiri harus dinilai dulu.
                const { data: ownNotes, error: ownNotesError } = await tx.from('cbt_question_validation_notes')
                    .select('id, round, verification, status_item').eq('validation_id', validationId).eq('validator_id', user.id);
                if (ownNotesError) throw new BadRequestException('Catatan putaran sebelumnya belum dapat diperiksa.');
                const unchecked = ((ownNotes || []) as Array<{ round?: number | null; verification?: string | null; status_item?: string }>)
                    .filter(row => row.status_item !== 'valid' && (row.round ?? 1) < (session.round ?? 1) && !row.verification);
                if (unchecked.length) {
                    throw new BadRequestException(`Nilai dulu ${unchecked.length} perbaikan dari putaran sebelumnya (Diterima/Belum sesuai) sebelum mengirim hasil.`);
                }
            }
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
            const status = computeValidationStatus(session, validators as ValidatorRecommendation[], this.waitingStatus(session));
            const { error: statusError } = await tx.from('cbt_question_bank_validations')
                .update({ status, updated_at: now }).eq('id', validationId);
            if (statusError) throw new BadRequestException('Gagal memperbarui status validasi.');
            // Older reviews predate owner notifications. Identical resubmissions
            // recover a missing notification while retaining retry deduplication.
            await this.notifyOwner(tx, validationId, session.organization_id, session.bank_id, !changed);
        });
        return { success: true };
    }

    /** Ubah isi/kategori/status catatan sendiri selama hasil belum dikirim. */
    async updateNote(user: AuthUser, validationId: string, noteId: string, dto: UpdateValidationNoteDto) {
        return this.db.transaction(async (tx) => {
            await advisoryTransactionLock(tx, `validation:${validationId}`);
            const { session } = await this.requireEditable(tx, user, validationId);
            const { data: note, error } = await tx.from('cbt_question_validation_notes')
                .select('id, validator_id, is_resolved, round').eq('id', noteId).eq('validation_id', validationId).maybeSingle();
            if (error) throw new BadRequestException('Catatan validasi tidak dapat dibaca.');
            if (!note) throw new NotFoundException('Catatan validasi tidak ditemukan.');
            if (note.validator_id !== user.id) throw new ForbiddenException('Anda hanya dapat mengubah catatan milik sendiri.');
            if (note.is_resolved) throw new BadRequestException('Catatan yang sudah ditandai diperbaiki tidak dapat diubah.');
            if ((note.round ?? 1) < (session.round ?? 1)) {
                throw new BadRequestException('Catatan dari putaran sebelumnya tidak dapat diubah; nilai perbaikannya dengan Diterima atau Belum sesuai.');
            }
            const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };
            if (dto.comment !== undefined) {
                if (!dto.comment.trim()) throw new BadRequestException('Catatan tidak boleh kosong.');
                payload.comment = dto.comment.trim();
            }
            if (dto.category !== undefined) payload.category = dto.category;
            if (dto.statusItem !== undefined) payload.status_item = dto.statusItem;
            const { data: updated, error: updateError } = await tx.from('cbt_question_validation_notes')
                .update(payload).eq('id', noteId).eq('validator_id', user.id).select('*').single();
            if (updateError) throw new BadRequestException('Gagal mengubah catatan. Silakan coba lagi.');
            return updated;
        });
    }

    /** Kelayakan satu butir menurut validator (Layak/Revisi/Tolak), tanpa harus menulis catatan. */
    async setItemStatus(user: AuthUser, validationId: string, questionId: string, status: 'valid' | 'revision' | 'rejected') {
        return this.db.transaction(async (tx) => {
            await advisoryTransactionLock(tx, `validation:${validationId}`);
            const { session, assignment } = await this.requireEditable(tx, user, validationId);
            const question = await this.questionInBank(tx, session.bank_id, questionId);
            const now = new Date().toISOString();
            const values = { status, round: session.round ?? 1, question_revision: question.revision ?? null, updated_at: now };
            const { data: existing, error: readError } = await tx.from('cbt_question_validation_items').select('id')
                .eq('validation_id', validationId).eq('question_id', questionId).eq('validator_id', user.id).maybeSingle();
            if (readError) throw new BadRequestException('Status butir belum dapat dibaca.');
            const result = existing
                ? await tx.from('cbt_question_validation_items').update(values).eq('id', (existing as { id: string }).id).select('*').single()
                : await tx.from('cbt_question_validation_items').insert({
                    validation_id: validationId, question_id: questionId, validator_id: user.id, ...values,
                }).select('*').single();
            if (result.error) throw new BadRequestException('Gagal menyimpan status butir. Silakan coba lagi.');
            await this.markInProgress(tx, validationId, session, assignment);
            return result.data;
        });
    }

    /**
     * Validator menilai perbaikan atas catatannya dari putaran sebelumnya.
     * "Belum sesuai" membuka kembali catatan itu untuk pembuat soal.
     */
    async verifyNote(user: AuthUser, validationId: string, noteId: string, verification: 'accepted' | 'not_fixed') {
        return this.db.transaction(async (tx) => {
            await advisoryTransactionLock(tx, `validation:${validationId}`);
            const { session, assignment } = await this.requireEditable(tx, user, validationId);
            const { data: note, error } = await tx.from('cbt_question_validation_notes')
                .select('id, validator_id, is_resolved, round').eq('id', noteId).eq('validation_id', validationId).maybeSingle();
            if (error) throw new BadRequestException('Catatan validasi tidak dapat dibaca.');
            if (!note) throw new NotFoundException('Catatan validasi tidak ditemukan.');
            if (note.validator_id !== user.id) throw new ForbiddenException('Anda hanya dapat menilai perbaikan atas catatan sendiri.');
            if ((note.round ?? 1) >= (session.round ?? 1)) {
                throw new BadRequestException('Catatan ini belum melalui putaran perbaikan oleh pembuat soal.');
            }
            if (verification === 'accepted' && !note.is_resolved) {
                throw new BadRequestException('Pembuat soal belum menandai catatan ini diperbaiki.');
            }
            const now = new Date().toISOString();
            const payload: Record<string, unknown> = verification === 'accepted'
                ? { verification, verified_at: now, updated_at: now }
                : { verification, verified_at: now, updated_at: now, is_resolved: false, resolved_by: null, resolved_at: null };
            const { data: updated, error: updateError } = await tx.from('cbt_question_validation_notes')
                .update(payload).eq('id', noteId).select('*').single();
            if (updateError) throw new BadRequestException('Gagal menyimpan penilaian perbaikan. Silakan coba lagi.');
            await this.markInProgress(tx, validationId, session, assignment);
            return updated;
        });
    }

    /**
     * Buka kembali hasil yang sudah dikirim agar catatan dapat diubah. Status
     * sesi dihitung ulang; pengiriman berikutnya kembali memberi tahu pembuat soal.
     */
    async reopen(user: AuthUser, validationId: string) {
        await this.db.transaction(async (tx) => {
            await advisoryTransactionLock(tx, `validation:${validationId}`);
            const session = await this.readSession(tx, validationId);
            await this.authz.assertOrgStaff(user, session.organization_id);
            const { data: assignment, error } = await tx.from('cbt_question_bank_validators')
                .select('id, status').eq('validation_id', validationId).eq('validator_id', user.id).maybeSingle();
            if (error) throw new BadRequestException('Gagal memeriksa penugasan validator.');
            if (!assignment) throw new ForbiddenException('Anda bukan validator untuk tugas ini.');
            if ((assignment as AssignmentRow).status !== 'submitted') return;
            this.assertWithinDeadline(session);
            const now = new Date().toISOString();
            const { error: reopenError } = await tx.from('cbt_question_bank_validators')
                .update({ status: 'in_progress', updated_at: now }).eq('id', (assignment as AssignmentRow).id);
            if (reopenError) throw new BadRequestException('Gagal membuka kembali hasil validasi.');
            const { data: validators, error: validatorsError } = await tx.from('cbt_question_bank_validators')
                .select('status, general_recommendation').eq('validation_id', validationId);
            if (validatorsError) throw new BadRequestException('Gagal membaca rekomendasi validator.');
            const status = computeValidationStatus(session, (validators || []) as ValidatorRecommendation[], this.waitingStatus(session));
            if (status !== session.status) {
                const { error: statusError } = await tx.from('cbt_question_bank_validations')
                    .update({ status, updated_at: now }).eq('id', validationId);
                if (statusError) throw new BadRequestException('Gagal memperbarui status validasi.');
            }
        });
        return { success: true };
    }

    /**
     * Pembuat soal mengajukan telaah ulang setelah semua catatan ditandai
     * diperbaiki. Putaran naik, validator ditugaskan kembali dan diberi tahu.
     */
    async resubmit(user: AuthUser, validationId: string) {
        return this.db.transaction(async (tx) => {
            await advisoryTransactionLock(tx, `validation:${validationId}`);
            const session = await this.readSession(tx, validationId);
            await this.authz.assertBankAccess(user, session.bank_id, 'write', tx);
            if (!['revision_needed', 'rejected'].includes(session.status)) {
                throw new BadRequestException('Telaah ulang hanya dapat diajukan setelah hasil validasi menyatakan perlu revisi atau ditolak.');
            }
            const { data: notes, error: notesError } = await tx.from('cbt_question_validation_notes')
                .select('id, status_item, is_resolved').eq('validation_id', validationId);
            if (notesError) throw new BadRequestException('Catatan validasi belum dapat diperiksa.');
            const open = ((notes || []) as Array<{ status_item?: string; is_resolved?: boolean }>)
                .filter(note => note.status_item !== 'valid' && !note.is_resolved);
            if (open.length) {
                throw new BadRequestException(`Masih ada ${open.length} catatan yang belum ditandai diperbaiki. Tandai setiap catatan (beri tanggapan bila soal tidak diubah) sebelum mengajukan telaah ulang.`);
            }
            const { data: validators, error: validatorsError } = await tx.from('cbt_question_bank_validators')
                .select('id, validator_id').eq('validation_id', validationId);
            if (validatorsError || !validators?.length) throw new BadRequestException('Validator sesi ini belum dapat dibaca.');
            const { data: bank } = await tx.from('cbt_question_banks').select('title').eq('id', session.bank_id).maybeSingle();

            const round = (session.round ?? 1) + 1;
            const now = new Date().toISOString();
            const sessionUpdate: Record<string, unknown> = { status: 'resubmitted', round, resubmitted_at: now, updated_at: now };
            // Batas waktu putaran pertama yang sudah lewat tidak boleh mengunci telaah ulang.
            if (isValidationDeadlinePassed(session.deadline)) sessionUpdate.deadline = null;
            const { error: updateError } = await tx.from('cbt_question_bank_validations')
                .update(sessionUpdate).eq('id', validationId);
            if (updateError) throw new BadRequestException('Gagal mengajukan telaah ulang. Silakan coba lagi.');
            const { error: resetError } = await tx.from('cbt_question_bank_validators')
                .update({ status: 'assigned', general_recommendation: null, submitted_at: null, updated_at: now })
                .eq('validation_id', validationId);
            if (resetError) throw new BadRequestException('Gagal menugaskan kembali validator.');
            await this.notifyValidators(tx, session.organization_id, validationId,
                (validators as Array<{ validator_id: string }>).map(row => row.validator_id),
                'Perbaikan soal siap ditelaah ulang',
                `Pembuat soal telah memperbaiki bank soal "${(bank as { title?: string } | null)?.title || 'Bank Soal'}". Periksa perbaikannya pada putaran ${round}.`);
            return { round, status: 'resubmitted' as const };
        });
    }

    /** Admin/Proktor: ubah judul, instruksi, batas waktu, dan anggota validator. */
    async updateSession(user: AuthUser, validationId: string, dto: UpdateValidationDto) {
        await this.db.transaction(async (tx) => {
            await advisoryTransactionLock(tx, `validation:${validationId}`);
            const session = await this.readSession(tx, validationId);
            await this.authz.assertProktor(user, session.organization_id);
            if (await this.authz.isRestrictedProctor(user, session.organization_id)) {
                await this.authz.assertBankAccess(user, session.bank_id, 'read', tx);
            }
            const now = new Date().toISOString();
            const payload: Record<string, unknown> = {};
            if (dto.folderId !== undefined) {
                await this.assertFolderUsable(tx, dto.folderId, session.organization_id);
                payload.folder_id = dto.folderId || null;
            }
            if (dto.title !== undefined) {
                if (!dto.title.trim()) throw new BadRequestException('Judul validasi tidak boleh kosong.');
                payload.title = dto.title.trim();
            }
            if (dto.instructions !== undefined) payload.instructions = dto.instructions.trim();
            if (dto.deadline !== undefined) {
                if (dto.deadline === null) payload.deadline = null;
                else {
                    const parsed = new Date(dto.deadline);
                    if (Number.isNaN(parsed.getTime())) throw new BadRequestException('Format batas waktu tidak valid.');
                    if (parsed.getTime() <= Date.now()) throw new BadRequestException('Batas waktu validasi harus di masa depan.');
                    payload.deadline = parsed.toISOString();
                }
            }

            const addIds = Array.from(new Set(dto.addValidatorIds || []));
            const removeIds = Array.from(new Set(dto.removeValidatorIds || []));
            if (addIds.length || removeIds.length) {
                if (!RUNNING_STATUSES.includes(session.status)) {
                    throw new BadRequestException('Validator hanya dapat diubah selama sesi validasi masih berjalan.');
                }
                const { data: current, error: currentError } = await tx.from('cbt_question_bank_validators')
                    .select('id, validator_id, status').eq('validation_id', validationId);
                if (currentError) throw new BadRequestException('Validator sesi ini belum dapat dibaca.');
                const rows = (current || []) as Array<{ id: string; validator_id: string; status: string }>;
                const removeRows = rows.filter(row => removeIds.includes(row.validator_id));
                if (removeRows.length !== removeIds.length) throw new BadRequestException('Validator yang dikeluarkan tidak terdaftar pada sesi ini.');
                if (removeRows.length) {
                    const { data: written, error: writtenError } = await tx.from('cbt_question_validation_notes')
                        .select('validator_id').eq('validation_id', validationId).in('validator_id', removeIds);
                    if (writtenError) throw new BadRequestException('Catatan validator belum dapat diperiksa.');
                    if (removeRows.some(row => row.status !== 'assigned') || (written || []).length) {
                        throw new BadRequestException('Validator yang sudah mulai menelaah atau menulis catatan tidak dapat dikeluarkan.');
                    }
                }
                const toAdd = addIds.filter(id => !rows.some(row => row.validator_id === id));
                if (rows.length - removeRows.length + toAdd.length < 1) {
                    throw new BadRequestException('Sesi validasi harus memiliki minimal satu validator.');
                }
                if (toAdd.length) {
                    const { data: bank, error: bankError } = await tx.from('cbt_question_banks')
                        .select('created_by, title').eq('id', session.bank_id).maybeSingle();
                    if (bankError || !bank) throw new BadRequestException('Bank soal belum dapat dibaca.');
                    await this.assertEligibleValidators(session.bank_id, session.organization_id, toAdd, (bank as { created_by: string | null }).created_by);
                    const { error: insertError } = await tx.from('cbt_question_bank_validators').insert(toAdd.map(validatorId => ({
                        validation_id: validationId, validator_id: validatorId, status: 'assigned',
                    })));
                    if (insertError) throw new BadRequestException('Gagal menambahkan validator. Silakan coba lagi.');
                    await this.notifyValidators(tx, session.organization_id, validationId, toAdd,
                        'Tugas validasi soal baru',
                        `Anda ditunjuk menelaah bank soal "${(bank as { title?: string }).title || 'Bank Soal'}".`);
                }
                if (removeRows.length) {
                    const { error: deleteError } = await tx.from('cbt_question_bank_validators')
                        .delete().in('id', removeRows.map(row => row.id));
                    if (deleteError) throw new BadRequestException('Gagal mengeluarkan validator. Silakan coba lagi.');
                }
                const { data: validators, error: validatorsError } = await tx.from('cbt_question_bank_validators')
                    .select('status, general_recommendation').eq('validation_id', validationId);
                if (validatorsError) throw new BadRequestException('Gagal membaca rekomendasi validator.');
                const status = computeValidationStatus(session, (validators || []) as ValidatorRecommendation[], this.waitingStatus(session, true));
                if (status !== session.status) payload.status = status;
            }
            if (!Object.keys(payload).length) return;
            payload.updated_at = now;
            const { error: updateError } = await tx.from('cbt_question_bank_validations').update(payload).eq('id', validationId);
            if (updateError) throw new BadRequestException('Gagal menyimpan perubahan sesi validasi.');
        });
        return { success: true };
    }

    /** Hapus sesi beserta catatannya: hanya pembuat sesi atau Admin. */
    async removeSession(user: AuthUser, validationId: string) {
        await this.db.transaction(async (tx) => {
            await advisoryTransactionLock(tx, `validation:${validationId}`);
            const session = await this.readSession(tx, validationId);
            await this.authz.assertProktor(user, session.organization_id);
            const restricted = await this.authz.isRestrictedProctor(user, session.organization_id);
            if (restricted && session.created_by !== user.id) {
                throw new ForbiddenException('Sesi validasi hanya dapat dihapus oleh pembuat sesi atau Admin.');
            }
            const { error } = await tx.from('cbt_question_bank_validations').delete().eq('id', validationId);
            if (error) throw new BadRequestException('Gagal menghapus sesi validasi. Silakan coba lagi.');
        });
        return { id: validationId, deleted: true };
    }

    async decide(user: AuthUser, validationId: string, status: 'approved' | 'revision_needed' | 'rejected') {
        await this.db.transaction(async (tx) => {
            await advisoryTransactionLock(tx, `validation:${validationId}`);
            const { data: session, error } = await tx.from('cbt_question_bank_validations')
                .select('organization_id, approval_rule, status, bank_id').eq('id', validationId).single();
            if (error || !session) throw new NotFoundException('Sesi validasi tidak ditemukan.');
            await this.authz.assertProktor(user, session.organization_id);
            // Proktor terbatas hanya boleh memutuskan bank yang boleh ia baca
            // (miliknya atau yang sudah dipublikasikan), sama seperti getDetail.
            if (await this.authz.isRestrictedProctor(user, session.organization_id)) {
                await this.authz.assertBankAccess(user, session.bank_id, 'read', tx);
            }
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
    async resolveNote(user: AuthUser, noteId: string, resolved: boolean, response?: string) {
        const { data: note, error: nErr } = await this.db
            .from('cbt_question_validation_notes')
            .select('validation_id, validation:cbt_question_bank_validations(bank_id, organization_id, status)')
            .eq('id', noteId)
            .maybeSingle();

        if (nErr || !note) {
            throw new NotFoundException('Catatan validasi tidak ditemukan.');
        }

        const bankId = (note as any).validation?.bank_id;
        if (!bankId) {
            // Tolak bila bank tidak dapat dipastikan; jangan jatuh ke izin staf umum.
            throw new NotFoundException('Catatan validasi tidak ditemukan.');
        }
        return this.db.transaction(async (tx) => {
            await advisoryTransactionLock(tx, `validation:${note.validation_id}`);
            const session = await this.readSession(tx, note.validation_id);
            if (session.bank_id !== bankId) throw new NotFoundException('Catatan validasi tidak ditemukan.');
            await this.authz.assertBankAccess(user, bankId, 'write', tx);
            // Re-read after the lock: resubmission may have started while this request waited.
            if (session.status === 'resubmitted') {
                throw new BadRequestException('Perbaikan sedang ditelaah ulang validator. Tunggu hasil telaah sebelum mengubah tanda perbaikan.');
            }

            const extra: Record<string, unknown> = { verification: null, verified_at: null };
            if (response !== undefined) extra.owner_response = response.trim();
            const { data: updated, error } = await tx.from('cbt_question_validation_notes')
                .update({
                    is_resolved: resolved,
                    resolved_by: resolved ? user.id : null,
                    resolved_at: resolved ? new Date().toISOString() : null,
                    updated_at: new Date().toISOString(),
                    ...extra,
                }).eq('id', noteId).eq('validation_id', session.id).select('*').single();
            if (error) {
                this.logger.error(`Gagal memperbarui status perbaikan catatan ${noteId}: ${error.message}`);
                throw new BadRequestException('Gagal memperbarui status perbaikan. Silakan coba lagi.');
            }
            return updated;
        });
    }

    /**
     * Seluruh catatan perbaikan untuk satu bank soal (untuk ditampilkan di editor guru pembuat).
     */
    async getBankFeedback(user: AuthUser, bankId: string) {
        await this.authz.assertBankAccess(user, bankId, 'read');

        const { data: validations, error: valErr } = await this.db
            .from('cbt_question_bank_validations')
            .select(
                `id, title, status, round, resubmitted_at, deadline, created_at,
                 validators:cbt_question_bank_validators(
                    id, validator_id, status, general_recommendation, general_comment, submitted_at,
                    profile:cbt_profiles(full_name)
                 ),
                 notes:cbt_question_validation_notes(
                    id, validation_id, validator_id, created_at, question_id, target_scope, target_option_id, selected_text, comment, category, status_item, is_resolved, resolved_at,
                    round, question_revision, verification, verified_at, owner_response,
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
