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
    totalExams: number;
    completedExams: number;
    averageScore: number;
    highestScore: number;
    lowestScore: number;
    /** Dalam detik. */
    totalStudyTime: number;
    rank: number | null;
    totalStudents: number;
    percentile: number;
}

export interface ExamAttemptSummary {
    attemptId: string;
    examId: string;
    examTitle: string;
    subjectName: string;
    score: number;
    maxScore: number;
    percentage: number;
    startedAt: string;
    finishedAt: string;
    timeSpentSeconds: number;
    status: 'submitted' | 'in_progress' | 'auto_submitted';
    rank: number;
    classAverage: number;
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
    percentage: number;
}

export interface StrengthWeakness {
    type: 'strength' | 'weakness';
    category: string;
    description: string;
    score: number;
    recommendation: string;
}

export interface StudyHabitStats {
    averageTimePerExam: number;
    fastestCompletion: number;
    slowestCompletion: number;
    consistentDaysPerWeek: number;
    mostActiveTime: string;
    averageQuestionsPerMinute: number;
}

export interface StudentAnalyticsData {
    overview: StudentAnalyticsOverview;
    recentAttempts: ExamAttemptSummary[];
    performanceTrend: PerformanceTrend[];
    subjectPerformance: SubjectPerformance[];
    difficultyPerformance: DifficultyPerformance[];
    strengthsWeaknesses: StrengthWeakness[];
    studyHabits: StudyHabitStats;
}

export interface StudentComparison {
    studentAverage: number;
    classAverage: number;
    difference: number;
    betterThanClass: number;
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
    timeSpentSeconds: number;
    status: string;
}

// ─── Pemanggilan ──────────────────────────────────────────────────────────────

export async function getStudentAnalytics(): Promise<StudentAnalyticsData | null> {
    const res = await apiGet<{ analytics: StudentAnalyticsData | null }>('/api/student-analytics');
    return res.success ? res.analytics : null;
}

export async function getStudentExamHistory(limit = 20): Promise<StudentExamHistoryItem[]> {
    const res = await apiGet<{ history: StudentExamHistoryItem[] }>(
        `/api/student-analytics/history?limit=${limit}`,
    );
    return res.success ? res.history : [];
}

export async function getStudentComparison(): Promise<StudentComparison | null> {
    const res = await apiGet<{ comparison: StudentComparison }>(
        '/api/student-analytics/comparison',
    );
    return res.success ? res.comparison : null;
}
