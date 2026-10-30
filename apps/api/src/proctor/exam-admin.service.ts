import { isUUID } from 'class-validator';
import { collaborationGrants, collaboratorCounts } from '../common/collaboration-access';
import {
    BadRequestException,
    ConflictException,
    ForbiddenException,
    Injectable,
    Logger,
    NotFoundException,
} from '@nestjs/common';
import { availableStudentScoreTypes, studentScoreType, type AuthUser } from '@acca-cbt/shared';
import { AuthorizationService } from '../auth/authorization.service';
import { CbtRolesService } from '../auth/cbt-roles.service';
import { insertIdempotently } from '../common/idempotent-create';
import { localDateTimeToUtc } from '../common/school-time';
import { DbService } from '../prisma/prisma-db-adapter';
import { SettingsService } from '../settings/settings.service';
import { assignedPasExamStudents, isPasMonitoringExam } from '../common/pas-monitoring-access';
import { isSemesterAssessmentExam, semesterAssessmentSourceLabel } from '../common/exam-types';
import { resolveExamBankIds } from '../common/exam-question-sources';
import { assertNoActiveAttempts } from '../common/exam-active-attempts';
import { ALLOWED_EXTENSIONS } from '../storage/storage.service';
import type { CreateExamDto, UpdateExamDto } from './dto/proctor.dto';

/** Jenis ujian yang hanya boleh dibuat dan diubah Proktor/Admin. */

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
        private readonly settings?: SettingsService,
    ) {}

    /**
     * Daftar ujian satu organisasi.
     *
     * Guru melihat ujian buatannya sendiri DAN ujian yang menggunakan bank soal
     * miliknya — ujian milik guru lain tanpa kaitan bank soal tidak muncul.
     */
    async list(user: AuthUser, organizationId: string) {
        await this.authz.assertOrgMonitoring(user, organizationId);

        let query = this.db.from('cbt_exams').select('*').eq('organization_id', organizationId);

        const elevated = await this.isElevated(user, organizationId);
        const isInvigilator = await this.roles.hasOrgRole(user.id, organizationId, ['Pengawas']);
        const canSeeAll = elevated;
        let assignedStudents: Map<string, string[]> | undefined;
        const grants = await collaborationGrants(this.db, 'exam', user.id);
        const sharedIds = [...grants.keys()];
        const collaboration = await this.authz.collaborationListContext(user, organizationId);
        const sharedClause = sharedIds.length ? `,id.in.(${sharedIds.join(',')})` : '';
        const restrictedProctor = !user.isPlatformAdmin && !user.resolved?.superadmin &&
            await this.roles.hasOrgRole(user.id, organizationId, ['Proktor']) && !await this.roles.hasOrgRole(user.id, organizationId, ['Admin']);
        if (restrictedProctor) query = query.or(`created_by.eq.${user.id},is_published.eq.true,exam_type.in.(pas,pat,pts,pkn,am)${sharedClause}`);
        else if (!canSeeAll) {
            // Cari bank soal milik guru ini
            const { data: ownedBanks } = await this.db
                .from('cbt_question_banks')
                .select('id')
                .eq('organization_id', organizationId)
                .eq('created_by', user.id);
            // Guru mapel: bank buatannya dan bank tempat ia menjadi kolaborator. Ujian
            // ASAS/AM yang memakai bank itu ikut terlihat untuk dipantau (tanpa hak kelola/reset).
            const bankIds = [...new Set([
                ...((ownedBanks as Array<{ id: string }>) || []).map((b) => b.id),
                ...(await collaborationGrants(this.db, 'bank', user.id)).keys(),
            ])];

            assignedStudents = await assignedPasExamStudents(this.db, user.id, organizationId);
            const assignedIds = [...assignedStudents.keys()];
            const conditions = [`created_by.eq.${user.id}`];
            if (sharedIds.length) conditions.push(`id.in.(${sharedIds.join(',')})`);
            if (bankIds.length) conditions.push(`question_bank_id.in.(${bankIds.join(',')})`);
            if (assignedIds.length) conditions.push(`id.in.(${assignedIds.join(',')})`);
            query = query.or(conditions.join(','));
        }

        const { data, error } = await query.order('created_at', { ascending: false });

        if (error) {
            this.logger.error(`Gagal membaca daftar ujian: ${error.message}`);
            return [];
        }

        let exams = ((data as any[]) || []).filter(exam => !restrictedProctor || exam.created_by === user.id || exam.is_published === true || isPasMonitoringExam(exam) || sharedIds.includes(exam.id));
        if (isInvigilator && !elevated) {
            assignedStudents = await assignedPasExamStudents(this.db, user.id, organizationId);
            const assignedIds = new Set(assignedStudents.keys());
            const teacher = await this.roles.hasOrgRole(user.id, organizationId, ['Guru']);
            const { data: banks, error: bankError } = teacher
                ? await this.db.from('cbt_question_banks').select('id').eq('organization_id', organizationId).eq('created_by', user.id)
                : { data: [], error: null };
            if (bankError) throw new BadRequestException('Kepemilikan bank soal belum dapat diperiksa.');
            const ownedIds = new Set([
                ...(banks || []).map((bank: { id: string }) => bank.id),
                ...(teacher ? (await collaborationGrants(this.db, 'bank', user.id)).keys() : []),
            ]);
            exams = exams.filter(exam => sharedIds.includes(exam.id) || assignedIds.has(exam.id) ||
                (teacher && (exam.created_by === user.id || ownedIds.has(exam.question_bank_id))));
        }
        const ownedBankIds = new Set<string>();
        const [sources, owned] = await Promise.all([
            exams.length ? this.db.from('cbt_exam_question_sources').select('exam_id, bank_id').in('exam_id', exams.map(exam => exam.id)) : Promise.resolve({ data: [], error: null }),
            restrictedProctor ? this.db.from('cbt_question_banks').select('id').eq('organization_id', organizationId).eq('created_by', user.id) : Promise.resolve({ data: [], error: null }),
        ]);
        if (sources.error || owned.error) throw new BadRequestException('Sumber bank soal belum dapat diperiksa.');
        const examSources: Array<{ exam_id: string; bank_id: string }> = sources.data || [];
        for (const bank of owned.data || []) ownedBankIds.add(bank.id);
        const bankIdsForExam = (exam: { id: string; question_bank_id?: string | null }): string[] => [...new Set([
            ...(exam.question_bank_id ? [exam.question_bank_id] : []),
            ...examSources.filter(source => source.exam_id === exam.id).map(source => source.bank_id).sort(),
        ])];
        const bankIds = [...new Set(exams.flatMap(bankIdsForExam))];
        const periodIds = [...new Set(exams.map(exam => exam.metadata?.pas_period_id).filter((id): id is string => typeof id === 'string' && isUUID(id)))];
        const [banks, periods] = await Promise.all([
            bankIds.length ? this.db.from('cbt_question_banks').select('id, title, created_by').eq('organization_id', organizationId).in('id', bankIds) : Promise.resolve({ data: [], error: null }),
            periodIds.length ? this.db.from('cbt_pas_periods').select('id, created_by').eq('organization_id', organizationId).in('id', periodIds) : Promise.resolve({ data: [], error: null }),
        ]);
        if (banks.error || periods.error) throw new BadRequestException('Informasi pembuat soal dan ujian belum dapat dimuat.');
        const bankRows = (banks.data || []) as Array<{ id: string; title?: string; created_by?: string | null }>;
        const periodRows = (periods.data || []) as Array<{ id: string; created_by?: string | null }>;
        const banksById = new Map(bankRows.map(bank => [bank.id, bank]));
        const periodsById = new Map(periodRows.map(period => [period.id, period]));
        const creatorIds = [...new Set([
            ...exams.map(exam => exam.created_by),
            ...bankRows.map(bank => bank.created_by),
            ...periodRows.map(period => period.created_by),
        ].filter(Boolean) as string[])];

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

        const counts = await collaboratorCounts(this.db, 'exam', exams.map(exam => exam.id));
        // Reuse assignments for every exam instead of reloading room rosters per row.
        if (!elevated && !assignedStudents && exams.some(exam => isSemesterAssessmentExam(exam))) {
            assignedStudents = await assignedPasExamStudents(this.db, user.id, organizationId);
        }
        return Promise.all(exams.map(async (exam) => {
            const grant = grants.get(exam.id) ?? null;
            const access = collaboration.access(exam, grant);
            return ({
            ...exam,
            isOwner: access.owner, canShare: access.canShare, canDelete: access.canDelete, collaborationPermission: access.grant?.permission || null,
            collaboratorCount: counts.get(exam.id) || 0,
            // Ujian dari jadwal ASAS/ASAT/AM dibuat sistem (tanpa pembuat): tampilkan
            // jenis & kelasnya, bukan "Tidak diketahui".
            creatorName: creatorNames.get(exam.created_by) || semesterAssessmentSourceLabel(exam) || 'Tidak diketahui',
            examCreatorName: creatorNames.get(exam.created_by || periodsById.get(exam.metadata?.pas_period_id)?.created_by || '') || null,
            questionCreatorNames: [...new Set(bankIdsForExam(exam).map(bankId => creatorNames.get(banksById.get(bankId)?.created_by || '') || 'Belum tercatat'))],
            question_bank_title: exam.question_bank_title || banksById.get(exam.question_bank_id)?.title || null,
            canManage: await this.authz.canManageExam(user, exam, 'manage', undefined, grant),
            canResetParticipants: await this.authz.canManageExam(user, exam, 'reset', assignedStudents, grant),
            canCorrectKeys: !restrictedProctor || (() => {
                const ids = [...(exam.question_bank_id ? [exam.question_bank_id] : []), ...examSources.filter(source => source.exam_id === exam.id).map(source => source.bank_id)];
                return ids.length > 0 && ids.every(id => ownedBankIds.has(id));
            })(),
        }); }));
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
        const timeZone = (await this.settings?.getSchoolTimeZone?.()) || 'Asia/Jakarta';
        if (dto.timeZone && dto.timeZone !== timeZone) {
            throw new BadRequestException('Zona waktu sekolah berubah. Buka ulang formulir sebelum menyimpan jadwal.');
        }
        const title = this.normalizeExamInput(dto);
        const startTime = localDateTimeToUtc(dto.startTime, timeZone);
        const endTime = localDateTimeToUtc(dto.endTime, timeZone);
        if ((dto.startTime && !startTime) || (dto.endTime && !endTime)) {
            throw new BadRequestException('Tanggal atau waktu ujian tidak valid.');
        }
        this.assertValidWindow(startTime, endTime);

        if (dto.questionBankId) {
            const { data: bank, error: bankError } = await this.db
                .from('cbt_question_banks')
                .select('is_published, organization_id')
                .eq('id', dto.questionBankId)
                .maybeSingle();
            if (bankError) throw new BadRequestException('Bank soal belum dapat diperiksa.');

            // Bank sekolah lain tidak boleh dipakai: soal dan kuncinya akan
            // terbuka bagi staf dan siswa sekolah ini lewat ujian tersebut.
            if (bank && (bank as { organization_id?: string }).organization_id !== organizationId) {
                throw new BadRequestException('Bank soal tidak ditemukan di sekolah ini.');
            }
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
                title,
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

        return this.db.transaction(async db => {
            await db.raw('SELECT id FROM public.cbt_exams WHERE id = $1::uuid FOR UPDATE', examId);
            const { data } = await db
                .from('cbt_exams')
                .select('metadata, exam_type, organization_id, status, updated_at')
                .eq('id', examId)
                .maybeSingle();

            if (!data) throw new NotFoundException('Ujian tidak ditemukan.');

            const existing = data as {
                metadata: Record<string, any> | null;
                exam_type: string | null;
                organization_id: string;
                status: string;
                updated_at?: string;
            };
            if (dto.expectedUpdatedAt && (!existing.updated_at || Date.parse(dto.expectedUpdatedAt) !== Date.parse(existing.updated_at))) {
                throw new ConflictException('Ujian telah diubah oleh pengguna lain. Muat ulang sebelum menyimpan.');
            }
            if (existing.status === 'archived') {
                throw new ConflictException('Pulihkan ujian dari arsip sebelum mengubahnya.');
            }

            if (existing.metadata?.key_correction && existing.metadata.key_correction.state !== 'ready') {
                throw new ConflictException('Selesaikan penilaian ulang koreksi kunci sebelum mengubah atau membuka nilai ujian.');
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

            const title = this.normalizeExamInput(dto);
            this.assertValidDuration(examType, dto.duration);
            const timeZone = (await this.settings?.getSchoolTimeZone?.()) || 'Asia/Jakarta';
            if (dto.timeZone && dto.timeZone !== timeZone) {
                throw new BadRequestException('Zona waktu sekolah berubah. Buka ulang formulir sebelum menyimpan jadwal.');
            }
            const startTime = localDateTimeToUtc(dto.startTime, timeZone);
            const endTime = localDateTimeToUtc(dto.endTime, timeZone);
            if ((dto.startTime && !startTime) || (dto.endTime && !endTime)) {
                throw new BadRequestException('Tanggal atau waktu ujian tidak valid.');
            }
            this.assertValidWindow(startTime, endTime);

            const { error } = await db
                .from('cbt_exams')
                .update({
                    updated_at: new Date().toISOString(),
                    title,
                    // Formulir tidak mengirim deskripsi yang dikosongkan; tanpa
                    // `null` di sini deskripsi lama tidak pernah bisa dihapus.
                    description: dto.description?.trim() || null,
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
        });
    }

    async setScreenShareException(user: AuthUser, examId: string, studentId: string, enabled: boolean, reason?: string) {
        await this.authz.assertExamStaff(user, examId);
        const { data: exam, error: examError } = await this.db.from('cbt_exams')
            .select('id, metadata').eq('id', examId).maybeSingle();
        if (examError) throw new BadRequestException('Pengaturan ujian belum dapat dibaca.');
        if (!exam) throw new NotFoundException('Ujian tidak ditemukan.');
        if ((exam as any).metadata?.screenshot_enabled !== true) {
            throw new BadRequestException('Pengecualian hanya berlaku untuk ujian yang mewajibkan berbagi layar.');
        }

        await this.assertExamParticipantAssigned(examId, studentId);
        const table = 'cbt_exam_screen_share_exceptions';
        if (!enabled) {
            const { data: active, error: activeError } = await this.db.from('cbt_exam_attempts')
                .select('id').eq('exam_id', examId).eq('user_id', studentId).eq('status', 'in_progress').maybeSingle();
            if (activeError) throw new BadRequestException('Status pengerjaan peserta belum dapat diperiksa.');
            if (active) throw new ConflictException('Pengecualian tidak dapat dicabut saat peserta sedang mengerjakan ujian.');
            const { error } = await this.db.from(table).delete().eq('exam_id', examId).eq('user_id', studentId);
            if (error) throw new BadRequestException('Pengecualian berbagi layar belum dapat dicabut.');
            return { examId, studentId, enabled: false };
        }

        const normalizedReason = String(reason || '').trim();
        if (!normalizedReason) throw new BadRequestException('Tuliskan alasan pengecualian.');
        if (normalizedReason.length > 240) throw new BadRequestException('Alasan pengecualian maksimal 240 karakter.');
        const { error } = await this.db.from(table).upsert({ exam_id: examId, user_id: studentId,
            reason: normalizedReason, created_by: user.id, created_at: new Date().toISOString() },
        { onConflict: 'exam_id,user_id' });
        if (error) throw new BadRequestException('Pengecualian berbagi layar belum dapat disimpan.');
        return { examId, studentId, enabled: true, reason: normalizedReason };
    }

    private async assertExamParticipantAssigned(examId: string, studentId: string): Promise<void> {
        const { data: individual, error: individualError } = await this.db.from('cbt_exam_participants')
            .select('user_id').eq('exam_id', examId).eq('user_id', studentId).maybeSingle();
        if (individualError) throw new BadRequestException('Penugasan peserta belum dapat diperiksa.');
        if (individual) return;

        const { data: targets, error: targetError } = await this.db.from('cbt_exam_targets')
            .select('class_id, additional_class_id').eq('exam_id', examId);
        if (targetError) throw new BadRequestException('Penugasan kelas belum dapat diperiksa.');
        const classIds = [...new Set((targets || []).map((target: any) => target.class_id).filter(Boolean))];
        const additionalClassIds = [...new Set((targets || []).map((target: any) => target.additional_class_id).filter(Boolean))];
        if (classIds.length) {
            const { data, error } = await this.db.from('cbt_class_members').select('user_id')
                .eq('user_id', studentId).in('class_id', classIds);
            if (error) throw new BadRequestException('Keanggotaan kelas peserta belum dapat diperiksa.');
            if (data?.length) return;
        }
        if (additionalClassIds.length) {
            const { data, error } = await this.db.from('cbt_additional_class_members').select('user_id')
                .eq('user_id', studentId).in('class_id', additionalClassIds);
            if (error) throw new BadRequestException('Keanggotaan kelas tambahan peserta belum dapat diperiksa.');
            if (data?.length) return;
        }
        throw new NotFoundException('Peserta bukan bagian dari penugasan ujian ini.');
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
            return this.db.transaction(async db => {
                await db.raw('SELECT id FROM public.cbt_exams WHERE id = $1::uuid FOR UPDATE', examId);
                await assertNoActiveAttempts(db, examId, 'menarik ujian');
                const { error } = await db
                    .from('cbt_exams')
                    .update({ is_published: false, status: 'draft' })
                    .eq('id', examId);

                if (error) throw new BadRequestException(error.message);
                return { id: examId, is_published: false };
            });
        }

        const { data } = await this.db
            .from('cbt_exams')
            .select('metadata, status, exam_type, question_bank_id')
            .eq('id', examId)
            .maybeSingle();

        if (!data) throw new NotFoundException('Ujian tidak ditemukan.');
        await this.assertHasQuestions(examId, data as {
            metadata?: Record<string, any> | null; exam_type?: string | null; question_bank_id?: string | null;
        });
        if ((data as { metadata?: Record<string, any> }).metadata?.is_pas_exam === true) {
            throw new ConflictException('Aktifkan ujian PAS melalui jadwal folder agar kelengkapan ruang dan pengawas diperiksa.');
        }
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
                .select('id, organization_id, status, metadata')
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

            await this.assertActiveParticipantsKept(db, examId, exam as { metadata?: Record<string, any> | null }, {
                regularClassIds: uniqueClassIds.filter((id) => regularIds.has(id)),
                additionalClassIds: uniqueClassIds.filter((id) => additionalIds.has(id)),
                participantIds: uniqueUserIds,
            });

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
            const access = await this.authz.collaborationPermissions(user, 'exam', examId);
            if (!access.grant) await this.authz.assertExamStaff(user, examId);
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

    /**
     * Tolak penugasan baru yang mengeluarkan siswa yang SEDANG mengerjakan.
     *
     * Akses siswa diperiksa ulang pada setiap simpan jawaban dan pengumpulan,
     * jadi menghapus kelas atau peserta di tengah ujian membuat siswa itu
     * terputus dan jawabannya tidak bisa dikumpulkan. Ujian publik dikecualikan:
     * aksesnya tidak bergantung pada penugasan.
     */
    private async assertActiveParticipantsKept(
        db: Pick<DbService, 'from'>,
        examId: string,
        exam: { metadata?: Record<string, any> | null },
        next: { regularClassIds: string[]; additionalClassIds: string[]; participantIds: string[] },
    ): Promise<void> {
        if (exam.metadata?.is_public === true) return;

        const { data: active, error } = await db.from('cbt_exam_attempts')
            .select('user_id').eq('exam_id', examId).eq('status', 'in_progress');
        if (error) throw new BadRequestException('Status pengerjaan peserta belum dapat diperiksa.');

        const kept = new Set(next.participantIds);
        let remaining = [...new Set(((active as Array<{ user_id: string }> | null) || []).map((row) => row.user_id))]
            .filter((id) => !kept.has(id));
        if (!remaining.length) return;

        for (const [table, classIds] of [
            ['cbt_class_members', next.regularClassIds],
            ['cbt_additional_class_members', next.additionalClassIds],
        ] as const) {
            if (!remaining.length || !classIds.length) continue;
            const { data, error: memberError } = await db.from(table)
                .select('user_id').in('class_id', classIds).in('user_id', remaining);
            if (memberError) throw new BadRequestException('Keanggotaan kelas peserta belum dapat diperiksa.');
            const covered = new Set(((data as Array<{ user_id: string }> | null) || []).map((row) => row.user_id));
            remaining = remaining.filter((id) => !covered.has(id));
        }
        if (!remaining.length) return;

        const { data: profiles } = await db.from('cbt_profiles')
            .select('id, full_name').in('id', remaining.slice(0, 5));
        const names = ((profiles as Array<{ full_name: string | null }> | null) || [])
            .map((profile) => profile.full_name).filter(Boolean);
        const sample = names.length ? `: ${names.join(', ')}${remaining.length > names.length ? ', dan lainnya' : ''}` : '';
        throw new ConflictException(
            `${remaining.length} siswa sedang mengerjakan ujian ini dan akan terputus jika penugasan diubah${sample}. ` +
            'Tunggu sampai mereka selesai, atau sertakan kembali kelas/siswa tersebut.',
        );
    }

    private async isElevated(user: AuthUser, organizationId: string): Promise<boolean> {
        if (user.isPlatformAdmin || user.resolved?.superadmin === true) return true;
        return this.roles.hasOrgRole(user.id, organizationId, ['Proktor', 'Admin']);
    }

    private async assertMayUseExamType(
        user: AuthUser,
        organizationId: string,
        examType: string,
    ): Promise<void> {
        if (!isSemesterAssessmentExam({ exam_type: examType })) return;

        if (!(await this.isElevated(user, organizationId))) {
            throw new ForbiddenException(
                'Hanya Proktor/Admin yang dapat membuat atau mengubah ujian ASAS/ASAT dan Asesmen Madrasah.',
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
     * Rapikan masukan formulir dan kembalikan judul yang sudah dipangkas.
     * `@IsNotEmpty` meloloskan judul berisi spasi saja, yang lalu tersimpan
     * sebagai judul kosong.
     */
    private normalizeExamInput(dto: CreateExamDto | UpdateExamDto): string {
        const title = dto.title.trim();
        if (!title) throw new BadRequestException('Judul ujian wajib diisi.');

        // "classical,irt_2pl,irt_2pl" → "classical,irt_2pl"; kosong → classical.
        const scoring = [...new Set((dto.scoringType || '').split(',').map(type => type.trim()).filter(Boolean))];
        dto.scoringType = scoring.length ? scoring.join(',') : 'classical';

        if (dto.allowedFileTypes) {
            const types = [...new Set(dto.allowedFileTypes.map(type => type.trim().toLowerCase().replace(/^\./, '')).filter(Boolean))];
            // SVG dapat memuat skrip; unggahan siswa tidak boleh memakainya.
            const unknown = types.filter(type => type === 'svg' || !Object.prototype.hasOwnProperty.call(ALLOWED_EXTENSIONS, type));
            if (unknown.length) {
                throw new BadRequestException(`Jenis file tidak didukung: ${unknown.map(type => '.' + type).join(', ')}`);
            }
            if (!types.length) throw new BadRequestException('Pilih minimal satu jenis file yang diizinkan.');
            dto.allowedFileTypes = types;
        }
        return title;
    }

    /** Jadwal yang selesai sebelum (atau tepat saat) dimulai tidak bisa dikerjakan siapa pun. */
    private assertValidWindow(startTime: string | null, endTime: string | null): void {
        if (startTime && endTime && new Date(endTime).getTime() <= new Date(startTime).getTime()) {
            throw new BadRequestException('Waktu selesai harus lebih lambat dari waktu mulai.');
        }
    }

    /**
     * Ujian tanpa soal yang diterbitkan membuat siswa membuka lembar kosong dan
     * langsung tercatat selesai dengan nilai 0. Tugas tanpa bank soal dikecualikan.
     */
    private async assertHasQuestions(
        examId: string,
        exam: { metadata?: Record<string, any> | null; exam_type?: string | null; question_bank_id?: string | null },
    ): Promise<void> {
        if (exam.exam_type === 'assignment' && exam.metadata?.require_bank === false) return;
        const bankIds = await resolveExamBankIds(this.db, examId, exam.question_bank_id ?? null);
        if (bankIds.length) {
            const { data, error } = await this.db.from('cbt_bank_questions')
                .select('id').in('bank_id', bankIds).limit(1);
            if (error) throw new BadRequestException('Soal ujian belum dapat diperiksa.');
            if ((data as unknown[] | null)?.length) return;
        }
        throw new BadRequestException('Ujian belum memiliki soal. Pilih bank soal yang berisi soal sebelum menerbitkan.');
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

        if (dto.studentScoreType && !availableStudentScoreTypes(dto.scoringType).includes(dto.studentScoreType)) {
            throw new BadRequestException('Jenis nilai siswa harus sesuai dengan sistem penilaian ujian.');
        }

        return {
            ...existing,
            student_score_type: studentScoreType({ scoring_type: dto.scoringType || 'classical',
                metadata: { student_score_type: dto.studentScoreType ?? existing.student_score_type } }),
            show_answer_keys: dto.showAnswerKeys ?? existing.show_answer_keys ?? false,
            is_safe_mode: dto.isSafeMode ?? existing.is_safe_mode ?? true,
            screenshot_enabled: dto.screenshotEnabled ?? existing.screenshot_enabled ?? false,
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
