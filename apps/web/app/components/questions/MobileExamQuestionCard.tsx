"use client";
import React from 'react';
import { motion } from 'framer-motion';
import { Flag } from 'lucide-react';
import { QuestionRenderer } from './QuestionRenderer';
import type { Question, QuestionOption, QuestionType, AnswerValue } from '@/app/types';

interface MobileExamQuestionCardProps {
    question: Question;
    answer: AnswerValue;
    onAnswerChange: (answer: AnswerValue) => void;
    questionNumber?: number;
    showToggle?: boolean;
    onToggleDoubtful?: () => void;
    isDoubtful?: boolean;
    className?: string;
    isCompact?: boolean;
}

const TYPE_LABELS: Record<QuestionType, string> = {
    mcq: 'Pilihan Ganda',
    mcq_complex: 'PG Kompleks',
    true_false: 'Benar/Salah',
    essay: 'Uraian',
    uraian: 'Uraian',
    short_answer: 'Isian Singkat',
    matching: 'Menjodohkan',
    categorization: 'Kategori',
    sjt: 'SJT',
    ordering: 'Pengurutan',
    likert: 'Skala Likert',
    forced_choice: 'Forced-Choice',
    checklist: 'Checklist',
    ranking: 'Ranking',
    paired_comparison: 'Paired Comparison'
};

const TYPE_COLORS: Record<string, { bg: string; text: string; border: string }> = {
    mcq: { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200' },
    mcq_complex: { bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-200' },
    true_false: { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200' },
    essay: { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200' },
    uraian: { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200' },
    short_answer: { bg: 'bg-cyan-50', text: 'text-cyan-700', border: 'border-cyan-200' },
    matching: { bg: 'bg-rose-50', text: 'text-rose-700', border: 'border-rose-200' },
    categorization: { bg: 'bg-violet-50', text: 'text-violet-700', border: 'border-violet-200' },
    sjt: { bg: 'bg-indigo-50', text: 'text-indigo-700', border: 'border-indigo-200' },
    ordering: { bg: 'bg-pink-50', text: 'text-pink-700', border: 'border-pink-200' },
};

function getTypeLabel(type: QuestionType | string): string {
    return TYPE_LABELS[type as QuestionType] || type.replace(/_/g, ' ');
}

function getTypeColor(type: QuestionType | string) {
    return TYPE_COLORS[type] || { bg: 'bg-slate-50', text: 'text-slate-700', border: 'border-slate-200' };
}

export function MobileExamQuestionCard({
    question,
    answer,
    onAnswerChange,
    questionNumber,
    showToggle = true,
    onToggleDoubtful,
    isDoubtful = false,
    className = ''
}: MobileExamQuestionCardProps) {
    if (!question) return null;

    const qType = question.type;
    const qTypeLabel = getTypeLabel(qType);
    const qTypeColor = getTypeColor(qType);
    const score = question.score_default || 1;

    return (
        <div className={`space-y-4 ${className}`}>
            {/* Header */}
            {showToggle && (
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className={`px-3 py-1.5 ${qTypeColor.bg} ${qTypeColor.text} text-xs font-bold rounded-lg uppercase`}>
                            {qTypeLabel}
                        </span>
                        <span className="px-2.5 py-1 bg-slate-100 text-slate-500 text-xs font-medium rounded-lg">
                            {score} poin
                        </span>
                        {isDoubtful && (
                            <span className="px-2.5 py-1 bg-amber-100 text-amber-700 text-xs font-semibold rounded-lg flex items-center gap-1">
                                <Flag size={12} /> Ragu
                            </span>
                        )}
                    </div>
                </div>
            )}

            {/* Question and Options using QuestionRenderer */}
            <motion.div
                key="default"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="bg-white rounded-lg border border-slate-100 shadow-sm overflow-hidden"
            >
                <div className="p-5 border-b border-slate-100 bg-slate-50">
                    <div className="text-base text-slate-800 leading-relaxed font-medium">
                        <QuestionRenderer
                            question={question}
                            answer={answer}
                            onAnswerChange={() => {}}
                            showQuestion={true}
                            showOptions={false}
                            questionNumber={questionNumber}
                        />
                    </div>
                </div>
                <div className="p-5">
                    <QuestionRenderer
                        question={question}
                        answer={answer}
                        onAnswerChange={onAnswerChange}
                        showQuestion={false}
                        showOptions={true}
                    />
                </div>
            </motion.div>

            {/* Doubt Toggle Button */}
            {onToggleDoubtful && (
                <motion.button
                    layout
                    onClick={onToggleDoubtful}
                    className={`w-full py-4 rounded-lg font-semibold text-sm flex items-center justify-center gap-3 transition-all active:scale-[0.98] touch-manipulation ${
                        isDoubtful
                            ? 'bg-amber-100 text-amber-700 border-2 border-amber-300'
                            : 'bg-slate-100 border-2 border-slate-200 text-slate-500 hover:bg-slate-200'
                    }`}
                    whileTap={{ scale: 0.98 }}
                >
                    <Flag size={18} />
                    {isDoubtful ? 'Hapus Tanda Ragu' : 'Tandai Soal Ini (Ragu)'}
                </motion.button>
            )}
        </div>
    );
}
