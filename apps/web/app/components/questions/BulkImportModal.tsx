"use client";
import { getErrorMessage } from '@/lib/errors';
import { Spinner } from '@/app/components/ui/Spinner';
import { QUESTION_TYPE_LABELS } from '@/app/types/question';
import { bulkImportQuestions } from '@/lib/api/imports';
import { listQuestionBanks,type QuestionBank,type QuestionRecord } from '@/lib/api/questions';
import { parseDocxToQuestions } from '@/lib/doc-parser';
import {
ImportResult,
ParsedQuestion,
parseExcelToQuestions,
validateQuestions
} from '@/lib/excel-parser';
import { optionLabel } from '@/lib/option-label';
import { portableQuestion } from '@/lib/question-transfer';
import { AnimatePresence,motion } from 'framer-motion';
import {
AlertTriangle,
ArrowRight,
Check,
CheckCircle2,
ChevronLeft,
ChevronRight,
Database,
Download,
File,
FileSpreadsheet,
FileText,
Loader2,
Search,
Table,
Upload,
X,
XCircle
} from 'lucide-react';
import React,{ useCallback,useEffect,useMemo,useRef,useState } from 'react';
import { LatexRenderer } from './LatexRenderer';

interface BulkImportModalProps {
    isOpen: boolean;
    onClose: () => void;
    bankId: string;
    onImportComplete: () => Promise<void>;
}

type ImportStep = 'upload' | 'preview' | 'importing' | 'complete';
type FileType = 'xlsx' | 'docx' | 'csv';
type ImportTab = 'file' | 'bank';
type SourceBankQuestion = QuestionRecord & { transfer: ParsedQuestion };

const TYPE_COLORS: Record<string, { bg: string; text: string; border: string }> = {
    mcq: { bg: 'bg-blue-50', text: 'text-blue-600', border: 'border-blue-200' },
    mcq_complex: { bg: 'bg-purple-50', text: 'text-purple-600', border: 'border-purple-200' },
    true_false: { bg: 'bg-amber-50', text: 'text-amber-600', border: 'border-amber-200' },
    matching: { bg: 'bg-rose-50', text: 'text-rose-600', border: 'border-rose-200' },
    categorization: { bg: 'bg-violet-50', text: 'text-violet-600', border: 'border-violet-200' },
    short_answer: { bg: 'bg-cyan-50', text: 'text-cyan-600', border: 'border-cyan-200' },
    essay: { bg: 'bg-emerald-50', text: 'text-emerald-600', border: 'border-emerald-200' },
    sjt: { bg: 'bg-indigo-50', text: 'text-indigo-600', border: 'border-indigo-200' },
    ordering: { bg: 'bg-pink-50', text: 'text-pink-600', border: 'border-pink-200' },
};

export default function BulkImportModal({
    isOpen,
    onClose,
    bankId,
    onImportComplete
}: BulkImportModalProps) {
    const importRequests = useRef(new Map<string, string>());
    const requestIdFor = useCallback((questions: unknown) => {
        const key = JSON.stringify([bankId, questions]);
        let id = importRequests.current.get(key);
        if (!id) { id = crypto.randomUUID(); importRequests.current.set(key, id); }
        return id;
    }, [bankId]);
    const [step, setStep] = useState<ImportStep>('upload');
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [fileType, setFileType] = useState<FileType>('docx');
    const [isProcessing, setIsProcessing] = useState(false);
    const [parseResult, setParseResult] = useState<ImportResult | null>(null);
    const [importProgress, setImportProgress] = useState(0);
    const [importError, setImportError] = useState<string | null>(null);
    const [selectedQuestions, setSelectedQuestions] = useState<Set<number>>(new Set());
    const [editableQuestions, setEditableQuestions] = useState<ParsedQuestion[]>([]);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // ── Cross-bank import state ───────────────────────────────────────────────
    const [importTab, setImportTab] = useState<ImportTab>('file');
    const [allBanks, setAllBanks] = useState<QuestionBank[]>([]);
    const [selectedSourceBank, setSelectedSourceBank] = useState<string>('');
    const [sourceBankQuestions, setSourceBankQuestions] = useState<SourceBankQuestion[]>([]);
    const [sourceLoading, setSourceLoading] = useState(false);
    const [selectedCrossQuestions, setSelectedCrossQuestions] = useState<Set<string>>(new Set());
    const [searchSourceQuery, setSearchSourceQuery] = useState('');

    const resetState = useCallback(() => {
        setStep('upload');
        setSelectedFile(null);
        setParseResult(null);
        setImportProgress(0);
        setSelectedQuestions(new Set());
        setEditableQuestions([]);
        setImportTab('file');
        setSelectedSourceBank('');
        setSourceBankQuestions([]);
        setSelectedCrossQuestions(new Set());
        setSearchSourceQuery('');
    }, []);

    const handleClose = useCallback(() => {
        resetState();
        onClose();
    }, [resetState, onClose]);

    // ── Load all banks when "Import dari Bank" tab is selected ────────────────
    useEffect(() => {
        if (!isOpen || importTab !== 'bank' || allBanks.length > 0) return;

        let active = true;
        void listQuestionBanks()
            .then(banks => {
                if (!active) return;
                setAllBanks((banks || []).filter((bank) => bank.id !== bankId));
            })
            .catch(err => {
                console.error('Failed to load banks:', err);
            });

        return () => {
            active = false;
        };
    }, [allBanks.length, bankId, importTab, isOpen]);

    // ── Load questions from selected source bank ─────────────────────────────
    const loadSourceBankQuestions = useCallback(async (srcBankId: string) => {
        setSourceLoading(true);
        setSourceBankQuestions([]);
        setSelectedCrossQuestions(new Set());
        try {
            const { getBankQuestions } = await import('@/lib/api/questions');
            const { getDimensionsByBank } = await import('@/lib/api/questions');
            const [questions, dimensions] = await Promise.all([getBankQuestions(srcBankId), getDimensionsByBank(srcBankId)]);
            setSourceBankQuestions((questions || []).map(q => ({ ...q, transfer: portableQuestion(q, { dimensions }) })));
        } catch (err) {
            console.error('Failed to load source questions:', err);
        } finally {
            setSourceLoading(false);
        }
    }, []);

    const handleSourceBankChange = useCallback((srcBankId: string) => {
        setSelectedSourceBank(srcBankId);
        if (srcBankId) {
            loadSourceBankQuestions(srcBankId);
        }
    }, [loadSourceBankQuestions]);

    const toggleCrossQuestion = useCallback((qId: string) => {
        setSelectedCrossQuestions(prev => {
            const next = new Set(prev);
            if (next.has(qId)) next.delete(qId);
            else next.add(qId);
            return next;
        });
    }, []);

    const selectAllCross = useCallback(() => {
        setSelectedCrossQuestions(new Set(sourceBankQuestions.map((question) => question.id)));
    }, [sourceBankQuestions]);

    const deselectAllCross = useCallback(() => {
        setSelectedCrossQuestions(new Set());
    }, []);

    const handleStartCrossImport = useCallback(async () => {
        if (selectedCrossQuestions.size === 0) return;

        setStep('importing');
        setImportProgress(0);
        setImportError(null);

        try {
            const questionsToImport = sourceBankQuestions
                .filter((question) => selectedCrossQuestions.has(question.id))
                .map((question) => {
                    const value = question.transfer;
                    return {
                        question_text: value.question_text, type: value.type,
                        difficulty: value.difficulty, score_default: value.scoreDefault,
                        metadata: value.metadata,
                        options: value.options.map((option) => ({
                            option_text: option.text, is_correct: option.isCorrect ?? false,
                            order: option.order, weight: option.weight, metadata: option.metadata,
                        })),
                    };
                });

            const clientRequestId = requestIdFor(questionsToImport);
            const result = await bulkImportQuestions(bankId, questionsToImport, clientRequestId);

            if (result.success && result.failed === 0 && result.errors.length === 0 && result.imported === questionsToImport.length) {
                importRequests.current.delete(JSON.stringify([bankId, questionsToImport]));
                setImportProgress(100);
                setTimeout(async () => {
                    await onImportComplete();
                    handleClose();
                }, 1000);
            } else {
                const msg = result.errors?.[0]?.message || 'Import gagal tanpa pesan error.';
                const extra = (result.errors?.length || 0) > 1 ? ` (+${result.errors.length - 1} error lain)` : '';
                setImportError(msg + extra);
            }
        } catch (error) {
            console.error('Cross-import error:', error);
            setImportError(getErrorMessage(error) || 'Terjadi kesalahan saat mengimpor.');
        }
    }, [selectedCrossQuestions, sourceBankQuestions, bankId, onImportComplete, handleClose, requestIdFor]);

    // ── File import handlers ───────────────────────────────────────────────────
    const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const ext = file.name.split('.').pop()?.toLowerCase();
        if (ext === 'xlsx' || ext === 'xls') setFileType('xlsx');
        else if (ext === 'docx') setFileType('docx');
        else if (ext === 'csv') setFileType('csv');
        setSelectedFile(file);
    }, []);

    const handleDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
    }, []);

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const file = e.dataTransfer.files?.[0];
        if (!file) return;
        const ext = file.name.split('.').pop()?.toLowerCase();
        if (['xlsx', 'xls', 'docx', 'csv'].includes(ext || '')) {
            setSelectedFile(file);
            if (ext === 'xlsx' || ext === 'xls') setFileType('xlsx');
            else if (ext === 'docx') setFileType('docx');
            else setFileType('csv');
        }
    }, []);

    const handleParseFile = useCallback(async () => {
        if (!selectedFile) return;
        setIsProcessing(true);
        setEditableQuestions([]);
        setSelectedQuestions(new Set());
        setStep('preview');
        try {
            let result: ImportResult;
            if (fileType === 'xlsx' || fileType === 'csv') {
                result = await parseExcelToQuestions(selectedFile);
            } else {
                const parsedDocx = await parseDocxToQuestions(selectedFile);

                // Check if stimulus/instruction were detected
                const hasStimulusCode = parsedDocx.some(q => q.metadata?._stimulus_code);
                const hasInstructionCode = parsedDocx.some(q => q.metadata?._instruction_code);
                const warnings: ImportResult['warnings'] = [];
                if (!hasStimulusCode && !hasInstructionCode) {
                    warnings.push({ row: 0, message: 'Stimulus & Petunjuk tidak ditemukan. Pastikan tabel Stimulus/Petunjuk ada di dokumen (dengan Nomor Soal di kolom pertama).' });
                } else if (!hasStimulusCode) {
                    warnings.push({ row: 0, message: 'Stimulus tidak ditemukan — periksa apakah tabel stimulus ada.' });
                } else if (!hasInstructionCode) {
                    warnings.push({ row: 0, message: 'Petunjuk tidak ditemukan — periksa apakah tabel petunjuk ada.' });
                }

                result = {
                    success: parsedDocx.length > 0,
                    questions: parsedDocx,
                    errors: [],
                    warnings,
                    totalRows: parsedDocx.length
                };
            }
            const validation = validateQuestions(result.questions);
            for (const invalid of validation.invalid) {
                result.errors.push({ row: result.questions.indexOf(invalid.question) + 1, message: invalid.errors.join('; ') });
            }
            result.success = result.questions.length > 0 && result.errors.length === 0;
            setParseResult(result);
            setEditableQuestions(result.questions);
            setSelectedQuestions(new Set(result.questions.map((_, i) => i)));
        } catch (error) {
            console.error('Parse error:', error);
            setParseResult({
                success: false,
                questions: [],
                errors: [{ row: 0, message: `Gagal memproses file: ${getErrorMessage(error)}` }],
                warnings: [],
                totalRows: 0
            });
        } finally {
            setIsProcessing(false);
        }
    }, [selectedFile, fileType]);

    const handleStartImport = useCallback(async () => {
        if (selectedQuestions.size === 0 || parseResult?.errors.length) return;
        setStep('importing');
        setImportProgress(0);
        setImportError(null);

        const questionsToImport = editableQuestions
            .filter((_, idx) => selectedQuestions.has(idx))
            .map(q => ({
                question_text: q.question_text,
                type: q.type,
                difficulty: q.difficulty,
                score_default: q.scoreDefault,
                metadata: q.metadata,
                options: q.options?.map(o => ({
                    option_text: o.text,
                    is_correct: o.isCorrect ?? o.is_correct ?? false,
                    order: o.order,
                    weight: o.isCorrect ?? o.is_correct ?? false ? (o.weight ?? 1) : (o.weight ?? 0),
                    metadata: o.metadata
                }))
            }));

        try {
            const clientRequestId = requestIdFor(questionsToImport);
            const result = await bulkImportQuestions(bankId, questionsToImport, clientRequestId);
            if (result.success && result.failed === 0 && result.errors.length === 0 && result.imported === questionsToImport.length) {
                importRequests.current.delete(JSON.stringify([bankId, questionsToImport]));
                setImportProgress(100);
                setTimeout(async () => {
                    await onImportComplete();
                    handleClose();
                }, 1000);
            } else {
                const msg = result.errors?.[0]?.message || 'Import gagal tanpa pesan error.';
                const extra = (result.errors?.length || 0) > 1 ? ` (+${result.errors.length - 1} error lain)` : '';
                setImportError(msg + extra);
            }
        } catch (error) {
            console.error('Import error:', error);
            setImportError(getErrorMessage(error) || 'Terjadi kesalahan saat mengimpor.');
        }
    }, [editableQuestions, selectedQuestions, parseResult, bankId, onImportComplete, handleClose, requestIdFor]);

    const toggleQuestionSelection = useCallback((index: number) => {
        setSelectedQuestions(prev => {
            const next = new Set(prev);
            if (next.has(index)) next.delete(index);
            else next.add(index);
            return next;
        });
    }, []);

    const selectAll = useCallback(() => {
        setSelectedQuestions(new Set(editableQuestions.map((_, i) => i)));
    }, [editableQuestions]);

    const deselectAll = useCallback(() => {
        setSelectedQuestions(new Set());
    }, []);

    const getFileIcon = () => {
        switch (fileType) {
            case 'xlsx': return <FileSpreadsheet className="w-16 h-16 text-emerald-500" />;
            case 'docx': return <FileText className="w-16 h-16 text-blue-500" />;
            case 'csv': return <Table className="w-16 h-16 text-amber-500" />;
        }
    };

    const filteredSourceQuestions = useMemo(() => {
        if (!searchSourceQuery) return sourceBankQuestions;
        const q = searchSourceQuery.toLowerCase();
        return sourceBankQuestions.filter((sq) =>
            (sq.question_text || '').toLowerCase().includes(q) ||
            (sq.type || '').toLowerCase().includes(q)
        );
    }, [sourceBankQuestions, searchSourceQuery]);

    const TYPE_LABEL: Record<string, string> = {
        mcq: 'PG', mcq_complex: 'PGK', true_false: 'BS',
        matching: 'MJ', categorization: 'CAT',
        short_answer: 'ISIAN', essay: 'ESAI',
        sjt: 'SJT', ordering: 'URUT'
    };

    return (
        <AnimatePresence>
            {isOpen && (
                <>
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 bg-black/60 z-[9999]"
                        onClick={handleClose}
                    />
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95, y: 20 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: 20 }}
                        className="fixed inset-4 md:inset-auto md:left-1/2 md:top-1/2 md:-translate-x-1/2 md:-translate-y-1/2 md:w-full md:max-w-xl md:max-h-[85vh] bg-white rounded-lg shadow-2xl z-[9999] flex flex-col overflow-hidden"
                    >
                        {/* Header */}
                        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-primary/20 to-primary/10 flex items-center justify-center">
                                    <Upload className="w-5 h-5 text-primary" />
                                </div>
                                <div>
                                    <h2 className="text-lg font-bold text-slate-800">Import Batch Soal</h2>
                                    <p className="text-xs text-slate-500">
                                        {step === 'upload' && 'Pilih sumber import'}
                                        {step === 'preview' && `Review ${parseResult?.questions.length || 0} soal`}
                                        {step === 'importing' && 'Memproses import...'}
                                        {step === 'complete' && 'Import selesai!'}
                                    </p>
                                </div>
                            </div>
                            <button onClick={handleClose} className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center transition-colors">
                                <X className="w-5 h-5 text-slate-500" />
                            </button>
                        </div>

                        {/* Tab Switcher */}
                        {step === 'upload' && (
                            <div className="flex gap-1 px-6 pt-4">
                                <button
                                    onClick={() => setImportTab('file')}
                                    className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold transition-all ${
                                        importTab === 'file'
                                            ? 'bg-primary text-white shadow-md'
                                            : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                                    }`}
                                >
                                    <FileText className="w-4 h-4" />
                                    Import File
                                </button>
                                <button
                                    onClick={() => setImportTab('bank')}
                                    className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold transition-all ${
                                        importTab === 'bank'
                                            ? 'bg-primary text-white shadow-md'
                                            : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                                    }`}
                                >
                                    <Database className="w-4 h-4" />
                                    Import dari Bank
                                </button>
                            </div>
                        )}

                        {/* Content */}
                        <div className="flex-1 overflow-y-auto p-6">

                            {/* ── TAB: Import File ─────────────────────────────────────────── */}
                            {step === 'upload' && importTab === 'file' && (
                                <div className="space-y-4">
                                    {/* Drop Zone */}
                                    <div
                                        onDragOver={handleDragOver}
                                        onDrop={handleDrop}
                                        onClick={() => fileInputRef.current?.click()}
                                        className="relative border-2 border-dashed border-slate-200 rounded-lg p-6 text-center hover:border-primary/50 hover:bg-primary/5 transition-all cursor-pointer"
                                    >
                                        <input
                                            ref={fileInputRef}
                                            type="file"
                                            accept=".xlsx,.xls,.docx,.csv"
                                            onChange={handleFileSelect}
                                            className="hidden"
                                        />
                                        {selectedFile ? (
                                            <div className="space-y-4">
                                                {getFileIcon()}
                                                <div>
                                                    <p className="text-lg font-semibold text-slate-700">{selectedFile.name}</p>
                                                    <p className="text-sm text-slate-500">{(selectedFile.size / 1024).toFixed(1)} KB</p>
                                                </div>
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); setSelectedFile(null); }}
                                                    className="text-sm text-red-500 hover:text-red-600"
                                                >
                                                    Hapus file
                                                </button>
                                            </div>
                                        ) : (
                                            <div className="space-y-4">
                                                <div className="w-16 h-16 rounded-lg bg-slate-100 flex items-center justify-center mx-auto">
                                                    <File className="w-8 h-8 text-slate-400" />
                                                </div>
                                                <div>
                                                    <p className="text-lg font-semibold text-slate-700">
                                                        Seret file di sini atau klik untuk memilih
                                                    </p>
                                                    <div className="text-sm text-slate-500 mt-1">
                                                        Format: Word template dengan Kolom (No | Tipe | Soal | Kunci | Poin)
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    {/* Template Download */}
                                    <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-2">
                                        <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                                            <Download className="w-3.5 h-3.5" />
                                            Unduh Template Import
                                        </div>
                                        <div className="grid grid-cols-2 gap-2">
                                            <button
                                                onClick={() => window.open('/template_soal_pengetahuan.docx?v=20261001', '_blank')}
                                                className="flex items-center gap-2 px-3 py-2.5 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 transition-colors text-left"
                                            >
                                                <FileText className="w-4 h-4 text-blue-500 shrink-0" />
                                                <div>
                                                    <p className="text-xs font-bold text-blue-700">Pengetahuan</p>
                                                    <p className="text-[10px] text-blue-500">mcq, essay, ordering...</p>
                                                </div>
                                            </button>
                                            <button
                                                onClick={() => window.open('/template_soal_kepribadian.docx?v=20261001', '_blank')}
                                                className="flex items-center gap-2 px-3 py-2.5 bg-indigo-50 border border-indigo-200 rounded-lg hover:bg-indigo-100 transition-colors text-left"
                                            >
                                                <FileText className="w-4 h-4 text-indigo-500 shrink-0" />
                                                <div>
                                                    <p className="text-xs font-bold text-indigo-700">Kepribadian</p>
                                                    <p className="text-[10px] text-indigo-500">sjt, likert, ranking...</p>
                                                </div>
                                            </button>
                                        </div>
                                    </div>

                                </div>
                            )}

                            {/* ── TAB: Import dari Bank ────────────────────────────────────────── */}
                            {step === 'upload' && importTab === 'bank' && (
                                <div className="space-y-4">
                                    {/* Bank Selector */}
                                    <div>
                                        <label className="block text-sm font-semibold text-slate-700 mb-2">
                                            Pilih Bank Soal Sumber
                                        </label>
                                        <select
                                            value={selectedSourceBank}
                                            onChange={(e) => handleSourceBankChange(e.target.value)}
                                            className="w-full border border-slate-200 rounded-lg px-4 py-3 text-sm bg-white focus:outline-none focus:border-primary"
                                        >
                                            <option value="">-- Pilih Bank Soal --</option>
                                            {allBanks.map((b) => (
                                                <option key={b.id} value={b.id}>{b.title || b.name || 'Bank Soal'}</option>
                                            ))}
                                        </select>
                                    </div>

                                    {/* Search */}
                                    {selectedSourceBank && (
                                        <div className="relative">
                                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                                            <input
                                                type="text"
                                                placeholder="Cari soal..."
                                                value={searchSourceQuery}
                                                onChange={(e) => setSearchSourceQuery(e.target.value)}
                                                className="w-full border border-slate-200 rounded-lg pl-10 pr-4 py-3 text-sm focus:outline-none focus:border-primary"
                                            />
                                        </div>
                                    )}

                                    {/* Questions List */}
                                    {sourceLoading && (
                                        <div className="flex justify-center py-8">
                                            <Spinner variant="buble" size={28} />
                                        </div>
                                    )}

                                    {!sourceLoading && selectedSourceBank && (
                                        <>
                                            <div className="flex items-center justify-between">
                                                <span className="text-sm text-slate-500">
                                                    {selectedCrossQuestions.size} dari {filteredSourceQuestions.length} dipilih
                                                </span>
                                                <div className="flex gap-2">
                                                    <button onClick={selectAllCross} className="px-3 py-1.5 text-xs font-medium bg-slate-100 rounded-lg hover:bg-slate-200">Pilih Semua</button>
                                                    <button onClick={deselectAllCross} className="px-3 py-1.5 text-xs font-medium bg-slate-100 rounded-lg hover:bg-slate-200">Batal</button>
                                                </div>
                                            </div>
                                            <div className="space-y-2 max-h-80 overflow-y-auto">
                                                {filteredSourceQuestions.map((sq) => (
                                                    <div
                                                        key={sq.id}
                                                        onClick={() => toggleCrossQuestion(sq.id)}
                                                        className={`border rounded-lg p-3 cursor-pointer transition-all flex items-start gap-3 ${
                                                            selectedCrossQuestions.has(sq.id)
                                                                ? 'border-primary bg-primary/5'
                                                                : 'border-slate-200 hover:border-slate-300'
                                                        }`}
                                                    >
                                                        <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 mt-0.5 ${
                                                            selectedCrossQuestions.has(sq.id) ? 'bg-primary border-primary' : 'border-slate-300'
                                                        }`}>
                                                            {selectedCrossQuestions.has(sq.id) && <Check className="w-3 h-3 text-white" />}
                                                        </div>
                                                        <div className="flex-1 min-w-0">
                                                            <div className="flex items-center gap-2 mb-1">
                                                                <span className={`px-2 py-0.5 rounded text-xs font-medium ${TYPE_COLORS[sq.type]?.bg || 'bg-slate-100'} ${TYPE_COLORS[sq.type]?.text || 'text-slate-600'}`}>
                                                                    {TYPE_LABEL[sq.type] || sq.type}
                                                                </span>
                                                                {(sq.bank_question_options?.length ?? 0) > 0 && (
                                                                    <span className="text-xs text-slate-400">{sq.bank_question_options?.length ?? 0} opsi</span>
                                                                )}
                                                            </div>
                                                            <p className="text-sm text-slate-700 line-clamp-2">
                                                                {sq.question_text.replace(/<[^>]*>/g, '').substring(0, 120)}
                                                            </p>
                                                        </div>
                                                    </div>
                                                ))}
                                                {filteredSourceQuestions.length === 0 && (
                                                    <p className="text-center py-8 text-sm text-slate-500">Tidak ada soal di bank ini</p>
                                                )}
                                            </div>
                                        </>
                                    )}

                                    {!selectedSourceBank && (
                                        <div className="text-center py-12 text-slate-500">
                                            <Database className="w-12 h-12 mx-auto mb-3 text-slate-300" />
                                            <p className="text-sm">Pilih bank soal sumber untuk melihat daftar soal</p>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Step: Preview */}
                            {step === 'preview' && (
                                <div className="space-y-4">
                                    {parseResult && (
                                        <div className="grid grid-cols-3 gap-4">
                                            <div className="bg-emerald-50 rounded-lg p-4 text-center">
                                                <p className="text-2xl font-bold text-emerald-600">{parseResult.questions.length}</p>
                                                <p className="text-xs text-emerald-600">Soal Ditemukan</p>
                                            </div>
                                            <div className="bg-amber-50 rounded-lg p-4 text-center">
                                                <p className="text-2xl font-bold text-amber-600">{parseResult.warnings.length}</p>
                                                <p className="text-xs text-amber-600">Peringatan</p>
                                            </div>
                                            <div className="bg-red-50 rounded-lg p-4 text-center">
                                                <p className="text-2xl font-bold text-red-600">{parseResult.errors.length}</p>
                                                <p className="text-xs text-red-600">Error</p>
                                            </div>
                                        </div>
                                    )}

                                    {parseResult?.warnings && parseResult.warnings.length > 0 && (
                                        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3.5">
                                            <h4 className="font-semibold text-amber-800 flex items-center gap-2 mb-2 text-xs">
                                                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                                                Peringatan ({parseResult.warnings.length}):
                                            </h4>
                                            <div className="space-y-1.5 max-h-32 overflow-y-auto">
                                                {parseResult.warnings.map((warn, idx) => (
                                                    <div key={idx} className="flex items-start gap-2 text-xs text-amber-800">
                                                        <span className="text-amber-500 font-bold">•</span>
                                                        <span>
                                                            {warn.row > 0 && <strong className="font-semibold">Baris/Soal {warn.row}: </strong>}
                                                            {warn.message}
                                                        </span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            <button onClick={selectAll} className="px-3 py-1.5 text-xs font-medium bg-slate-100 rounded-lg hover:bg-slate-200">Pilih Semua</button>
                                            <button onClick={deselectAll} className="px-3 py-1.5 text-xs font-medium bg-slate-100 rounded-lg hover:bg-slate-200">Batal</button>
                                            <span className="text-sm text-slate-600">{selectedQuestions.size} dari {editableQuestions.length} dipilih</span>
                                        </div>
                                    </div>
                                    <div className="space-y-3 max-h-96 overflow-y-auto">
                                        {editableQuestions.map((q, idx) => (
                                            <div
                                                key={idx}
                                                className={`border rounded-lg p-4 transition-all cursor-pointer ${
                                                    selectedQuestions.has(idx) ? 'border-primary bg-primary/5' : 'border-slate-200 hover:border-slate-300'
                                                }`}
                                                onClick={() => toggleQuestionSelection(idx)}
                                            >
                                                <div className="flex items-start gap-3">
                                                    <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 mt-0.5 ${
                                                        selectedQuestions.has(idx) ? 'bg-primary border-primary' : 'border-slate-300'
                                                    }`}>
                                                        {selectedQuestions.has(idx) && <Check className="w-3 h-3 text-white" />}
                                                    </div>
                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex items-center gap-2 mb-2">
                                                            <span className="text-xs font-medium text-slate-500">#{idx + 1}</span>
                                                            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${TYPE_COLORS[q.type]?.bg || 'bg-slate-100'} ${TYPE_COLORS[q.type]?.text || 'text-slate-600'}`}>
                                                                {QUESTION_TYPE_LABELS[q.type] || q.type}
                                                            </span>
                                                        </div>
                                                        <p className="text-sm text-slate-700 line-clamp-2">
                                                            {q.question_text.replace(/<[^>]*>/g, '').substring(0, 150)}
                                                        </p>
                                                        {(q.metadata?.import_stimulus || q.metadata?.import_instruction || q.metadata?.kisi_kisi) && (
                                                            <div className="mt-2 space-y-1.5">
                                                                {q.metadata.import_stimulus && (
                                                                    <div className="flex items-start gap-1.5 text-xs">
                                                                        <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 font-semibold shrink-0">Stim</span>
                                                                        <span className="text-slate-600 line-clamp-1" title={q.metadata.import_stimulus.replace(/<[^>]*>/g, '')}>
                                                                            {q.metadata.import_stimulus.replace(/<[^>]*>/g, '').substring(0, 80)}
                                                                        </span>
                                                                    </div>
                                                                )}
                                                                {q.metadata.import_instruction && (
                                                                    <div className="flex items-start gap-1.5 text-xs">
                                                                        <span className="px-1.5 py-0.5 rounded bg-sky-50 text-sky-700 font-semibold shrink-0">Ptk</span>
                                                                        <span className="text-slate-600 line-clamp-1" title={q.metadata.import_instruction.replace(/<[^>]*>/g, '')}>
                                                                            {q.metadata.import_instruction.replace(/<[^>]*>/g, '').substring(0, 80)}
                                                                        </span>
                                                                    </div>
                                                                )}
                                                                {q.metadata.kisi_kisi && (
                                                                    <div className="flex items-start gap-1.5 text-xs">
                                                                        <span className="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 font-semibold shrink-0">Kisi</span>
                                                                        <span className="text-slate-600 line-clamp-1" title={q.metadata.kisi_kisi.replace(/<[^>]*>/g, '')}>
                                                                            {q.metadata.kisi_kisi.replace(/<[^>]*>/g, '').substring(0, 80)}
                                                                        </span>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        )}
                                                        {q.options && q.options.length > 0 && (
                                                            <div className="mt-2 flex flex-wrap gap-1">
                                                                {q.options.map((opt, optIdx) => (
                                                                    <span key={optIdx} className={`px-2 py-0.5 rounded text-xs ${
                                                                        opt.isCorrect || opt.is_correct ? 'bg-emerald-100 text-emerald-700 font-medium' : 'bg-slate-100 text-slate-600'
                                                                    }`}>
                                                                        {optionLabel(optIdx)}. <LatexRenderer text={opt.text} />
                                                                    </span>
                                                                ))}
                                                            </div>
                                                        )}
                                                        {q.warnings && q.warnings.length > 0 && (
                                                            <div className="mt-2 flex items-center gap-1.5 text-xs text-amber-800 bg-amber-50/80 px-2.5 py-1 rounded border border-amber-200">
                                                                <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                                                                <span>{q.warnings.join('; ')}</span>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                    {parseResult?.errors && parseResult.errors.length > 0 && (
                                        <div className="bg-red-50 rounded-lg p-4">
                                            <h4 className="font-semibold text-red-700 flex items-center gap-2 mb-2">
                                                <XCircle className="w-4 h-4" />Error yang harus diperbaiki
                                            </h4>
                                            <div className="space-y-1 max-h-32 overflow-y-auto">
                                                {parseResult.errors.slice(0, 5).map((err, idx) => (
                                                    <p key={idx} className="text-xs text-red-600">{err.row > 0 ? `Baris ${err.row}: ` : ''}{getErrorMessage(err)}</p>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Step: Importing */}
                            {step === 'importing' && !importError && (
                                <div className="flex flex-col items-center justify-center py-12 space-y-6">
                                    <div className="relative w-24 h-24">
                                        <svg className="w-24 h-24 transform -rotate-90">
                                            <circle cx="48" cy="48" r="40" stroke="currentColor" strokeWidth="8" fill="none" className="text-slate-200" />
                                            <circle cx="48" cy="48" r="40" stroke="currentColor" strokeWidth="8" fill="none"
                                                strokeDasharray={2 * Math.PI * 40}
                                                strokeDashoffset={2 * Math.PI * 40 * (1 - importProgress / 100)}
                                                className="text-primary transition-all duration-300"
                                                strokeLinecap="round"
                                            />
                                        </svg>
                                        <div className="absolute inset-0 flex items-center justify-center">
                                            <span className="text-xl font-bold text-slate-700">{importProgress}%</span>
                                        </div>
                                    </div>
                                    <div className="text-center">
                                        <p className="text-lg font-semibold text-slate-700">Memproses Import...</p>
                                        <p className="text-sm text-slate-500">
                                            {importTab === 'bank' ? selectedCrossQuestions.size : selectedQuestions.size} soal sedang diimport
                                        </p>
                                    </div>
                                </div>
                            )}

                            {/* Step: Importing — Failed */}
                            {step === 'importing' && importError && (
                                <div className="flex flex-col items-center justify-center py-10 space-y-5">
                                    <div className="w-20 h-20 rounded-full bg-red-100 flex items-center justify-center">
                                        <X className="w-10 h-10 text-red-500" />
                                    </div>
                                    <div className="text-center max-w-md">
                                        <p className="text-xl font-bold text-slate-700">Import Gagal</p>
                                        <p className="text-sm text-red-600 mt-2 break-words">{importError}</p>
                                    </div>
                                    <button
                                        onClick={() => { setImportError(null); setStep('upload'); }}
                                        className="px-6 py-2.5 text-sm font-semibold text-white bg-primary rounded-lg hover:opacity-90 transition-opacity"
                                    >
                                        Kembali
                                    </button>
                                </div>
                            )}

                            {/* Step: Complete */}
                            {step === 'complete' && (
                                <div className="flex flex-col items-center justify-center py-12 space-y-6">
                                    <div className="w-20 h-20 rounded-full bg-emerald-100 flex items-center justify-center">
                                        <CheckCircle2 className="w-10 h-10 text-emerald-500" />
                                    </div>
                                    <div className="text-center">
                                        <p className="text-xl font-bold text-slate-700">Import Berhasil!</p>
                                        <p className="text-sm text-slate-500 mt-1">
                                            {(importTab === 'bank' ? selectedCrossQuestions.size : selectedQuestions.size)} soal berhasil diimport
                                        </p>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Footer */}
                        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-100 bg-slate-50">
                            {step === 'upload' && importTab === 'file' && (
                                <>
                                    <button onClick={handleClose} className="px-6 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">Batal</button>
                                    <button
                                        onClick={handleParseFile}
                                        disabled={!selectedFile || isProcessing}
                                        className={`px-6 py-2.5 text-sm font-medium text-white rounded-lg transition-all flex items-center gap-2 ${
                                            !selectedFile || isProcessing ? 'bg-slate-300 cursor-not-allowed' : 'bg-primary hover:bg-primary/90 shadow-lg shadow-primary/25'
                                        }`}
                                    >
                                        {isProcessing ? <><Loader2 className="w-4 h-4 animate-spin" />Memproses...</> : <><ChevronRight className="w-4 h-4" />Lanjut</>}
                                    </button>
                                </>
                            )}

                            {step === 'upload' && importTab === 'bank' && (
                                <>
                                    <button onClick={handleClose} className="px-6 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">Batal</button>
                                    <button
                                        onClick={handleStartCrossImport}
                                        disabled={selectedCrossQuestions.size === 0 || sourceLoading}
                                        className={`px-6 py-2.5 text-sm font-medium text-white rounded-lg transition-all flex items-center gap-2 ${
                                            selectedCrossQuestions.size === 0 || sourceLoading ? 'bg-slate-300 cursor-not-allowed' : 'bg-primary hover:bg-primary/90 shadow-lg shadow-primary/25'
                                        }`}
                                    >
                                        {sourceLoading ? <><Loader2 className="w-4 h-4 animate-spin" />Memuat...</> : <><ArrowRight className="w-4 h-4" />Import {selectedCrossQuestions.size} Soal</>}
                                    </button>
                                </>
                            )}

                            {step === 'preview' && (
                                <>
                                    <button onClick={() => { setStep('upload'); setImportTab('file'); }} className="px-6 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors flex items-center gap-2">
                                        <ChevronLeft className="w-4 h-4" />Kembali
                                    </button>
                                    <button
                                        onClick={handleStartImport}
                                        disabled={selectedQuestions.size === 0 || isProcessing || !!parseResult?.errors.length}
                                        className={`px-6 py-2.5 text-sm font-medium text-white rounded-lg transition-all flex items-center gap-2 ${
                                            selectedQuestions.size === 0 || isProcessing ? 'bg-slate-300 cursor-not-allowed' : 'bg-primary hover:bg-primary/90 shadow-lg shadow-primary/25'
                                        }`}
                                    >
                                        {isProcessing ? <><Loader2 className="w-4 h-4 animate-spin" />Mengimport...</> : <><ChevronRight className="w-4 h-4" />Import {selectedQuestions.size} Soal</>}
                                    </button>
                                </>
                            )}

                            {(step === 'importing' || step === 'complete') && (
                                <div className="w-full flex justify-center">
                                    {step === 'complete' && (
                                        <button onClick={handleClose} className="px-8 py-2.5 text-sm font-medium text-white bg-emerald-500 hover:bg-emerald-600 rounded-lg transition-colors">Tutup</button>
                                    )}
                                </div>
                            )}
                        </div>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
}
