/**
 * Exam-related types for CBT App
 * Centralized type definitions for exam domain
 */

import type { AnswerValue } from './question';

// ─── Exam Status ────────────────────────────────────────────

export type ExamStatus = 'draft' | 'scheduled' | 'active' | 'completed' | 'archived';

// ─── Exam Settings ───────────────────────────────────────────

export interface ExamSettings {
  is_safe_mode: boolean;           // Fullscreen requirement
  show_results_immediately: boolean; // Show score after exam
  allow_review: boolean;           // Allow student to review answers
  shuffle_questions: boolean;      // Randomize question order
  shuffle_options: boolean;        // Randomize option order
  show_explanations: boolean;      // Show answer explanations
  calculator_mode: boolean;        // Enable calculator
}

export const DEFAULT_EXAM_SETTINGS: ExamSettings = {
  is_safe_mode: true,
  show_results_immediately: true,
  allow_review: false,
  shuffle_questions: false,
  shuffle_options: false,
  show_explanations: false,
  calculator_mode: false,
};

// ─── Exam ────────────────────────────────────────────────────

export interface Exam {
  id: string;
  title: string;
  description?: string;
  question_bank_id: string;
  question_bank_title?: string;
  duration_minutes: number;
  start_time?: string;
  end_time?: string;
  status: ExamStatus;
  settings: ExamSettings;
  metadata?: {
    total_questions?: number;
    total_points?: number;
    passing_score?: number;
    instructions?: string;
  };
  created_by?: string;
  created_at?: string;
  updated_at?: string;
}

// ─── Exam Attempt (Student taking exam) ─────────────────────

export type AttemptStatus = 'in_progress' | 'completed' | 'expired' | 'force_stopped';

export interface ExamAttempt {
  id: string;
  exam_id: string;
  student_id: string;
  status: AttemptStatus;
  started_at: string;
  ended_at?: string;
  remaining_seconds?: number;
  score?: number;
  max_score?: number;
  answers: ExamAttemptAnswer[];
  violations?: SecurityViolation[];
}

export interface ExamAttemptAnswer {
  question_id: string;
  selected_option_id?: string;
  essay_answer?: string;
  is_doubtful: boolean;
  answered_at?: string;
  time_spent_seconds?: number;
}

// ─── Security Violation ──────────────────────────────────────

export type ViolationType =
  | 'tab_switch'
  | 'window_blur'
  | 'exit_fullscreen'
  | 'restricted_shortcut'
  | 'copy_paste_attempt'
  | 'right_click_attempt'
  | 'screen_share_lost';

export interface SecurityViolation {
  id: string;
  attempt_id: string;
  type: ViolationType;
  timestamp: string;
  metadata?: {
    key_pressed?: string;
    url?: string;
  };
}

// ─── Exam Results ────────────────────────────────────────────

export interface ExamResult {
  attempt_id: string;
  exam_id: string;
  student_id: string;
  score: number;
  max_score: number;
  percentage: number;
  started_at: string;
  ended_at: string;
  duration_used_seconds: number;
  correct_count: number;
  wrong_count: number;
  unanswered_count: number;
}

// ─── Exam Navigation ────────────────────────────────────────

export interface ExamNavigation {
  currentIndex: number;
  totalQuestions: number;
  answers: Record<string, AnswerValue>;
  doubtfulQuestions: Set<string>;
  isFirstQuestion: boolean;
  isLastQuestion: boolean;
  progressPercentage: number;
}

// ─── Time Info ───────────────────────────────────────────────

export interface TimeInfo {
  totalSeconds: number;
  remainingSeconds: number;
  isWarning: boolean;      // < 10 minutes
  isCritical: boolean;     // < 5 minutes
  isExpired: boolean;
}

export function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

export function getTimeInfo(remainingSeconds: number): TimeInfo {
  return {
    totalSeconds: remainingSeconds,
    remainingSeconds,
    isWarning: remainingSeconds <= 600 && remainingSeconds > 300, // 10-5 min
    isCritical: remainingSeconds <= 300, // < 5 min
    isExpired: remainingSeconds <= 0,
  };
}

// ─── Exam Stats ──────────────────────────────────────────────

export interface ExamStats {
  answeredCount: number;
  totalQuestions: number;
  doubtfulCount: number;
  answeredPercentage: number;
}

export function calculateExamStats(
  answers: Record<string, AnswerValue>,
  doubtfulQuestions: Set<string>,
  totalQuestions: number
): ExamStats {
  const answeredCount = Object.keys(answers).filter(k => answers[k] != null).length;
  return {
    answeredCount,
    totalQuestions,
    doubtfulCount: doubtfulQuestions.size,
    answeredPercentage: totalQuestions > 0 ? (answeredCount / totalQuestions) * 100 : 0,
  };
}

// ─── Schedule ───────────────────────────────────────────────

export interface ExamSchedule {
  exam_id: string;
  start_time: string;
  end_time: string;
  max_attempts: number;
  allowed_students?: string[]; // student IDs, empty = all students
}

export interface StudentSchedule {
  id: string;
  exam_id: string;
  student_id: string;
  scheduled_at: string;
  status: 'upcoming' | 'active' | 'completed' | 'missed';
}