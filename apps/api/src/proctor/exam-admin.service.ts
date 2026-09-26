import {
    BadRequestException,
    ForbiddenException,
    Injectable,
    Logger,
    NotFoundException,
} from '@nestjs/common';
import type { AuthUser } from '@acca-cbt/shared';
import { AuthorizationService } from '../auth/authorization.service';
import { CbtRolesService } from '../auth/cbt-roles.service';
import { wibLocalToUtc } from '../common/wib-time';
import { DbService } from '../prisma/prisma-db-adapter';
import type { CreateExamDto, UpdateExamDto } from './dto/proctor.dto';

/** Jenis ujian yang hanya boleh dibuat dan diubah Proktor/Admin. */
const RESTRICTED_EXAM_TYPES = ['pas', 'pat'];

/**
 * Pengelolaan ujian oleh staf: membuat, mengubah, menerbitkan, dan menugaskan.
 *
 * Dipindahkan dari `apps/web/app/actions/proktor.ts`.
 *
 * Satu hal yang berubah bentuknya: `createExamAction` dulu menerima `userId`
 * dari klien lalu — di baris berikutnya — menimpanya dengan identitas sesi.
 * Parameternya sudah tidak berarti, tetapi keberadaannya menyesatkan: ia terbaca
 * seolah seorang Guru bisa membuat ujian atas nama Proktor untuk melewati
 * gerbang PAS/PAT. Di sini parameternya hilang sepenuhnya.
 */
@Injectable()
export class ExamAdminService {
    private readonly logger = new Logger(ExamAdminService.name);

    constructor(
        private readonly db: DbService,
        private readonly authz: AuthorizationService,
        private readonly roles: CbtRolesService,
    ) {}

    /**
     * Daftar ujian satu organisasi.
     *
     * Guru hanya melihat ujian buatannya sendiri — ujian milik proktor atau guru
     * lain tidak boleh muncul.
     */
    async list(user: AuthUser, organizationId: string) {
        await this.authz.assertOrgMonitoring(user, organizationId);

        let query = this.db.from('cbt_exams').select('*').eq('organization_id', organizationId);

        const canSeeAll =
            (await this.isElevated(user, organizationId)) ||
            (await this.roles.hasOrgRole(user.id, organizationId, ['Pengawas']));
        if (!canSeeAll) {
            query = query.eq('created_by', user.id);
        }

        const { data, error } = await query.order('created_at', { ascending: false });

        if (error) {
            this.logger.error(`Gagal membaca daftar ujian: ${error.message}`);
            return [];
        }

        const exams = (data as any[]) || [];
        const creatorIds = [
            ...new Set(exams.map((e) => e.created_by).filter(Boolean) as string[]),
        ];

        const creatorNames = new Map<string, string>();
        if (creatorIds.length > 0) {
            const { data: profiles } = await this.db
                .from('cbt_profiles')
                .select('id, full_name')
                .in('id', creatorIds);

            for (const profile of (profiles as Array<{
                id: string;
                full_name: string | null;
            }>) || []) {
                creatorNames.set(profile.id, profile.full_name || 'Tidak diketahui');
            }
        }

        return exams.map((exam) => ({
            ...exam,
            creatorName: creatorNames.get(exam.created_by) || 'Tidak diketahui',
        }));
    }

    async create(user: AuthUser, sessionOrganizationId: string, dto: CreateExamDto) {
        const organizationId = await this.resolveOrganizationId(user, sessionOrganizationId);

        // Tipe efektif dihitung LEBIH DULU, lalu gerbangnya diterapkan pada tipe
        // itu. Sebelumnya payload tanpa `examType` lolos gerbang tetapi tetap
        // tersimpan sebagai 'pas' — jalur persis yang gerbangnya dimaksudkan
        // untuk ditutup.
        const examType = dto.examType || 'pas';
        await this.assertMayUseExamType(user, organizationId, examType);

        this.assertValidDuration(examType, dto.duration);

        if (dto.questionBankId) {
            const { data: bank } = await this.db
                .from('cbt_question_banks')
                .select('is_published')
                .eq('id', dto.questionBankId)
                .maybeSingle();

            if (!(bank as { is_published?: boolean } | null)?.is_published) {
                throw new BadRequestException(
                    'Bank soal harus diterbitkan sebelum bisa dipakai untuk ujian.',
                );
            }
        }

        const { data, error } = await this.db
            .from('cbt_exams')
            .insert({
                organization_id: organizationId,
                question_bank_id: dto.questionBankId || null,
                title: dto.title.trim(),
                description: dto.description?.trim() || null,
                exam_type: examType,
                duration_minutes: dto.duration,
                subject_id: dto.subjectId || null,
                start_time: wibLocalToUtc(dto.startTime),
                end_time: wibLocalToUtc(dto.endTime),
                randomize_questions: dto.randomizeQuestions ?? true,
                randomize_options: dto.randomizeOptions ?? true,
                show_results: dto.showResults ?? false,
                is_published: false,
                status: 'draft',
                created_by: user.id,
                scoring_type: dto.scoringType || 'classical',
                metadata: this.buildMetadata(examType, dto, {}),
            })
            .select('id')
            .single();

        if (error) throw new BadRequestException(error.message);

        return { id: (data as { id: string }).id };
    }

    async update(user: AuthUser, examId: string, dto: UpdateExamDto) {
        await this.authz.assertExamStaff(user, examId);

        const { data } = await this.db
            .from('cbt_exams')
            .select('metadata, exam_type, organization_id')
            .eq('id', examId)
            .maybeSingle();

        if (!data) throw new NotFoundException('Ujian tidak ditemukan.');

        const existing = data as {
            metadata: Record<string, any> | null;
            exam_type: string | null;
            organization_id: string;
        };

        // `examType` kosong berarti PERTAHANKAN tipe lama. Nilai bawaan 'pas'
        // pernah membuat penyuntingan biasa diam-diam mengubah ujian menjadi PAS.
        const examType = dto.examType || existing.exam_type || 'daily';

        // `assertExamStaff` menutup penyuntingan ujian yang MEMANG PAS/PAT bagi
        // Guru. Cabang ini menutup arah sebaliknya: menaikkan ujian biasa
        // miliknya sendiri menjadi PAS/PAT.
        if (examType !== existing.exam_type) {
            await this.assertMayUseExamType(user, existing.organization_id, examType);
        }

        this.assertValidDuration(examType, dto.duration);

        const { error } = await this.db
            .from('cbt_exams')
            .update({
                title: dto.title,
                description: dto.description,
                exam_type: examType,
                duration_minutes: dto.duration,
                randomize_questions: dto.randomizeQuestions ?? true,
                randomize_options: dto.randomizeOptions ?? true,
                show_results: dto.showResults ?? false,
                scoring_type: dto.scoringType || 'classical',
                // Selalu ditulis, termasuk saat kosong: mengosongkan jadwal
                // adalah perubahan yang sah, dan melewatkannya membuat jadwal
                // lama tertinggal.
                start_time: wibLocalToUtc(dto.startTime),
                end_time: wibLocalToUtc(dto.endTime),
                metadata: this.buildMetadata(examType, dto, existing.metadata || {}),
            })
            .eq('id', examId);

        if (error) throw new BadRequestException(error.message);

        return { id: examId };
    }

    /**
     * Terbitkan atau tarik ujian.
     *
     * Menerbitkan menuntut ujian sudah punya sasaran: minimal satu kelas, atau
     * minimal satu peserta perorangan. Ujian publik dikecualikan.
     */
    async setPublished(user: AuthUser, examId: string, publish: boolean) {
        await this.authz.assertExamStaff(user, examId);

        if (!publish) {
            const { error } = await this.db
                .from('cbt_exams')
                .update({ is_published: false, status: 'draft' })
                .eq('id', examId);

            if (error) throw new BadRequestException(error.message);
            return { id: examId, is_published: false };
        }

        const { data } = await this.db
            .from('cbt_exams')
            .select('metadata')
            .eq('id', examId)
            .maybeSingle();

        if (!data) throw new NotFoundException('Ujian tidak ditemukan.');

        const isPublic = (data as { metadata: Record<string, any> | null }).metadata
            ?.is_public === true;

        if (!isPublic) {
            // Mode "siswa terpilih" TIDAK membuat baris di `cbt_exam_targets`,
            // hanya di `cbt_exam_participants` — keduanya harus diperiksa, kalau
            // tidak ujian yang sudah ditugaskan per siswa ditolak terbit.
            const [targets, participants] = await Promise.all([
                this.db.from('cbt_exam_targets').select('exam_id').eq('exam_id', examId).limit(1),
                this.db
                    .from('cbt_exam_participants')
                    .select('exam_id')
                    .eq('exam_id', examId)
                    .limit(1),
            ]);

            const hasTargets = ((targets.data as any[]) || []).length > 0;
            const hasParticipants = ((participants.data as any[]) || []).length > 0;

            if (!hasTargets && !hasParticipants) {
                throw new BadRequestException(
                    'Ujian belum ditugaskan ke kelas mana pun. Pilih "Tugaskan" terlebih ' +
                        'dahulu, atau jadikan ujian ini publik.',
                );
            }
        }

        const { error } = await this.db
            .from('cbt_exams')
            .update({ is_published: true, status: 'active' })
            .eq('id', examId);

        if (error) throw new BadRequestException(error.message);

        return { id: examId, is_published: true };
    }

    /**
     * Ganti seluruh penugasan sebuah ujian.
     *
     * Bersifat mengganti, bukan menambah: modal penugasan mengirim keadaan akhir
     * yang diinginkan, jadi sasaran lama dikosongkan lebih dulu.
     */
    async assign(
        user: AuthUser,
        examId: string,
        classIds: string[],
        userIds: string[],
        activate: boolean,
    ) {
        await this.authz.assertExamStaff(user, examId);

        await this.db.from('cbt_exam_targets').delete().eq('exam_id', examId);
        await this.db.from('cbt_exam_participants').delete().eq('exam_id', examId);

        if (classIds.length > 0) {
            // Kelas reguler dan kelas tambahan disimpan di kolom yang BERBEDA
            // pada tabel sasaran, jadi id-nya harus dipilah lebih dulu.
            const { data: regular } = await this.db
                .from('cbt_classes')
                .select('id')
                .in('id', classIds);

            const regularIds = new Set(
                ((regular as Array<{ id: string }>) || []).map((c) => c.id),
            );

            const targets = classIds.map((classId) =>
                regularIds.has(classId)
                    ? { exam_id: examId, class_id: classId }
                    : { exam_id: examId, additional_class_id: classId },
            );

            const { error } = await this.db.from('cbt_exam_targets').insert(targets);
            if (error) throw new BadRequestException(error.message);
        }

        if (userIds.length > 0) {
            const { error } = await this.db
                .from('cbt_exam_participants')
                .insert(userIds.map((userId) => ({ exam_id: examId, user_id: userId })));

            if (error) throw new BadRequestException(error.message);
        }

        if (activate) {
            await this.db.from('cbt_exams').update({ status: 'active' }).eq('id', examId);
        }

        return { examId, classes: classIds.length, participants: userIds.length };
    }

    /**
     * Penugasan sekumpulan ujian, untuk memulihkan keadaan modal penugasan.
     *
     * `cbt_exam_participants` tidak menyimpan `class_id`, jadi kelas tiap peserta
     * diturunkan dari keanggotaannya — tanpa itu, modal tidak bisa memulihkan
     * mode "siswa terpilih" per kelas.
     */
    async listAssignments(user: AuthUser, examIds: string[]) {
        if (examIds.length === 0) return { targets: [], participants: [] };

        for (const examId of examIds) {
            await this.authz.assertExamStaff(user, examId);
        }

        const [targets, participants] = await Promise.all([
            this.db
                .from('cbt_exam_targets')
                .select('exam_id, class_id, additional_class_id')
                .in('exam_id', examIds),
            this.db.from('cbt_exam_participants').select('exam_id, user_id').in('exam_id', examIds),
        ]);

        const participantRows =
            (participants.data as Array<{ exam_id: string; user_id: string }>) || [];

        const userIds = [...new Set(participantRows.map((p) => p.user_id).filter(Boolean))];
        const classByUser = new Map<string, string>();

        if (userIds.length > 0) {
            const { data: memberships } = await this.db
                .from('cbt_class_members')
                .select('user_id, class_id')
                .in('user_id', userIds);

            for (const row of (memberships as Array<{
                user_id: string;
                class_id: string;
            }>) || []) {
                if (!classByUser.has(row.user_id)) classByUser.set(row.user_id, row.class_id);
            }
        }

        return {
            targets: (targets.data as any[]) || [],
            participants: participantRows.map((p) => ({
                exam_id: p.exam_id,
                user_id: p.user_id,
                class_id: classByUser.get(p.user_id) ?? null,
            })),
        };
    }

    // ── Pembantu ─────────────────────────────────────────────────────────────

    private async isElevated(user: AuthUser, organizationId: string): Promise<boolean> {
        if (user.isPlatformAdmin || user.resolved?.superadmin === true) return true;
        return this.roles.hasOrgRole(user.id, organizationId, ['Proktor', 'Admin']);
    }

    private async assertMayUseExamType(
        user: AuthUser,
        organizationId: string,
        examType: string,
    ): Promise<void> {
        if (!RESTRICTED_EXAM_TYPES.includes(examType)) return;

        if (!(await this.isElevated(user, organizationId))) {
            throw new ForbiddenException(
                'Hanya Proktor yang dapat membuat atau mengubah ujian jenis PAS/PAT.',
            );
        }
    }

    /**
     * Ujian berwaktu butuh durasi positif. Durasi 0 atau bukan angka membuat
     * pengerjaan langsung kedaluwarsa, atau diam-diam jatuh ke 60 menit saat
     * dijalankan — keduanya baru ketahuan setelah siswa membuka ujiannya.
     */
    private assertValidDuration(examType: string, duration: number): void {
        if (examType === 'assignment') return;

        if (!Number.isFinite(Number(duration)) || Number(duration) < 1) {
            throw new BadRequestException('Durasi ujian minimal 1 menit.');
        }
    }

    /**
     * Susun `metadata` ujian di atas nilai yang sudah ada.
     *
     * Bidang khusus tugas hanya ditulis untuk ujian bertipe `assignment`; untuk
     * tipe lain nilai lamanya dibiarkan, supaya mengubah tugas menjadi ujian
     * biasa dan kembali lagi tidak menghapus konfigurasinya.
     */
    private buildMetadata(
        examType: string,
        dto: CreateExamDto | UpdateExamDto,
        existing: Record<string, any>,
    ): Record<string, unknown> {
        const isAssignment = examType === 'assignment';

        return {
            ...existing,
            is_safe_mode: dto.isSafeMode ?? existing.is_safe_mode ?? true,
            is_public: dto.isPublic ?? false,
            document_url: isAssignment
                ? (dto.documentUrl ?? existing.document_url ?? '')
                : existing.document_url,
            video_url: isAssignment
                ? (dto.videoUrl ?? existing.video_url ?? '')
                : existing.video_url,
            ...(isAssignment
                ? {
                      assignment_description:
                          dto.assignmentDescription ?? existing.assignment_description ?? '',
                      allow_file_upload:
                          dto.allowFileUpload ?? existing.allow_file_upload ?? false,
                      allowed_file_types:
                          dto.allowedFileTypes ?? existing.allowed_file_types ?? ['pdf'],
                      require_bank: dto.requireBank ?? existing.require_bank ?? true,
                  }
                : {}),
        };
    }

    private async resolveOrganizationId(
        user: AuthUser,
        organizationId: string,
    ): Promise<string> {
        await this.authz.assertOrgStaff(user, organizationId);
        return organizationId;
    }
}
