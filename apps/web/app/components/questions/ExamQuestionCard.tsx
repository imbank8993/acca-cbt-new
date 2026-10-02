"use client";
import type { AnswerValue,Question } from '@/app/types';
import { AnimatePresence,motion } from 'framer-motion';
import { Check } from 'lucide-react';
import { QuestionRenderer } from './QuestionRenderer';

interface ExamQuestionCardProps {
  question: Question;
  answer: AnswerValue;
  onAnswerChange: (answer: AnswerValue) => void;
  questionNumber?: number;
  showToggle?: boolean;
  onToggleDoubtful?: () => void;
  isDoubtful?: boolean;
  className?: string;
  displayMode: 'one-col' | 'two-col';
  onDisplayModeChange?: (mode: 'one-col' | 'two-col') => void;
  isUpdated?: boolean;
  examId?: string;
  userId?: string;
}

const TYPE_LABELS: Record<string, string> = {
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
};

export function ExamQuestionCard({
  question, answer, onAnswerChange, questionNumber,
  showToggle = true, isDoubtful = false,
  className = '', displayMode, isUpdated = false,
  examId, userId
}: ExamQuestionCardProps) {
  if (!question) return null;

  const qTypeLabel = TYPE_LABELS[question.type] || question.type.replace(/_/g, ' ');
  const score = question.score_default || 1;

  return (
    <div className={`${displayMode === 'one-col' ? 'max-w-[210mm] w-full mx-auto' : 'w-full'} ${className}`}>
      {/* Jenis soal + poin di atas (SATU saja) */}
      {showToggle && (
        <div className="flex items-center gap-2 mb-4">
          <span className="px-2.5 py-1 bg-primary/10 text-primary text-xs font-bold rounded-lg uppercase">
            {qTypeLabel}
          </span>
          <span className="text-xs text-slate-400">{score} poin</span>
          {isDoubtful && (
            <span className="px-2 py-0.5 bg-amber-100 text-amber-600 text-xs font-semibold rounded-full">Ragu</span>
          )}
        </div>
      )}

      {/* ── Realtime Update Warning Banner ── */}
      <AnimatePresence>
        {isUpdated && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="mb-4 bg-amber-50 border border-amber-300 rounded-xl p-3 shadow-sm flex items-start gap-3"
          >
            <span className="text-xl shrink-0">⚠️</span>
            <div>
              <p className="font-bold text-amber-800 text-sm">Soal Diperbarui</p>
              <p className="text-amber-700 text-xs mt-0.5">Soal ini baru saja diperbarui oleh guru. Silakan baca ulang sebelum menjawab.</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {displayMode === 'two-col' ? (
        <div className="flex gap-4">
          <div className="flex-1 bg-white dark:bg-[#111728] rounded-lg border border-slate-100 dark:border-slate-800 shadow-sm flex flex-col overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-50 dark:border-slate-800/80 shrink-0">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Soal</p>
            </div>
            <div className="flex-1 overflow-y-auto p-5">
              <QuestionRenderer question={question} answer={answer} onAnswerChange={() => {}}
                showQuestion={true}
                showOptions={false} questionNumber={questionNumber} examId={examId} userId={userId} />
            </div>
          </div>
          <div className="flex-1 bg-white dark:bg-[#111728] rounded-lg border border-slate-100 dark:border-slate-800 shadow-sm flex flex-col overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-50 dark:border-slate-800/80 shrink-0">
              <div className="flex items-center gap-2">
                <Check size={13} className="text-emerald-500" />
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Opsi Jawaban</p>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-5">
              <QuestionRenderer question={question} answer={answer} onAnswerChange={onAnswerChange}
                showQuestion={false}
                showOptions={true} examId={examId} userId={userId} />
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-white dark:bg-[#111728] rounded-lg border border-slate-100 dark:border-slate-800 shadow-sm overflow-hidden">
          <div className="p-5">
            <QuestionRenderer question={question} answer={answer} onAnswerChange={onAnswerChange}
              showQuestion={true}
              showOptions={true}
              questionNumber={questionNumber} examId={examId} userId={userId} />
          </div>
        </div>
      )}
    </div>
  );
}