import { Injectable, NotFoundException } from '@nestjs/common';
import type { AuthUser } from '@acca-cbt/shared';
import { AuthorizationService } from '../auth/authorization.service';
import { CbtRolesService } from '../auth/cbt-roles.service';
import { DbService } from '../prisma/prisma-db-adapter';

/**
 * Status attempt yang dihitung "selesai mengerjakan". `auto_submitted` (waktu
 * habis / ditutup sistem) WAJIB ikut — pernah hanya 'submitted' sehingga siswa
 * yang kehabisan waktu menghilang dari seluruh analisis.
 */
const FINISHED_STATUSES = ['submitted', 'auto_submitted'];

/**
 * Analisis hasil ujian untuk guru dan proktor.
 *
 * Dipindahkan dari `apps/web/app/actions/analytics.ts`.
 *
 * Satu hal yang HILANG di sini dan itu memang disengaja: `fetchAllRows`.
 * Helper itu ada untuk melewati cap 1000 baris PostgREST — sebuah `.select()`
 * yang cocok dengan lebih dari 1000 baris dipotong diam-diam, tanpa galat,
 * sehingga analisis butir pada ujian besar (peserta × soal) salah hitung.
 * Adapter NestJS berbicara langsung ke PostgreSQL lewat SQL mentah; tidak ada
 * cap semacam itu, dan `LIMIT` hanya muncul kalau kita yang meminta. Jadi query
 * tunggal di bawah sudah mengembalikan seluruh baris.
 */
@Injectable()
export class AnalyticsService {
    constructor(
        private readonly db: DbService,
        private readonly authz: AuthorizationService,
        private readonly roles: CbtRolesService,
    ) {}

    /**
     * Guru (bukan Proktor/Admin) hanya melihat ujian buatannya sendiri.
     * Dipakai daftar ujian; analisis per-ujian memakai `assertExamStaff` yang
     * sudah memuat aturan yang sama plus aturan khusus PAS/PAT.
     */
    private async isElevated(user: AuthUser, organizationId: string): Promise<boolean> {
        if (user.isPlatformAdmin || user.resolved?.superadmin === true) return true;
        return this.roles.hasOrgRole(user.id, organizationId, ['Proktor', 'Admin']);
    }

    async examsWithStats(user: AuthUser, organizationId: string) {
        await this.authz.assertOrgStaff(user, organizationId);

        let query = this.db
            .from('cbt_exams')
            .select(
                `*,
                question_banks:cbt_question_banks(title),
                exam_attempts:cbt_exam_attempts(id, status, total_score)`,
            )
            .eq('organization_id', organizationId);

        if (!(await this.isElevated(user, organizationId))) {
            query = query.eq('created_by', user.id);
        }

        const { data } = await query.order('created_at', { ascending: false });

        return ((data as any[]) || []).map((exam) => {
            const attempts = exam.exam_attempts ?? [];
            const completed = attempts.filter((a: any) => FINISHED_STATUSES.includes(a.status));
            const scores = completed
                .filter((a: any) => a.total_score !== null)
                .map((a: any) => Number(a.total_score) || 0);
            const avgScore =
                scores.length > 0
                    ? Math.round(
                          scores.reduce((a: number, b: number) => a + b, 0) / scores.length,
                      )
                    : 0;

            return {
                ...exam,
                total_attempts: attempts.length,
                completed_attempts: completed.length,
                average_score: avgScore,
            };
        });
    }

    async examAnalytics(user: AuthUser, examId: string) {
        await this.authz.assertExamStaff(user, examId);

        const { data: examRow } = await this.db
            .from('cbt_exams')
            .select('*, question_banks:cbt_question_banks(title)')
            .eq('id', examId)
            .maybeSingle();

        if (!examRow) throw new NotFoundException('Ujian tidak ditemukan.');
        const exam = examRow as any;

        const { data: attemptRows } = await this.db
            .from('cbt_exam_attempts')
            .select('*')
            .eq('exam_id', examId);
        const attempts = (attemptRows as any[]) || [];

        const completedAttempts = attempts.filter((a) => FINISHED_STATUSES.includes(a.status));

        // Skor 0 yang sah tetap dihitung; hanya attempt yang BELUM ternilai
        // (total_score null, mis. esai menunggu koreksi) yang dikecualikan.
        const scores = completedAttempts
            .filter((a) => a.total_score !== null)
            .map((a) => Number(a.total_score) || 0);
        const sortedScores = [...scores].sort((a, b) => a - b);

        const scoreStats = {
            average:
                scores.length > 0
                    ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
                    : 0,
            median: sortedScores.length > 0 ? sortedScores[Math.floor(sortedScores.length / 2)] : 0,
            highest: sortedScores.length > 0 ? sortedScores[sortedScores.length - 1] : 0,
            lowest: sortedScores.length > 0 ? sortedScores[0] : 0,
            total: scores.reduce((a, b) => a + b, 0),
            completed: scores.length,
        };

        const buckets = [
            { range: '0-20', min: 0, max: 20 },
            { range: '21-40', min: 21, max: 40 },
            { range: '41-60', min: 41, max: 60 },
            { range: '61-80', min: 61, max: 80 },
            { range: '81-100', min: 81, max: 100 },
        ];

        const scoreDistribution = buckets.map((d) => {
            const count = scores.filter((s) => s >= d.min && s <= d.max).length;
            return {
                range: d.range,
                count,
                percentage: scores.length > 0 ? Math.round((count / scores.length) * 100) : 0,
            };
        });

        const { data: questionRows } = await this.db
            .from('cbt_bank_questions')
            .select('*')
            .eq('bank_id', exam.question_bank_id)
            .order('created_at', { ascending: true });
        const questions = (questionRows as any[]) || [];

        const attemptIds = attempts.map((a) => a.id);
        const { data: answerRows } =
            attemptIds.length > 0
                ? await this.db.from('cbt_answers').select('*').in('attempt_id', attemptIds)
                : { data: [] as any[] };
        const answers = (answerRows as any[]) || [];

        const questionAnalytics = questions.map((q) => {
            const qAnswers = answers.filter((a) => a.question_id === q.id);
            const correct = qAnswers.filter((a) => a.is_correct === true).length;
            const wrong = qAnswers.filter((a) => a.is_correct === false).length;
            const total = qAnswers.length;

            return {
                question_id: q.id,
                question_text: q.question_text,
                question_type: q.type,
                total_attempts: total,
                correct_count: correct,
                wrong_count: wrong,
                unanswered_count: Math.max(0, completedAttempts.length - total),
                correct_percentage: total > 0 ? Math.round((correct / total) * 100) : 0,
                average_time_seconds: 0,
                difficulty: q.difficulty || 'medium',
            };
        });

        // Tersulit lebih dulu.
        questionAnalytics.sort((a, b) => a.correct_percentage - b.correct_percentage);

        return {
            exam_id: exam.id,
            exam_title: exam.title,
            total_participants: attempts.length,
            completed_count: completedAttempts.length,
            in_progress_count: attempts.filter((a) => a.status === 'in_progress').length,
            not_started_count: 0,
            score_stats: scoreStats,
            time_stats: {
                average_seconds: 0,
                median_seconds: 0,
                fastest_seconds: 0,
                slowest_seconds: 0,
                total_time_used_seconds: 0,
            },
            question_analytics: questionAnalytics,
            difficulty_stats: {
                easy: { count: 0, avg_correct_percentage: 0 },
                medium: { count: 0, avg_correct_percentage: 0 },
                hard: { count: 0, avg_correct_percentage: 0 },
            },
            score_distribution: scoreDistribution,
            time_distribution: [],
        };
    }

    async studentPerformance(user: AuthUser, examId: string) {
        await this.authz.assertExamStaff(user, examId);

        const { data } = await this.db
            .from('cbt_exam_attempts')
            .select('*, profiles:cbt_profiles(full_name, email)')
            .eq('exam_id', examId)
            .in('status', FINISHED_STATUSES);

        const studentMap = new Map<string, any>();

        ((data as any[]) || []).forEach((attempt) => {
            const studentId = attempt.user_id;
            const existing = studentMap.get(studentId);
            const score = Number(attempt.total_score) || 0;

            if (existing) {
                existing.total_exams += 1;
                existing.completed_exams += 1;
                existing.highest_score = Math.max(existing.highest_score, score);
                existing.lowest_score = Math.min(existing.lowest_score, score);
                existing.average_score =
                    (existing.average_score * (existing.completed_exams - 1) + score) /
                    existing.completed_exams;
                // Simpan attempt TERBARU sebagai rujukan detail jawaban.
                if (
                    !existing.attempt_id ||
                    (attempt.finished_at && attempt.finished_at > existing._finished_at)
                ) {
                    existing.attempt_id = attempt.id;
                    existing.attempt_status = attempt.status;
                    existing._finished_at = attempt.finished_at;
                }
            } else {
                studentMap.set(studentId, {
                    student_id: studentId,
                    student_name: attempt.profiles?.full_name ?? 'Unknown',
                    student_email: attempt.profiles?.email ?? '',
                    total_exams: 1,
                    completed_exams: 1,
                    average_score: score,
                    highest_score: score,
                    lowest_score: score,
                    total_time_used_seconds: 0,
                    attempt_id: attempt.id,
                    attempt_status: attempt.status,
                    _finished_at: attempt.finished_at,
                });
            }
        });

        const performances = Array.from(studentMap.values()).map((p) => {
            delete p._finished_at;
            return p;
        });
        performances.sort((a, b) => b.average_score - a.average_score);
        performances.forEach((p, i) => {
            p.rank = i + 1;
        });

        return performances;
    }

    /**
     * Seluruh jawaban satu attempt beserta soal, opsi (termasuk kunci), skor dan
     * status benar/salah — dipakai halaman analisis guru untuk membandingkan
     * jawaban siswa dengan kunci jawaban.
     */
    async attemptReviewForStaff(user: AuthUser, attemptId: string) {
        const { data: attemptRow } = await this.db
            .from('cbt_exam_attempts')
            .select(
                `id, user_id, exam_id, organization_id, status, total_score, score_irt,
                needs_manual_grading, started_at, finished_at, warning_count, metadata,
                profiles:cbt_profiles(full_name, email, identity_number),
                exams:cbt_exams(id, title)`,
            )
            .eq('id', attemptId)
            .maybeSingle();

        if (!attemptRow) throw new NotFoundException('Pengerjaan tidak ditemukan.');
        const attempt = attemptRow as any;

        // Otorisasi lewat ujian induk: Guru hanya attempt dari ujian buatannya.
        await this.authz.assertExamStaff(user, attempt.exam_id);

        const { data: answers } = await this.db
            .from('cbt_answers')
            .select(
                `id, question_id, selected_option_id, essay_answer, is_correct, score, is_doubtful,
                bank_questions:cbt_bank_questions(id, question_text, type, score_default, metadata, created_at,
                    bank_question_options:cbt_bank_question_options(id, option_text, is_correct, weight, metadata, order)
                )`,
            )
            .eq('attempt_id', attemptId);

        const mapped = ((answers as any[]) || [])
            .filter((a) => a.bank_questions)
            .map((a) => ({
                id: a.id,
                questionId: a.question_id,
                selectedOptionId: a.selected_option_id,
                essayAnswer: a.essay_answer,
                isCorrect: a.is_correct,
                score: a.score,
                isDoubtful: a.is_doubtful,
                question: {
                    id: a.bank_questions.id,
                    question_text: a.bank_questions.question_text,
                    type: a.bank_questions.type,
                    score_default: a.bank_questions.score_default,
                    metadata: a.bank_questions.metadata,
                    created_at: a.bank_questions.created_at,
                    options: (a.bank_questions.bank_question_options || []).sort(
                        (x: any, y: any) => (x.order ?? 0) - (y.order ?? 0),
                    ),
                },
            }))
            // Urutkan mengikuti urutan soal di bank (order_index → created_at).
            .sort((x: any, y: any) => {
                const ox = x.question.metadata?.order_index;
                const oy = y.question.metadata?.order_index;
                if (ox !== undefined && oy !== undefined) return ox - oy;
                return String(x.question.created_at || '').localeCompare(
                    String(y.question.created_at || ''),
                );
            });

        return { attempt, answers: mapped };
    }

    /**
     * Respons seluruh peserta terhadap SATU soal: distribusi per opsi + daftar
     * jawaban tiap siswa (terpilih maupun diketik) — untuk tab "Soal" analisis.
     */
    async questionResponses(user: AuthUser, examId: string, questionId: string) {
        await this.authz.assertExamStaff(user, examId);

        const { data: questionRow } = await this.db
            .from('cbt_bank_questions')
            .select(
                `id, question_text, type, score_default, metadata,
                bank_question_options:cbt_bank_question_options(id, option_text, is_correct, weight, metadata, order)`,
            )
            .eq('id', questionId)
            .maybeSingle();

        if (!questionRow) throw new NotFoundException('Soal tidak ditemukan.');
        const question = questionRow as any;

        const { data: attemptRows } = await this.db
            .from('cbt_exam_attempts')
            .select('id, user_id, status, profiles:cbt_profiles(full_name)')
            .eq('exam_id', examId)
            .in('status', FINISHED_STATUSES);
        const attempts = (attemptRows as any[]) || [];

        const attemptIds = attempts.map((a) => a.id);
        const nameByAttempt = new Map(
            attempts.map((a) => [a.id, a.profiles?.full_name || 'Tanpa Nama']),
        );

        const { data: answerRows } =
            attemptIds.length > 0
                ? await this.db
                      .from('cbt_answers')
                      .select('attempt_id, selected_option_id, essay_answer, is_correct, score')
                      .eq('question_id', questionId)
                      .in('attempt_id', attemptIds)
                : { data: [] as any[] };
        const answers = (answerRows as any[]) || [];

        const options = (question.bank_question_options || []).sort(
            (a: any, b: any) => (a.order ?? 0) - (b.order ?? 0),
        );

        const optionCounts: Record<string, number> = {};
        answers.forEach((a) => {
            if (a.selected_option_id) {
                optionCounts[a.selected_option_id] = (optionCounts[a.selected_option_id] || 0) + 1;
            }
        });

        const answeredAttemptIds = new Set(answers.map((a) => a.attempt_id));

        return {
            question: {
                id: question.id,
                question_text: question.question_text,
                type: question.type,
                score_default: question.score_default,
                metadata: question.metadata,
                options,
            },
            optionCounts,
            responses: answers.map((a) => ({
                studentName: nameByAttempt.get(a.attempt_id) || 'Tanpa Nama',
                selectedOptionId: a.selected_option_id,
                essayAnswer: a.essay_answer,
                isCorrect: a.is_correct,
                score: a.score,
            })),
            unanswered: attempts
                .filter((a) => !answeredAttemptIds.has(a.id))
                .map((a) => a.profiles?.full_name || 'Tanpa Nama'),
        };
    }

    /** Data mentah untuk unduhan rekap ujian (Excel/CSV dirakit di frontend). */
    async examExportData(user: AuthUser, examId: string) {
        await this.authz.assertExamStaff(user, examId);

        const { data: examRow } = await this.db
            .from('cbt_exams')
            .select('*, question_banks:cbt_question_banks(*)')
            .eq('id', examId)
            .maybeSingle();

        if (!examRow) throw new NotFoundException('Ujian tidak ditemukan.');
        const exam = examRow as any;

        const { data: questions } = await this.db
            .from('cbt_bank_questions')
            .select('*, bank_question_options:cbt_bank_question_options(*)')
            .eq('bank_id', exam.question_bank_id)
            .order('created_at', { ascending: true });

        const { data: attempts } = await this.db
            .from('cbt_exam_attempts')
            .select(
                `*,
                profiles:cbt_profiles(full_name, email, unique_id),
                answers:cbt_answers(*)`,
            )
            .eq('exam_id', examId)
            .in('status', FINISHED_STATUSES)
            .order('total_score', { ascending: false });

        return {
            exam,
            questions: (questions as any[]) ?? [],
            attempts: (attempts as any[]) ?? [],
        };
    }
}
