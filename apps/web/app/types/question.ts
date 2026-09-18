/**
 * Question-related types for CBT App
 * Centralized type definitions for question domain
 */

// ─── Question Types ─────────────────────────────────────────

export type QuestionType =
  | 'mcq'           // Pilihan Ganda
  | 'mcq_complex'   // PG Kompleks (multiple correct)
  | 'true_false'    // Benar/Salah
  | 'essay'         // Esai/Uraian
  | 'uraian'        // Alias for essay
  | 'short_answer'  // Isian Singkat
  | 'matching'      // Menjodohkan
  | 'categorization' // Pengelompokan
  | 'sjt'           // Situational Judgment Test — weighted options
  | 'ordering'      // Pengurutan
  | 'likert'
  | 'forced_choice'
  | 'checklist'
  | 'ranking'
  | 'paired_comparison';

// ─── Question Option ────────────────────────────────────────

export interface QuestionOption {
  id: string;
  option_text: string;
  text?: string; // Alternative name for option_text
  is_correct: boolean;
  isCorrect?: boolean; // Alternative name for is_correct
  weight: number;
  order?: number; // For ordering questions
  category_names?: string[]; // For categorization questions
  category_name?: string; // Alternative for single category
  metadata?: {
    image_url?: string;
    explanation?: string;
    // Matching questions
    match_text?: string;
    match_texts?: string[];
    // Categorization
    category_names?: string[];
    category_name?: string;
    // Blank variations (for short_answer)
    variations?: string[];
    blanks?: { variations: string[] }[];
    // Personality dimension
    dimension_id?: string | null;
  };
}

// ─── Question Stimulus ──────────────────────────────────────

export interface QuestionStimulus {
  id: string;
  organization_id: string;
  bank_id: string;
  title?: string;
  content: string;
  created_at?: string;
}

// ─── Question ───────────────────────────────────────────────

export interface Question {
  id: string;
  type: QuestionType;
  question_text: string;
  score_default: number;
  bank_question_options: QuestionOption[];
  stimulus_id?: string | null;
  stimulus?: QuestionStimulus;
  metadata?: {
    image_url?: string;
    difficulty?: 'easy' | 'medium' | 'hard';
    explanation?: string;
    time_limit_seconds?: number;
    // Matching questions
    right_items?: string[];
    // Categorization
    categories?: string[];
    // Short answer
    blanks?: { variations: string[] }[];
    // Instructions / hints
    instructions?: string;
    // Ordering
    correct_order?: string[];
  };
  created_at?: string;
  updated_at?: string;
}

// ─── Question with Bank Info ────────────────────────────────

export interface QuestionWithBank extends Question {
  bank_id: string;
  bank_title?: string;
}

// ─── Question Navigation State ──────────────────────────────

export interface QuestionNavState {
  currentIndex: number;
  totalQuestions: number;
  answeredCount: number;
  doubtfulCount: number;
}

// ─── Type Label Mapping ──────────────────────────────────────

export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  mcq: 'Pilihan Ganda',
  mcq_complex: 'PG Kompleks',
  true_false: 'Benar/Salah',
  essay: 'Esai',
  uraian: 'Esai',
  short_answer: 'Isian Singkat',
  matching: 'Menjodohkan',
  categorization: 'Pengelompokan',
  sjt: 'SJT (Situational Judgment)',
  ordering: 'Pengurutan',
  likert: 'Skala Likert',
  forced_choice: 'Forced-Choice',
  checklist: 'Checklist',
  ranking: 'Ranking',
  paired_comparison: 'Paired Comparison'
};

export function getQuestionTypeLabel(type: QuestionType | string): string {
  return QUESTION_TYPE_LABELS[type as QuestionType] || type.replace(/_/g, ' ');
}

// ─── Type Color Mapping ─────────────────────────────────────

export const QUESTION_TYPE_COLORS: Record<QuestionType, { bg: string; text: string; border: string }> = {
  mcq: { bg: 'bg-blue-50', text: 'text-blue-600', border: 'border-blue-200' },
  mcq_complex: { bg: 'bg-purple-50', text: 'text-purple-600', border: 'border-purple-200' },
  true_false: { bg: 'bg-amber-50', text: 'text-amber-600', border: 'border-amber-200' },
  essay: { bg: 'bg-emerald-50', text: 'text-emerald-600', border: 'border-emerald-200' },
  uraian: { bg: 'bg-emerald-50', text: 'text-emerald-600', border: 'border-emerald-200' },
  short_answer: { bg: 'bg-cyan-50', text: 'text-cyan-600', border: 'border-cyan-200' },
  matching: { bg: 'bg-rose-50', text: 'text-rose-600', border: 'border-rose-200' },
  categorization: { bg: 'bg-violet-50', text: 'text-violet-600', border: 'border-violet-200' },
  sjt: { bg: 'bg-indigo-50', text: 'text-indigo-600', border: 'border-indigo-200' },
  ordering: { bg: 'bg-pink-50', text: 'text-pink-600', border: 'border-pink-200' },
  likert: { bg: 'bg-teal-50', text: 'text-teal-600', border: 'border-teal-200' },
  forced_choice: { bg: 'bg-fuchsia-50', text: 'text-fuchsia-600', border: 'border-fuchsia-200' },
  checklist: { bg: 'bg-sky-50', text: 'text-sky-600', border: 'border-sky-200' },
  ranking: { bg: 'bg-lime-50', text: 'text-lime-600', border: 'border-lime-200' },
  paired_comparison: { bg: 'bg-pink-50', text: 'text-pink-600', border: 'border-pink-200' },
};

export function getQuestionTypeColor(type: QuestionType | string) {
  return QUESTION_TYPE_COLORS[type as QuestionType] || { bg: 'bg-slate-50', text: 'text-slate-600', border: 'border-slate-200' };
}

// ─── Answer Types ────────────────────────────────────────────

export type AnswerValue = string | string[] | Record<string, any> | null | undefined;

export interface StudentAnswer {
  question_id: string;
  selected_option_id?: string;
  essay_answer?: string;
  is_doubtful: boolean;
  answered_at?: string;
}

// ─── Matching Answer (for matching/categorization questions) ─

export interface MatchingAnswer {
  [questionId: string]: string; // Maps option to answer
}

export interface CategorizationAnswer {
  [itemId: string]: string; // Maps item to category
}

// ─── Helpers ────────────────────────────────────────────────

export function isCorrectAnswer(question: Question, answer: AnswerValue): boolean {
  const options = question.bank_question_options || [];

  switch (question.type) {
    case 'mcq': {
      const correctOption = options.find(o => o.is_correct);
      return answer === correctOption?.id;
    }
    case 'mcq_complex': {
      const correctIds = new Set(options.filter(o => o.is_correct).map(o => o.id));
      const chosenIds = new Set(Array.isArray(answer) ? answer : []);
      if (correctIds.size !== chosenIds.size) return false;
      for (const id of correctIds) {
        if (!chosenIds.has(id)) return false;
      }
      return true;
    }
    case 'true_false': {
      const correctOption = options.find(o => o.is_correct);
      return answer === correctOption?.option_text;
    }
    case 'short_answer':
    case 'essay':
    case 'uraian': {
      return typeof answer === 'string' && answer.trim().length > 0;
    }
    case 'sjt': {
      const rawOptions = question.bank_question_options || [];
      const maxWeight = Math.max(...rawOptions.map((o) => o.weight ?? 0));
      const selectedOpt = rawOptions.find((o) => o.id === answer);
      return selectedOpt ? (selectedOpt.weight ?? 0) === maxWeight : false;
    }
    case 'ordering': {
      const correctOrder: string[] = question.metadata?.correct_order || [];
      if (!Array.isArray(answer) || answer.length !== correctOrder.length) return false;
      return answer.every((id, i) => id === correctOrder[i]);
    }
    default:
      return false;
  }
}

export function calculateScore(question: Question, answer: AnswerValue): number {
  if (!isCorrectAnswer(question, answer)) return 0;
  return question.score_default || 1;
}