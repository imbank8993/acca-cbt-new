/**
 * Exam Review types for CBT App
 * Types for exam review and answer analysis
 */

import type { Question,QuestionType } from './question';

// ─── Review Types ─────────────────────────────────────────────────────────────

export type QuestionStatus = 'correct' | 'incorrect' | 'unanswered' | 'partial';

export type ReviewFilter = 'all' | 'correct' | 'incorrect' | 'unanswered' | 'partial' | 'doubtful';

// ─── Question Review ─────────────────────────────────────────────────────────

export interface QuestionReview {
    id: string;
    questionId: string;
    questionNumber: number;
    questionText: string;
    questionType: QuestionType;
    scoreDefault: number;
    scoreObtained: number;
    status: QuestionStatus;

    // Student's answer
    selectedOptionId?: string;
    selectedOptionText?: string;
    essayAnswer?: string | Record<string, unknown>;

    // Correct answer
    correctOptionId?: string;
    correctOptionText?: string;
    correctOptions?: { id: string; text: string }[];

    // Options for MCQ types
    options: {
        id: string;
        text: string;
        isCorrect: boolean;
        isSelected: boolean;
    }[];

    // Metadata
    metadata?: Question['metadata'];

    // Time spent
    timeSpentSeconds?: number;
}

// ─── Answer Explanation ──────────────────────────────────────────────────────

export interface AnswerExplanation {
    questionId: string;
    explanation?: string;
    correctAnswer?: string;
    tips?: string;
    relatedTopic?: string;
}

// ─── Review Summary ─────────────────────────────────────────────────────────

export interface ReviewSummary {
    totalQuestions: number;
    correctCount: number;
    incorrectCount: number;
    unansweredCount: number;
    partialCount: number;
    totalScore: number;
    maxScore: number;
    percentage: number;
    grade: string;
    gradeLabel: string;
    timeSpentSeconds: number;
    averageTimePerQuestion: number;

    // Breakdown by type
    byType: {
        type: QuestionType;
        label: string;
        total: number;
        correct: number;
        percentage: number;
    }[];

    // Breakdown by difficulty
    byDifficulty: {
        difficulty: 'easy' | 'medium' | 'hard';
        total: number;
        correct: number;
        percentage: number;
    }[];

    // Performance trend
    comparedToAverage: number; // percentage difference from class average
    percentile: number;
}

// ─── Full Exam Review ─────────────────────────────────────────────────────────

export interface ExamReview {
    attemptId: string;
    examId: string;
    examTitle: string;
    subjectName?: string;
    startedAt: string;
    finishedAt: string;
    submittedAt?: string;

    // Review settings
    showCorrectAnswers: boolean;
    showExplanations: boolean;
    showTimeSpent: boolean;

    // Data
    summary: ReviewSummary;
    questions: QuestionReview[];
}

// ─── Review Navigation ────────────────────────────────────────────────────────

export interface ReviewNavigation {
    currentIndex: number;
    totalQuestions: number;
    filteredCount: number;
    currentFilter: ReviewFilter;
    canGoNext: boolean;
    canGoPrev: boolean;
}

// ─── Grade Helper ────────────────────────────────────────────────────────────

export function getGradeFromPercentage(percentage: number): { grade: string; label: string; color: string } {
    if (percentage >= 90) return { grade: 'A', label: 'Sangat Baik', color: 'text-emerald-600' };
    if (percentage >= 80) return { grade: 'B', label: 'Baik', color: 'text-blue-600' };
    if (percentage >= 70) return { grade: 'C', label: 'Cukup', color: 'text-amber-600' };
    if (percentage >= 60) return { grade: 'D', label: 'Kurang', color: 'text-pink-600' };
    return { grade: 'E', label: 'Sangat Kurang', color: 'text-red-600' };
}

export function getStatusColor(status: QuestionStatus): { bg: string; text: string; icon: string } {
    switch (status) {
        case 'correct':
            return { bg: 'bg-emerald-100', text: 'text-emerald-700', icon: '✓' };
        case 'incorrect':
            return { bg: 'bg-red-100', text: 'text-red-700', icon: '✗' };
        case 'partial':
            return { bg: 'bg-amber-100', text: 'text-amber-700', icon: '±' };
        case 'unanswered':
            return { bg: 'bg-slate-100', text: 'text-slate-500', icon: '○' };
    }
}

// ─── Question Type Labels ────────────────────────────────────────────────────

export const QUESTION_TYPE_LABELS_REVIEW: Record<QuestionType, string> = {
    mcq: 'Pilihan Ganda',
    mcq_complex: 'PG Kompleks',
    true_false: 'Benar/Salah',
    essay: 'Esai',
    uraian: 'Esai',
    short_answer: 'Isian Singkat',
    matching: 'Menjodohkan',
    categorization: 'Pengelompokan',
    sjt: 'SJT',
    ordering: 'Pengurutan',
    likert: 'Skala Likert',
    forced_choice: 'Forced-Choice',
    checklist: 'Checklist',
    ranking: 'Ranking',
    paired_comparison: 'Paired Comparison'
};

// ─── Format Helpers ─────────────────────────────────────────────────────────

export function formatDuration(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (mins >= 60) {
        const hours = Math.floor(mins / 60);
        const remainingMins = mins % 60;
        return `${hours}j ${remainingMins}m`;
    }
    if (mins > 0) {
        return `${mins}m ${secs}d`;
    }
    return `${secs}d`;
}

export function formatTimeSpent(startedAt: string, finishedAt?: string): string {
    if (!finishedAt) return '-';
    const start = new Date(startedAt).getTime();
    const end = new Date(finishedAt).getTime();
    const diffSeconds = Math.floor((end - start) / 1000);
    return formatDuration(diffSeconds);
}
