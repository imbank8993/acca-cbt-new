"use client";
import React, { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { getProctorOrganization } from '@/lib/api/proctor';
import { getBankQuestions, getQuestionBankAction, QuestionType, saveQuestionAction } from '@/lib/api/questions';
import { getSessionUser } from '@/lib/session';
import { X, ArrowLeft, Loader2, Save, Eye, Check, ListChecks, ToggleLeft, Layers, Edit3, FileQuestion, CheckCircle2, ArrowRightLeft } from 'lucide-react';
import { LatexRenderer } from '@/app/components/questions/LatexRenderer';
import { TipTapEditor } from '@/app/components/questions/TipTapEditor';
import PreviewModal from '@/app/components/questions/PreviewModal';
import { MCQForm } from '@/app/components/questions/forms/MCQForm';
import { TrueFalseForm } from '@/app/components/questions/forms/TrueFalseForm';
import { MatchingForm } from '@/app/components/questions/forms/MatchingForm';
import { CategorizationForm } from '@/app/components/questions/forms/CategorizationForm';
import { ShortAnswerForm } from '@/app/components/questions/forms/ShortAnswerForm';
import { EssayForm } from '@/app/components/questions/forms/EssayForm';
import { useMemoryState } from '@/lib/useMemoryState';


const QUESTION_TYPES = [
    { value: 'mcq', label: 'Pilihan Ganda', icon: ListChecks },
    { value: 'mcq_complex', label: 'PG Kompleks', icon: CheckCircle2 },
    { value: 'true_false', label: 'Benar / Salah', icon: ToggleLeft },
    { value: 'matching', label: 'Penjodohan', icon: ArrowRightLeft },
    { value: 'categorization', label: 'Kategori', icon: Layers },
    { value: 'short_answer', label: 'Isian Singkat', icon: Edit3 },
    { value: 'essay', label: 'Essay / Uraian', icon: FileQuestion },
];

// Strip $ delimiters from LaTeX text before saving
function stripLatexDelimiters(text: string): string {
    if (!text) return text;
    // Remove inline math delimiters: $...$ or $$...$$
    return text.replace(/\$\$[\s\S]*?\$\$/g, (match) => {
        // Extract content between $$...$$
        return match.slice(2, -2).trim();
    }).replace(/(?<!\$)\$(?!\$)[^$]*\$(?!\$)/g, (match) => {
        // Extract content between $...$ (not $$)
        return match.slice(1, -1).trim();
    });
}

// Strip delimiters for Quill HTML content
function stripHtmlLatexDelimiters(html: string): string {
    if (!html) return html;
    // Process text nodes inside HTML
    return html.replace(/\$\$([\s\S]*?)\$\$/g, (_, content) => content.trim())
                .replace(/(?<!\$)\$(?!\$)([^$]*)\$(?!\$)/g, (_, content) => content.trim());
}

export default function QuestionEditPage() {
    const params = useParams();
    const router = useRouter();
    const bankId = params.bankId as string;
    const questionId = params.questionId as string;
    const isNewQuestion = !questionId || questionId === 'new';

    const [org, setOrg] = useState<any>(null);
    const [bankInfo, setBankInfo] = useState<any>(null);
    const [isLoading, setIsLoading] = useMemoryState(`guru_questions_${bankId}_edit_isLoading`, true);

    // Editor state
    const [editingQuestion, setEditingQuestion] = useState<any>(null);
    const [questionText, setQuestionText] = useState('');
    const [options, setOptions] = useMemoryState<any[]>(`guru_questions_${bankId}_edit_options`, []);
    const [selectedType, setSelectedType] = useState<QuestionType>('mcq');
    const [scoreDefault, setScoreDefault] = useState(1);
    const [metadata, setMetadata] = useState<any>({});
    const [categories, setCategories] = useMemoryState<string[]>(`guru_questions_${bankId}_edit_categories`, []);
    const [kisiKisi, setKisiKisi] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [showTypeDropdown, setShowTypeDropdown] = useState(false);
    const [validationErrors, setValidationErrors] = useMemoryState<string[]>(`guru_questions_${bankId}_edit_validationErrors`, []);

    // Preview modal
    const [isViewModalOpen, setIsViewModalOpen] = useState(false);
    const [viewingQuestion, setViewingQuestion] = useState<any>(null);
    const [matchingAnswers, setMatchingAnswers] = useState<Record<string, string>>({});

    // Deduplicate options by id
    const deduplicateOptions = (opts: any[]) => {
        const seen = new Set<string>();
        return opts.filter(o => {
            if (!o.id) return true;
            if (seen.has(o.id)) return false;
            seen.add(o.id);
            return true;
        });
    };

    const addOption = () => {
        if (selectedType === 'true_false') {
            setOptions([...options, { text: '', isCorrect: false, order: options.length }]);
        } else {
            setOptions([...options, { text: '', isCorrect: false, order: options.length }]);
        }
    };

    const removeOption = (idx: number) => {
        setOptions(options.filter((_, i) => i !== idx));
    };

    const updateOption = (idx: number, fields: any) => {
        const newOpts = [...options];
        newOpts[idx] = { ...newOpts[idx], ...fields };
        setOptions(newOpts);
    };

    const validateQuestion = (): boolean => {
        const errors: string[] = [];
        const cleanQuestionText = stripHtmlLatexDelimiters(questionText);
        if (!cleanQuestionText || cleanQuestionText.trim() === '' || cleanQuestionText === '<p></p>' || cleanQuestionText === '<p><br></p>') {
            errors.push('Pertanyaan tidak boleh kosong');
        }
        if (selectedType === 'mcq' || selectedType === 'mcq_complex') {
            const emptyOptions = options.filter(o => !o.text || o.text.trim() === '');
            if (emptyOptions.length > 0) errors.push('Semua opsi jawaban harus diisi');
            const hasCorrect = options.some(o => o.isCorrect === true);
            if (!hasCorrect) errors.push('Pilih jawaban yang benar');
        }
        if (selectedType === 'true_false') {
            const emptyOptions = options.filter(o => !o.text || o.text.trim() === '');
            if (emptyOptions.length > 0) errors.push('Semua pernyataan harus diisi');
        }
        if (selectedType === 'short_answer' || selectedType === 'essay') {
            // OK
        }
        if (!scoreDefault || scoreDefault <= 0) {
            errors.push('Poin harus lebih dari 0');
        }
        setValidationErrors(errors);
        return errors.length === 0;
    };

    const handleSave = async () => {
        if (!validateQuestion()) return;
        if (!org) return;
        setIsSubmitting(true);

        // Strip $ delimiters from question text HTML
        const cleanQuestionText = stripHtmlLatexDelimiters(questionText);
        // Strip $ delimiters from option texts
        const cleanOptions = options.map((opt, i) => ({
            id: opt.id,
            text: stripLatexDelimiters(opt.text || ''),
            isCorrect: opt.isCorrect,
            order: i,
            weight: opt.weight ?? 1,
            metadata: {
                match_texts: opt.match_texts || [],
                category_names: opt.category_names || []
            }
        }));

        const result = await saveQuestionAction({
            id: editingQuestion?.id,
            bankId: bankId,
            type: selectedType,
            questionText: cleanQuestionText,
            difficulty: 'medium',
            scoreDefault: scoreDefault,
            metadata: {
                ...metadata,
                categories: selectedType === 'categorization' ? categories : [],
                kisi_kisi: kisiKisi
            },
            options: (selectedType === 'short_answer' || (selectedType === 'essay' && !metadata?.is_multi_topic)) ? [] : cleanOptions
        });

        if (result.success) {
            router.push(`/dashboard/guru/questions/${bankId}`);
        } else {
            alert('Gagal menyimpan: ' + result.error);
        }
        setIsSubmitting(false);
    };

    const handleOpenPreview = () => {
        const tempQ = {
            id: editingQuestion?.id || 'preview',
            type: selectedType,
            question_text: questionText,
            metadata: { ...metadata, categories },
            bank_question_options: deduplicateOptions(options).map((opt, i) => ({
                id: opt.id || `temp-${i}`,
                option_text: stripLatexDelimiters(opt.text || ''),
                is_correct: opt.isCorrect,
                order: i,
                metadata: {
                    match_texts: opt.match_texts || [],
                    category_names: opt.category_names || []
                }
            }))
        };
        setViewingQuestion(tempQ);
        setIsViewModalOpen(true);
    };

    const handleTypeChange = (type: QuestionType) => {
        setSelectedType(type);
        if (type === 'true_false') {
            setOptions([
                { text: '', isCorrect: true, order: 0, weight: 1 },
                { text: '', isCorrect: false, order: 1, weight: 0 }
            ]);
        } else if (type === 'mcq') {
            setOptions([
                { text: '', isCorrect: true, order: 0, weight: 1 },
                { text: '', isCorrect: false, order: 1, weight: 0 },
                { text: '', isCorrect: false, order: 2, weight: 0 },
                { text: '', isCorrect: false, order: 3, weight: 0 }
            ]);
        } else if (type === 'matching') {
            setOptions([
                { text: '', isCorrect: false, order: 0, weight: 0, match_texts: [] },
                { text: '', isCorrect: false, order: 1, weight: 0, match_texts: [] }
            ]);
        } else if (type === 'categorization') {
            setOptions([
                { text: '', isCorrect: false, order: 0, weight: 0, metadata: { category_names: [] } }
            ]);
        } else {
            setOptions([]);
        }
    };

    // Load initial data
    useEffect(() => {
        async function loadData() {
            try {
                const user = await getSessionUser();
                if (!user) { router.push('/'); return; }

                const orgData = await getProctorOrganization();
                if (!orgData) { router.push('/'); return; }
                setOrg(orgData);

                const bankData = await getQuestionBankAction(bankId);
                setBankInfo(bankData);

                if (!isNewQuestion) {
                    const questionsData = await getBankQuestions(bankId);
                    const existingQuestion = (questionsData || []).find((q: any) => q.id === questionId);
                    if (existingQuestion) {
                        setEditingQuestion(existingQuestion);
                        setQuestionText(existingQuestion.question_text || '');
                        setSelectedType(existingQuestion.type || 'mcq');
                        setScoreDefault(existingQuestion.score_default || 1);
                        setMetadata(existingQuestion.metadata || {});
                        setCategories(existingQuestion.metadata?.categories || []);
                        setKisiKisi(existingQuestion.metadata?.kisi_kisi || '');

                        const loadedOpts = deduplicateOptions(
                            (existingQuestion.bank_question_options || []).map((o: any) => ({
                                id: o.id,
                                text: o.option_text || o.text || '',
                                isCorrect: o.is_correct,
                                order: o.order,
                                weight: o.weight,
                                match_texts: o.metadata?.match_texts || [],
                                category_names: o.metadata?.category_names || []
                            }))
                        );

                        if (existingQuestion.type === 'true_false') {
                            setOptions(loadedOpts);
                        } else if (existingQuestion.type === 'matching') {
                            setMetadata((prev: any) => ({
                                ...prev,
                                right_items: existingQuestion.metadata?.right_items || []
                            }));
                            setOptions(loadedOpts);
                        } else if (existingQuestion.type === 'short_answer') {
                            setMetadata((prev: any) => ({
                                ...prev,
                                blanks: existingQuestion.metadata?.blanks || [{}, {}, {}]
                            }));
                            setOptions([]);
                        } else if (existingQuestion.type === 'categorization') {
                            setOptions(loadedOpts);
                        } else {
                            setOptions(loadedOpts);
                        }
                    }
                } else {
                    setOptions([
                        { text: '', isCorrect: true, order: 0, weight: 1 },
                        { text: '', isCorrect: false, order: 1, weight: 0 },
                        { text: '', isCorrect: false, order: 2, weight: 0 },
                        { text: '', isCorrect: false, order: 3, weight: 0 }
                    ]);
                }
            } catch (error) {
                console.error('Error loading data:', error);
            } finally {
                setIsLoading(false);
            }
        }
        loadData();
        // Auto-injected smart sync (Window Focus)
        const handleFocus = () => { if (typeof loadData === 'function') loadData(); };
        window.addEventListener('focus', handleFocus);
        return () => window.removeEventListener('focus', handleFocus);
    }, [bankId, questionId, isNewQuestion, router]);

    const selectedTypeInfo = QUESTION_TYPES.find(t => t.value === selectedType) || QUESTION_TYPES[0];

    // Right item management (for matching)
    const addRightItem = () => {
        setMetadata((prev: any) => ({
            ...prev,
            right_items: [...(prev.right_items || []), '']
        }));
    };

    const removeRightItem = (idx: number) => {
        setMetadata((prev: any) => ({
            ...prev,
            right_items: (prev.right_items || []).filter((_: any, i: number) => i !== idx)
        }));
    };

    const updateRightItem = (idx: number, value: string) => {
        setMetadata((prev: any) => {
            const newItems = [...(prev.right_items || [])];
            newItems[idx] = value;
            return { ...prev, right_items: newItems };
        });
    };

    if (isLoading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-slate-50">
                <div className="flex flex-col items-center gap-4">
                    <Loader2 className="w-8 h-8 animate-spin text-primary" />
                    <p className="text-sm text-slate-500">Memuat data...</p>
                </div>
            </div>
        );
    }

    const letters = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

    return (
        <div className="min-h-screen bg-slate-50 flex flex-col">
            {/* Header */}
            <div className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-4">
                    <button
                        onClick={() => router.push(`/dashboard/guru/questions/${bankId}`)}
                        className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
                    >
                        <ArrowLeft size={20} className="text-slate-600" />
                    </button>
                    <div>
                        <h1 className="text-lg font-semibold text-slate-900">
                            {isNewQuestion ? 'Tambah Soal Baru' : 'Edit Soal'}
                        </h1>
                        <p className="text-sm text-slate-500">{bankInfo?.title || 'Bank Soal'}</p>
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    <button
                        onClick={handleOpenPreview}
                        className="flex items-center gap-2 px-4 py-2 text-sm font-medium border border-slate-200 rounded-xl bg-white text-slate-600 hover:bg-slate-50 transition-all"
                    >
                        <Eye size={16} />
                        Preview
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={isSubmitting}
                        className="flex items-center gap-2 px-5 py-2 text-sm font-semibold bg-gradient-to-r from-amber-500 to-pink-500 text-white rounded-xl hover:from-amber-600 hover:to-pink-600 transition-all shadow-lg shadow-pink-500/25 disabled:opacity-50"
                    >
                        {isSubmitting ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                        Simpan
                    </button>
                </div>
            </div>

            {/* Validation Errors */}
            {validationErrors.length > 0 && (
                <div className="px-6 py-3 bg-rose-50 border-b border-rose-200 shrink-0">
                    <div className="flex items-center gap-2 max-w-5xl mx-auto">
                        <p className="text-xs font-semibold text-rose-700">Mohon perbaiki:</p>
                        <div className="flex gap-3">
                            {validationErrors.map((error, idx) => (
                                <span key={idx} className="text-xs text-rose-600">• {error}</span>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* Main Content */}
            <div className="flex-1 overflow-y-auto">
                <div className="max-w-5xl mx-auto p-6 space-y-6">
                    {/* Question Text Editor */}
                    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
                        <div className="mb-4">
                            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Pertanyaan</label>
                        </div>
                        <TipTapEditor
                            content={questionText}
                            onChange={setQuestionText}
                            placeholder="Tuliskan pertanyaan di sini..."
                            minHeight="200px"
                        />
                    </div>

                    {/* Options Area */}
                    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
                        {/* Header row */}
                        <div className="flex items-center justify-between pb-4 border-b border-slate-100">
                            <div className="flex items-center gap-2">
                                <span className="text-sm font-semibold text-slate-700">
                                    {selectedType === 'essay' ? 'Opsi Topik' : 'Opsi Jawaban'}
                                </span>
                            </div>
                            {(selectedType !== 'short_answer' && (selectedType !== 'essay' || (metadata as any)?.is_multi_topic)) && (
                                <button
                                    type="button"
                                    onClick={addOption}
                                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-blue-600 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors"
                                >
                                    <span>+</span> Tambah Opsi
                                </button>
                            )}
                        </div>

                        {/* True/False Options */}
                        {selectedType === 'true_false' && (
                            <TrueFalseForm
                                options={deduplicateOptions(options)}
                                onAddOption={addOption}
                                onInsertOption={(idx) => {}}
                                onRemoveOption={removeOption}
                                onUpdateOption={updateOption}
                            />
                        )}

                        {/* MCQ / MCQ Complex / Essay Options */}
                        {(selectedType === 'mcq' || selectedType === 'mcq_complex' || (selectedType === 'essay' && (metadata as any)?.is_multi_topic)) && (
                            <MCQForm
                                options={deduplicateOptions(options)}
                                isComplex={selectedType === 'mcq_complex' || selectedType === 'essay'}
                                onAddOption={addOption}
                                onInsertOption={(idx) => {}}
                                onRemoveOption={removeOption}
                                onUpdateOption={updateOption}
                                onSetAllCorrect={(idx) => {
                                    if (selectedType === 'essay') return; // no correct option for essay topics
                                    const newOpts = options.map((o, i) => ({ ...o, isCorrect: i === idx }));
                                    setOptions(newOpts);
                                }}
                                onToggleCorrect={(idx) => {
                                    if (selectedType === 'essay') return;
                                    updateOption(idx, { isCorrect: !options[idx].isCorrect });
                                }}
                            />
                        )}

                        {/* Matching Options */}
                        {selectedType === 'matching' && (
                            <MatchingForm
                                options={deduplicateOptions(options)}
                                rightItems={(metadata as any).right_items || []}
                                onAddLeftItem={addOption}
                                onRemoveLeftItem={removeOption}
                                onUpdateLeftItem={(idx, text) => updateOption(idx, { text })}
                                onAddRightItem={addRightItem}
                                onRemoveRightItem={removeRightItem}
                                onUpdateRightItem={updateRightItem}
                                onSetLeftMatch={(optIndex, rightTexts) => updateOption(optIndex, { match_texts: rightTexts })}
                            />
                        )}

                        {/* Categorization Options */}
                        {selectedType === 'categorization' && (
                            <CategorizationForm
                                options={deduplicateOptions(options)}
                                categories={categories}
                                onAddItem={addOption}
                                onInsertItem={(idx) => {}}
                                onRemoveItem={removeOption}
                                onUpdateItem={(idx, text) => updateOption(idx, { text })}
                                onSetCategories={setCategories}
                                onSetItemCategory={(optIndex, cats) => updateOption(optIndex, { category_names: cats })}
                            />
                        )}

                        {/* Short Answer */}
                        {selectedType === 'short_answer' && (
                            <ShortAnswerForm
                                blanks={(metadata as any).blanks || []}
                                onAddBlank={() => {
                                    const blanks = [...((metadata as any).blanks || []), { answer: '', variations: [] }];
                                    setMetadata((prev: any) => ({ ...prev, blanks }));
                                }}
                                onRemoveBlank={(idx) => {
                                    const blanks = ((metadata as any).blanks || []).filter((_: any, i: number) => i !== idx);
                                    setMetadata((prev: any) => ({ ...prev, blanks }));
                                }}
                                onUpdateBlank={(idx, fields) => {
                                    const blanks = [...((metadata as any).blanks || [])];
                                    blanks[idx] = { ...blanks[idx], ...fields };
                                    setMetadata((prev: any) => ({ ...prev, blanks }));
                                }}
                            />
                        )}

                        {/* Essay */}
                        {selectedType === 'essay' && (
                            <EssayForm 
                                metadata={metadata} 
                                onUpdateMetadata={(updates) => setMetadata((prev: any) => ({ ...prev, ...updates }))} 
                            />
                        )}
                    </div>

                    {/* Kisi-kisi */}
                    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
                        <div className="mb-3">
                            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Kisi-kisi</label>
                        </div>
                        <textarea
                            value={kisiKisi}
                            onChange={(e) => setKisiKisi(e.target.value)}
                            placeholder="Kisi-kisi soal (opsional)..."
                            className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400 resize-none"
                            rows={3}
                        />
                    </div>
                </div>
            </div>

            {/* Preview Modal */}
            {isViewModalOpen && (
                <PreviewModal
                    isOpen={isViewModalOpen}
                    onClose={() => setIsViewModalOpen(false)}
                    bankInfo={bankInfo}
                    viewingQuestion={viewingQuestion}
                    setViewingQuestion={setViewingQuestion}
                    filteredQuestions={[]}
                    currentPreviewIndex={0}
                    setCurrentPreviewIndex={() => {}}
                    matchingAnswers={matchingAnswers}
                    setMatchingAnswers={setMatchingAnswers}
                    setQuestions={() => {}}
                    onFinish={() => setIsViewModalOpen(false)}
                />
            )}
        </div>
    );
}
