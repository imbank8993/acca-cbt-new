import { Injectable } from '@nestjs/common';
import type { AuthUser } from '@acca-cbt/shared';
import { DbService } from '../prisma/prisma-db-adapter';

const FINISHED_STATUSES = ['submitted', 'auto_submitted'];

export function calculateTrend(scores: number[]): 'up' | 'down' | 'stable' {
    if (scores.length < 2) return 'stable';
    // Data berurutan lama → baru. Bagi menjadi dua kelompok yang sama-sama
    // berisi data; versi lama membandingkan 2–3 skor dengan kelompok kosong
    // bernilai nol sehingga penurunan 90 → 60 justru dilabeli "naik".
    const split = Math.floor(scores.length / 2);
    const older = scores.slice(0, split);
    const recent = scores.slice(split);
    const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
    const olderAvg = older.reduce((a, b) => a + b, 0) / older.length;
    const diff = recentAvg - olderAvg;
    if (diff > 5) return 'up';
    if (diff < -5) return 'down';
    return 'stable';
}

/**
 * Analisis performa siswa atas dirinya sendiri.
 *
 * Dipindahkan dari `apps/web/app/actions/student-analytics.ts`. Ketiga fungsi
 * di sana menerima `userId` sebagai parameter dari browser; siswa mana pun bisa
 * membaca rekap siswa lain hanya dengan menukar UUID. Di sini tidak ada
 * parameter identitas sama sekali — semuanya memakai `user.id` dari token.
 *
 * Catatan: `cbt_exam_attempts.total_score` sudah berupa persentase 0–100, bukan
 * jumlah poin mentah. Seluruh perhitungan di bawah bergantung pada itu.
 */
@Injectable()
export class StudentAnalyticsService {
    constructor(private readonly db: DbService) {}

    async overview(user: AuthUser) {
        const { data: attemptRows } = await this.db
            .from('cbt_exam_attempts')
            .select(
                `*,
                exams:cbt_exams (
                    id,
                    show_results,
                    title,
                    subject_id,
                    subjects:cbt_subjects (name),
                    question_bank_id,
                    question_banks:cbt_question_banks (
                        bank_questions:cbt_bank_questions (type, difficulty, score_default)
                    )
                )`,
            )
            .eq('user_id', user.id)
            .in('status', FINISHED_STATUSES)
            .order('finished_at', { ascending: true });

        const attempts = ((attemptRows as any[]) || []).filter(a => a.exams?.show_results === true);
        // Belum pernah menyelesaikan ujian: layar analitik menampilkan keadaan
        // kosong, bukan galat.
        if (attempts.length === 0) return null;

        const attemptIds = attempts.map((a) => a.id);
        const { data: answerRows } = await this.db
            .from('cbt_answers')
            .select(
                `*,
                bank_questions:cbt_bank_questions (type, difficulty, score_default)`,
            )
            .in('attempt_id', attemptIds);
        const answers = (answerRows as any[]) || [];

        const scores = attempts.map((a) => Number(a.total_score) || 0);
        const totalExams = attempts.length;
        const averageScore = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);

        // Peringkat dihitung terhadap SELURUH peserta, tanpa batas organisasi —
        // sama seperti versi asalnya. Yang keluar hanya angka peringkat dan
        // persentil, bukan identitas siswa lain.
        const { data: allAttemptRows } = await this.db
            .from('cbt_exam_attempts')
            .select('user_id, total_score, exams:cbt_exams(show_results)')
            .in('status', FINISHED_STATUSES);

        const studentAverages = new Map<string, number[]>();
        ((allAttemptRows as any[]) || []).filter(a => a.exams?.show_results === true).forEach((a) => {
            const list = studentAverages.get(a.user_id) || [];
            list.push(Number(a.total_score) || 0);
            studentAverages.set(a.user_id, list);
        });

        const studentAvgScores = Array.from(studentAverages.entries()).map(([uid, s]) => ({
            userId: uid,
            avg: s.reduce((a, b) => a + b, 0) / s.length,
        }));
        studentAvgScores.sort((a, b) => b.avg - a.avg);

        const rank = studentAvgScores.findIndex((s) => s.userId === user.id) + 1;
        const percentile = Math.round(
            ((studentAvgScores.length - rank) / studentAvgScores.length) * 100,
        );

        const overview = {
            totalExams,
            completedExams: attempts.length,
            averageScore,
            highestScore: Math.max(...scores),
            lowestScore: Math.min(...scores),
            totalStudyTime: attempts.reduce((sum, a) => {
                const start = new Date(a.started_at).getTime();
                const end = new Date(a.finished_at || a.started_at).getTime();
                return sum + Math.floor((end - start) / 1000);
            }, 0),
            rank,
            totalStudents: studentAvgScores.length,
            percentile,
        };

        const recentAttempts = attempts
            .slice(-10)
            .reverse()
            .map((a, idx) => {
                const percentage = Math.round(Number(a.total_score) || 0);
                return {
                    attemptId: a.id,
                    examId: a.exams?.id || '',
                    examTitle: a.exams?.title || 'Unknown Exam',
                    subjectName: a.exams?.subjects?.name || 'Umum',
                    score: percentage,
                    maxScore: 100,
                    percentage,
                    startedAt: a.started_at,
                    finishedAt: a.finished_at || a.started_at,
                    timeSpentSeconds: Math.floor(
                        (new Date(a.finished_at || a.started_at).getTime() -
                            new Date(a.started_at).getTime()) /
                            1000,
                    ),
                    status: a.status,
                    rank: idx + 1,
                    classAverage: 0,
                };
            });

        const performanceTrend = attempts.map((a) => ({
            date: a.finished_at || a.started_at,
            score: Math.round(Number(a.total_score) || 0),
            examTitle: a.exams?.title || 'Exam',
        }));

        const subjectMap = new Map<
            string,
            {
                subjectId: string;
                subjectName: string;
                scores: number[];
                questionsByType: Map<string, { correct: number; total: number }>;
            }
        >();

        attempts.forEach((a) => {
            const subjectId = a.exams?.subject_id || 'general';
            const subjectName = a.exams?.subjects?.name || 'Umum';
            if (!subjectMap.has(subjectId)) {
                subjectMap.set(subjectId, {
                    subjectId,
                    subjectName,
                    scores: [],
                    questionsByType: new Map(),
                });
            }
            subjectMap.get(subjectId)!.scores.push(Number(a.total_score) || 0);
        });

        answers.forEach((answer) => {
            const attempt = attempts.find((a) => a.id === answer.attempt_id);
            if (!attempt) return;

            const subjectData = subjectMap.get(attempt.exams?.subject_id || 'general');
            if (!subjectData) return;

            const qType = answer.bank_questions?.type || 'mcq';
            if (!subjectData.questionsByType.has(qType)) {
                subjectData.questionsByType.set(qType, { correct: 0, total: 0 });
            }
            const typeData = subjectData.questionsByType.get(qType)!;
            typeData.total++;
            if (answer.is_correct) typeData.correct++;
        });

        const subjectPerformance = Array.from(subjectMap.values()).map((s) => ({
            subjectId: s.subjectId,
            subjectName: s.subjectName,
            totalExams: s.scores.length,
            averageScore: Math.round(s.scores.reduce((a, b) => a + b, 0) / s.scores.length),
            highestScore: Math.max(...s.scores),
            lowestScore: Math.min(...s.scores),
            trend: calculateTrend(s.scores),
            questionTypeBreakdown: Array.from(s.questionsByType.entries()).map(([type, data]) => ({
                type,
                correct: data.correct,
                total: data.total,
                percentage: data.total > 0 ? Math.round((data.correct / data.total) * 100) : 0,
            })),
        }));

        const difficultyMap = new Map<string, { correct: number; total: number }>();
        answers.forEach((answer) => {
            const difficulty = answer.bank_questions?.difficulty || 'medium';
            if (!difficultyMap.has(difficulty)) {
                difficultyMap.set(difficulty, { correct: 0, total: 0 });
            }
            const data = difficultyMap.get(difficulty)!;
            data.total++;
            if (answer.is_correct) data.correct++;
        });

        const difficultyPerformance = ['easy', 'medium', 'hard'].map((d) => {
            const data = difficultyMap.get(d) || { correct: 0, total: 0 };
            return {
                difficulty: d,
                totalQuestions: data.total,
                correctAnswers: data.correct,
                percentage: data.total > 0 ? Math.round((data.correct / data.total) * 100) : 0,
            };
        });

        const strengthsWeaknesses: Array<{
            type: 'strength' | 'weakness';
            category: string;
            description: string;
            score: number;
            recommendation: string;
        }> = [];

        const typeStats = new Map<string, { correct: number; total: number }>();
        answers.forEach((answer) => {
            const qType = answer.bank_questions?.type || 'mcq';
            if (!typeStats.has(qType)) typeStats.set(qType, { correct: 0, total: 0 });
            const data = typeStats.get(qType)!;
            data.total++;
            if (answer.is_correct) data.correct++;
        });

        const typeResults = Array.from(typeStats.entries())
            .map(([type, data]) => ({
                type,
                percentage: data.total > 0 ? Math.round((data.correct / data.total) * 100) : 0,
            }))
            .sort((a, b) => b.percentage - a.percentage);

        if (typeResults.length > 0 && typeResults[0].percentage >= 70) {
            strengthsWeaknesses.push({
                type: 'strength',
                category: typeResults[0].type.toUpperCase(),
                description: `Tipe soal ${typeResults[0].type} dengan ${typeResults[0].percentage}% benar`,
                score: typeResults[0].percentage,
                recommendation:
                    'Pertahankan performa ini! Coba tingkatkan dengan soal yang lebih sulit.',
            });
        }

        if (typeResults.length > 0) {
            const weakest = typeResults[typeResults.length - 1];
            if (weakest.percentage < 60) {
                strengthsWeaknesses.push({
                    type: 'weakness',
                    category: weakest.type.toUpperCase(),
                    description: `Tipe soal ${weakest.type} dengan hanya ${weakest.percentage}% benar`,
                    score: weakest.percentage,
                    recommendation: 'Fokus untuk berlatih lebih banyak soal tipe ini.',
                });
            }
        }

        const easyPerf = difficultyMap.get('easy');
        const hardPerf = difficultyMap.get('hard');

        if (easyPerf && hardPerf) {
            const easyPct = easyPerf.total > 0 ? (easyPerf.correct / easyPerf.total) * 100 : 0;
            const hardPct = hardPerf.total > 0 ? (hardPerf.correct / hardPerf.total) * 100 : 0;

            if (easyPct < 70) {
                strengthsWeaknesses.push({
                    type: 'weakness',
                    category: 'SOAL MUDAH',
                    description: `Hanya ${Math.round(easyPct)}% benar untuk soal mudah`,
                    score: Math.round(easyPct),
                    recommendation:
                        'Perhatikan kembali dasar-dasar materi. Soal mudah harus dikuasai.',
                });
            }

            if (hardPct > 50) {
                strengthsWeaknesses.push({
                    type: 'strength',
                    category: 'SOAL SULIT',
                    description: `Mampu menjawab ${Math.round(hardPct)}% soal sulit`,
                    score: Math.round(hardPct),
                    recommendation: 'Kemampuan baik! Terus asah dengan variasi soal sulit.',
                });
            }
        }

        const timeSpent = attempts.map((a) =>
            Math.floor(
                (new Date(a.finished_at || a.started_at).getTime() -
                    new Date(a.started_at).getTime()) /
                    1000,
            ),
        );
        const totalQuestions = answers.length;

        const studyHabits = {
            averageTimePerExam: Math.round(
                timeSpent.reduce((a, b) => a + b, 0) / timeSpent.length,
            ),
            fastestCompletion: Math.min(...timeSpent),
            slowestCompletion: Math.max(...timeSpent),
            consistentDaysPerWeek: 0,
            mostActiveTime: 'Afternoon',
            averageQuestionsPerMinute:
                totalQuestions > 0
                    ? Math.round(totalQuestions / (timeSpent.reduce((a, b) => a + b, 0) / 60))
                    : 0,
        };

        return {
            overview,
            recentAttempts,
            performanceTrend,
            subjectPerformance,
            difficultyPerformance,
            strengthsWeaknesses,
            studyHabits,
        };
    }

    async history(user: AuthUser, limit = 20) {
        const { data } = await this.db
            .from('cbt_exam_attempts')
            .select(
                `*,
                exams:cbt_exams (
                    id,
                    show_results,
                    title,
                    description,
                    subject_id,
                    subjects:cbt_subjects (name),
                    duration_minutes,
                    exam_type,
                    organization_id,
                    metadata
                )`,
            )
            .eq('user_id', user.id)
            .in('status', FINISHED_STATUSES)
            .order('finished_at', { ascending: false });

        return ((data as any[]) || []).filter(a => a.exams?.show_results === true).slice(0, limit).map((a) => ({
            id: a.id,
            examId: a.exams?.id,
            examTitle: a.exams?.title || 'Unknown',
            subjectName: a.exams?.subjects?.name || 'Umum',
            examType: a.exams?.exam_type || 'daily',
            score: Number(a.total_score) || 0,
            startedAt: a.started_at,
            finishedAt: a.finished_at,
            durationMinutes: a.exams?.duration_minutes || 0,
            timeSpentSeconds: Math.floor(
                (new Date(a.finished_at || a.started_at).getTime() -
                    new Date(a.started_at).getTime()) /
                    1000,
            ),
            status: a.status,
        }));
    }

    async comparison(user: AuthUser) {
        // Organisasi diambil dari pengerjaan siswa itu sendiri, bukan dari
        // parameter — rata-rata kelas jadi tidak bisa diarahkan ke organisasi lain.
        const { data: firstAttempt } = await this.db
            .from('cbt_exam_attempts')
            .select('organization_id')
            .eq('user_id', user.id)
            .limit(1)
            .maybeSingle();

        const orgId = (firstAttempt as any)?.organization_id;

        const { data: studentAttempts } = await this.db
            .from('cbt_exam_attempts')
            .select('total_score, exams:cbt_exams(show_results)')
            .eq('user_id', user.id)
            .in('status', FINISHED_STATUSES);

        const own = ((studentAttempts as any[]) || []).filter(a => a.exams?.show_results === true);
        const studentAvg =
            own.length > 0
                ? own.reduce((sum, a) => sum + (Number(a.total_score) || 0), 0) / own.length
                : 0;

        let classAvg = 0;
        if (orgId) {
            const { data: classAttempts } = await this.db
                .from('cbt_exam_attempts')
                .select('total_score, organization_id, exams:cbt_exams(show_results)')
                .eq('organization_id', orgId)
                .in('status', FINISHED_STATUSES);

            const rows = ((classAttempts as any[]) || []).filter(a => a.exams?.show_results === true);
            classAvg =
                rows.length > 0
                    ? rows.reduce((sum, a) => sum + (Number(a.total_score) || 0), 0) / rows.length
                    : 0;
        }

        return {
            studentAverage: Math.round(studentAvg),
            classAverage: Math.round(classAvg),
            difference: Math.round(studentAvg - classAvg),
            betterThanClass:
                classAvg > 0 ? Math.round(((studentAvg - classAvg) / classAvg) * 100) : 0,
        };
    }
}
