"use client";
import { trueFalseLabels } from '@acca-cbt/shared';
import { confirmDialog } from '@/lib/confirm-dialog';
import { ModeCornerRibbon } from '@/app/components/questions/ModeCornerRibbon';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
    ShieldCheck,
    ArrowLeft,
    CheckCircle2,
    AlertCircle,
    MessageSquare,
    Save,
    Trash2,
    Send,
    ChevronLeft,
    ChevronRight,
    Loader2,
    Tag,
    FileText,
    Highlighter,
    Pencil,
    RotateCcw,
    ListChecks,
    Calendar,
} from 'lucide-react';
import { Button } from '@/app/components/ui/button';
import { InlineSelect } from '@/app/components/ui/inlineselect';
import { Spinner } from '@/app/components/ui/Spinner';
import { Modal, ModalBody, ModalFooter } from '@/app/components/ui/modal';
import {
    getValidationReviewData,
    saveValidationNote,
    deleteValidationNote,
    submitValidationReview,
    updateValidationNote,
    verifyValidationNote,
    setValidationItemStatus,
    reopenValidationReview,
    type ValidationSession,
    type ValidationValidator,
    type ValidationNote,
    type ValidationItem,
    type NoteCategory,
    type NoteStatusItem,
    type NoteVerification,
} from '@/lib/api/validations';
import type { QuestionOptionRecord, QuestionRecord } from '@/lib/api/questions';
import { QuestionContent } from '@/app/components/questions/QuestionRenderer';
import { ValidationAnswerKey, ValidationQuestionContext } from '@/app/components/validations/ValidationQuestionContext';

type NoteScope = 'question_text' | 'stimulus' | 'option' | 'general';
type Recommendation = 'approved' | 'revision_needed' | 'rejected';
const DAY_MS = 24 * 60 * 60 * 1000;
/** Batas panjang teks yang diblok untuk dijadikan kutipan catatan. */
const MAX_SELECTION = 300;

const TYPE_LABELS: Record<string, string> = {
    mcq: 'Pilihan Ganda',
    mcq_complex: 'Pilihan Ganda Kompleks',
    true_false: 'Benar-Salah',
    matching: 'Menjodohkan',
    categorization: 'Kategorisasi',
    short_answer: 'Isian Singkat',
    essay: 'Uraian',
    sjt: 'Situational Judgement',
    ordering: 'Mengurutkan',
    likert: 'Skala Likert',
    forced_choice: 'Pilihan Paksa',
    checklist: 'Daftar Periksa',
    ranking: 'Peringkat',
    paired_comparison: 'Perbandingan Berpasangan',
};

const CATEGORY_LABELS: Record<NoteCategory, string> = {
    typo: 'Salah ketik',
    materi: 'Materi / konsep',
    kunci_jawaban: 'Kunci jawaban',
    konstruksi: 'Konstruksi butir',
    bahasa: 'Kaidah bahasa',
    lainnya: 'Lainnya',
};

const ITEM_STATUS: Record<NoteStatusItem, { label: string; chip: string; active: string }> = {
    valid: {
        label: 'Layak',
        chip: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900',
        active: 'bg-emerald-600 text-white border-emerald-600',
    },
    revision: {
        label: 'Revisi',
        chip: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900',
        active: 'bg-amber-500 text-white border-amber-500',
    },
    rejected: {
        label: 'Tolak',
        chip: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-900',
        active: 'bg-rose-600 text-white border-rose-600',
    },
};

const RECOMMENDATIONS: Array<{ id: Recommendation; label: string; active: string }> = [
    { id: 'approved', label: 'Disetujui', active: 'bg-emerald-600 text-white border-emerald-600 shadow' },
    { id: 'revision_needed', label: 'Perlu Revisi', active: 'bg-amber-500 text-white border-amber-500 shadow' },
    { id: 'rejected', label: 'Ditolak', active: 'bg-rose-600 text-white border-rose-600 shadow' },
];

/** Sama dengan aturan server: tanggal lama 00:00 UTC berlaku sampai akhir hari. */
function isDeadlinePassed(deadline?: string | null): boolean {
    if (!deadline) return false;
    let time = new Date(deadline).getTime();
    if (!Number.isFinite(time)) return false;
    if (time % DAY_MS === 0) time += DAY_MS - 1;
    return time < Date.now();
}

function formatDeadline(deadline: string): string {
    return new Date(deadline).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Cari wadah ber-`data-validation-scope` terdekat dari node seleksi. */
function scopeElement(node: Node | null | undefined): HTMLElement | null {
    if (!node) return null;
    const element = node.nodeType === 1 ? node as Element : node.parentElement;
    return element?.closest<HTMLElement>('[data-validation-scope]') || null;
}

/** Hanya tipe ini yang memakai tanda hijau "kunci jawaban" pada opsi. */
function marksCorrectOption(type: string): boolean {
    return type === 'mcq' || type === 'mcq_complex' || type === 'checklist';
}

function optionsHeading(type: string): string {
    switch (type) {
        case 'mcq':
        case 'mcq_complex':
        case 'checklist':
            return 'Opsi jawaban (kunci ditandai hijau):';
        case 'true_false':
            return 'Pernyataan dan kuncinya:';
        case 'categorization':
            return 'Pernyataan dan kategori yang benar:';
        case 'matching':
            return 'Pernyataan dan pasangan yang benar:';
        case 'sjt':
        case 'likert':
            return 'Opsi dan bobot skor:';
        case 'ordering':
        case 'ranking':
            return 'Butir yang diurutkan:';
        default:
            return 'Opsi:';
    }
}

/** Kunci per opsi untuk tipe yang kuncinya tidak berupa "opsi benar". */
function optionKeyLabel(type: string, option: QuestionOptionRecord, questionMetadata?: unknown): string | null {
    const metadata = option.metadata || {};
    switch (type) {
        case 'true_false':
            {
            const labels = trueFalseLabels(questionMetadata);
            return `Kunci: ${(option.is_correct ?? option.isCorrect) ? labels.true : labels.false}`;
        }
        case 'categorization': {
            const categories = option.category_names || metadata.category_names || (metadata.category_name ? [metadata.category_name] : []);
            return categories.length ? `Kategori: ${categories.join(', ')}` : 'Kategori belum diatur';
        }
        case 'matching': {
            const matches = option.match_texts || metadata.match_texts || (metadata.match_text ? [metadata.match_text] : []);
            return matches.length ? `Pasangan: ${matches.join(', ')}` : 'Pasangan belum diatur';
        }
        case 'sjt':
        case 'likert':
            return `Bobot ${option.weight ?? 0}`;
        default:
            return null;
    }
}

/** Rentang teks pertama dalam `root` yang sama persis dengan `text`. */
function findTextRange(root: Element, text: string): Range | null {
    const needle = text.trim();
    if (!needle) return null;
    const walker = root.ownerDocument.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
    const nodes: Text[] = [];
    const starts: number[] = [];
    let full = '';
    while (walker.nextNode()) {
        const node = walker.currentNode as Text;
        starts.push(full.length);
        nodes.push(node);
        full += node.data;
    }
    const index = full.indexOf(needle);
    if (index < 0 || !nodes.length) return null;
    const locate = (offset: number) => {
        let i = nodes.length - 1;
        while (i > 0 && starts[i] > offset) i--;
        return { node: nodes[i], offset: Math.min(offset - starts[i], nodes[i].data.length) };
    };
    const start = locate(index);
    const end = locate(index + needle.length);
    const range = root.ownerDocument.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    return range;
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
    const [items, setItems] = useState<ValidationItem[]>([]);

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
    const [itemSavingId, setItemSavingId] = useState<string | null>(null);
    const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
    const [editDraft, setEditDraft] = useState<{ comment: string; category: NoteCategory; statusItem: NoteStatusItem }>({ comment: '', category: 'typo', statusItem: 'revision' });
    const [busyNoteId, setBusyNoteId] = useState<string | null>(null);
    const [showSummary, setShowSummary] = useState(false);
    const [isReopening, setIsReopening] = useState(false);
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
        setEditingNoteId(null);
        window.getSelection()?.removeAllRanges();
        setCurrentIndex(index);
    };

    // Final submit modal
    const [isSubmitModalOpen, setIsSubmitModalOpen] = useState(false);
    // Tidak ada pilihan bawaan: validator harus memilih rekomendasinya sendiri.
    const [generalRec, setGeneralRec] = useState<Recommendation | ''>('');
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
                setItems(res.items || []);
                setGeneralRec(res.myValidatorStatus?.general_recommendation || '');
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
    }, [validationId, setGeneralRec, setGeneralComment]);

    useEffect(() => {
        const initialLoad = setTimeout(() => { void loadData(); }, 0);
        return () => clearTimeout(initialLoad);
    }, [loadData]);

    const currentQuestion = questions[currentIndex] || null;

    // Filter notes for the current active question
    const currentQuestionNotes = useMemo(() => {
        if (!currentQuestion) return [];
        return notes.filter(n => n.question_id === currentQuestion.id);
    }, [notes, currentQuestion]);

    // Sorot kutipan catatan pada naskah soal (CSS Custom Highlight API, tanpa mengubah DOM).
    useEffect(() => {
        if (typeof document === 'undefined') return;
        const globals = globalThis as unknown as {
            CSS?: { highlights?: Map<string, unknown> };
            Highlight?: new (...ranges: Range[]) => unknown;
        };
        const registry = globals.CSS?.highlights;
        const HighlightCtor = globals.Highlight;
        if (!registry || !HighlightCtor) return;
        const sheet = document.querySelector('[data-validation-sheet]');
        const ranges: Range[] = [];
        if (sheet) {
            for (const note of currentQuestionNotes) {
                if (!note.selected_text) continue;
                const scoped = note.target_scope === 'option' && note.target_option_id
                    ? sheet.querySelector(`[data-option-id="${note.target_option_id}"]`)
                    : sheet.querySelector(`[data-validation-scope="${note.target_scope}"]`);
                const range = (scoped && findTextRange(scoped, note.selected_text)) || findTextRange(sheet, note.selected_text);
                if (range) ranges.push(range);
            }
        }
        registry.set('validation-notes', new HighlightCtor(...ranges));
        return () => { registry.delete('validation-notes'); };
    }, [currentQuestionNotes]);

    const round = validation?.round ?? 1;
    const myUserId = validatorStatus?.validator_id || null;
    const alreadySubmitted = validatorStatus?.status === 'submitted';
    const deadlinePassed = isDeadlinePassed(validation?.deadline);
    // Hanya validator yang ditugaskan, belum mengirim, dan masih dalam batas waktu yang boleh menulis.
    const readOnlyReason = !validatorStatus
        ? 'Mode lihat saja: hanya validator yang ditugaskan yang dapat menambah catatan dan mengirim rekomendasi.'
        : deadlinePassed
            ? 'Batas waktu validasi telah berakhir. Catatan dan rekomendasi tidak dapat diubah lagi.'
            : alreadySubmitted
                ? 'Hasil validasi Anda sudah dikirim. Buka kembali bila perlu mengubah catatan atau penilaian butir; pembuat soal diberi tahu saat Anda mengirim ulang.'
                : null;
    const canEdit = !readOnlyReason;
    const canReopen = !!validatorStatus && alreadySubmitted && !deadlinePassed;

    const myItems = new Map(items.filter(item => myUserId && item.validator_id === myUserId).map(item => [item.question_id, item.status]));
    const myNotes = myUserId ? notes.filter(n => n.validator_id === myUserId) : [];
    const isPreviousRound = (note: ValidationNote) => (note.round ?? 1) < round;
    const pendingVerification = myNotes.filter(n => n.status_item !== 'valid' && isPreviousRound(n) && !n.verification);
    const reviewedIds = new Set<string>([...myItems.keys(), ...myNotes.map(n => n.question_id)]);
    const reviewedCount = questions.filter(q => reviewedIds.has(q.id)).length;
    const unreviewedCount = questions.length - reviewedCount;
    const flaggedCount = questions.filter(q => {
        const status = myItems.get(q.id);
        return status === 'revision' || status === 'rejected' ||
            myNotes.some(n => n.question_id === q.id && !isPreviousRound(n) && n.status_item !== 'valid');
    }).length;
    const questionNumber = (questionId: string) => questions.findIndex(q => q.id === questionId) + 1;

    /** Status perbaikan atas catatan dari putaran sebelumnya. */
    const fixState = (note: ValidationNote): { text: string; tone: string } => {
        if (!note.is_resolved) {
            return note.verification === 'not_fixed'
                ? { text: 'Dinilai belum sesuai; menunggu perbaikan pembuat soal.', tone: 'text-rose-600 dark:text-rose-300' }
                : { text: 'Belum ditandai diperbaiki oleh pembuat soal.', tone: 'text-amber-600 dark:text-amber-300' };
        }
        const question = questions.find(q => q.id === note.question_id);
        if (typeof question?.revision === 'number' && typeof note.question_revision === 'number') {
            return question.revision > note.question_revision
                ? { text: 'Diperbaiki: soal sudah diubah sejak catatan dibuat.', tone: 'text-emerald-600 dark:text-emerald-300' }
                : { text: 'Ditandai diperbaiki, tetapi soal tidak diubah.', tone: 'text-amber-600 dark:text-amber-300' };
        }
        return { text: 'Ditandai diperbaiki oleh pembuat soal.', tone: 'text-emerald-600 dark:text-emerald-300' };
    };

    // Handle text selection on question / stimulus / option: bagian yang diberi
    // catatan mengikuti lokasi teks yang diblok.
    const handleMouseUp = () => {
        if (!canEdit) return;
        const selection = window.getSelection();
        const text = selection?.toString()?.trim();
        if (!text) return;
        if (text.length >= MAX_SELECTION) {
            setActionError(`Teks yang diblok terlalu panjang (maksimal ${MAX_SELECTION - 1} karakter). Blok bagian yang lebih pendek.`);
            return;
        }
        setActionError(null);
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

    const markWorking = () => {
        setValidatorStatus(current => current && current.status === 'assigned' ? { ...current, status: 'in_progress' } : current);
    };

    const handleSetItem = async (status: NoteStatusItem) => {
        if (!canEdit || !currentQuestion) return;
        setItemSavingId(currentQuestion.id);
        setActionError(null);
        try {
            const res = await setValidationItemStatus(validationId, currentQuestion.id, status);
            if (!res.success) throw new Error(res.error || 'Gagal menyimpan penilaian butir.');
            const saved = res as unknown as ValidationItem;
            setItems(prev => [...prev.filter(item => !(item.question_id === currentQuestion.id && item.validator_id === myUserId)), saved]);
            markWorking();
        } catch (e) {
            setActionError(e instanceof Error ? e.message : 'Gagal menyimpan penilaian butir.');
        } finally {
            setItemSavingId(null);
        }
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
            setNotes(prev => [...prev, res as unknown as ValidationNote]);
            setCommentText('');
            setSelectedText('');
            setSelectedOptionId(undefined);
            setTargetScope('question_text');
            markWorking();
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

    const startEditNote = (note: ValidationNote) => {
        setEditingNoteId(note.id);
        setEditDraft({ comment: note.comment, category: note.category, statusItem: note.status_item });
        setActionError(null);
    };

    const handleSaveEdit = async (noteId: string) => {
        if (!editDraft.comment.trim()) return;
        setBusyNoteId(noteId);
        setActionError(null);
        try {
            const res = await updateValidationNote(validationId, noteId, {
                comment: editDraft.comment.trim(), category: editDraft.category, statusItem: editDraft.statusItem,
            });
            if (!res.success) throw new Error(res.error || 'Gagal mengubah catatan.');
            const updated = res as unknown as ValidationNote;
            setNotes(prev => prev.map(n => n.id === noteId ? { ...n, ...updated, validator: n.validator } : n));
            setEditingNoteId(null);
        } catch (e) {
            setActionError(e instanceof Error ? e.message : 'Gagal mengubah catatan.');
        } finally {
            setBusyNoteId(null);
        }
    };

    const handleVerify = async (note: ValidationNote, verification: NoteVerification) => {
        setBusyNoteId(note.id);
        setActionError(null);
        try {
            const res = await verifyValidationNote(validationId, note.id, verification);
            if (!res.success) throw new Error(res.error || 'Gagal menyimpan penilaian perbaikan.');
            const updated = res as unknown as ValidationNote;
            setNotes(prev => prev.map(n => n.id === note.id ? { ...n, ...updated, validator: n.validator } : n));
            markWorking();
        } catch (e) {
            setActionError(e instanceof Error ? e.message : 'Gagal menyimpan penilaian perbaikan.');
        } finally {
            setBusyNoteId(null);
        }
    };

    const handleReopen = async () => {
        setIsReopening(true);
        setActionError(null);
        try {
            const res = await reopenValidationReview(validationId);
            if (!res.success) throw new Error(res.error || 'Gagal membuka kembali hasil validasi.');
            await loadData();
        } catch (e) {
            setActionError(e instanceof Error ? e.message : 'Gagal membuka kembali hasil validasi.');
        } finally {
            setIsReopening(false);
        }
    };

    const handleFinalSubmit = async () => {
        if (!canEdit) return;
        if (!generalRec) {
            setSubmitError('Pilih rekomendasi kelayakan bank soal terlebih dahulu.');
            return;
        }
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

    const currentItemStatus = currentQuestion ? myItems.get(currentQuestion.id) : undefined;
    const contradiction = generalRec === 'approved' && flaggedCount > 0
        ? `Anda memilih Disetujui, padahal ${flaggedCount} butir Anda nilai Revisi/Tolak.`
        : (generalRec === 'revision_needed' || generalRec === 'rejected') && flaggedCount === 0
            ? 'Belum ada butir yang Anda nilai Revisi/Tolak. Beri catatan pada butir yang perlu diperbaiki agar pembuat soal tahu bagian yang dimaksud.'
            : null;

    const renderNoteCard = (n: ValidationNote, showNumber = false) => {
        const mine = !!myUserId && n.validator_id === myUserId;
        const previous = isPreviousRound(n);
        const editable = canEdit && mine && !n.is_resolved && !previous;
        const isEditing = editingNoteId === n.id;
        const statusMeta = ITEM_STATUS[n.status_item] || ITEM_STATUS.revision;
        const fix = previous ? fixState(n) : null;
        return (
            <div key={n.id} className="p-3 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 text-xs space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                        {showNumber && (
                            <button type="button" onClick={() => { setShowSummary(false); changeQuestion(questionNumber(n.question_id) - 1); }}
                                className="font-bold text-primary underline text-[11px]">
                                No. {questionNumber(n.question_id)}
                            </button>
                        )}
                        <span className="font-bold text-primary flex items-center gap-1 text-[11px]">
                            <Tag size={11} /> {CATEGORY_LABELS[n.category] || n.category}
                        </span>
                        <span className={`px-1.5 py-0.5 rounded border text-[10px] font-semibold ${statusMeta.chip}`}>{statusMeta.label}</span>
                        {round > 1 && <span className="text-[10px] text-slate-400">Putaran {n.round ?? 1}</span>}
                    </div>
                    {editable && !isEditing && (
                        <div className="flex items-center gap-0.5">
                            <button onClick={() => startEditNote(n)} className="text-slate-400 hover:text-primary p-0.5 rounded" title="Ubah Catatan">
                                <Pencil size={13} />
                            </button>
                            <button onClick={() => handleDeleteNote(n.id)} className="text-slate-400 hover:text-red-500 p-0.5 rounded" title="Hapus Catatan">
                                <Trash2 size={13} />
                            </button>
                        </div>
                    )}
                </div>
                {n.selected_text && (
                    <p className="text-[11px] bg-amber-50 dark:bg-amber-950/40 p-1.5 rounded font-mono text-amber-800 dark:text-amber-200 italic">
                        &quot;{n.selected_text}&quot;
                    </p>
                )}
                {isEditing ? (
                    <div className="space-y-2">
                        <div className="grid grid-cols-2 gap-2">
                            <InlineSelect aria-label="Kategori catatan" value={editDraft.category} minWidth="0" height="34px"
                                className="w-full" onChange={value => setEditDraft(d => ({ ...d, category: value as NoteCategory }))}
                                options={Object.entries(CATEGORY_LABELS).map(([value, label]) => ({ value, label }))}
                            />
                            <InlineSelect aria-label="Status catatan" value={editDraft.statusItem} minWidth="0" height="34px"
                                className="w-full" onChange={value => setEditDraft(d => ({ ...d, statusItem: value as NoteStatusItem }))}
                                options={[{ value: 'valid', label: '🟢 Layak' }, { value: 'revision', label: '🟡 Revisi' }, { value: 'rejected', label: '🔴 Tolak' }]}
                            />
                        </div>
                        <textarea rows={3} value={editDraft.comment} aria-label="Ubah isi catatan"
                            onChange={e => setEditDraft(d => ({ ...d, comment: e.target.value }))}
                            className="w-full p-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-xs outline-none focus:ring-2 focus:ring-primary/20" />
                        <div className="flex justify-end gap-2">
                            <button type="button" onClick={() => setEditingNoteId(null)} className="px-2.5 py-1 rounded-lg text-[11px] font-semibold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700">Batal</button>
                            <button type="button" disabled={busyNoteId === n.id || !editDraft.comment.trim()} onClick={() => handleSaveEdit(n.id)}
                                className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-primary text-white disabled:opacity-50">
                                {busyNoteId === n.id ? 'Menyimpan…' : 'Simpan Perubahan'}
                            </button>
                        </div>
                    </div>
                ) : (
                    <p className="text-slate-700 dark:text-slate-200 font-medium whitespace-pre-wrap break-words">{n.comment}</p>
                )}
                {fix && (
                    <div className="mt-1 p-2 rounded-lg bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 space-y-1">
                        <p className={`text-[11px] font-semibold ${fix.tone}`}>{fix.text}</p>
                        {n.owner_response && (
                            <p className="text-[11px] text-slate-600 dark:text-slate-300"><span className="font-semibold">Tanggapan pembuat soal:</span> {n.owner_response}</p>
                        )}
                        {n.verification === 'accepted' && <p className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-300">✓ Perbaikan diterima validator</p>}
                        {canEdit && mine && (
                            <div className="flex gap-1.5 pt-0.5">
                                <button type="button" disabled={busyNoteId === n.id || !n.is_resolved || n.verification === 'accepted'}
                                    onClick={() => handleVerify(n, 'accepted')}
                                    className="px-2 py-1 rounded-lg text-[11px] font-bold border border-emerald-300 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-800 dark:text-emerald-300 disabled:opacity-40">
                                    Diterima
                                </button>
                                <button type="button" disabled={busyNoteId === n.id || n.verification === 'not_fixed'}
                                    onClick={() => handleVerify(n, 'not_fixed')}
                                    className="px-2 py-1 rounded-lg text-[11px] font-bold border border-rose-300 text-rose-700 hover:bg-rose-50 dark:border-rose-800 dark:text-rose-300 disabled:opacity-40">
                                    Belum sesuai
                                </button>
                            </div>
                        )}
                    </div>
                )}
                <div className="pt-1 flex items-center justify-between text-[10px] text-slate-400">
                    <span>Oleh: {n.validator?.full_name || (mine ? 'Anda' : 'Validator')}</span>
                    {n.is_resolved && !previous && (
                        <span className="text-emerald-600 font-bold flex items-center gap-0.5">
                            ✓ Sudah Diperbaiki
                        </span>
                    )}
                </div>
            </div>
        );
    };

    return (
        <div className="fixed inset-0 z-50 flex flex-col bg-slate-100 dark:bg-[#020718] font-sans overflow-hidden">
            <style>{'::highlight(validation-notes){background-color:rgba(251,191,36,.45);color:inherit}'}</style>
            {/* Top Navigation Bar */}
            <header className="relative min-h-20 bg-white dark:bg-[#0d1221] border-b border-slate-200 dark:border-slate-800 pl-4 pr-24 py-3 flex flex-wrap items-center justify-between gap-3 shrink-0">
                <ModeCornerRibbon mode="validation" />
                <div className="flex items-center gap-3 min-w-0 flex-1">
                    <button
                        onClick={() => router.push('/dashboard/guru/validations')}
                        className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                        title="Kembali"
                    >
                        <ArrowLeft size={18} />
                    </button>
                    <div className="min-w-0">
                        <h2 title={validation.title} className="text-sm sm:text-base font-bold text-slate-800 dark:text-slate-100 truncate">
                            {validation.title}
                        </h2>
                        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span>{validation.bank?.subject} • {validation.bank?.class_level}</span>
                            {round > 1 && (
                                <span className="px-1.5 py-0.5 rounded bg-violet-50 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300 font-semibold text-[10px]">
                                    Telaah ulang · putaran {round}
                                </span>
                            )}
                            {validation.deadline && (
                                <span className={`inline-flex items-center gap-1 ${deadlinePassed ? 'text-rose-600 dark:text-rose-400 font-semibold' : ''}`}>
                                    <Calendar size={12} /> Batas {formatDeadline(validation.deadline)}{deadlinePassed ? ' (terlewat)' : ''}
                                </span>
                            )}
                        </p>
                    </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                    {validatorStatus && (
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-[10px] font-bold" title="Butir yang sudah Anda nilai atau beri catatan">
                            <ListChecks size={12} /> Dinilai {reviewedCount}/{questions.length}
                        </span>
                    )}
                    {alreadySubmitted && (
                        <span className="hidden sm:inline-flex px-2 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 text-[10px] font-bold">
                            Rekomendasi sudah dikirim
                        </span>
                    )}
                    {canReopen && (
                        <Button variant="outline" onClick={handleReopen} disabled={isReopening}
                            className="font-bold text-xs flex items-center gap-1.5">
                            {isReopening ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />} Buka Kembali untuk Diubah
                        </Button>
                    )}
                    {canEdit && (
                        <Button
                            onClick={() => { setSubmitError(null); setIsSubmitModalOpen(true); }}
                            className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs flex items-center gap-1.5 shadow-sm"
                        >
                            <CheckCircle2 size={15} /> {round > 1 ? 'Kirim Hasil Telaah Ulang' : 'Selesaikan Validasi'}
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
                        <div data-validation-sheet="" className="max-w-3xl mx-auto bg-white dark:bg-[#0d1221] rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm p-6 md:p-8 space-y-6">
                            {/* Header Soal */}
                            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                                <div className="flex items-center gap-2">
                                    <span className="w-8 h-8 rounded-xl bg-primary text-white font-bold flex items-center justify-center text-sm shadow-sm">
                                        {currentIndex + 1}
                                    </span>
                                    <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                                        {TYPE_LABELS[currentQuestion.type] || currentQuestion.type}
                                    </span>
                                </div>
                                <span className="text-xs font-semibold text-slate-400">
                                    Bobot: {currentQuestion.score_default || 1} Poin
                                </span>
                            </div>

                            <ValidationQuestionContext question={currentQuestion} />

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
                                        {optionsHeading(currentQuestion.type)}
                                    </p>
                                    <div className="space-y-2">
                                        {currentQuestion.bank_question_options.map((opt, oIdx) => {
                                            const letter = String.fromCharCode(65 + oIdx);
                                            const isCorrect = marksCorrectOption(currentQuestion.type) && Boolean(opt.is_correct ?? opt.isCorrect);
                                            const keyLabel = optionKeyLabel(currentQuestion.type, opt, currentQuestion.metadata);

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
                                                    } ${selectedOptionId && selectedOptionId === opt.id ? 'ring-2 ring-primary/40' : ''}`}
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
                                                    {keyLabel && (
                                                        <span className="shrink-0 px-2 py-0.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-900 text-[10px] font-bold">
                                                            {keyLabel}
                                                        </span>
                                                    )}
                                                    {isCorrect && (
                                                        <span className="sr-only">Kunci jawaban</span>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}

                            <ValidationAnswerKey question={currentQuestion} />

                            {/* Petunjuk Seleksi Teks */}
                            {canEdit && (
                            <div className="p-3 bg-amber-50/60 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/40 rounded-xl text-xs text-amber-800 dark:text-amber-300 flex items-center gap-2">
                                <Highlighter size={16} className="text-amber-600 shrink-0" />
                                <span>
                                    <strong>Tips Validator:</strong> Blok teks di stimulus, soal, atau opsi (maks. {MAX_SELECTION - 1} karakter) untuk menjadikannya kutipan catatan. Kutipan yang sudah dicatat disorot kuning.
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
                                {showSummary ? 'Semua Catatan Saya' : `Catatan No. ${currentIndex + 1}`}
                            </h3>
                        </div>
                        <div className="flex items-center gap-2">
                            {myUserId && (
                                <button type="button" onClick={() => setShowSummary(value => !value)}
                                    className="text-[11px] font-bold text-primary hover:underline">
                                    {showSummary ? 'Kembali' : `Ringkasan (${myNotes.length})`}
                                </button>
                            )}
                            {!showSummary && (
                                <span className="text-[11px] font-bold text-slate-400">
                                    {currentQuestionNotes.length} Catatan
                                </span>
                            )}
                        </div>
                    </div>

                    <div className="flex-1 overflow-y-auto p-4 space-y-4">
                        {actionError && <p role="alert" className="text-xs text-red-600">{actionError}</p>}
                        {readOnlyReason && (
                            <p role="status" className="p-3 rounded-xl border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-950/30 text-xs text-amber-800 dark:text-amber-300">
                                {readOnlyReason}
                            </p>
                        )}
                        {canEdit && pendingVerification.length > 0 && (
                            <p role="status" className="p-3 rounded-xl border border-violet-200 dark:border-violet-900/50 bg-violet-50 dark:bg-violet-950/30 text-xs text-violet-800 dark:text-violet-300">
                                Telaah ulang: {pendingVerification.length} perbaikan atas catatan Anda belum dinilai (nomor {Array.from(new Set(pendingVerification.map(n => questionNumber(n.question_id)))).sort((a, b) => a - b).join(', ')}). Pilih Diterima atau Belum sesuai pada tiap catatan.
                            </p>
                        )}

                        {showSummary ? (
                            <div className="space-y-2">
                                {myNotes.length === 0
                                    ? <p className="text-xs text-slate-400 text-center py-4 italic">Anda belum menulis catatan.</p>
                                    : [...myNotes].sort((a, b) => questionNumber(a.question_id) - questionNumber(b.question_id)).map(n => renderNoteCard(n, true))}
                            </div>
                        ) : (
                            <>
                                {/* Penilaian butir */}
                                {validatorStatus && (
                                    <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 space-y-2">
                                        <p className="text-xs font-bold text-slate-700 dark:text-slate-300">Penilaian butir ini</p>
                                        <div className="grid grid-cols-3 gap-1.5">
                                            {(Object.keys(ITEM_STATUS) as NoteStatusItem[]).map(status => (
                                                <button key={status} type="button"
                                                    disabled={!canEdit || itemSavingId === currentQuestion?.id}
                                                    aria-pressed={currentItemStatus === status}
                                                    onClick={() => handleSetItem(status)}
                                                    className={`py-1.5 rounded-lg border text-[11px] font-bold transition-all disabled:cursor-not-allowed ${
                                                        currentItemStatus === status
                                                            ? ITEM_STATUS[status].active
                                                            : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-slate-300 disabled:opacity-60'
                                                    }`}>
                                                    {ITEM_STATUS[status].label}
                                                </button>
                                            ))}
                                        </div>
                                        <p className="text-[10px] text-slate-400">
                                            Butir yang layak cukup ditandai Layak tanpa catatan.
                                        </p>
                                    </div>
                                )}

                                {/* Form Input Catatan Baru */}
                                {canEdit && (
                                <div className="p-4 bg-slate-50 dark:bg-[#111728] rounded-xl border border-slate-200 dark:border-slate-800 space-y-3">
                                    <div className="flex items-center justify-between">
                                        <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                                            Tambah Catatan Butir
                                        </span>
                                        <InlineSelect aria-label="Status catatan" value={statusItem}
                                            onChange={value => setStatusItem(value as NoteStatusItem)} minWidth="120px" height="34px"
                                            options={[{ value: 'valid', label: '🟢 Layak' }, { value: 'revision', label: '🟡 Revisi' }, { value: 'rejected', label: '🔴 Tolak' }]}
                                        />
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
                                            <p className="italic line-clamp-2 font-mono">&quot;{selectedText}&quot;</p>
                                        </div>
                                    )}
                                    <InlineSelect aria-label="Kategori catatan" value={category} onChange={value => setCategory(value as NoteCategory)}
                                        minWidth="100%" height="44px"
                                        options={[{ value: 'typo', label: 'Salah Ketik (Typo)' }, { value: 'kunci_jawaban', label: 'Kunci Jawaban' },
                                            { value: 'materi', label: 'Materi / Konsep' }, { value: 'konstruksi', label: 'Konstruksi Butir' },
                                            { value: 'bahasa', label: 'Kaidah Bahasa' }, { value: 'lainnya', label: 'Lainnya' }]}
                                    />
                                    <div className="text-xs font-semibold">
                                        <label htmlFor="validation-note-scope" className="mb-1 block">Bagian yang diberi catatan</label>
                                        <InlineSelect id="validation-note-scope" value={targetScope} onChange={value => {
                                            const scope = value as typeof targetScope;
                                            setTargetScope(scope);
                                            if (scope !== 'option') setSelectedOptionId(undefined);
                                        }} minWidth="100%" height="44px"
                                            options={[{ value: 'question_text', label: 'Teks soal' }, { value: 'stimulus', label: 'Stimulus' },
                                                { value: 'general', label: 'Umum' }, ...(selectedOptionId ? [{ value: 'option', label: 'Opsi jawaban yang dipilih' }] : [])]}
                                        />
                                    </div>
                                    <textarea
                                        rows={3}
                                        value={commentText}
                                        onChange={e => setCommentText(e.target.value)}
                                        placeholder="Tuliskan catatan perbaikan atau saran Anda..."
                                        className="w-full p-2.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-medium outline-none focus:ring-2 focus:ring-primary/20"
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
                                        currentQuestionNotes.map(n => renderNoteCard(n))
                                    )}
                                </div>
                            </>
                        )}
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

                {/* Grid Nomor Soal: warna mengikuti penilaian butir validator */}
                <div className="flex items-center gap-1.5 overflow-x-auto py-1 px-2 max-w-xl">
                    {questions.map((q, idx) => {
                        const hasNotes = notes.some(n => n.question_id === q.id);
                        const itemStatus = myItems.get(q.id);
                        const needsCheck = pendingVerification.some(n => n.question_id === q.id);
                        const isCurrent = idx === currentIndex;
                        const tone = isCurrent
                            ? 'bg-primary text-white shadow-md shadow-primary/30 ring-2 ring-primary/40'
                            : itemStatus === 'valid'
                                ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 border border-emerald-300'
                                : itemStatus === 'rejected'
                                    ? 'bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-300 border border-rose-300'
                                    : itemStatus === 'revision' || hasNotes
                                        ? 'bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300 border border-amber-300'
                                        : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200';
                        return (
                            <button
                                key={q.id || idx}
                                onClick={() => changeQuestion(idx)}
                                disabled={isSavingNote}
                                title={needsCheck ? 'Ada perbaikan yang perlu dinilai' : itemStatus ? `Dinilai: ${ITEM_STATUS[itemStatus].label}` : undefined}
                                className={`w-8 h-8 rounded-lg text-xs font-bold shrink-0 transition-all relative ${tone}`}
                            >
                                {idx + 1}
                                {(needsCheck || (hasNotes && !isCurrent)) && (
                                    <span className={`w-2 h-2 rounded-full absolute -top-0.5 -right-0.5 ${needsCheck ? 'bg-violet-500' : 'bg-amber-500'}`} />
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
                <Modal
                    open={isSubmitModalOpen}
                    onClose={() => { if (!isSubmittingFinal) setIsSubmitModalOpen(false); }}
                    size="md"
                    title={round > 1 ? 'Kirim Hasil Telaah Ulang' : 'Selesaikan Validasi Bank Soal'}
                    subtitle="Rekomendasi dikirim kepada proktor dan guru pembuat soal."
                    icon={<ShieldCheck size={20} />}
                >
                    <ModalBody className="space-y-4">
                        <div className="space-y-2">
                            <p className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                                Rekomendasi Kelayakan Bank Soal:
                            </p>
                            <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Rekomendasi kelayakan">
                                {RECOMMENDATIONS.map(rec => (
                                    <button
                                        key={rec.id}
                                        type="button"
                                        role="radio"
                                        aria-checked={generalRec === rec.id}
                                        onClick={() => { setGeneralRec(rec.id); setSubmitError(null); }}
                                        className={`p-2.5 rounded-xl text-xs font-bold border text-center transition-all ${
                                            generalRec === rec.id
                                                ? rec.active
                                                : 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                                        }`}
                                    >
                                        {rec.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {(unreviewedCount > 0 || contradiction || pendingVerification.length > 0) && (
                            <ul className="space-y-1.5 rounded-xl border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-950/30 p-3 text-xs text-amber-800 dark:text-amber-300 list-disc pl-6">
                                {unreviewedCount > 0 && <li>{unreviewedCount} dari {questions.length} butir belum Anda nilai atau beri catatan.</li>}
                                {contradiction && <li>{contradiction}</li>}
                                {pendingVerification.length > 0 && <li>{pendingVerification.length} perbaikan dari putaran sebelumnya belum dinilai; hasil belum dapat dikirim sebelum semuanya dinilai.</li>}
                            </ul>
                        )}

                        <div>
                            <label htmlFor="validation-general-comment" className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5">
                                Catatan Umum / Kesimpulan Akhir:
                            </label>
                            <textarea
                                id="validation-general-comment"
                                rows={4}
                                value={generalComment}
                                onChange={e => setGeneralComment(e.target.value)}
                                placeholder="Contoh: Secara umum naskah soal sudah baik dan sesuai kisi-kisi, hanya perlu sedikit perbaikan redaksi rumus pada nomor 12 dan 18."
                                className="w-full p-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-medium outline-none focus:ring-2 focus:ring-primary/20"
                            />
                        </div>
                        {submitError && (
                            <p role="alert" className="text-xs text-red-600">{submitError}</p>
                        )}
                    </ModalBody>
                    <ModalFooter align="between">
                        <Button
                            variant="ghost"
                            onClick={() => setIsSubmitModalOpen(false)}
                            disabled={isSubmittingFinal}
                        >
                            Batal
                        </Button>
                        <Button
                            onClick={handleFinalSubmit}
                            disabled={isSubmittingFinal || !generalRec}
                            className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs flex items-center gap-1.5"
                        >
                            {isSubmittingFinal ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                            Kirim Hasil Validasi
                        </Button>
                    </ModalFooter>
                </Modal>
            )}
        </div>
    );
}
