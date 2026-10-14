"use client";
import { AnimatePresence,motion } from 'framer-motion';
import {
Check,
ChevronLeft,ChevronRight,
Clock,
Grid3X3,
Loader2,
Maximize2,
Send,
ShieldAlert,ShieldCheck,
X
} from 'lucide-react';
import React,{ useState } from 'react';
import type { Question } from '@/app/types';
import { securityViolationLabel } from '@/lib/security-violations';

interface MobileExamSummary { title: string; }

interface MobileExamLayoutProps {
    // Exam Data
    exam: MobileExamSummary;
    questions: Question[];
    currentQIndex: number;
    answers: Record<string, string>;
    doubtfulAnswers: Set<string>;
    timeLeft: number;
    attempt: unknown;
    violationCount: number;
    maxViolations?: number | null;
    showViolationModal: boolean;
    violationType: string;
    isFullScreen: boolean;
    safeMode: boolean;
    submitting: boolean;
    showConfirmModal: boolean;
    confirmText: string;

    // Callbacks
    onSetCurrentQIndex: (index: number) => void;
    onAnswerSelect: (questionId: string, answer: string) => void;
    onToggleDoubtful: (questionId: string) => void;
    onSetConfirmText: (text: string) => void;
    onSetShowConfirmModal: (show: boolean) => void;
    onSetShowViolationModal: (show: boolean) => void;
    onSetIsFullScreen: (show: boolean) => void;
    onRequestFullscreen: () => void;
    onSubmitExam: (isAuto?: boolean) => void;

    // Question Card Renderer
    renderQuestionCard: (question: Question, index: number) => React.ReactNode;
}

export default function MobileExamLayout({
    exam,
    questions,
    currentQIndex,
    answers,
    doubtfulAnswers,
    timeLeft,
    violationCount,
    maxViolations = 3,
    showViolationModal,
    violationType,
    isFullScreen,
    safeMode,
    submitting,
    showConfirmModal,
    confirmText,
    onSetCurrentQIndex,
    onSetConfirmText,
    onSetShowConfirmModal,
    onSetShowViolationModal,
    onRequestFullscreen,
    onSubmitExam,
    renderQuestionCard
}: MobileExamLayoutProps) {
    const [showNavSheet, setShowNavSheet] = useState(false);
    const [] = useState(false);

    // Stats
    const answeredCount = Object.keys(answers).filter(k => answers[k]).length;
    const doubtCount = doubtfulAnswers.size;
    const currentQ = questions[currentQIndex];
    const isLastQuestion = currentQIndex === questions.length - 1;
    const isFirstQuestion = currentQIndex === 0;
    const unansweredCount = questions.length - answeredCount;

    // Timer formatting
    const formatTime = (seconds: number) => {
        const m = Math.floor(seconds / 60);
        const s = seconds % 60;
        return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    };

    // Touch gesture for swipe navigation
    const touchStartX = React.useRef(0);
    const touchEndX = React.useRef(0);

    const handleTouchStart = (e: React.TouchEvent) => {
        touchStartX.current = e.touches[0].clientX;
    };

    const handleTouchMove = (e: React.TouchEvent) => {
        touchEndX.current = e.touches[0].clientX;
    };

    const handleTouchEnd = () => {
        const diff = touchStartX.current - touchEndX.current;
        const threshold = 80;

        if (Math.abs(diff) > threshold) {
            if (diff > 0 && !isLastQuestion) {
                // Swipe left - next question
                onSetCurrentQIndex(currentQIndex + 1);
            } else if (diff < 0 && !isFirstQuestion) {
                // Swipe right - previous question
                onSetCurrentQIndex(currentQIndex - 1);
            }
        }
    };

    // Get question status for navigator
    const getQuestionStatus = (q: Question, index: number) => {
        const isAnswered = !!answers[q.id];
        const isCurrent = currentQIndex === index;
        const isDoubtful = doubtfulAnswers.has(q.id);

        return { isAnswered, isCurrent, isDoubtful };
    };

    return (
        <div className="min-h-screen bg-slate-50 flex flex-col">
            {/* ── Fullscreen overlay ── */}
            <AnimatePresence>
                {!isFullScreen && safeMode && (
                    <motion.div
                        initial={{ opacity: 1 }} exit={{ opacity: 0 }}
                        transition={{ duration: 0.3 }}
                        className="fixed inset-0 z-[100] bg-white flex items-center justify-center p-6"
                    >
                        <div className="text-center max-w-xs">
                            <div className="w-20 h-20 bg-amber-100 rounded-lg flex items-center justify-center mx-auto mb-6">
                                <Maximize2 size={36} className="text-amber-600" />
                            </div>
                            <h2 className="text-2xl font-bold text-slate-800 mb-3">Mode Ujian Aman</h2>
                            <p className="text-slate-500 mb-8 text-base">
                                Aktifkan layar penuh untuk pengalaman ujian terbaik dan menjaga integritas.
                            </p>
                            <button
                                onClick={onRequestFullscreen}
                                className="w-full py-4 bg-primary text-white rounded-lg font-bold text-base hover:opacity-90 transition-all shadow-lg shadow-primary/30"
                            >
                                Aktifkan Layar Penuh
                            </button>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* ── Violation warning modal ── */}
<div aria-live="polite">
                {showViolationModal && <div className="flex items-center gap-2 bg-amber-50 border-b border-amber-200 px-4 py-2 text-xs text-amber-900">
                    <ShieldAlert size={16} className="shrink-0" />
                    <span className="flex-1">{securityViolationLabel(violationType)} · {violationCount}{maxViolations === null ? ' catatan' : ' dari ' + maxViolations + ' peringatan'}.</span>
                    <button type="button" onClick={() => onSetShowViolationModal(false)} aria-label="Tutup peringatan" className="p-1"><X size={16} /></button>
                </div>}
            </div>

            {/* ── Header (Mobile Optimized) ── */}
            <header className="bg-white border-b border-slate-200 px-4 py-3 shrink-0 sticky top-0 z-40 safe-area-inset-top">
                <div className="flex items-center justify-between">
                    {/* Left: Exam Info */}
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                        <div className="w-11 h-11 bg-primary rounded-lg flex items-center justify-center text-white font-black text-sm shrink-0 shadow-lg shadow-primary/20">
                            {exam.title?.[0]?.toUpperCase() || '?'}
                        </div>
                        <div className="min-w-0 flex-1">
                            <h1 className="font-bold text-slate-800 text-sm truncate">{exam.title}</h1>
                            <p className="text-xs text-slate-400">{questions.length} soal</p>
                        </div>
                    </div>

                    {/* Right: Timer + Quick Actions */}
                    <div className="flex items-center gap-2 shrink-0">
                        {/* Quick stats (answered) */}
                        <button
                            onClick={() => setShowNavSheet(true)}
                            className="flex items-center gap-1.5 px-3 py-2 bg-emerald-50 rounded-lg border border-emerald-100 touch-manipulation"
                        >
                            <Check size={14} className="text-emerald-600" />
                            <span className="text-sm font-bold text-emerald-700">{answeredCount}</span>
                        </button>

                        {/* Timer */}
                        <div className={`px-3.5 py-2 rounded-lg flex items-center gap-2 font-mono font-bold text-sm transition-all ${
                            timeLeft < 300
                                ? 'bg-red-50 text-red-600 border border-red-200 animate-pulse'
                                : timeLeft < 600
                                ? 'bg-amber-50 text-amber-600 border border-amber-200'
                                : 'bg-slate-100 text-slate-700'
                        }`}>
                            <Clock size={16} />
                            <span className="text-base">{formatTime(timeLeft)}</span>
                        </div>
                    </div>
                </div>

                {/* Progress bar */}
                <div className="mt-3">
                    <div className="flex justify-between text-xs text-slate-500 mb-1.5">
                        <span>Soal {currentQIndex + 1} dari {questions.length}</span>
                        <span className="font-bold text-primary">{Math.round(((currentQIndex + 1) / questions.length) * 100)}%</span>
                    </div>
                    <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                        <motion.div
                            className="h-full bg-primary rounded-full"
                            initial={{ width: 0 }}
                            animate={{ width: `${((currentQIndex + 1) / questions.length) * 100}%` }}
                            transition={{ duration: 0.3 }}
                        />
                    </div>
                </div>
            </header>

            {/* ── Main Content (Touch-enabled) ── */}
            <main
                className="flex-1 overflow-y-auto pb-28"
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
            >
                <div className="max-w-2xl mx-auto p-4">
                    {/* Question Card */}
                    {renderQuestionCard(currentQ, currentQIndex)}

                    {/* Navigation */}
                    <div className="flex justify-between items-center mt-6">
                        <button
                            onClick={() => onSetCurrentQIndex(Math.max(0, currentQIndex - 1))}
                            disabled={isFirstQuestion}
                            className="px-6 py-3.5 rounded-lg font-semibold text-sm text-slate-600 bg-white border-2 border-slate-200 hover:bg-slate-50 disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-2 touch-manipulation transition-all active:scale-95"
                        >
                            <ChevronLeft size={18} /> Sebelumnya
                        </button>

                        {isLastQuestion ? (
                            <button
                                onClick={() => { onSetConfirmText(''); onSetShowConfirmModal(true); }}
                                disabled={submitting}
                                className="px-6 py-3.5 rounded-lg font-bold text-sm bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-50 flex items-center gap-2 touch-manipulation transition-all active:scale-95 shadow-lg shadow-emerald-500/30"
                            >
                                {submitting ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                                Kirim
                            </button>
                        ) : (
                            <button
                                onClick={() => onSetCurrentQIndex(Math.min(questions.length - 1, currentQIndex + 1))}
                                className="px-6 py-3.5 rounded-lg font-bold text-sm text-white bg-primary hover:bg-primary/90 flex items-center gap-2 touch-manipulation transition-all active:scale-95 shadow-lg shadow-primary/30"
                            >
                                Selanjutnya <ChevronRight size={18} />
                            </button>
                        )}
                    </div>
                </div>
            </main>

            {/* ── Floating Navigation FAB ── */}
            <motion.button
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                onClick={() => setShowNavSheet(true)}
                className="fixed bottom-24 right-4 z-50 w-14 h-14 bg-white rounded-lg shadow-xl border border-slate-200 flex items-center justify-center touch-manipulation hover:bg-slate-50 active:scale-90 transition-all"
                style={{ boxShadow: '0 4px 20px rgba(0,0,0,0.15)' }}
            >
                <Grid3X3 size={22} className="text-primary" />
            </motion.button>

            {/* ── Mobile Bottom Navigation Bar ── */}
            <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 z-40 safe-area-inset-bottom">
                <div className="flex items-center justify-between px-4 py-3">
                    {/* Prev button */}
                    <button
                        onClick={() => onSetCurrentQIndex(Math.max(0, currentQIndex - 1))}
                        disabled={isFirstQuestion}
                        className="w-14 h-14 rounded-lg bg-slate-100 flex items-center justify-center disabled:opacity-30 touch-manipulation active:scale-95 transition-all"
                    >
                        <ChevronLeft size={24} className="text-slate-600" />
                    </button>

                    {/* Center: Quick status + submit */}
                    <div className="flex-1 flex flex-col items-center gap-1">
                        <span className="text-lg font-black text-slate-800">
                            {currentQIndex + 1} <span className="text-slate-400">/ {questions.length}</span>
                        </span>
                        <span className="text-xs text-slate-500">
                            {answeredCount} terjawab
                            {unansweredCount > 0 && ` · ${unansweredCount} tersisa`}
                        </span>

                        {/* Quick submit button */}
                        {unansweredCount === 0 && (
                            <button
                                onClick={() => { onSetConfirmText(''); onSetShowConfirmModal(true); }}
                                className="mt-2 px-5 py-2 bg-emerald-500 text-white rounded-lg font-bold text-sm flex items-center gap-2 touch-manipulation shadow-lg shadow-emerald-500/30"
                            >
                                <ShieldCheck size={14} /> Kirim Sekarang
                            </button>
                        )}
                    </div>

                    {/* Next button */}
                    <button
                        onClick={() => onSetCurrentQIndex(Math.min(questions.length - 1, currentQIndex + 1))}
                        disabled={isLastQuestion}
                        className="w-14 h-14 rounded-lg bg-primary flex items-center justify-center disabled:opacity-30 touch-manipulation active:scale-95 transition-all"
                    >
                        <ChevronRight size={24} className="text-white" />
                    </button>
                </div>
            </div>

            {/* ── Question Navigator Bottom Sheet ── */}
            <AnimatePresence>
                {showNavSheet && (
                    <>
                        {/* Backdrop */}
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            onClick={() => setShowNavSheet(false)}
                            className="fixed inset-0 z-[9999] bg-black/60"
                        />

                        {/* Sheet */}
                        <motion.div
                            initial={{ y: '100%' }}
                            animate={{ y: 0 }}
                            exit={{ y: '100%' }}
                            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                            className="fixed bottom-0 left-0 right-0 z-50 bg-white rounded-t-3xl shadow-2xl max-h-[85vh] flex flex-col"
                        >
                            {/* Handle */}
                            <div className="flex justify-center py-3">
                                <div className="w-10 h-1 bg-slate-300 rounded-full" />
                            </div>

                            {/* Header */}
                            <div className="px-5 pb-4 border-b border-slate-100">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <h3 className="font-bold text-slate-800 text-lg">Navigasi Soal</h3>
                                        <p className="text-sm text-slate-500">
                                            {answeredCount} dari {questions.length} terjawab
                                            {doubtCount > 0 && ` · ${doubtCount} ragu`}
                                        </p>
                                    </div>
                                    <button
                                        onClick={() => setShowNavSheet(false)}
                                        className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center"
                                    >
                                        <X size={18} className="text-slate-500" />
                                    </button>
                                </div>
                            </div>

                            {/* Question Grid */}
                            <div className="flex-1 overflow-y-auto p-5">
                                <div className="grid grid-cols-5 gap-3">
                                    {questions.map((q, i) => {
                                        const { isAnswered, isCurrent, isDoubtful } = getQuestionStatus(q, i);

                                        let bgClass = 'bg-white text-slate-400 border border-slate-200 hover:border-slate-300 hover:text-slate-600';
                                        const ringClass = '';

                                        if (isCurrent) {
                                            bgClass = 'bg-blue-600 text-white shadow-md shadow-blue-300/30';
                                        } else if (isDoubtful) {
                                            bgClass = 'bg-pink-500 text-white';
                                        } else if (isAnswered) {
                                            bgClass = 'bg-green-500 text-white';
                                        }

                                        return (
                                            <button
                                                key={q.id}
                                                onClick={() => {
                                                    onSetCurrentQIndex(i);
                                                    setShowNavSheet(false);
                                                }}
                                                className={`aspect-square rounded-md font-black text-base flex items-center justify-center transition-all active:scale-95 touch-manipulation ${bgClass} ${ringClass}`}
                                            >
                                                {i + 1}
                                            </button>
                                        );
                                    })}
                                </div>


                            </div>

                            {/* Quick Actions */}
                            <div className="p-5 border-t border-slate-100 bg-slate-50">
                                <button
                                    onClick={() => {
                                        onSetConfirmText('');
                                        onSetShowConfirmModal(true);
                                        setShowNavSheet(false);
                                    }}
                                    disabled={submitting}
                                    className="w-full py-4 bg-emerald-500 text-white rounded-lg font-bold text-base hover:bg-emerald-600 disabled:opacity-50 flex items-center justify-center gap-3 touch-manipulation shadow-lg shadow-emerald-500/30"
                                >
                                    <ShieldCheck size={20} />
                                    Kirim & Selesaikan Ujian
                                </button>
                            </div>
                        </motion.div>
                    </>
                )}
            </AnimatePresence>

            {/* ── Submit confirmation modal ── */}
            <AnimatePresence>
                {showConfirmModal && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/60"
                    >
                        <motion.div
                            initial={{ scale: 0.9, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            className="bg-white rounded-lg p-6 max-w-sm w-full shadow-2xl"
                        >
                            <div className="text-center mb-5">
                                <div className="w-16 h-16 bg-emerald-100 rounded-lg flex items-center justify-center mx-auto mb-4">
                                    <ShieldCheck size={30} className="text-emerald-600" />
                                </div>
                                <h3 className="text-xl font-bold text-slate-800">Kirim Jawaban?</h3>

                                {/* Status */}
                                <div className="mt-4 flex justify-center gap-4 text-sm">
                                    <div className={`text-center px-4 py-2 rounded-lg ${answeredCount === questions.length ? 'bg-emerald-100' : 'bg-amber-100'}`}>
                                        <p className="text-2xl font-black">{answeredCount}</p>
                                        <p className="text-xs text-slate-500">Terjawab</p>
                                    </div>
                                    <div className={`text-center px-4 py-2 rounded-lg ${unansweredCount === 0 ? 'bg-emerald-100' : 'bg-red-100'}`}>
                                        <p className="text-2xl font-black text-red-600">{unansweredCount}</p>
                                        <p className="text-xs text-slate-500">Belum</p>
                                    </div>
                                    {doubtCount > 0 && (
                                        <div className="text-center px-4 py-2 rounded-lg bg-amber-100">
                                            <p className="text-2xl font-black text-amber-600">{doubtCount}</p>
                                            <p className="text-xs text-slate-500">Ragu</p>
                                        </div>
                                    )}
                                </div>

                                {unansweredCount > 0 && (
                                    <p className="text-xs text-amber-600 mt-3">
                                        Masih ada {unansweredCount} soal yang belum terjawab!
                                    </p>
                                )}
                            </div>

                            <div className="space-y-3">
                                <input
                                    type="text"
                                    value={confirmText}
                                    onChange={(e) => onSetConfirmText(e.target.value.toUpperCase())}
                                    placeholder="Ketik SELESAI"
                                    className="w-full p-4 border-2 border-slate-200 rounded-lg text-center font-mono text-xl tracking-widest focus:border-primary/50 focus:ring-2 focus:ring-primary/10 outline-none uppercase bg-slate-50"
                                    autoComplete="off"
                                />
                                <button
                                    onClick={() => onSubmitExam(false)}
                                    disabled={confirmText !== 'SELESAI' || submitting}
                                    className="w-full py-4 bg-emerald-500 text-white rounded-lg font-bold text-base hover:bg-emerald-600 disabled:opacity-40 flex items-center justify-center gap-3 touch-manipulation transition-all"
                                >
                                    {submitting ? <Loader2 size={18} className="animate-spin" /> : <Check size={18} />}
                                    Konfirmasi & Kirim
                                </button>
                                <button
                                    onClick={() => onSetShowConfirmModal(false)}
                                    className="w-full py-3 bg-slate-100 text-slate-600 rounded-lg font-semibold text-sm hover:bg-slate-200 transition-all"
                                >
                                    Lanjut Mengerjakan
                                </button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
