"use client";
import { AnimatePresence,motion } from 'framer-motion';
import { BookOpen,Check,CheckCircle2,ChevronLeft,ChevronRight,Clock,Columns2,Eye,FileText,Flag,Grid3X3,Loader2,Maximize2,Rows3,ShieldAlert,User,X } from 'lucide-react';
import { useCallback,useEffect,useState } from 'react';
import AssignmentUploader from './AssignmentUploader';
import { ExamQuestionCard } from './ExamQuestionCard';

const getAnswerStatus = (q: any, ans: any) => {
    if (!ans) return 'unanswered';
    const type = q.type;
    
    let optionsCount = 0;
    if (q.bank_question_options) {
        optionsCount = q.bank_question_options.filter((opt: any) => (opt.option_text || opt.text || '').trim().length > 0).length;
    }
    
    try {
        if (type === 'mcq') return 'complete';
        if (type === 'essay' || type === 'uraian') {
            return (typeof ans === 'string' && ans.trim() !== '') || (ans && typeof ans !== 'string') ? 'complete' : 'unanswered';
        }
        
        const parsed = typeof ans === 'string' ? JSON.parse(ans) : ans;
        if (type === 'short_answer') {
            const blanksCount = (q.question_text?.match(/\.{4,}/g) || []).length;
            const totalBlanks = blanksCount > 0 ? blanksCount : (optionsCount > 0 ? optionsCount : 1);
            
            if (Array.isArray(parsed)) {
                const answeredCount = parsed.filter((val: any) => val && String(val).trim() !== '').length;
                if (answeredCount === 0) return 'unanswered';
                if (answeredCount < totalBlanks) return 'partial';
                return 'complete';
            }
            return (parsed && String(parsed).trim() !== '') ? 'complete' : 'unanswered';
        }
        
        if (type === 'true_false' || type === 'checklist' || type === 'ordering' || type === 'ranking') {
            const keys = Object.keys(parsed || {});
            if (keys.length === 0) return 'unanswered';
            if (keys.length < optionsCount) return 'partial';
            return 'complete';
        }
        
        if (type === 'matching' || type === 'categorization') {
            const keys = Object.keys(parsed || {});
            if (keys.length === 0) return 'unanswered';
            let filledCount = 0;
            for (const key of keys) {
                if (Array.isArray(parsed[key]) && parsed[key].length > 0) filledCount++;
            }
            if (filledCount === 0) return 'unanswered';
            if (filledCount < optionsCount) return 'partial';
            return 'complete';
        }
        
        if (type === 'mcq_complex') {
            if (Array.isArray(parsed)) {
                if (parsed.length === 0) return 'unanswered';
                // For PGK, if the number of checked boxes is less than the number of options, some might consider it partial if they expected more to be checked.
                // But usually, any checked is considered complete. However, if the user explicitly wants "partial" for PGK, we could set it to partial if length < optionsCount? 
                // But that means they would have to check ALL boxes to be green! Which is wrong for PGK.
                // Most likely, they mean "PGK (matrix format)" but we just use the default.
                // Let's assume if there's any answer, it's complete, EXCEPT if we have metadata indicating exactly how many should be checked.
                return 'complete'; 
            }
            return 'unanswered';
        }
        
        return 'complete';
    } catch {
        return ans && String(ans).trim() !== '' ? 'complete' : 'unanswered';
    }
};

export interface ExamViewerProps {
    mode: 'exam' | 'preview';
    questions: any[];
    answers: Record<string, any>;
    doubtfulAnswers: Set<string>;
    
    // Actions
    onAnswerChange: (questionId: string, answer: any) => void;
    onToggleDoubtful: (questionId: string) => void;
    
    // Info
    studentName: string;
    studentNisn?: string;
    studentClass?: string;
    examTitle: string;
    
    // Navigation Control (Optional, allows parent to override internal state)
    currentQIndex?: number;
    onNavigate?: (index: number) => void;
    
    // Exam specific
    timeLeft?: number;
    isSafeMode?: boolean;
    violationCount?: number;
    maxViolations?: number;
    showViolationModal?: boolean;
    violationType?: string;
    onCloseViolationModal?: () => void;
    onRequestFullscreen?: () => void;
    isFullScreen?: boolean;
    onSubmitExam?: (assignmentSubmission?: { documentUrl?: string, videoUrl?: string }) => Promise<void>;
    submitting?: boolean;
    
    // Preview specific
    onPreviewClose?: () => void;
    onPreviewFinish?: () => void;

    // Assignment specific
    isAssignment?: boolean;
    assignmentData?: any;
    examId?: string;
    userId?: string;
    onAssignmentFilesChange?: (urls: string[]) => void;
    /** File tugas yang sudah terunggah — dipulihkan setelah reload. */
    assignmentFileUrls?: string[];
    onAssignmentTextChange?: (text: string) => void;

    // Realtime Updates
    updatedQuestionIds?: Set<string>;
    onClearUpdated?: (questionId: string) => void;
}

export function ExamViewer({
    mode,
    questions,
    answers,
    doubtfulAnswers,
    onAnswerChange,
    onToggleDoubtful,
    studentName,
    studentNisn,
    studentClass,
    examTitle,
    currentQIndex: externalIndex,
    onNavigate,
    timeLeft = 0,
    isSafeMode = false,
    violationCount = 0,
    maxViolations = 3,
    showViolationModal = false,
    violationType = '',
    onCloseViolationModal,
    onRequestFullscreen,
    isFullScreen = false,
    onSubmitExam,
    submitting = false,
    onPreviewClose,
    onPreviewFinish,
    isAssignment = false,
    assignmentData,
    examId = '',
    userId = '',
    onAssignmentFilesChange,
    assignmentFileUrls = [],
    onAssignmentTextChange,
    updatedQuestionIds = new Set(),
    onClearUpdated,
}: ExamViewerProps) {
    const [internalIndex, setInternalIndex] = useState(0);
    const currentQIndex = externalIndex !== undefined ? externalIndex : internalIndex;
    const [displayMode, setDisplayMode] = useState<'one-col' | 'two-col'>('one-col');
    // Mobile SELALU 1 kolom (soal & opsi bersusun ke bawah) — pilihan 2 kolom
    // hanya berlaku di layar md ke atas, tempat toggle-nya berada. Tanpa ini,
    // mode 2 kolom yang dipilih di desktop ikut terbawa saat viewport menyempit
    // (resize/rotasi tablet) dan tampilannya jadi sempit tak terbaca.
    const [isMdUp, setIsMdUp] = useState(true);
    useEffect(() => {
        const mq = window.matchMedia('(min-width: 768px)');
        const update = () => setIsMdUp(mq.matches);
        update();
        mq.addEventListener('change', update);
        return () => mq.removeEventListener('change', update);
    }, []);
    const effectiveDisplayMode = isMdUp ? displayMode : 'one-col';
    const [showConfirmModal, setShowConfirmModal] = useState(false);
    const [confirmText, setConfirmText] = useState('');
    const [showNavModal, setShowNavModal] = useState(false);
    const [studentDocUrl, setStudentDocUrl] = useState('');
    const [studentVidUrl, setStudentVidUrl] = useState('');

    const navigateTo = useCallback((index: number) => {
        if (index < 0 || index >= questions.length) return;
        if (onNavigate) {
            onNavigate(index);
        } else {
            setInternalIndex(index);
        }
    }, [onNavigate, questions.length]);

    // Clear updated status when question becomes active
    useEffect(() => {
        if (questions && questions[currentQIndex]) {
            const qId = questions[currentQIndex].id;
            if (updatedQuestionIds.has(qId)) {
                onClearUpdated?.(qId);
            }
        }
    }, [currentQIndex, questions, updatedQuestionIds, onClearUpdated]);

    const isLastQuestion = currentQIndex === questions.length - 1;
    const isFirstQuestion = currentQIndex === 0;
    const currentQ = questions[currentQIndex];
    
    let completeCount = 0;
    let partialCount = 0;
    questions.forEach(q => {
        const st = getAnswerStatus(q, answers[q.id]);
        if (st === 'complete') completeCount++;
        else if (st === 'partial') partialCount++;
    });
    
    const answeredCount = completeCount + partialCount;
    const doubtCount = doubtfulAnswers.size;
    const unansweredCount = questions.length - answeredCount;
    const progress = questions.length > 0 ? ((answeredCount) / questions.length) * 100 : 0;

    // Timer formatting
    const formatTime = (seconds: number) => {
        const m = Math.floor(seconds / 60);
        const s = seconds % 60;
        return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    };

    // Keyboard Navigation
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // Abaikan jika sedang mengetik di input/textarea
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
            if (e.key === 'ArrowLeft' && !isFirstQuestion) {
                navigateTo(currentQIndex - 1);
            } else if (e.key === 'ArrowRight' && !isLastQuestion) {
                navigateTo(currentQIndex + 1);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isFirstQuestion, isLastQuestion, currentQIndex, navigateTo]);

    if (!isAssignment && (!questions || questions.length === 0 || !currentQ)) {
        return (
            <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/60">
                <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
                    className="bg-white rounded-lg p-12 max-w-sm w-full text-center shadow-xl">
                    <div className="w-14 h-14 bg-slate-100 rounded-lg flex items-center justify-center mx-auto mb-5"><X size={22} className="text-slate-400" /></div>
                    <h3 className="text-lg font-bold text-slate-800 mb-2">Tidak Ada Soal</h3>
                    <p className="text-sm text-slate-500 mb-8">Data soal tidak tersedia.</p>
                    <button onClick={onPreviewClose} className="px-8 py-3 bg-slate-800 text-white rounded-lg text-sm font-semibold hover:bg-slate-700 transition-all">Tutup</button>
                </motion.div>
            </div>
        );
    }

    const handleSubmitClick = () => {
        if (mode === 'exam') {
            setConfirmText('');
            setShowConfirmModal(true);
        } else {
            onPreviewFinish?.();
        }
    };

    const renderBody = () => {
        if (isAssignment && (!questions || questions.length === 0)) {
            return (
                <main className="flex-1 overflow-y-auto bg-slate-50 px-4 md:px-8 py-8 flex justify-center">
                    <div className="max-w-2xl w-full bg-white rounded-2xl shadow-sm border border-slate-200 p-6 md:p-8 space-y-6 h-fit">
                        <div className="text-center pb-5 border-b border-slate-100">
                            <div className="w-12 h-12 bg-amber-100 rounded-xl flex items-center justify-center mx-auto mb-3">
                                <FileText size={22} className="text-amber-600" />
                            </div>
                            <h2 className="text-xl font-bold text-slate-800 mb-1">Pengumpulan Tugas</h2>
                            <p className="text-sm text-slate-500">Kerjakan dan kumpulkan tugas Anda di bawah ini.</p>
                        </div>
                        
                        {/* Instruksi Tugas */}
                        {assignmentData?.assignment_description && (
                            <div className="p-4 bg-amber-50 rounded-xl border border-amber-200">
                                <div className="flex items-center gap-2 mb-2">
                                    <BookOpen size={14} className="text-amber-600" />
                                    <h3 className="text-xs font-bold text-amber-700 uppercase tracking-wider">Instruksi Tugas</h3>
                                </div>
                                <p className="text-sm text-slate-700 whitespace-pre-wrap">{assignmentData.assignment_description}</p>
                            </div>
                        )}

                        {/* Materi referensi */}
                        {(assignmentData?.documentUrl || assignmentData?.videoUrl) && (
                            <div className="space-y-3">
                                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Materi Referensi</h3>
                                {assignmentData.videoUrl && (
                                    <div className="rounded-xl overflow-hidden shadow-sm border border-slate-200 aspect-video">
                                        <iframe src={assignmentData.videoUrl.replace('watch?v=', 'embed/')} className="w-full h-full" allowFullScreen></iframe>
                                    </div>
                                )}
                                {assignmentData.documentUrl && (
                                    <a href={assignmentData.documentUrl} target="_blank" rel="noopener noreferrer" className="block w-full p-4 bg-blue-50 text-blue-700 font-bold rounded-xl border border-blue-200 text-center hover:bg-blue-100 transition-colors">
                                        Buka Dokumen / Lampiran Tugas
                                    </a>
                                )}
                            </div>
                        )}

                        {/* Upload File */}
                        {assignmentData?.allow_file_upload && examId && userId && (
                            <div className="space-y-3">
                                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Unggah File Tugas</h3>
                                <AssignmentUploader
                                    examId={examId}
                                    userId={userId}
                                    allowedFileTypes={assignmentData.allowed_file_types || ['pdf']}
                                    initialUrls={assignmentFileUrls}
                                    onFilesChange={urls => onAssignmentFilesChange?.(urls)}
                                />
                            </div>
                        )}

                        {/* URL submission (tetap tersedia) */}
                        <div className="space-y-3 pt-2">
                            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Link / URL Tugas (Opsional)</h3>
                            <div className="space-y-2">
                                <label className="text-xs font-bold text-slate-600">URL File Tugas (Google Drive, dll.)</label>
                                <input
                                    type="url"
                                    value={studentDocUrl}
                                    onChange={(e) => setStudentDocUrl(e.target.value)}
                                    placeholder="https://..."
                                    className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3.5 focus:ring-2 focus:ring-primary/20 outline-none font-medium text-slate-800 shadow-inner"
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-xs font-bold text-slate-600">Catatan / Deskripsi <span className="font-normal text-slate-400">(Opsional)</span></label>
                                <textarea
                                    rows={3}
                                    value={studentVidUrl}
                                    onChange={(e) => { setStudentVidUrl(e.target.value); onAssignmentTextChange?.(e.target.value); }}
                                    placeholder="Catatan tambahan untuk guru..."
                                    className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3.5 focus:ring-2 focus:ring-primary/20 outline-none text-slate-800 shadow-inner resize-none"
                                />
                            </div>
                        </div>

                        <div className="pt-2">
                            <button
                                onClick={handleSubmitClick}
                                className="w-full py-4 bg-emerald-500 text-white rounded-xl font-bold text-base hover:bg-emerald-600 transition-all shadow-md shadow-emerald-200 flex justify-center items-center gap-2"
                            >
                                <Check size={20} />
                                Kumpulkan Tugas
                            </button>
                        </div>
                    </div>
                </main>
            );
        }

        return (
            <div className="flex-1 flex min-h-0 flex-col md:flex-row-reverse">
                {/* SIDEBAR - Desktop only */}
                <aside className="hidden md:flex w-[280px] shrink-0 bg-white border-l border-slate-200 flex-col">
                    <div className="px-5 pt-5 pb-3 border-b border-slate-50">
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Daftar Soal</p>
                    </div>
                    <div className="flex-1 overflow-y-auto p-4">
                        <div className="grid grid-cols-5 gap-2">
                            {questions.map((q: any, idx: number) => {
                                const active = idx === currentQIndex;
                                const status = getAnswerStatus(q, answers[q.id]);
                                const doubtful = doubtfulAnswers.has(q.id);
                                const isUpdated = updatedQuestionIds.has(q.id);
                                
                                let btnClass = 'bg-white text-slate-400 border border-slate-200 hover:border-slate-300 hover:text-slate-600';
                                if (active) {
                                    btnClass = 'bg-blue-600 text-white shadow-md shadow-blue-300/30 border-blue-600';
                                } else if (doubtful) {
                                    btnClass = 'bg-yellow-400 text-slate-800 border-yellow-400';
                                } else if (status === 'complete') {
                                    btnClass = 'bg-green-500 text-white border-green-500';
                                } else if (status === 'partial') {
                                    btnClass = 'bg-pink-500 text-white border-pink-500';
                                }

                                if (isUpdated && !active) {
                                    btnClass += ' ring-2 ring-red-500 ring-offset-1 animate-pulse';
                                }

                                return (
                                    <button key={q.id || idx} onClick={() => navigateTo(idx)}
                                        className={`relative aspect-square flex items-center justify-center text-[11px] font-bold transition-all duration-150 rounded-md ${btnClass}`}>
                                        {idx + 1}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                </aside>

                {/* MAIN */}
                <main className="flex-1 overflow-y-auto bg-slate-50 px-4 md:px-6 py-6 flex flex-col gap-8">
                    <ExamQuestionCard
                        key={currentQ.id}
                        question={currentQ}
                        answer={answers[currentQ.id] || ''}
                        onAnswerChange={(val) => onAnswerChange(currentQ.id, val)}
                        questionNumber={currentQIndex + 1}
                        showToggle={false}
                        onToggleDoubtful={() => onToggleDoubtful(currentQ.id)}
                        isDoubtful={doubtfulAnswers.has(currentQ.id)}
                        displayMode={effectiveDisplayMode}
                        isUpdated={updatedQuestionIds.has(currentQ.id)}
                        examId={examId}
                        userId={userId}
                    />
                    
                    {/* If assignment but has questions, append the submission form at the end */}
                    {isAssignment && isLastQuestion && (
                        <div className="max-w-4xl mx-auto w-full bg-white rounded-2xl shadow-sm border border-slate-200 p-6 md:p-8 space-y-6">
                            <div className="pb-4 border-b border-slate-100">
                                <div className="flex items-center gap-2">
                                    <FileText size={18} className="text-amber-600" />
                                    <h2 className="text-lg font-bold text-slate-800">Pengumpulan Tugas</h2>
                                </div>
                                <p className="text-sm text-slate-500 mt-1">Setelah menjawab soal di atas, kumpulkan tugas Anda di sini.</p>
                            </div>
                            
                            {/* Instruksi */}
                            {assignmentData?.assignment_description && (
                                <div className="p-4 bg-amber-50 rounded-xl border border-amber-200">
                                    <div className="flex items-center gap-2 mb-1.5">
                                        <BookOpen size={13} className="text-amber-600" />
                                        <h3 className="text-xs font-bold text-amber-700 uppercase tracking-wider">Instruksi Tugas</h3>
                                    </div>
                                    <p className="text-sm text-slate-700 whitespace-pre-wrap">{assignmentData.assignment_description}</p>
                                </div>
                            )}

                            {/* Materi Referensi */}
                            {(assignmentData?.documentUrl || assignmentData?.videoUrl) && (
                                <div className="space-y-3">
                                    <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Materi Referensi</h3>
                                    {assignmentData.videoUrl && (
                                        <div className="rounded-xl overflow-hidden shadow-sm border border-slate-200 aspect-video">
                                            <iframe src={assignmentData.videoUrl.replace('watch?v=', 'embed/')} className="w-full h-full" allowFullScreen></iframe>
                                        </div>
                                    )}
                                    {assignmentData.documentUrl && (
                                        <a href={assignmentData.documentUrl} target="_blank" rel="noopener noreferrer" className="block w-full p-3 bg-blue-50 text-blue-700 font-bold rounded-xl border border-blue-200 text-center hover:bg-blue-100 transition-colors">
                                            Buka Dokumen / Lampiran
                                        </a>
                                    )}
                                </div>
                            )}

                            {/* Upload File */}
                            {assignmentData?.allow_file_upload && examId && userId && (
                                <div className="space-y-2">
                                    <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Unggah File Tugas</h3>
                                    <AssignmentUploader
                                        examId={examId}
                                        userId={userId}
                                        allowedFileTypes={assignmentData.allowed_file_types || ['pdf']}
                                        initialUrls={assignmentFileUrls}
                                        onFilesChange={urls => onAssignmentFilesChange?.(urls)}
                                    />
                                </div>
                            )}

                            {/* URL & Catatan */}
                            <div className="space-y-3">
                                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Link / URL Tugas</h3>
                                <div className="space-y-2">
                                    <label className="text-xs font-bold text-slate-600">URL Google Drive / Link Dokumen <span className="font-normal text-slate-400">(Opsional)</span></label>
                                    <input
                                        type="url"
                                        value={studentDocUrl}
                                        onChange={(e) => setStudentDocUrl(e.target.value)}
                                        placeholder="https://..."
                                        className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3.5 focus:ring-2 focus:ring-primary/20 outline-none font-medium text-slate-800 shadow-inner"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-xs font-bold text-slate-600">Catatan untuk Guru <span className="font-normal text-slate-400">(Opsional)</span></label>
                                    <textarea
                                        rows={3}
                                        value={studentVidUrl}
                                        onChange={(e) => { setStudentVidUrl(e.target.value); onAssignmentTextChange?.(e.target.value); }}
                                        placeholder="Catatan tambahan..."
                                        className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3.5 focus:ring-2 focus:ring-primary/20 outline-none text-slate-800 shadow-inner resize-none"
                                    />
                                </div>
                            </div>
                        </div>
                    )}
                </main>
            </div>
        );
    };

    return (
        <div className="fixed inset-0 z-[9999] flex flex-col bg-slate-100 font-sans">
            {/* ── Fullscreen overlay (Hanya mode Ujian Asli) ── */}
            <AnimatePresence>
                {mode === 'exam' && !isFullScreen && isSafeMode && (
                    <motion.div
                        initial={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }}
                        className="fixed inset-0 z-[10000] bg-white flex items-center justify-center p-6"
                    >
                        <div className="text-center max-w-xs">
                            <div className="w-20 h-20 bg-amber-100 rounded-lg flex items-center justify-center mx-auto mb-6">
                                <Maximize2 size={36} className="text-amber-600" />
                            </div>
                            <h2 className="text-2xl font-bold text-slate-800 mb-3">Mode Ujian Aman</h2>
                            <p className="text-slate-500 mb-8 text-base">
                                Aktifkan layar penuh untuk pengalaman ujian terbaik.
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
            <AnimatePresence>
                {mode === 'exam' && showViolationModal && (
                    <motion.div
                        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        className="fixed inset-0 z-[10000] flex items-center justify-center p-4 bg-black/60"
                    >
                        <motion.div
                            initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
                            className="bg-white rounded-lg p-6 max-w-sm w-full text-center shadow-2xl"
                        >
                            <div className="w-16 h-16 bg-amber-100 rounded-lg flex items-center justify-center mx-auto mb-4">
                                <ShieldAlert size={30} className="text-amber-600" />
                            </div>
                            <h3 className="text-xl font-bold text-slate-800 mb-2">Peringatan Pelanggaran</h3>
                            <p className="text-sm text-slate-500 capitalize mb-2">
                                {violationType.replace(/_/g, ' ')}
                            </p>
                            <p className="text-xs text-slate-400 mb-5">
                                {violationCount} dari {maxViolations} maksimum
                            </p>
                            <div className="w-full bg-slate-100 rounded-full h-2 mb-5 overflow-hidden">
                                <motion.div
                                    initial={{ width: 0 }}
                                    animate={{ width: `${(violationCount / maxViolations) * 100}%` }}
                                    className={`h-full ${violationCount >= maxViolations - 1 ? 'bg-red-500' : 'bg-amber-500'}`}
                                />
                            </div>
                            <button
                                onClick={onCloseViolationModal}
                                className="w-full py-3.5 bg-slate-800 text-white rounded-lg font-bold text-sm hover:bg-slate-700 transition-colors"
                            >
                                Mengerti
                            </button>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* HEADER */}
            <header className="shrink-0 bg-white border-b border-slate-200">
                {/* Desktop Header */}
                <div className="hidden md:flex px-6 py-4 items-center justify-between gap-6">
                    {/* KIRI: Profil */}
                    <div className="flex items-center gap-3 shrink-0">
                        {mode === 'preview' ? (
                            <button onClick={onPreviewClose} className="w-9 h-9 flex items-center justify-center rounded-lg hover:bg-slate-100 transition-all">
                                <X size={16} className="text-slate-400" />
                            </button>
                        ) : null}
                        <div className="w-9 h-9 rounded-lg bg-slate-800 items-center justify-center hidden lg:flex">
                            {mode === 'preview' ? <Eye size={15} className="text-white" /> : <User size={15} className="text-white" />}
                        </div>
                        <div className="flex items-center gap-2">
                            <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center">
                                <User size={14} className="text-slate-500" />
                            </div>
                            <div>
                                <p className="text-sm font-semibold text-slate-800 leading-tight max-w-[150px] md:max-w-xs truncate">
                                    {studentName}
                                </p>
                                <p className="text-[11px] text-slate-400 leading-tight truncate max-w-[150px] md:max-w-xs">
                                    {studentNisn ? `NISN ${studentNisn} • ` : ''}{studentClass ? `${studentClass} • ` : ''}{examTitle}
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* TENGAH: Info soal */}
                    <div className="flex-1 flex items-center justify-center gap-4">
                        <span className="px-3 py-1.5 bg-primary/10 text-primary text-xs font-bold rounded-lg uppercase">
                            {currentQ?.type === 'mcq' ? 'PG' : currentQ?.type === 'mcq_complex' ? 'PGK' : currentQ?.type === 'true_false' ? 'BS' : currentQ?.type === 'matching' ? 'MJ' : currentQ?.type === 'categorization' ? 'CAT' : currentQ?.type === 'short_answer' ? 'ISIAN' : currentQ?.type === 'essay' ? 'ESAI' : currentQ?.type?.replace('_', ' ')}
                        </span>
                        <span className="text-sm text-slate-500">{currentQ?.score_default || 1} poin</span>
                        {doubtfulAnswers.has(currentQ?.id) && (
                            <span className="px-2.5 py-1 bg-amber-100 text-amber-600 text-xs font-semibold rounded-lg">Ragu</span>
                        )}
                        <div className="w-32 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                            <motion.div className="h-full bg-slate-800 rounded-full" initial={{ width: 0 }} animate={{ width: `${progress}%` }} transition={{ duration: 0.4, ease: 'easeOut' }} />
                        </div>
                        <span className="text-[11px] text-slate-400">{answeredCount}/{questions.length}</span>
                    </div>

                    {/* KANAN: Timer & Toggle kolom */}
                    <div className="flex items-center gap-3 shrink-0">
                        {/* Timer */}
                        {mode === 'exam' && (
                            <div className={`px-4 py-2 rounded-lg flex items-center gap-2 font-mono font-bold text-sm transition-all ${
                                timeLeft < 300
                                    ? 'bg-red-50 text-red-600 border border-red-200 animate-pulse'
                                    : timeLeft < 600
                                    ? 'bg-amber-50 text-amber-600 border border-amber-200'
                                    : 'bg-slate-50 text-slate-700 border border-slate-200'
                            }`}>
                                <Clock size={16} />
                                <span className="text-base">{formatTime(timeLeft)}</span>
                            </div>
                        )}
                        
                        <div className="hidden md:flex items-center gap-1 bg-slate-100 rounded-lg p-1.5 shrink-0">
                            <button onClick={() => setDisplayMode('one-col')}
                                className={`flex items-center justify-center w-9 h-9 rounded-lg transition-all ${displayMode === 'one-col' ? 'bg-white text-slate-800 shadow' : 'text-slate-400 hover:text-slate-600'}`}>
                                <Rows3 size={16} />
                            </button>
                            <button onClick={() => setDisplayMode('two-col')}
                                className={`flex items-center justify-center w-9 h-9 rounded-lg transition-all ${displayMode === 'two-col' ? 'bg-white text-slate-800 shadow' : 'text-slate-400 hover:text-slate-600'}`}>
                                <Columns2 size={16} />
                            </button>
                        </div>
                    </div>
                </div>

                {/* Mobile Header - Compact */}
                <div className="md:hidden px-3 py-2 flex items-center justify-between gap-3">
                    {/* Left: Close Button & Profile */}
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                        {mode === 'preview' && (
                            <button onClick={onPreviewClose} className="w-8 h-8 shrink-0 flex items-center justify-center rounded-lg hover:bg-slate-100 transition-all">
                                <X size={14} className="text-slate-400" />
                            </button>
                        )}
                        <div className="flex items-center gap-2 min-w-0 pr-2">
                            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                                <User size={14} className="text-primary" />
                            </div>
                            <div className="min-w-0 flex flex-col leading-tight">
                                <span className="text-xs font-bold text-slate-700 truncate">{studentName || 'Peserta Ujian'}</span>
                                {studentNisn && (
                                    <span className="text-[10px] text-slate-400 truncate">NISN {studentNisn}</span>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Right: Type & Flag — mobile SELALU 1 kolom (soal lalu
                        opsi bersusun ke bawah); toggle 1/2 kolom hanya untuk
                        desktop di header md:. */}
                    <div className="flex items-center gap-2 shrink-0">
                        <span className="px-2 py-1 bg-slate-100 text-slate-600 text-[10px] font-bold rounded-lg uppercase">
                            {currentQ?.type === 'mcq' ? 'PG' : currentQ?.type === 'mcq_complex' ? 'PGK' : currentQ?.type === 'true_false' ? 'BS' : currentQ?.type === 'matching' ? 'MJ' : currentQ?.type === 'categorization' ? 'CAT' : currentQ?.type === 'short_answer' ? 'ISIAN' : currentQ?.type === 'essay' ? 'ESAI' : currentQ?.type?.replace('_', ' ')}
                        </span>
                        <button onClick={() => onToggleDoubtful(currentQ.id)}
                            className={`w-8 h-8 flex items-center justify-center rounded-lg transition-all ${doubtfulAnswers.has(currentQ.id) ? 'bg-yellow-400 text-slate-800' : 'bg-slate-100 text-slate-400'}`}>
                            <Flag size={12} className={doubtfulAnswers.has(currentQ.id) ? "fill-slate-800" : ""} />
                        </button>
                    </div>
                </div>

                {/* Mobile progress bar */}
                <div className="md:hidden w-full h-1 bg-slate-100">
                    <motion.div className="h-full bg-primary" initial={{ width: 0 }} animate={{ width: `${progress}%` }} />
                </div>
            </header>

            {/* BODY */}
            {renderBody()}

            {/* FOOTER */}
            <div className="shrink-0 bg-white border-t border-slate-200 px-3 md:px-5 py-2.5 md:py-3 safe-area-inset-bottom">
                <div className="flex items-center justify-between gap-2 md:flex-row-reverse">
                    {/* Navigasi Mobile (Tampilkan Modal) */}
                    <button onClick={() => setShowNavModal(true)} className="md:hidden flex items-center justify-center gap-1.5 px-3 h-10 rounded-lg bg-slate-100 text-slate-700 font-bold text-xs hover:bg-slate-200 transition-all shrink-0">
                        <Grid3X3 size={14} />
                        {currentQIndex + 1}/{questions.length}
                    </button>

                    {/* Navigation buttons */}
                    <div className="flex items-center gap-1.5 md:gap-2 flex-1 md:w-[260px] md:flex-none justify-end md:justify-between shrink-0">
                        <button onClick={() => navigateTo(currentQIndex - 1)} disabled={isFirstQuestion}
                            className="shrink-0 w-20 h-10 md:w-20 rounded-lg bg-white border border-slate-200 text-slate-600 hover:text-primary hover:border-primary/30 hover:bg-primary/5 disabled:opacity-40 transition-all shadow-sm flex items-center justify-center">
                            <ChevronLeft size={20} className="md:hidden" strokeWidth={2.5} />
                            <div className="hidden md:flex items-center -space-x-1.5 group-hover:-translate-x-1 transition-transform">
                                <ChevronLeft size={18} strokeWidth={2.5} className="opacity-50" />
                                <ChevronLeft size={18} strokeWidth={2.5} className="opacity-75" />
                                <ChevronLeft size={18} strokeWidth={2.5} className="opacity-100" />
                            </div>
                        </button>

                        <button onClick={() => onToggleDoubtful(currentQ.id)}
                            className={`flex-1 md:flex-none md:w-auto flex items-center justify-center gap-1.5 px-3 md:px-3 h-10 rounded-lg font-bold text-xs transition-all shadow-sm ${
                                doubtfulAnswers.has(currentQ.id)
                                ? 'bg-yellow-400 text-slate-800 shadow-yellow-200 hover:bg-yellow-500'
                                : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
                            }`}>
                            <Flag size={14} className={doubtfulAnswers.has(currentQ.id) ? "fill-slate-800" : ""} />
                            <span>Ragu</span>
                        </button>

                        {!isLastQuestion ? (
                            <button onClick={() => navigateTo(currentQIndex + 1)}
                                className="shrink-0 w-20 h-10 md:w-20 rounded-lg bg-white border border-slate-200 text-slate-600 hover:text-primary hover:border-primary/30 hover:bg-primary/5 transition-all shadow-sm flex items-center justify-center">
                                <ChevronRight size={20} className="md:hidden" strokeWidth={2.5} />
                                <div className="hidden md:flex items-center -space-x-1.5 group-hover:translate-x-1 transition-transform">
                                    <ChevronRight size={18} strokeWidth={2.5} className="opacity-100" />
                                    <ChevronRight size={18} strokeWidth={2.5} className="opacity-75" />
                                    <ChevronRight size={18} strokeWidth={2.5} className="opacity-50" />
                                </div>
                            </button>
                        ) : (
                            <button onClick={() => {
                                if (mode === 'exam') {
                                    setConfirmText('');
                                    setShowConfirmModal(true);
                                } else {
                                    onPreviewFinish?.();
                                }
                            }}
                                className="shrink-0 flex items-center justify-center gap-1.5 px-3 h-10 md:w-20 bg-emerald-500 text-white rounded-lg text-xs font-bold shadow-sm shadow-emerald-200 hover:bg-emerald-600 transition-all">
                                <span>Selesai</span>
                                <Check size={14} strokeWidth={2.5} className="hidden md:block" />
                            </button>
                        )}
                    </div>

                    {/* Stats - Desktop only */}
                    <div className="hidden md:flex items-center gap-2 text-xs font-semibold">
                        <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-emerald-50 text-emerald-700" title="Terjawab Lengkap">
                            <div className="w-3 h-3 rounded-[2px] bg-green-500" /> {completeCount}
                        </div>
                        <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-pink-50 text-pink-700" title="Terjawab Sebagian">
                            <div className="w-3 h-3 rounded-[2px] bg-pink-500" /> {partialCount}
                        </div>
                        <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-yellow-50 text-yellow-700" title="Ragu-Ragu">
                            <div className="w-3 h-3 rounded-[2px] bg-yellow-400" /> {doubtCount}
                        </div>
                        <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-slate-100 text-slate-600" title="Belum Terjawab">
                            <div className="w-3 h-3 rounded-[2px] bg-white border border-slate-300" /> {unansweredCount}
                        </div>
                    </div>
                </div>
            </div>

            {/* ── Question Navigator Modal (Mobile) ── */}
            <AnimatePresence>
                {showNavModal && (
                    <>
                        <motion.div
                            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                            onClick={() => setShowNavModal(false)}
                            className="fixed inset-0 z-[10001] bg-black/60 md:hidden"
                        />
                        <motion.div
                            initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
                            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                            className="fixed bottom-0 left-0 right-0 z-[10002] bg-white rounded-t-2xl shadow-2xl max-h-[80vh] flex flex-col md:hidden"
                        >
                            <div className="flex justify-center py-3">
                                <div className="w-10 h-1 bg-slate-300 rounded-full" />
                            </div>
                            <div className="px-5 pb-3 border-b border-slate-100 flex items-center justify-between">
                                <div>
                                    <h3 className="font-bold text-slate-800">Navigasi Soal</h3>
                                </div>
                                <button onClick={() => setShowNavModal(false)} className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center">
                                    <X size={16} className="text-slate-500" />
                                </button>
                            </div>
                            <div className="px-5 py-3 border-b border-slate-100 bg-slate-50 flex items-center justify-between gap-1 text-[10px] font-semibold">
                                <div className="flex flex-col items-center gap-1 text-emerald-700">
                                    <div className="w-3 h-3 rounded-[2px] bg-green-500 shadow-sm" />
                                    <span>{completeCount} Lengkap</span>
                                </div>
                                <div className="flex flex-col items-center gap-1 text-pink-700">
                                    <div className="w-3 h-3 rounded-[2px] bg-pink-500 shadow-sm" />
                                    <span>{partialCount} Sebagian</span>
                                </div>
                                <div className="flex flex-col items-center gap-1 text-yellow-700">
                                    <div className="w-3 h-3 rounded-[2px] bg-yellow-400 shadow-sm" />
                                    <span>{doubtCount} Ragu</span>
                                </div>
                                <div className="flex flex-col items-center gap-1 text-slate-600">
                                    <div className="w-3 h-3 rounded-[2px] bg-white border-2 border-slate-300" />
                                    <span>{unansweredCount} Kosong</span>
                                </div>
                            </div>
                            <div className="flex-1 overflow-y-auto p-4">
                                <div className="grid grid-cols-5 gap-2">
                                    {questions.map((q: any, idx: number) => {
                                        const active = idx === currentQIndex;
                                        const status = getAnswerStatus(q, answers[q.id]);
                                        const doubtful = doubtfulAnswers.has(q.id);
                                        const isUpdated = updatedQuestionIds.has(q.id);
                                        
                                        let btnClass = 'bg-white text-slate-400 border border-slate-200 hover:border-slate-300 hover:text-slate-600';
                                        if (active) {
                                            btnClass = 'bg-blue-600 text-white shadow-md shadow-blue-300/30 border-blue-600';
                                        } else if (doubtful) {
                                            btnClass = 'bg-yellow-400 text-slate-800 border-yellow-400';
                                        } else if (status === 'complete') {
                                            btnClass = 'bg-green-500 text-white border-green-500';
                                        } else if (status === 'partial') {
                                            btnClass = 'bg-pink-500 text-white border-pink-500';
                                        }

                                        if (isUpdated && !active) {
                                            btnClass += ' ring-2 ring-red-500 ring-offset-1 animate-pulse';
                                        }

                                        return (
                                            <button key={q.id || idx} onClick={() => { navigateTo(idx); setShowNavModal(false); }}
                                                className={`aspect-square rounded-md font-bold text-[11px] flex items-center justify-center transition-all ${btnClass}`}>
                                                {idx + 1}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        </motion.div>
                    </>
                )}
            </AnimatePresence>

            {/* ── Submit confirmation modal (Hanya Exam) ── */}
            <AnimatePresence>
                {mode === 'exam' && showConfirmModal && (
                    <motion.div
                        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        className="fixed inset-0 z-[10000] flex items-center justify-center p-4 bg-black/60"
                    >
                        <motion.div
                            initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
                            className="bg-white rounded-lg p-6 max-w-sm w-full shadow-2xl"
                        >
                            <div className="text-center mb-5">
                                <div className="w-16 h-16 bg-emerald-100 rounded-lg flex items-center justify-center mx-auto mb-4">
                                    <CheckCircle2 size={30} className="text-emerald-600" />
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
                                    {partialCount > 0 && (
                                        <div className="text-center px-4 py-2 rounded-lg bg-yellow-100">
                                            <p className="text-2xl font-black text-yellow-600">{partialCount}</p>
                                            <p className="text-xs text-slate-500">Sebagian</p>
                                        </div>
                                    )}
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
                                    onChange={(e) => setConfirmText(e.target.value.toUpperCase())}
                                    placeholder="Ketik SELESAI"
                                    className="w-full p-4 border-2 border-slate-200 rounded-lg text-center font-mono text-xl tracking-widest focus:border-primary/50 focus:ring-2 focus:ring-primary/10 outline-none uppercase bg-slate-50"
                                    autoComplete="off"
                                />
                                <button
                                    onClick={() => {
                                        if (onSubmitExam) onSubmitExam({ documentUrl: studentDocUrl, videoUrl: studentVidUrl });
                                    }}
                                    disabled={confirmText !== 'SELESAI' || submitting}
                                    className="w-full py-4 bg-emerald-500 text-white rounded-lg font-bold text-base hover:bg-emerald-600 disabled:opacity-40 flex items-center justify-center gap-3 touch-manipulation transition-all"
                                >
                                    {submitting ? <Loader2 size={18} className="animate-spin" /> : <Check size={18} />}
                                    Konfirmasi & Kirim
                                </button>
                                <button
                                    onClick={() => setShowConfirmModal(false)}
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
