"use client";
import './question-dark-surfaces.css';
import './question-bank-layout.css';
import { registerPageFab, unregisterPageFab } from '@/app/components/mobile/page-fab';
import { collectQuestionGroups, questionGroupLabel } from '@/lib/question-groups';

import { getBankValidationFeedback } from '@/lib/api/validations';
import { FilterSearch } from '@/components/ui/filtertoolbar';
import { Button } from '@/components/ui/button';
import { InlineSelectIndicator } from '@/components/ui/InlineSelect';
import { CollaborationButton } from '@/app/components/CollaborationButton';
import { confirmDialog } from '@/lib/confirm-dialog';
import { getErrorMessage } from '@/lib/errors';
import { getProctorOrganization,type ProctorOrganization } from '@/lib/api/proctor';
import {
deleteQuestionAction,
getBankQuestions,
getDimensionsByBank,
getInstructionsByBank,
getKisiKisiByBank,
getQuestionBankAction,
getStimuliByBank,
toggleQuestionBankPublishAction,
updateQuestionsOrderAction
} from '@/lib/api/questions';
import type { BankTextItem,DimensionItem,KisiKisiItem,QuestionBank,QuestionMetadata,QuestionOptionDraft,QuestionRecord,QuestionType } from '@/lib/api/questions';
import { AnimatePresence,motion } from 'framer-motion';
import {
BookOpen,
Layers,
Check,
CheckSquare,
ChevronDown,
ChevronUp,
Edit3,
Eye,
FileDown,
CloudUpload,
CloudOff,
FileSearch,
FileText,
Loader2,
Plus,
Printer,
Search,
Square,Target,
Trash2,
Upload
} from 'lucide-react';
import { useCallback,useEffect,useRef,useState,useMemo } from 'react';
// docx is lazy-loaded inside export handlers
import DimensionManager from '@/app/components/questions/DimensionManager';
import KisiKisiTab from '@/app/components/questions/KisiKisiTab';
import { QuestionContent } from '@/app/components/questions/QuestionRenderer';
import { getSessionUser } from '@/lib/session';
import { useMemoryState } from '@/lib/useMemoryState';
import { getQuestionTypeLabel } from '@/app/types/question';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useParams,useRouter,useSearchParams } from 'next/navigation';
const StimulusManager = dynamic(() => import('@/app/components/questions/StimulusManager'), { ssr: false });
const InstructionManager = dynamic(() => import('@/app/components/questions/InstructionManager'), { ssr: false });
const QuestionEditorModal = dynamic(() => import('@/app/components/questions/QuestionEditorModal'), { ssr: false });
const BulkImportModal = dynamic(() => import('@/app/components/questions/BulkImportModal'), { ssr: false });
const PreviewModal = dynamic(() => import('@/app/components/questions/PreviewModal'), { ssr: false });
const BankValidationFeedbackTab = dynamic(() => import('@/app/components/questions/BankValidationFeedbackTab'), { ssr: false });
const BankValidationSummary = dynamic(() => import('@/app/components/questions/BankValidationSummary'), { ssr: false });

type QuestionBankRole = 'admin' | 'guru' | 'proktor';

interface QuestionBankDetailPageProps {
    role: QuestionBankRole;
}

export default function QuestionBankDetailPage({ role }: QuestionBankDetailPageProps) {
    const params = useParams();
    const bankId = params.bankId as string;
    const searchParams = useSearchParams();
    const router = useRouter();

    const cachePrefix = `${role}_questions_${bankId}`;
    const questionsBasePath = `/dashboard/${role}/questions`;

    const [questions, setQuestions] = useMemoryState<QuestionRecord[]>(`${cachePrefix}_questions`, []);
    const questionGroups = useMemo(() => collectQuestionGroups(questions), [questions]);
    const [isLoading, setIsLoading] = useMemoryState(`${cachePrefix}_isLoading`, true);
    const [org, setOrg] = useState<ProctorOrganization | null>(null);
    const [bankInfo, setBankInfo] = useState<QuestionBank | null>(null);
    const canManage = bankInfo?.canManage === true;
    const [validationNoteCount, setValidationNoteCount] = useState<number | null>(null);
    useEffect(() => {
        if (!canManage) return;
        let active = true;
        const refresh = async () => {
            try {
                const sessions = await getBankValidationFeedback(bankId);
                if (active) setValidationNoteCount(sessions.reduce((total, session) => total + (session.notes?.length || 0), 0));
            } catch {
                if (active) setValidationNoteCount(null);
            }
        };
        void refresh();
        window.addEventListener('focus', refresh);
        window.addEventListener('validation-feedback-updated', refresh);
        return () => {
            active = false;
            window.removeEventListener('focus', refresh);
            window.removeEventListener('validation-feedback-updated', refresh);
        };
    }, [bankId, canManage]);
    const [searchQuery, setSearchQuery] = useState('');
    const [filterType, setFilterType] = useState<string>('all');

    const [isEditorOpen, setIsEditorOpen] = useState(false);
    const [requestedTab, setActiveTab] = useState<'questions' | 'stimuli' | 'instructions' | 'dimensions' | 'kisikisi' | 'validations'>(searchParams.get('tab') === 'validations' ? 'validations' : 'questions');
    const activeTab = canManage ? requestedTab : 'questions';
    useEffect(() => {
        if (searchParams.get('tab') !== 'validations') return;
        const timer = window.setTimeout(() => setActiveTab('validations'), 0);
        return () => window.clearTimeout(timer);
    }, [searchParams]);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [editingQuestion, setEditingQuestion] = useState<QuestionRecord | null>(null);
    const [selectedType, setSelectedType] = useState<QuestionType>('mcq');

    const [questionText, setQuestionText] = useState('');
    const [scoreDefault, setScoreDefault] = useState(1);
    const [options, setOptions] = useMemoryState<QuestionOptionDraft[]>(`${cachePrefix}_options`, []);
    const [metadata, setMetadata] = useState<QuestionMetadata>({});
    const [categories, setCategories] = useMemoryState<string[]>(`${cachePrefix}_categories`, []);
    const [kisiKisi, setKisiKisi] = useState('');
    const [pembahasan, setPembahasan] = useState('');
    const [stimulusId, setStimulusId] = useState<string | null>(null);
    const [instructionId, setInstructionId] = useState<string | null>(null);
    const [dimensionId, setDimensionId] = useState<string | null>(null);
    const [kisiKisiId, setKisiKisiId] = useState<string | null>(null);
    const [pembLatexInput, setPembLatexInput] = useState('');
    const [openMathBuilder, setOpenMathBuilder] = useState(false);

    const [isViewModalOpen, setIsViewModalOpen] = useState(false);
    const [viewingQuestion, setViewingQuestion] = useState<QuestionRecord | null>(null);
    const [currentPreviewIndex, setCurrentPreviewIndex] = useState(0);
    const [matchingAnswers, setMatchingAnswers] = useState<Record<string, string>>({});
    const [doubtfulPreviews, setDoubtfulPreviews] = useState<Set<string>>(new Set());
    const [isSimulating, setIsSimulating] = useState(false);
    const [simulatedResults, setSimulatedResults] = useState<{ score: number, max: number } | null>(null);
    const [selectedQuestions, setSelectedQuestions] = useState<Set<string>>(new Set());
    const [isBulkDeleting, setIsBulkDeleting] = useState(false);
    const [deleteConfirm, setDeleteConfirm] = useState<{ isOpen: boolean, type: 'single' | 'bulk', id?: string } | null>(null);

    const [isImportModalOpen, setIsImportModalOpen] = useState(false);
    const [isExportOpen, setIsExportOpen] = useState(false);
    const [isExporting, setIsExporting] = useState(false);
    const exportDropdownRef = useRef<HTMLDivElement>(null);
    const [stimuliList, setStimuliList] = useMemoryState<BankTextItem[]>(`${cachePrefix}_stimuliList`, []);
    const [instructionsList, setInstructionsList] = useMemoryState<BankTextItem[]>(`${cachePrefix}_instructionsList`, []);
    const [dimensionsList, setDimensionsList] = useMemoryState<DimensionItem[]>(`${cachePrefix}_dimensionsList`, []);
    const [kisiKisiList, setKisiKisiList] = useMemoryState<KisiKisiItem[]>(`${cachePrefix}_kisiKisiList`, []);

    // Editor modal owns the visible state; this page supplies its setters.
    const [, setQuillInstance] = useState<unknown>(null);
    const [, setIsCropperOpen] = useState(false);
    const [, setImageToCrop] = useState<string | null>(null);
    const [, setCropperContext] = useState<{ type: 'question' | 'option'; index?: number }>({ type: 'question' });
    const [, setIsEquationBuilderOpen] = useState(false);
    const [, setIsSymbolPickerOpen] = useState(false);
    const [, setIsTableConfigOpen] = useState(false);

    const isFirstRender = useRef(true);
    const loadGenerationRef = useRef(0);

    const filteredQuestions = questions.filter(q => {
        const matchSearch = (q.question_text || '').toLowerCase().includes(searchQuery.toLowerCase());
        const matchType = filterType === 'all' || q.type === filterType;
        return matchSearch && matchType;
    });
    // Sinkronkan ref sebelum effect navigasi URL membacanya. Urutan ini juga
    // membuat React Compiler dapat membuktikan ref tidak dimutasi sesudah
    // lebih dahulu dipakai oleh effect lain.
    const filteredQuestionsRef = useRef(filteredQuestions);
    const editingQuestionRef = useRef(editingQuestion);
    const isEditorOpenRef = useRef(isEditorOpen);
    useEffect(() => {
        filteredQuestionsRef.current = filteredQuestions;
        editingQuestionRef.current = editingQuestion;
        isEditorOpenRef.current = isEditorOpen;
    }, [filteredQuestions, editingQuestion, isEditorOpen]);

    // Tautan lama `?print=true` dialihkan ke halaman cetak mandiri (tanpa navigasi aplikasi).
    useEffect(() => {
        if (searchParams.get('print') !== 'true') return;
        router.replace(`${questionsBasePath}/${bankId}/print`);
    }, [bankId, questionsBasePath, router, searchParams]);

    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (exportDropdownRef.current && !exportDropdownRef.current.contains(event.target as Node)) {
                setIsExportOpen(false);
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    const loadData = useCallback(async () => {
        const generation = ++loadGenerationRef.current;
        // setIsLoading(true); // Disabled for silent background sync
        const user = await getSessionUser();
        if (!user) {
            if (generation === loadGenerationRef.current) setIsLoading(false);
            return;
        }

        const organization = await getProctorOrganization();
        if (!organization) {
            if (generation === loadGenerationRef.current) setIsLoading(false);
            return;
        }

        const [qList, bDetail, stimList, instList, dimList, kkList] = await Promise.all([
            getBankQuestions(bankId),
            getQuestionBankAction(bankId),
            getStimuliByBank(bankId),
            getInstructionsByBank(bankId),
            getDimensionsByBank(bankId),
            getKisiKisiByBank(bankId)
        ]);
        if (generation !== loadGenerationRef.current) return;

        setOrg(organization);
        setQuestions(qList || []);
        setBankInfo(bDetail);
        setStimuliList(stimList || []);
        setInstructionsList(instList || []);
        setDimensionsList(dimList || []);
        setKisiKisiList(kkList || []);
        setIsLoading(false);
    }, [bankId, setDimensionsList, setInstructionsList, setIsLoading, setKisiKisiList, setQuestions, setStimuliList]);

    useEffect(() => {
        void loadData();
        const handleFocus = () => void loadData();
        window.addEventListener('focus', handleFocus);
        return () => {
            loadGenerationRef.current += 1;
            window.removeEventListener('focus', handleFocus);
        };
    }, [loadData]);

    const handleOpenEditor = useCallback((q: QuestionRecord | null = null) => {
        if (!canManage) return;
        if (q && q.id) {
            // Deduplicate options before loading into editor
            const rawOptions = q.bank_question_options || q.options || [];
            const uniqueOptions = rawOptions;

            const loadedOptions = uniqueOptions.map((opt, index) => ({
                ...opt, text: opt.option_text || opt.text || '',
                // Benar/Salah: "belum ditentukan" (null) harus tetap null agar
                // validasi editor menegur, bukan diam-diam dianggap "Salah".
                isCorrect: (q.type === 'true_false'
                    ? (opt.is_correct ?? opt.isCorrect ?? null)
                    : (opt.is_correct ?? opt.isCorrect ?? false)) as boolean,
                order: opt.order ?? index,
                weight: opt.weight ?? 0,
                match_texts: opt.metadata?.match_texts || opt.match_texts || [],
                category_names: opt.metadata?.category_names || opt.category_names || [],
                dimension_id: opt.metadata?.dimension_id || opt.dimension_id || null
            }));
            setEditingQuestion(q);
            setQuestionText(q.question_text || '');
            setSelectedType(q.type || 'mcq');
            setScoreDefault(q.score_default || 1);
            setMetadata(q.metadata || {});
            setCategories(q.metadata?.categories || []);
            setKisiKisi(q.metadata?.kisi_kisi || '');
            setPembahasan(q.metadata?.pembahasan || '');
            setStimulusId(q.stimulus_id || null);
            setInstructionId(q.instruction_id || null);
            setDimensionId(q.dimension_id || null);
            setKisiKisiId(q.kisi_kisi_id || null);
            setOptions(loadedOptions);
            const list = filteredQuestionsRef.current || [];
            const idx = list.findIndex(item => item?.id === q.id);
            if (idx >= 0) {
                const p = new URLSearchParams(window.location.search);
                p.set("index", idx.toString());
                p.delete("preview");
                p.delete("edit");
                window.history.replaceState({}, "", `${window.location.pathname}?${p.toString()}`);
            }
        } else {
            setEditingQuestion(null);
            setQuestionText('');
            setPembahasan('');
            setSelectedType('mcq');
            setScoreDefault(1);
            setMetadata({});
            setCategories([]);
            setKisiKisi('');
            setStimulusId(null);
            setInstructionId(null);
            setDimensionId(null);
            setKisiKisiId(null);
            setOptions([
                { text: '', isCorrect: true, order: 0, weight: 1, match_texts: [], category_names: [] },
                { text: '', isCorrect: false, order: 1, weight: 0, match_texts: [], category_names: [] },
                { text: '', isCorrect: false, order: 2, weight: 0, match_texts: [], category_names: [] },
                { text: '', isCorrect: false, order: 3, weight: 0, match_texts: [], category_names: [] },
            ]);
            const p = new URLSearchParams(window.location.search);
            p.delete("index");
            p.delete("preview");
            p.delete("edit");
            window.history.replaceState({}, "", `${window.location.pathname}${p.toString() ? "?" + p.toString() : ""}`);
        }
        setIsEditorOpen(true);
    }, [canManage, setCategories, setOptions]);

    useEffect(() => {
        if (!canManage || activeTab !== 'questions') return;
        const token = {};
        registerPageFab(token, { label: 'Tambah Soal', icon: 'plus', run: () => handleOpenEditor() });
        return () => unregisterPageFab(token);
    }, [canManage, activeTab, handleOpenEditor]);

    useEffect(() => {
        // Skip SSR/hydration: only run after component mounts (second render)
        if (isFirstRender.current) {
            isFirstRender.current = false;
            return;
        }
        if (isLoading || questions.length === 0) return;
        const previewParam = searchParams.get('preview');
        const indexParam = searchParams.get('index');
        const filtered = (questions || []).filter(q => (q.question_text || '').toLowerCase().includes(searchQuery.toLowerCase()));

        const syncFromUrl = () => {
        if (previewParam) {
            if (previewParam === 'all') {
                setIsViewModalOpen(true);
                setViewingQuestion(null);
                const idx = indexParam ? Math.min(parseInt(indexParam) || 0, filtered.length - 1) : 0;
                setCurrentPreviewIndex(Math.max(0, idx));
            } else if (previewParam === 'draft') {
                setIsViewModalOpen(true);
            } else {
                const q = questions.find(q => q.id === previewParam);
                if (q) {
                    setViewingQuestion(prev => (prev?.id === q.id ? prev : q));
                    setIsViewModalOpen(true);
                    const qIdx = filtered.findIndex(fq => fq.id === q.id);
                    if (qIdx >= 0) setCurrentPreviewIndex(qIdx);
                }
            }
        } else if (indexParam !== null) {
            setIsViewModalOpen(false);
            const parsedIdx = parseInt(indexParam, 10);
            if (!isNaN(parsedIdx) && filtered.length > 0) {
                const targetIdx = Math.max(0, Math.min(parsedIdx, filtered.length - 1));
                const targetQuestion = filtered[targetIdx];
                if (targetQuestion && (!isEditorOpenRef.current || editingQuestionRef.current?.id !== targetQuestion.id)) {
                    handleOpenEditor(targetQuestion);
                }
            }
        } else {
            setIsViewModalOpen(false);
        }
        };
        const timer = window.setTimeout(syncFromUrl, 0);
        return () => window.clearTimeout(timer);
    }, [searchQuery, searchParams, isLoading, questions, handleOpenEditor]);

    const requestDelete = (qId: string) => {
        setDeleteConfirm({ isOpen: true, type: 'single', id: qId });
    };

    const requestBulkDelete = () => {
        setDeleteConfirm({ isOpen: true, type: 'bulk' });
    };

    const confirmDeleteAction = async () => {
        if (!deleteConfirm) return;
        
        if (deleteConfirm.type === 'single') {
            const qId = deleteConfirm.id;
            if (qId) {
                const result = await deleteQuestionAction(qId, bankId);
                if (result.success) {
                    await loadData();
                } else {
                    alert('Gagal menghapus soal: ' + result.error);
                }
            }
        } else if (deleteConfirm.type === 'bulk') {
            setIsBulkDeleting(true);
            let successCount = 0;
            let failCount = 0;
            
            const ids = Array.from(selectedQuestions);
            for (const id of ids) {
                const result = await deleteQuestionAction(id, bankId);
                if (result.success) successCount++;
                else failCount++;
            }
            
            await loadData();
            setSelectedQuestions(new Set());
            setIsBulkDeleting(false);
            if (failCount > 0) alert(`Berhasil menghapus ${successCount} soal. Gagal menghapus ${failCount} soal.`);
        }
        setDeleteConfirm(null);
    };

    const toggleSelectQuestion = (qId: string) => {
        const newSet = new Set(selectedQuestions);
        if (newSet.has(qId)) newSet.delete(qId);
        else newSet.add(qId);
        setSelectedQuestions(newSet);
    };

    const toggleSelectAll = () => {
        if (selectedQuestions.size === filteredQuestions.length && filteredQuestions.length > 0) {
            setSelectedQuestions(new Set());
        } else {
            setSelectedQuestions(new Set(filteredQuestions.map(q => q.id)));
        }
    };

    const handleOpenView = (q: QuestionRecord) => {
        setMatchingAnswers({});
        setViewingQuestion(q);
        setIsViewModalOpen(true);
        const idx = filteredQuestions.findIndex(fq => fq.id === q.id && fq.id !== 'preview');
        if (idx >= 0) {
            setCurrentPreviewIndex(idx);
        } else {
            setCurrentPreviewIndex(0);
        }
        const params = new URLSearchParams(window.location.search);
        if (q?.id && q.id !== 'preview') {
            params.set('preview', q.id);
            params.set('index', idx >= 0 ? idx.toString() : '0');
        } else {
            params.set('preview', 'draft');
        }
        window.history.replaceState({}, '', `${window.location.pathname}?${params.toString()}`);
    };

    const handleMoveQuestion = async (idx: number, direction: 'up' | 'down') => {
        const newQuestions = [...questions];
        const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
        if (targetIdx < 0 || targetIdx >= newQuestions.length) return;
        const temp = newQuestions[idx];
        newQuestions[idx] = newQuestions[targetIdx];
        newQuestions[targetIdx] = temp;
        setQuestions(newQuestions);
        await updateQuestionsOrderAction(bankId, newQuestions.map(q => q.id));
    };

    
    const handleExportWord = async () => {
        if (isExporting || !canManage) return;
        setIsExporting(true);
        try {
            // Impor dinamis di dalam try: chunk yang gagal dimuat (mis. setelah
            // deploy baru) tetap memunculkan pesan, bukan error senyap.
            const { exportQuestionsToWord, ExportCancelledError } = await import('@/lib/export-template');
            try {
                const result = await exportQuestionsToWord(
                    questions,
                    bankInfo || { title: 'Bank Soal' },
                    stimuliList,
                    instructionsList,
                    kisiKisiList,
                    dimensionsList,
                    {
                        onMissingImages: ({ count, questionNumbers }) => confirmDialog({
                            title: 'Sebagian gambar tidak dapat dimuat',
                            text: `${count} gambar${questionNumbers.length ? ` pada soal ${questionNumbers.join(', ')}` : ''} gagal diunduh. Lanjutkan ekspor dengan penanda "[gambar tidak dapat dimuat]"? Gambar aslinya tetap tersimpan di bank soal.`,
                            confirmText: 'Lanjutkan', cancelText: 'Batal', variant: 'warning',
                        }),
                    }
                );
                const url = window.URL.createObjectURL(result.blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = result.filename;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                // Firefox/Safari membatalkan unduhan bila URL langsung dicabut.
                window.setTimeout(() => window.URL.revokeObjectURL(url), 60_000);
            } catch (err) {
                if (err instanceof ExportCancelledError) return;
                throw err;
            }
        } catch (err) {
            console.error('Export failed:', err);
            alert('Gagal mengexport dokumen: ' + (getErrorMessage(err) || String(err)));
        } finally {
            setIsExporting(false);
        }
    };

    const handleExportPdf = () => {
        window.open(`${questionsBasePath}/${bankId}/print`, '_blank');
    };

    const totalQuestions = questions.length;

    // In-editor navigation: keep latest list/editing in refs to avoid stale
    // closures when jumping to the adjacent question right after a save.
    const editorIndex = editingQuestion?.id ? filteredQuestions.findIndex(q => q.id === editingQuestion.id) : -1;
    const navigateEditor = (dir: 'prev' | 'next') => {
        const list = filteredQuestionsRef.current;
        const idx = list.findIndex(q => q.id === editingQuestionRef.current?.id);
        if (idx < 0) return;
        const target = list[dir === 'next' ? idx + 1 : idx - 1];
        if (target) handleOpenEditor(target);
    };

    if (!bankInfo) return <div className="p-8 text-center text-sm text-slate-500">
        {isLoading ? 'Memuat bank soal…' : 'Bank soal tidak tersedia atau belum dipublikasikan.'}
        {!isLoading && <Link href={questionsBasePath} className="block mt-4 font-semibold text-primary">Kembali ke Bank Soal</Link>}
    </div>;

    if (searchParams.get('print') === 'true') {
        // Tautan lama (?print=true) dialihkan ke halaman cetak mandiri.
        return <div className="p-8 text-center text-sm text-slate-500">Membuka lembar cetak…</div>;
    }

    return (
        <div className="min-h-screen bg-slate-50">
            {/* Header */}
            <div className="bg-white border-b border-slate-200 relative lg:sticky lg:top-0 z-30 print:hidden">
                <div className="max-w-6xl mx-auto px-4 md:px-6">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between py-3 sm:py-0 sm:h-14 gap-3 sm:gap-0">
                        <div className="flex items-center gap-3 overflow-x-auto pb-1 sm:pb-0 scrollbar-hide">
                            <div className="flex items-center gap-2 shrink-0">
                                <div className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center">
                                    <BookOpen size={13} className="text-white" />
                                </div>
                                <h1 className="text-sm font-semibold text-slate-900 truncate max-w-[200px] sm:max-w-xs">{bankInfo?.title || 'Bank Soal'}</h1>
                            </div>
                        </div>
                        <div className="question-bank-header-actions flex flex-wrap items-center gap-2 w-full sm:w-auto shrink-0">
                            {(bankInfo?.canShare || bankInfo?.collaborationPermission) && <CollaborationButton mobileIconOnly type="bank" resourceId={bankId} collaboratorCount={bankInfo?.collaboratorCount} onChanged={() => void loadData()} />}
                            {/* Export Dropdown */}
                            <div className="relative" ref={exportDropdownRef}>
                                <Button mobileIconOnly aria-label="Export" title={isExporting ? 'Menyiapkan dokumen Word…' : 'Export'} type="button" variant="outline" size="sm"
                                    onClick={() => setIsExportOpen(!isExportOpen)}
                                    className="w-full sm:w-auto"
                                    aria-busy={isExporting}
                                    leftIcon={isExporting ? <Loader2 size={16} className="animate-spin" /> : <FileDown size={16} />}
                                    rightIcon={<InlineSelectIndicator open={isExportOpen} size={12} />}
                                    aria-expanded={isExportOpen} aria-controls="bank-export-menu">
                                    Export
                                </Button>
                                {isExportOpen && (
                                    <div id="bank-export-menu" className="absolute left-0 sm:right-0 sm:left-auto top-full mt-1.5 w-56 bg-white border border-slate-200 rounded-lg shadow-xl z-50 overflow-hidden">
                                        <div className="px-3 py-2 border-b border-slate-100">
                                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Export Dokumen</p>
                                        </div>
                                        {/* Word memuat kunci jawaban: hanya untuk pengelola bank. */}
                                        {canManage && (<>
                                            <button type="button" disabled={isExporting} onClick={() => { void handleExportWord(); setIsExportOpen(false); }} className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-slate-50 disabled:opacity-60 disabled:cursor-wait transition-colors">
                                                <div className="w-7 h-7 rounded-lg bg-blue-50 flex items-center justify-center">{isExporting ? <Loader2 size={13} className="text-blue-600 animate-spin" /> : <FileText size={13} className="text-blue-600" />}</div>
                                                <div className="text-left"><p className="text-xs font-semibold text-slate-700">Bank Soal (Word)</p><p className="text-[10px] text-slate-400">{isExporting ? 'Sedang disiapkan…' : 'Format tabel siap import, dengan kunci'}</p></div>
                                            </button>
                                            <div className="border-t border-slate-100" />
                                        </>)}
                                        <button type="button" onClick={() => { handleExportPdf(); setIsExportOpen(false); }} className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-slate-50 transition-colors">
                                            <div className="w-7 h-7 rounded-lg bg-red-50 flex items-center justify-center"><Printer size={13} className="text-red-600" /></div>
                                            <div className="text-left"><p className="text-xs font-semibold text-slate-700">Lembar Ujian (PDF)</p><p className="text-[10px] text-slate-400">A4 siap cetak, tanpa kunci</p></div>
                                        </button>
                                    </div>
                                )}
                            </div>

                            <Button mobileIconOnly aria-label="Pratinjau" title="Pratinjau" type="button" variant="primary" size="sm" icon="preview"
                                onClick={() => { setIsViewModalOpen(true); setViewingQuestion(null); }}
                                className="w-full sm:w-auto">
                                Pratinjau
                            </Button>
                            {canManage && (<Button mobileIconOnly aria-label={bankInfo?.is_published ? 'Unpublish' : 'Publish'} title={bankInfo?.is_published ? 'Unpublish' : 'Publish'} type="button" size="sm"
                                variant={bankInfo?.is_published ? 'unpublish' : 'primary'}
                                leftIcon={bankInfo?.is_published ? <CloudOff size={16} /> : <CloudUpload size={16} />}
                                onClick={async () => {
                                    if (!org) return;
                                    if (!await confirmDialog({
                                        title: bankInfo?.is_published ? 'Unpublish Bank Soal?' : 'Publish Bank Soal?',
                                        text: bankInfo?.is_published
                                            ? `Unpublish bank soal "${bankInfo.title}" dan kembalikan statusnya menjadi draf?`
                                            : `Publish bank soal "${bankInfo?.title || 'Bank Soal'}" agar dapat digunakan untuk menyusun ujian?`,
                                        confirmText: 'Ya', cancelText: 'Tidak', variant: 'warning',
                                    })) return;
                                    const result = await toggleQuestionBankPublishAction(bankId, !bankInfo?.is_published);
                                    if (result.success) await loadData();
                                }}
                                className="w-full sm:w-auto"
                            >
                                {bankInfo?.is_published ? 'Unpublish' : 'Publish'}
                            </Button>)}
                        </div>
                    </div>
                    {/* Tabs */}
                    <div className="flex items-center gap-4 sm:gap-6 mt-1 border-b border-transparent overflow-x-auto scrollbar-hide">
                        <button
                            onClick={() => setActiveTab('questions')}
                            className={`pb-3 text-xs sm:text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${activeTab === 'questions' ? 'border-primary text-primary' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
                        >
                            Daftar Soal {questions.length > 0 && <span className={`ml-1.5 inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums ${activeTab === 'questions' ? 'bg-primary text-white' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>{questions.length}</span>}
                        </button>
                        {canManage && (<button
                            onClick={() => setActiveTab('stimuli')}
                            className={`pb-3 text-xs sm:text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${activeTab === 'stimuli' ? 'border-primary text-primary' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
                        >
                            Daftar Stimulus {stimuliList.length > 0 && <span className={`ml-1.5 inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums ${activeTab === 'stimuli' ? 'bg-primary text-white' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>{stimuliList.length}</span>}
                        </button>)}
                        {canManage && (<button
                            onClick={() => setActiveTab('instructions')}
                            className={`pb-3 text-xs sm:text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${activeTab === 'instructions' ? 'border-primary text-primary' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
                        >
                            Daftar Petunjuk {instructionsList.length > 0 && <span className={`ml-1.5 inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums ${activeTab === 'instructions' ? 'bg-primary text-white' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>{instructionsList.length}</span>}
                        </button>)}
                        {canManage && (<button
                            onClick={() => setActiveTab('dimensions')}
                            className={`pb-3 text-xs sm:text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${activeTab === 'dimensions' ? 'border-primary text-primary' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
                        >
                            Daftar Dimensi {dimensionsList.length > 0 && <span className={`ml-1.5 inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums ${activeTab === 'dimensions' ? 'bg-primary text-white' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>{dimensionsList.length}</span>}
                        </button>)}
                        {canManage && (<button
                            onClick={() => setActiveTab('kisikisi')}
                            className={`pb-3 text-xs sm:text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${activeTab === 'kisikisi' ? 'border-primary text-primary' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
                        >
                            Kisi-kisi Soal {kisiKisiList.length > 0 && <span className={`ml-1.5 inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums ${activeTab === 'kisikisi' ? 'bg-primary text-white' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>{kisiKisiList.length}</span>}
                        </button>)}
                        {canManage && (<button
                            onClick={() => setActiveTab('validations')}
                            className={`pb-3 text-xs sm:text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${activeTab === 'validations' ? 'border-primary text-primary' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
                        >
                            Catatan Validasi {(validationNoteCount ?? 0) > 0 && <span className={`ml-1.5 inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums ${activeTab === 'validations' ? 'bg-primary text-white' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>{validationNoteCount}</span>}
                        </button>)}
                    </div>
                </div>
            </div>

            {/* Content */}
            <div className="max-w-6xl mx-auto px-4 md:px-6 py-6 space-y-6 print:hidden">
                {canManage && activeTab === 'questions' && <BankValidationSummary
                    key={bankId}
                    bankId={bankId}
                    questions={questions}
                    onEditQuestion={handleOpenEditor}
                    onOpenFeedback={sessionId => {
                        const url = new URL(window.location.href);
                        url.searchParams.set('tab', 'validations');
                        url.searchParams.set('validation', sessionId);
                        window.history.replaceState({}, '', url);
                        setActiveTab('validations');
                    }}
                />}
                {activeTab === 'stimuli' ? (
                    <StimulusManager bankId={bankId} onItemsChange={setStimuliList} />
                ) : activeTab === 'instructions' ? (
                    <InstructionManager bankId={bankId} onItemsChange={setInstructionsList} />
                ) : activeTab === 'dimensions' ? (
                    <DimensionManager bankId={bankId} onItemsChange={setDimensionsList} />
                ) : activeTab === 'kisikisi' ? (
                    <KisiKisiTab bankId={bankId} onItemsChange={setKisiKisiList} />
                ) : activeTab === 'validations' ? (
                    <BankValidationFeedbackTab
                        bankId={bankId}
                        questions={questions}
                        onEditQuestion={handleOpenEditor}
                    />
                ) : (
                    <div className="question-bank-workspace flex flex-col gap-4 sm:gap-5">
                        {/* Stats */}
                        <div className="flex overflow-x-auto sm:flex-wrap gap-2 sm:gap-3 w-full scrollbar-hide">
                            <div 
                                onClick={() => setFilterType('all')}
                                className={`rounded-lg px-3 sm:px-4 py-2 sm:py-2.5 shadow-sm text-center shrink-0 min-w-[105px] sm:w-[140px] cursor-pointer transition-all ${filterType === 'all' ? 'bg-blue-100 border-2 border-blue-400' : 'bg-blue-50 border border-blue-200 hover:bg-blue-100'}`}
                            >
                                <p className="text-[9px] sm:text-[10px] font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap overflow-hidden text-ellipsis">Jumlah Soal</p>
                                <p className="text-base sm:text-lg font-bold text-primary stat-count">{totalQuestions}</p>
                            </div>
                            {(() => {
                                const typeOrder = [
                                    'mcq', 'mcq_complex', 'true_false', 'matching', 'categorization',
                                    'short_answer', 'essay', 'sjt', 'likert', 'forced_choice',
                                    'checklist', 'ranking', 'paired_comparison', 'ordering',
                                ];

                                const typeCounts = questions.reduce((acc, q) => {
                                    acc[q.type] = (acc[q.type] || 0) + 1;
                                    return acc;
                                }, {} as Record<string, number>);

                                return typeOrder.map((type) => {
                                    const count = typeCounts[type] || 0;
                                    if (count === 0) return null;
                                    return (
                                        <div 
                                            key={type} 
                                            onClick={() => setFilterType(type)}
                                            className={`rounded-lg px-3 sm:px-4 py-2 sm:py-2.5 shadow-sm text-center shrink-0 min-w-[110px] sm:w-[140px] cursor-pointer transition-all ${filterType === type ? 'bg-blue-100 border-2 border-blue-400' : 'bg-blue-50 border border-blue-200 hover:bg-blue-100'}`}
                                        >
                                            <p className={`text-[9px] sm:text-[10px] font-semibold text-slate-500 uppercase tracking-wider ${type === 'paired_comparison' ? 'whitespace-normal leading-tight' : 'whitespace-nowrap overflow-hidden text-ellipsis'}`}>
                                                {type === 'paired_comparison' ? <>Perbandingan<br />Berpasangan</> : getQuestionTypeLabel(type)}
                                            </p>
                                            <p className="text-base sm:text-lg font-bold text-primary stat-count">{count}</p>
                                        </div>
                                    );
                                });
                            })()}
                        </div>

                {/* Search & Actions */}
                <div className="question-bank-tools">
                    <div className="question-bank-tools__search-row">
                        <FilterSearch label="Cari soal" placeholder="Cari soal..." value={searchQuery}
                            onChange={setSearchQuery} icon={<Search size={16} />} grow={1} />
                        {canManage && <>
                            <button type="button" onClick={() => setIsImportModalOpen(true)}
                                className="question-bank-import" aria-label="Import soal" title="Import soal">
                                <Upload size={18} /><span className="question-bank-import__label">Import</span>
                            </button>
                            <Button type="button" variant="primary" size="sm" className="question-bank-add"
                                onClick={() => handleOpenEditor()} leftIcon={<Plus size={16} />}>Tambah Soal</Button>
                        </>}
                    </div>
                    {canManage && selectedQuestions.size > 0 && <div className="question-bank-tools__selection" role="group" aria-label="Aksi soal terpilih">
                        <span className="text-xs font-semibold text-slate-600">{selectedQuestions.size} dipilih</span>
                        <Button type="button" variant="outline" size="sm" onClick={toggleSelectAll}
                            aria-label={selectedQuestions.size === filteredQuestions.length ? 'Batalkan pilihan semua soal' : 'Pilih semua soal'}
                            aria-pressed={selectedQuestions.size === filteredQuestions.length}
                            leftIcon={selectedQuestions.size === filteredQuestions.length ? <CheckSquare size={16} /> : <Square size={16} />}>Semua</Button>
                        <Button type="button" variant="danger" size="sm" onClick={requestBulkDelete} isLoading={isBulkDeleting}
                            leftIcon={<Trash2 size={16} />}>Hapus ({selectedQuestions.size})</Button>
                    </div>}
                </div>

                {/* Question List */}
                {isLoading ? (
                    <div className="space-y-3">
                        {[1, 2, 3].map((i) => (
                            <div key={i} className="bg-white border border-slate-200 rounded-lg p-5 animate-pulse">
                                <div className="w-20 h-6 bg-slate-100 rounded mb-3" />
                                <div className="w-3/4 h-4 bg-slate-100 rounded" />
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="space-y-3">
                        {filteredQuestions.map((q, idx) => {
                            const meta = q.metadata || {};
                            const groupLabel = questionGroupLabel(q, questions, questionGroups);
                            
                            const stim = q.stimulus;
                            const hasStimulus = !!(stim?.content || meta.import_stimulus);
                            
                            const inst = q.instruction;
                            const hasInstruction = !!(inst?.content || meta.import_instruction);
                            
                            const hasKisi = !!(q.kisi_kisi_id || meta.kisi_kisi);
                            
                            // Hitung total icon aksi

                            return (
                                <div key={q.id} className="bg-white rounded-lg border border-slate-100 hover:border-primary/30 hover:shadow-xl hover:shadow-primary/5 transition-all">
                                    <div className="question-card-header flex flex-col sm:flex-row sm:items-center justify-between px-4 sm:px-5 py-3 sm:py-4 border-b border-slate-100 gap-3 sm:gap-0">
                                        {/* Kiri (Desktop) / Baris Atas (Mobile) */}
                                        <div className="question-card-identity flex items-center justify-between w-full sm:w-auto">
                                            <div className="question-card-summary flex items-center gap-3">
                                                <button
                                                    type="button"
                                                    onClick={() => toggleSelectQuestion(q.id)}
                                                    className={`question-card-number w-10 h-10 rounded flex items-center justify-center shrink-0 relative transition-all duration-200 cursor-pointer ${
                                                        selectedQuestions.has(q.id)
                                                            ? 'bg-blue-600 text-white shadow-md shadow-blue-600/20'
                                                            : 'bg-primary/10 text-primary hover:bg-primary/20'
                                                    }`}
                                                >
                                                    <span className="text-sm font-bold leading-none">{idx + 1}</span>
                                                    {selectedQuestions.has(q.id) && (
                                                        <div className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-blue-600 border border-white rounded-full flex items-center justify-center shadow-sm">
                                                            <Check size={8} strokeWidth={4} className="text-white" />
                                                        </div>
                                                    )}
                                                </button>
                                                <div className="question-card-meta min-w-0">
                                                    <span className="question-card-type text-xs font-medium text-slate-500">{getQuestionTypeLabel(q.type)}</span>
                                                    <div className="question-card-tags flex flex-wrap items-center gap-1.5 sm:gap-2">
                                                        {groupLabel && <span title={groupLabel} className="inline-flex max-w-full items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-600 dark:text-blue-400">
                                                            <Layers size={11} className="shrink-0" /><span className="truncate">{groupLabel}</span>
                                                        </span>}
                                                        {q.score_default > 1 && (
                                                            <span className="text-xs bg-amber-50 text-amber-600 px-2 py-0.5 rounded-full whitespace-nowrap">{q.score_default} poin</span>
                                                        )}
                                                        {hasStimulus && (
                                                            <button type="button" onClick={() => handleOpenView(q)} className="text-[10px] bg-blue-50 hover:bg-blue-100 text-blue-600 px-2 py-0.5 rounded-full flex items-center gap-1 transition-colors">
                                                                <FileText size={11} /> Stimulus
                                                            </button>
                                                        )}
                                                        {hasInstruction && (
                                                            <button type="button" onClick={() => handleOpenView(q)} className="text-[10px] bg-indigo-50 hover:bg-indigo-100 text-indigo-600 px-2 py-0.5 rounded-full flex items-center gap-1 transition-colors">
                                                                <BookOpen size={11} /> Petunjuk
                                                            </button>
                                                        )}
                                                        {hasKisi && (
                                                            <button type="button" onClick={() => handleOpenView(q)} className="text-[10px] bg-purple-50 hover:bg-purple-100 text-purple-600 px-2 py-0.5 rounded-full flex items-center gap-1 transition-colors">
                                                                <FileSearch size={11} /> Kisi-kisi
                                                            </button>
                                                        )}
                                                        {q.type === 'sjt' && (q.dimension || q.question_dimensions) && (
                                                            <span className="text-xs bg-indigo-50 border border-indigo-200 text-indigo-700 px-2 py-0.5 rounded-full flex items-center gap-1 whitespace-nowrap overflow-hidden text-ellipsis max-w-full">
                                                                <Target size={12} className="shrink-0" />
                                                                <span className="truncate">{(q.dimension || q.question_dimensions)?.name}</span>
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                            
                                            {/* Panah Naik Turun (Khusus Mobile di Pojok Kanan Atas) */}
                                            <div className="question-card-mobile-order flex sm:hidden items-center gap-1 shrink-0 ml-3">
                                                {filteredQuestions.length > 1 && (
                                                    <>
                                                        {canManage && (<button onClick={() => handleMoveQuestion(idx, 'up')} disabled={idx === 0} className="p-2 text-slate-400 hover:bg-slate-100 rounded-lg disabled:opacity-30"><ChevronUp size={16} /></button>)}
                                                        {canManage && (<button onClick={() => handleMoveQuestion(idx, 'down')} disabled={idx === filteredQuestions.length - 1} className="p-2 text-slate-400 hover:bg-slate-100 rounded-lg disabled:opacity-30"><ChevronDown size={16} /></button>)}
                                                    </>
                                                )}
                                            </div>
                                        </div>

                                        {/* Kanan (Desktop) / Baris Bawah (Mobile) */}
                                        <div className="question-card-actions flex items-center justify-between sm:justify-end gap-2 sm:gap-1 mt-2.5 sm:mt-0 w-full sm:w-auto shrink-0 border-t sm:border-t-0 pt-2.5 sm:pt-0 border-slate-100">
                                            {/* Panah Naik Turun (Khusus Desktop) */}
                                            <div className="hidden sm:flex items-center justify-center gap-1 sm:w-[60px] shrink-0">
                                                {filteredQuestions.length > 1 && (
                                                    <>
                                                        {canManage && (<button onClick={() => handleMoveQuestion(idx, 'up')} disabled={idx === 0} className="p-2 text-slate-400 hover:bg-slate-100 rounded-lg disabled:opacity-30"><ChevronUp size={14} /></button>)}
                                                        {canManage && (<button onClick={() => handleMoveQuestion(idx, 'down')} disabled={idx === filteredQuestions.length - 1} className="p-2 text-slate-400 hover:bg-slate-100 rounded-lg disabled:opacity-30"><ChevronDown size={14} /></button>)}
                                                    </>
                                                )}
                                            </div>

                                            {/* Desktop Buttons */}
                                            <div className="hidden sm:flex items-center gap-1 shrink-0">
                                                <button title="Lihat" onClick={() => handleOpenView(q)} className="p-2 text-slate-400 hover:text-primary hover:bg-slate-100 rounded-lg transition-colors"><Eye size={14} /></button>
                                                {canManage && (<button title="Edit" onClick={() => handleOpenEditor(q)} className="p-2 text-slate-400 hover:text-primary hover:bg-slate-100 rounded-lg transition-colors"><Edit3 size={14} /></button>)}
                                                {canManage && (<button title="Hapus" onClick={() => requestDelete(q.id)} className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"><Trash2 size={14} /></button>)}
                                            </div>

                                            {/* Mobile Buttons (Touch-friendly Lihat, Edit, Hapus) */}
                                            <div className="flex sm:hidden items-center gap-2 w-full justify-end">
                                                <button
                                                    onClick={() => handleOpenView(q)}
                                                    className="flex-1 flex items-center justify-center gap-1.5 py-1.5 px-3 text-xs font-semibold text-slate-600 bg-slate-50 hover:bg-slate-100 rounded-lg border border-slate-200 transition-colors"
                                                >
                                                    <Eye size={14} /> Lihat
                                                </button>
                                                {canManage && (<button
                                                    onClick={() => handleOpenEditor(q)}
                                                    className="flex-1 flex items-center justify-center gap-1.5 py-1.5 px-3 text-xs font-semibold text-primary bg-primary/10 hover:bg-primary/20 rounded-lg border border-primary/20 transition-colors"
                                                >
                                                    <Edit3 size={14} /> Edit
                                                </button>)}
                                                {canManage && (<button
                                                    onClick={() => requestDelete(q.id)}
                                                    className="w-8 h-8 flex items-center justify-center text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg border border-slate-200 transition-colors"
                                                    title="Hapus Soal"
                                                >
                                                    <Trash2 size={14} />
                                                </button>)}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="px-5 py-4 bg-white">
                                        <div className="text-sm text-slate-800 leading-relaxed" style={{overflow: 'visible'}}><QuestionContent content={q.question_text} /></div>
                                    </div>
                                    {q.type === 'true_false' && (q.bank_question_options || []).filter((o) => (o.option_text || o.text || '').trim()).length > 0 && (
                                        <div className="px-5 pt-3 pb-4">
                                            <div className="flex flex-col gap-1.5">
                                                {(q.bank_question_options || []).filter((o) => (o.option_text || o.text || '').trim()).map((opt) => (
                                                    <div key={opt.id} className={`flex items-center gap-2.5 px-3 py-2 rounded-md border text-xs ${opt.is_correct ? 'bg-blue-50 border-blue-200 text-blue-800' : 'bg-red-50 border-red-200 text-red-800'}`}>
                                                        <span className={`w-6 h-6 rounded flex items-center justify-center text-xs font-bold leading-none pt-[1px] ${opt.is_correct ? 'bg-primary text-white' : 'bg-red-500 text-white'}`}>{opt.is_correct ? 'B' : 'S'}</span>
                                                        <span className="flex-1"><QuestionContent content={opt.option_text || opt.text || ''} /></span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                    {q.type === 'matching' && (q.bank_question_options || []).filter((o) => (o.option_text || o.text || '').trim()).length > 0 && (
                                        <div className="px-5 pt-3 pb-4">
                                            <div className="flex flex-col gap-1.5">
                                                {(q.bank_question_options || []).filter((o) => (o.option_text || o.text || '').trim()).map((opt, oIdx: number) => {
                                                    const matches = opt.metadata?.match_texts || [];
                                                    return (
                                                        <div key={opt.id} className="flex items-center gap-2.5 px-3 py-2 rounded-md border bg-slate-50 border-slate-100 text-xs text-slate-600">
                                                            <span className="w-6 h-6 rounded flex items-center justify-center text-xs font-bold leading-none pt-[1px] bg-primary text-white">{String.fromCharCode(65 + oIdx)}</span>
                                                            <span className="flex-1"><QuestionContent content={opt.option_text || opt.text || ''} /></span>
                                                            <span className="text-slate-400 text-[10px]">→</span>
                                                            <span className="text-primary font-medium">{matches.join(', ') || '-'}</span>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )}
                                    {q.type === 'categorization' && (q.bank_question_options || []).filter((o) => (o.option_text || o.text || '').trim()).length > 0 && (
                                        <div className="px-5 pt-3 pb-4">
                                            <div className="flex flex-col gap-1.5">
                                                {(q.bank_question_options || []).filter((o) => (o.option_text || o.text || '').trim()).map((opt, oIdx: number) => {
                                                    const cats = opt.metadata?.category_names || [];
                                                    return (
                                                        <div key={opt.id} className="flex items-center gap-2.5 px-3 py-2 rounded-md border bg-slate-50 border-slate-100 text-xs text-slate-600">
                                                            <span className="w-6 h-6 rounded flex items-center justify-center text-xs font-bold leading-none pt-[1px] bg-primary text-white">{String.fromCharCode(65 + oIdx)}</span>
                                                            <span className="flex-1"><QuestionContent content={opt.option_text || opt.text || ''} /></span>
                                                            <span className="text-slate-400 text-[10px]">→</span>
                                                            <span className="text-purple-600 font-medium">{cats.join(', ') || '-'}</span>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )}
                                    {q.type === 'short_answer' && (
                                        <div className="px-5 pt-3 pb-4">
                                            <div className="flex flex-col gap-1.5">
                                                {(meta.blanks || []).map((blank, bIdx: number) => (
                                                    <div key={bIdx} className="flex items-center gap-2.5 px-3 py-2 rounded-md border bg-blue-50 border-blue-200 text-xs text-blue-800">
                                                        <span className="w-6 h-6 rounded flex items-center justify-center text-[10px] font-bold leading-none pt-[1px] bg-blue-500 text-white shrink-0">{bIdx + 1}</span>
                                                        <div className="flex-1 min-w-0">
                                                            <span className="font-bold mr-2 uppercase text-[10px] text-blue-600">JAWABAN:</span>
                                                            <span className="font-bold text-blue-900">{blank.answer || '-'}</span>
                                                            {blank.variations && blank.variations.length > 0 && (
                                                                <div className="text-[10px] text-blue-500/70 mt-0.5 flex flex-wrap gap-1">
                                                                    <span className="font-semibold">Alternatif: </span>
                                                                    {blank.variations.map((v: string, vIdx: number) => (
                                                                        <span key={vIdx} className="bg-white/50 px-1.5 rounded border border-blue-100">{v}</span>
                                                                    ))}
                                                                </div>
                                                            )}
                                                        </div>
                                                        <Check size={13} className="text-primary shrink-0" strokeWidth={3} />
                                                    </div>
                                                ))}
                                                {(!meta.blanks || meta.blanks.length === 0) && (
                                                    <div className="flex items-center gap-2.5 px-3 py-2 rounded-md border bg-blue-50 border-blue-200 text-xs text-blue-800 italic">
                                                        Belum ada jawaban ditentukan
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    )}
                                    {(q.type === 'mcq' || q.type === 'mcq_complex') && (q.bank_question_options || []).filter((o) => (o.option_text || o.text || '').trim()).length > 0 && (
                                        <div className="px-5 pt-3 pb-4">
                                            <div className="flex flex-col gap-1.5">
                                                {(q.bank_question_options || []).filter((o) => (o.option_text || o.text || '').trim()).map((opt, oIdx: number) => (
                                                    <div key={opt.id} className={`flex items-center gap-2.5 px-3 py-2 rounded-md border text-xs ${opt.is_correct ? 'bg-blue-50 border-blue-200 text-blue-800' : 'bg-slate-50 border-slate-100 text-slate-600'}`}>
                                                        <span className={`w-6 h-6 rounded flex items-center justify-center text-xs font-bold leading-none pt-[1px] ${opt.is_correct ? 'bg-blue-500 text-white' : 'bg-slate-200 text-slate-600'}`}>{String.fromCharCode(65 + oIdx)}</span>
                                                        <span className="flex-1"><QuestionContent content={opt.option_text || opt.text || ''} /></span>
                                                        {opt.is_correct && <Check size={13} className="text-primary shrink-0" />}
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                    {q.type === 'sjt' && (q.bank_question_options || []).filter((o) => (o.option_text || o.text || '').trim()).length > 0 && (
                                        <div className="px-5 pt-3 pb-4">
                                            <div className="flex flex-col gap-1.5">
                                                {(q.bank_question_options || []).filter((o) => (o.option_text || o.text || '').trim()).map((opt, oIdx: number) => {
                                                    const isHighest = opt.weight === Math.max(...(q.bank_question_options || []).map((o) => o.weight || 0));
                                                    const dimId = opt.metadata?.dimension_id || opt.dimension_id;
                                                    const dimName = dimensionsList?.find((d) => d.id === dimId)?.name;
                                                    return (
                                                        <div key={opt.id} className={`flex items-center gap-2.5 px-3 py-2 rounded-md border text-xs ${isHighest ? 'bg-blue-50 border-blue-200 text-blue-800' : 'bg-slate-50 border-slate-100 text-slate-600'}`}>
                                                            <span className={`w-6 h-6 rounded flex items-center justify-center text-xs font-bold leading-none pt-[1px] ${isHighest ? 'bg-primary text-white' : 'bg-slate-200 text-slate-600'}`}>{String.fromCharCode(65 + oIdx)}</span>
                                                            <span className="flex-1"><QuestionContent content={opt.option_text || opt.text || ''} /></span>
                                                            {dimName && (
                                                                <div className="bg-indigo-50 text-indigo-600 px-2 py-1 rounded text-[10px] font-bold border border-indigo-100 whitespace-nowrap shrink-0 flex items-center gap-1">
                                                                    <Target size={10} /> {dimName}
                                                                </div>
                                                            )}
                                                            <div className="bg-[#3083FF]/10 text-[#3083FF] px-2 py-1 rounded text-[10px] font-bold border border-[#3083FF]/20 whitespace-nowrap shrink-0">
                                                                {opt.weight || 0} Poin
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )}
                                    {q.type === 'ordering' && (q.bank_question_options || []).filter((o) => (o.option_text || o.text || '').trim()).length > 0 && (
                                        <div className="px-5 pt-3 pb-4">
                                            <div className="flex flex-col gap-1.5">
                                                {(q.bank_question_options || []).filter((o) => (o.option_text || o.text || '').trim()).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map((opt, oIdx: number) => (
                                                    <div key={opt.id} className="flex items-center gap-2.5 px-3 py-2 rounded-md border bg-slate-50 border-slate-100 text-xs text-slate-600">
                                                        <span className="w-6 h-6 rounded flex items-center justify-center text-[10px] font-bold leading-none pt-[1px] bg-blue-500 text-white shrink-0">{oIdx + 1}</span>
                                                        <span className="flex-1"><QuestionContent content={opt.option_text || opt.text || ''} /></span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                    {['forced_choice', 'checklist', 'ranking'].includes(q.type) && (q.bank_question_options || []).filter((o) => (o.option_text || o.text || '').trim()).length > 0 && (
                                        <div className="px-5 pt-3 pb-4">
                                            <div className="flex flex-col gap-1.5">
                                                {(q.bank_question_options || []).filter((o) => (o.option_text || o.text || '').trim()).map((opt, oIdx: number) => {
                                                    const dimId = opt.metadata?.dimension_id || opt.dimension_id;
                                                    const dimName = dimensionsList?.find((d) => d.id === dimId)?.name;
                                                    return (
                                                        <div key={opt.id} className="flex items-center gap-2.5 px-3 py-2 rounded-md border bg-slate-50 border-slate-100 text-xs text-slate-600">
                                                            <span className="w-6 h-6 rounded flex items-center justify-center text-[10px] font-bold leading-none pt-[1px] bg-indigo-500 text-white shrink-0">P{oIdx + 1}</span>
                                                            <span className="flex-1"><QuestionContent content={opt.option_text || opt.text || ''} /></span>
                                                            {dimName && (
                                                                <div className="bg-indigo-50 text-indigo-600 px-2 py-1 rounded text-[10px] font-bold border border-indigo-100 whitespace-nowrap shrink-0 flex items-center gap-1">
                                                                    <Target size={10} /> {dimName}
                                                                </div>
                                                            )}
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )}
                                    {q.type === 'paired_comparison' && (q.bank_question_options || []).filter((o) => (o.option_text || o.text || '').trim()).length > 0 && (
                                        <div className="px-5 pt-3 pb-4">
                                            <div className="flex flex-col gap-1.5">
                                                {(q.bank_question_options || []).filter((o) => (o.option_text || o.text || '').trim()).map((opt, oIdx: number) => {
                                                    const dimId = opt.metadata?.dimension_id || opt.dimension_id;
                                                    const dimName = dimensionsList?.find((d) => d.id === dimId)?.name;
                                                    return (
                                                        <div key={opt.id} className="flex items-center gap-2.5 px-3 py-2 rounded-md border bg-pink-50/50 border-pink-100 text-xs text-slate-600">
                                                            <span className="w-6 h-6 rounded flex items-center justify-center text-[10px] font-bold leading-none pt-[1px] bg-pink-500 text-white shrink-0">{oIdx === 0 ? 'A' : 'B'}</span>
                                                            <span className="flex-1"><QuestionContent content={opt.option_text || opt.text || ''} /></span>
                                                            {dimName && (
                                                                <div className="bg-pink-100/50 text-pink-700 px-2 py-1 rounded text-[10px] font-bold border border-pink-200 whitespace-nowrap shrink-0 flex items-center gap-1">
                                                                    <Target size={10} /> {dimName}
                                                                </div>
                                                            )}
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )}
                                    {q.type === 'likert' && (q.bank_question_options || []).filter((o) => (o.option_text || o.text || '').trim()).length > 0 && (
                                        <div className="px-5 pt-3 pb-4">
                                            <div className="flex flex-wrap gap-2">
                                                {(q.bank_question_options || []).filter((o) => (o.option_text || o.text || '').trim()).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map((opt) => (
                                                    <div key={opt.id} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border bg-blue-50/50 border-blue-100 text-xs text-blue-800">
                                                        <span className="font-medium"><QuestionContent content={opt.option_text || opt.text || ''} /></span>
                                                        <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 rounded font-semibold whitespace-nowrap">Skor: {opt.weight || 0}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            );
                        })}

                        {filteredQuestions.length === 0 && (
                            <div className="py-20 text-center">
                                <BookOpen size={32} className="mx-auto mb-3 text-slate-300" />
                                <h3 className="text-lg font-semibold text-slate-800 mb-1">Belum Ada Soal</h3>
                                <p className="text-sm text-slate-500 mb-6">Tambahkan soal pertama untuk mulai membangun bank soal.</p>
                                {canManage && (<button onClick={() => handleOpenEditor()} className="inline-flex items-center gap-2 bg-primary text-white px-6 py-3 rounded-lg text-sm font-medium hover:bg-primary/90">
                                    <Plus size={18} /> Tambah Soal
                                </button>)}
                            </div>
                        )}
                    </div>
                )}
                    </div>
                )}
            </div>

            {/* Modals */}
            {canManage && isEditorOpen && (
                <QuestionEditorModal
                    key={editingQuestion?.id ?? 'new-question'}
                    isOpen={isEditorOpen}
                    editingQuestion={editingQuestion}
                    bankId={bankId}
                    existingGroups={questionGroups}
                    org={org}
                    onSaveSuccess={loadData}
                    onNavigate={navigateEditor}
                    editorIndex={editorIndex}
                    editorTotal={filteredQuestions.length}
                    onClose={() => {
                        setIsEditorOpen(false);
                        const p = new URLSearchParams(window.location.search);
                        p.delete("index");
                        p.delete("preview");
                        p.delete("edit");
                        window.history.replaceState({}, "", `${window.location.pathname}${p.toString() ? "?" + p.toString() : ""}`);
                    }}
                    questionText={questionText}
                    setQuestionText={setQuestionText}
                    options={options}
                    setOptions={setOptions}
                    selectedType={selectedType}
                    setSelectedType={setSelectedType}
                    scoreDefault={scoreDefault}
                    setScoreDefault={setScoreDefault}
                    metadata={metadata}
                    setMetadata={setMetadata}
                    categories={categories}
                    setCategories={setCategories}
                    kisiKisi={kisiKisi}
                    setKisiKisi={setKisiKisi}
                    isSubmitting={isSubmitting}
                    setIsSubmitting={setIsSubmitting}
                    setIsCropperOpen={setIsCropperOpen}
                    setImageToCrop={setImageToCrop}
                    setCropperContext={setCropperContext}
                    handleOpenPreview={handleOpenView}
                    setIsEquationBuilderOpen={setIsEquationBuilderOpen}
                    pembahasan={pembahasan}
                    setPembahasan={setPembahasan}
                    pembLatexInput={pembLatexInput}
                    setPembLatexInput={setPembLatexInput}
                    onInsertPembMath={(latex) => setPembahasan(prev => `${prev} $${latex}$$ `)}
                    openMathBuilder={openMathBuilder}
                    setOpenMathBuilder={setOpenMathBuilder}
                    setIsSymbolPickerOpen={setIsSymbolPickerOpen}
                    setIsTableConfigOpen={setIsTableConfigOpen}
                    setQuillInstance={setQuillInstance}
                    stimulusId={stimulusId}
                    setStimulusId={setStimulusId}
                    instructionId={instructionId}
                    setInstructionId={setInstructionId}
                    dimensionId={dimensionId}
                    setDimensionId={setDimensionId}
                    dimensions={dimensionsList}
                    kisiKisiId={kisiKisiId}
                    setKisiKisiId={setKisiKisiId}
                    kisiKisiList={kisiKisiList}
                />
            )}

            <PreviewModal
                isOpen={isViewModalOpen}
                onClose={() => {
                    setIsViewModalOpen(false);
                    setViewingQuestion(null);
                    const params = new URLSearchParams(window.location.search);
                    params.delete('preview');
                    if (!isEditorOpen) {
                        params.delete("index");
                    }
                    window.history.replaceState({}, '', `${window.location.pathname}${params.toString() ? '?' + params.toString() : ''}`);
                }}
                bankInfo={bankInfo}
                viewingQuestion={viewingQuestion}
                setViewingQuestion={setViewingQuestion}
                filteredQuestions={filteredQuestions}
                currentPreviewIndex={currentPreviewIndex}
                setCurrentPreviewIndex={(idx) => { setViewingQuestion(null); setCurrentPreviewIndex(idx); }}
                matchingAnswers={matchingAnswers}
                setMatchingAnswers={setMatchingAnswers}
                setQuestions={setQuestions}
                doubtfulPreviews={doubtfulPreviews}
                setDoubtfulPreviews={setDoubtfulPreviews}
                isSimulating={isSimulating}
                setIsSimulating={setIsSimulating}
                simulatedResults={simulatedResults}
                setSimulatedResults={setSimulatedResults}
                onFinish={() => setIsViewModalOpen(false)}
                studentName={org?.name}
            />

            <BulkImportModal
                isOpen={canManage && isImportModalOpen}
                onClose={() => setIsImportModalOpen(false)}
                bankId={bankId}
                onImportComplete={loadData}
            />



            {/* ── Delete Confirmation Modal ── */}
            <AnimatePresence>
                {deleteConfirm && (
                    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
                        <motion.div
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.95 }}
                            className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden"
                        >
                            <div className="p-6">
                                <div className="w-12 h-12 rounded-full bg-pink-100 flex items-center justify-center mb-4 mx-auto">
                                    <Trash2 className="text-pink-600" size={24} />
                                </div>
                                <h3 className="text-lg font-bold text-slate-800 text-center mb-2">
                                    Konfirmasi Hapus
                                </h3>
                                <p className="text-sm text-slate-500 text-center">
                                    {deleteConfirm.type === 'bulk'
                                        ? `Yakin ingin menghapus ${selectedQuestions.size} soal yang dipilih? Tindakan ini tidak dapat dibatalkan.`
                                        : 'Yakin ingin menghapus soal ini? Tindakan ini tidak dapat dibatalkan.'}
                                </p>
                            </div>
                            <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex gap-3">
                                <button
                                    onClick={() => setDeleteConfirm(null)}
                                    className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 text-slate-600 font-medium hover:bg-white transition-colors"
                                >
                                    Batal
                                </button>
                                <button
                                    onClick={confirmDeleteAction}
                                    disabled={isBulkDeleting}
                                    className="flex-1 px-4 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-blue-700 text-white font-medium hover:from-blue-700 hover:to-blue-800 transition-colors shadow-md shadow-blue-500/20 disabled:opacity-70 flex items-center justify-center gap-2"
                                >
                                    {isBulkDeleting && <Loader2 size={16} className="animate-spin" />}
                                    Hapus
                                </button>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>


        </div>
    );
}
