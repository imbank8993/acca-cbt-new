"use client";
import { getErrorMessage } from '@/lib/errors';
import { InlineMath } from '@/app/components/questions/InlineMath';
import { LatexRenderer } from '@/app/components/questions/LatexRenderer';
import type { Question,QuestionOption,QuestionType } from '@/app/types/question';
import type {
ExamReview,
QuestionReview,
ReviewFilter
} from '@/app/types/review';
import {
formatDuration,
getGradeFromPercentage,
getStatusColor
} from '@/app/types/review';
import { AnswerValue,parseAnswer,parseMCQComplexAnswer } from '@/lib/answer-parser';
import { getExamReview } from '@/lib/api/exam-review';
import { attachmentLabel,safeExternalUrl } from '@/lib/safe-url';
import { getSessionUser } from '@/lib/session';
import { useMemoryState } from '@/lib/useMemoryState';
import { motion } from 'framer-motion';
import {
AlertCircle,
ArrowLeft,
Check,
CheckCircle2,
ChevronLeft,
ChevronRight,
Clock,
FileText,
Lightbulb,
Loader2,
X,
XCircle
} from 'lucide-react';
import { useParams,useRouter } from 'next/navigation';
import React,{ useCallback,useEffect,useMemo,useState } from 'react';

type QuestionMetadata = NonNullable<Question['metadata']>;

function normalizeQuestionMetadata(raw: unknown): QuestionMetadata {
    if (!raw) return {};
    if (typeof raw === 'string') {
        try {
            const parsed: unknown = JSON.parse(raw);
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
                ? parsed as QuestionMetadata
                : {};
        } catch {
            return {};
        }
    }
    return typeof raw === 'object' && !Array.isArray(raw) ? raw as QuestionMetadata : {};
}

function normalizeEssayAnswer(value: unknown) {
    let parsed: unknown = value;
    if (typeof value === 'string') {
        try { parsed = JSON.parse(value); } catch { return { text: value, files: [] as string[], videoUrl: '' }; }
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { text: '', files: [] as string[], videoUrl: '' };
    }
    const payload = parsed as Record<string, unknown>;
    return {
        text: typeof payload.text === 'string' ? payload.text : '',
        files: Array.isArray(payload.fileUrls)
            ? payload.fileUrls.filter((item): item is string => typeof item === 'string')
            : [],
        videoUrl: typeof payload.videoUrl === 'string' ? payload.videoUrl : '',
    };
}

export default function ExamReviewPage() {
    const params = useParams();
    const router = useRouter();
    const attemptId = params.attemptId as string;

    const [review, setReview] = useState<ExamReview | null>(null);
    const [isLoading, setIsLoading] = useMemoryState('siswa_results_review__attemptId__isLoading', true);
    const [error, setError] = useState<string | null>(null);
    const [currentIndex, setCurrentIndex] = useState(0);
    const [filter, setFilter] = useState<ReviewFilter>('all');
    const [showAnswerKey, setShowAnswerKey] = useState(true);

    // Fetch review data
    const fetchReview = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        try {
            const user = await getSessionUser();
            if (!user) {
                setError('Silakan login terlebih dahulu.');
                setIsLoading(false);
                return;
            }
            const { review: data, error: reason } = await getExamReview(attemptId);
            if (!data) {
                setError(reason || 'Review tidak tersedia atau Anda tidak memiliki akses.');
            } else {
                setReview(data);
            }
        } catch (err) {
            setError(getErrorMessage(err) || 'Terjadi kesalahan saat memuat review.');
        }
        setIsLoading(false);
    }, [attemptId, setIsLoading]);

    useEffect(() => {
        const timer = window.setTimeout(() => void fetchReview(), 0);
        return () => window.clearTimeout(timer);
    }, [fetchReview]);

    // Filter questions
    const filteredQuestions = useMemo(() => {
        if (!review) return [];
        switch (filter) {
            case 'correct':
                return review.questions.filter(q => q.status === 'correct');
            case 'incorrect':
                return review.questions.filter(q => q.status === 'incorrect');
            case 'unanswered':
                return review.questions.filter(q => q.status === 'unanswered');
            case 'partial':
                return review.questions.filter(q => q.status === 'partial');
            default:
                return review.questions;
        }
    }, [review, filter]);

    const currentQuestion = filteredQuestions[currentIndex];

    // Navigation
    const goToQuestion = (index: number) => {
        if (index >= 0 && index < filteredQuestions.length) {
            setCurrentIndex(index);
        }
    };

    const nextQuestion = () => goToQuestion(currentIndex + 1);
    const prevQuestion = () => goToQuestion(currentIndex - 1);

    // Get filter counts
    const filterCounts = useMemo(() => {
        if (!review) return { all: 0, correct: 0, incorrect: 0, unanswered: 0, partial: 0 };
        return {
            all: review.questions.length,
            correct: review.questions.filter(q => q.status === 'correct').length,
            incorrect: review.questions.filter(q => q.status === 'incorrect').length,
            unanswered: review.questions.filter(q => q.status === 'unanswered').length,
            partial: review.questions.filter(q => q.status === 'partial').length
        };
    }, [review]);

    // Loading state
    if (isLoading) {
        return (
            <div className="min-h-screen bg-slate-50 flex items-center justify-center">
                <div className="text-center">
                    <Loader2 size={48} className="animate-spin text-primary mx-auto mb-4" />
                    <p className="text-slate-500">Memuat review ujian...</p>
                </div>
            </div>
        );
    }

    // Error state
    if (error || !review) {
        return (
            <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
                <div className="text-center max-w-md">
                    <div className="w-20 h-20 bg-red-50 rounded-2xl flex items-center justify-center mx-auto mb-6">
                        <AlertCircle size={36} className="text-red-400" />
                    </div>
                    <h2 className="text-2xl font-bold text-slate-800 mb-2">
                        {error || 'Review Tidak Tersedia'}
                    </h2>
                    <p className="text-slate-500 mb-6">
                        {error || 'Anda tidak memiliki akses untuk melihat review ini.'}
                    </p>
                    <button
                        onClick={() => router.push('/dashboard/siswa/results')}
                        className="px-6 py-3 bg-primary text-white rounded-xl font-medium hover:bg-primary/90"
                    >
                        Kembali ke Hasil
                    </button>
                </div>
            </div>
        );
    }

    const { summary } = review;
    const gradeInfo = getGradeFromPercentage(summary.percentage);

    return (
        <div className="min-h-screen bg-slate-50 flex flex-col">
            {/* Header */}
            <header className="bg-white border-b border-slate-200 sticky top-0 z-40">
                <div className="max-w-4xl mx-auto px-4 py-4">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                            <button
                                onClick={() => router.push('/dashboard/siswa/results')}
                                className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center hover:bg-slate-200 transition-colors"
                            >
                                <ArrowLeft size={18} className="text-slate-600" />
                            </button>
                            <div>
                                <h1 className="font-bold text-slate-800">{review.examTitle}</h1>
                                <p className="text-sm text-slate-500">
                                    {review.subjectName && `${review.subjectName} • `}
                                    Review Ujian
                                </p>
                            </div>
                        </div>

                        {/* Grade Badge */}
                        <div className={`px-4 py-2 rounded-xl ${gradeInfo.color.replace('text-', 'bg-')} bg-opacity-10`}>
                            <span className={`text-2xl font-black ${gradeInfo.color}`}>
                                {summary.grade}
                            </span>
                        </div>
                    </div>
                </div>
            </header>

            {/* Summary Cards */}
            <div className="bg-white border-b border-slate-200">
                <div className="max-w-4xl mx-auto px-4 py-4">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        {/* Score */}
                        <div className="bg-slate-50 rounded-xl p-4 text-center">
                            <p className="text-2xl font-black text-slate-800">{summary.percentage}%</p>
                            <p className="text-xs text-slate-500 mt-1">Nilai Akhir</p>
                        </div>

                        {/* Correct */}
                        <div className="bg-emerald-50 rounded-xl p-4 text-center">
                            <div className="flex items-center justify-center gap-1">
                                <CheckCircle2 size={18} className="text-emerald-600" />
                                <p className="text-2xl font-black text-emerald-700">{summary.correctCount}</p>
                            </div>
                            <p className="text-xs text-emerald-600 mt-1">Benar</p>
                        </div>

                        {/* Incorrect */}
                        <div className="bg-red-50 rounded-xl p-4 text-center">
                            <div className="flex items-center justify-center gap-1">
                                <XCircle size={18} className="text-red-600" />
                                <p className="text-2xl font-black text-red-700">{summary.incorrectCount}</p>
                            </div>
                            <p className="text-xs text-red-600 mt-1">Salah</p>
                        </div>

                        {/* Time */}
                        <div className="bg-blue-50 rounded-xl p-4 text-center">
                            <div className="flex items-center justify-center gap-1">
                                <Clock size={18} className="text-blue-600" />
                                <p className="text-2xl font-black text-blue-700">{formatDuration(summary.timeSpentSeconds)}</p>
                            </div>
                            <p className="text-xs text-blue-600 mt-1">Waktu</p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Filter Tabs */}
            <div className="bg-white border-b border-slate-200">
                <div className="max-w-4xl mx-auto px-4 py-3">
                    <div className="flex items-center gap-2 overflow-x-auto pb-1">
                        {[
                            { key: 'all' as ReviewFilter, label: 'Semua', count: filterCounts.all },
                            { key: 'correct' as ReviewFilter, label: 'Benar', count: filterCounts.correct, color: 'emerald' },
                            { key: 'incorrect' as ReviewFilter, label: 'Salah', count: filterCounts.incorrect, color: 'red' },
                            { key: 'partial' as ReviewFilter, label: 'Parsial', count: filterCounts.partial, color: 'amber' },
                            { key: 'unanswered' as ReviewFilter, label: 'Kosong', count: filterCounts.unanswered, color: 'slate' },
                        ].map(f => (
                            <button
                                key={f.key}
                                onClick={() => {
                                    setFilter(f.key);
                                    setCurrentIndex(0);
                                }}
                                className={`px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-colors ${
                                    filter === f.key
                                        ? f.color === 'emerald' ? 'bg-emerald-500 text-white'
                                            : f.color === 'red' ? 'bg-red-500 text-white'
                                                : f.color === 'amber' ? 'bg-amber-500 text-white'
                                                    : 'bg-slate-500 text-white'
                                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                                }`}
                            >
                                {f.label} ({f.count})
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* Question Navigation Grid */}
            <div className="bg-white border-b border-slate-200">
                <div className="max-w-4xl mx-auto px-4 py-3">
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-sm text-slate-500">
                            Soal {currentIndex + 1} dari {filteredQuestions.length}
                        </span>
                        <label className="flex items-center gap-2 text-sm text-slate-600">
                            <input
                                type="checkbox"
                                checked={showAnswerKey}
                                onChange={(e) => setShowAnswerKey(e.target.checked)}
                                className="w-4 h-4 rounded border-slate-300"
                            />
                            Tampilkan kunci jawaban
                        </label>
                    </div>
                    <div className="grid grid-cols-8 sm:grid-cols-10 md:grid-cols-12 gap-2">
                        {filteredQuestions.map((q, idx) => {
                            const statusColors = getStatusColor(q.status);
                            const isActive = idx === currentIndex;
                            return (
                                <button
                                    key={q.id}
                                    onClick={() => goToQuestion(idx)}
                                    className={`aspect-square rounded-lg font-bold text-xs flex items-center justify-center transition-all ${
                                        isActive ? 'ring-2 ring-primary ring-offset-2' : ''
                                    } ${statusColors.bg} ${statusColors.text}`}
                                >
                                    {q.questionNumber}
                                </button>
                            );
                        })}
                    </div>
                </div>
            </div>

            {/* Question Content */}
            <main className="flex-1 pb-24">
                <div className="max-w-4xl mx-auto px-4 py-6">
                    {filteredQuestions.length === 0 ? (
                        <div className="text-center py-12">
                            <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                                <AlertCircle size={32} className="text-slate-400" />
                            </div>
                            <h3 className="text-lg font-semibold text-slate-700 mb-2">
                                Tidak ada soal
                            </h3>
                            <p className="text-slate-500">
                                Tidak ada soal yang sesuai dengan filter yang dipilih.
                            </p>
                        </div>
                    ) : currentQuestion && (
                        <QuestionReviewCard
                            question={currentQuestion}
                            showAnswerKey={showAnswerKey}
                        />
                    )}
                </div>
            </main>

            {/* Bottom Navigation */}
            <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 z-40">
                <div className="max-w-4xl mx-auto px-4 py-3">
                    <div className="flex items-center justify-between">
                        <button
                            onClick={prevQuestion}
                            disabled={currentIndex === 0}
                            className="px-6 py-3 rounded-xl font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-2 transition-colors"
                        >
                            <ChevronLeft size={18} />
                            Sebelumnya
                        </button>

                        <div className="text-center">
                            <span className="text-lg font-bold text-slate-800">
                                {currentIndex + 1}
                                <span className="text-slate-400"> / {filteredQuestions.length}</span>
                            </span>
                        </div>

                        <button
                            onClick={nextQuestion}
                            disabled={currentIndex === filteredQuestions.length - 1}
                            className="px-6 py-3 rounded-xl font-semibold text-white bg-primary hover:bg-primary/90 disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-2 transition-colors"
                        >
                            Selanjutnya
                            <ChevronRight size={18} />
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

// ─── Question Review Card Component ──────────────────────────────────────────

function QuestionReviewCard({
    question,
    showAnswerKey
}: {
    question: QuestionReview;
    showAnswerKey: boolean;
}) {
    const statusColors = getStatusColor(question.status);

    // Convert QuestionReview to Question format for rendering
    const questionData: Question = {
        id: question.questionId,
        question_text: question.questionText,
        type: question.questionType,
        score_default: question.scoreDefault,
        metadata: question.metadata,
        bank_question_options: question.options.map(opt => ({
            id: opt.id,
            option_text: opt.text,
            is_correct: opt.isCorrect,
            text: opt.text,
            metadata: {},
            weight: 1
        }))
    };

    // Determine the answer based on question type
    const getAnswer = (): AnswerValue => {
        if (question.questionType === 'mcq' || question.questionType === 'mcq_complex') {
            if (question.questionType === 'mcq_complex') {
                const selectedIds = question.options.filter(o => o.isSelected).map(o => o.id);
                return JSON.stringify(selectedIds);
            }
            return question.selectedOptionId || ('' as AnswerValue);
        }
        if (question.questionType === 'true_false') {
            return question.selectedOptionId ? JSON.stringify({ [question.selectedOptionId]: 'benar' }) : ('' as AnswerValue);
        }
        if (question.questionType === 'short_answer') {
            return question.essayAnswer ? question.essayAnswer : ('' as AnswerValue);
        }
        if (question.questionType === 'matching') {
            return question.selectedOptionId || ('' as AnswerValue);
        }
        return question.essayAnswer ? question.essayAnswer : ('' as AnswerValue);
    };

    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden"
        >
            {/* Header */}
            <div className="px-6 py-4 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <span className={`w-10 h-10 rounded-xl ${statusColors.bg} ${statusColors.text} flex items-center justify-center font-black text-lg`}>
                        {statusColors.icon}
                    </span>
                    <div>
                        <p className="font-semibold text-slate-800">Soal {question.questionNumber}</p>
                        <p className="text-xs text-slate-500">
                            {question.scoreObtained} / {question.scoreDefault} poin
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    <span className={`px-3 py-1.5 rounded-full text-sm font-medium ${statusColors.bg} ${statusColors.text}`}>
                        {question.status === 'correct' ? 'Benar' :
                         question.status === 'incorrect' ? 'Salah' :
                         question.status === 'partial' ? 'Parsial' : 'Kosong'}
                    </span>
                    <span className="text-xs text-slate-400 font-medium px-2 py-1 bg-slate-100 rounded-lg">
                        {getQuestionTypeLabel(question.questionType)}
                    </span>
                </div>
            </div>

            {/* Question Content - Using QuestionRenderer with feedback */}
            <div className="p-6">
                <QuestionContentRenderer
                    question={questionData}
                    answer={getAnswer()}
                    showFeedback={showAnswerKey}
                    questionNumber={question.questionNumber}
                />
            </div>

            {/* Additional answer display for essay/short_answer */}
            {(question.questionType === 'essay' || question.questionType === 'short_answer' || question.questionType === 'uraian') && (
                <div className="px-6 py-4 bg-slate-50 border-t border-slate-100">
                    <div className="flex items-center gap-2 mb-3">
                        <FileText size={16} className="text-slate-500" />
                        <p className="text-xs font-semibold text-slate-500 uppercase">Jawaban Anda:</p>
                    </div>
                    {(() => {
                        const { text, files, videoUrl } = normalizeEssayAnswer(question.essayAnswer || '');

                        if (!text && files.length === 0 && !videoUrl) {
                            return <p className="text-sm text-slate-400 italic">Tidak ada jawaban</p>;
                        }

                        return (
                            <div className="bg-white rounded-xl p-4 border border-slate-200 space-y-4">
                                {text && (
                                    <div className="prose prose-sm max-w-none">
                                        <p className="text-sm text-slate-700 whitespace-pre-wrap">{text}</p>
                                    </div>
                                )}
                                {(files.length > 0 || videoUrl) && (
                                    <div className="pt-4 border-t border-slate-100 space-y-3">
                                        {files.length > 0 && (
                                            <div>
                                                <p className="text-xs font-bold text-slate-500 mb-2">Lampiran File:</p>
                                                <div className="flex flex-col gap-2">
                                                    {files.map((url, i) => (
                                                        <a key={i} href={safeExternalUrl(url) || undefined} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-600 hover:underline flex items-center gap-1">
                                                            📄 {attachmentLabel(url, i)}
                                                        </a>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                        {videoUrl && (
                                            <div>
                                                <p className="text-xs font-bold text-slate-500 mb-2">Tautan Video:</p>
                                                <a href={safeExternalUrl(videoUrl) || undefined} target="_blank" rel="noopener noreferrer" className="text-sm text-red-600 hover:underline">
                                                    🎥 {videoUrl}
                                                </a>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        );
                    })()}
                    {question.scoreObtained > 0 && question.scoreObtained < question.scoreDefault && (
                        <div className="mt-3 px-3 py-2 bg-amber-50 border border-amber-100 rounded-lg text-xs text-amber-700">
                            Poin diperoleh: {question.scoreObtained}/{question.scoreDefault}
                        </div>
                    )}
                </div>
            )}

            {/* Explanation - Enhanced with better styling */}
            {showAnswerKey && question.metadata?.explanation && (
                <div className="px-6 py-5 bg-gradient-to-r from-amber-50 to-pink-50 border-t border-amber-100">
                    <div className="flex items-start gap-4">
                        <div className="w-10 h-10 shrink-0 rounded-xl bg-amber-100 flex items-center justify-center">
                            <Lightbulb size={20} className="text-amber-600" />
                        </div>
                        <div className="flex-1">
                            <p className="text-xs font-bold text-amber-700 uppercase tracking-wider mb-2">Pembahasan</p>
                            <div className="prose prose-sm prose-amber max-w-none">
                                <p className="text-sm text-amber-900 leading-relaxed whitespace-pre-wrap">{question.metadata.explanation}</p>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Topics/Difficulty tags */}
            {(question.metadata?.topic || question.metadata?.difficulty) && (
                <div className="px-6 py-3 bg-slate-50 border-t border-slate-100 flex items-center gap-2 flex-wrap">
                    {question.metadata?.topic && (
                        <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-blue-50 text-blue-600 text-xs font-medium">
                            {question.metadata.topic}
                        </span>
                    )}
                    {question.metadata?.difficulty && (
                        <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${
                            question.metadata.difficulty === 'easy' ? 'bg-emerald-50 text-emerald-600' :
                            question.metadata.difficulty === 'hard' ? 'bg-red-50 text-red-600' :
                            'bg-amber-50 text-amber-600'
                        }`}>
                            {question.metadata.difficulty === 'easy' ? 'Mudah' :
                             question.metadata.difficulty === 'hard' ? 'Sulit' : 'Sedang'}
                        </span>
                    )}
                </div>
            )}
        </motion.div>
    );
}

// ─── Question Content Renderer (supports LaTeX) ─────────────────────────────

const QuestionContentRenderer = React.memo(({
    question,
    answer,
    showFeedback,
    questionNumber
}: {
    question: Question;
    answer: AnswerValue;
    showFeedback: boolean;
    questionNumber: number;
}) => {
    const metadata = normalizeQuestionMetadata(question.metadata);

    // parseAnswer imported from lib/answer-parser.ts (at top of file)

    return (
        <div className="w-full space-y-6">
            {/* QUESTION TEXT */}
            <div className="flex items-start gap-4">
                {questionNumber !== undefined && (
                    <div className="shrink-0 w-9 h-9 rounded-xl bg-slate-800 flex items-center justify-center text-sm font-black text-white">
                        {questionNumber}
                    </div>
                )}
                <div className="flex-1 min-w-0">
                    <LatexRenderer
                        text={question.question_text || ''}
                        className="text-base leading-relaxed text-slate-800"
                    />
                </div>
            </div>

            {/* OPTIONS for MCQ, TRUE_FALSE, MCQ_COMPLEX */}
            {(question.type === 'mcq' || question.type === 'true_false' || question.type === 'mcq_complex') && (
                <div className="space-y-3">
                    {question.bank_question_options?.filter((opt) => (opt.option_text || opt.text || '').trim().length > 0).map((opt, idx) => {
                        const letters = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
                        const label = letters[idx] || '?';
                        const isCorrect = opt.is_correct || opt.isCorrect;

                        // Bentuk jawaban berbeda per tipe. Sebelumnya SEMUA tipe
                        // dibandingkan sebagai id tunggal, sehingga pilihan PGK
                        // (array id) dan benar/salah (objek id→jawaban) tidak
                        // pernah terdeteksi: siswa hanya melihat kunci dan tidak
                        // pernah melihat jawabannya sendiri.
                        let isSelected = false;
                        let tfChoice: string | null = null;
                        if (question.type === 'mcq_complex') {
                            isSelected = parseMCQComplexAnswer(answer).includes(opt.id);
                        } else if (question.type === 'true_false') {
                            tfChoice = parseAnswer<Record<string, string>>(answer, {})?.[opt.id] ?? null;
                        } else {
                            isSelected = opt.id === parseAnswer(answer, null);
                        }

                        const hasStudentMark = question.type === 'true_false' ? tfChoice !== null : isSelected;
                        const markIsRight = question.type === 'true_false'
                            ? (tfChoice === 'benar') === !!isCorrect
                            : !!isCorrect;
                        // Benar/salah selalu punya kunci untuk tiap pernyataan;
                        // PG & PGK hanya opsi yang memang kunci.
                        const isKey = question.type === 'true_false' ? true : !!isCorrect;

                        let optionClass = 'bg-white border-slate-200';
                        let labelClass = 'bg-slate-50 text-slate-400 border-slate-100';
                        let textClass = 'text-slate-700';
                        let checkBg = 'bg-white border-slate-200';
                        let iconElement: React.ReactNode = null;

                        if (showFeedback) {
                            if (hasStudentMark && markIsRight) {
                                optionClass = 'bg-emerald-50 border-emerald-300';
                                labelClass = 'bg-emerald-500 text-white border-emerald-500';
                                textClass = 'text-emerald-900';
                                checkBg = 'bg-emerald-500 border-emerald-500 text-white';
                                iconElement = <Check size={14} strokeWidth={3} />;
                            } else if (hasStudentMark) {
                                optionClass = 'bg-red-50 border-red-300';
                                labelClass = 'bg-red-500 text-white border-red-500';
                                textClass = 'text-red-900';
                                checkBg = 'bg-red-500 border-red-500 text-white';
                                iconElement = <X size={14} strokeWidth={3} />;
                            } else if (isKey) {
                                // Kunci yang TERLEWAT — tidak diberi tanda centang
                                // supaya tidak tertukar dengan jawaban siswa.
                                optionClass = 'bg-white border-emerald-300 border-dashed';
                                labelClass = 'bg-white text-emerald-600 border-emerald-300';
                                textClass = 'text-emerald-800';
                            } else {
                                textClass = 'text-slate-400';
                            }
                        } else if (hasStudentMark) {
                            optionClass = 'bg-slate-50 border-slate-800';
                            labelClass = 'bg-slate-800 text-white border-slate-800';
                            textClass = 'text-slate-800';
                            checkBg = 'bg-slate-800 border-slate-800 text-white';
                            iconElement = <Check size={14} strokeWidth={3} />;
                        }

                        return (
                            <div key={opt.id} className={`p-4 rounded-xl border-2 flex items-start gap-4 transition-all ${optionClass}`}>
                                <div className={`w-8 h-8 shrink-0 rounded-lg flex items-center justify-center font-black text-sm border-2 ${labelClass}`}>
                                    {label}
                                </div>
                                <div className={`flex-1 min-w-0 text-sm font-normal ${textClass}`}>
                                    <LatexRenderer text={opt.option_text || opt.text || ''} />
                                </div>
                                {showFeedback && (
                                    <div className="shrink-0 flex flex-col items-end gap-1">
                                        {hasStudentMark && (
                                            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-slate-800 text-white">
                                                {question.type === 'true_false' ? `Jawab: ${tfChoice}` : 'Dipilih'}
                                            </span>
                                        )}
                                        {isKey && (
                                            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-emerald-100 text-emerald-700">
                                                {question.type === 'true_false' ? `Kunci: ${isCorrect ? 'benar' : 'salah'}` : 'Kunci'}
                                            </span>
                                        )}
                                    </div>
                                )}
                                {hasStudentMark && (
                                    <div className={`w-7 h-7 shrink-0 rounded-lg border-2 flex items-center justify-center ${checkBg} text-white`}>
                                        {iconElement}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            {/* MATCHING type */}
            {question.type === 'matching' && (
                <MatchingReview
                    options={question.bank_question_options || []}
                    answer={parseAnswer<Record<string, string[]>>(answer, {})}
                    metadata={metadata}
                    showFeedback={showFeedback}
                />
            )}

            {/* CATEGORIZATION type */}
            {question.type === 'categorization' && (
                <CategorizationReview
                    options={question.bank_question_options || []}
                    answer={parseAnswer<Record<string, string[]>>(answer, {})}
                    metadata={metadata}
                    showFeedback={showFeedback}
                />
            )}

            {/* SHORT ANSWER type */}
            {question.type === 'short_answer' && (
                <ShortAnswerReview
                    options={question.bank_question_options || []}
                    answer={parseAnswer<string[]>(answer, [])}
                    metadata={metadata}
                    showFeedback={showFeedback}
                />
            )}
        </div>
    );
});

QuestionContentRenderer.displayName = 'QuestionContentRenderer';

// ─── Matching Review Component ───────────────────────────────────────────────

function MatchingReview({
    options,
    answer,
    metadata,
    showFeedback
}: {
    options: QuestionOption[];
    answer: Record<string, string[]>;
    metadata: QuestionMetadata;
    showFeedback: boolean;
}) {
    const rightItems: string[] = metadata?.right_items?.length
        ? metadata.right_items
        : options.flatMap((o: QuestionOption) => o?.metadata?.match_texts || (o?.metadata?.match_text ? [o.metadata.match_text] : []));

    const uniqueRightItems = Array.from(new Set(rightItems.map((s) => (String(s) || '').trim()))).filter((s) => s.length > 0);

    return (
        <div className="overflow-x-auto">
            <table className="w-full table-fixed rounded-xl border border-slate-100">
                <thead>
                    <tr className="bg-slate-50">
                        <th className="w-[40%] min-w-[150px] p-3 text-left text-xs font-semibold text-slate-500 uppercase">Pernyataan</th>
                        <th className="w-[60%] p-3 text-left text-xs font-semibold text-slate-500 uppercase">Jawaban</th>
                    </tr>
                </thead>
                <tbody>
                    {options.filter((opt) => (opt.option_text || opt.text || '').trim().length > 0).map((opt, idx) => {
                        const studentAnswers = answer[opt.id] || [];
                        const correctMatch = opt.metadata?.match_text || opt.metadata?.match_texts?.[0] || '';

                        return (
                            <tr key={opt.id} className="border-t border-slate-100">
                                <td className="p-3">
                                    <div className="flex items-center gap-3">
                                        <span className="w-6 h-6 shrink-0 rounded-full bg-slate-200 flex items-center justify-center text-slate-600 font-bold text-xs">
                                            {idx + 1}
                                        </span>
                                        <span className="text-sm text-slate-700">
                                            <LatexRenderer text={opt.option_text || opt.text || ''} />
                                        </span>
                                    </div>
                                </td>
                                <td className="p-3">
                                    <div className="space-y-2">
                                        {uniqueRightItems.map((item) => {
                                            const isSelected = studentAnswers.includes(item);
                                            const isCorrectAnswer = item === correctMatch;
                                            let bgClass = 'bg-white';
                                            let textClass = 'text-slate-600';
                                            let borderClass = 'border-slate-200';

                                            if (showFeedback) {
                                                if (isCorrectAnswer) {
                                                    bgClass = 'bg-emerald-50';
                                                    textClass = 'text-emerald-700';
                                                    borderClass = 'border-emerald-300';
                                                } else if (isSelected) {
                                                    bgClass = 'bg-red-50';
                                                    textClass = 'text-red-700';
                                                    borderClass = 'border-red-300';
                                                }
                                            } else if (isSelected) {
                                                bgClass = 'bg-slate-100';
                                                borderClass = 'border-slate-300';
                                            }

                                            return (
                                                <div key={item} className={`p-2 rounded-lg border text-sm ${borderClass} ${bgClass} ${textClass}`}>
                                                    <InlineMath text={item} />
                                                    {showFeedback && isCorrectAnswer && <Check size={14} className="inline ml-2 text-emerald-500" />}
                                                    {showFeedback && isSelected && !isCorrectAnswer && <X size={14} className="inline ml-2 text-red-500" />}
                                                </div>
                                            );
                                        })}
                                    </div>
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}

// ─── Categorization Review Component ────────────────────────────────────────

function CategorizationReview({
    options,
    answer,
    metadata,
    showFeedback
}: {
    options: QuestionOption[];
    answer: Record<string, string[]>;
    metadata: QuestionMetadata;
    showFeedback: boolean;
}) {
    const categories: string[] = metadata?.categories?.length
        ? metadata.categories
        : Array.from(new Set(options.flatMap((o: QuestionOption) => o?.metadata?.category_names || (o?.metadata?.category_name ? [o.metadata.category_name] : []))));

    // Handle empty categories gracefully
    if (categories.length === 0) {
        return (
            <div className="text-center py-4 text-slate-500 text-sm">
                Data kategori tidak tersedia
            </div>
        );
    }

    const COLORS = [
        { bg: 'bg-violet-100', border: 'border-violet-200', active: 'bg-violet-500', text: 'text-violet-600', activeText: 'text-white' },
        { bg: 'bg-blue-100', border: 'border-blue-200', active: 'bg-blue-500', text: 'text-blue-600', activeText: 'text-white' },
        { bg: 'bg-emerald-100', border: 'border-emerald-200', active: 'bg-emerald-500', text: 'text-emerald-600', activeText: 'text-white' },
        { bg: 'bg-amber-100', border: 'border-amber-200', active: 'bg-amber-500', text: 'text-amber-600', activeText: 'text-white' },
    ];

    // Nama kategori panjang merusak lebar kolom — pakai label singkat (K1, K2, …)
    // di header dan tampilkan keterangannya di bawah tabel (konsisten dgn QuestionRenderer).
    const LONG_CATEGORY_CHARS = 16;
    const useLegend = categories.some((c) => (c || '').length > LONG_CATEGORY_CHARS);

    return (
        <div>
        <div className="overflow-x-auto rounded-xl border border-slate-100">
            <table className="w-full table-fixed">
                <thead>
                    <tr>
                        <th className="w-[45%] min-w-[200px]"></th>
                        {categories.map((cat: string, catIdx: number) => {
                            const c = COLORS[catIdx % COLORS.length];
                            return (
                                <th key={cat} className="p-2 last:pr-4">
                                    <div title={cat} className={`rounded-lg ${c.active} text-white px-3 py-2 text-center text-[10px] font-bold uppercase tracking-wider`}>
                                        {useLegend ? `K${catIdx + 1}` : cat}
                                    </div>
                                </th>
                            );
                        })}
                    </tr>
                </thead>
                <tbody>
                    {options.filter((opt) => (opt.option_text || opt.text || '').trim().length > 0).map((opt, optIdx) => {
                        const selectedCats = answer[opt.id] || [];
                        const correctCats = opt.metadata?.category_names || (opt.metadata?.category_name ? [opt.metadata.category_name] : []);

                        return (
                            <tr key={opt.id} className="border-t border-slate-100">
                                <td className="py-3 px-3">
                                    <div className="flex items-start gap-3">
                                        <div className="w-6 h-6 shrink-0 rounded-full bg-slate-800 flex items-center justify-center text-white font-black text-[10px]">
                                            {optIdx + 1}
                                        </div>
                                        <div className="text-sm font-medium text-slate-700 min-w-0 pt-0.5">
                                            <LatexRenderer text={opt.option_text || opt.text || ''} />
                                        </div>
                                    </div>
                                </td>
                                {categories.map((cat: string, catIdx: number) => {
                                    const isChecked = selectedCats.includes(cat);
                                    const shouldBeChecked = correctCats.includes(cat);
                                    const color = COLORS[catIdx % COLORS.length];

                                    let cellStatus = 'idle';
                                    if (showFeedback) {
                                        if (isChecked && shouldBeChecked) cellStatus = 'correct';
                                        else if (isChecked && !shouldBeChecked) cellStatus = 'wrong';
                                        else if (!isChecked && shouldBeChecked) cellStatus = 'missing';
                                    } else if (isChecked) {
                                        cellStatus = 'selected';
                                    }

                                    return (
                                        <td key={cat} className="py-2 px-1.5 last:pr-4">
                                            <div className="flex items-center justify-center">
                                                <div className={`w-8 h-8 rounded-lg border-2 flex items-center justify-center text-white text-xs font-bold
                                                    ${cellStatus === 'idle' ? 'border-slate-200 bg-white' : ''}
                                                    ${cellStatus === 'selected' ? `${color.active} border-transparent shadow-sm` : ''}
                                                    ${cellStatus === 'correct' ? 'bg-emerald-500 border-transparent shadow-sm' : ''}
                                                    ${cellStatus === 'wrong' ? 'bg-red-500 border-transparent shadow-sm' : ''}
                                                    ${cellStatus === 'missing' ? `${color.bg} ${color.border} ${color.text} ring-2 ring-offset-1 ring-amber-400` : ''}
                                                `}>
                                                    {cellStatus === 'correct' && <Check size={13} strokeWidth={3} />}
                                                    {cellStatus === 'wrong' && <X size={13} strokeWidth={3} />}
                                                    {cellStatus === 'missing' && <Check size={13} strokeWidth={3} />}
                                                    {cellStatus === 'selected' && <Check size={13} strokeWidth={3} />}
                                                    {cellStatus === 'idle' && <div className="w-2 h-2 rounded-full bg-slate-300" />}
                                                </div>
                                            </div>
                                        </td>
                                    );
                                })}
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>

        {/* Keterangan label kategori (K1, K2, …) saat nama kategori panjang */}
        {useLegend && (
            <div className="mt-3 rounded-md border border-slate-100 bg-slate-50 px-3 py-2.5 space-y-1.5">
                {categories.map((cat: string, catIdx: number) => {
                    const c = COLORS[catIdx % COLORS.length];
                    return (
                        <div key={cat} className="flex items-start gap-2">
                            <span className={`shrink-0 mt-[1px] rounded ${c.active} text-white px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider`}>
                                K{catIdx + 1}
                            </span>
                            <span className="text-xs text-slate-600 leading-snug">{cat}</span>
                        </div>
                    );
                })}
            </div>
        )}
        </div>
    );
}

// ─── Short Answer Review Component ────────────────────────────────────────────

function ShortAnswerReview({
    answer,
    metadata,
    showFeedback
}: {
    options: QuestionOption[];
    answer: string[];
    metadata: QuestionMetadata;
    showFeedback: boolean;
}) {
    const blanks = metadata?.blanks?.length ? metadata.blanks : [{ variations: [] }];

    return (
        <div className="space-y-4">
            {blanks.map((blank, bIdx) => {
                const allVariations = blank.variations || [];
                const studentAnswer = answer[bIdx] || '';
                const isCorrect = allVariations.map((v: string) => v.toLowerCase()).includes(studentAnswer.toLowerCase());

                return (
                    <div key={bIdx} className="space-y-2">
                        <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider pl-1">
                            Isian #{bIdx + 1}
                        </label>
                        <input
                            type="text"
                            value={studentAnswer}
                            disabled
                            className={`w-full rounded-xl border-2 px-5 py-3 text-sm font-medium outline-none
                                ${showFeedback
                                    ? isCorrect
                                        ? 'border-emerald-400 text-emerald-600 bg-emerald-50'
                                        : 'border-red-400 text-red-600 bg-red-50'
                                    : 'border-slate-200 text-slate-700 bg-slate-50'
                                }`}
                        />
                        {showFeedback && allVariations.length > 0 && (
                            <div className={`p-3 rounded-xl ${isCorrect ? 'bg-emerald-50 border border-emerald-200' : 'bg-amber-50 border border-amber-200'}`}>
                                {isCorrect ? (
                                    <p className="text-xs text-emerald-600 font-medium flex items-center gap-2">
                                        <Check size={14} /> Jawaban benar!
                                    </p>
                                ) : (
                                    <>
                                        <p className="text-xs text-amber-600 font-medium mb-1">Kunci jawaban:</p>
                                        <div className="flex flex-wrap gap-1.5">
                                            {allVariations.map((v: string, vi: number) => (
                                                <span key={vi} className="inline-flex items-center px-2.5 py-0.5 rounded-full bg-white border border-amber-200 text-amber-700 text-xs font-medium">
                                                    {v}
                                                </span>
                                            ))}
                                        </div>
                                    </>
                                )}
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
}

// ─── Helper Functions ─────────────────────────────────────────────────────────

function getQuestionTypeLabel(t: QuestionType | string): string {
    switch (t) {
        case 'mcq': return 'Pilihan Ganda';
        case 'mcq_complex': return 'PG Kompleks';
        case 'true_false': return 'Benar/Salah';
        case 'matching': return 'Menjodohkan';
        case 'categorization': return 'Kategorisasi';
        case 'short_answer': return 'Isian Singkat';
        case 'essay': case 'esay': case 'uraian': return 'Uraian';
        default: return 'Pertanyaan';
    }
}
