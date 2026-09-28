/**
 * Analytics types for CBT App
 * Centralized type definitions for analytics domain
 */

import type { QuestionType } from './question';

// ─── Score Statistics ────────────────────────────────────────

export interface ScoreStats {
  average: number;
  median: number;
  highest: number;
  lowest: number;
  total: number;
  completed: number;
}

export interface ScoreDistribution {
  range: string;       // e.g., "0-20", "21-40", etc.
  count: number;
  percentage: number;
}

// ─── Question Analytics ─────────────────────────────────────

export interface QuestionAnalytics {
  question_id: string;
  question_text: string;
  question_type: QuestionType;
  total_attempts: number;
  correct_count: number;
  wrong_count: number;
  unanswered_count: number;
  correct_percentage: number;
  average_time_seconds: number;
  difficulty: 'easy' | 'medium' | 'hard';
}

export interface QuestionDifficultyStats {
  easy: {
    count: number;
    avg_correct_percentage: number;
  };
  medium: {
    count: number;
    avg_correct_percentage: number;
  };
  hard: {
    count: number;
    avg_correct_percentage: number;
  };
}

// ─── Time Analytics ────────────────────────────────────────

export interface TimeStats {
  average_seconds: number;
  median_seconds: number;
  fastest_seconds: number;
  slowest_seconds: number;
  total_time_used_seconds: number;
}

export interface TimeDistribution {
  range: string;       // e.g., "< 1 min", "1-2 min", etc.
  count: number;
  percentage: number;
}

// ─── Student Performance ────────────────────────────────────

export interface StudentPerformance {
  student_id: string;
  student_name: string;
  student_email: string;
  total_exams: number;
  completed_exams: number;
  average_score: number;
  highest_score: number;
  lowest_score: number;
  total_time_used_seconds: number;
  rank?: number;
  /** Attempt terbaru siswa pada ujian ini — rujukan detail jawaban di analisis. */
  attempt_id?: string;
  attempt_status?: string;
}

export interface StudentRanking {
  rank: number;
  student_id: string;
  student_name: string;
  score: number;
  percentage: number;
  completion_time?: string;
}

// ─── Exam Analytics Summary ─────────────────────────────────

export interface ExamAnalyticsSummary {
  exam_id: string;
  exam_title: string;
  total_participants: number;
  completed_count: number;
  in_progress_count: number;
  not_started_count: number;
  score_stats: ScoreStats;
  time_stats: TimeStats;
  question_analytics: QuestionAnalytics[];
  difficulty_stats: QuestionDifficultyStats;
  score_distribution: ScoreDistribution[];
  time_distribution: TimeDistribution[];
}

// ─── Exam Results Detail ────────────────────────────────────

export interface ExamResultDetail {
  attempt_id: string;
  exam_id: string;
  exam_title: string;
  student_id: string;
  student_name: string;
  started_at: string;
  finished_at: string;
  total_time_seconds: number;
  score: number;
  max_score: number;
  percentage: number;
  status: 'completed' | 'in_progress' | 'expired' | 'force_stopped';
  answers: AnswerResult[];
}

export interface AnswerResult {
  question_id: string;
  question_text: string;
  question_type: QuestionType;
  is_correct: boolean | null;
  score_obtained: number;
  max_score: number;
  time_spent_seconds: number;
  user_answer: string;
  correct_answer?: string;
}

// ─── Class Performance ─────────────────────────────────────

export interface ClassPerformance {
  class_id: string;
  class_name: string;
  total_students: number;
  participated: number;
  average_score: number;
  pass_rate: number;
  rank?: number;
}

// ─── Trend Data ─────────────────────────────────────────────

export interface TrendPoint {
  date: string;
  value: number;
}

export interface ExamTrend {
  exam_id: string;
  exam_title: string;
  score_trend: TrendPoint[];
  participation_trend: TrendPoint[];
}

// ─── Export Types ──────────────────────────────────────────

export type ExportFormat = 'pdf' | 'excel' | 'csv';

export interface ExportOptions {
  format: ExportFormat;
  include_stats: boolean;
  include_students: boolean;
  include_questions: boolean;
  include_charts: boolean;
}

// ─── Dashboard Stats ────────────────────────────────────────

export interface DashboardStats {
  total_exams: number;
  active_exams: number;
  total_students: number;
  total_attempts: number;
  average_score: number;
  completion_rate: number;
}

// ─── Helper Functions ────────────────────────────────────────

export function calculatePercentage(value: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((value / total) * 100);
}

export function formatScoreDistribution(scores: number[], ranges: string[]): ScoreDistribution[] {
  const total = scores.length;
  return ranges.map(range => {
    const [min, max] = range.split('-').map(v => parseInt(v));
    const count = scores.filter(s => s >= min && s <= max).length;
    return {
      range,
      count,
      percentage: calculatePercentage(count, total),
    };
  });
}

export function getGradeFromPercentage(percentage: number): { grade: string; color: string } {
  if (percentage >= 90) return { grade: 'A', color: 'text-emerald-600' };
  if (percentage >= 80) return { grade: 'B', color: 'text-blue-600' };
  if (percentage >= 70) return { grade: 'C', color: 'text-amber-600' };
  if (percentage >= 60) return { grade: 'D', color: 'text-pink-600' };
  return { grade: 'E', color: 'text-red-600' };
}

export function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins >= 60) {
    const hours = Math.floor(mins / 60);
    const remainingMins = mins % 60;
    return `${hours}j ${remainingMins}m`;
  }
  return `${mins}m ${secs}d`;
}