"use client";
import React, { Suspense, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { X, ChevronLeft, ChevronRight, Eye, Flag, Check, User, Rows3, Columns2, CheckCircle2 } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { ExamViewer } from './ExamViewer';

interface PreviewModalProps {
    isOpen: boolean;
    onClose: () => void;
    bankInfo: any;
    viewingQuestion: any;
    setViewingQuestion: (q: any) => void;
    filteredQuestions: any[];
    currentPreviewIndex: number;
    setCurrentPreviewIndex: (index: number) => void;
    matchingAnswers: Record<string, string>;
    setMatchingAnswers: React.Dispatch<React.SetStateAction<Record<string, string>>>;
    setQuestions: React.Dispatch<React.SetStateAction<any[]>>;
    doubtfulPreviews?: Set<string>;
    setDoubtfulPreviews?: React.Dispatch<React.SetStateAction<Set<string>>>;
    simulatedResults?: { score: number; max: number } | null;
    setSimulatedResults?: React.Dispatch<React.SetStateAction<{ score: number; max: number } | null>>;
    isSimulating?: boolean;
    setIsSimulating?: React.Dispatch<React.SetStateAction<boolean>>;
    onFinish?: () => void;
    studentName?: string;
    studentClass?: string;
}

const TYPE_COLORS: Record<string, { bg: string; text: string; border: string }> = {
    mcq: { bg: 'bg-blue-50', text: 'text-blue-600', border: 'border-blue-200' },
    mcq_complex: { bg: 'bg-purple-50', text: 'text-purple-600', border: 'border-purple-200' },
    true_false: { bg: 'bg-amber-50', text: 'text-amber-600', border: 'border-amber-200' },
    matching: { bg: 'bg-rose-50', text: 'text-rose-600', border: 'border-rose-200' },
    categorization: { bg: 'bg-violet-50', text: 'text-violet-600', border: 'border-violet-200' },
    short_answer: { bg: 'bg-cyan-50', text: 'text-cyan-600', border: 'border-cyan-200' },
    essay: { bg: 'bg-emerald-50', text: 'text-emerald-600', border: 'border-emerald-200' },
    esay: { bg: 'bg-emerald-50', text: 'text-emerald-600', border: 'border-emerald-200' },
    uraian: { bg: 'bg-emerald-50', text: 'text-emerald-600', border: 'border-emerald-200' },
};

function getTypeStyle(type: string) {
    return TYPE_COLORS[type] || { bg: 'bg-slate-50', text: 'text-slate-600', border: 'border-slate-200' };
}

function PreviewModalInner(props: PreviewModalProps) {
    // ══ ALL HOOKS AT THE TOP — Rules of Hooks ══
    const searchParams = useSearchParams();
    const [localOpen, setLocalOpen] = useState(false);

    const {
        isOpen, onClose, bankInfo, viewingQuestion, setViewingQuestion,
        filteredQuestions, currentPreviewIndex, setCurrentPreviewIndex,
        matchingAnswers, setMatchingAnswers,
        doubtfulPreviews, setDoubtfulPreviews,
        setSimulatedResults, setIsSimulating, onFinish,
        studentName, studentClass,
    } = props;

    // Sync with isOpen
    useEffect(() => { setLocalOpen(isOpen); }, [isOpen]);

    // Scroll lock
    useEffect(() => {
        if (!localOpen) return;
        const scrollY = window.scrollY;
        document.documentElement.classList.add('scroll-locked');
        document.body.classList.add('scroll-locked');
        document.body.dataset.scrollY = String(scrollY);
        return () => {
            const sy = parseInt(document.body.dataset.scrollY || '0');
            document.body.classList.remove('scroll-locked');
            document.documentElement.classList.remove('scroll-locked');
            delete document.body.dataset.scrollY;
            window.scrollTo(0, sy);
        };
    }, [localOpen]);


    // ══ Derived values (after all hooks, before any return) ══
    const safeMatchingAnswers = matchingAnswers ?? {};
    const safeFilteredQuestions = filteredQuestions ?? [];
    const safeCurrentIndex = safeFilteredQuestions.length > 0
        ? Math.max(0, Math.min(currentPreviewIndex, safeFilteredQuestions.length - 1))
        : 0;
    const displayQ = viewingQuestion ?? (safeFilteredQuestions.length > 0 ? safeFilteredQuestions[safeCurrentIndex] : null);

    const calcScore = (q: any, studentAnswer: any) => {
        if (!q || studentAnswer == null) return 0;
        const score = q.score_default || 1;
        const opts = q.bank_question_options || [];
        switch (q.type) {
            case 'mcq': { const o = opts.find((o: any) => o.is_correct); return studentAnswer === o?.id ? score : 0; }
            case 'mcq_complex': { const c = new Set(opts.filter((o: any) => o.is_correct).map((o: any) => o.id)); const r = new Set(Array.isArray(studentAnswer) ? studentAnswer : []); if (c.size !== r.size) return 0; for (const id of c) { if (!r.has(id)) return 0; } return score; }
            case 'true_false': { const o = opts.find((o: any) => o.is_correct); return studentAnswer === o?.option_text ? score : 0; }
            case 'matching': case 'categorization': return score;
            case 'short_answer':
            case 'essay': return studentAnswer && studentAnswer.trim() ? score : 0;
            default: return 0;
        }
    };

    const handleFinish = () => {
        let total = 0, totalMax = 0;
        safeFilteredQuestions.forEach((q: any) => {
            total += calcScore(q, safeMatchingAnswers[q.id]);
            totalMax += q.score_default || 1;
        });
        setSimulatedResults?.({ score: total, max: totalMax });
        setIsSimulating?.(true);
        onFinish?.();
    };

    const handleToggleDoubtful = (qId: string) => {
        if (!setDoubtfulPreviews) return;
        setDoubtfulPreviews(prev => {
            const next = new Set(prev);
            next.has(qId) ? next.delete(qId) : next.add(qId);
            return next;
        });
    };

    const handleNavigate = (idx: number) => {
        if (idx < 0 || idx >= safeFilteredQuestions.length) return;
        setViewingQuestion(null);
        setCurrentPreviewIndex(idx);
        const p = new URLSearchParams(searchParams.toString());
        p.set('index', idx.toString());
        p.set('preview', 'all');
        window.history.replaceState({}, '', `${window.location.pathname}?${p.toString()}`);
    };

    const handleAnswerChange = (qId: string, answer: any) => {
        setMatchingAnswers(prev => ({ ...(prev ?? {}), [qId]: answer }));
    };

    // ══ Render ══
    if (!localOpen) return null;

    return (
        <ExamViewer
            mode="preview"
            questions={safeFilteredQuestions}
            answers={safeMatchingAnswers}
            doubtfulAnswers={doubtfulPreviews || new Set()}
            onAnswerChange={handleAnswerChange}
            onToggleDoubtful={handleToggleDoubtful}
            studentName={studentName || bankInfo?.title || 'Pratinjau'}
            examTitle={studentClass || bankInfo?.subject || 'Pratinjau Soal'}
            currentQIndex={safeCurrentIndex}
            onNavigate={handleNavigate}
            onPreviewClose={onClose}
            onPreviewFinish={handleFinish}
        />
    );
}

export default function PreviewModal(props: PreviewModalProps) {
    return (
        <Suspense fallback={null}>
            <PreviewModalInner {...props} />
        </Suspense>
    );
}