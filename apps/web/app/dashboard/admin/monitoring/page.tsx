"use client";
import '@/app/components/monitoring/monitoring.css';
import { ExamKeyCorrectionButton } from '@/app/components/ExamKeyCorrectionButton';
import { sortMonitoringExams } from '@/lib/monitoring-exams';
import { useMonitoringExamClock } from '@/lib/useMonitoringExamClock';
import { ActiveParticipantsPanel } from '@/app/components/ActiveParticipantsPanel';
import { MonitoringHealthPanel } from '@/app/components/MonitoringHealthPanel';
import { ScreenShareExceptionsPanel } from '@/app/components/monitoring/ScreenShareExceptionsPanel';
import { MonitoringPASAdministrationPanel } from '@/app/components/monitoring/MonitoringPASAdministrationPanel';
import { alertDialog, confirmDialog } from '@/lib/confirm-dialog';
import { ResetExamModal } from '@/app/components/monitoring';
import { BulkResetPanel } from '@/app/components/monitoring/BulkResetPanel';
import { LatexRenderer } from '@/app/components/questions/LatexRenderer';
import { MonitoringWorkspaceHeader } from '@/app/components/monitoring/MonitoringWorkspaceHeader';
import { MonitoringParticipantFilters } from '@/app/components/monitoring/MonitoringParticipantFilters';
import { MonitoringResultsTable } from '@/app/components/monitoring/MonitoringResultsTable';
import { hasMonitoringAdministration } from '@/lib/monitoring-tabs';
import { PASRoomMonitoringLink } from '@/app/components/monitoring/PASRoomMonitoringLink';
import { Button } from '@/app/components/ui/button';
import { calculateExamIRT } from '@/lib/api/grading';
import { finishAttemptAction,getExamAnswersForAnalysisAction,getExamAttemptsAction,getExamAttemptsResult,getProctorOrganization,listOrganizationExams } from '@/lib/api/proctor';
import type {
    ExamAttemptRecord,
    OrganizationExam,

    DetailedItemAnalysisResponse,
    StudentAnswerSummary,
    ItemAnalysis,
} from '@/lib/api/proctor';
import { getSessionUser } from '@/lib/session';
import { formatStudentName } from '@/lib/monitoring-health';
import { useMemoryState } from '@/lib/useMemoryState';
import { getSchoolTimeZone } from '@/lib/school-time';
import { exportDetailedAnalysisToExcel } from '@/lib/export-excel-analysis';
import { AnimatePresence,motion } from 'framer-motion';
import {
AlertTriangle,
Calculator,
CheckCircle2,
Eye,
Loader2,
ShieldAlert,
UserCheck,
UserX,
PieChart,
X
} from 'lucide-react';
import { useRouter,useSearchParams } from 'next/navigation';
import { Suspense,useCallback,useDeferredValue,useEffect,useRef,useState } from 'react';

export type { ItemAnalysis };

const QUESTION_TYPE_INDONESIAN_LABELS: Record<string, string> = {
    mcq: 'PG',
    mcq_complex: 'PGK',
    true_false: 'B/S',
    matching: 'Menjodohkan',
    categorization: 'Kategori',
    short_answer: 'Isian',
    essay: 'Esai',
    uraian: 'Esai',
    esay: 'Esai',
    sjt: 'SJT',
    ordering: 'Urutan',
    likert: 'Likert',
    forced_choice: 'Pilihan Paksa',
    checklist: 'Ceklis',
    ranking: 'Peringkat',
    paired_comparison: 'Berpasangan',
};

function formatQuestionType(type?: string): string {
    if (!type) return 'PG';
    const key = type.toLowerCase().trim();
    return QUESTION_TYPE_INDONESIAN_LABELS[key] || type.replace(/_/g, ' ').toUpperCase();
}

function MonitoringContent() {
    const monitoringNow = useMonitoringExamClock();
    const searchParams = useSearchParams();
    const router = useRouter();
    const initialExamId = searchParams.get('exam') || '';

    const [isLoading, setIsLoading] = useMemoryState('proktor_monitoring_isLoading', true);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [exams, setExams] = useMemoryState<OrganizationExam[]>('proktor_monitoring_exams', []);
    const [selectedExamId, setSelectedExamId] = useState<string>(initialExamId);

    const [attempts, setAttempts] = useMemoryState<ExamAttemptRecord[]>('proktor_monitoring_attempts', []);
    const [analysis, setAnalysis] = useMemoryState<ItemAnalysis[]>('proktor_monitoring_analysis', []);
    const [, setDetailedAnalysis] = useMemoryState<DetailedItemAnalysisResponse | null>('admin_monitoring_detailedAnalysis', null);
    const [modalActiveTab, setModalActiveTab] = useState<'soal' | 'benar' | 'salah' | 'distraktor'>('soal');

    const [activeTab, setActiveTab] = useState<'live' | 'answers' | 'results' | 'analysis' | 'reset' | 'admin'>('live');
    const [viewQuestion, setViewQuestion] = useState<ItemAnalysis | null>(null);
    const [searchName, setSearchName] = useState('');
    const [filterKelas, setFilterKelas] = useState<string[]>([]);
    const [filterStatus, setFilterStatus] = useState<string>('all');
    const [resetStatus, setResetStatus] = useState('all');
    const [onlyAttention, setOnlyAttention] = useState(false);
    const [analysisPage, setAnalysisPage] = useState(1);
    const [loadError, setLoadError] = useState<string | null>(null);
    const examRequestGenerationRef = useRef(0);
    const lastRequestedExamIdRef = useRef<string | null>(null);


    const loadInitialData = useCallback(async () => {
        setIsLoading(true);
        const user = await getSessionUser();
        if (user) {
            const org = await getProctorOrganization();
            console.log('[Monitoring] Org:', org);
            if (org) {
                const examList = sortMonitoringExams(await listOrganizationExams());
                console.log('[Monitoring] Exams:', examList);
                setExams(examList);
                if (!initialExamId && examList.length > 0) setSelectedExamId(examList[0].id);
            }
        }
        setIsLoading(false);
    }, [initialExamId, setExams, setIsLoading]);

    const loadingExamIdsRef = useRef(new Map<string, number>());
    const loadExamData = useCallback(async (examId: string, silent = false) => {
        if (silent && loadingExamIdsRef.current.has(examId)) return;
        const generation = ++examRequestGenerationRef.current;
        loadingExamIdsRef.current.set(examId, generation);
        if (lastRequestedExamIdRef.current !== examId) {
            lastRequestedExamIdRef.current = examId;
            setAttempts([]);
            setAnalysis([]);
            setDetailedAnalysis(null);
            setLoadError(null);
            setSearchName('');
            setFilterKelas([]);
            setFilterStatus('all');
            setOnlyAttention(false);
        }
        if (!silent) setIsRefreshing(true);
        try {
            const [attemptsResult, analysisData] = await Promise.all([
                getExamAttemptsResult(examId).then(result => {
                    if (generation === examRequestGenerationRef.current) {
                        if (result.success) { setAttempts(result.attempts); setLoadError(null); }
                        else setLoadError(result.error);
                    }
                    return result;
                }),
                activeTab === 'analysis' ? getExamAnswersForAnalysisAction(examId) : Promise.resolve({ questions: [], answers: [], detailed: null })
            ]);
            if (generation !== examRequestGenerationRef.current) return;
            if (!attemptsResult.success) {
                setLoadError(attemptsResult.error);
                return;
            }
            const attData = attemptsResult.attempts;
            setAttempts(attData);
            setDetailedAnalysis(analysisData.detailed || null);

            if (analysisData.detailed?.items?.length) {
                const analysisArray: ItemAnalysis[] = analysisData.detailed.items.map((item) => ({
                    id: item.id,
                    number: item.number,
                    qText: item.question_text,
                    type: item.type,
                    options: item.options || [],
                    total: item.total_answered,
                    correct: item.total_correct,
                    incorrect: item.total_incorrect,
                    ungraded: item.total_ungraded,
                    unanswered: item.total_unanswered,
                    keyDisplay: item.key_display,
                    difficultyIndex: item.difficulty_index,
                    difficultyLabel: item.difficulty_label,
                    discriminationIndex: item.discrimination_index,
                    discriminationLabel: item.discrimination_label,
                    wrongStudents: item.wrong_students || [],
                    correctStudents: item.correct_students || [],
                    ungradedStudents: item.ungraded_students || [],
                    unansweredStudents: item.unanswered_students || [],
                    distractorDistribution: item.distractor_distribution || [],
                    incorrectPercentage: item.incorrect_percentage,
                })).sort((a, b) => (b.incorrectPercentage - a.incorrectPercentage) || ((a.number || 0) - (b.number || 0)));

                setAnalysis(analysisArray);
            } else {
                // Fallback jika layanan Python belum mengembalikan detailed
                const studentByAttempt = new Map<string, { name: string; class: string; nis: string }>();
                attData.forEach((att) => {
                    studentByAttempt.set(att.id, {
                        name: formatStudentName(att.profiles?.full_name, 'Tanpa Nama'),
                        class: att.kelas_name || '-',
                        nis: att.profiles?.identity_number || '-',
                    });
                });

                const { questions: bankQuestions, answers: ansRows } = analysisData;
                const itemStats: Record<string, {
                    total: number;
                    correct: number;
                    incorrect: number;
                    ungraded: number;
                    wrongStudents: StudentAnswerSummary[];
                    correctStudents: StudentAnswerSummary[];
                }> = {};

                ansRows.forEach((ans) => {
                    const qId = ans.question_id;
                    if (!itemStats[qId]) itemStats[qId] = { total: 0, correct: 0, incorrect: 0, ungraded: 0, wrongStudents: [], correctStudents: [] };
                    itemStats[qId].total += 1;
                    const stu = studentByAttempt.get(ans.attempt_id ?? '') || { name: 'Tanpa Nama', class: '-', nis: '-' };
                    const summary: StudentAnswerSummary = {
                        attempt_id: ans.attempt_id ?? '',
                        student_name: stu.name,
                        class_name: stu.class,
                        student_nis: stu.nis,
                        score: ans.score != null ? Number(ans.score) : (ans.is_correct ? 1 : 0),
                        display_answer: ans.selected_option_id || (typeof ans.essay_answer === 'string' ? ans.essay_answer : '-'),
                        is_correct: ans.is_correct ?? null,
                    };

                    if (ans.is_correct === true) {
                        itemStats[qId].correct += 1;
                        itemStats[qId].correctStudents.push(summary);
                    } else if (ans.is_correct === false) {
                        itemStats[qId].incorrect += 1;
                        itemStats[qId].wrongStudents.push(summary);
                    } else {
                        itemStats[qId].ungraded += 1;
                    }
                });

                const analysisArray: ItemAnalysis[] = bankQuestions.map((q) => {
                    const stat = itemStats[q.id] || { total: 0, correct: 0, incorrect: 0, ungraded: 0, wrongStudents: [], correctStudents: [] };
                    const graded = stat.correct + stat.incorrect;
                    return {
                        id: q.id,
                        number: q.number ?? 0,
                        qText: q.question_text,
                        type: q.type,
                        options: q.options || [],
                        total: stat.total,
                        correct: stat.correct,
                        incorrect: stat.incorrect,
                        ungraded: stat.ungraded,
                        wrongStudents: [...stat.wrongStudents].sort((a, b) => a.student_name.localeCompare(b.student_name)),
                        correctStudents: [...stat.correctStudents].sort((a, b) => a.student_name.localeCompare(b.student_name)),
                        incorrectPercentage: graded > 0 ? (stat.incorrect / graded) * 100 : 0
                    };
                }).sort((a, b) => (b.incorrectPercentage - a.incorrectPercentage) || ((a.number || 0) - (b.number || 0)));

                setAnalysis(analysisArray);
            }
            setLoadError(null);
        } catch (error) {
            console.error('[Monitoring] Load error:', error);
            if (generation === examRequestGenerationRef.current) {
                setLoadError(error instanceof Error ? error.message : 'Data monitoring belum dapat dimuat.');
            }
        } finally {
            if (loadingExamIdsRef.current.get(examId) === generation) loadingExamIdsRef.current.delete(examId);
            if (!silent && generation === examRequestGenerationRef.current) setIsRefreshing(false);
        }
    }, [activeTab, setAnalysis, setAttempts, setDetailedAnalysis]);

    useEffect(() => {
        const timer = window.setTimeout(() => void loadInitialData(), 0);
        return () => window.clearTimeout(timer);
    }, [loadInitialData]);

    useEffect(() => {
        const timer = window.setTimeout(() => {
            setAnalysisPage(1);
            if (selectedExamId) void loadExamData(selectedExamId);
            else {
                examRequestGenerationRef.current += 1;
                lastRequestedExamIdRef.current = null;
                setAttempts([]);
                setAnalysis([]);
                setDetailedAnalysis(null);
                setLoadError(null);
            }
        }, 0);
        return () => window.clearTimeout(timer);
    }, [loadExamData, selectedExamId, setAnalysis, setAttempts, setDetailedAnalysis]);

    const handleRefresh = () => { if (selectedExamId) loadExamData(selectedExamId); };

    // Auto-refresh interval
    useEffect(() => {
        if (!selectedExamId) return;
        const interval = setInterval(() => {
            loadExamData(selectedExamId, true);
        }, 15000);
        return () => clearInterval(interval);
    }, [loadExamData, selectedExamId]);

    const [selectedResetAttempt, setSelectedResetAttempt] = useState<ExamAttemptRecord | null>(null);

    const canResetParticipants = exams.find(exam => exam.id === selectedExamId)?.canResetParticipants === true;

    const handleFinishAttempt = async (attempt: ExamAttemptRecord, reason: string): Promise<string | null> => {
        const result = await finishAttemptAction(attempt.id, reason);
        if (!result.success) return result.error || 'Pengerjaan belum berhasil diselesaikan.';
        void loadExamData(attempt.exam_id, true);
        return null;
    };

    const handleResetAttempt = (attempt: ExamAttemptRecord) => {
        if (!canResetParticipants || attempt.canReset !== true || attempt.exam_id !== selectedExamId) return;
        setSelectedResetAttempt(attempt);
    };
    const handleCalculateIRT = async () => {
        if (!selectedExamId) return;
        const orgId = exams.find(e => e.id === selectedExamId)?.organization_id;
        if (!orgId) return;

        const confirmed = await confirmDialog({
            title: 'Kalkulasi Skor IRT?',
            text: 'Kalkulasi Skor IRT akan menghitung ulang nilai semua peserta ujian ini berdasarkan tingkat kesulitan butir soal yang dijawab.',
            confirmText: 'Ya, Hitung Skor IRT',
            variant: 'primary',
        });
        if (!confirmed) return;

        setIsRefreshing(true);
        try {
            const res = await calculateExamIRT(selectedExamId);
            if (res.success) {
                const warnings = res.warnings?.length
                    ? `\n\nPeringatan:\n${res.warnings.map((warning) => `• ${warning}`).join('\n')}`
                    : '';
                await alertDialog({
                    title: 'Kalkulasi IRT Selesai',
                    text: `Kalkulasi selesai. ${res.count ?? 0} skor peserta telah diperbarui.${warnings}`,
                    variant: 'success',
                });
                loadExamData(selectedExamId);
            } else {
                await alertDialog({
                    title: 'Gagal Kalkulasi IRT',
                    text: res.error || 'Terjadi kesalahan sistem',
                    variant: 'danger',
                });
            }
        } catch {
            await alertDialog({
                title: 'Kesalahan Sistem',
                text: 'Terjadi kesalahan saat kalkulasi IRT',
                variant: 'danger',
            });
        }
        setIsRefreshing(false);
    };



    // Prioritaskan peserta ditutup otomatis yang dapat direset, lalu jumlah pelanggaran.
    const kelasOptions = [...new Set(
        attempts.flatMap((a) => String(a.kelas_name || '').split(',').map((s: string) => s.trim()).filter((s: string) => s && s !== '-'))
    )].sort();
    const deferredSearchName = useDeferredValue(searchName);
    const filteredAttempts = attempts
        .filter((a) => !deferredSearchName.trim() || (a.profiles?.full_name || '').toLowerCase().includes(deferredSearchName.trim().toLowerCase()))
        .filter((a) => {
            if (!filterKelas || filterKelas.length === 0) return true;
            const studentClasses = String(a.kelas_name || '').split(',').map((s: string) => s.trim());
            return filterKelas.some((k: string) => studentClasses.includes(k));
        })
        .filter((a) => {
            if (activeTab === 'live' || activeTab === 'reset' || filterStatus === 'all') return true;
            if (filterStatus === 'in_progress') return a.status === 'in_progress';
            if (filterStatus === 'submitted') return a.status === 'submitted';
            if (filterStatus === 'auto_submitted') return a.status === 'auto_submitted';
            if (filterStatus === 'belum') return a.status === 'belum';
            return true;
        })
        .sort((a, b) => Number(b.canReset === true && b.status === 'auto_submitted') - Number(a.canReset === true && a.status === 'auto_submitted')
            || (b.warning_count ?? 0) - (a.warning_count ?? 0));

    const activeAttempts = filteredAttempts.filter((a) => a.status === 'in_progress');
    const finishedAttempts = filteredAttempts.filter((a) => a.status !== 'in_progress');

    const exportResultsToExcel = async () => {
        try {
            const [freshAttempts, freshAnalysis, timeZone] = await Promise.all([
                getExamAttemptsAction(selectedExamId), getExamAnswersForAnalysisAction(selectedExamId), getSchoolTimeZone(),
            ]);
            if (!freshAttempts.length) throw new Error('Data peserta belum tersedia. Muat ulang monitoring sebelum export.');
            if (freshAttempts.some(a => a.status !== 'belum') && (freshAnalysis.questions.length || freshAttempts.some(a => (a.total_questions || 0) > 0)) && !freshAnalysis.detailed) {
                throw new Error('Analisis rinci belum tersedia. Coba kembali setelah layanan penilaian tersedia.');
            }
            await exportDetailedAnalysisToExcel({
                exam: exams.find(exam => exam.id === selectedExamId), attempts: freshAttempts,
                analysis: [], detailedAnalysis: freshAnalysis.detailed, timeZone,
                questions: freshAnalysis.questions, answers: freshAnalysis.answers,
            });
        } catch (error) {
            alert(error instanceof Error ? error.message : 'Export belum dapat dibuat.');
        }
    };

    if (isLoading) return (
        <div className="flex items-center justify-center min-h-screen">
            <Loader2 size={48} className="text-primary animate-spin" />
        </div>
    );


    // Tombol Kalkulasi IRT hanya relevan jika sistem penilaian ujian memuat
    // model IRT — kalau tidak, calculateExamIRT memang menolak ("Tidak ada
    // sistem penilaian IRT yang dipilih"), jadi tombolnya disembunyikan.
    const selectedExam = exams.find(e => e.id === selectedExamId);
    const hasIRTScoring = String(selectedExam?.scoring_type || '')
        .split(',')
        .map((t: string) => t.trim())
        .some((t: string) => t === 'irt' || t.startsWith('irt_'));

    // Paginasi tab Analisis — semua soal ditampilkan, 10 per halaman.
    const ANALYSIS_PAGE_SIZE = 10;
    const analysisTotalPages = Math.max(1, Math.ceil(analysis.length / ANALYSIS_PAGE_SIZE));
    const safeAnalysisPage = Math.min(analysisPage, analysisTotalPages);
    const pagedAnalysis = analysis.slice((safeAnalysisPage - 1) * ANALYSIS_PAGE_SIZE, safeAnalysisPage * ANALYSIS_PAGE_SIZE);

    return (
        <div className="monitoring-page pb-24 max-w-7xl mx-auto">
            <MonitoringWorkspaceHeader
                exams={exams} now={monitoringNow} value={selectedExamId}
                onExamChange={setSelectedExamId} onRefresh={handleRefresh} refreshing={isRefreshing}
                attempts={attempts} activeTab={activeTab}
                onTabChange={tab => setActiveTab(tab as typeof activeTab)}
                tabs={[
                    { id: 'live', label: 'Peserta aktif' },
                    { id: 'answers', label: 'Jawaban' },
                    { id: 'results', label: 'Hasil' },
                    { id: 'analysis', label: 'Analisis' },
                    { id: 'reset', label: 'Reset massal' },
                    ...(hasMonitoringAdministration(selectedExam) ? [{ id: 'admin', label: 'Administrasi' }] : []),
                ]}
            >
                {['live', 'results', 'reset'].includes(activeTab) && <MonitoringParticipantFilters
                    search={searchName} onSearchChange={setSearchName}
                    classOptions={kelasOptions} selectedClasses={filterKelas} onClassesChange={setFilterKelas}
                    status={activeTab === 'reset' ? resetStatus : filterStatus}
                    onStatusChange={activeTab === 'reset' ? setResetStatus : activeTab === 'results' ? setFilterStatus : undefined}
                    includeActiveStatus={false}
                    resetOnly={activeTab === 'reset'}
                    attentionOnly={onlyAttention} onAttentionChange={activeTab === 'live' ? setOnlyAttention : undefined}
                    actions={activeTab === 'results' ? <>
                        {selectedExam?.canManage === true && selectedExam.canCorrectKeys !== false && selectedExamId && <ExamKeyCorrectionButton key={selectedExamId} examId={selectedExamId} onComplete={handleRefresh} />}
                        {hasIRTScoring && <Button variant="outline" onClick={handleCalculateIRT} disabled={isRefreshing} leftIcon={<Calculator size={16} />}>Kalkulasi IRT</Button>}
                        <Button variant="outline" icon="export" onClick={exportResultsToExcel}>Export</Button>
                    </> : undefined}
                />}
            </MonitoringWorkspaceHeader>

            <PASRoomMonitoringLink exam={selectedExam} role="admin" />

            {selectedExamId && activeTab === 'reset' && <>
                {canResetParticipants ? <BulkResetPanel
                    key={selectedExamId}
                    attempts={filteredAttempts.filter(attempt => attempt.exam_id === selectedExamId && (resetStatus === 'all' || attempt.status === resetStatus))}
                    examDuration={selectedExam?.duration_minutes ?? selectedExam?.duration}
                    onRefresh={handleRefresh}
                /> : <p className="mb-4 text-sm text-slate-600 dark:text-slate-400">Reset memerlukan akses admin atau pembuat ujian.</p>}
            </>}

            {selectedExam && activeTab === 'admin' && hasMonitoringAdministration(selectedExam) && <MonitoringPASAdministrationPanel key={`pas-administration-${selectedExam.id}`} exam={selectedExam} attempts={attempts.filter(attempt => attempt.exam_id === selectedExam.id)} userRole="admin" />}

            {selectedExamId && activeTab === 'answers' && (
                <><MonitoringHealthPanel key={selectedExamId}
                    attempts={attempts.filter(attempt => attempt.exam_id === selectedExamId)}
                    onRecover={canResetParticipants ? handleResetAttempt : undefined}
                    onViewDetails={attemptId => router.push(`/dashboard/admin/monitoring/${attemptId}`)}
                    defaultExpanded
                />
                {selectedExam?.canManage === true && selectedExam.metadata?.screenshot_enabled === true && <ScreenShareExceptionsPanel key={`screen-share-exceptions-${selectedExamId}`} examId={selectedExamId} attempts={attempts.filter(attempt => attempt.exam_id === selectedExamId)} onChanged={() => void loadExamData(selectedExamId, true)} />}</>
            )}

            {selectedExamId && loadError && (
                <div role="alert" className="mb-4 flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                    <AlertTriangle size={18} className="mt-0.5 shrink-0 text-red-600" />
                    <div className="min-w-0 flex-1">
                        <p className="font-semibold">Data monitoring belum berhasil dimuat.</p>
                        <p className="mt-1 break-words">{loadError}</p>
                        {attempts.length > 0 && (
                            <p className="mt-1 text-xs text-red-700">Data yang terlihat mungkin merupakan hasil pemuatan sebelumnya.</p>
                        )}
                    </div>
                    <button
                        type="button"
                        onClick={handleRefresh}
                        disabled={isRefreshing}
                        className="shrink-0 rounded-md border border-red-300 px-3 py-1.5 text-xs font-semibold hover:bg-red-100 disabled:opacity-50"
                    >
                        Coba lagi
                    </button>
                </div>
            )}

            {/* Empty state */}
            {!selectedExamId && (
                <div className="py-16 text-center bg-white border border-[#3083FF]/30 rounded-lg">
                    <div className="w-16 h-16 bg-[#3083FF]/10 rounded-lg flex items-center justify-center mx-auto mb-4 border border-[#3083FF]/30">
                        <ShieldAlert size={32} className="text-[#3083FF]" />
                    </div>
                    <h2 className="text-lg font-bold text-slate-700 mb-2">Pilih Ujian</h2>
                    <p className="text-sm text-slate-500">Pilih ujian untuk mulai memonitoring</p>
                </div>
            )}

            {selectedExamId && activeTab === 'live' && <ActiveParticipantsPanel key={selectedExamId} attempts={activeAttempts} attentionOnly={onlyAttention} onViewDetails={id => router.push('/dashboard/admin/monitoring/' + id)} onFinish={selectedExam?.canManage === true ? handleFinishAttempt : undefined} />}


            {selectedExamId && (
                <div className="space-y-4">

                    <AnimatePresence mode="wait">
                        {/* === REKAP TAB === */}
                        {activeTab === 'results' && (
                            <motion.div
                                key="results"
                                initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
                                className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"
                            >
                                <MonitoringResultsTable attempts={finishedAttempts} hasAnyAttempts={attempts.length > 0} onViewDetails={id => router.push(`/dashboard/admin/monitoring/${id}`)} />
                            </motion.div>
                        )}

                        {/* === ANALISIS TAB === */}
                        {activeTab === 'analysis' && (
                            <motion.div
                                key="analysis"
                                initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
                                className="bg-white border border-[#3083FF]/30 rounded-lg shadow-sm overflow-hidden"
                            >
                                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3 text-xs">
                                    <span className="font-semibold text-slate-700">Diurutkan dari persentase salah tertinggi</span>
                                    {analysis.some(item => item.incorrectPercentage > 50) && <span className="rounded-full bg-amber-50 px-2.5 py-1 font-medium text-amber-800">{analysis.filter(item => item.incorrectPercentage > 50).length} perlu ditinjau</span>}
                                </div>
                                <div className="overflow-x-auto">
                                    <table className="w-full min-w-[700px]">
                                        <thead>
                                            <tr className="bg-[#3083FF]/5 text-[11px] uppercase tracking-wider text-slate-500 font-semibold">
                                                <th className="p-4 text-center font-bold text-[#3083FF] w-14">No</th>
                                                <th className="p-4 text-left font-bold text-[#3083FF]">Soal</th>
                                                <th className="p-4 text-center font-bold text-[#3083FF] w-20">Tipe</th>
                                                <th className="p-4 text-center font-bold text-[#3083FF] w-28">Kesukaran</th>
                                                <th className="p-4 text-center font-bold text-[#3083FF]">Menjawab</th>
                                                <th className="p-4 text-center font-bold text-[#3083FF]">Benar</th>
                                                <th className="p-4 text-center font-bold text-[#3083FF]">Salah</th>
                                                <th className="p-4 text-center font-bold text-[#3083FF]">Belum Ternilai</th>
                                                <th className="p-4 text-right font-bold text-[#3083FF]">% Salah</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {analysis.length === 0 ? (
                                                <tr><td colSpan={9} className="p-12 text-center text-slate-400 font-medium">Belum ada data</td></tr>
                                            ) : (
                                                pagedAnalysis.map((anl) => {
                                                    const isCritical = anl.incorrectPercentage > 50;
                                                    const diffLabel = anl.difficultyLabel?.toLowerCase() || '';
                                                    const diffColor =
                                                        diffLabel === 'mudah'
                                                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                                            : diffLabel === 'sukar'
                                                            ? 'bg-red-50 text-red-700 border-red-200'
                                                            : 'bg-amber-50 text-amber-700 border-amber-200';

                                                    return (
                                                        <tr key={anl.id} className={`border-b border-[#3083FF]/10 last:border-0 ${isCritical ? 'bg-amber-50/40' : 'hover:bg-slate-50/40'} transition-colors`}>
                                                            <td className="p-4 text-center font-bold text-[#3083FF] text-[11px]">{anl.number}</td>
                                                            <td className="p-4">
                                                                <div className="min-w-0">
                                                                    <div className="relative max-h-[3.5rem] overflow-hidden font-medium text-slate-700 [mask-image:linear-gradient(to_bottom,black_50%,transparent_100%)]">
                                                                        <LatexRenderer text={anl.qText} className="!text-[12px] !leading-relaxed" />
                                                                    </div>
                                                                    {isCritical && <span className="mt-1 inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">Mayoritas salah</span>}
                                                                    <button
                                                                        onClick={() => {
                                                                            setViewQuestion(anl);
                                                                            setModalActiveTab('soal');
                                                                        }}
                                                                        className="mt-2 block text-left text-[11px] font-semibold text-[#3083FF] transition-colors hover:text-[#2563EB]"
                                                                    >
                                                                        Detail Jawaban
                                                                    </button>
                                                                </div>
                                                            </td>
                                                            <td className="p-4 text-center">
                                                                <span className="px-2 py-0.5 bg-slate-100 border border-slate-200 rounded text-[11px] font-bold uppercase text-slate-600">
                                                                    {formatQuestionType(anl.type)}
                                                                </span>
                                                            </td>
                                                            <td className="p-4 text-center">
                                                                {anl.difficultyLabel ? (
                                                                    <span className={`px-2 py-0.5 border rounded text-[11px] font-bold uppercase ${diffColor}`}>
                                                                        {anl.difficultyLabel}
                                                                    </span>
                                                                ) : (
                                                                    <span className="text-[11px] text-slate-400">-</span>
                                                                )}
                                                            </td>
                                                            <td className="p-4 text-center font-bold text-slate-500 text-[11px]">{anl.total}</td>
                                                            <td className="p-4 text-center">
                                                                <button
                                                                    onClick={() => {
                                                                        setViewQuestion(anl);
                                                                        setModalActiveTab('benar');
                                                                    }}
                                                                    className="px-2.5 py-0.5 rounded bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-700 font-bold transition-all text-[11px]"
                                                                    title="Klik untuk melihat siswa yang menjawab benar"
                                                                >
                                                                    {anl.correct}
                                                                </button>
                                                            </td>
                                                            <td className="p-4 text-center">
                                                                <button
                                                                    onClick={() => {
                                                                        setViewQuestion(anl);
                                                                        setModalActiveTab('salah');
                                                                    }}
                                                                    className="px-2.5 py-0.5 rounded bg-red-50 hover:bg-red-100 border border-red-200 text-red-600 font-bold transition-all text-[11px]"
                                                                    title="Klik untuk melihat siswa yang menjawab salah"
                                                                >
                                                                    {anl.incorrect}
                                                                </button>
                                                            </td>
                                                            <td className="p-4 text-center"><span className="font-bold text-slate-400 text-[11px]">{anl.ungraded ?? 0}</span></td>
                                                            <td className="p-4 text-right">
                                                                <div className="flex flex-col items-end">
                                                                    <span className={`font-bold text-[11px] ${isCritical ? 'text-red-600' : 'text-[#3083FF]'}`}>{anl.incorrectPercentage.toFixed(0)}%</span>
                                                                    <div className="w-20 h-1 bg-slate-100 rounded-full mt-1 overflow-hidden">
                                                                        <div className={`h-full rounded-full ${isCritical ? 'bg-red-500' : 'bg-[#3083FF]'}`} style={{ width: `${anl.incorrectPercentage}%` }} />
                                                                    </div>
                                                                </div>
                                                            </td>
                                                        </tr>
                                                    );
                                                })
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                                {analysis.length > ANALYSIS_PAGE_SIZE && (
                                    <div className="px-5 py-3 border-t border-[#3083FF]/10 flex flex-wrap items-center justify-between gap-2 text-xs">
                                        <span className="text-slate-500 font-semibold">
                                            Menampilkan {(safeAnalysisPage - 1) * ANALYSIS_PAGE_SIZE + 1}–{Math.min(safeAnalysisPage * ANALYSIS_PAGE_SIZE, analysis.length)} dari {analysis.length} soal
                                        </span>
                                        <div className="flex items-center gap-2">
                                            <button
                                                onClick={() => setAnalysisPage(p => Math.max(1, p - 1))}
                                                disabled={safeAnalysisPage <= 1}
                                                className="px-3 py-1.5 rounded-lg border border-[#3083FF]/30 text-[#3083FF] font-semibold disabled:opacity-40 hover:bg-[#3083FF]/5 transition-all"
                                            >
                                                Sebelumnya
                                            </button>
                                            <span className="font-bold text-[#3083FF]">{safeAnalysisPage}/{analysisTotalPages}</span>
                                            <button
                                                onClick={() => setAnalysisPage(p => Math.min(analysisTotalPages, p + 1))}
                                                disabled={safeAnalysisPage >= analysisTotalPages}
                                                className="px-3 py-1.5 rounded-lg border border-[#3083FF]/30 text-[#3083FF] font-semibold disabled:opacity-40 hover:bg-[#3083FF]/5 transition-all"
                                            >
                                                Berikutnya
                                            </button>
                                        </div>
                                    </div>
                                )}
                                {analysis.length > 0 && (
                                    <div className="px-5 py-3 bg-[#3083FF]/10 border-t border-[#3083FF]/20 text-[10px] text-[#3083FF] font-semibold uppercase tracking-wider flex items-center gap-2">
                                        <AlertTriangle size={11} /> Baris merah menunjukkan soal dengan persentase kesalahan &gt; 50%
                                    </div>
                                )}
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            )}
            {/* VIEW QUESTION MODAL */}
            <AnimatePresence>
                {viewQuestion && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4"
                        onClick={() => setViewQuestion(null)}
                    >
                        <motion.div
                            initial={{ scale: 0.96, opacity: 0, y: 12 }}
                            animate={{ scale: 1, opacity: 1, y: 0 }}
                            exit={{ scale: 0.96, opacity: 0, y: 12 }}
                            className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full h-[88dvh] max-h-[88dvh] min-h-0 overflow-hidden flex flex-col border border-slate-100"
                            onClick={e => e.stopPropagation()}
                        >
                            {/* Modal Header */}
                            <div className="shrink-0 px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/80">
                                <div className="flex items-center gap-3">
                                    <h3 className="font-bold text-slate-800 text-lg">
                                        Detail Butir Soal{viewQuestion.number ? ` No. ${viewQuestion.number}` : ''}
                                    </h3>
                                    <span className="px-2.5 py-0.5 bg-blue-50 text-blue-700 border border-blue-200 rounded-full text-[11px] font-bold uppercase tracking-wider">
                                        {formatQuestionType(viewQuestion.type)}
                                    </span>
                                    {viewQuestion.difficultyLabel && (
                                        <span className={`px-2.5 py-0.5 border rounded-full text-[11px] font-bold uppercase tracking-wider ${
                                            viewQuestion.difficultyLabel === 'Sukar' ? 'bg-red-50 text-red-700 border-red-200' :
                                            viewQuestion.difficultyLabel === 'Sedang' ? 'bg-amber-50 text-amber-700 border-amber-200' :
                                            'bg-emerald-50 text-emerald-700 border-emerald-200'
                                        }`}>
                                            {viewQuestion.difficultyLabel} {viewQuestion.difficultyIndex !== undefined ? `(P: ${viewQuestion.difficultyIndex.toFixed(2)})` : ''}
                                        </span>
                                    )}
                                </div>
                                <button
                                    onClick={() => setViewQuestion(null)}
                                    className="w-8 h-8 flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 rounded-lg transition-colors"
                                >
                                    <X size={18} />
                                </button>
                            </div>

                            {/* Modal Tabs Bar */}
                            <div className="shrink-0 px-6 pt-2 border-b border-slate-200 bg-white flex items-center gap-2 overflow-x-auto">
                                <button
                                    onClick={() => setModalActiveTab('soal')}
                                    className={`px-4 py-2.5 text-xs font-bold border-b-2 transition-all flex items-center gap-1.5 whitespace-nowrap ${
                                        modalActiveTab === 'soal'
                                            ? 'border-[#3083FF] text-[#3083FF]'
                                            : 'border-transparent text-slate-500 hover:text-slate-800'
                                    }`}
                                >
                                    <Eye size={14} />
                                    Teks Soal & Kunci
                                </button>
                                <button
                                    onClick={() => setModalActiveTab('benar')}
                                    className={`px-4 py-2.5 text-xs font-bold border-b-2 transition-all flex items-center gap-1.5 whitespace-nowrap ${
                                        modalActiveTab === 'benar'
                                            ? 'border-emerald-500 text-emerald-600'
                                            : 'border-transparent text-slate-500 hover:text-slate-800'
                                    }`}
                                >
                                    <UserCheck size={14} className="text-emerald-500" />
                                    Siswa Benar
                                    <span className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] bg-emerald-100 text-emerald-700">
                                        {viewQuestion.correctStudents?.length ?? viewQuestion.correct}
                                    </span>
                                </button>
                                <button
                                    onClick={() => setModalActiveTab('salah')}
                                    className={`px-4 py-2.5 text-xs font-bold border-b-2 transition-all flex items-center gap-1.5 whitespace-nowrap ${
                                        modalActiveTab === 'salah'
                                            ? 'border-red-500 text-red-600'
                                            : 'border-transparent text-slate-500 hover:text-slate-800'
                                    }`}
                                >
                                    <UserX size={14} className="text-red-500" />
                                    Siswa Salah
                                    <span className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] bg-red-100 text-red-700">
                                        {viewQuestion.wrongStudents?.length ?? viewQuestion.incorrect}
                                    </span>
                                </button>
                                {(viewQuestion.distractorDistribution?.length ?? 0) > 0 && (
                                    <button
                                        onClick={() => setModalActiveTab('distraktor')}
                                        className={`px-4 py-2.5 text-xs font-bold border-b-2 transition-all flex items-center gap-1.5 whitespace-nowrap ${
                                            modalActiveTab === 'distraktor'
                                                ? 'border-purple-500 text-purple-600'
                                                : 'border-transparent text-slate-500 hover:text-slate-800'
                                        }`}
                                    >
                                        <PieChart size={14} className="text-purple-500" />
                                        Sebaran Pengecoh
                                    </button>
                                )}
                            </div>

                            {/* Modal Content */}
                            <div className="min-h-0 p-6 overflow-y-auto flex-1 bg-slate-50/30">
                                {modalActiveTab === 'soal' && (
                                    <div className="space-y-5">
                                        <div className="bg-white p-5 rounded-xl border border-slate-200/80 shadow-sm">
                                            <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Teks Soal</div>
                                            <LatexRenderer text={viewQuestion.qText} className="text-base text-slate-800 leading-relaxed" />
                                        </div>

                                        {(viewQuestion.options?.length ?? 0) > 0 && (
                                            <div className="bg-white p-5 rounded-xl border border-slate-200/80 shadow-sm">
                                                <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Pilihan Opsi & Kunci Jawaban</div>
                                                <div className="space-y-2">
                                                    {viewQuestion.options.map((opt, i) => (
                                                        <div
                                                            key={opt.id || i}
                                                            className={`flex items-start gap-3 p-3 rounded-lg border text-sm transition-colors ${
                                                                opt.is_correct
                                                                    ? 'bg-emerald-50/70 border-emerald-300 ring-1 ring-emerald-300'
                                                                    : 'bg-slate-50 border-slate-200/70'
                                                            }`}
                                                        >
                                                            <span className={`w-6 h-6 flex items-center justify-center rounded font-bold text-xs shrink-0 ${
                                                                opt.is_correct ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-600'
                                                            }`}>
                                                                {String.fromCharCode(65 + i)}
                                                            </span>
                                                            <div className="flex-1 min-w-0 pt-0.5">
                                                                <LatexRenderer text={opt.option_text || ''} className="!text-sm !leading-relaxed" />
                                                            </div>
                                                            {opt.is_correct && (
                                                                <span className="shrink-0 inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded">
                                                                    <CheckCircle2 size={13} /> Kunci Jawaban
                                                                </span>
                                                            )}
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        {viewQuestion.keyDisplay && (
                                            <div className="bg-blue-50/60 p-4 rounded-xl border border-blue-200 flex items-center justify-between text-xs text-blue-900">
                                                <span className="font-semibold">Kunci Jawaban Resmi:</span>
                                                <span className="font-bold bg-white px-3 py-1 rounded border border-blue-200">{viewQuestion.keyDisplay}</span>
                                            </div>
                                        )}

                                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
                                            <div className="bg-white p-3 rounded-xl border border-slate-200">
                                                <div className="text-[10px] font-bold text-slate-400 uppercase">Total Menjawab</div>
                                                <div className="text-xl font-bold text-slate-700 mt-1">{viewQuestion.total}</div>
                                            </div>
                                            <div className="bg-emerald-50 p-3 rounded-xl border border-emerald-200">
                                                <div className="text-[10px] font-bold text-emerald-600 uppercase">Jawaban Benar</div>
                                                <div className="text-xl font-bold text-emerald-700 mt-1">{viewQuestion.correct}</div>
                                            </div>
                                            <div className="bg-red-50 p-3 rounded-xl border border-red-200">
                                                <div className="text-[10px] font-bold text-red-600 uppercase">Jawaban Salah</div>
                                                <div className="text-xl font-bold text-red-700 mt-1">{viewQuestion.incorrect}</div>
                                            </div>
                                            <div className="bg-amber-50 p-3 rounded-xl border border-amber-200">
                                                <div className="text-[10px] font-bold text-amber-600 uppercase">Belum Dinilai</div>
                                                <div className="text-xl font-bold text-amber-700 mt-1">{viewQuestion.ungraded ?? 0}</div>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {modalActiveTab === 'benar' && (
                                    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                                        <div className="p-4 bg-emerald-50/50 border-b border-emerald-100 flex items-center justify-between">
                                            <div className="flex items-center gap-2">
                                                <CheckCircle2 size={16} className="text-emerald-600" />
                                                <span className="font-bold text-sm text-emerald-900">
                                                    Daftar Siswa yang Menjawab Benar ({viewQuestion.correctStudents?.length ?? 0})
                                                </span>
                                            </div>
                                            <span className="text-xs text-emerald-700 font-medium">Nilai Poin Diperoleh Penuh</span>
                                        </div>

                                        {(!viewQuestion.correctStudents || viewQuestion.correctStudents.length === 0) ? (
                                            <div className="p-8 text-center text-slate-400 text-sm">
                                                Belum ada siswa yang menjawab dengan benar untuk butir soal ini.
                                            </div>
                                        ) : (
                                            <div className="overflow-x-auto max-h-[50vh]">
                                                <table className="w-full text-left border-collapse text-xs">
                                                    <thead className="bg-slate-50 text-slate-500 font-bold border-b border-slate-200 sticky top-0">
                                                        <tr>
                                                            <th className="p-3 w-12 text-center">No</th>
                                                            <th className="p-3">Nama Siswa</th>
                                                            <th className="p-3">Kelas</th>
                                                            <th className="p-3">NISN / Identitas</th>
                                                            <th className="p-3">Jawaban Diberikan</th>
                                                            <th className="p-3 text-right">Skor</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody className="divide-y divide-slate-100">
                                                        {viewQuestion.correctStudents.map((st, i) => (
                                                            <tr key={i} className="hover:bg-emerald-50/30 transition-colors">
                                                                <td className="p-3 text-center font-bold text-slate-400">{i + 1}</td>
                                                                <td className="p-3 font-medium text-slate-800">{formatStudentName(st.student_name, 'Tanpa Nama')}</td>
                                                                <td className="p-3 text-slate-600">{st.class_name || '-'}</td>
                                                                <td className="p-3 text-slate-500 font-mono text-[11px]">{st.student_nis || '-'}</td>
                                                                <td className="p-3">
                                                                    <span className="inline-block px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 font-bold text-[11px]">
                                                                        {st.display_answer || 'Benar'}
                                                                    </span>
                                                                </td>
                                                                <td className="p-3 text-right font-bold text-emerald-600">
                                                                    +{st.score !== undefined ? st.score : 1}
                                                                </td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {modalActiveTab === 'salah' && (
                                    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                                        <div className="p-4 bg-red-50/50 border-b border-red-100 flex items-center justify-between">
                                            <div className="flex items-center gap-2">
                                                <AlertTriangle size={16} className="text-red-600" />
                                                <span className="font-bold text-sm text-red-900">
                                                    Daftar Siswa yang Menjawab Salah ({viewQuestion.wrongStudents?.length ?? 0})
                                                </span>
                                            </div>
                                            <span className="text-xs text-red-700 font-medium">Perlu Perhatian & Remedial</span>
                                        </div>

                                        {(!viewQuestion.wrongStudents || viewQuestion.wrongStudents.length === 0) ? (
                                            <div className="p-8 text-center text-emerald-600 font-medium text-sm">
                                                Luar biasa! Tidak ada siswa yang menjawab salah untuk butir soal ini.
                                            </div>
                                        ) : (
                                            <div className="overflow-x-auto max-h-[50vh]">
                                                <table className="w-full text-left border-collapse text-xs">
                                                    <thead className="bg-slate-50 text-slate-500 font-bold border-b border-slate-200 sticky top-0">
                                                        <tr>
                                                            <th className="p-3 w-12 text-center">No</th>
                                                            <th className="p-3">Nama Siswa</th>
                                                            <th className="p-3">Kelas</th>
                                                            <th className="p-3">NISN / Identitas</th>
                                                            <th className="p-3">Jawaban Siswa</th>
                                                            <th className="p-3">Kunci Jawaban</th>
                                                            <th className="p-3 text-right">Skor</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody className="divide-y divide-slate-100">
                                                        {viewQuestion.wrongStudents.map((st, i) => (
                                                            <tr key={i} className="hover:bg-red-50/30 transition-colors">
                                                                <td className="p-3 text-center font-bold text-slate-400">{i + 1}</td>
                                                                <td className="p-3 font-medium text-slate-800">{formatStudentName(st.student_name, 'Tanpa Nama')}</td>
                                                                <td className="p-3 text-slate-600">{st.class_name || '-'}</td>
                                                                <td className="p-3 text-slate-500 font-mono text-[11px]">{st.student_nis || '-'}</td>
                                                                <td className="p-3">
                                                                    <span className="inline-block px-2 py-0.5 rounded bg-red-100 text-red-800 font-bold text-[11px]">
                                                                        {st.display_answer || '(Kosong / Salah)'}
                                                                    </span>
                                                                </td>
                                                                <td className="p-3">
                                                                    <span className="inline-block px-2 py-0.5 rounded bg-emerald-50 border border-emerald-200 text-emerald-800 font-semibold text-[11px]">
                                                                        {viewQuestion.keyDisplay || '-'}
                                                                    </span>
                                                                </td>
                                                                <td className="p-3 text-right font-bold text-red-500">
                                                                    {st.score !== undefined ? st.score : 0}
                                                                </td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {modalActiveTab === 'distraktor' && (
                                    <div className="space-y-4">
                                        <div className="p-4 bg-purple-50/60 rounded-xl border border-purple-200 flex items-center justify-between text-xs text-purple-900">
                                            <span className="font-semibold">Analisis Distribusi Pemilihan Opsi (Pengecoh / Distractor):</span>
                                            <span className="text-[11px] text-purple-700">Membantu mengevaluasi efektivitas distraktor soal</span>
                                        </div>

                                        <div className="space-y-3">
                                            {(viewQuestion.distractorDistribution || []).map((dist) => (
                                                <div key={dist.option_id} className={`p-4 rounded-xl border transition-all ${
                                                    dist.is_correct ? 'bg-emerald-50/40 border-emerald-300' : 'bg-white border-slate-200'
                                                }`}>
                                                    <div className="flex items-center justify-between gap-4 mb-2">
                                                        <div className="flex items-center gap-2 min-w-0">
                                                            <span className={`w-6 h-6 flex items-center justify-center rounded font-bold text-xs shrink-0 ${
                                                                dist.is_correct ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-700'
                                                            }`}>
                                                                {dist.option_letter}
                                                            </span>
                                                            <div className="truncate text-xs text-slate-700 font-medium">
                                                                {dist.option_text ? dist.option_text.substring(0, 80) : ''}
                                                            </div>
                                                            {dist.is_correct && (
                                                                <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[10px] font-bold">
                                                                    KUNCI
                                                                </span>
                                                            )}
                                                        </div>
                                                        <div className="text-right shrink-0">
                                                            <span className="font-bold text-sm text-slate-800">{dist.count} siswa</span>
                                                            <span className="text-xs text-slate-500 ml-1.5 font-semibold">({dist.percentage.toFixed(1)}%)</span>
                                                        </div>
                                                    </div>

                                                    {/* Progress bar */}
                                                    <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden mb-3">
                                                        <div
                                                            className={`h-full rounded-full transition-all ${
                                                                dist.is_correct ? 'bg-emerald-500' : 'bg-[#3083FF]'
                                                            }`}
                                                            style={{ width: `${Math.min(100, dist.percentage)}%` }}
                                                        />
                                                    </div>

                                                    {/* Students who selected this option */}
                                                    {dist.student_names && dist.student_names.length > 0 && (
                                                        <div className="pt-2 border-t border-slate-100">
                                                            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                                                                Siswa yang Memilih:
                                                            </div>
                                                            <div className="flex flex-wrap gap-1.5">
                                                                {dist.student_names.map((nm: string, sIdx: number) => (
                                                                    <span
                                                                        key={sIdx}
                                                                        className={`text-[11px] px-2 py-0.5 rounded-md font-medium ${
                                                                            dist.is_correct
                                                                                ? 'bg-emerald-100/70 text-emerald-800'
                                                                                : 'bg-slate-100 text-slate-700'
                                                                        }`}
                                                                    >
                                                                        {formatStudentName(nm, 'Tanpa Nama')}
                                                                    </span>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Modal Footer */}
                            <div className="shrink-0 px-6 py-3.5 border-t border-slate-100 bg-slate-50 flex items-center justify-between">
                                <div className="text-xs text-slate-500">
                                    {viewQuestion.discriminationLabel && (
                                        <span>Daya Beda: <strong className="text-slate-700">{viewQuestion.discriminationLabel}</strong> ({viewQuestion.discriminationIndex?.toFixed(2) ?? '-'})</span>
                                    )}
                                </div>
                                <button
                                    onClick={() => setViewQuestion(null)}
                                    className="px-5 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-700 hover:bg-slate-100 transition-colors shadow-sm"
                                >
                                    Tutup
                                </button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            <ResetExamModal
                open={canResetParticipants && selectedResetAttempt?.canReset === true && selectedResetAttempt.exam_id === selectedExamId}
                attempt={selectedResetAttempt}
                examDuration={
                    exams.find(e => e.id === (selectedResetAttempt?.exam_id || selectedExamId))?.duration_minutes ??
                    selectedExam?.duration_minutes ??
                    selectedExam?.duration
                }
                onClose={() => setSelectedResetAttempt(null)}
                onSuccess={() => {
                    if (selectedExamId) loadExamData(selectedExamId);
                }}
            />
        </div>
    );
}

export default function MonitoringPage() {
    return (
        <Suspense fallback={<div className="flex items-center justify-center min-h-screen"><Loader2 size={48} className="text-primary animate-spin" /></div>}>
            <MonitoringContent />
        </Suspense>
    );
}
