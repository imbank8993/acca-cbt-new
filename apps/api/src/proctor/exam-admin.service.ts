import {
    BadRequestException,
    ConflictException,
    ForbiddenException,
    Injectable,
    Logger,
    NotFoundException,
} from '@nestjs/common';
import type { AuthUser } from '@acca-cbt/shared';
import { AuthorizationService } from '../auth/authorization.service';
import { CbtRolesService } from '../auth/cbt-roles.service';
import { insertIdempotently } from '../common/idempotent-create';
import { localDateTimeToUtc } from '../common/school-time';
import { DbService } from '../prisma/prisma-db-adapter';
import { SettingsService } from '../settings/settings.service';
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
        private readonly settings: SettingsService,
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
        const timeZone = await this.settings.getSchoolTimeZone();
        const startTime = localDateTimeToUtc(dto.startTime, timeZone);
        const endTime = localDateTimeToUtc(dto.endTime, timeZone);
        if ((dto.startTime && !startTime) || (dto.endTime && !endTime)) {
            throw new BadRequestException('Tanggal atau waktu ujian tidak valid.');
        }

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

        const data = await insertIdempotently<{ id: string }>(this.db, {
            table: 'cbt_exams',
            organizationId,
            clientRequestId: dto.clientRequestId,
            fingerprint: dto,
            select: 'id',
            payload: {
                organization_id: organizationId,
                question_bank_id: dto.questionBankId || null,
                title: dto.title.trim(),
                description: dto.description?.trim() || null,
                exam_type: examType,
                duration_minutes: dto.duration,
                subject_id: dto.subjectId || null,
                start_time: startTime,
                end_time: endTime,
                randomize_questions: dto.randomizeQuestions ?? true,
                randomize_options: dto.randomizeOptions ?? true,
                show_results: dto.showResults ?? false,
                is_published: false,
                status: 'draft',
                created_by: user.id,
                scoring_type: dto.scoringType || 'classical',
                metadata: this.buildMetadata(examType, dto, {}),
            },
        });

        return { id: data.id };
    }

    async update(user: AuthUser, examId: string, dto: UpdateExamDto) {
        await this.authz.assertExamStaff(user, examId);

        const { data } = await this.db
            .from('cbt_exams')
            .select('metadata, exam_type, organization_id, status')
            .eq('id', examId)
            .maybeSingle();

        if (!data) throw new NotFoundException('Ujian tidak ditemukan.');

        const existing = data as {
            metadata: Record<string, any> | null;
            exam_type: string | null;
            organization_id: string;
            status: string;
        };
        if (existing.status === 'archived') {
            throw new ConflictException('Pulihkan ujian dari arsip sebelum mengubahnya.');
        }

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
        const timeZone = await this.settings.getSchoolTimeZone();
        const startTime = localDateTimeToUtc(dto.startTime, timeZone);
        const endTime = localDateTimeToUtc(dto.endTime, timeZone);
        if ((dto.startTime && !startTime) || (dto.endTime && !endTime)) {
            throw new BadRequestException('Tanggal atau waktu ujian tidak valid.');
        }

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
                start_time: startTime,
                end_time: endTime,
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
            .select('metadata, status')
            .eq('id', examId)
            .maybeSingle();

        if (!data) throw new NotFoundException('Ujian tidak ditemukan.');
        if ((data as { status?: string }).status === 'archived') {
            throw new ConflictException('Pulihkan ujian dari arsip sebelum menerbitkannya.');
        }

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
        participantAssignments: Array<{ userId: string; classId: string }>,
        activate: boolean,
    ) {
        await this.authz.assertExamStaff(user, examId);
        const uniqueClassIds = [...new Set(classIds)];
        const uniqueParticipantAssignments = [
            ...new Map(
                participantAssignments.map((assignment) => [
                    `${assignment.userId}:${assignment.classId}`,
                    assignment,
                ]),
            ).values(),
        ];
        const uniqueUserIds = [...new Set(uniqueParticipantAssignments.map((item) => item.userId))];
        if (uniqueUserIds.length !== uniqueParticipantAssignments.length) {
            throw new BadRequestException(
                'Satu siswa tidak boleh dipilih dari lebih dari satu kelas pada ujian yang sama.',
            );
        }
        const participantClassIds = [
            ...new Set(uniqueParticipantAssignments.map((item) => item.classId)),
        ];
        const allClassIds = [...new Set([...uniqueClassIds, ...participantClassIds])];

        return this.db.transaction(async (db) => {
            // Satu ujian hanya boleh mempunyai satu proses penggantian target
            // pada satu waktu. Lock juga membuat validasi dan delete/insert
            // berikutnya menjadi satu keputusan atomik.
            await db.raw(
                'SELECT id FROM public.cbt_exams WHERE id = $1::uuid FOR UPDATE',
                examId,
            );

            const { data: exam, error: examError } = await db
                .from('cbt_exams')
                .select('id, organization_id, status')
                .eq('id', examId)
                .maybeSingle();
            if (examError) throw new BadRequestException(examError.message);
            if (!exam) throw new NotFoundException('Ujian tidak ditemukan.');
            if ((exam as { status?: string }).status === 'archived') {
                throw new ConflictException('Pulihkan ujian dari arsip sebelum mengubah penugasan.');
            }
            const organizationId = (exam as { organization_id: string }).organization_id;

            const [
                regular,
                additional,
                activeYears,
                participants,
                regularMemberships,
                additionalMemberships,
            ] = await Promise.all([
                allClassIds.length
                    ? db.from('cbt_classes').select('id, organization_id, school_year').in('id', allClassIds)
                    : Promise.resolve({ data: [], error: null }),
                allClassIds.length
                    ? db.from('cbt_additional_classes').select('id, organization_id').in('id', allClassIds)
                    : Promise.resolve({ data: [], error: null }),
                allClassIds.length
                    ? db.from('master_tahun_ajaran').select('tahun_ajaran').eq('is_active', true)
                    : Promise.resolve({ data: [], error: null }),
                uniqueUserIds.length
                    ? db.from('cbt_organization_members')
                        .select('user_id')
                        .eq('organization_id', organizationId)
                        .eq('is_active', true)
                        .in('user_id', uniqueUserIds)
                    : Promise.resolve({ data: [], error: null }),
                uniqueParticipantAssignments.length
                    ? db.from('cbt_class_members')
                        .select('class_id, user_id')
                        .in('class_id', participantClassIds)
                        .in('user_id', uniqueUserIds)
                    : Promise.resolve({ data: [], error: null }),
                uniqueParticipantAssignments.length
                    ? db.from('cbt_additional_class_members')
                        .select('class_id, user_id')
                        .in('class_id', participantClassIds)
                        .in('user_id', uniqueUserIds)
                    : Promise.resolve({ data: [], error: null }),
            ]);

            for (const result of [
                regular,
                additional,
                activeYears,
                participants,
                regularMemberships,
                additionalMemberships,
            ]) {
                if (result.error) throw new BadRequestException(result.error.message);
            }

            const regularRows = (regular.data as Array<{
                id: string;
                organization_id: string;
                school_year: string | null;
            }>) || [];
            const additionalRows = (additional.data as Array<{
                id: string;
                organization_id: string;
            }>) || [];
            const regularIds = new Set(regularRows.map((row) => row.id));
            const additionalIds = new Set(additionalRows.map((row) => row.id));
            const foundClassIds = new Set([...regularIds, ...additionalIds]);

            if (allClassIds.some((id) => !foundClassIds.has(id))) {
                throw new BadRequestException('Satu atau lebih kelas tidak ditemukan.');
            }
            if ([...regularRows, ...additionalRows].some(
                (row) => row.organization_id !== organizationId,
            )) {
                throw new BadRequestException('Kelas harus berasal dari sekolah yang sama dengan ujian.');
            }

            const activeYearSet = new Set(
                ((activeYears.data as Array<{ tahun_ajaran: string | null }>) || [])
                    .map((row) => row.tahun_ajaran)
                    .filter((year): year is string => Boolean(year)),
            );
            if (activeYearSet.size > 0 && regularRows.some(
                (row) => !row.school_year || !activeYearSet.has(row.school_year),
            )) {
                throw new BadRequestException('Kelas reguler harus berasal dari tahun ajaran aktif.');
            }

            const validParticipantIds = new Set(
                ((participants.data as Array<{ user_id: string }>) || []).map((row) => row.user_id),
            );
            if (uniqueUserIds.some((id) => !validParticipantIds.has(id))) {
                throw new BadRequestException(
                    'Satu atau lebih peserta bukan anggota aktif sekolah ujian.',
                );
            }

            const validMembershipPairs = new Set(
                [
                    ...((regularMemberships.data as Array<{ class_id: string; user_id: string }>) || []),
                    ...((additionalMemberships.data as Array<{ class_id: string; user_id: string }>) || []),
                ].map((row) => `${row.class_id}:${row.user_id}`),
            );
            if (uniqueParticipantAssignments.some(
                (item) => !validMembershipPairs.has(`${item.classId}:${item.userId}`),
            )) {
                throw new BadRequestException(
                    'Satu atau lebih peserta bukan anggota kelas tempat ia dipilih.',
                );
            }

            const deleteTargets = await db.from('cbt_exam_targets').delete().eq('exam_id', examId);
            if (deleteTargets.error) throw new BadRequestException(deleteTargets.error.message);
            const deleteParticipants = await db
                .from('cbt_exam_participants')
                .delete()
                .eq('exam_id', examId);
            if (deleteParticipants.error) {
                throw new BadRequestException(deleteParticipants.error.message);
            }

            if (uniqueClassIds.length > 0) {
                const targets = uniqueClassIds.map((classId) =>
                    regularIds.has(classId)
                        ? { exam_id: examId, class_id: classId }
                        : { exam_id: examId, additional_class_id: classId },
                );
                const { error } = await db.from('cbt_exam_targets').insert(targets);
                if (error) throw new BadRequestException(error.message);
            }

            if (uniqueParticipantAssignments.length > 0) {
                const { error } = await db
                    .from('cbt_exam_participants')
                    .insert(uniqueParticipantAssignments.map((item) => ({
                        exam_id: examId,
                        user_id: item.userId,
                        regular_class_id: regularIds.has(item.classId) ? item.classId : null,
                        additional_class_id: additionalIds.has(item.classId) ? item.classId : null,
                    })));
                if (error) throw new BadRequestException(error.message);
            }

            if (activate) {
                const { error } = await db
                    .from('cbt_exams')
                    .update({ status: 'active' })
                    .eq('id', examId);
                if (error) throw new BadRequestException(error.message);
            }

            return {
                examId,
                classes: uniqueClassIds.length,
                participants: uniqueParticipantAssignments.length,
            };
        });
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
            this.db
                .from('cbt_exam_participants')
                .select('exam_id, user_id, regular_class_id, additional_class_id')
                .in('exam_id', examIds),
        ]);

        const participantRows = (participants.data as Array<{
            exam_id: string;
            user_id: string;
            regular_class_id: string | null;
            additional_class_id: string | null;
        }>) || [];

        return {
            targets: (targets.data as any[]) || [],
            participants: participantRows.map((p) => ({
                exam_id: p.exam_id,
                user_id: p.user_id,
                class_id: p.regular_class_id || p.additional_class_id || null,
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
            // `null` adalah pilihan eksplisit "tanpa batas". Ujian lama yang
            // belum memiliki bidang ini tetap memakai perilaku lama: 3.
            max_violations: dto.maxViolations !== undefined
                ? dto.maxViolations
                : (existing.max_violations !== undefined ? existing.max_violations : 3),
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
