"use client";
import './question-editor-dark.css';
import { hasQuestionContent } from '@/lib/question-content';
import { getInstructionsByBank,getStimuliByBank,QuestionType,saveQuestionAction } from '@/lib/api/questions';
import { useToast } from '@/app/components/ui/Toast';
import InlineSelect from '@/components/ui/InlineSelect';
import type { BankTextItem,DimensionItem,KisiKisiItem,QuestionMetadata,QuestionOptionDraft,QuestionRecord } from '@/lib/api/questions';
import type { ProctorOrganization } from '@/lib/api/proctor';
import { uploadToHosting } from '@/lib/uploader';
import { confirmDialog } from '@/lib/confirm-dialog';
import { AnimatePresence,motion } from 'framer-motion';
import {
AlertCircle,
ArrowRightLeft,
ArrowUpDown,BarChartHorizontal,
BookOpen,
CheckCircle2,
CheckSquare,
ChevronDown,
ChevronLeft,ChevronRight,
Columns,
Edit3,
Eye,
FileQuestion,
FileSearch,
GitCompare,
Layers,
ListChecks,
ListOrdered,
Loader2,
Plus,
Save,
Scale,
Target,
ToggleLeft,
X
} from 'lucide-react';
import React,{ Dispatch,SetStateAction,useEffect,useState } from 'react';
import { ValidationNotesPanel } from './ValidationNotesPanel';
import { LatexRenderer } from './LatexRenderer';
import { MathToolbar } from './MathToolbar';
import { TipTapEditor } from './TipTapEditor';
import { CategorizationForm } from './forms/CategorizationForm';
import { ChecklistForm } from './forms/ChecklistForm';
import { EssayForm } from './forms/EssayForm';
import { ForcedChoiceForm } from './forms/ForcedChoiceForm';
import { LikertForm } from './forms/LikertForm';
import { MCQForm } from './forms/MCQForm';
import { MatchingForm } from './forms/MatchingForm';
import { OrderingForm } from './forms/OrderingForm';
import { PairedComparisonForm } from './forms/PairedComparisonForm';
import { RankingForm } from './forms/RankingForm';
import { SJTForm } from './forms/SJTForm';
import { ShortAnswerForm } from './forms/ShortAnswerForm';
import { TrueFalseForm } from './forms/TrueFalseForm';

interface QuestionEditorModalProps {
    isOpen: boolean;
    onClose: () => void;
    editingQuestion: QuestionRecord | null;
    bankId: string;
    org: ProctorOrganization | null;
    onSaveSuccess: () => Promise<void>;
    /* In-editor question navigation (save current, then move to sibling). */
    onNavigate?: (dir: 'prev' | 'next') => void;
    editorIndex?: number;
    editorTotal?: number;
    handleOpenPreview: (tempQ: QuestionRecord) => void;
    setIsEquationBuilderOpen: (open: boolean) => void;
    setIsSymbolPickerOpen: (open: boolean) => void;
    setIsTableConfigOpen: (open: boolean) => void;
    setQuillInstance: (quill: unknown) => void;
    questionText: string;
    setQuestionText: (text: string) => void;
    options: QuestionOptionDraft[];
    setOptions: (options: QuestionOptionDraft[]) => void;
    selectedType: QuestionType;
    setSelectedType: (type: QuestionType) => void;
    scoreDefault: number;
    setScoreDefault: (score: number) => void;
    metadata: QuestionMetadata;
    setMetadata: (meta: QuestionMetadata) => void;
    categories: string[];
    setCategories: (cats: string[]) => void;
    kisiKisi: string;
    setKisiKisi: (kisi: string) => void;
    isSubmitting: boolean;
    setIsSubmitting: (sub: boolean) => void;
    setIsCropperOpen: (open: boolean) => void;
    setImageToCrop: (src: string | null) => void;
    setCropperContext: (ctx: { type: 'question' | 'option'; index?: number }) => void;
    pembahasan: string;
    setPembahasan: Dispatch<SetStateAction<string>>;
    pembLatexInput: string;
    setPembLatexInput: Dispatch<SetStateAction<string>>;
    onInsertPembMath: (latex: string) => void;
    openMathBuilder: boolean;
    setOpenMathBuilder: (open: boolean) => void;
    stimulusId: string | null;
    setStimulusId: Dispatch<SetStateAction<string | null>>;
    instructionId: string | null;
    setInstructionId: Dispatch<SetStateAction<string | null>>;
    dimensionId: string | null;
    setDimensionId: Dispatch<SetStateAction<string | null>>;
    dimensions: DimensionItem[];
    kisiKisiId: string | null;
    setKisiKisiId: Dispatch<SetStateAction<string | null>>;
    kisiKisiList: KisiKisiItem[];
    isBulkImportPreview?: boolean;
}

export const QUESTION_TYPES = [
    // Pengetahuan
    { value: 'mcq', label: 'PG', icon: ListChecks, description: 'Siswa akan diminta untuk memilih satu jawaban yang paling tepat dari beberapa pilihan yang tersedia.', category: 'Knowledge' },
    { value: 'mcq_complex', label: 'PGK', icon: CheckCircle2, description: 'Siswa dapat memilih lebih dari satu jawaban yang benar dari pilihan yang tersedia.', category: 'Knowledge' },
    { value: 'true_false', label: 'Benar/Salah', icon: ToggleLeft, description: 'Siswa akan menentukan apakah suatu pernyataan bernilai Benar atau Salah.', category: 'Knowledge' },
    { value: 'matching', label: 'Menjodohkan', icon: ArrowRightLeft, description: 'Siswa akan menjodohkan atau memasangkan pernyataan di kolom kiri dengan jawaban yang tepat di kolom kanan.', category: 'Knowledge' },
    { value: 'categorization', label: 'Kategorisasi', icon: Layers, description: 'Siswa akan mengelompokkan beberapa item atau pernyataan ke dalam kategori yang telah ditentukan.', category: 'Knowledge' },
    { value: 'ordering', label: 'Pengurutan', icon: ArrowUpDown, description: 'Siswa akan diminta untuk menyusun pernyataan-pernyataan ke dalam urutan yang benar.', category: 'Knowledge' },
    { value: 'short_answer', label: 'Isian Singkat', icon: Edit3, description: 'Siswa harus mengisi bagian yang kosong dengan jawaban singkat yang tepat.', category: 'Knowledge' },
    { value: 'essay', label: 'Esai', icon: FileQuestion, description: 'Siswa akan menjawab pertanyaan secara bebas dengan bentuk teks atau uraian panjang.', category: 'Knowledge' },
    // Kepribadian
    { value: 'sjt', label: 'Situasional', icon: Scale, description: 'Siswa akan dihadapkan pada skenario tertentu dan harus merespons. Setiap opsi jawaban memiliki bobot poin yang berbeda terhadap suatu dimensi karakter.', category: 'Personality' },
    { value: 'likert', label: 'Skala Likert (1–5)', icon: BarChartHorizontal, description: 'Opsi jawaban otomatis dibuat dari skala 1 (Sangat Tidak Setuju) hingga 5 (Sangat Setuju). Pastikan Anda telah memilih Dimensi yang Diukur di panel sebelah kiri.', category: 'Personality' },
    { value: 'forced_choice', label: 'Pilihan Paksa', icon: Columns, description: 'Siswa akan diminta untuk memilih salah satu opsi pernyataan yang paling sesuai dengan diri mereka. Setiap pernyataan mewakili satu dimensi karakter yang berbeda.', category: 'Personality' },
    { value: 'checklist', label: 'Ceklis (Ya/Tidak)', icon: CheckSquare, description: 'Siswa akan disajikan daftar pernyataan dan mereka harus mencentang pernyataan yang sesuai dengan diri mereka. Setiap pernyataan dapat mengukur dimensi karakter yang berbeda.', category: 'Personality' },
    { value: 'ranking', label: 'Pemeringkatan', icon: ListOrdered, description: 'Tes pemeringkatan: siswa mengurutkan pernyataan dari yang paling sesuai (peringkat 1) hingga yang paling tidak sesuai. Sistem memberi poin berdasarkan urutan ke dimensi karakter tiap pernyataan. Disarankan 4 pernyataan.', category: 'Personality' },
    { value: 'paired_comparison', label: 'Perbandingan Berpasangan', icon: GitCompare, description: 'Siswa akan dihadapkan pada dua pilihan pernyataan (A dan B) dan harus memilih salah satu yang paling mendekati dirinya. Pastikan kedua pernyataan mengukur dimensi karakter yang saling berbeda.', category: 'Personality' },
];

export default function QuestionEditorModal({
    onClose,
    editingQuestion,
    bankId,
    org,
    onSaveSuccess,
    onNavigate,
    editorIndex,
    editorTotal,
    handleOpenPreview,
    questionText,
    setQuestionText,
    options,
    setOptions,
    selectedType,
    setSelectedType,
    scoreDefault,
    setScoreDefault,
    metadata,
    setMetadata,
    categories,
    setCategories,
    kisiKisi,
    isSubmitting,
    setIsSubmitting,
    pembahasan,
    stimulusId,
    setStimulusId,
    instructionId,
    setInstructionId,
    dimensionId,
    setDimensionId,
    dimensions,
    kisiKisiId,
    setKisiKisiId,
    kisiKisiList,
    isBulkImportPreview
}: QuestionEditorModalProps) {
    const toast = useToast();
    useEffect(() => {
        const scrollY = window.scrollY;
        document.documentElement.classList.add('scroll-locked', 'cbt-editor-open');
        document.body.classList.add('scroll-locked', 'cbt-editor-open');
        document.body.dataset.scrollY = String(scrollY);
        return () => {
            const sy = parseInt(document.body.dataset.scrollY || '0');
            document.body.classList.remove('scroll-locked', 'cbt-editor-open');
            document.documentElement.classList.remove('scroll-locked', 'cbt-editor-open');
            delete document.body.dataset.scrollY;
            window.scrollTo(0, sy);
        };
    }, []);

    const [stimuliList, setStimuliList] = useState<BankTextItem[]>([]);
    const [instructionsList, setInstructionsList] = useState<BankTextItem[]>([]);

    useEffect(() => {
        getStimuliByBank(bankId).then(data => {
            setStimuliList(data || []);
        });
        getInstructionsByBank(bankId).then(data => {
            setInstructionsList(data || []);
        });
    }, [bankId]);

    const [typeTab, setTypeTab] = useState<'knowledge' | 'personality'>(
        ['sjt', 'likert', 'forced_choice', 'checklist', 'ranking', 'paired_comparison'].includes(selectedType) ? 'personality' : 'knowledge'
    );

    const [validationErrors, setValidationErrors] = useState<string[]>([]);
    const [validatedContent, setValidatedContent] = useState('');
    const currentContent = JSON.stringify([questionText, options, selectedType, metadata]);
    const [isMobileSettingsOpen, setIsMobileSettingsOpen] = useState(false);

    const [latexEditorOpen, setLatexEditorOpen] = useState(false);
    const [latexEditorOptIdx, setLatexEditorOptIdx] = useState<number | null>(null);
    const [latexEditorValue, setLatexEditorValue] = useState('');
    const [latexModeQuill, setLatexModeQuill] = useState(false);

    const [tableDialogOpen, setTableDialogOpen] = useState(false);
    const [tableRows, setTableRows] = useState(2);
    const [tableCols, setTableCols] = useState(2);


    const closeLatexEditor = () => {
        setLatexEditorOpen(false);
        setLatexEditorOptIdx(null);
        setLatexModeQuill(false);
        setLatexEditorValue('');
    };

    const saveLatexToOption = () => {
        if (latexEditorOptIdx === -1) {
            // Insert math node into question text
            const latex = latexEditorValue.trim();
            if (latex) {
                const safe = latex.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
                const mathNode = `<span class="math-node" data-latex="${safe}">&nbsp;</span>`;
                setQuestionText(questionText + mathNode);
            }
        } else if (latexEditorOptIdx !== null) {
            updateOption(latexEditorOptIdx, { text: latexEditorValue });
        }
        closeLatexEditor();
    };

    const isEmptyHtml = (text: string) => {
        return !hasQuestionContent(text);
    };

    const validateQuestion = (): boolean => {
        setValidatedContent(currentContent);
        const errors: string[] = [];

        if (isEmptyHtml(questionText)) {
            errors.push('Pertanyaan tidak boleh kosong');
        }

        if (selectedType === 'mcq' || selectedType === 'mcq_complex') {
            const emptyOptions = options.filter(o => isEmptyHtml(o.text));
            if (emptyOptions.length > 0) {
                errors.push('Semua opsi jawaban harus diisi');
            }
            const hasCorrect = options.some(o => o.isCorrect === true);
            if (!hasCorrect) {
                errors.push('Pilih jawaban yang benar');
            }
        }

        // Esai multi-topik tanpa satu pun topik = soal buntu: siswa wajib
        // memilih topik dulu, padahal tidak ada yang bisa dipilih.
        if (selectedType === 'essay' && metadata?.is_multi_topic) {
            const validTopics = options.filter(o => !isEmptyHtml(o.text));
            if (validTopics.length === 0) {
                errors.push('Tambahkan minimal satu topik, atau matikan opsi "Jadikan Multi-Topik"');
            }
        }

        if (selectedType === 'true_false') {
            const emptyOptions = options.filter(o => isEmptyHtml(o.text));
            if (emptyOptions.length > 0) {
                errors.push('Semua pernyataan harus diisi');
            }
            if (options.some(o => o.isCorrect === undefined || o.isCorrect === null)) {
                errors.push('Tentukan jawaban benar untuk setiap pernyataan');
            }
        }

        if (selectedType === 'matching') {
            const emptyLeft = options.filter(o => isEmptyHtml(o.text));
            if (emptyLeft.length > 0) {
                errors.push('Semua item di kolom kiri harus diisi');
            }
            const emptyRight = (metadata.right_items || []).filter((r: string) => isEmptyHtml(r));
            if (emptyRight.length > 0) {
                errors.push('Semua item di kolom kanan harus diisi');
            }
            const unmatchedLeft = options.filter(o =>
                !o.match_texts || o.match_texts.length === 0 || o.match_texts.every((m: string) => !m || m.trim() === '')
            );
            if (unmatchedLeft.length > 0) {
                errors.push('Setiap item kiri harus dipasangkan dengan jawaban');
            }
        }

        if (selectedType === 'categorization') {
            const emptyItems = options.filter(o => isEmptyHtml(o.text));
            if (emptyItems.length > 0) {
                errors.push('Semua item harus diisi');
            }
            const uncategorized = options.filter(o =>
                !o.category_names || o.category_names.length === 0 || !o.category_names[0]
            );
            if (uncategorized.length > 0) {
                errors.push('Pilih kategori untuk setiap item');
            }
        }

        if (selectedType === 'short_answer') {
            const blankCountInText = (questionText.match(/\.{4,}/g) || []).length;
            const activeBlanksCount = Math.max(1, blankCountInText);
            const blanks = metadata.blanks || [];
            const activeBlanks = blanks.slice(0, activeBlanksCount);
            const emptyBlanks = activeBlanks.filter((b) => !b.answer || b.answer.trim() === '');
            if (emptyBlanks.length > 0) {
                errors.push('Semua jawaban benar harus diisi');
            }
        }

        if (!scoreDefault || scoreDefault <= 0) {
            errors.push('Poin harus lebih dari 0');
        }

        setValidationErrors(errors);
        return errors.length === 0;
    };

    const handleSave = (e: React.FormEvent) => {
        e.preventDefault();
        doSave('close');
    };

    /** Isi soal persis seperti yang akan dikirim ke server. */
    const buildPayload = () => ({
            id: editingQuestion?.id,
            expectedRevision: editingQuestion?.revision,
            bankId: bankId,
            type: selectedType,
            questionText,
            // Editor tidak punya pilihan tingkat kesulitan: pertahankan nilai asli
            // (mis. dari impor), jangan ditimpa "sedang" setiap kali disunting.
            difficulty: editingQuestion?.difficulty || 'medium',
            scoreDefault: scoreDefault,
            stimulusId: stimulusId || null,
            instructionId: instructionId || null,
            dimensionId: dimensionId || null,
            // Dulu tidak dikirim, sehingga pilihan kisi-kisi di editor tidak pernah
            // tersimpan dan tautan kisi-kisi hasil impor terhapus saat disunting.
            kisi_kisi_id: kisiKisiId || null,
            metadata: {
                ...metadata,
                categories: selectedType === 'categorization' ? categories : [],
                blanks: selectedType === 'short_answer' 
                    ? (metadata.blanks || []).slice(0, Math.max(1, (questionText.match(/\.{4,}/g) || []).length)) 
                    : metadata.blanks,
                kisi_kisi: kisiKisi,
                pembahasan: pembahasan
            },
            // Esai multi-topik menyimpan daftar topiknya sebagai options. Dulu
            // seluruh tipe 'essay' selalu mengirim [] sehingga topik yang sudah
            // diisi guru terbuang diam-diam, dan siswa mendapat soal tanpa
            // satu pun kolom jawaban.
            options: (selectedType === 'short_answer' || (selectedType === 'essay' && !metadata?.is_multi_topic)) ? [] : options.map((opt, i) => ({
                id: opt.id,
                text: opt.text,
                isCorrect: opt.isCorrect,
                order: i,
                weight: ['sjt', 'likert', 'forced_choice', 'checklist', 'ranking', 'paired_comparison'].includes(selectedType) ? (opt.weight ?? 0) : 1,
                // Pertahankan metadata opsi lain (mis. dari impor/transfer bank);
                // hanya tiga kunci yang dikelola editor ini yang ditulis ulang.
                metadata: {
                    ...(opt.metadata || {}),
                    match_texts: opt.match_texts || [],
                    category_names: opt.category_names || [],
                    dimension_id: opt.dimension_id || null
                }
            }))
    });

    // Isi awal soal yang sedang dibuka. Dipakai untuk melewati penyimpanan
    // tanpa perubahan dan untuk memperingatkan perubahan yang belum disimpan.
    // Dikunci per soal + revisi: saat berpindah soal, render pertama belum
    // punya catatan soal baru dan tidak boleh dianggap "berubah".
    const editorKey = `${editingQuestion?.id ?? 'new'}:${editingQuestion?.revision ?? ''}`;
    const serializedPayload = JSON.stringify(buildPayload());
    const [initialPayload, setInitialPayload] = useState(() => ({ key: editorKey, payload: serializedPayload }));
    if (initialPayload.key !== editorKey) {
        // Pola resmi React untuk menyesuaikan state saat prop berubah.
        setInitialPayload({ key: editorKey, payload: serializedPayload });
    }
    const isDirty = initialPayload.key === editorKey && serializedPayload !== initialPayload.payload;

    useEffect(() => {
        if (!isDirty) return;
        const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
        window.addEventListener('beforeunload', warn);
        return () => window.removeEventListener('beforeunload', warn);
    }, [isDirty]);

    const handleClose = async () => {
        if (isSubmitting) return;
        if (isDirty && !await confirmDialog({
            title: 'Tutup tanpa menyimpan?',
            text: 'Perubahan pada soal ini belum disimpan dan akan hilang.',
            confirmText: 'Tutup tanpa menyimpan',
            cancelText: 'Kembali mengedit',
            variant: 'warning',
        })) return;
        onClose();
    };

    const doSave = async (afterSave: 'close' | 'prev' | 'next' = 'close') => {
        // Soal lama yang tidak diubah tidak dikirim ulang. Dulu tombol
        // Sebelumnya/Berikutnya selalu menyimpan: revisi naik, ujian yang sedang
        // berjalan menerima "soal diperbarui oleh guru" walau isinya sama, dan
        // soal yang belum valid menghalangi guru sekadar menelusuri bank.
        if (editingQuestion?.id && !isDirty) {
            if ((afterSave === 'prev' || afterSave === 'next') && onNavigate) onNavigate(afterSave);
            else onClose();
            return;
        }
        if (!validateQuestion()) return;
        if (!org) {
            alert('Sekolah belum dikonfigurasi');
            return;
        }
        setIsSubmitting(true);

        const result = await saveQuestionAction(buildPayload());

        if (result.success) {
            if (result.updatedExams > 0) {
                toast.success('Revisi soal tersimpan', `Diterapkan ke ${result.updatedExams} ujian yang belum selesai. Halaman siswa akan menerima pembaruan; perubahan kunci diproses untuk penilaian ulang otomatis.`);
            }
            if ((afterSave === 'prev' || afterSave === 'next') && onNavigate) {
                // Keep the editor open and jump to the adjacent question.
                await onSaveSuccess();
                onNavigate(afterSave);
            } else {
                onClose();
                await onSaveSuccess();
            }
        } else {
            alert('Gagal menyimpan soal: ' + result.error);
        }
        setIsSubmitting(false);
    };

    const addOption = () => setOptions([...options, { text: '', isCorrect: false, order: options.length, weight: 0, match_texts: [], category_names: [] }]);
    const removeOption = (idx: number) => setOptions(options.filter((_, i) => i !== idx));
    const updateOption = (idx: number, fields: Partial<QuestionOptionDraft>) => {
        const newOpts = [...options];
        newOpts[idx] = { ...newOpts[idx], ...fields };
        setOptions(newOpts);
    };

    const addRightItem = () => {
        setMetadata({
            ...metadata,
            right_items: [...(metadata.right_items || []), '']
        });
    };

    const removeRightItem = (idx: number) => {
        setMetadata({
            ...metadata,
            right_items: (metadata.right_items || []).filter((_, i) => i !== idx)
        });
    };

    const updateRightItem = (idx: number, value: string) => {
        const newItems = [...(metadata.right_items || [])];
        newItems[idx] = value;
        setMetadata({ ...metadata, right_items: newItems });
    };

    const selectedTypeInfo = QUESTION_TYPES.find(t => t.value === selectedType) || QUESTION_TYPES[0];

    return (
        <div className="fixed inset-0 z-[9999] flex flex-col bg-slate-50 overflow-hidden font-sans">

            {/* ── Header ── */}
            <header className="shrink-0 z-20 bg-white border-b border-slate-100">
                <div className="px-3 sm:px-6 py-2.5 sm:py-4">
                    <div className="flex items-center justify-between gap-2">
                        {/* Left Group */}
                        <div className="flex items-center gap-2 sm:gap-4 min-w-0">
                            {/* Close Button */}
                            <button
                                onClick={() => void handleClose()}
                                className="w-8 h-8 sm:w-9 sm:h-9 flex items-center justify-center rounded-lg hover:bg-slate-100 transition-all shrink-0"
                                title="Tutup / Batal"
                            >
                                <X size={17} className="text-slate-500" />
                            </button>

                            {/* Desktop Pen Icon */}
                            <div className="hidden sm:flex w-9 h-9 rounded-lg bg-slate-800 items-center justify-center shrink-0">
                                <Edit3 size={15} className="text-white" />
                            </div>

                            {/* Title (Prevents multi-word wrap) */}
                            <div className="min-w-0">
                                <h2 className="text-xs sm:text-sm font-bold text-slate-800 leading-tight whitespace-nowrap truncate">
                                    {editingQuestion ? 'Edit Soal' : 'Soal Baru'}
                                </h2>
                                <p className="hidden sm:block text-[11px] text-slate-400 leading-tight whitespace-nowrap">Bank Soal CBT</p>
                            </div>

                            {/* Prev / Next question navigation */}
                            {onNavigate && editingQuestion && typeof editorIndex === 'number' && editorIndex >= 0 && (editorTotal ?? 0) > 1 && (
                                <div className="flex items-center gap-0.5 sm:gap-1 pl-1.5 sm:pl-3 sm:ml-1 border-l border-slate-200 shrink-0">
                                    <button
                                        type="button"
                                        onClick={() => doSave('prev')}
                                        disabled={isSubmitting || editorIndex <= 0}
                                        title="Simpan & soal sebelumnya"
                                        className="w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-100 hover:text-slate-700 transition-all disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
                                    >
                                        <ChevronLeft size={14} className="sm:w-4 sm:h-4" />
                                    </button>
                                    <span className="text-[10px] sm:text-[11px] font-semibold text-slate-600 tabular-nums px-1 whitespace-nowrap select-none">
                                        <span className="hidden sm:inline">Soal </span>{editorIndex + 1}/{editorTotal}
                                    </span>
                                    <button
                                        type="button"
                                        onClick={() => doSave('next')}
                                        disabled={isSubmitting || editorIndex >= (editorTotal ?? 0) - 1}
                                        title="Simpan & soal berikutnya"
                                        className="w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-100 hover:text-slate-700 transition-all disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
                                    >
                                        <ChevronRight size={14} className="sm:w-4 sm:h-4" />
                                    </button>
                                </div>
                            )}
                        </div>

                        {/* Right Group */}
                        <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
                            <button
                                onClick={() => {
                                    const tempQ = {
                                        id: editingQuestion?.id || 'preview',
                                        type: selectedType,
                                        question_text: questionText,
                                        score_default: scoreDefault,
                                        metadata: { ...metadata, categories },
                                        stimulus_id: stimulusId,
                                        instruction_id: instructionId,
                                        kisi_kisi_id: kisiKisiId,
                                        stimulus: stimuliList.find(s => s.id === stimulusId),
                                        instruction: instructionsList.find(i => i.id === instructionId),
                                        bank_question_options: options.map((opt, i) => ({
                                            id: opt.id || `temp-${i}`,
                                            option_text: opt.text,
                                            is_correct: opt.isCorrect,
                                            order: i,
                                            metadata: {
                                                match_texts: opt.match_texts || [],
                                                category_names: opt.category_names || []
                                            }
                                        }))
                                    };
                                    handleOpenPreview(tempQ);
                                }}
                                title="Pratinjau Soal"
                                className="w-8 h-8 sm:w-auto flex items-center justify-center gap-1.5 sm:gap-2 sm:px-3 sm:py-2 text-xs sm:text-sm font-medium border border-slate-200 rounded-lg bg-white text-slate-600 hover:bg-slate-50 transition-all shrink-0"
                            >
                                <Eye size={15} />
                                <span className="hidden sm:inline">Pratinjau</span>
                            </button>
                            <button
                                onClick={handleSave}
                                disabled={isSubmitting}
                                className="flex items-center justify-center gap-1 sm:gap-2 px-3 py-1.5 sm:px-5 sm:py-2 text-xs sm:text-sm font-semibold bg-[#3083FF] text-white rounded-lg hover:bg-[#256fe0] shadow-sm transition-all disabled:opacity-50 shrink-0"
                            >
                                {isSubmitting ? (
                                    <>
                                        <Loader2 size={14} className="animate-spin" />
                                        <span className="hidden sm:inline">Menyimpan...</span>
                                        <span className="sm:hidden">...</span>
                                    </>
                                ) : (
                                    <>
                                        <Save size={14} />
                                        <span>Simpan</span>
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            </header>

            {/* ── Validation Errors ── */}
            <AnimatePresence>
                {validationErrors.length > 0 && validatedContent === currentContent && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="bg-rose-50 border-b border-rose-100 shrink-0 overflow-hidden"
                    >
                        <div className="px-6 py-3 flex items-start gap-3">
                            <AlertCircle size={15} className="text-rose-500 shrink-0 mt-0.5" />
                            <div className="flex flex-wrap gap-2">
                                {validationErrors.map((error, idx) => (
                                    <span key={idx} className="text-xs text-rose-600 font-medium">• {error}</span>
                                ))}
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* ── Body ── */}
            <div className="flex-1 flex flex-col xl:flex-row overflow-y-auto xl:overflow-hidden">
                {/* Sidebar */}
                <aside className="w-full xl:w-64 shrink-0 bg-white border-b xl:border-b-0 xl:border-r border-slate-100 flex flex-col xl:overflow-hidden">
                    {/* Mobile Settings Header & Quick Summary Pill */}
                    <div
                        className="px-4 py-3 md:px-5 md:pt-5 md:pb-4 border-b border-slate-100 flex items-center justify-between cursor-pointer md:cursor-default bg-slate-50/60 md:bg-white select-none transition-colors"
                        onClick={() => setIsMobileSettingsOpen(!isMobileSettingsOpen)}
                    >
                        <div className="flex items-center gap-2 min-w-0">
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest shrink-0">Pengaturan Soal</p>
                            {/* Summary Pills on Mobile when collapsed */}
                            <div className="flex md:hidden items-center gap-1.5 overflow-hidden text-ellipsis">
                                <span className="text-[10px] font-semibold bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full shrink-0">
                                    {selectedTypeInfo.label}
                                </span>
                                {typeTab === 'knowledge' && (
                                    <span className="text-[10px] font-medium bg-slate-200 text-slate-700 px-1.5 py-0.5 rounded-full shrink-0">
                                        {scoreDefault} pts
                                    </span>
                                )}
                            </div>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                            <span className="text-[11px] font-semibold text-primary md:hidden">
                                {isMobileSettingsOpen ? 'Tutup' : 'Ubah'}
                            </span>
                            <ChevronDown
                                size={14}
                                className={`text-slate-400 md:hidden transition-transform duration-200 ${isMobileSettingsOpen ? 'rotate-180 text-primary' : ''}`}
                            />
                        </div>
                    </div>
                    <div id="mobile-sidebar-content" className={`${isMobileSettingsOpen ? 'flex' : 'hidden'} md:flex md:flex-1 flex-col overflow-y-visible md:overflow-y-auto bg-white p-4 md:p-0 border-b md:border-b-0 border-slate-200 transition-all`}>

                        {/* ── Tab Switcher: Pengetahuan / Kepribadian ── */}
                        <div className="flex bg-slate-100 p-1 rounded-xl mb-4">
                            {(['knowledge', 'personality'] as const).map(tab => (
                                <button
                                    key={tab}
                                    onClick={() => {
                                        setTypeTab(tab);
                                        // Auto-switch to first type in that category when tab changes
                                        const firstOfCategory = QUESTION_TYPES.find(t => t.category.toLowerCase() === tab);
                                        if (firstOfCategory && firstOfCategory.category.toLowerCase() !== selectedTypeInfo.category.toLowerCase()) {
                                            setSelectedType(firstOfCategory.value as QuestionType);
                                        }
                                    }}
                                    className={`flex-1 py-2.5 text-[11px] font-black uppercase tracking-widest transition-all border-b-2 ${
                                        typeTab === tab
                                            ? tab === 'knowledge'
                                                ? 'text-blue-600 border-blue-500'
                                                : 'text-indigo-600 border-indigo-500'
                                            : 'text-slate-400 border-transparent hover:text-slate-600'
                                    }`}
                                >
                                    {tab === 'knowledge' ? 'Pengetahuan' : 'Kepribadian'}
                                </button>
                            ))}
                        </div>

                        <div className="p-5 space-y-5 md:space-y-6 flex-1">

                        {/* ── Jenis Soal dropdown (tab-filtered) ── */}
                        <div className="space-y-2">
                            <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest">Jenis Soal</label>
                            <InlineSelect
                                value={selectedType}
                                onChange={(value) => {
                                    const nextType = value as QuestionType;
                                    setSelectedType(nextType);
                                    if (nextType === 'true_false') {
                                        const looksLikeTrueFalse = options.length >= 2
                                            && options.every(option => typeof option.isCorrect === 'boolean');
                                        if (!looksLikeTrueFalse) {
                                            setOptions([
                                                { text: '', isCorrect: true, order: 0, weight: 1, match_texts: [], category_names: [] },
                                                { text: '', isCorrect: false, order: 1, weight: 0, match_texts: [], category_names: [] },
                                            ]);
                                        }
                                    }
                                }}
                                options={QUESTION_TYPES
                                    .filter(type => type.category.toLowerCase() === typeTab)
                                    .map(({ value, label }) => ({ value, label }))}
                                minWidth="0"
                                height="44px"
                                className="w-full"
                            />
                            {selectedType === 'paired_comparison' && (
                                <p className="text-xs font-medium leading-tight text-slate-600">
                                    Perbandingan<br />Berpasangan
                                </p>
                            )}
                        </div>

                        {/* ── KNOWLEDGE ONLY: Poin (di atas Stimulus) ── */}
                        {typeTab === 'knowledge' && (
                            <div className="space-y-2">
                                <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest">Poin</label>
                                <div className="relative">
                                    <input
                                        type="number"
                                        value={isNaN(scoreDefault) ? '' : scoreDefault}
                                        onChange={(e) => {
                                            const val = Number(e.target.value);
                                            setScoreDefault(isNaN(val) ? 0 : val);
                                        }}
                                        className="w-full pl-4 pr-10 py-2.5 text-sm bg-white border border-slate-200 rounded-lg text-slate-700 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-100 transition-all"
                                    />
                                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs text-slate-400">pts</span>
                                </div>
                            </div>
                        )}

                        {/* ── Stimulus (both) ── */}
                        <div className="space-y-1.5">
                            <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest flex items-center gap-1.5"><BookOpen size={11}/> Stimulus</label>
                            <InlineSelect
                                value={stimulusId || ''}
                                onChange={(value) => setStimulusId(value || null)}
                                options={[
                                    { value: '', label: '-- Tanpa Stimulus --' },
                                    ...(isBulkImportPreview && metadata?.import_stimulus
                                        ? [{
                                            value: editingQuestion?.stimulus_id || 'imported',
                                            label: metadata?._stimulus_code ? `[${metadata._stimulus_code}] Akan diimport` : 'Akan diimport',
                                            disabled: true,
                                        }]
                                        : []),
                                    ...stimuliList.map((stimulus) => ({ value: stimulus.id, label: stimulus.title || 'Stimulus' })),
                                ]}
                                minWidth="0"
                                height="42px"
                                className="w-full"
                                disabled={isBulkImportPreview}
                            />
                        </div>

                        {/* ── Grup Soal (both) ── */}
                        <div className="space-y-1.5">
                            <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest flex items-center gap-1.5"><Layers size={11}/> Grup Soal</label>
                            <input
                                type="text"
                                value={typeof metadata?.group_key === 'string' ? metadata.group_key : ''}
                                onChange={(e) => {
                                    const value = e.target.value.slice(0, 50);
                                    const next = { ...metadata };
                                    if (value.trim()) next.group_key = value;
                                    else delete next.group_key;
                                    setMetadata(next);
                                }}
                                placeholder={stimulusId ? 'Otomatis: grup stimulus' : 'Mis. A, Soal-5'}
                                className="w-full px-4 py-2.5 text-sm bg-white border border-slate-200 rounded-lg text-slate-700 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-100 transition-all"
                            />
                            <p className="text-[10px] leading-snug text-slate-400">
                                Soal dengan grup (atau stimulus) yang sama tetap berdampingan saat diacak; urutan di dalam grup ikut diacak.
                            </p>
                        </div>

                        {/* ── Petunjuk (both) ── */}
                        <div className="space-y-1.5">
                            <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest flex items-center gap-1.5"><Eye size={11}/> Petunjuk Pengerjaan</label>
                            <InlineSelect
                                value={instructionId || ''}
                                onChange={(value) => setInstructionId(value || null)}
                                options={[
                                    { value: '', label: '-- Tanpa Petunjuk --' },
                                    ...(isBulkImportPreview && metadata?.import_instruction
                                        ? [{
                                            value: editingQuestion?.instruction_id || 'imported',
                                            label: metadata?._instruction_code ? `[${metadata._instruction_code}] Akan diimport` : 'Akan diimport',
                                            disabled: true,
                                        }]
                                        : []),
                                    ...instructionsList.map((instruction) => ({ value: instruction.id, label: instruction.title || 'Petunjuk' })),
                                ]}
                                minWidth="0"
                                height="42px"
                                className="w-full"
                                disabled={isBulkImportPreview}
                            />
                        </div>

                        {/* ── KNOWLEDGE ONLY: Kisi-kisi ── */}
                        {typeTab === 'knowledge' && (
                            <div className="space-y-2">
                                <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest flex items-center gap-1.5"><FileSearch size={11}/> Kisi-kisi</label>
                                <InlineSelect
                                    value={kisiKisiId || ''}
                                    onChange={(value) => {
                                        if (setKisiKisiId) setKisiKisiId(value || null);
                                    }}
                                    options={[
                                        { value: '', label: '-- Tanpa Kisi-kisi --' },
                                        ...(kisiKisiList || []).map((item) => ({
                                            value: item.id,
                                            label: item.materi || item.indikator_soal || 'Kisi-kisi',
                                        })),
                                    ]}
                                    minWidth="0"
                                    height="42px"
                                    className="w-full"
                                    disabled={isBulkImportPreview}
                                />
                                {(kisiKisiList || []).length === 0 && (
                                    <p className="text-[10px] text-amber-600 bg-amber-50 px-2 py-1.5 rounded-md">⚠️ Belum ada kisi-kisi. Buat kisi-kisi di tab Kisi-kisi Soal.</p>
                                )}
                            </div>
                        )}

                        {/* ── PERSONALITY ONLY: Dimensi (Likert & SJT) ── */}
                        {typeTab === 'personality' && (selectedType === 'likert' || selectedType === 'sjt') && (
                            <div className="space-y-2">
                                <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest flex items-center gap-1.5"><Target size={11}/> Dimensi yang Diukur</label>
                                <InlineSelect
                                    value={dimensionId || ''}
                                    onChange={(value) => {
                                        if (setDimensionId) setDimensionId(value || null);
                                    }}
                                    options={[
                                        { value: '', label: '-- Pilih Dimensi --' },
                                        ...(dimensions || []).map((dimension) => ({
                                            value: dimension.id,
                                            label: dimension.name,
                                        })),
                                    ]}
                                    minWidth="0"
                                    height="42px"
                                    className="w-full"
                                />
                                {dimensions.length === 0 && (
                                    <p className="text-[10px] text-amber-600 bg-amber-50 px-2 py-1.5 rounded-md">⚠️ Belum ada dimensi. Buat dimensi di tab Dimensi bank soal ini.</p>
                                )}
                            </div>
                        )}


                        {/* Mobile Done / Close Settings Button */}
                            <div className="md:hidden pt-3 border-t border-slate-100">
                                <button
                                    type="button"
                                    onClick={() => setIsMobileSettingsOpen(false)}
                                    className="w-full py-2.5 bg-slate-800 text-white font-semibold text-xs rounded-lg hover:bg-slate-700 transition-colors shadow-sm"
                                >
                                    Selesai Mengatur
                                </button>
                            </div>
                        </div>
                    </div>
                </aside>

                {/* Editor */}
                <main className="question-editor-canvas flex-1 min-w-0 overflow-y-visible xl:overflow-y-auto bg-slate-50/50">
                    <div className="max-w-[210mm] mx-auto w-full px-3 sm:px-4 md:px-5 py-6 space-y-5">
                        {/* Card: Pertanyaan */}
                        <div className="bg-white rounded-lg border border-slate-100 shadow-sm overflow-hidden">
                            {/* Question header bar */}
                            <div className="px-5 py-3 border-b border-slate-50 flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <div className="w-6 h-6 bg-blue-100 rounded-lg flex items-center justify-center">
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-blue-600">
                                            <path d="M4 4h6v6H4z"/><path d="M14 4h6v6h-6z"/><path d="M4 14h6v6H4z"/><path d="M17 14v3h3"/>
                                        </svg>
                                    </div>
                                    <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Pertanyaan</span>
                                </div>
                            </div>

                            {/* TipTap Editor */}
                            <TipTapEditor
                                content={questionText}
                                onChange={setQuestionText}
                                placeholder="Tuliskan pertanyaan di sini..."
                                minHeight="180px"
                                onImageUpload={async (file: File) => {
                                    const res = await uploadToHosting(file, 'questions');
                                    if (res.success && res.url) {
                                        return res.url;
                                    }
                                    throw new Error(res.error || 'Gagal mengunggah gambar soal.');
                                }}
                                onAudioUpload={async (file: File) => {
                                    const res = await uploadToHosting(file, 'questions-audio');
                                    if (res.success && res.url) {
                                        return res.url;
                                    }
                                    throw new Error('Audio upload failed');
                                }}
                            />
                        </div>

                        {/* Card: Opsi Jawaban */}
                        <div className="bg-white rounded-lg border border-slate-100 shadow-sm overflow-hidden">
                            <div className="px-6 py-4 border-b border-slate-50 flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <CheckCircle2 size={15} className="text-slate-400" />
                                    <span className="text-sm font-semibold text-slate-700">Opsi Jawaban</span>
                                </div>
                                {(selectedType === 'true_false' || selectedType === 'matching' || selectedType === 'categorization') && (
                                    <button
                                        type="button"
                                        onClick={addOption}
                                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-slate-800 text-white rounded-lg hover:bg-slate-700 transition-colors"
                                    >
                                        <Plus size={13} />
                                        Tambah
                                    </button>
                                )}
                            </div>
                            <div className="p-5">
                                {/* True/False */}
                                {selectedType === 'true_false' && (
                                    <TrueFalseForm
                                        options={options}
                                        onAddOption={addOption}
                                        onInsertOption={() => {}}
                                        onRemoveOption={removeOption}
                                        onUpdateOption={updateOption}
                                    />
                                )}

                                {/* MCQ */}
                                {(selectedType === 'mcq' || selectedType === 'mcq_complex') && (
                                    <MCQForm
                                        options={options}
                                        isComplex={selectedType === 'mcq_complex'}
                                        onAddOption={addOption}
                                        onInsertOption={() => {}}
                                        onRemoveOption={removeOption}
                                        onUpdateOption={updateOption}
                                        onSetAllCorrect={(idx) => {
                                            const newOpts = options.map((o, i) => ({ ...o, isCorrect: i === idx }));
                                            setOptions(newOpts);
                                        }}
                                        onToggleCorrect={(idx) => updateOption(idx, { isCorrect: !options[idx].isCorrect })}
                                    />
                                )}

                                {/* Matching */}
                                {selectedType === 'matching' && (
                                    <MatchingForm
                                        options={options}
                                        rightItems={metadata.right_items || []}
                                        onAddLeftItem={addOption}
                                        onRemoveLeftItem={removeOption}
                                        onUpdateLeftItem={(idx, text) => updateOption(idx, { text })}
                                        onAddRightItem={addRightItem}
                                        onRemoveRightItem={removeRightItem}
                                        onUpdateRightItem={updateRightItem}
                                        onSetLeftMatch={(optIndex, rightTexts) => updateOption(optIndex, { match_texts: rightTexts })}
                                    />
                                )}

                                {/* Categorization */}
                                {selectedType === 'categorization' && (
                                    <CategorizationForm
                                        options={options}
                                        categories={categories}
                                        onAddItem={addOption}
                                        onInsertItem={() => {}}
                                        onRemoveItem={removeOption}
                                        onUpdateItem={(idx, text) => updateOption(idx, { text })}
                                        onSetCategories={setCategories}
                                        onSetItemCategory={(optIndex, cats) => updateOption(optIndex, { category_names: cats })}
                                    />
                                )}

                                {/* Short Answer */}
                                {selectedType === 'short_answer' && (
                                    <ShortAnswerForm
                                        blanks={metadata.blanks || []}
                                        questionText={questionText}
                                        onAddBlank={() => {
                                            const blanks = [...(metadata.blanks || []), { answer: '', variations: [] }];
                                            setMetadata({ ...metadata, blanks });
                                        }}
                                        onRemoveBlank={(idx) => {
                                            const blanks = (metadata.blanks || []).filter((_, i) => i !== idx);
                                            setMetadata({ ...metadata, blanks });
                                        }}
                                        onUpdateBlank={(idx, fields) => {
                                            const blanks = [...(metadata.blanks || [])];
                                            blanks[idx] = { ...blanks[idx], ...fields };
                                            setMetadata({ ...metadata, blanks });
                                        }}
                                    />
                                )}

                                {/* Essay */}
                                {selectedType === 'essay' && (
                                    <div className="space-y-6">
                                        <EssayForm 
                                            metadata={metadata}
                                            onUpdateMetadata={(updates) => setMetadata({ ...metadata, ...updates })}
                                        />
                                        
                                        {metadata?.is_multi_topic && (
                                            <div className="p-5 bg-white rounded-xl border border-slate-200 shadow-sm space-y-4">
                                                <div className="flex items-center justify-between mb-4">
                                                    <div>
                                                        <h3 className="text-sm font-bold text-slate-800">Daftar Topik Tugas</h3>
                                                        <p className="text-[11px] text-slate-500">Tambahkan pilihan topik yang dapat dipilih oleh siswa.</p>
                                                    </div>
                                                    <button 
                                                        onClick={() => addOption()}
                                                        className="px-4 py-2 bg-blue-50 text-blue-600 hover:bg-blue-100 rounded-lg text-xs font-bold transition-colors flex items-center gap-2"
                                                    >
                                                        <span className="text-lg leading-none">+</span> Tambah Topik
                                                    </button>
                                                </div>
                                                
                                                <div className="space-y-3">
                                                    {options.map((opt, idx) => (
                                                        <div key={opt.id || idx} className="flex items-start gap-3 p-3 bg-slate-50 rounded-lg border border-slate-200">
                                                            <div className="mt-2 text-xs font-bold text-slate-400 w-6 text-center">{String.fromCharCode(65 + idx)}</div>
                                                            <div className="flex-1">
                                                                <input
                                                                    type="text"
                                                                    value={opt.text}
                                                                    onChange={(e) => updateOption(idx, { text: e.target.value })}
                                                                    placeholder="Masukkan judul/deskripsi topik..."
                                                                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                                                />
                                                            </div>
                                                            <button 
                                                                onClick={() => removeOption(idx)}
                                                                className="mt-1 p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                                                            >
                                                                <X size={16} />
                                                            </button>
                                                        </div>
                                                    ))}
                                                    {options.length === 0 && (
                                                        <div className="text-center py-6 text-sm text-slate-400 italic bg-slate-50 rounded-lg border border-dashed border-slate-300">
                                                            Belum ada topik yang ditambahkan.
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {selectedType === 'sjt' && (
                                    <SJTForm
                                        options={options}
                                        onAddOption={addOption}
                                        onInsertOption={() => {}}
                                        onRemoveOption={removeOption}
                                        onUpdateOption={updateOption}
                                        onSetOptionWeight={(idx, weight) => updateOption(idx, { weight })}
                                    />
                                )}

                                {/* Ordering */}
                                {selectedType === 'ordering' && (
                                    <OrderingForm
                                        options={options}
                                        correctOrder={(metadata.correct_order as string[]) || []}
                                        onAddItem={addOption}
                                        onRemoveItem={removeOption}
                                        onUpdateItem={(idx, fields) => updateOption(idx, fields)}
                                        onMoveItem={(from, to) => {
                                            const newOpts = [...options];
                                            const [moved] = newOpts.splice(from, 1);
                                            newOpts.splice(to, 0, moved);
                                            newOpts.forEach((o, i) => { o.order = i; });
                                            setOptions(newOpts);
                                            // Sync correct_order with new positions
                                            setMetadata({
                                                ...metadata,
                                                correct_order: newOpts.map(o => o.id || String(o.order))
                                            });
                                        }}
                                        onSetCorrectOrder={(order) => setMetadata({ ...metadata, correct_order: order })}
                                    />
                                )}

                                {/* Likert */}
                                {selectedType === 'likert' && (
                                    <LikertForm />
                                )}

                                {/* Forced Choice */}
                                {selectedType === 'forced_choice' && (
                                    <ForcedChoiceForm
                                        options={options}
                                        dimensions={dimensions}
                                        onAddOption={addOption}
                                        onRemoveOption={removeOption}
                                        onUpdateOption={updateOption}
                                    />
                                )}

                                {/* Checklist */}
                                {selectedType === 'checklist' && (
                                    <ChecklistForm
                                        options={options}
                                        dimensions={dimensions}
                                        onAddOption={addOption}
                                        onRemoveOption={removeOption}
                                        onUpdateOption={updateOption}
                                    />
                                )}

                                {/* Ranking */}
                                {selectedType === 'ranking' && (
                                    <RankingForm
                                        options={options}
                                        dimensions={dimensions}
                                        onAddOption={addOption}
                                        onRemoveOption={removeOption}
                                        onUpdateOption={updateOption}
                                    />
                                )}

                                {/* Paired Comparison */}
                                {selectedType === 'paired_comparison' && (
                                    <PairedComparisonForm
                                        options={options}
                                        dimensions={dimensions}
                                        onUpdateOption={updateOption}
                                    />
                                )}
                            </div>
                        </div>
                    </div>
                </main>
                {editingQuestion?.id && <ValidationNotesPanel key={editingQuestion.id} bankId={bankId} questionId={editingQuestion.id} />}
            </div>

            {/* ── LaTeX Editor Modal (Elegan) ── */}
            {latexEditorOpen && (
                <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60" onClick={closeLatexEditor}>
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95, y: 10 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: 10 }}
                        className="bg-white rounded-lg shadow-2xl w-full max-w-xl mx-4 overflow-hidden border border-slate-100"
                        onClick={e => e.stopPropagation()}
                    >
                        {/* Header */}
                        <div className="px-6 pt-5 pb-0 flex items-start justify-between">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 bg-[#3083FF] rounded-lg flex items-center justify-center shadow-lg shadow-amber-500/20">
                                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
                                        <path d="M4 4h6v6H4z"/><path d="M14 4h6v6h-6z"/><path d="M4 14h6v6H4z"/><path d="M17 14v3h3"/>
                                    </svg>
                                </div>
                                <div>
                                    <h3 className="text-base font-bold text-slate-800">Sisipkan Rumus Matematika</h3>
                                    <p className="text-[11px] text-slate-400 mt-0.5">
                                        {latexModeQuill ? 'Disisipkan ke pertanyaan utama' : 'Disisipkan ke opsi jawaban'}
                                    </p>
                                </div>
                            </div>
                            <button onClick={closeLatexEditor} className="w-8 h-8 flex items-center justify-center rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors mt-1">
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                                </svg>
                            </button>
                        </div>

                        {/* Two-column layout */}
                        <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
                            {/* Left: MathToolbar */}
                            <div className="bg-slate-50 rounded-lg p-4 border border-slate-100">
                                <div className="flex items-center gap-2 mb-3">
                                    <div className="w-5 h-5 bg-blue-100 rounded flex items-center justify-center">
                                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2.5">
                                            <path d="M4 4h6v6H4z"/><path d="M14 4h6v6h-6z"/><path d="M4 14h6v6H4z"/><path d="M17 14v3h3"/>
                                        </svg>
                                    </div>
                                    <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Template</span>
                                </div>
                                <MathToolbar
                                    onInsert={(template) => setLatexEditorValue(prev => prev + template)}
                                    visible={true}
                                    className="bg-white rounded-lg p-3"
                                />
                            </div>

                            {/* Right: Input + Preview */}
                            <div className="flex flex-col gap-3">
                                {/* Input */}
                                <div className="bg-white rounded-lg border border-slate-100 p-4 flex flex-col gap-2">
                                    <div className="flex items-center gap-2">
                                        <div className="w-5 h-5 bg-blue-100 rounded flex items-center justify-center">
                                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#3083FF" strokeWidth="2">
                                                <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
                                            </svg>
                                        </div>
                                        <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Ketik LaTeX</span>
                                    </div>
                                    <textarea
                                        value={latexEditorValue}
                                        onChange={(e) => setLatexEditorValue(e.target.value)}
                                        placeholder="Ketik rumus Anda di sini (tanpa $)&#10;Contoh: \frac{a}{b} + \sqrt{x} = c"
                                        className="w-full h-28 p-3 bg-slate-50 border border-slate-200 rounded-lg text-sm font-mono text-slate-700 outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100 transition-all resize-none placeholder:font-sans placeholder:text-slate-300 leading-relaxed"
                                        autoFocus
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); saveLatexToOption(); }
                                        }}
                                    />
                                </div>

                                {/* Preview */}
                                <div className="bg-white rounded-lg border border-slate-100 p-4 flex-1">
                                    <div className="flex items-center gap-2 mb-3">
                                        <div className="w-5 h-5 bg-violet-100 rounded flex items-center justify-center">
                                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#7c3aed" strokeWidth="2">
                                                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
                                            </svg>
                                        </div>
                                        <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Pratinjau Langsung</span>
                                    </div>
                                    <div className="p-4 bg-gradient-to-br from-slate-50 to-slate-100 rounded-lg min-h-[64px] flex items-center justify-center border border-slate-100">
                                        {latexEditorValue.trim() ? (
                                            <div className="text-sm">
                                                <LatexRenderer text={`$${latexEditorValue}$`} />
                                            </div>
                                        ) : (
                                            <div className="flex flex-col items-center gap-1.5">
                                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" strokeWidth="1.5">
                                                    <path d="M4 4h6v6H4z"/><path d="M14 4h6v6h-6z"/><path d="M4 14h6v6H4z"/><path d="M17 14v3h3"/>
                                                </svg>
                                                <span className="text-xs text-slate-300 italic">Ketik rumus untuk melihat pratinjau...</span>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Tips */}
                        <div className="px-5 pb-3">
                            <div className="bg-blue-50 border border-blue-100 rounded-lg px-3 py-2 flex items-start gap-2">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2" className="mt-0.5 shrink-0">
                                    <circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>
                                </svg>
                                <div className="text-[11px] text-blue-600 leading-relaxed">
                                    <span className="font-semibold">Tips:</span> Klik template di sebelah kiri untuk otomatis menyisipkan. Tekan <kbd className="bg-blue-100 text-blue-700 px-1 py-0.5 rounded text-[10px] font-mono">Ctrl + Enter</kbd> untuk menyimpan cepat.
                                </div>
                            </div>
                        </div>

                        {/* Footer */}
                        <div className="px-5 py-4 border-t border-slate-100 flex justify-end gap-2 bg-slate-50/50">
                            <button
                                onClick={closeLatexEditor}
                                className="px-4 py-2 text-sm font-medium text-slate-500 hover:text-slate-700 rounded-lg transition-colors"
                            >
                                Batal
                            </button>
                            <button
                                onClick={saveLatexToOption}
                                className="px-5 py-2 text-sm font-semibold bg-[#3083FF] text-white rounded-lg hover:bg-[#256fe0] transition-all shadow-lg shadow-amber-500/20 flex items-center gap-2"
                            >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                    <path d="M12 5v14M5 12l7 7 7-7"/>
                                </svg>
                                Sisipkan Rumus
                            </button>
                        </div>
                    </motion.div>
                </div>
            )}

            {/* ── Table Dialog ── */}
            {tableDialogOpen && (
                <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60" onClick={() => setTableDialogOpen(false)}>
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        className="bg-white rounded-lg shadow-xl w-full max-w-sm mx-4 overflow-hidden"
                        onClick={e => e.stopPropagation()}
                    >
                        {/* Title */}
                        <div className="px-6 pt-5 pb-0 flex items-center justify-between">
                            <h3 className="text-base font-semibold text-slate-800">Sisipkan Tabel</h3>
                            <button onClick={() => setTableDialogOpen(false)} className="w-8 h-8 flex items-center justify-center rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors">
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                                </svg>
                            </button>
                        </div>

                        {/* Preview */}
                        <div className="px-6 pt-4">
                            <div className="bg-slate-50 rounded-lg p-4 flex items-center justify-center">
                                <table style={{ borderCollapse: 'collapse' }}>
                                    <tbody>
                                        {Array.from({ length: Math.min(tableRows, 4) }).map((_, r) => (
                                            <tr key={r}>
                                                {Array.from({ length: Math.min(tableCols, 5) }).map((_, c) => (
                                                    <td key={c} style={{ border: '1px solid #e2e8f0', padding: '8px 12px' }}>
                                                        <span className="text-[10px] text-slate-400">{r + 1},{c + 1}</span>
                                                    </td>
                                                ))}
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        {/* Controls - Side by side */}
                        <div className="px-6 pt-4 pb-2">
                            <div className="flex gap-4">
                                {/* Rows */}
                                <div className="flex-1">
                                    <label className="text-[11px] font-medium text-slate-400 block mb-2">Baris</label>
                                    <div className="flex items-center gap-2">
                                        <button onClick={() => setTableRows(Math.max(1, tableRows - 1))} className="w-8 h-8 rounded-lg bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-600 transition-colors">−</button>
                                        <div className="flex-1 text-center text-lg font-semibold text-slate-800">{tableRows}</div>
                                        <button onClick={() => setTableRows(Math.min(10, tableRows + 1))} className="w-8 h-8 rounded-lg bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-600 transition-colors">+</button>
                                    </div>
                                </div>

                                {/* Columns */}
                                <div className="flex-1">
                                    <label className="text-[11px] font-medium text-slate-400 block mb-2">Kolom</label>
                                    <div className="flex items-center gap-2">
                                        <button onClick={() => setTableCols(Math.max(1, tableCols - 1))} className="w-8 h-8 rounded-lg bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-600 transition-colors">−</button>
                                        <div className="flex-1 text-center text-lg font-semibold text-slate-800">{tableCols}</div>
                                        <button onClick={() => setTableCols(Math.min(10, tableCols + 1))} className="w-8 h-8 rounded-lg bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-600 transition-colors">+</button>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Footer */}
                        <div className="px-6 py-4 flex justify-end gap-2">
                            <button onClick={() => setTableDialogOpen(false)} className="px-4 py-2 text-sm font-medium text-slate-500 hover:text-slate-700 rounded-lg transition-colors">Batal</button>
                            <button onClick={() => setTableDialogOpen(false)} className="px-5 py-2 text-sm font-semibold bg-primary text-white rounded-lg hover:bg-primary-hover transition-all">
                                Sisipkan (Gunakan toolbar editor)
                            </button>
                        </div>
                    </motion.div>
                </div>
            )}
        </div>
    );
}
