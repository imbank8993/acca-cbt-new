import {
    BadRequestException,
    ForbiddenException,
    Injectable,
    InternalServerErrorException,
    Logger,
    NotFoundException,
} from '@nestjs/common';
import type { AuthUser } from '@acca-cbt/shared';
import { AuthUsersRepository } from '../auth/auth-users.repository';
import { AuthorizationService } from '../auth/authorization.service';
import { loadExamQuestions } from '../common/exam-question-sources';
import { DbService } from '../prisma/prisma-db-adapter';

/** Tipe soal yang dinilai manual oleh guru. */
const ESSAY_TYPES = ['essay', 'esay', 'uraian'];
const PERSONALITY_TYPES = ['likert', 'sjt', 'forced_choice', 'checklist', 'ranking', 'paired_comparison'];

/**
 * Modul guru — dipindahkan dari `apps/web/app/actions/guru.ts`.
 *
 * Seluruh metode menerima `AuthUser` hasil verifikasi token. Versi lama
 * menerima `userId` dan `orgId` sebagai parameter dari browser, dan
 * `listOrganizationStudentsForGuru` bahkan TIDAK memeriksa otorisasi sama
 * sekali — siapa pun yang tahu sebuah organizationId bisa menarik daftar
 * seluruh siswanya berikut email. Itu diperbaiki di sini.
 */
@Injectable()
export class TeachersService {
    private readonly logger = new Logger(TeachersService.name);

    constructor(
        private readonly db: DbService,
        private readonly authz: AuthorizationService,
        private readonly authUsers: AuthUsersRepository,
    ) {}

    /** Organisasi tempat pemanggil terdaftar. */
    async organization(user: AuthUser) {
        const { data: member } = await this.db
            .from('cbt_organization_members')
            .select('organization_id, organizations:cbt_organizations(name)')
            .eq('user_id', user.id)
            .maybeSingle();

        if (!member) return null;
        const row = member as { organization_id: string; organizations?: { name?: string } };
        return { id: row.organization_id, name: row.organizations?.name ?? null };
    }

    /** Kelas tambahan yang dibuat pemanggil sendiri. */
    async listClasses(user: AuthUser, organizationId: string) {
        await this.authz.assertOrgStaff(user, organizationId);

        const { data, error } = await this.db
            .from('cbt_additional_classes')
            .select('*, class_members:cbt_additional_class_members(count)')
            .eq('organization_id', organizationId)
            .eq('created_by', user.id)
            .order('created_at', { ascending: false });

        if (error) {
            this.logger.error(`Gagal membaca kelas: ${error.message}`);
            throw new InternalServerErrorException('Gagal membaca daftar kelas.');
        }

        return ((data as any[]) || []).map((c) => ({
            ...c,
            type: 'tambahan',
            studentCount: c.class_members?.[0]?.count || 0,
        }));
    }

    async createClass(user: AuthUser, organizationId: string, name: string) {
        await this.authz.assertOrgStaff(user, organizationId);

        // Kode gabung 6 karakter. Tabrakan tidak dicegah di sini — batasan unik
        // di database yang menolaknya, dan pemanggil diminta mencoba lagi.
        const joinCode = Math.random().toString(36).substring(2, 8).toUpperCase();

        const { data, error } = await this.db
            .from('cbt_additional_classes')
            .insert({
                organization_id: organizationId,
                name,
                join_code: joinCode,
                created_by: user.id,
            })
            .select()
            .single();

        if (error) {
            this.logger.error(`Gagal membuat kelas: ${error.message}`);
            throw new InternalServerErrorException('Gagal membuat kelas.');
        }

        return { ...(data as object), type: 'tambahan' };
    }

    /**
     * Hapus kelas tambahan. Proktor/Admin boleh menghapus kelas siapa pun;
     * Guru hanya kelas yang ia buat sendiri.
     */
    async removeClass(user: AuthUser, classId: string) {
        const { data: cls } = await this.db
            .from('cbt_additional_classes')
            .select('organization_id, created_by')
            .eq('id', classId)
            .maybeSingle();

        if (!cls) throw new NotFoundException('Kelas tidak ditemukan.');
        const row = cls as { organization_id: string; created_by: string | null };

        await this.authz.assertOrgStaff(user, row.organization_id);

        if (row.created_by !== user.id) {
            const elevated =
                user.isPlatformAdmin ||
                user.resolved?.superadmin === true ||
                (await this.authzHasElevatedRole(user, row.organization_id));
            if (!elevated) {
                throw new ForbiddenException(
                    'Anda hanya dapat menghapus kelas yang Anda buat sendiri.',
                );
            }
        }

        // Keanggotaan dibersihkan lebih dulu agar tidak tersandung foreign key.
        await this.db.from('cbt_additional_class_members').delete().eq('class_id', classId);

        const { error } = await this.db
            .from('cbt_additional_classes')
            .delete()
            .eq('id', classId);

        if (error) {
            this.logger.error(`Gagal menghapus kelas ${classId}: ${error.message}`);
            throw new InternalServerErrorException('Gagal menghapus kelas.');
        }
    }

    private async authzHasElevatedRole(user: AuthUser, organizationId: string) {
        try {
            await this.authz.assertOrgRole(user, organizationId, ['Proktor', 'Admin']);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Masukkan seorang siswa ke kelas tambahan.
     *
     * `studentId` adalah SISWA yang ditambahkan, bukan pemanggil — otorisasinya
     * karena itu diturunkan dari organisasi kelasnya.
     */
    async addStudentToClass(user: AuthUser, classId: string, studentId: string) {
        const { data: cls } = await this.db
            .from('cbt_additional_classes')
            .select('organization_id')
            .eq('id', classId)
            .maybeSingle();

        if (!cls) throw new NotFoundException('Kelas tidak ditemukan.');
        const orgId = (cls as { organization_id: string }).organization_id;
        await this.authz.assertOrgStaff(user, orgId);

        // Pastikan studentId yang didaftarkan adalah anggota aktif di sekolah yang sama
        const { data: studentMember } = await this.db
            .from('cbt_organization_members')
            .select('id')
            .eq('organization_id', orgId)
            .eq('user_id', studentId)
            .eq('is_active', true)
            .maybeSingle();

        if (!studentMember) {
            throw new BadRequestException('Siswa yang dipilih bukan anggota aktif dari sekolah ini.');
        }

        const { error } = await this.db
            .from('cbt_additional_class_members')
            .upsert({ class_id: classId, user_id: studentId });

        if (error) {
            this.logger.error(`Gagal menambah siswa ke kelas: ${error.message}`);
            throw new InternalServerErrorException('Gagal menambahkan siswa ke kelas.');
        }
    }

    /** Daftar siswa satu organisasi, untuk dipilih saat menambah anggota kelas. */
    async listStudents(user: AuthUser, organizationId: string) {
        // Versi lama sama sekali tidak memeriksa apa pun di sini.
        await this.authz.assertOrgStaff(user, organizationId);

        const { data, error } = await this.db
            .from('cbt_organization_members')
            .select(
                `user_id,
                 profiles:cbt_profiles(full_name),
                 member_roles:cbt_member_roles!inner(roles:cbt_roles!inner(name))`,
            )
            .eq('organization_id', organizationId)
            .eq('member_roles.roles.name', 'Siswa');

        if (error) {
            this.logger.error(`Gagal membaca daftar siswa: ${error.message}`);
            throw new InternalServerErrorException('Gagal membaca daftar siswa.');
        }

        const members = (data as any[]) || [];
        // Email diambil sekali untuk seluruh id sekaligus. Versi lama memanggil
        // auth.admin.listUsers() yang menarik SELURUH 308 pengguna hanya untuk
        // memetakan beberapa email.
        const emails = await this.authUsers.emailMap(members.map((m) => m.user_id));

        return members.map((m) => ({
            userId: m.user_id,
            fullName: m.profiles?.full_name || 'No Name',
            email: emails.get(m.user_id) || '-',
        }));
    }

    /** Jawaban esai satu attempt untuk dinilai manual. */
    async gradingDetails(user: AuthUser, attemptId: string) {
        const { data: attempt, error: attemptError } = await this.db
            .from('cbt_exam_attempts')
            .select(
                `id, exam_id, total_score, status, needs_manual_grading,
                 profiles:cbt_profiles(full_name),
                 exams:cbt_exams(title)`,
            )
            .eq('id', attemptId)
            .maybeSingle();

        if (attemptError || !attempt) throw new NotFoundException('Pengerjaan tidak ditemukan.');

        await this.authz.assertExamStaff(user, (attempt as { exam_id: string }).exam_id);

        // Kolomnya bernama `question_text`, bukan `question`. Versi lama
        // menyeleksi `question`, sehingga query ini SELALU gagal dan fungsinya
        // selalu mengembalikan null — halaman penilaian tugas tidak pernah
        // menampilkan satu pun jawaban.
        //
        // `metadata` dan opsi ikut diseleksi karena halaman pemanggilnya membaca
        // `qInfo.metadata?.is_multi_topic` dan `qInfo.options`; keduanya juga
        // tidak pernah ada di select lama.
        const { data: answers, error: answersError } = await this.db
            .from('cbt_answers')
            .select(
                `id, essay_answer, score,
                 bank_questions:cbt_bank_questions(
                     id, question_text, type, score_default, metadata,
                     options:cbt_bank_question_options(id, option_text)
                 )`,
            )
            .eq('attempt_id', attemptId)
            .in('bank_questions.type', ESSAY_TYPES);

        if (answersError) {
            this.logger.error(`Gagal membaca jawaban esai: ${answersError.message}`);
            throw new InternalServerErrorException('Gagal membaca jawaban.');
        }

        return {
            attempt,
            essayAnswers: ((answers as any[]) || []).filter((a) => a.bank_questions !== null),
        };
    }

    /** Simpan nilai esai lalu hitung ulang total skor attempt. */
    async submitEssayGrades(
        user: AuthUser,
        attemptId: string,
        grades: Record<string, number>,
    ) {
        const { data: attempt } = await this.db
            .from('cbt_exam_attempts')
            .select('exam_id, organization_id, status')
            .eq('id', attemptId)
            .maybeSingle();

        if (!attempt) throw new NotFoundException('Pengerjaan tidak ditemukan.');
        const examId = (attempt as { exam_id: string }).exam_id;

        // Proktor/Admin bebas; Guru hanya boleh menilai esai dari ujian
        // buatannya sendiri.
        await this.authz.assertExamStaff(user, examId);

        if (!['submitted', 'auto_submitted'].includes(attempt.status)) {
            throw new BadRequestException('Pengerjaan belum selesai.');
        }
        if (!grades || Object.keys(grades).length === 0) {
            throw new BadRequestException('Pilih setidaknya satu jawaban untuk dinilai.');
        }

        const questions = await loadExamQuestions(this.db, examId, 'id, type, score_default, created_at');
        if (questions.length === 0) throw new BadRequestException('Bank soal ujian tidak ditemukan.');
        const questionMap = new Map<string, any>(questions.map(q => [q.id, q]));
        const { data: ownedAnswers, error: answersError } = await this.db.from('cbt_answers')
            .select('id, question_id').eq('attempt_id', attemptId).in('id', Object.keys(grades));
        if (answersError) throw new BadRequestException(answersError.message);
        const answerMap = new Map<string, any>(((ownedAnswers as any[]) || []).map(a => [a.id, a]));
        // Validate the complete request before the first mutation.
        for (const [answerId, score] of Object.entries(grades)) {
            const question = questionMap.get(answerMap.get(answerId)?.question_id);
            if (!question || !ESSAY_TYPES.includes(question.type)) {
                throw new ForbiddenException('Jawaban esai tidak ditemukan pada pengerjaan ini.');
            }
            if (typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > (question.score_default || 1)) {
                throw new BadRequestException('Nilai harus berada antara nol dan skor maksimum soal.');
            }
        }
        for (const [answerId, score] of Object.entries(grades)) {
            const { data: updated, error } = await this.db
                .from('cbt_answers')
                .update({ score, is_correct: score > 0 })
                .eq('id', answerId).eq('attempt_id', attemptId).select('id').maybeSingle();
            if (error || !updated) throw new BadRequestException('Nilai jawaban gagal disimpan. Coba lagi.');
        }

        const academicQuestions = ((questions as any[]) || []).filter(q => !PERSONALITY_TYPES.includes(q.type));
        const maxScore = academicQuestions.reduce(
            (sum, q) => sum + (q.score_default || 1),
            0,
        );

        const { data: allAnswers, error: allAnswersError } = await this.db
            .from('cbt_answers')
            .select('question_id, score, is_correct')
            .eq('attempt_id', attemptId);
        if (allAnswersError) throw new BadRequestException(allAnswersError.message);

        const academicIds = new Set(academicQuestions.map(q => q.id));
        const total = ((allAnswers as any[]) || []).filter(a => academicIds.has(a.question_id)).reduce(
            (sum, a) => sum + (a.score || 0),
            0,
        );
        const pending = academicQuestions.filter(q => ESSAY_TYPES.includes(q.type)).some(q =>
            !((allAnswers as any[]) || []).some(a => a.question_id === q.id &&
                typeof a.score === 'number' && a.is_correct !== null && a.is_correct !== undefined),
        );

        const finalScore = maxScore > 0 ? (total / maxScore) * 100 : 0;

        const { error: totalError } = await this.db
            .from('cbt_exam_attempts')
            .update({ total_score: finalScore, needs_manual_grading: pending })
            .eq('id', attemptId);
        if (totalError) throw new BadRequestException(totalError.message);

        return { totalScore: finalScore };
    }

    /**
     * Statistik ringkas untuk dasbor guru.
     *
     * Hanya menghitung bank soal dan ujian buatan pemanggil sendiri, serta
     * mengecualikan PAS/PAT — konsisten dengan daftar ujian yang ia lihat.
     */
    async stats(user: AuthUser, organizationId: string) {
        await this.authz.assertOrgStaff(user, organizationId);
        const now = new Date().toISOString();

        const [members, banks, exams] = await Promise.all([
            this.db
                .from('cbt_organization_members')
                .select('id', { count: 'exact', head: true })
                .eq('organization_id', organizationId),
            this.db
                .from('cbt_question_banks')
                .select('id', { count: 'exact', head: true })
                .eq('organization_id', organizationId)
                .eq('created_by', user.id),
            this.db
                .from('cbt_exams')
                .select('is_published, status, start_time, end_time, exam_type')
                .eq('organization_id', organizationId)
                .eq('created_by', user.id),
        ]);

        const examRows = ((exams.data as any[]) || []).filter(
            (e) => e.exam_type !== 'pas' && e.exam_type !== 'pat',
        );

        const draftExams = examRows.filter((e) => !e.is_published).length;

        const ongoingExams = examRows.filter(
            (e) =>
                !!e.is_published &&
                e.status === 'active' &&
                (!e.start_time || e.start_time <= now) &&
                (!e.end_time || e.end_time >= now),
        ).length;

        const finishedExams = examRows.filter(
            (e) =>
                e.status === 'finished' ||
                (!!e.is_published && e.status === 'active' && e.end_time && e.end_time < now),
        ).length;

        return {
            totalMembers: members.count || 0,
            totalBanks: banks.count || 0,
            draftExams,
            ongoingExams,
            finishedExams,
        };
    }
}
