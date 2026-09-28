"use client";
import { useSearchParams } from 'next/navigation';
import React,{ Suspense,useEffect } from 'react';
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



function PreviewModalInner(props: PreviewModalProps) {
    // ══ ALL HOOKS AT THE TOP — Rules of Hooks ══
    const searchParams = useSearchParams();

    const {
        isOpen, onClose, bankInfo, setViewingQuestion,
        filteredQuestions, currentPreviewIndex, setCurrentPreviewIndex,
        matchingAnswers, setMatchingAnswers,
        doubtfulPreviews, setDoubtfulPreviews,
        setSimulatedResults, setIsSimulating, onFinish,
        studentName, studentClass,
    } = props;

    // Scroll lock
    useEffect(() => {
        if (!isOpen) return;
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
    }, [isOpen]);


    // ══ Derived values (after all hooks, before any return) ══
    const safeMatchingAnswers = matchingAnswers ?? {};
    const safeFilteredQuestions = filteredQuestions ?? [];
    const safeCurrentIndex = safeFilteredQuestions.length > 0
        ? Math.max(0, Math.min(currentPreviewIndex, safeFilteredQuestions.length - 1))
        : 0;

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
            if (next.has(qId)) next.delete(qId);
            else next.add(qId);
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
    if (!isOpen) return null;

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
