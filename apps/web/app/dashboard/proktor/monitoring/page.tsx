"use client";

import { useMonitoringFilterState } from '@/lib/useMonitoringFilterState';
import '@/app/components/monitoring/monitoring.css';
import { ExamKeyCorrectionButton } from '@/app/components/ExamKeyCorrectionButton';
import { monitoringExamLabel, sortMonitoringExams } from '@/lib/monitoring-exams';
import { effectiveRoomFilter, matchesRoomFilter, monitoringRoomOptions } from '@/lib/monitoring-rooms';
import { hasMonitoringAdministration } from '@/lib/monitoring-tabs';
import { PASRoomMonitoringLink } from '@/app/components/monitoring/PASRoomMonitoringLink';
import { useMonitoringExamClock } from '@/lib/useMonitoringExamClock';
import { ActiveParticipantsPanel } from '@/app/components/ActiveParticipantsPanel';
import { MonitoringHealthPanel } from '@/app/components/MonitoringHealthPanel';
import { ScreenShareExceptionsPanel } from '@/app/components/monitoring/ScreenShareExceptionsPanel';
import { MonitoringPASAdministrationPanel } from '@/app/components/monitoring/MonitoringPASAdministrationPanel';
import { alertDialog, confirmDialog } from '@/lib/confirm-dialog';
import { ResetExamModal } from '@/app/components/monitoring';
import { Modal, ModalBody, ModalFooter, ModalHeader } from '@/app/components/ui/modal';
import { getQuestionSnippet } from '@/lib/question-snippet';
import { IrtRecalculationNotice } from '@/app/components/monitoring/IrtRecalculationNotice';
import { BulkResetPanel } from '@/app/components/monitoring/BulkResetPanel';
import { MonitoringWorkspaceHeader } from '@/app/components/monitoring/MonitoringWorkspaceHeader';
import { MonitoringParticipantFilters } from '@/app/components/monitoring/MonitoringParticipantFilters';
import { MonitoringResultsTable } from '@/app/components/monitoring/MonitoringResultsTable';
import { IrtParametersPanel } from '@/app/components/monitoring/IrtParametersPanel';
import type { IrtCalibration } from '@/lib/irt-calibration';
import { Button } from '@/app/components/ui/button';
import { LatexRenderer } from '@/app/components/questions/LatexRenderer';
import { calculateExamIRT } from '@/lib/api/grading';
import { finishAttemptAction,getExamAnswersForAnalysisAction,getExamAttemptsAction,getProctorOrganization,listOrganizationExams } from '@/lib/api/proctor';
import type { DetailedItemAnalysisResponse,ExamAttemptRecord,OrganizationExam } from '@/lib/api/proctor';
import type { QuestionOptionRecord } from '@/lib/api/questions';
import { getSessionUser } from '@/lib/session';
import { formatStudentName } from '@/lib/monitoring-health';
import { getSchoolTimeZone } from '@/lib/school-time';
import { exportDetailedAnalysisToExcel } from '@/lib/export-excel-analysis';
import { useMemoryState } from '@/lib/useMemoryState';
import { AnimatePresence,motion } from 'framer-motion';
import {
AlertTriangle,
Calculator,
CheckCircle2,
Loader2,
ShieldAlert,
X
} from 'lucide-react';
import { useRouter,useSearchParams } from 'next/navigation';
import { Suspense,useCallback,useDeferredValue,useEffect,useRef,useState } from 'react';

interface ItemAnalysis {
    id: string;
    number?: number;
    qText: string;
    type: string;
    options: QuestionOptionRecord[];
    total: number;
    correct: number;
    incorrect: number;
    ungraded: number;
    wrongStudents: string[];
    correctStudents: string[];
    incorrectPercentage: number;
}

function MonitoringContent() {
    const monitoringNow = useMonitoringExamClock();
    const searchParams = useSearchParams();
    const router = useRouter();
    const initialExamId = searchParams.get('exam') || '';

    const [isLoading, setIsLoading] = useMemoryState('proktor_monitoring_isLoading', true);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [exams, setExams] = useMemoryState<OrganizationExam[]>('proktor_monitoring_exams', []);
    const [selectedExamId, setSelectedExamId] = useMonitoringFilterState<string>('selectedExamId', initialExamId, initialExamId || undefined);

    const [attempts, setAttempts] = useMemoryState<ExamAttemptRecord[]>('proktor_monitoring_attempts', []);
    const [analysis, setAnalysis] = useMemoryState<ItemAnalysis[]>('proktor_monitoring_analysis', []);
    const [irtCalibration, setIrtCalibration] = useState<IrtCalibration | null>(null);
    const [, setDetailedAnalysis] = useMemoryState<DetailedItemAnalysisResponse | null>('proktor_monitoring_detailedAnalysis', null);

    const [activeTab, setActiveTab] = useMonitoringFilterState<'live' | 'results' | 'answers' | 'analysis' | 'reset' | 'administration' | 'screen'>('activeTab', 'live');
    const [loadError, setLoadError] = useState<string | null>(null);
    const [viewQuestion, setViewQuestion] = useState<ItemAnalysis | null>(null);
    const [viewQuestionFilter, setViewQuestionFilter] = useState<'salah' | 'benar'>('salah');
    const [searchName, setSearchName] = useMonitoringFilterState('searchName', '');
    const [filterKelas, setFilterKelas] = useMonitoringFilterState<string[]>('filterKelas', []);
    const [filterRoom, setFilterRoom] = useMonitoringFilterState<string>('filterRoom', '');
    const [filterStatus, setFilterStatus] = useMonitoringFilterState('filterStatus', 'all');
    const [resetStatus, setResetStatus] = useMonitoringFilterState('resetStatus', 'all');
    const [onlyAttention, setOnlyAttention] = useMonitoringFilterState('onlyAttention', false);
    const [analysisPage, setAnalysisPage] = useState(1);
    const examRequestGenerationRef = useRef(0);


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
                if (!initialExamId && examList.length > 0) setSelectedExamId(current => examList.some(exam => exam.id === current) ? current : examList[0].id);
            }
        }
        setIsLoading(false);
    }, [initialExamId, setExams, setIsLoading, setSelectedExamId]);

    const loadingExamIdsRef = useRef(new Map<string, number>());
    const lastRequestedExamIdRef = useRef('');
    const loadExamData = useCallback(async (examId: string, silent = false) => {
        if (silent && loadingExamIdsRef.current.has(examId)) return;
        const generation = ++examRequestGenerationRef.current;
        loadingExamIdsRef.current.set(examId, generation);
        if (lastRequestedExamIdRef.current !== examId) {
            lastRequestedExamIdRef.current = examId;
            setAttempts([]); setAnalysis([]); setLoadError(null);
        }
        if (!silent) setIsRefreshing(true);
        try {
            const [attData, analysisData] = await Promise.all([
                getExamAttemptsAction(examId).then(rows => {
                    if (generation !== examRequestGenerationRef.current) return rows;
                    setAttempts(rows);
                    setLoadError(null);
                    return rows;
                }),
                activeTab === 'analysis' ? getExamAnswersForAnalysisAction(examId) : Promise.resolve({ questions: [], answers: [], detailed: null, irt: null })
            ]);
            // Nama siswa per attempt utk rincian "siapa yang salah" di Analisis
            const studentByAttempt = new Map<string, string>();
            attData.forEach((att) => studentByAttempt.set(att.id, formatStudentName(att.profiles?.full_name, 'Tanpa Nama')));

            const { questions: bankQuestions, answers: ansRows } = analysisData;
            const itemStats: Record<string, { total: number; correct: number; incorrect: number; ungraded: number; wrongStudents: string[]; correctStudents: string[] }> = {};
            ansRows.forEach((ans) => {
                const qId = ans.question_id;
                if (!itemStats[qId]) itemStats[qId] = { total: 0, correct: 0, incorrect: 0, ungraded: 0, wrongStudents: [], correctStudents: [] };
                itemStats[qId].total += 1;
                // is_correct null = belum ternilai (esai / menunggu penilaian
                // manual) — masuk hitungan "Menjawab" tapi bukan "Salah".
                if (ans.is_correct === true) {
                    itemStats[qId].correct += 1;
                    const nm = studentByAttempt.get(ans.attempt_id ?? '');
                    if (nm) itemStats[qId].correctStudents.push(nm);
                } else if (ans.is_correct === false) {
                    itemStats[qId].incorrect += 1;
                    const nm = studentByAttempt.get(ans.attempt_id ?? '');
                    if (nm) itemStats[qId].wrongStudents.push(nm);
                } else {
                    itemStats[qId].ungraded += 1;
                }
            });

            // SEMUA soal bank ditampilkan (termasuk yang belum dijawab), dengan
            // nomor sesuai urutan bank soal; tetap diurutkan % salah terbesar.
            const analysisArray = bankQuestions.map((q) => {
                const stat = itemStats[q.id] || { total: 0, correct: 0, incorrect: 0, ungraded: 0, wrongStudents: [], correctStudents: [] };
                const graded = stat.correct + stat.incorrect;
                return {
                    id: q.id, number: q.number ?? 0, qText: q.question_text, type: q.type, options: q.options || [],
                    total: stat.total, correct: stat.correct, incorrect: stat.incorrect,
                    ungraded: stat.ungraded,
                    wrongStudents: [...stat.wrongStudents].sort((a, b) => a.localeCompare(b)),
                    correctStudents: [...stat.correctStudents].sort((a, b) => a.localeCompare(b)),
                    incorrectPercentage: graded > 0 ? (stat.incorrect / graded) * 100 : 0
                };
            }).sort((a, b) => (b.incorrectPercentage - a.incorrectPercentage) || (a.number - b.number));
            if (generation !== examRequestGenerationRef.current) return;
            setAttempts(attData);
            setDetailedAnalysis(analysisData.detailed || null);
            if (activeTab === 'analysis') setIrtCalibration(analysisData.irt ?? null);
            setAnalysis(analysisArray);
        } catch (error) {
            console.error('[Monitoring] Load error:', error);
            if (generation === examRequestGenerationRef.current) setLoadError(error instanceof Error ? error.message : 'Data monitoring belum dapat dimuat.');
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
            examRequestGenerationRef.current += 1;
            setAnalysisPage(1);
            if (selectedExamId) void loadExamData(selectedExamId);
            else { setAttempts([]); setAnalysis([]); }
        }, 0);
        return () => window.clearTimeout(timer);
    }, [loadExamData, selectedExamId, setAnalysis, setAttempts]);

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

    // Tab "Pengecualian layar" hanya ada untuk ujian yang mewajibkan berbagi
    // layar dan bisa dikelola pengguna ini. Bila ujian berganti ke yang tidak
    // memenuhi syarat, kembalikan ke tab Peserta aktif.
    const screenShareExam = exams.find(exam => exam.id === selectedExamId);
    const canManageScreenShare = screenShareExam?.canManage === true && screenShareExam.metadata?.screenshot_enabled === true;
    useEffect(() => {
        if (activeTab === 'screen' && screenShareExam && !canManageScreenShare) setActiveTab('live');
    }, [activeTab, screenShareExam, canManageScreenShare, setActiveTab]);

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



    // Filter kelas + pencarian nama, lalu urutkan pelanggaran terbanyak dulu —
    // peserta bermasalah (terminated) yang perlu di-reset naik ke atas.
    const kelasOptions = [...new Set(
        attempts.flatMap((a) => String(a.kelas_name || '').split(',').map((s: string) => s.trim()).filter((s: string) => s && s !== '-'))
    )].sort();
    const deferredSearchName = useDeferredValue(searchName);
    // Ujian folder ASAS/AM: peserta dapat disaring per ruang tempat duduknya.
    const roomOptions = monitoringRoomOptions(attempts.filter(a => a.exam_id === selectedExamId));
    const roomFilter = effectiveRoomFilter(filterRoom, roomOptions);
    const filteredAttempts = attempts
        .filter((a) => matchesRoomFilter(a, roomFilter))
        .filter((a) => !deferredSearchName.trim() || (a.profiles?.full_name || '').toLowerCase().includes(deferredSearchName.trim().toLowerCase()))
        .filter((a) => filterKelas.length === 0 || String(a.kelas_name || '').split(',').map((s: string) => s.trim()).some(kelas => filterKelas.includes(kelas)))
        .sort((a, b) => Number(b.canReset === true && b.status === 'auto_submitted') - Number(a.canReset === true && a.status === 'auto_submitted') || (b.warning_count ?? 0) - (a.warning_count ?? 0));

    // Pembagian tegas: tab "Aktif" = yang SEDANG mengerjakan (live), tab
    // "Rekap" = yang sudah selesai/terminated (info pelanggaran ada di sana).
    const activeAttempts = filteredAttempts.filter((a) => a.status === 'in_progress');
    const finishedAttempts = filteredAttempts.filter((a) => a.status !== 'in_progress' && (filterStatus === 'all' || a.status === filterStatus));

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
                questions: freshAnalysis.questions, answers: freshAnalysis.answers, irt: freshAnalysis.irt ?? null,
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
                exams={exams}
                now={monitoringNow}
                value={selectedExamId}
                onExamChange={id => {
                    setSelectedExamId(id);
                    if (activeTab === 'administration' && !hasMonitoringAdministration(exams.find(exam => exam.id === id))) setActiveTab('live');
                }}
                onRefresh={handleRefresh}
                refreshing={isRefreshing}
                attempts={attempts}
                activeTab={activeTab}
                onTabChange={value => setActiveTab(value as typeof activeTab)}
                tabs={[
                    { id: 'live', label: 'Peserta aktif' },
                    { id: 'answers', label: 'Jawaban' },
                    { id: 'results', label: 'Hasil' },
                    { id: 'analysis', label: 'Analisis' },
                    { id: 'reset', label: 'Reset massal' },
                    ...(hasMonitoringAdministration(selectedExam) ? [{ id: 'administration', label: 'Administrasi' }] : []),
                    ...(canManageScreenShare ? [{ id: 'screen', label: 'Pengecualian layar' }] : []),
                ]}
            >
                {selectedExamId && (activeTab === 'live' || activeTab === 'results' || activeTab === 'reset') && (
                    <MonitoringParticipantFilters
                        search={searchName}
                        onSearchChange={setSearchName}
                        classOptions={kelasOptions}
                        selectedClasses={filterKelas}
                        roomOptions={roomOptions}
                        selectedRoom={roomFilter}
                        onRoomChange={setFilterRoom}
                        onClassesChange={setFilterKelas}
                        status={activeTab === 'reset' ? resetStatus : activeTab === 'results' ? filterStatus : undefined}
                        includeActiveStatus={false}
                        resetOnly={activeTab === 'reset'}
                        onStatusChange={activeTab === 'reset' ? setResetStatus : activeTab === 'results' ? setFilterStatus : undefined}
                        attentionOnly={activeTab === 'live' ? onlyAttention : undefined}
                        onAttentionChange={activeTab === 'live' ? setOnlyAttention : undefined}
                        actions={activeTab === 'results' ? <>
                            {selectedExam?.canManage === true && selectedExam.canCorrectKeys !== false && <ExamKeyCorrectionButton key={selectedExamId} examId={selectedExamId} onComplete={handleRefresh} />}
                            {hasIRTScoring && (
                                <Button variant="outline" onClick={handleCalculateIRT} disabled={isRefreshing} leftIcon={<Calculator size={14} />}>
                                    Kalkulasi IRT
                                </Button>
                            )}
                            <Button variant="outline" icon="export" onClick={exportResultsToExcel}>Export</Button>
                        </> : undefined}
                    />
                )}
            </MonitoringWorkspaceHeader>

            {selectedExamId && hasIRTScoring && (
                <IrtRecalculationNotice
                    attempts={attempts.filter(attempt => attempt.exam_id === selectedExamId)}
                    scoringType={selectedExam?.scoring_type}
                    canCalculate={selectedExam?.canManage === true}
                />
            )}

            <PASRoomMonitoringLink exam={selectedExam} role="proktor" />

            {selectedExamId && loadError && (
                <div role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                    <p className="font-semibold">Peserta monitoring gagal dimuat</p>
                    <p className="mt-1">{loadError}</p>
                    <button type="button" onClick={handleRefresh} className="mt-2 font-semibold underline">Coba lagi</button>
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

            {selectedExamId && (
                <div className="space-y-4">

                    {activeTab === 'analysis' && <IrtParametersPanel key={`irt-${selectedExamId}`} calibration={irtCalibration} scoringType={selectedExam?.scoring_type} exportTitle={selectedExam ? monitoringExamLabel(selectedExam) : undefined} />}
                    <AnimatePresence mode="wait">
                        {activeTab === 'live' && <ActiveParticipantsPanel key={selectedExamId} attempts={activeAttempts} attentionOnly={onlyAttention} onViewDetails={id => router.push('/dashboard/proktor/monitoring/' + id)} onFinish={selectedExam?.canManage === true ? handleFinishAttempt : undefined} />}

                        {activeTab === 'answers' && (
                            <motion.div key="answers" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-4">
                                <MonitoringHealthPanel key={selectedExamId} attempts={attempts.filter(attempt => attempt.exam_id === selectedExamId)} onRecover={canResetParticipants ? handleResetAttempt : undefined} onViewDetails={id => router.push(`/dashboard/proktor/monitoring/${id}`)} defaultExpanded />
                            </motion.div>
                        )}

                        {activeTab === 'screen' && canManageScreenShare && (
                            <motion.div key="screen" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-4">
                                <ScreenShareExceptionsPanel key={`screen-share-exceptions-${selectedExamId}`} examId={selectedExamId} attempts={attempts.filter(attempt => attempt.exam_id === selectedExamId)} onChanged={() => void loadExamData(selectedExamId, true)} />
                            </motion.div>
                        )}

                        {activeTab === 'reset' && (
                            <motion.div key="reset" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                                {canResetParticipants && (
                                    <BulkResetPanel key={selectedExamId}
                                        attempts={filteredAttempts.filter(attempt => attempt.exam_id === selectedExamId && (resetStatus === 'all' || attempt.status === resetStatus))}
                                        examDuration={selectedExam?.duration_minutes ?? selectedExam?.duration}
                                        onRefresh={handleRefresh}
                                    />
                                )}
                                {!canResetParticipants && (
                                    <div className="rounded-xl border border-slate-200 bg-white px-6 py-10 text-center text-sm text-slate-500">Mode lihat saja. Reset peserta hanya tersedia untuk pembuat ujian.</div>
                                )}
                            </motion.div>
                        )}

                        {activeTab === 'administration' && hasMonitoringAdministration(selectedExam) && selectedExam && (
                            <motion.div key="administration" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                                <MonitoringPASAdministrationPanel key={`pas-administration-${selectedExam.id}`} exam={selectedExam} attempts={attempts.filter(attempt => attempt.exam_id === selectedExam.id)} userRole="proktor" />
                            </motion.div>
                        )}

                        {/* === REKAP TAB === */}
                        {activeTab === 'results' && (
                            <motion.div
                                key="results"
                                initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
                                className="bg-white border border-[#3083FF]/30 rounded-lg shadow-sm overflow-hidden"
                            >
                                <MonitoringResultsTable attempts={finishedAttempts} hasAnyAttempts={attempts.length > 0} onViewDetails={id => router.push(`/dashboard/proktor/monitoring/${id}`)} onRecover={canResetParticipants ? handleResetAttempt : undefined} showRoomInfo={roomOptions.length > 0} />
                            </motion.div>
                        )}

                        {/* === ANALISIS TAB === */}
                        {activeTab === 'analysis' && (
                            <motion.div
                                key="analysis"
                                initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
                                className="bg-white border border-[#3083FF]/30 rounded-lg shadow-sm overflow-hidden"
                            >
                                <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3 text-xs">
                                    <span className="font-semibold text-slate-700 truncate">Urut % salah tertinggi</span>
                                    {analysis.some(item => item.incorrectPercentage > 50) && (
                                        <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-bold text-amber-800 shrink-0">
                                            {analysis.filter(item => item.incorrectPercentage > 50).length} perlu ditinjau
                                        </span>
                                    )}
                                </div>
                                {/* mobile analysis cards - ringkas, tinggi terkontrol */}
                                <div className="sm:hidden divide-y divide-slate-100">
                                    {analysis.length === 0 ? (
                                        <div className="p-8 text-center text-slate-400 font-medium text-xs">Belum ada data</div>
                                    ) : (
                                        pagedAnalysis.map((anl) => {
                                            const isCritical = anl.incorrectPercentage > 50;

                                            return (
                                                <button
                                                    key={anl.id}
                                                    type="button"
                                                    onClick={() => {
                                                        setViewQuestion(anl);
                                                        setViewQuestionFilter('salah');
                                                    }}
                                                    className={`w-full p-3 flex items-start gap-3 text-left transition-colors active:bg-slate-100 ${
                                                        isCritical ? 'bg-amber-50/25 hover:bg-amber-50/40' : 'bg-white hover:bg-slate-50'
                                                    }`}
                                                >
                                                    <div className="w-[72px] shrink-0 text-left">
                                                        <div className="text-xs font-bold text-slate-800">
                                                            #{anl.number}
                                                        </div>
                                                        <div className={`mt-0.5 text-[11px] font-semibold tabular-nums ${
                                                            isCritical ? 'text-rose-600' : 'text-emerald-600'
                                                        }`}>
                                                            {anl.incorrectPercentage.toFixed(0)}% salah
                                                        </div>
                                                    </div>
                                                    <div className="min-w-0 flex-1 text-left">
                                                        <LatexRenderer
                                                            text={getQuestionSnippet(anl.qText, 95)}
                                                            className="!font-sans !text-xs !leading-relaxed !text-left text-slate-700 line-clamp-2 [&_.katex]:!text-[11px]"
                                                        />
                                                    </div>
                                                </button>
                                            );
                                        })
                                    )}
                                </div>
                                <div className="hidden sm:block overflow-x-auto">
                                    <table className="w-full min-w-[600px]">
                                        <thead>
                                            <tr className="bg-[#3083FF]/5 text-[11px] uppercase tracking-wider text-slate-500 font-semibold">
                                                <th className="p-4 text-center font-bold text-[#3083FF] w-14">No</th>
                                                <th className="p-4 text-left font-bold text-[#3083FF]">Soal</th>
                                                <th className="p-4 text-center font-bold text-[#3083FF]">Menjawab</th>
                                                <th className="p-4 text-center font-bold text-[#3083FF]">Benar</th>
                                                <th className="p-4 text-center font-bold text-[#3083FF]">Salah</th>
                                                <th className="p-4 text-center font-bold text-[#3083FF]">Belum Ternilai</th>
                                                <th className="p-4 text-right font-bold text-[#3083FF]">% Salah</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {analysis.length === 0 ? (
                                                <tr><td colSpan={7} className="p-12 text-center text-slate-400 font-medium">Belum ada data</td></tr>
                                            ) : (
                                                pagedAnalysis.map((anl) => {
                                                    const isCritical = anl.incorrectPercentage > 50;
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
                                                                        onClick={() => { setViewQuestion(anl); setViewQuestionFilter('salah'); }}
                                                                        className="mt-2 block text-left text-[11px] font-semibold text-[#3083FF] transition-colors hover:text-[#2563EB]"
                                                                    >
                                                                        Detail Jawaban
                                                                    </button>
                                                                </div>
                                                            </td>
                                                            <td className="p-4 text-center font-bold text-slate-500 text-[11px]">{anl.total}</td>
                                                            <td className="p-4 text-center"><span className="font-bold text-emerald-600 text-[11px]">{anl.correct}</span></td>
                                                            <td className="p-4 text-center"><span className="font-bold text-red-500 text-[11px]">{anl.incorrect}</span></td>
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
                                    <div className="px-3.5 sm:px-5 py-2.5 border-t border-slate-100 flex items-center justify-between gap-2 text-[11px] sm:text-xs">
                                        <span className="text-slate-500 font-medium tabular-nums">
                                            {(safeAnalysisPage - 1) * ANALYSIS_PAGE_SIZE + 1}–{Math.min(safeAnalysisPage * ANALYSIS_PAGE_SIZE, analysis.length)} dari {analysis.length} soal
                                        </span>
                                        <div className="flex items-center gap-1.5 shrink-0">
                                            <button
                                                type="button"
                                                onClick={() => setAnalysisPage(p => Math.max(1, p - 1))}
                                                disabled={safeAnalysisPage <= 1}
                                                className="px-2.5 py-1 rounded-md border border-slate-200 bg-white text-slate-600 font-semibold disabled:opacity-40 hover:bg-slate-50 transition-all"
                                            >
                                                Sebelumnya
                                            </button>
                                            <span className="px-1 font-semibold tabular-nums text-slate-600">{safeAnalysisPage} / {analysisTotalPages}</span>
                                            <button
                                                type="button"
                                                onClick={() => setAnalysisPage(p => Math.min(analysisTotalPages, p + 1))}
                                                disabled={safeAnalysisPage >= analysisTotalPages}
                                                className="px-2.5 py-1 rounded-md border border-slate-200 bg-white text-slate-600 font-semibold disabled:opacity-40 hover:bg-slate-50 transition-all"
                                            >
                                                Berikutnya
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            )}
            {/* VIEW QUESTION MODAL */}
            <Modal
                open={Boolean(viewQuestion)}
                onClose={() => setViewQuestion(null)}
                size="lg"
                variant="default"
                labelledBy="proktor-modal-view-question-title"
            >
                {viewQuestion && (
                    <>
                        <ModalHeader
                            id="proktor-modal-view-question-title"
                            onClose={() => setViewQuestion(null)}
                            title={`Detail Soal${viewQuestion.number ? ` No. ${viewQuestion.number}` : ''}`}
                        />
                        <ModalBody className="p-5 sm:p-6 space-y-4 max-h-[75vh] overflow-y-auto">
                            <LatexRenderer text={viewQuestion.qText} className="text-base text-slate-700 leading-relaxed" />

                            {/* Opsi jawaban terurut; kunci ditandai hijau */}
                            {(viewQuestion.options?.length ?? 0) > 0 && (
                                <div className="mt-4 space-y-1.5">
                                    {viewQuestion.options.map((opt, i) => (
                                        <div key={opt.id || i} className={`flex items-start gap-2 px-3 py-2 rounded-lg border text-sm ${
                                            opt.is_correct ? 'bg-emerald-50 border-emerald-200' : 'bg-slate-50 border-slate-100'
                                        }`}>
                                            <span className={`font-bold shrink-0 ${opt.is_correct ? 'text-emerald-600' : 'text-slate-400'}`}>
                                                {String.fromCharCode(65 + i)}.
                                            </span>
                                            <div className="flex-1 min-w-0">
                                                <LatexRenderer text={opt.option_text || ''} className="!text-[13px] !leading-relaxed" />
                                            </div>
                                            {opt.is_correct && <CheckCircle2 size={15} className="text-emerald-500 shrink-0 mt-0.5" />}
                                        </div>
                                    ))}
                                </div>
                            )}

                            <div className="mt-5 flex flex-wrap gap-2 text-xs font-semibold">
                                <span className="px-2.5 py-1 bg-blue-50 text-blue-700 rounded-lg border border-blue-200 uppercase">{viewQuestion.type || 'PG'}</span>
                                <span className={`px-2.5 py-1 rounded-lg border ${viewQuestion.incorrectPercentage > 50 ? 'bg-rose-50 text-rose-700 border-rose-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200'}`}>{viewQuestion.incorrectPercentage.toFixed(0)}% salah</span>
                                <span className="px-2.5 py-1 bg-slate-100 text-slate-600 rounded-lg border border-slate-200">Menjawab {viewQuestion.total}</span>
                                <button onClick={() => setViewQuestionFilter('benar')} className={`px-2.5 py-1 rounded-lg border transition-colors ${viewQuestionFilter === 'benar' ? 'bg-emerald-100 text-emerald-800 border-emerald-300 ring-2 ring-emerald-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'}`}>Benar {viewQuestion.correct}</button>
                                <button onClick={() => setViewQuestionFilter('salah')} className={`px-2.5 py-1 rounded-lg border transition-colors ${viewQuestionFilter === 'salah' ? 'bg-red-100 text-red-800 border-red-300 ring-2 ring-red-200' : 'bg-red-50 text-red-700 border-red-200 hover:bg-red-100'}`}>Salah {viewQuestion.incorrect}</button>
                                {(viewQuestion.ungraded ?? 0) > 0 && (
                                    <span className="px-2.5 py-1 bg-amber-50 text-amber-700 rounded-lg border border-amber-200">Belum Ternilai {viewQuestion.ungraded}</span>
                                )}
                            </div>
                            {viewQuestionFilter === 'salah' && (viewQuestion.wrongStudents?.length ?? 0) > 0 && (
                                <div className="mt-5">
                                    <h4 className="text-xs font-bold uppercase tracking-wider text-red-600 mb-2 flex items-center gap-1.5">
                                        <AlertTriangle size={12} /> Siswa yang Menjawab Salah ({viewQuestion.wrongStudents.length})
                                    </h4>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-0.5">
                                        {viewQuestion.wrongStudents.map((nm: string, i: number) => (
                                            <div key={i} className="flex items-baseline gap-2 text-xs text-slate-700 py-1.5 border-b border-slate-100">
                                                <span className="w-6 shrink-0 text-right font-bold text-slate-400">{i + 1}.</span>
                                                <span className="font-medium">{nm}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                            {viewQuestionFilter === 'benar' && (viewQuestion.correctStudents?.length ?? 0) > 0 && (
                                <div className="mt-5">
                                    <h4 className="text-xs font-bold uppercase tracking-wider text-emerald-600 mb-2 flex items-center gap-1.5">
                                        <CheckCircle2 size={12} /> Siswa yang Menjawab Benar ({viewQuestion.correctStudents.length})
                                    </h4>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-0.5">
                                        {viewQuestion.correctStudents.map((nm: string, i: number) => (
                                            <div key={i} className="flex items-baseline gap-2 text-xs text-slate-700 py-1.5 border-b border-slate-100">
                                                <span className="w-6 shrink-0 text-right font-bold text-slate-400">{i + 1}.</span>
                                                <span className="font-medium">{nm}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </ModalBody>
                        <ModalFooter align="end">
                            <Button
                                type="button"
                                variant="cancel"
                                onClick={() => setViewQuestion(null)}
                            >
                                Tutup
                            </Button>
                        </ModalFooter>
                    </>
                )}
            </Modal>

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
