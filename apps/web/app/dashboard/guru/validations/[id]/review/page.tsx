"use client";
import { confirmDialog } from '@/lib/confirm-dialog';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
    ShieldCheck,
    ArrowLeft,
    CheckCircle2,
    AlertCircle,
    XCircle,
    MessageSquare,
    Save,
    Trash2,
    Send,
    HelpCircle,
    ChevronLeft,
    ChevronRight,
    Loader2,
    Tag,
    FileText,
    Highlighter,
} from 'lucide-react';
import { Button } from '@/app/components/ui/button';
import { Spinner } from '@/app/components/ui/Spinner';
import {
    getValidationReviewData,
    saveValidationNote,
    deleteValidationNote,
    submitValidationReview,
    type ValidationSession,
    type ValidationValidator,
    type ValidationNote,
    type NoteCategory,
    type NoteStatusItem,
} from '@/lib/api/validations';
import type { QuestionRecord } from '@/lib/api/questions';
import { QuestionContent } from '@/app/components/questions/QuestionRenderer';

type NoteScope = 'question_text' | 'stimulus' | 'option' | 'general';
const DAY_MS = 24 * 60 * 60 * 1000;

/** Sama dengan aturan server: tanggal lama 00:00 UTC berlaku sampai akhir hari. */
function isDeadlinePassed(deadline?: string | null): boolean {
    if (!deadline) return false;
    let time = new Date(deadline).getTime();
    if (!Number.isFinite(time)) return false;
    if (time % DAY_MS === 0) time += DAY_MS - 1;
    return time < Date.now();
}

/** Cari wadah ber-`data-validation-scope` terdekat dari node seleksi. */
function scopeElement(node: Node | null | undefined): HTMLElement | null {
    if (!node) return null;
    const element = node.nodeType === 1 ? node as Element : node.parentElement;
    return element?.closest<HTMLElement>('[data-validation-scope]') || null;
}

export default function ValidatorReviewPage() {
    const params = useParams();
    const router = useRouter();
    const validationId = (params?.id as string) || '';

    const [loading, setLoading] = useState(true);
    const [validation, setValidation] = useState<ValidationSession | null>(null);
    const [validatorStatus, setValidatorStatus] = useState<ValidationValidator | null>(null);
    const [questions, setQuestions] = useState<QuestionRecord[]>([]);
    const [notes, setNotes] = useState<ValidationNote[]>([]);

    const [currentIndex, setCurrentIndex] = useState(0);

    // Note form state for current question
    const [selectedText, setSelectedText] = useState('');
    const [targetScope, setTargetScope] = useState<'question_text' | 'stimulus' | 'option' | 'general'>('question_text');
    const [selectedOptionId, setSelectedOptionId] = useState<string | undefined>(undefined);
    const [commentText, setCommentText] = useState('');
    const [category, setCategory] = useState<NoteCategory>('typo');
    const [statusItem, setStatusItem] = useState<NoteStatusItem>('revision');
    const [isSavingNote, setIsSavingNote] = useState(false);
    const [actionError, setActionError] = useState<string | null>(null);
    const drafts = useRef<Record<string, {
        selectedText: string; targetScope: typeof targetScope; selectedOptionId?: string;
        commentText: string; category: NoteCategory; statusItem: NoteStatusItem;
    }>>({});
    const changeQuestion = (index: number) => {
        if (isSavingNote || index === currentIndex || !questions[index]) return;
        drafts.current[questions[currentIndex].id] = { selectedText, targetScope, selectedOptionId, commentText, category, statusItem };
        const draft = drafts.current[questions[index].id];
        setSelectedText(draft?.selectedText || '');
        setTargetScope(draft?.targetScope || 'question_text');
        setSelectedOptionId(draft?.selectedOptionId);
        setCommentText(draft?.commentText || '');
        setCategory(draft?.category || 'typo');
        setStatusItem(draft?.statusItem || 'revision');
        setActionError(null);
        window.getSelection()?.removeAllRanges();
        setCurrentIndex(index);
    };

    // Final submit modal
    const [isSubmitModalOpen, setIsSubmitModalOpen] = useState(false);
    const [generalRec, setGeneralRec] = useState<'approved' | 'revision_needed' | 'rejected'>('approved');
    const [generalComment, setGeneralComment] = useState('');
    const [isSubmittingFinal, setIsSubmittingFinal] = useState(false);
    const [submitError, setSubmitError] = useState<string | null>(null);
    const [accessError, setAccessError] = useState<string | null>(null);

    const loadData = useCallback(async () => {
        if (!validationId) return;
        setLoading(true);
        setAccessError(null);
        try {
            const res = await getValidationReviewData(validationId);
            if (res) {
                setValidation(res.validation);
                setValidatorStatus(res.myValidatorStatus);
                setQuestions(res.questions || []);
                setNotes(res.notes || []);
                if (res.myValidatorStatus?.general_recommendation) {
                    setGeneralRec(res.myValidatorStatus.general_recommendation);
                }
                if (res.myValidatorStatus?.general_comment) {
                    setGeneralComment(res.myValidatorStatus.general_comment);
                }
            } else {
                setAccessError('Data validasi tidak ditemukan atau Anda tidak memiliki akses.');
            }
        } catch (e) {
            console.error('Failed to load validation review data', e);
            setAccessError(e instanceof Error && e.message ? e.message : 'Data validasi belum dapat dimuat. Silakan coba lagi.');
        } finally {
            setLoading(false);
        }
    }, [validationId]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    const currentQuestion = questions[currentIndex] || null;

    // Filter notes for the current active question
    const currentQuestionNotes = useMemo(() => {
        if (!currentQuestion) return [];
        return notes.filter(n => n.question_id === currentQuestion.id);
    }, [notes, currentQuestion]);

    // Hanya validator yang ditugaskan dan masih dalam batas waktu yang boleh menulis.
    const myUserId = validatorStatus?.validator_id || null;
    const alreadySubmitted = validatorStatus?.status === 'submitted';
    const readOnlyReason = !validatorStatus
        ? 'Mode lihat saja: hanya validator yang ditugaskan yang dapat menambah catatan dan mengirim rekomendasi.'
        : isDeadlinePassed(validation?.deadline)
            ? 'Batas waktu validasi telah berakhir. Catatan dan rekomendasi tidak dapat diubah lagi.'
            : null;
    const canEdit = !readOnlyReason;

    // Handle text selection on question / stimulus / option: bagian yang diberi
    // catatan mengikuti lokasi teks yang diblok.
    const handleMouseUp = () => {
        if (!canEdit) return;
        const selection = window.getSelection();
        const text = selection?.toString()?.trim();
        if (!text || text.length >= 300) return;
        const anchor = scopeElement(selection?.anchorNode);
        const focus = scopeElement(selection?.focusNode);
        setSelectedText(text);
        if (!anchor || anchor !== focus) {
            // Seleksi melintasi beberapa bagian atau di luar naskah soal.
            setTargetScope('general');
            setSelectedOptionId(undefined);
            return;
        }
        const scope = (anchor.dataset.validationScope || 'general') as NoteScope;
        const optionId = scope === 'option' ? anchor.dataset.optionId : undefined;
        setTargetScope(scope === 'option' && !optionId ? 'general' : scope);
        setSelectedOptionId(optionId);
    };

    const handleSaveNote = async () => {
        if (!canEdit || !currentQuestion || !commentText.trim()) return;
        setIsSavingNote(true);
        setActionError(null);
        try {
            const res = await saveValidationNote(validationId, {
                questionId: currentQuestion.id,
                targetScope,
                targetOptionId: selectedOptionId,
                selectedText: selectedText || undefined,
                comment: commentText.trim(),
                category,
                statusItem,
            });

            if (!res.success) throw new Error(res.error || 'Gagal menyimpan catatan.');
            if (!res.id) throw new Error('Gagal menyimpan catatan.');
            if (res.success && res.id) {
                setNotes(prev => [...prev, res as unknown as ValidationNote]);
                setCommentText('');
                setSelectedText('');
                setSelectedOptionId(undefined);
                setTargetScope('question_text');
            }
        } catch (e) {
            setActionError(e instanceof Error ? e.message : 'Gagal menyimpan catatan.');
        } finally {
            setIsSavingNote(false);
        }
    };

    const handleDeleteNote = async (noteId: string) => {
        if (!await confirmDialog({ title: 'Hapus Catatan Validasi?', text: 'Catatan ini akan dihapus dari hasil pemeriksaan soal.', confirmText: 'Ya', cancelText: 'Tidak', variant: 'danger' })) return;
        setActionError(null);
        try {
            const res = await deleteValidationNote(validationId, noteId);
            if (!res.success) throw new Error(res.error || 'Gagal menghapus catatan.');
            setNotes(prev => prev.filter(n => n.id !== noteId));
        } catch (e) {
            console.error('Failed to delete note', e);
            setActionError(e instanceof Error ? e.message : 'Gagal menghapus catatan.');
        }
    };

    const handleFinalSubmit = async () => {
        if (!canEdit) return;
        setIsSubmittingFinal(true);
        setSubmitError(null);
        try {
            const res = await submitValidationReview(validationId, {
                generalRecommendation: generalRec,
                generalComment: generalComment.trim(),
            });

            if (!res.success) throw new Error(res.error || 'Gagal mengirim hasil validasi.');
            setIsSubmitModalOpen(false);
            router.push('/dashboard/guru/validations');
        } catch (e) {
            console.error('Failed to submit validation review', e);
            setSubmitError(e instanceof Error ? e.message : 'Gagal mengirim hasil validasi.');
        } finally {
            setIsSubmittingFinal(false);
        }
    };

    if (loading) {
        return (
            <div className="fixed inset-0 bg-slate-50 dark:bg-slate-950 flex flex-col items-center justify-center gap-3 z-50">
                <Spinner size={36} />
                <p className="text-xs text-slate-500 font-semibold">Menyiapkan lembar validasi soal...</p>
            </div>
        );
    }

    if (accessError || !validation || questions.length === 0) {
        return (
            <div className="p-8 text-center max-w-md mx-auto space-y-4 pt-20">
                <AlertCircle size={40} className="text-amber-500 mx-auto" />
                <h2 className="text-lg font-bold">{accessError ? 'Akses Dibatasi' : 'Data Soal Tidak Ditemukan'}</h2>
                <p className="text-xs text-slate-500">{accessError || 'Bank soal belum memiliki butir soal atau telah diarsipkan.'}</p>
                <Button onClick={() => router.push('/dashboard')}>Kembali ke Dashboard</Button>
            </div>
        );
    }

    return (
        <div className="fixed inset-0 z-50 flex flex-col bg-slate-100 dark:bg-[#020718] font-sans overflow-hidden">
            {/* Top Navigation Bar */}
            <header className="h-14 bg-white dark:bg-[#0d1221] border-b border-slate-200 dark:border-slate-800 px-4 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-3">
                    <button
                        onClick={() => router.push('/dashboard/guru/validations')}
                        className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                        title="Kembali"
                    >
                        <ArrowLeft size={18} />
                    </button>
                    <div>
                        <div className="flex items-center gap-2">
                            <span className="px-2 py-0.5 bg-primary/10 text-primary font-bold text-[10px] rounded uppercase">
                                Mode Validasi Soal
                            </span>
                            <h2 className="text-xs font-bold text-slate-800 dark:text-slate-100 truncate max-w-[200px] sm:max-w-md">
                                {validation.title}
                            </h2>
                        </div>
                        <p className="text-[10px] text-slate-400">
                            {validation.bank?.subject} • {validation.bank?.class_level}
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    {alreadySubmitted && (
                        <span className="hidden sm:inline-flex px-2 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 text-[10px] font-bold">
                            Rekomendasi sudah dikirim
                        </span>
                    )}
                    {canEdit && (
                        <Button
                            onClick={() => { setSubmitError(null); setIsSubmitModalOpen(true); }}
                            className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs flex items-center gap-1.5 shadow-sm"
                        >
                            <CheckCircle2 size={15} /> {alreadySubmitted ? 'Perbarui Hasil Validasi' : 'Selesaikan Validasi'}
                        </Button>
                    )}
                </div>
            </header>

            {/* Main Area: Split Screen (Left: Soal Simulation, Right: Panel Catatan Validator) */}
            <div className="flex-1 flex flex-col lg:flex-row min-h-0 overflow-hidden">
                {/* Left Area: Lembar Soal (Read-Only) */}
                <main
                    className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8 space-y-6"
                    onMouseUp={handleMouseUp}
                >
                    {currentQuestion && (
                        <div className="max-w-3xl mx-auto bg-white dark:bg-[#0d1221] rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm p-6 md:p-8 space-y-6">
                            {/* Header Soal */}
                            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                                <div className="flex items-center gap-2">
                                    <span className="w-8 h-8 rounded-xl bg-primary text-white font-bold flex items-center justify-center text-sm shadow-sm">
                                        {currentIndex + 1}
                                    </span>
                                    <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                                        Tipe: {currentQuestion.type}
                                    </span>
                                </div>
                                <span className="text-xs font-semibold text-slate-400">
                                    Bobot: {currentQuestion.score_default || 1} Poin
                                </span>
                            </div>

                            {/* Stimulus jika ada */}
                            {currentQuestion.stimulus?.content && (
                                <div data-validation-scope="stimulus" className="p-4 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200/60 dark:border-slate-800 space-y-2">
                                    <div className="flex items-center gap-1.5 text-xs font-bold text-slate-500 uppercase tracking-wider">
                                        <FileText size={14} /> Stimulus / Teks Bacaan
                                    </div>
                                    <div className="text-sm prose dark:prose-invert max-w-none">
                                        <QuestionContent content={currentQuestion.stimulus.content} />
                                    </div>
                                </div>
                            )}

                            {/* Kalimat Soal */}
                            <div className="space-y-2" data-validation-scope="question_text">
                                <div className="text-sm font-medium text-slate-800 dark:text-slate-100 leading-relaxed prose dark:prose-invert max-w-none select-text">
                                    <QuestionContent content={currentQuestion.question_text || ''} />
                                </div>
                            </div>

                            {/* Opsi Pilihan Jawaban */}
                            {currentQuestion.bank_question_options && currentQuestion.bank_question_options.length > 0 && (
                                <div className="space-y-2.5 pt-2">
                                    <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                                        Opsi Jawaban (Kunci Jawaban Ditandai Hijau):
                                    </p>
                                    <div className="space-y-2">
                                        {currentQuestion.bank_question_options.map((opt, oIdx) => {
                                            const letter = String.fromCharCode(65 + oIdx);
                                            const isCorrect = opt.is_correct ?? opt.isCorrect;

                                            return (
                                                <div
                                                    key={opt.id || oIdx}
                                                    data-validation-scope="option"
                                                    data-option-id={opt.id || undefined}
                                                    onClick={() => {
                                                        if (canEdit && opt.id) {
                                                            setSelectedOptionId(opt.id);
                                                            setTargetScope('option');
                                                        }
                                                    }}
                                                    className={`p-3.5 rounded-xl border flex items-start gap-3 transition-colors select-text ${
                                                        isCorrect
                                                            ? 'bg-emerald-50/70 dark:bg-emerald-950/30 border-emerald-300 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200 font-semibold'
                                                            : 'bg-white dark:bg-[#111728] border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300'
                                                    }`}
                                                >
                                                    <span
                                                        className={`w-6 h-6 rounded-lg text-xs font-bold flex items-center justify-center shrink-0 ${
                                                            isCorrect
                                                                ? 'bg-emerald-600 text-white'
                                                                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                                                        }`}
                                                    >
                                                        {letter}
                                                    </span>
                                                    <div className="flex-1 text-xs leading-relaxed">
                                                        <QuestionContent content={opt.option_text || opt.text || ''} />
                                                    </div>
                                                    {isCorrect && (
                                                        <span className="sr-only">Kunci jawaban</span>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}

                            {/* Petunjuk Seleksi Teks */}
                            {canEdit && (
                            <div className="p-3 bg-amber-50/60 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/40 rounded-xl text-xs text-amber-800 dark:text-amber-300 flex items-center gap-2">
                                <Highlighter size={16} className="text-amber-600 shrink-0" />
                                <span>
                                    <strong>Tips Validator:</strong> Anda dapat mem-blok teks di stimulus, soal, atau opsi untuk otomatis menjadikannya kutipan catatan di panel samping.
                                </span>
                            </div>
                            )}
                        </div>
                    )}
                </main>

                {/* Right Area: Panel Catatan Validator untuk Nomor Aktif */}
                <aside className="w-full lg:w-96 bg-white dark:bg-[#0d1221] border-t lg:border-t-0 lg:border-l border-slate-200 dark:border-slate-800 flex flex-col shrink-0 h-96 lg:h-auto overflow-hidden">
                    <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between shrink-0 bg-slate-50/50 dark:bg-slate-800/40">
                        <div className="flex items-center gap-2">
                            <MessageSquare className="text-primary" size={16} />
                            <h3 className="text-xs font-bold text-slate-800 dark:text-slate-100 uppercase tracking-wider">
                                Catatan No. {currentIndex + 1}
                            </h3>
                        </div>
                        <span className="text-[11px] font-bold text-slate-400">
                            {currentQuestionNotes.length} Catatan
                        </span>
                    </div>

                    <div className="flex-1 overflow-y-auto p-4 space-y-4">
                        {actionError && <p role="alert" className="text-xs text-red-600">{actionError}</p>}
                        {readOnlyReason && (
                            <p role="status" className="p-3 rounded-xl border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-950/30 text-xs text-amber-800 dark:text-amber-300">
                                {readOnlyReason}
                            </p>
                        )}
                        {/* Form Input Catatan Baru */}
                        {canEdit && (
                        <div className="p-4 bg-slate-50 dark:bg-[#111728] rounded-xl border border-slate-200 dark:border-slate-800 space-y-3">
                            <div className="flex items-center justify-between">
                                <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                                    Tambah Catatan Butir
                                </span>
                                <select
                                    value={statusItem}
                                    onChange={e => setStatusItem(e.target.value as NoteStatusItem)}
                                    className="text-[11px] font-bold px-2 py-1 rounded bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
                                >
                                    <option value="valid">🟢 Layak</option>
                                    <option value="revision">🟡 Revisi</option>
                                    <option value="rejected">🔴 Tolak</option>
                                </select>
                            </div>

                            {/* Teks Terpilih / Highlight Quote */}
                            {selectedText && (
                                <div className="p-2 bg-amber-100/70 dark:bg-amber-950/40 rounded-lg border border-amber-300 dark:border-amber-800 text-[11px] text-amber-900 dark:text-amber-200 relative">
                                    <div className="flex items-center justify-between mb-0.5 font-bold text-[10px] text-amber-700 dark:text-amber-300">
                                        <span>Teks yang Ditandai:</span>
                                        <button
                                            onClick={() => setSelectedText('')}
                                            className="text-amber-600 hover:text-amber-800"
                                        >
                                            ✕ Batal
                                        </button>
                                    </div>
                                    <p className="italic line-clamp-2 font-mono">"{selectedText}"</p>
                                </div>
                            )}

                            <div className="flex items-center gap-2">
                                <select
                                    value={category}
                                    onChange={e => setCategory(e.target.value as NoteCategory)}
                                    className="w-full text-xs px-2.5 py-1.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-medium"
                                >
                                    <option value="typo">Salah Ketik (Typo)</option>
                                    <option value="kunci_jawaban">Kunci Jawaban</option>
                                    <option value="materi">Materi / Konsep</option>
                                    <option value="konstruksi">Konstruksi Butir</option>
                                    <option value="bahasa">Kaidah Bahasa</option>
                                    <option value="lainnya">Lainnya</option>
                                </select>
                            </div>

                            <label className="block text-xs font-semibold">
                                Bagian yang diberi catatan
                                <select value={targetScope} onChange={event => {
                                    const scope = event.target.value as typeof targetScope;
                                    setTargetScope(scope);
                                    if (scope !== 'option') setSelectedOptionId(undefined);
                                }} className="mt-1 w-full rounded-lg border p-2 bg-white dark:bg-slate-800">
                                    <option value="question_text">Teks soal</option>
                                    <option value="stimulus">Stimulus</option>
                                    <option value="general">Umum</option>
                                    {selectedOptionId && <option value="option">Opsi jawaban yang dipilih</option>}
                                </select>
                            </label>
                            <textarea
                                rows={3}
                                value={commentText}
                                onChange={e => setCommentText(e.target.value)}
                                placeholder="Tuliskan catatan perbaikan atau saran Anda..."
                                className="w-full p-2.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-medium outline-none focus:ring-2 focus:ring-primary/20 resize-none"
                            />

                            <Button
                                onClick={handleSaveNote}
                                disabled={isSavingNote || !commentText.trim()}
                                className="w-full bg-primary text-white font-bold text-xs flex items-center justify-center gap-1.5 py-2"
                            >
                                {isSavingNote ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                                Simpan Catatan
                            </Button>
                        </div>
                        )}

                        {/* Daftar Catatan yang Sudah Dibuat pada Nomor Ini */}
                        <div className="space-y-2">
                            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                                Catatan pada Nomor Ini ({currentQuestionNotes.length}):
                            </p>
                            {currentQuestionNotes.length === 0 ? (
                                <p className="text-xs text-slate-400 text-center py-4 italic">
                                    Belum ada catatan untuk nomor ini.
                                </p>
                            ) : (
                                currentQuestionNotes.map(n => (
                                    <div
                                        key={n.id}
                                        className="p-3 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 text-xs space-y-1.5"
                                    >
                                        <div className="flex items-center justify-between">
                                            <span className="font-bold text-primary flex items-center gap-1 text-[11px]">
                                                <Tag size={11} /> {n.category.replace('_', ' ').toUpperCase()}
                                            </span>
                                            {/* Hanya catatan milik sendiri yang belum diperbaiki pembuat soal. */}
                                            {canEdit && myUserId && n.validator_id === myUserId && !n.is_resolved && (
                                                <button
                                                    onClick={() => handleDeleteNote(n.id)}
                                                    className="text-slate-400 hover:text-red-500 p-0.5 rounded"
                                                    title="Hapus Catatan"
                                                >
                                                    <Trash2 size={13} />
                                                </button>
                                            )}
                                        </div>

                                        {n.selected_text && (
                                            <p className="text-[11px] bg-amber-50 dark:bg-amber-950/40 p-1.5 rounded font-mono text-amber-800 dark:text-amber-200 italic">
                                                "{n.selected_text}"
                                            </p>
                                        )}

                                        <p className="text-slate-700 dark:text-slate-200 font-medium">
                                            {n.comment}
                                        </p>

                                        <div className="pt-1 flex items-center justify-between text-[10px] text-slate-400">
                                            <span>Oleh: {n.validator?.full_name || 'Anda'}</span>
                                            {n.is_resolved && (
                                                <span className="text-emerald-600 font-bold flex items-center gap-0.5">
                                                    ✓ Sudah Diperbaiki
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </aside>
            </div>

            {/* Bottom Number Navigation Bar */}
            <footer className="h-16 bg-white dark:bg-[#0d1221] border-t border-slate-200 dark:border-slate-800 px-4 flex items-center justify-between shrink-0 gap-3">
                <button
                    onClick={() => changeQuestion(currentIndex - 1)}
                    disabled={isSavingNote || currentIndex === 0}
                    className="px-3 py-2 bg-slate-100 dark:bg-slate-800 rounded-xl text-xs font-bold disabled:opacity-30 hover:bg-slate-200 flex items-center gap-1"
                >
                    <ChevronLeft size={16} /> Sebelumnya
                </button>

                {/* Grid Nomor Soal */}
                <div className="flex items-center gap-1.5 overflow-x-auto py-1 px-2 max-w-xl">
                    {questions.map((q, idx) => {
                        const hasNotes = notes.some(n => n.question_id === q.id);
                        const isCurrent = idx === currentIndex;

                        return (
                            <button
                                key={q.id || idx}
                                onClick={() => changeQuestion(idx)}
                                disabled={isSavingNote}
                                className={`w-8 h-8 rounded-lg text-xs font-bold shrink-0 transition-all relative ${
                                    isCurrent
                                        ? 'bg-primary text-white shadow-md shadow-primary/30 ring-2 ring-primary/40'
                                        : hasNotes
                                        ? 'bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300 border border-amber-300'
                                        : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200'
                                }`}
                            >
                                {idx + 1}
                                {hasNotes && !isCurrent && (
                                    <span className="w-2 h-2 rounded-full bg-amber-500 absolute -top-0.5 -right-0.5" />
                                )}
                            </button>
                        );
                    })}
                </div>

                <button
                    onClick={() => changeQuestion(currentIndex + 1)}
                    disabled={isSavingNote || currentIndex === questions.length - 1}
                    className="px-3 py-2 bg-slate-100 dark:bg-slate-800 rounded-xl text-xs font-bold disabled:opacity-30 hover:bg-slate-200 flex items-center gap-1"
                >
                    Selanjutnya <ChevronRight size={16} />
                </button>
            </footer>

            {/* Modal Final Submit Kesimpulan Validator */}
            {isSubmitModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
                    <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 w-full max-w-lg p-6 space-y-4">
                        <div className="flex items-center gap-2 text-primary font-bold text-base">
                            <ShieldCheck size={22} />
                            <h3>Selesaikan Validasi Bank Soal</h3>
                        </div>
                        <p className="text-xs text-slate-500 leading-relaxed">
                            Kirimkan rekomendasi kelayakan bank soal ini serta kesimpulan akhir Anda kepada proktor dan guru pembuat soal.
                        </p>

                        <div className="space-y-3">
                            <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                                Rekomendasi Kelayakan Bank Soal:
                            </label>
                            <div className="grid grid-cols-3 gap-2">
                                {[
                                    { id: 'approved', label: 'Disetujui', color: 'emerald' },
                                    { id: 'revision_needed', label: 'Perlu Revisi', color: 'amber' },
                                    { id: 'rejected', label: 'Ditolak', color: 'rose' },
                                ].map(rec => (
                                    <button
                                        key={rec.id}
                                        type="button"
                                        onClick={() => setGeneralRec(rec.id as any)}
                                        className={`p-2.5 rounded-xl text-xs font-bold border text-center transition-all ${
                                            generalRec === rec.id
                                                ? rec.id === 'approved'
                                                    ? 'bg-emerald-600 text-white border-emerald-600 shadow'
                                                    : rec.id === 'revision_needed'
                                                    ? 'bg-amber-500 text-white border-amber-500 shadow'
                                                    : 'bg-rose-600 text-white border-rose-600 shadow'
                                                : 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                                        }`}
                                    >
                                        {rec.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div>
                            <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5">
                                Catatan Umum / Kesimpulan Akhir:
                            </label>
                            <textarea
                                rows={4}
                                value={generalComment}
                                onChange={e => setGeneralComment(e.target.value)}
                                placeholder="Contoh: Secara umum naskah soal sudah baik dan sesuai kisi-kisi, hanya perlu sedikit perbaikan redaksi rumus pada nomor 12 dan 18."
                                className="w-full p-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-medium outline-none focus:ring-2 focus:ring-primary/20 resize-none"
                            />
                        </div>

                        {submitError && (
                            <p role="alert" className="text-xs text-red-600">{submitError}</p>
                        )}

                        <div className="flex items-center justify-end gap-2.5 pt-2">
                            <Button
                                variant="ghost"
                                onClick={() => setIsSubmitModalOpen(false)}
                                disabled={isSubmittingFinal}
                            >
                                Batal
                            </Button>
                            <Button
                                onClick={handleFinalSubmit}
                                disabled={isSubmittingFinal}
                                className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs flex items-center gap-1.5"
                            >
                                {isSubmittingFinal ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                                Kirim Hasil Validasi
                            </Button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
