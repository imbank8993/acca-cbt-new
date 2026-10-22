"use client";
import { useSearchParams } from 'next/navigation';
import React,{ Suspense,useEffect,useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import type { AnswerValue,Question } from '@/app/types';
import type { QuestionBank,QuestionRecord } from '@/lib/api/questions';
import { ExamViewer } from './ExamViewer';

interface PreviewModalProps {
    isOpen: boolean;
    onClose: () => void;
    bankInfo: QuestionBank | null;
    viewingQuestion: QuestionRecord | null;
    setViewingQuestion: (question: QuestionRecord | null) => void;
    filteredQuestions: QuestionRecord[];
    currentPreviewIndex: number;
    setCurrentPreviewIndex: (index: number) => void;
    matchingAnswers: Record<string, string>;
    setMatchingAnswers: React.Dispatch<React.SetStateAction<Record<string, string>>>;
    setQuestions: React.Dispatch<React.SetStateAction<QuestionRecord[]>>;
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



const noopSubscribe = () => () => {};

function PreviewModalInner(props: PreviewModalProps) {
    // ══ ALL HOOKS AT THE TOP — Rules of Hooks ══
    const searchParams = useSearchParams();
    const isClient = useSyncExternalStore(noopSubscribe, () => true, () => false);

    const {
        isOpen, onClose, bankInfo, viewingQuestion, setViewingQuestion,
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

    const effectiveQuestions = React.useMemo(() => {
        const list = [...safeFilteredQuestions];
        if (!viewingQuestion) return list;
        const existingIdx = list.findIndex(q => q.id === viewingQuestion.id && q.id !== 'preview');
        if (existingIdx >= 0) {
            list[existingIdx] = viewingQuestion;
        } else if (viewingQuestion.id === 'preview' || !list.some(q => q.id === viewingQuestion.id)) {
            if (currentPreviewIndex >= 0 && currentPreviewIndex < list.length) {
                list[currentPreviewIndex] = viewingQuestion;
            } else {
                list.unshift(viewingQuestion);
            }
        }
        return list;
    }, [safeFilteredQuestions, viewingQuestion, currentPreviewIndex]);

    const safeCurrentIndex = React.useMemo(() => {
        if (effectiveQuestions.length === 0) return 0;
        if (viewingQuestion) {
            const idx = effectiveQuestions.findIndex(q => q === viewingQuestion || (q.id === viewingQuestion.id && q.id !== 'preview'));
            if (idx >= 0) return idx;
        }
        return Math.max(0, Math.min(currentPreviewIndex, effectiveQuestions.length - 1));
    }, [effectiveQuestions, viewingQuestion, currentPreviewIndex]);

    const calcScore = (q: QuestionRecord, studentAnswer: string | undefined) => {
        if (!q || studentAnswer == null) return 0;
        const score = q.score_default || 1;
        const opts = q.bank_question_options || [];
        switch (q.type) {
            case 'mcq': { const option = opts.find((item) => item.is_correct); return studentAnswer === option?.id ? score : 0; }
            case 'mcq_complex': {
                const correct = new Set(opts.filter((item) => item.is_correct).map((item) => item.id));
                let parsed: unknown = [];
                try {
                    parsed = studentAnswer ? JSON.parse(studentAnswer) : [];
                } catch {
                    parsed = [];
                }
                const response = new Set<string>(Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []);
                if (correct.size !== response.size) return 0;
                for (const id of correct) { if (id && !response.has(id)) return 0; }
                return score;
            }
            case 'true_false': { const option = opts.find((item) => item.is_correct); return studentAnswer === option?.option_text ? score : 0; }
            case 'matching': case 'categorization': return score;
            case 'short_answer':
            case 'essay': return studentAnswer && studentAnswer.trim() ? score : 0;
            default: return 0;
        }
    };

    const handleFinish = () => {
        let total = 0, totalMax = 0;
        effectiveQuestions.forEach((q) => {
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
        if (idx < 0 || idx >= effectiveQuestions.length) return;
        setViewingQuestion(null);
        setCurrentPreviewIndex(idx);
        const p = new URLSearchParams(searchParams.toString());
        p.set('index', idx.toString());
        p.set('preview', 'all');
        window.history.replaceState({}, '', `${window.location.pathname}?${p.toString()}`);
    };

    const handleAnswerChange = (qId: string, answer: AnswerValue) => {
        const serialized = typeof answer === 'string' ? answer : JSON.stringify(answer ?? '');
        setMatchingAnswers(prev => ({ ...(prev ?? {}), [qId]: serialized }));
    };

    // ══ Render ══
    if (!isOpen || !isClient) return null;

    // Rendered into <body> so no transformed dashboard ancestor can offset
    // the fixed full-screen viewer (which pushed its header down).
    return createPortal(
        <ExamViewer
            mode="preview"
            questions={effectiveQuestions.map(({ options: legacyOptions, ...question }): Question => {
                const normalizedOptions = (question.bank_question_options || legacyOptions || []).map((option) => ({
                    id: option.id || '',
                    option_text: option.option_text || option.text || '',
                    text: option.text,
                    is_correct: option.is_correct ?? false,
                    isCorrect: option.isCorrect,
                    weight: option.weight ?? 1,
                    order: option.order,
                    category_names: option.category_names,
                    metadata: option.metadata,
                }));
                return {
                    ...question,
                    bank_question_options: normalizedOptions,
                    options: normalizedOptions,
                };
            })}
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
        />,
        document.body,
    );
}

export default function PreviewModal(props: PreviewModalProps) {
    return (
        <Suspense fallback={null}>
            <PreviewModalInner {...props} />
        </Suspense>
    );
}
