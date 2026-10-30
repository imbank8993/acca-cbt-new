import { collaborationGrants, collaboratorCounts } from '../common/collaboration-access';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { AuthUser } from '@acca-cbt/shared';
import { AuthUsersRepository } from '../auth/auth-users.repository';
import { AuthorizationService } from '../auth/authorization.service';
import { CbtRolesService } from '../auth/cbt-roles.service';
import { insertIdempotently } from '../common/idempotent-create';
import { DbService } from '../prisma/prisma-db-adapter';

/** Kode galat PostgreSQL untuk pelanggaran batasan unik. */
const UNIQUE_VIOLATION = '23505';

export interface BankInput {
    expectedUpdatedAt?: string;
    clientRequestId?: string;
    title?: string;
    description?: string;
    subject?: string;
    classLevel?: string;
    iconIdentifier?: string;
    imageUrl?: string;
    tags?: string[];
    folderId?: string | null;
}

/**
 * Bank soal beserta folder dan labelnya.
 *
 * Dipindahkan dari `apps/web/app/actions/question.ts`. Perubahan yang disengaja:
 *
 *  - `userId` tidak lagi diterima. `createQuestionBank` dan `createBankFolder`
 *    menerimanya sebagai parameter tetapi sudah mengabaikannya demi identitas
 *    sesi; sisanya memakainya sebagai cadangan otorisasi ketika sesi tidak
 *    terbaca — cadangan yang justru berarti otorisasi bisa dilewati dengan
 *    mengirim UUID orang lain tanpa sesi sama sekali.
 *  - Kepemilikan Guru diperiksa lewat `assertBankAccess`, bukan disalin ulang
 *    sebagai blok `if (authCtx) { … }` di tujuh fungsi berbeda. Blok itu diam
 *    saja bila sesinya tidak terbaca, sehingga kegagalan pembacaan sesi
 *    berarti tidak ada pemeriksaan kepemilikan sama sekali.
 *  - `organizationId` untuk penulisan selalu diambil dari baris banknya.
 */
@Injectable()
export class QuestionBanksService {
    private readonly logger = new Logger(QuestionBanksService.name);

    constructor(
        private readonly db: DbService,
        private readonly authz: AuthorizationService,
        private readonly roles: CbtRolesService,
        private readonly authUsers: AuthUsersRepository,
    ) {}

    // ── Bank soal ────────────────────────────────────────────────────────────

    /**
     * Daftar bank soal satu organisasi.
     *
     * Guru melihat bank buatannya sendiri. Proktor juga dapat membaca bank orang
     * lain yang dipublikasikan; Admin dan admin platform melihat seluruh bank.
     */
    async list(user: AuthUser, organizationId: string, onlyPublished = false) {
        await this.authz.assertOrgStaff(user, organizationId);

        let query = this.db
            .from('cbt_question_banks')
            .select(
                `*, profiles:cbt_profiles(full_name),
                 bank_questions:cbt_bank_questions(id, metadata),
                 bank_folders(id, name)`,
            )
            .eq('organization_id', organizationId);
        if (onlyPublished) query = query.eq('is_published', true);

        const elevated = await this.isElevated(user, organizationId);
        const restrictedProctor = await this.roles.hasOrgRole(user.id, organizationId, ['Proktor']) &&
            !user.isPlatformAdmin && !user.resolved?.superadmin && !await this.roles.hasOrgRole(user.id, organizationId, ['Admin']);
        const grants = await collaborationGrants(this.db, 'bank', user.id);
        const sharedIds = [...grants.keys()];
        const collaboration = await this.authz.collaborationListContext(user, organizationId, 'bank');
        const sharedClause = sharedIds.length ? `,id.in.(${sharedIds.join(',')})` : '';
        if (restrictedProctor) query = query.or(`created_by.eq.${user.id},is_published.eq.true`);
        else if (!elevated) {
            query = sharedIds.length ? query.or(`created_by.eq.${user.id}${sharedClause}`) : query.eq('created_by', user.id);
        }

        const { data, error } = await query.order('created_at', { ascending: false });

        if (error) {
            this.logger.error(`Gagal membaca daftar bank soal: ${error.message}`);
            return [];
        }

        const banks = ((data as any[]) || []).filter(bank => !restrictedProctor || bank.created_by === user.id || bank.is_published === true);
        const counts = await collaboratorCounts(this.db, 'bank', banks.map(bank => bank.id));

        // Nama pembuat ditampilkan pada kartu bank. Profil bisa belum terisi —
        // akun yang datang lewat SSO sering hanya punya email — jadi awalan
        // email dipakai sebagai cadangan. Email diambil sekaligus untuk seluruh
        // pembuat, bukan satu per satu per bank.
        const creatorIds = [
            ...new Set(banks.map((bank) => bank.created_by).filter(Boolean) as string[]),
        ];
        const emails = await this.authUsers.emailMap(creatorIds);

        return banks.map((bank) => {
            const profileName = bank.profiles?.full_name;
            const known =
                profileName && profileName !== 'Unknown User' && profileName !== 'Unknown';

            const questionCount = (bank.bank_questions || []).filter((q: any) => !q.metadata?._deleted).length;

            const access = collaboration.access(bank, grants.get(bank.id));
            const grant = access.grant;
            return {
                ...bank,
                canManage: access.owner || access.admin || !!grant && ['editor', 'manager'].includes(grant.permission),
                isOwner: access.owner, canShare: access.canShare, canDelete: access.canDelete,
                collaborationPermission: grant?.permission || null,
                collaboratorCount: counts.get(bank.id) || 0,
                question_count: questionCount,
                total_questions: questionCount,
                folder_id: bank.folder_id,
                creator_name: known
                    ? profileName
                    : (emails.get(bank.created_by)?.split('@')[0] ?? 'Tidak diketahui'),
            };
        });
    }

    async get(user: AuthUser, bankId: string) {
        await this.authz.assertBankAccess(user, bankId, 'read');

        const { data } = await this.db
            .from('cbt_question_banks')
            .select('*')
            .eq('id', bankId)
            .maybeSingle();

        if (!data) throw new NotFoundException('Bank soal tidak ditemukan.');
        const bank = data as any;
        const access = await this.authz.collaborationPermissions(user, 'bank', bankId);
        const counts = await collaboratorCounts(this.db, 'bank', [bankId]);
        return { ...bank, canManage: access.owner || access.admin || !!access.grant && ['editor', 'manager'].includes(access.grant.permission),
            isOwner: access.owner, canShare: access.canShare, canDelete: access.canDelete, collaborationPermission: access.grant?.permission || null,
            collaboratorCount: counts.get(bankId) || 0 };
    }

    async create(user: AuthUser, organizationId: string, input: BankInput) {
        const resolved = await this.resolveOrganizationId(user, organizationId);
        await this.assertFolderOrganization(input.folderId, resolved);

        const data = await insertIdempotently<{ id: string }>(this.db, {
            table: 'cbt_question_banks',
            organizationId: resolved,
            clientRequestId: input.clientRequestId!,
            fingerprint: input,
            select: 'id',
            payload: {
                organization_id: resolved,
                // Kepemilikan adalah dasar seluruh pembatasan Guru, jadi
                // pembuatnya selalu dari token.
                created_by: user.id,
                title: input.title,
                description: input.description,
                subject: input.subject,
                class_level: input.classLevel,
                is_published: false,
                icon_identifier: input.iconIdentifier,
                image_url: input.imageUrl,
                tags: input.tags || [],
                folder_id: input.folderId || null,
            },
        });

        return { id: data.id };
    }

    async update(user: AuthUser, bankId: string, input: BankInput) {
        const organizationId = await this.authz.assertBankAccess(user, bankId);
        await this.assertFolderOrganization(input.folderId, organizationId);

        const payload: Record<string, unknown> = {};
        if (input.title !== undefined) payload.title = input.title;
        if (input.description !== undefined) payload.description = input.description;
        if (input.subject !== undefined) payload.subject = input.subject;
        if (input.classLevel !== undefined) payload.class_level = input.classLevel;
        if (input.iconIdentifier !== undefined) payload.icon_identifier = input.iconIdentifier;
        if (input.imageUrl !== undefined) payload.image_url = input.imageUrl;
        if (input.tags !== undefined) payload.tags = input.tags;
        if (input.folderId !== undefined) payload.folder_id = input.folderId || null;

        if (Object.keys(payload).length === 0) return { id: bankId };

        await this.db.transaction(async db => {
            await db.raw('SELECT id FROM public.cbt_question_banks WHERE id = $1::uuid FOR UPDATE', bankId);
            await this.authz.assertBankAccess(user, bankId, 'write', db);
            const current = await db.from('cbt_question_banks').select('updated_at').eq('id', bankId).maybeSingle();
            if (current.error) throw new BadRequestException('Versi bank soal belum dapat diperiksa.');
            if (input.expectedUpdatedAt && (!current.data?.updated_at ||
                Date.parse(input.expectedUpdatedAt) !== Date.parse(current.data.updated_at))) {
                throw new ConflictException('Bank soal telah diubah oleh pengguna lain. Muat ulang sebelum menyimpan.');
            }
            const result = await db.from('cbt_question_banks').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', bankId);
            if (result.error) throw new BadRequestException(result.error.message);
        });

        return { id: bankId };
    }

    async remove(user: AuthUser, bankId: string) {
        await this.authz.assertBankAccess(user, bankId, 'delete');

        const [{ data: direct, error: directError }, { data: sources, error: sourceError }] =
            await Promise.all([
                this.db.from('cbt_exams').select('id').eq('question_bank_id', bankId).limit(1),
                this.db.from('cbt_exam_question_sources').select('exam_id').eq('bank_id', bankId).limit(1),
            ]);

        if (directError) throw new BadRequestException(directError.message);
        if (sourceError) throw new BadRequestException(sourceError.message);
        if (((direct as any[]) || []).length > 0 || ((sources as any[]) || []).length > 0) {
            throw new BadRequestException(
                'Bank soal sudah terhubung ke ujian dan tidak dapat dihapus. ' +
                'Pertahankan bank ini sebagai arsip dan buat bank baru untuk perubahan berikutnya.',
            );
        }

        const { error } = await this.db.from('cbt_question_banks').delete().eq('id', bankId);
        if (error) throw new BadRequestException(error.message);

        return { id: bankId };
    }

    /**
     * Terbitkan atau tarik sebuah bank soal.
     *
     * Saat ditarik, ujian yang SEDANG berjalan memakai bank ini dikembalikan
     * supaya layar bisa memperingatkan — menariknya di tengah ujian berarti
     * peserta kehilangan soalnya.
     */
    async setPublished(user: AuthUser, bankId: string, isPublished: boolean) {
        await this.authz.assertBankAccess(user, bankId);
        // Menerbitkan membuka bank (beserta kuncinya) untuk dibaca Proktor lain dan
        // dipakai di ujian siapa pun; menarik dapat mengganggu ujian berjalan.
        // Keputusan itu milik pembuat, Admin, atau pengelola — bukan editor.
        const access = await this.authz.collaborationPermissions(user, 'bank', bankId);
        if (!access.canShare) throw new ForbiddenException('Hanya pembuat, Admin, atau pengelola yang dapat menerbitkan atau menarik bank soal.');

        let activeExams: Array<{ id: string; title: string }> = [];
        if (!isPublished) {
            const { data } = await this.db
                .from('cbt_exams')
                .select('id, title')
                .eq('question_bank_id', bankId)
                .eq('is_published', true)
                .eq('status', 'active');

            activeExams = (data as Array<{ id: string; title: string }>) || [];
        }

        const { error } = await this.db
            .from('cbt_question_banks')
            .update({ is_published: isPublished })
            .eq('id', bankId);

        if (error) throw new BadRequestException(error.message);

        return { id: bankId, is_published: isPublished, activeExams };
    }

    /**
     * Pindahkan satu atau beberapa bank ke sebuah folder.
     *
     * Tiap bank diperiksa sendiri: satu permintaan bisa saja memuat bank milik
     * guru lain di antara bank milik pemanggil.
     */
    async moveToFolder(user: AuthUser, bankIds: string[], folderId: string | null) {
        for (const bankId of bankIds) {
            const organizationId = await this.authz.assertBankAccess(user, bankId);
            await this.assertFolderOrganization(folderId, organizationId);
        }

        const { error } = await this.db
            .from('cbt_question_banks')
            .update({ folder_id: folderId })
            .in('id', bankIds);

        if (error) throw new BadRequestException(error.message);

        return { moved: bankIds.length, folderId };
    }

    // ── Folder ───────────────────────────────────────────────────────────────

    async listFolders(user: AuthUser, organizationId: string) {
        await this.authz.assertOrgStaff(user, organizationId);

        const query = this.db.from('bank_folders').select('*').eq('organization_id', organizationId);

        const { data, error } = await query.order('created_at', { ascending: true });

        if (error) {
            this.logger.error(`Gagal membaca daftar folder: ${error.message}`);
            return [];
        }
        return (data as any[]) || [];
    }

    async createFolder(user: AuthUser, organizationId: string, name: string, clientRequestId: string) {
        const resolved = await this.resolveOrganizationId(user, organizationId);

        const data = await insertIdempotently<{ id: string }>(this.db, {
            table: 'bank_folders', organizationId: resolved, clientRequestId,
            fingerprint: { name }, select: 'id',
            payload: { organization_id: resolved, created_by: user.id, name: name.trim() },
            mapError: (error) => this.describeWriteError(error, 'Folder'),
        });

        return { id: data.id };
    }

    async updateFolder(user: AuthUser, folderId: string, name: string) {
        await this.assertFolderAccess(user, folderId);

        const { error } = await this.db
            .from('bank_folders')
            .update({ name: name.trim(), updated_at: new Date().toISOString() })
            .eq('id', folderId);

        if (error) throw this.describeWriteError(error, 'Folder');

        return { id: folderId };
    }

    async removeFolder(user: AuthUser, folderId: string) {
        await this.assertFolderAccess(user, folderId);

        // Bank di dalamnya tidak ikut terhapus: relasinya ON DELETE SET NULL,
        // jadi banknya kembali ke akar.
        const { error } = await this.db.from('bank_folders').delete().eq('id', folderId);
        if (error) throw new BadRequestException(error.message);

        return { id: folderId };
    }

    // ── Label ────────────────────────────────────────────────────────────────

    async listLabels(user: AuthUser, organizationId: string) {
        await this.authz.assertOrgStaff(user, organizationId);

        const query = this.db.from('cbt_organization_labels').select('*').eq('organization_id', organizationId);

        const { data, error } = await query.order('created_at', { ascending: true });

        if (error) {
            this.logger.error(`Gagal membaca daftar label: ${error.message}`);
            return [];
        }
        return (data as any[]) || [];
    }

    async createLabel(
        user: AuthUser,
        organizationId: string,
        name: string,
        color: string,
        clientRequestId: string,
    ) {
        const resolved = await this.resolveOrganizationId(user, organizationId);

        const data = await insertIdempotently<{ id: string }>(this.db, {
            table: 'cbt_organization_labels', organizationId: resolved, clientRequestId,
            fingerprint: { name, color }, select: 'id',
            payload: {
                organization_id: resolved,
                name: name.trim(),
                color: color || '#6366f1',
            },
            mapError: (error) => this.describeWriteError(error, 'Label'),
        });

        return { id: data.id };
    }

    // ── Pembantu ─────────────────────────────────────────────────────────────

    private async isElevated(user: AuthUser, organizationId: string): Promise<boolean> {
        if (user.isPlatformAdmin || user.resolved?.superadmin === true) return true;
        return this.roles.hasOrgRole(user.id, organizationId, ['Proktor', 'Admin']);
    }

    /**
     * Organisasi untuk baris baru.
     *
     * ID sekolah tetap menjadi foreign key internal. Otorisasi memastikan ID
     * yang diterima sama dengan satu-satunya sekolah pada instalasi ini.
     */
    private async resolveOrganizationId(
        user: AuthUser,
        organizationId: string,
    ): Promise<string> {
        await this.authz.assertOrgStaff(user, organizationId);
        return organizationId;
    }

    private assertFolderAccess(user: AuthUser, folderId: string): Promise<void> {
        return this.authz.assertStaffByRecord(user, 'bank_folders', folderId);
    }

    private async assertFolderOrganization(folderId: string | null | undefined, organizationId: string) {
        if (!folderId) return;
        const { data, error } = await this.db.from('bank_folders')
            .select('id').eq('id', folderId).eq('organization_id', organizationId).maybeSingle();
        if (error || !data) throw new BadRequestException('Folder harus berasal dari organisasi bank soal yang sama.');
    }

    /**
     * Batasan unik punya arti yang bisa dijelaskan ke pengguna; sisanya tidak.
     * Tanpa ini, mencoba membuat folder dengan nama yang sudah ada memunculkan
     * pesan Postgres mentah beserta nama indeksnya.
     */
    private describeWriteError(error: { code?: string; message: string }, label: string) {
        return new BadRequestException(
            error.code === UNIQUE_VIOLATION ? `${label} dengan nama itu sudah ada.` : error.message,
        );
    }
}
