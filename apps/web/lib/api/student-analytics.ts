import { apiGet } from './client';

/**
 * Analisis performa siswa atas dirinya sendiri.
 * Menggantikan `app/actions/student-analytics.ts`.
 *
 * Tidak satu pun fungsi di sini menerima `userId`. Versi lama menerimanya dari
 * browser tanpa verifikasi apa pun, sehingga rekap nilai siswa lain — termasuk
 * peringkat, riwayat ujian dan analisis kelemahan — bisa dibaca hanya dengan
 * menukar UUID di pemanggilan.
 */

// ─── Bentuk data ──────────────────────────────────────────────────────────────
// Tetap didefinisikan di sisi frontend karena halaman analitik yang memakainya;
// NestJS merakit objek dengan nama bidang yang sama.

export interface StudentAnalyticsOverview {
    scoreType?: 'classical' | 'irt_1pl' | 'irt_2pl' | 'irt_3pl';
    scoreLabel?: string;
    totalExams: number;
    completedExams: number;
    averageScore: number;
    highestScore: number;
    lowestScore: number;
    /** Dalam detik. */
    totalStudyTime: number | null;
    rank: number | null;
    totalStudents: number;
    percentile: number | null;
}

export interface ExamAttemptSummary {
    attemptId: string;
    examId: string;
    examTitle: string;
    subjectName: string;
    score: number;
    maxScore: number | null;
    percentage: number | null;
    startedAt: string;
    finishedAt: string;
    timeSpentSeconds: number | null;
    status: 'submitted' | 'in_progress' | 'auto_submitted';
}

export interface PerformanceTrend {
    date: string;
    score: number;
    examTitle: string;
}

export interface SubjectPerformance {
    subjectId: string;
    subjectName: string;
    totalExams: number;
    averageScore: number;
    highestScore: number;
    lowestScore: number;
    trend: 'up' | 'down' | 'stable';
    questionTypeBreakdown: {
        type: string;
        correct: number;
        total: number;
        percentage: number;
    }[];
}

export interface DifficultyPerformance {
    difficulty: 'easy' | 'medium' | 'hard';
    totalQuestions: number;
    correctAnswers: number;
    percentage: number | null;
}

export interface StrengthWeakness {
    type: 'strength' | 'weakness';
    category: string;
    description: string;
    score: number;
    recommendation: string;
}

export interface StudyHabitStats {
    averageTimePerExam: number | null;
    fastestCompletion: number | null;
    slowestCompletion: number | null;
    averageQuestionsPerMinute: number | null;
    /** Speed uses only exams with valid, positive working time. */
    speedMeasuredExams: number;
    speedAnsweredQuestions: number;
}

export interface StudentAnalyticsData {
    scoringModels?: { scoreType: string; scoreLabel: string; analytics: StudentAnalyticsData }[];
    overview: StudentAnalyticsOverview;
    recentAttempts: ExamAttemptSummary[];
    performanceTrend: PerformanceTrend[];
    subjectPerformance: SubjectPerformance[];
    difficultyPerformance: DifficultyPerformance[];
    strengthsWeaknesses: StrengthWeakness[];
    studyHabits: StudyHabitStats;
    dataQuality: { excludedAttempts: number; analyzedExams: number; totalExams: number; unknownGrades: number; timedExams: number; comparisonScope: string };
    examHistory: StudentExamHistoryItem[];
    comparison: StudentComparison | null;
}

export interface StudentComparison {
    studentAverage: number;
    classAverage: number;
    difference: number;
    betterThanClass: number | null;
    totalPeers: number;
    scope: 'same-exams';
}

export interface StudentExamHistoryItem {
    id: string;
    examId: string;
    examTitle: string;
    subjectName: string;
    examType: string;
    score: number;
    startedAt: string;
    finishedAt: string | null;
    durationMinutes: number;
    timeSpentSeconds: number | null;
    status: string;
}

// ─── Pemanggilan ──────────────────────────────────────────────────────────────

export async function getStudentAnalytics(): Promise<StudentAnalyticsData | null> {
    const res = await apiGet<{ analytics: StudentAnalyticsData | null }>('/api/student-analytics');
    if (!res.success) throw new Error(res.error || 'Analisis belum dapat dimuat.');
    return res.analytics;
}

export async function getStudentExamHistory(limit = 20): Promise<StudentExamHistoryItem[]> {
    const res = await apiGet<{ history: StudentExamHistoryItem[] }>(
        `/api/student-analytics/history?limit=${limit}`,
    );
    if (!res.success) throw new Error(res.error || 'Riwayat belum dapat dimuat.');
    return res.history;
}

export async function getStudentComparison(): Promise<StudentComparison | null> {
    const res = await apiGet<{ comparison: StudentComparison | null }>(
        '/api/student-analytics/comparison',
    );
    if (!res.success) throw new Error(res.error || 'Perbandingan belum dapat dimuat.');
    return res.comparison;
}
