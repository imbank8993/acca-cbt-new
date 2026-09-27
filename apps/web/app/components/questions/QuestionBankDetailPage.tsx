"use client";
import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Plus, Search, ChevronLeft, BookOpen, Eye,
    Trash2, Edit3, Upload, Download, FileDown, FileText, Printer, FileSearch,
    Clock, ShieldCheck, Sparkles, Loader2, ChevronUp, ChevronDown, Check, MoreVertical, X,
    CheckSquare, Square, ChevronRight, Target
} from 'lucide-react';
import {
    getBankQuestions, saveQuestionAction, deleteQuestionAction,
    getQuestionBankAction, updateQuestionsOrderAction,
    toggleQuestionBankPublishAction, updateQuestionMetadataAction,
    getStimuliByBank, getInstructionsByBank, getDimensionsByBank, getKisiKisiByBank
} from '@/lib/api/questions';
import { generateKisiKisi } from '@/lib/api/ai';
import { getProctorOrganization } from '@/lib/api/proctor';
// docx is lazy-loaded inside export handlers
import { getSessionUser } from '@/lib/session';
import { useParams, useRouter, useSearchParams, usePathname } from 'next/navigation';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { QuestionContent } from '@/app/components/questions/QuestionRenderer';
const StimulusManager = dynamic(() => import('@/app/components/questions/StimulusManager'), { ssr: false });
const InstructionManager = dynamic(() => import('@/app/components/questions/InstructionManager'), { ssr: false });
import DimensionManager from '@/app/components/questions/DimensionManager';
import KisiKisiTab from '@/app/components/questions/KisiKisiTab';
import { useMemoryState } from '@/lib/useMemoryState';
const QuestionEditorModal = dynamic(() => import('@/app/components/questions/QuestionEditorModal'), { ssr: false });
const BulkImportModal = dynamic(() => import('@/app/components/questions/BulkImportModal'), { ssr: false });
const PreviewModal = dynamic(() => import('@/app/components/questions/PreviewModal'), { ssr: false });
const ExamPrintView = (dynamic as any)(() => import('@/app/components/questions/ExamPrintView').then(mod => mod.ExamPrintView), { ssr: false });

type QuestionBankRole = 'admin' | 'guru' | 'proktor';

interface QuestionBankDetailPageProps {
    role: QuestionBankRole;
}

export default function QuestionBankDetailPage({ role }: QuestionBankDetailPageProps) {
    const params = useParams();
    const bankId = params.bankId as string;
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();

    const cachePrefix = `${role}_questions_${bankId}`;
    const questionsBasePath = `/dashboard/${role}/questions`;

    const [questions, setQuestions] = useMemoryState<any[]>(`${cachePrefix}_questions`, []);
    const [isLoading, setIsLoading] = useMemoryState(`${cachePrefix}_isLoading`, true);
    const [org, setOrg] = useState<any>(null);
    const [bankInfo, setBankInfo] = useState<any>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [filterType, setFilterType] = useState<string>('all');

    const [isEditorOpen, setIsEditorOpen] = useState(false);
    const [activeTab, setActiveTab] = useState<'questions' | 'stimuli' | 'instructions' | 'dimensions' | 'kisikisi'>('questions');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [editingQuestion, setEditingQuestion] = useState<any>(null);
    const [selectedType, setSelectedType] = useState<any>('mcq');

    const [questionText, setQuestionText] = useState('');
    const [scoreDefault, setScoreDefault] = useState(1);
    const [options, setOptions] = useMemoryState<any[]>(`${cachePrefix}_options`, []);
    const [metadata, setMetadata] = useState<any>({});
    const [categories, setCategories] = useMemoryState<string[]>(`${cachePrefix}_categories`, []);
    const [kisiKisi, setKisiKisi] = useState('');
    const [pembahasan, setPembahasan] = useState('');
    const [stimulusId, setStimulusId] = useState<string | null>(null);
    const [instructionId, setInstructionId] = useState<string | null>(null);
    const [dimensionId, setDimensionId] = useState<string | null>(null);
    const [kisiKisiId, setKisiKisiId] = useState<string | null>(null);
    const [pembLatexInput, setPembLatexInput] = useState('');
    const [openMathBuilder, setOpenMathBuilder] = useState(false);
    const [isGeneratingAI, setIsGeneratingAI] = useState<string | null>(null);

    const [isViewModalOpen, setIsViewModalOpen] = useState(false);
    const [viewingQuestion, setViewingQuestion] = useState<any>(null);
    const [currentPreviewIndex, setCurrentPreviewIndex] = useState(0);
    const [matchingAnswers, setMatchingAnswers] = useState<Record<string, string>>({});
    const [doubtfulPreviews, setDoubtfulPreviews] = useState<Set<string>>(new Set());
    const [isSimulating, setIsSimulating] = useState(false);
    const [simulatedResults, setSimulatedResults] = useState<{ score: number, max: number } | null>(null);
    const [selectedQuestions, setSelectedQuestions] = useState<Set<string>>(new Set());
    const [isBulkDeleting, setIsBulkDeleting] = useState(false);
    const [deleteConfirm, setDeleteConfirm] = useState<{ isOpen: boolean, type: 'single' | 'bulk', id?: string } | null>(null);

    const [isImportModalOpen, setIsImportModalOpen] = useState(false);
    const [isImportDropdownOpen, setIsImportDropdownOpen] = useState(false);
    const [userId, setUserId] = useState<string>('');
    const importDropdownRef = useRef<HTMLDivElement>(null);
    const [isExportOpen, setIsExportOpen] = useState(false);
    const exportDropdownRef = useRef<HTMLDivElement>(null);
    const [stimuliList, setStimuliList] = useMemoryState<any[]>(`${cachePrefix}_stimuliList`, []);
    const [instructionsList, setInstructionsList] = useMemoryState<any[]>(`${cachePrefix}_instructionsList`, []);
    const [dimensionsList, setDimensionsList] = useMemoryState<any[]>(`${cachePrefix}_dimensionsList`, []);
    const [kisiKisiList, setKisiKisiList] = useMemoryState<any[]>(`${cachePrefix}_kisiKisiList`, []);

    // Cross-bank import
    const [quillInstance, setQuillInstance] = useState<any>(null);
    const [isCropperOpen, setIsCropperOpen] = useState(false);
    const [imageToCrop, setImageToCrop] = useState<string | null>(null);
    const [cropperContext, setCropperContext] = useState<any>({ type: 'question' });
    const [isEquationBuilderOpen, setIsEquationBuilderOpen] = useState(false);
    const [isSymbolPickerOpen, setIsSymbolPickerOpen] = useState(false);
    const [isTableConfigOpen, setIsTableConfigOpen] = useState(false);
    const [tableRows, setTableRows] = useState(2);
    const [tableCols, setTableCols] = useState(2);
    const [isPrintOpen, setIsPrintOpen] = useState(false);
    const isFirstRender = useRef(true);

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

    useEffect(() => { loadData();
        // Auto-injected smart sync (Window Focus)
        const handleFocus = () => { if (typeof loadData === 'function') loadData(); };
        window.addEventListener('focus', handleFocus);
        return () => window.removeEventListener('focus', handleFocus); }, [bankId]);

    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (exportDropdownRef.current && !exportDropdownRef.current.contains(event.target as Node)) {
                setIsExportOpen(false);
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

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

        if (previewParam) {
            if (previewParam === 'all') {
                setIsViewModalOpen(true);
                setViewingQuestion(null);
                const idx = indexParam ? Math.min(parseInt(indexParam) || 0, filtered.length - 1) : 0;
                setCurrentPreviewIndex(Math.max(0, idx));
            } else {
                const q = questions.find(q => q.id === previewParam);
                if (q) {
                    setViewingQuestion(q);
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
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [searchQuery, searchParams, isLoading, questions, bankId]);

    const loadData = async () => {
        // setIsLoading(true); // Disabled for silent background sync
        const user = await getSessionUser();
        if (user) {
            const organization = await getProctorOrganization();
            setUserId(user.id);
            if (organization) {
                setOrg(organization);
                const [qList, bDetail, stimList, instList, dimList, kkList] = await Promise.all([
                    getBankQuestions(bankId),
                    getQuestionBankAction(bankId),
                    getStimuliByBank(bankId),
                    getInstructionsByBank(bankId),
                    getDimensionsByBank(bankId),
                    getKisiKisiByBank(bankId)
                ]);
                setQuestions(qList || []);
                setBankInfo(bDetail);
                setStimuliList(stimList || []);
                setInstructionsList(instList || []);
                setDimensionsList(dimList || []);
                setKisiKisiList(kkList || []);
            }
        }
        setIsLoading(false);
    };

    const generateKisiForQuestion = async (qId: string, text: string, opts: any[]) => {
        setIsGeneratingAI(qId);
        try {
            const optTexts = opts.map(o => o.option_text || o.text);
            const res = await generateKisiKisi(text, optTexts);
            if (res.success && res.kisi) {
                setQuestions(prev => prev.map(q => q.id === qId ? { ...q, metadata: { ...q.metadata, kisi_kisi: res.kisi } } : q));
                await updateQuestionMetadataAction(qId, { kisi_kisi: res.kisi });
                alert("Kisi-kisi berhasil di-generate!");
            }
        } catch (err) { console.error(err); }
        finally { setIsGeneratingAI(null); }
    };

    const handleOpenEditor = (q: any = null) => {
        if (q && q.id) {
            // Deduplicate options before loading into editor
            const rawOptions = q.bank_question_options || q.options || [];
            const uniqueOptions = rawOptions;

            const loadedOptions = uniqueOptions.map((opt: any) => ({
                ...opt, text: opt.option_text || opt.text || '',
                isCorrect: opt.is_correct || opt.isCorrect || false,
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
                { text: '', isCorrect: true, order: 0, weight: 1 },
                { text: '', isCorrect: false, order: 1, weight: 0 },
                { text: '', isCorrect: false, order: 2, weight: 0 },
                { text: '', isCorrect: false, order: 3, weight: 0 },
            ]);
            const p = new URLSearchParams(window.location.search);
            p.delete("index");
            p.delete("preview");
            p.delete("edit");
            window.history.replaceState({}, "", `${window.location.pathname}${p.toString() ? "?" + p.toString() : ""}`);
        }
        setIsEditorOpen(true);
    };

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!org) return;
        setIsSubmitting(true);
        const result = await saveQuestionAction({
            id: editingQuestion?.id,
            bankId: bankId,
            type: selectedType,
            questionText,
            difficulty: 'medium',
            scoreDefault,
            stimulusId: stimulusId || null,
            instructionId: instructionId || null,
            dimensionId: dimensionId || null,
            kisi_kisi_id: kisiKisiId || null,
            metadata: {
                ...metadata,
                categories: selectedType === 'categorization' ? categories : [],
                kisi_kisi: kisiKisi,
                pembahasan: pembahasan
            },
            options: selectedType === 'essay' ? [] : options.map((opt, i) => ({
                id: opt.id, text: opt.text, isCorrect: opt.isCorrect, order: i, weight: 1,
                metadata: { match_texts: opt.match_texts || [], category_names: opt.category_names || [] }
            }))
        });
        if (result.success) {
            setIsEditorOpen(false);
            const p = new URLSearchParams(window.location.search);
            p.delete("index");
            p.delete("preview");
            p.delete("edit");
            window.history.replaceState({}, "", `${window.location.pathname}${p.toString() ? "?" + p.toString() : ""}`);
            await loadData();
        }
        setIsSubmitting(false);
    };

    const addOption = () => setOptions([...options, { text: '', isCorrect: false, order: options.length, weight: 0 }]);
    const removeOption = (idx: number) => setOptions(options.filter((_, i) => i !== idx));
    const updateOption = (idx: number, fields: any) => {
        const newOpts = [...options];
        newOpts[idx] = { ...newOpts[idx], ...fields };
        setOptions(newOpts);
    };

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

    const handleOpenView = (q: any) => {
        setMatchingAnswers({});
        setIsViewModalOpen(true);
        const idx = filteredQuestions.findIndex(fq => fq.id === q.id);
        if (idx >= 0) setCurrentPreviewIndex(idx);
        const params = new URLSearchParams(searchParams.toString());
        if (q?.id) { params.set('preview', q.id); params.set('index', idx >= 0 ? idx.toString() : '0'); }
        else { params.set('preview', 'all'); }
        router.push(`${pathname}?${params.toString()}`);
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
        const { exportQuestionsToWord } = await import('@/lib/export-template');
        try {
            const result = await exportQuestionsToWord(
                questions,
                bankInfo,
                stimuliList,
                instructionsList,
                kisiKisiList,
                dimensionsList
            );
            const url = window.URL.createObjectURL(result.blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = result.filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
        } catch (err: any) {
            console.error('Export failed:', err);
            alert('Gagal mengexport dokumen: ' + (err?.message || String(err)));
        }
    };

    const handleExportPdf = () => {
        window.open(`${questionsBasePath}/${bankId}?print=true`, '_blank');
    };

    const totalQuestions = questions.length;
    const lastUpdated = bankInfo?.updated_at ? new Date(bankInfo.updated_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '-';

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

    if (searchParams.get('print') === 'true') {
        if (isLoading) return <div className="min-h-screen flex items-center justify-center bg-slate-50"><div className="text-slate-500 font-medium animate-pulse">Menyiapkan dokumen cetak...</div></div>;
        return (
            <div className="min-h-screen bg-slate-200 flex flex-col print:bg-white print:p-0">
                <div className="print:hidden shrink-0 bg-white border-b border-slate-300 px-6 py-4 flex items-center justify-between sticky top-0 z-50 shadow-sm">
                    <h2 className="text-sm font-bold text-slate-800">Pratinjau Cetak — {bankInfo?.title || 'Bank Soal'}</h2>
                    <div className="flex items-center gap-3">
                        <button
                            onClick={() => window.print()}
                            className="px-5 py-2 bg-blue-600 text-white text-xs font-semibold rounded-lg hover:bg-blue-700 transition-all flex items-center gap-2"
                        >
                            <Printer size={14} /> Cetak / Save PDF
                        </button>
                        <button
                            onClick={() => window.close()}
                            className="px-5 py-2 bg-slate-100 text-slate-600 text-xs font-semibold rounded-lg hover:bg-slate-200 transition-all"
                        >
                            Tutup Tab
                        </button>
                    </div>
                </div>
                <div className="flex-1 p-8 print:p-0 overflow-y-auto">
                    <div className="max-w-[210mm] mx-auto bg-white shadow-xl print:shadow-none print:max-w-none print:mx-0">
                        <ExamPrintView bankInfo={bankInfo as any} questions={questions} />
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-50">
            {/* Header */}
            <div className="bg-white border-b border-slate-200 sticky top-16 lg:top-0 z-30 print:hidden">
                <div className="max-w-6xl mx-auto px-4 md:px-6">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between py-3 sm:py-0 sm:h-14 gap-3 sm:gap-0">
                        <div className="flex items-center gap-3 overflow-x-auto pb-1 sm:pb-0 scrollbar-hide">
                            <Link href={questionsBasePath} className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-700 whitespace-nowrap">
                                <ChevronLeft size={16} /> <span className="hidden sm:inline">Bank Soal</span>
                            </Link>
                            <div className="w-px h-5 bg-slate-200 shrink-0" />
                            <div className="flex items-center gap-2 shrink-0">
                                <div className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center">
                                    <BookOpen size={13} className="text-white" />
                                </div>
                                <h1 className="text-sm font-semibold text-slate-900 truncate max-w-[200px] sm:max-w-xs">{bankInfo?.title || 'Bank Soal'}</h1>
                            </div>
                        </div>
                        <div className="grid grid-cols-3 gap-2 w-full sm:w-auto shrink-0 sm:flex sm:items-center">
                            {/* Export Dropdown */}
                            <div className="relative w-full sm:w-auto" ref={exportDropdownRef}>
                                <button onClick={() => setIsExportOpen(!isExportOpen)} className="w-full justify-center px-1 sm:px-4 py-1.5 sm:py-2 text-[11px] sm:text-sm font-semibold text-slate-600 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg flex items-center gap-1 sm:gap-2 h-[34px] sm:h-[38px] transition-all shadow-sm">
                                    <FileDown size={14} className="shrink-0 sm:w-[15px] sm:h-[15px]" /> <span className="truncate">Export</span> <ChevronDown size={12} className="shrink-0" />
                                </button>
                                {isExportOpen && (
                                    <div className="absolute left-0 sm:right-0 sm:left-auto top-full mt-1.5 w-56 bg-white border border-slate-200 rounded-lg shadow-xl z-50 overflow-hidden">
                                        <div className="px-3 py-2 border-b border-slate-100">
                                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Export Dokumen</p>
                                        </div>
                                        <button onClick={() => { handleExportWord(); setIsExportOpen(false); }} className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-slate-50 transition-colors">
                                            <div className="w-7 h-7 rounded-lg bg-blue-50 flex items-center justify-center"><FileText size={13} className="text-blue-600" /></div>
                                            <div className="text-left"><p className="text-xs font-semibold text-slate-700">Bank Soal (Word)</p><p className="text-[10px] text-slate-400">Format tabel siap import</p></div>
                                        </button>
                                        <div className="border-t border-slate-100" />
                                        <button onClick={() => { handleExportPdf(); setIsExportOpen(false); }} className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-slate-50 transition-colors">
                                            <div className="w-7 h-7 rounded-lg bg-red-50 flex items-center justify-center"><Printer size={13} className="text-red-600" /></div>
                                            <div className="text-left"><p className="text-xs font-semibold text-slate-700">Lembar Ujian (PDF-ready)</p><p className="text-[10px] text-slate-400">Siap print, form jawaban</p></div>
                                        </button>
                                    </div>
                                )}
                            </div>

                            <button onClick={() => { setIsViewModalOpen(true); setViewingQuestion(null); }} className="w-full justify-center px-1 sm:px-4 py-1.5 sm:py-2 text-[11px] sm:text-sm font-semibold text-slate-600 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg flex items-center gap-1 sm:gap-2 h-[34px] sm:h-[38px] transition-all shadow-sm">
                                <Eye size={14} className="shrink-0 sm:w-[15px] sm:h-[15px]" /> <span className="truncate">Pratinjau</span>
                            </button>
                            <button
                                onClick={async () => {
                                    if (!org) return;
                                    const result = await toggleQuestionBankPublishAction(bankId, !bankInfo?.is_published);
                                    if (result.success) await loadData();
                                }}
                                className={`w-full justify-center px-1 sm:px-4 py-1.5 sm:py-2 rounded-lg text-[11px] sm:text-sm font-semibold transition-all h-[34px] sm:h-[38px] flex items-center ${bankInfo?.is_published ? 'bg-red-50 border border-red-200 text-red-600 hover:bg-red-100' : 'bg-emerald-500 text-white hover:bg-emerald-600'}`}
                            >
                                <span className="truncate">{bankInfo?.is_published ? 'Unpublish' : 'Publish'}</span>
                            </button>
                        </div>
                    </div>
                    {/* Tabs */}
                    <div className="flex items-center gap-4 sm:gap-6 mt-1 border-b border-transparent overflow-x-auto scrollbar-hide">
                        <button
                            onClick={() => setActiveTab('questions')}
                            className={`pb-3 text-xs sm:text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${activeTab === 'questions' ? 'border-primary text-primary' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
                        >
                            Daftar Soal
                        </button>
                        <button
                            onClick={() => setActiveTab('stimuli')}
                            className={`pb-3 text-xs sm:text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${activeTab === 'stimuli' ? 'border-primary text-primary' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
                        >
                            Daftar Stimulus
                        </button>
                        <button
                            onClick={() => setActiveTab('instructions')}
                            className={`pb-3 text-xs sm:text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${activeTab === 'instructions' ? 'border-primary text-primary' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
                        >
                            Daftar Petunjuk
                        </button>
                        <button
                            onClick={() => setActiveTab('dimensions')}
                            className={`pb-3 text-xs sm:text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${activeTab === 'dimensions' ? 'border-primary text-primary' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
                        >
                            Daftar Dimensi
                        </button>
                        <button
                            onClick={() => setActiveTab('kisikisi')}
                            className={`pb-3 text-xs sm:text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${activeTab === 'kisikisi' ? 'border-primary text-primary' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
                        >
                            Kisi-kisi Soal
                        </button>
                    </div>
                </div>
            </div>

            {/* Content */}
            <div className="max-w-6xl mx-auto px-4 md:px-6 py-6 space-y-6 print:hidden">
                {activeTab === 'stimuli' ? (
                    <StimulusManager bankId={bankId} />
                ) : activeTab === 'instructions' ? (
                    <InstructionManager bankId={bankId} />
                ) : activeTab === 'dimensions' ? (
                    <DimensionManager bankId={bankId} />
                ) : activeTab === 'kisikisi' ? (
                    <KisiKisiTab bankId={bankId} />
                ) : (
                    <>
                        {/* Stats */}
                        <div className="grid grid-cols-3 sm:flex sm:flex-wrap gap-2 sm:gap-3 w-full pb-2">
                            <div 
                                onClick={() => setFilterType('all')}
                                className={`rounded-lg px-1 sm:px-4 py-2 sm:py-2.5 shadow-sm text-center w-full sm:w-[140px] shrink-0 cursor-pointer transition-all ${filterType === 'all' ? 'bg-blue-100 border-2 border-blue-400' : 'bg-blue-50 border border-blue-200 hover:bg-blue-100'}`}
                            >
                                <p className="text-[9px] sm:text-[10px] font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap overflow-hidden text-ellipsis">Total Questions</p>
                                <p className="text-base sm:text-lg font-bold text-primary stat-count">{totalQuestions}</p>
                            </div>
                            {(() => {
                                const typeMap: Record<string, { label: string }> = {
                                    mcq: { label: 'MCQ' },
                                    mcq_complex: { label: 'MCQ Complex' },
                                    true_false: { label: 'True/False' },
                                    matching: { label: 'Matching' },
                                    categorization: { label: 'Categorization' },
                                    short_answer: { label: 'Short Answer' },
                                    essay: { label: 'Essay' },
                                    sjt: { label: 'SJT' },
                                    likert: { label: 'Likert' },
                                    forced_choice: { label: 'Forced Choice' },
                                    checklist: { label: 'Checklist' },
                                    ranking: { label: 'Ranking' },
                                    paired_comparison: { label: 'Paired Comp' },
                                    ordering: { label: 'Ordering' }
                                };

                                const typeCounts = questions.reduce((acc, q) => {
                                    acc[q.type] = (acc[q.type] || 0) + 1;
                                    return acc;
                                }, {} as Record<string, number>);

                                return Object.entries(typeMap).map(([type, meta]) => {
                                    const count = typeCounts[type] || 0;
                                    if (count === 0) return null;
                                    return (
                                        <div 
                                            key={type} 
                                            onClick={() => setFilterType(type)}
                                            className={`rounded-lg px-1 sm:px-4 py-2 sm:py-2.5 shadow-sm text-center w-full sm:w-[140px] shrink-0 cursor-pointer transition-all ${filterType === type ? 'bg-blue-100 border-2 border-blue-400' : 'bg-blue-50 border border-blue-200 hover:bg-blue-100'}`}
                                        >
                                            <p className="text-[9px] sm:text-[10px] font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap overflow-hidden text-ellipsis">{meta.label}</p>
                                            <p className="text-base sm:text-lg font-bold text-primary stat-count">{count}</p>
                                        </div>
                                    );
                                });
                            })()}
                        </div>

                 {/* Search & Actions */}
                 <div className="flex flex-col sm:flex-row gap-3">
                     <div className="relative flex-1 w-full sm:w-auto">
                         <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                         <input
                             type="text"
                             placeholder="Cari soal..."
                             value={searchQuery}
                             onChange={(e) => setSearchQuery(e.target.value)}
                             className="w-full bg-white border border-slate-200 rounded-lg h-[38px] pl-10 pr-4 text-sm focus:ring-2 focus:ring-primary/10 focus:border-primary/30 outline-none"
                         />
                     </div>
                     <div className="flex items-center gap-2 shrink-0 w-full sm:w-auto overflow-x-auto pb-1 sm:pb-0 scrollbar-hide">
                         {filteredQuestions.length > 0 && (
                             <button onClick={toggleSelectAll} className="flex-1 sm:flex-none justify-center px-2 sm:px-3 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-600 text-xs sm:text-sm font-medium rounded-lg flex items-center gap-1.5 sm:gap-2 h-[38px] transition-colors">
                                 {selectedQuestions.size === filteredQuestions.length ? <CheckSquare size={15} className="text-blue-600" /> : <Square size={15} />}
                                 <span className="hidden sm:inline">Semua</span>
                             </button>
                         )}
                         {selectedQuestions.size > 0 && (
                             <button onClick={requestBulkDelete} disabled={isBulkDeleting} className="flex-1 sm:flex-none justify-center px-2 sm:px-4 py-2 bg-red-50 hover:bg-red-100 border border-red-200 text-red-600 text-xs sm:text-sm font-medium rounded-lg flex items-center gap-1.5 sm:gap-2 h-[38px] transition-colors disabled:opacity-50">
                                 {isBulkDeleting ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />} 
                                 <span className="hidden sm:inline">Hapus ({selectedQuestions.size})</span>
                                 <span className="sm:hidden">{selectedQuestions.size}</span>
                             </button>
                         )}
                         <button onClick={() => setIsImportModalOpen(true)} className="flex-1 sm:flex-none justify-center px-2 sm:px-4 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-600 text-xs sm:text-sm font-medium rounded-lg flex items-center gap-1.5 sm:gap-2 h-[38px]">
                             <Upload size={15} /> Import
                         </button>
                         <button onClick={() => handleOpenEditor()} className="flex-1 sm:flex-none justify-center px-2 sm:px-4 py-2 bg-primary hover:bg-primary/95 text-white text-xs sm:text-sm font-semibold rounded-lg flex items-center gap-1.5 sm:gap-2 h-[38px]">
                             <Plus size={16} /> Tambah
                         </button>
                     </div>
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
                            const meta = typeof q.metadata === 'string' ? JSON.parse(q.metadata || '{}') : (q.metadata || {});
                            
                            const stim = Array.isArray(q.stimulus) ? q.stimulus[0] : q.stimulus;
                            const hasStimulus = !!(stim?.content || meta.import_stimulus);
                            
                            const inst = Array.isArray(q.instruction) ? q.instruction[0] : q.instruction;
                            const hasInstruction = !!(inst?.content || meta.import_instruction);
                            
                            const hasKisi = !!(q.kisi_kisi_id || meta.kisi_kisi);
                            
                            // Hitung total icon aksi
                        const actionCount = 3 + (hasStimulus ? 1 : 0) + (hasInstruction ? 1 : 0) + (hasKisi ? 1 : 0);

                            return (
                                <div key={q.id} className="bg-white rounded-lg border border-slate-100 hover:border-primary/30 hover:shadow-xl hover:shadow-primary/5 transition-all">
                                    <div className="flex flex-col sm:flex-row sm:items-center justify-between px-4 sm:px-5 py-3 sm:py-4 border-b border-slate-100 gap-3 sm:gap-0">
                                        {/* Kiri (Desktop) / Baris Atas (Mobile) */}
                                        <div className="flex items-center justify-between w-full sm:w-auto">
                                            <div className="flex items-center gap-3">
                                                <button
                                                    type="button"
                                                    onClick={() => toggleSelectQuestion(q.id)}
                                                    className={`w-10 h-10 rounded flex items-center justify-center shrink-0 relative transition-all duration-200 cursor-pointer ${
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
                                                <div className="min-w-0">
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        <span className="text-xs font-medium text-slate-500 uppercase">{q.type?.replace('_', ' ')}</span>
                                                        {q.score_default > 1 && (
                                                            <span className="text-xs bg-amber-50 text-amber-600 px-2 py-0.5 rounded-full whitespace-nowrap">{q.score_default} poin</span>
                                                        )}
                                                        {q.type === 'sjt' && q.question_dimensions && (
                                                            <span className="text-xs bg-indigo-50 border border-indigo-200 text-indigo-700 px-2 py-0.5 rounded-full flex items-center gap-1 whitespace-nowrap overflow-hidden text-ellipsis max-w-full">
                                                                <Target size={12} className="shrink-0" />
                                                                <span className="truncate">{q.question_dimensions.name}</span>
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                            
                                            {/* Panah Naik Turun (Khusus Mobile di Pojok Kanan Atas) */}
                                            <div className="flex sm:hidden items-center gap-1 shrink-0 ml-3">
                                                {filteredQuestions.length > 1 && (
                                                    <>
                                                        <button onClick={() => handleMoveQuestion(idx, 'up')} disabled={idx === 0} className="p-2 text-slate-400 hover:bg-slate-100 rounded-lg disabled:opacity-30"><ChevronUp size={16} /></button>
                                                        <button onClick={() => handleMoveQuestion(idx, 'down')} disabled={idx === filteredQuestions.length - 1} className="p-2 text-slate-400 hover:bg-slate-100 rounded-lg disabled:opacity-30"><ChevronDown size={16} /></button>
                                                    </>
                                                )}
                                            </div>
                                        </div>

                                        {/* Kanan (Desktop) / Baris Bawah (Mobile) */}
                                        <div className="flex items-center justify-center gap-1 sm:gap-1 mt-3 sm:mt-0 w-full sm:w-auto shrink-0">
                                            {/* Panah Naik Turun (Khusus Desktop) */}
                                            <div className="hidden sm:flex items-center justify-center gap-1 sm:w-[60px] shrink-0">
                                                {filteredQuestions.length > 1 && (
                                                    <>
                                                        <button onClick={() => handleMoveQuestion(idx, 'up')} disabled={idx === 0} className="p-2 text-slate-400 hover:bg-slate-100 rounded-lg disabled:opacity-30"><ChevronUp size={14} /></button>
                                                        <button onClick={() => handleMoveQuestion(idx, 'down')} disabled={idx === filteredQuestions.length - 1} className="p-2 text-slate-400 hover:bg-slate-100 rounded-lg disabled:opacity-30"><ChevronDown size={14} /></button>
                                                    </>
                                                )}
                                            </div>

                                            {/* Tombol Aksi (Tampil Lebar di Mobile) */}
                                            <div className={`flex items-center sm:flex-none gap-2 sm:gap-1 w-full sm:w-[200px] shrink-0 ${actionCount >= 5 ? 'justify-between sm:justify-end' : 'justify-end'}`}>
                                                {hasInstruction && (
                                                    <button title="Petunjuk" onClick={() => handleOpenView(q)} className={`sm:flex-none flex justify-center py-2 sm:p-2 text-slate-400 hover:text-indigo-500 hover:bg-indigo-50 rounded-lg transition-colors ${actionCount >= 5 ? 'flex-1 sm:flex-none' : 'w-11 sm:w-auto sm:px-2'}`}><BookOpen size={16} className="sm:w-[14px] sm:h-[14px]" /></button>
                                                )}
                                                {hasStimulus && (
                                                    <button title="Stimulus" onClick={() => handleOpenView(q)} className={`sm:flex-none flex justify-center py-2 sm:p-2 text-slate-400 hover:text-blue-500 hover:bg-blue-50 rounded-lg transition-colors ${actionCount >= 5 ? 'flex-1 sm:flex-none' : 'w-11 sm:w-auto sm:px-2'}`}><FileText size={16} className="sm:w-[14px] sm:h-[14px]" /></button>
                                                )}
                                                {hasKisi && (
                                                    <button title="Kisi-kisi" onClick={() => handleOpenView(q)} className={`sm:flex-none flex justify-center py-2 sm:p-2 text-slate-400 hover:text-purple-500 hover:bg-purple-50 rounded-lg transition-colors ${actionCount >= 5 ? 'flex-1 sm:flex-none' : 'w-11 sm:w-auto sm:px-2'}`}><FileSearch size={16} className="sm:w-[14px] sm:h-[14px]" /></button>
                                                )}
                                                <button title="Lihat" onClick={() => handleOpenView(q)} className={`sm:flex-none flex justify-center py-2 sm:p-2 text-slate-400 hover:text-primary hover:bg-slate-100 rounded-lg transition-colors ${actionCount >= 5 ? 'flex-1 sm:flex-none' : 'w-11 sm:w-auto sm:px-2'}`}><Eye size={16} className="sm:w-[14px] sm:h-[14px]" /></button>
                                                <button title="Edit" onClick={() => handleOpenEditor(q)} className={`sm:flex-none flex justify-center py-2 sm:p-2 text-slate-400 hover:text-primary hover:bg-slate-100 rounded-lg transition-colors ${actionCount >= 5 ? 'flex-1 sm:flex-none' : 'w-11 sm:w-auto sm:px-2'}`}><Edit3 size={16} className="sm:w-[14px] sm:h-[14px]" /></button>
                                                <button title="Hapus" onClick={() => requestDelete(q.id)} className={`sm:flex-none flex justify-center py-2 sm:p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors ${actionCount >= 5 ? 'flex-1 sm:flex-none' : 'w-11 sm:w-auto sm:px-2'}`}><Trash2 size={16} className="sm:w-[14px] sm:h-[14px]" /></button>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="px-5 py-4 bg-white">
                                        <div className="text-sm text-slate-800 leading-relaxed" style={{overflow: 'visible'}}><QuestionContent content={q.question_text} /></div>
                                    </div>
                                    {q.type === 'true_false' && (q.bank_question_options || []).filter((o: any) => (o.option_text || o.text || '').trim()).length > 0 && (
                                        <div className="px-5 pt-3 pb-4">
                                            <div className="flex flex-col gap-1.5">
                                                {(q.bank_question_options || []).filter((o: any) => (o.option_text || o.text || '').trim()).map((opt: any, oIdx: number) => (
                                                    <div key={opt.id} className={`flex items-center gap-2.5 px-3 py-2 rounded-md border text-xs ${opt.is_correct ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-red-50 border-red-200 text-red-800'}`}>
                                                        <span className={`w-6 h-6 rounded flex items-center justify-center text-xs font-bold leading-none pt-[1px] ${opt.is_correct ? 'bg-emerald-500 text-white' : 'bg-red-500 text-white'}`}>{opt.is_correct ? 'B' : 'S'}</span>
                                                        <span className="flex-1"><QuestionContent content={opt.option_text || opt.text} /></span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                    {q.type === 'matching' && (q.bank_question_options || []).filter((o: any) => (o.option_text || o.text || '').trim()).length > 0 && (
                                        <div className="px-5 pt-3 pb-4">
                                            <div className="flex flex-col gap-1.5">
                                                {(q.bank_question_options || []).filter((o: any) => (o.option_text || o.text || '').trim()).map((opt: any, oIdx: number) => {
                                                    const matches = opt.metadata?.match_texts || [];
                                                    return (
                                                        <div key={opt.id} className="flex items-center gap-2.5 px-3 py-2 rounded-md border bg-slate-50 border-slate-100 text-xs text-slate-600">
                                                            <span className="w-6 h-6 rounded flex items-center justify-center text-xs font-bold leading-none pt-[1px] bg-primary text-white">{String.fromCharCode(65 + oIdx)}</span>
                                                            <span className="flex-1"><QuestionContent content={opt.option_text || opt.text} /></span>
                                                            <span className="text-slate-400 text-[10px]">→</span>
                                                            <span className="text-primary font-medium">{matches.join(', ') || '-'}</span>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )}
                                    {q.type === 'categorization' && (q.bank_question_options || []).filter((o: any) => (o.option_text || o.text || '').trim()).length > 0 && (
                                        <div className="px-5 pt-3 pb-4">
                                            <div className="flex flex-col gap-1.5">
                                                {(q.bank_question_options || []).filter((o: any) => (o.option_text || o.text || '').trim()).map((opt: any, oIdx: number) => {
                                                    const cats = opt.metadata?.category_names || [];
                                                    return (
                                                        <div key={opt.id} className="flex items-center gap-2.5 px-3 py-2 rounded-md border bg-slate-50 border-slate-100 text-xs text-slate-600">
                                                            <span className="w-6 h-6 rounded flex items-center justify-center text-xs font-bold leading-none pt-[1px] bg-primary text-white">{String.fromCharCode(65 + oIdx)}</span>
                                                            <span className="flex-1"><QuestionContent content={opt.option_text || opt.text} /></span>
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
                                                {(meta.blanks || []).map((blank: any, bIdx: number) => (
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
                                                        <Check size={13} className="text-emerald-500 shrink-0" strokeWidth={3} />
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
                                    {(q.type === 'mcq' || q.type === 'mcq_complex') && q.bank_question_options?.filter((o: any) => (o.option_text || o.text || '').trim()).length > 0 && (
                                        <div className="px-5 pt-3 pb-4">
                                            <div className="flex flex-col gap-1.5">
                                                {q.bank_question_options.filter((o: any) => (o.option_text || o.text || '').trim()).map((opt: any, oIdx: number) => (
                                                    <div key={opt.id} className={`flex items-center gap-2.5 px-3 py-2 rounded-md border text-xs ${opt.is_correct ? 'bg-blue-50 border-blue-200 text-blue-800' : 'bg-slate-50 border-slate-100 text-slate-600'}`}>
                                                        <span className={`w-6 h-6 rounded flex items-center justify-center text-xs font-bold leading-none pt-[1px] ${opt.is_correct ? 'bg-blue-500 text-white' : 'bg-slate-200 text-slate-600'}`}>{String.fromCharCode(65 + oIdx)}</span>
                                                        <span className="flex-1"><QuestionContent content={opt.option_text || opt.text} /></span>
                                                        {opt.is_correct && <Check size={13} className="text-green-500 shrink-0" />}
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                    {q.type === 'sjt' && q.bank_question_options?.filter((o: any) => (o.option_text || o.text || '').trim()).length > 0 && (
                                        <div className="px-5 pt-3 pb-4">
                                            <div className="flex flex-col gap-1.5">
                                                {q.bank_question_options.filter((o: any) => (o.option_text || o.text || '').trim()).map((opt: any, oIdx: number) => {
                                                    const isHighest = opt.weight === Math.max(...(q.bank_question_options || []).map((o: any) => o.weight || 0));
                                                    const dimId = opt.metadata?.dimension_id || opt.dimension_id;
                                                    const dimName = dimensionsList?.find((d: any) => d.id === dimId)?.name;
                                                    return (
                                                        <div key={opt.id} className={`flex items-center gap-2.5 px-3 py-2 rounded-md border text-xs ${isHighest ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-slate-50 border-slate-100 text-slate-600'}`}>
                                                            <span className={`w-6 h-6 rounded flex items-center justify-center text-xs font-bold leading-none pt-[1px] ${isHighest ? 'bg-emerald-500 text-white' : 'bg-slate-200 text-slate-600'}`}>{String.fromCharCode(65 + oIdx)}</span>
                                                            <span className="flex-1"><QuestionContent content={opt.option_text || opt.text} /></span>
                                                            {dimName && (
                                                                <div className="bg-indigo-50 text-indigo-600 px-2 py-1 rounded text-[10px] font-bold border border-indigo-100 whitespace-nowrap shrink-0 flex items-center gap-1">
                                                                    <Target size={10} /> {dimName}
                                                                </div>
                                                            )}
                                                            <div className="bg-[#0038A8]/10 text-[#0038A8] px-2 py-1 rounded text-[10px] font-bold border border-[#0038A8]/20 whitespace-nowrap shrink-0">
                                                                {opt.weight || 0} Poin
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )}
                                    {q.type === 'ordering' && q.bank_question_options?.filter((o: any) => (o.option_text || o.text || '').trim()).length > 0 && (
                                        <div className="px-5 pt-3 pb-4">
                                            <div className="flex flex-col gap-1.5">
                                                {q.bank_question_options.filter((o: any) => (o.option_text || o.text || '').trim()).sort((a: any, b: any) => a.order - b.order).map((opt: any, oIdx: number) => (
                                                    <div key={opt.id} className="flex items-center gap-2.5 px-3 py-2 rounded-md border bg-slate-50 border-slate-100 text-xs text-slate-600">
                                                        <span className="w-6 h-6 rounded flex items-center justify-center text-[10px] font-bold leading-none pt-[1px] bg-blue-500 text-white shrink-0">{oIdx + 1}</span>
                                                        <span className="flex-1"><QuestionContent content={opt.option_text || opt.text} /></span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                    {['forced_choice', 'checklist', 'ranking'].includes(q.type) && q.bank_question_options?.filter((o: any) => (o.option_text || o.text || '').trim()).length > 0 && (
                                        <div className="px-5 pt-3 pb-4">
                                            <div className="flex flex-col gap-1.5">
                                                {q.bank_question_options.filter((o: any) => (o.option_text || o.text || '').trim()).map((opt: any, oIdx: number) => {
                                                    const dimId = opt.metadata?.dimension_id || opt.dimension_id;
                                                    const dimName = dimensionsList?.find((d: any) => d.id === dimId)?.name;
                                                    return (
                                                        <div key={opt.id} className="flex items-center gap-2.5 px-3 py-2 rounded-md border bg-slate-50 border-slate-100 text-xs text-slate-600">
                                                            <span className="w-6 h-6 rounded flex items-center justify-center text-[10px] font-bold leading-none pt-[1px] bg-indigo-500 text-white shrink-0">P{oIdx + 1}</span>
                                                            <span className="flex-1"><QuestionContent content={opt.option_text || opt.text} /></span>
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
                                    {q.type === 'paired_comparison' && q.bank_question_options?.filter((o: any) => (o.option_text || o.text || '').trim()).length > 0 && (
                                        <div className="px-5 pt-3 pb-4">
                                            <div className="flex flex-col gap-1.5">
                                                {q.bank_question_options.filter((o: any) => (o.option_text || o.text || '').trim()).map((opt: any, oIdx: number) => {
                                                    const dimId = opt.metadata?.dimension_id || opt.dimension_id;
                                                    const dimName = dimensionsList?.find((d: any) => d.id === dimId)?.name;
                                                    return (
                                                        <div key={opt.id} className="flex items-center gap-2.5 px-3 py-2 rounded-md border bg-pink-50/50 border-pink-100 text-xs text-slate-600">
                                                            <span className="w-6 h-6 rounded flex items-center justify-center text-[10px] font-bold leading-none pt-[1px] bg-pink-500 text-white shrink-0">{oIdx === 0 ? 'A' : 'B'}</span>
                                                            <span className="flex-1"><QuestionContent content={opt.option_text || opt.text} /></span>
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
                                    {q.type === 'likert' && q.bank_question_options?.filter((o: any) => (o.option_text || o.text || '').trim()).length > 0 && (
                                        <div className="px-5 pt-3 pb-4">
                                            <div className="flex flex-wrap gap-2">
                                                {q.bank_question_options.filter((o: any) => (o.option_text || o.text || '').trim()).sort((a: any, b: any) => a.order - b.order).map((opt: any, oIdx: number) => (
                                                    <div key={opt.id} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border bg-emerald-50/50 border-emerald-100 text-xs text-emerald-800">
                                                        <span className="font-medium"><QuestionContent content={opt.option_text || opt.text} /></span>
                                                        <span className="text-[10px] bg-emerald-200/50 text-emerald-700 px-1.5 rounded font-semibold whitespace-nowrap">Skor: {opt.weight || 0}</span>
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
                                <button onClick={() => handleOpenEditor()} className="inline-flex items-center gap-2 bg-primary text-white px-6 py-3 rounded-lg text-sm font-medium hover:bg-primary/90">
                                    <Plus size={18} /> Tambah Soal
                                </button>
                            </div>
                        )}
                    </div>
                )}
                    </>
                )}
            </div>

            {/* Modals */}
            {isEditorOpen && (
                <QuestionEditorModal
                    isOpen={isEditorOpen}
                    editingQuestion={editingQuestion}
                    bankId={bankId}
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
                studentClass={org?.title}
            />

            <BulkImportModal
                isOpen={isImportModalOpen}
                onClose={() => setIsImportModalOpen(false)}
                bankId={bankId}
                userId={userId}
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
