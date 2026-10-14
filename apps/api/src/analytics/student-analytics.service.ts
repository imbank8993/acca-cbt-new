import { ForbiddenException, Injectable, InternalServerErrorException } from '@nestjs/common';
import { selectedStudentScore, type AuthUser } from '@acca-cbt/shared';
import { DbService } from '../prisma/prisma-db-adapter';
import { assertAnswerKeysReleased } from '../common/answer-key-release';
import { examDeadline } from '../common/exam-deadline';

const FINISHED_STATUSES = ['submitted', 'auto_submitted'];
const SUBJECTIVE_TYPES = new Set(['sjt', 'likert', 'forced_choice', 'checklist', 'ranking', 'paired_comparison']);
const SELECT = `id, exam_id, user_id, total_score, score_irt, detailed_scores, status, needs_manual_grading,
    started_at, finished_at, personal_end_time, metadata,
    exams:cbt_exams(id, organization_id, show_results, scoring_type, title, subject_id,
        subjects:cbt_subjects(name), duration_minutes, exam_type, end_time, metadata,
        question_banks:cbt_question_banks(subject))`;
const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
const rounded = (value: number) => Math.round(value * 100) / 100;

export function calculateTrend(scores: number[]): 'up' | 'down' | 'stable' {
    const valid = scores.filter(Number.isFinite);
    if (valid.length < 2) return 'stable';
    const split = Math.floor(valid.length / 2);
    const difference = mean(valid.slice(split)) - mean(valid.slice(0, split));
    return difference > 5 ? 'up' : difference < -5 ? 'down' : 'stable';
}

export function analyticsScore(attempt: any): number | null {
    return selectedStudentScore(attempt, attempt.exams);
}

/** Upload delay and abandoned sessions must not inflate working time. */
export function analyticsDuration(attempt: any): number | null {
    const start = Date.parse(attempt.started_at || '');
    const finished = Date.parse(attempt.finished_at || '');
    if (!Number.isFinite(start) || !Number.isFinite(finished) || finished < start) return null;
    const candidates = [finished];
    for (const raw of [attempt.metadata?.scoring_finished_at, attempt.metadata?.submit_intent_at]) {
        const time = typeof raw === 'string' ? Date.parse(raw) : NaN;
        if (Number.isFinite(time) && time >= start) candidates.push(time);
    }
    const exam = attempt.exams || {};
    if (attempt.personal_end_time || exam.end_time || attempt.metadata?.proctor_recovery_until ||
        (Number.isFinite(exam.duration_minutes) && exam.duration_minutes > 0)) {
        const deadline = examDeadline(attempt, exam).getTime();
        if (Number.isFinite(deadline) && deadline >= start) candidates.push(deadline);
    }
    return Math.floor((Math.min(...candidates) - start) / 1000);
}

function latestPerExam(rows: any[]) {
    const latest = new Map<string, any>();
    for (const row of rows) {
        const key = `${row.user_id}:${row.exam_id || row.exams?.id || row.id}`;
        const previous = latest.get(key);
        if (!previous || Date.parse(row.finished_at || '') > Date.parse(previous.finished_at || '') ||
            (row.finished_at === previous.finished_at && String(row.id) > String(previous.id))) latest.set(key, row);
    }
    return [...latest.values()].sort((a, b) =>
        (Date.parse(a.finished_at || '') || 0) - (Date.parse(b.finished_at || '') || 0) || String(a.id).localeCompare(String(b.id)));
}

function subjectOf(attempt: any) {
    const exam = attempt.exams;
    if (exam.subject_id && exam.subjects?.name) return { id: exam.subject_id, name: exam.subjects.name };
    const bankSubject = exam.question_banks?.subject?.trim();
    return bankSubject ? { id: `bank-subject:${bankSubject.toLocaleLowerCase('id-ID')}`, name: bankSubject }
        : { id: 'unspecified', name: 'Belum ditentukan' };
}

function historyItem(attempt: any) {
    return { id: attempt.id, examId: attempt.exams.id, examTitle: attempt.exams.title || 'Ujian',
        subjectName: subjectOf(attempt).name, examType: attempt.exams.exam_type || 'daily',
        score: analyticsScore(attempt)!, startedAt: attempt.started_at, finishedAt: attempt.finished_at,
        durationMinutes: attempt.exams.duration_minutes || 0, timeSpentSeconds: analyticsDuration(attempt), status: attempt.status };
}

type Stats = { correct: number; total: number };
function addStat(map: Map<string, Stats>, key: string, correct: boolean) {
    const value = map.get(key) || { correct: 0, total: 0 };
    value.total++; if (correct) value.correct++;
    map.set(key, value);
}

@Injectable()
export class StudentAnalyticsService {
    constructor(private readonly db: DbService) {}

    private async own(user: AuthUser) {
        const result = await this.db.from('cbt_exam_attempts').select(SELECT)
            .eq('user_id', user.id).in('status', FINISHED_STATUSES).order('finished_at', { ascending: true });
        if (result.error) throw new InternalServerErrorException('Analisis ujian belum dapat dimuat.');
        const visible = (result.data || []).filter((row: any) => row.exams?.show_results === true);
        if (!visible.length) return { attempts: [], excludedAttempts: 0 };
        const membership = await this.db.from('cbt_organization_members').select('organization_id')
            .eq('user_id', user.id).eq('is_active', true);
        if (membership.error) throw new InternalServerErrorException('Izin analisis belum dapat diperiksa.');
        const schools = [...new Set((membership.data || []).map((row: any) => row.organization_id))];
        if (schools.length !== 1) throw new ForbiddenException('Analisis memerlukan keanggotaan sekolah yang aktif.');
        const scoped = latestPerExam(visible.filter((row: any) => row.exams.organization_id === schools[0]));
        return { attempts: scoped.filter(row => analyticsScore(row) !== null),
            excludedAttempts: scoped.filter(row => analyticsScore(row) === null).length };
    }

    /** Only compare students with final scores in the exact same set of exams. */
    private async cohort(user: AuthUser, attempts: any[]) {
        if (!attempts.length) return { rank: null, percentile: null, totalStudents: 0, comparison: null };
        const examIds = attempts.map(attempt => attempt.exams.id);
        const result = await this.db.from('cbt_exam_attempts').select(`id, exam_id, user_id, total_score, score_irt, detailed_scores,
            needs_manual_grading, metadata, finished_at,
            exams:cbt_exams(id, organization_id, show_results, scoring_type, metadata)`)
            .in('exam_id', examIds).in('status', FINISHED_STATUSES);
        if (result.error) throw new InternalServerErrorException('Perbandingan nilai belum dapat dimuat.');
        const school = attempts[0].exams.organization_id;
        const members = await this.db.from('cbt_organization_members').select('user_id')
            .eq('organization_id', school).eq('is_active', true);
        if (members.error) throw new InternalServerErrorException('Izin peserta pembanding belum dapat diperiksa.');
        const memberIds = new Set((members.data || []).map((row: any) => row.user_id));
        const rows = latestPerExam((result.data || []).filter((row: any) =>
            row.exams?.show_results === true && row.exams.organization_id === school && memberIds.has(row.user_id)));
        const groups = new Map<string, any[]>();
        for (const row of rows) {
            const group = groups.get(row.user_id) || []; group.push(row); groups.set(row.user_id, group);
        }
        const averages = [...groups.entries()].filter(([, group]) =>
            group.length === examIds.length && group.every(row => analyticsScore(row) !== null))
            .map(([id, group]) => ({ id, average: mean(group.map(row => analyticsScore(row)!)) }));
        // Use the same own rows even if a concurrent submission changed the peer query.
        const ownAverage = mean(attempts.map(row => analyticsScore(row)!));
        const peers = averages.filter(row => row.id !== user.id);
        const totalStudents = peers.length + 1;
        if (!peers.length) return { rank: null, percentile: null, totalStudents, comparison: null };
        const rank = 1 + peers.filter(row => row.average > ownAverage + 1e-9).length;
        const percentile = Math.round(peers.filter(row => row.average < ownAverage - 1e-9).length / peers.length * 100);
        const peerAverage = mean(peers.map(row => row.average));
        return { rank, percentile, totalStudents, comparison: {
            studentAverage: rounded(ownAverage), classAverage: rounded(peerAverage),
            difference: rounded(ownAverage - peerAverage),
            betterThanClass: peerAverage > 0 ? rounded((ownAverage - peerAverage) / peerAverage * 100) : null,
            totalPeers: peers.length, scope: 'same-exams' as const,
        } };
    }

    async overview(user: AuthUser) {
        const { attempts, excludedAttempts } = await this.own(user);
        if (!attempts.length) return null;
        const cohort = await this.cohort(user, attempts);
        const scores = attempts.map(attempt => analyticsScore(attempt)!);
        const durations = attempts.map(analyticsDuration).filter((value): value is number => value !== null);
        const totalTime = durations.reduce((sum, value) => sum + value, 0);
        const subjects = new Map<string, { name: string; scores: number[]; types: Map<string, Stats> }>();
        for (const attempt of attempts) {
            const subject = subjectOf(attempt), group = subjects.get(subject.id) || { name: subject.name, scores: [] as number[], types: new Map<string, Stats>() };
            group.scores.push(analyticsScore(attempt)!); subjects.set(subject.id, group);
        }
        const released: any[] = [];
        for (const attempt of attempts) {
            try { await assertAnswerKeysReleased(this.db, attempt.exams); released.push(attempt); }
            catch (error) { if (!(error instanceof ForbiddenException)) throw error; }
        }
        const types = new Map<string, Stats>(), difficulties = new Map<string, Stats>();
        let analyzedExams = 0, unknownGrades = 0, answeredWithTime = 0;
        if (released.length) {
            const [snapshotResult, answerResult] = await Promise.all([
                this.db.from('cbt_exam_question_snapshots').select('exam_id, question_snapshot').in('exam_id', released.map(row => row.exams.id)),
                this.db.from('cbt_answers').select('attempt_id, question_id, is_correct, selected_option_id, essay_answer')
                    .in('attempt_id', released.map(row => row.id)),
            ]);
            if (snapshotResult.error || answerResult.error) throw new InternalServerErrorException('Analisis jawaban belum dapat dimuat.');
            const answers = new Map<string, any>((answerResult.data || []).map((row: any) => [`${row.attempt_id}:${row.question_id}`, row]));
            for (const attempt of released) {
                const snapshots = (snapshotResult.data || []).filter((row: any) => row.exam_id === attempt.exams.id);
                if (!snapshots.length) continue;
                analyzedExams++;
                const seen = new Set<string>();
                for (const row of snapshots) {
                    const question = row.question_snapshot;
                    if (!question?.id || seen.has(question.id)) continue;
                    seen.add(question.id);
                    const type = String(question.type || '').toLowerCase();
                    const answer = answers.get(`${attempt.id}:${question.id}`);
                    const answered = Boolean(answer?.selected_option_id ||
                        (typeof answer?.essay_answer === 'string' && answer.essay_answer.trim()));
                    if (answered && analyticsDuration(attempt) !== null) answeredWithTime++;
                    if (!type || SUBJECTIVE_TYPES.has(type)) continue;
                    const essay = ['essay', 'esay', 'uraian'].includes(type);
                    if (typeof answer?.is_correct !== 'boolean' && (answered || essay)) { unknownGrades++; continue; }
                    const correct = answer?.is_correct === true;
                    addStat(types, type, correct);
                    addStat(subjects.get(subjectOf(attempt).id)!.types, type, correct);
                    if (['easy', 'medium', 'hard'].includes(question.difficulty)) addStat(difficulties, question.difficulty, correct);
                }
            }
        }
        const strengthsWeaknesses: Array<{ type: 'strength' | 'weakness'; category: string; description: string; score: number; recommendation: string }> = [];
        for (const [type, stats] of types) {
            if (stats.total < 5) continue;
            const percentage = Math.round(stats.correct / stats.total * 100);
            if (percentage >= 70 || percentage < 60) strengthsWeaknesses.push({
                type: percentage >= 70 ? 'strength' : 'weakness', category: type.toUpperCase(),
                description: `${stats.correct}/${stats.total} soal benar (${percentage}%)`, score: percentage,
                recommendation: percentage >= 70 ? 'Pertahankan latihan pada tipe soal ini.' : 'Latih kembali materi dan tipe soal ini.',
            });
        }
        const history = attempts.slice().reverse().map(historyItem);
        return {
            overview: { totalExams: attempts.length, completedExams: attempts.length, averageScore: rounded(mean(scores)),
                highestScore: Math.max(...scores), lowestScore: Math.min(...scores), totalStudyTime: durations.length ? totalTime : null,
                rank: cohort.rank, totalStudents: cohort.totalStudents, percentile: cohort.percentile },
            recentAttempts: history.slice(0, 10).map(row => ({ ...row, attemptId: row.id, percentage: row.score, maxScore: 100 })),
            performanceTrend: attempts.map(row => ({ date: row.finished_at, score: analyticsScore(row)!, examTitle: row.exams.title || 'Ujian' })),
            subjectPerformance: [...subjects.entries()].map(([id, group]) => ({ subjectId: id, subjectName: group.name,
                totalExams: group.scores.length, averageScore: rounded(mean(group.scores)), highestScore: Math.max(...group.scores),
                lowestScore: Math.min(...group.scores), trend: calculateTrend(group.scores),
                questionTypeBreakdown: [...group.types.entries()].map(([type, stats]) => ({ type, ...stats, percentage: Math.round(stats.correct / stats.total * 100) })) })),
            difficultyPerformance: ['easy', 'medium', 'hard'].map(difficulty => {
                const stats = difficulties.get(difficulty) || { correct: 0, total: 0 };
                return { difficulty, totalQuestions: stats.total, correctAnswers: stats.correct,
                    percentage: stats.total ? Math.round(stats.correct / stats.total * 100) : null };
            }),
            strengthsWeaknesses,
            studyHabits: { averageTimePerExam: durations.length ? Math.round(mean(durations)) : null,
                fastestCompletion: durations.length ? Math.min(...durations) : null,
                slowestCompletion: durations.length ? Math.max(...durations) : null,
                // Speed cannot be inferred when only part of the exams has authentic question data.
                averageQuestionsPerMinute: unknownGrades === 0 && analyzedExams === attempts.length && durations.length === attempts.length && totalTime > 0
                    ? rounded(answeredWithTime / (totalTime / 60)) : null },
            dataQuality: { excludedAttempts, analyzedExams, totalExams: attempts.length, unknownGrades,
                timedExams: durations.length, comparisonScope: 'same-exams' },
            examHistory: history.slice(0, 20), comparison: cohort.comparison,
        };
    }

    async history(user: AuthUser, limit = 20) {
        const { attempts } = await this.own(user);
        const safeLimit = Number.isFinite(limit) && limit >= 1 ? Math.min(Math.floor(limit), 100) : 20;
        return attempts.slice().reverse().slice(0, safeLimit).map(historyItem);
    }

    async comparison(user: AuthUser) {
        const { attempts } = await this.own(user);
        return (await this.cohort(user, attempts)).comparison;
    }
}
