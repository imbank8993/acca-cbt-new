"use client";

import { useMonitoringFilterState } from '@/lib/useMonitoringFilterState';
import '@/app/components/monitoring/monitoring.css';
import { ExamKeyCorrectionButton } from '@/app/components/ExamKeyCorrectionButton';
import { monitoringExamLabel, sortMonitoringExams } from '@/lib/monitoring-exams';
import { effectiveRoomFilter, matchesRoomFilter, monitoringRoomOptions } from '@/lib/monitoring-rooms';
import { useMonitoringExamClock } from '@/lib/useMonitoringExamClock';
import { ActiveParticipantsPanel } from '@/app/components/ActiveParticipantsPanel';
import { MonitoringHealthPanel } from '@/app/components/MonitoringHealthPanel';
import { ScreenShareExceptionsPanel } from '@/app/components/monitoring/ScreenShareExceptionsPanel';
import { MonitoringPASAdministrationPanel } from '@/app/components/monitoring/MonitoringPASAdministrationPanel';
import { alertDialog, confirmDialog } from '@/lib/confirm-dialog';
import { ResetExamModal } from '@/app/components/monitoring';
import { IrtRecalculationNotice } from '@/app/components/monitoring/IrtRecalculationNotice';
import { BulkResetPanel } from '@/app/components/monitoring/BulkResetPanel';
import { MonitoringWorkspaceHeader } from '@/app/components/monitoring/MonitoringWorkspaceHeader';
import { FolderExamMonitor } from '@/app/components/monitoring/FolderExamMonitor';
import { groupFolderExams, isFolderGroupId, resolveMonitoringSelection } from '@/lib/monitoring-folder';
import { MonitoringParticipantFilters } from '@/app/components/monitoring/MonitoringParticipantFilters';
import { MonitoringResultsTable } from '@/app/components/monitoring/MonitoringResultsTable';
import { IrtParametersPanel } from '@/app/components/monitoring/IrtParametersPanel';
import type { IrtCalibration } from '@/lib/irt-calibration';
import { ItemAnalysisPanel } from '@/app/components/monitoring/ItemAnalysisPanel';
import { buildItemAnalysis } from '@/lib/item-analysis';
import { hasMonitoringAdministration } from '@/lib/monitoring-tabs';
import { Button } from '@/app/components/ui/button';
import { calculateExamIRT } from '@/lib/api/grading';
import { finishAttemptAction,getExamAnswersForAnalysisAction,getExamAttemptsAction,getExamAttemptsResult,getProctorOrganization,listOrganizationExams } from '@/lib/api/proctor';
import type {
    ExamAttemptRecord,
    OrganizationExam,

    DetailedItemAnalysisResponse,
    ItemAnalysis,
} from '@/lib/api/proctor';
import { getSessionUser } from '@/lib/session';
import { useMemoryState } from '@/lib/useMemoryState';
import { getSchoolTimeZone } from '@/lib/school-time';
import { exportDetailedAnalysisToExcel } from '@/lib/export-excel-analysis';
import { AnimatePresence,motion } from 'framer-motion';
import {
AlertTriangle,
Calculator,
Loader2,
ShieldAlert,
} from 'lucide-react';
import { useRouter,useSearchParams } from 'next/navigation';
import { Suspense,useCallback,useDeferredValue,useEffect,useMemo,useRef,useState } from 'react';

export type { ItemAnalysis };

function MonitoringContent() {
    const monitoringNow = useMonitoringExamClock();
    const searchParams = useSearchParams();
    const router = useRouter();
    const initialExamId = searchParams.get('exam') || '';

    const [isLoading, setIsLoading] = useMemoryState('proktor_monitoring_isLoading', true);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [exams, setExams] = useMemoryState<OrganizationExam[]>('proktor_monitoring_exams', []);
    const [rawSelectedExamId, setSelectedExamId] = useMonitoringFilterState<string>('selectedExamId', initialExamId, initialExamId || undefined);
    // Ujian folder ASAS/AM tampil satu entri per bank soal (lihat FolderExamMonitor).
    const groupedExams = useMemo(() => groupFolderExams(exams), [exams]);
    const pickedExamId = exams.length ? resolveMonitoringSelection(rawSelectedExamId, groupedExams) : rawSelectedExamId;
    const folderGroup = groupedExams.groups.get(pickedExamId) ?? null;
    const [folderRefresh, setFolderRefresh] = useState(0);
    // Data monitoring ujian biasa hanya dimuat bila yang dipilih bukan ujian folder.
    const selectedExamId = folderGroup ? '' : pickedExamId;

    const [attempts, setAttempts] = useMemoryState<ExamAttemptRecord[]>('proktor_monitoring_attempts', []);
    const [analysis, setAnalysis] = useMemoryState<ItemAnalysis[]>('proktor_monitoring_analysis', []);
    const [irtCalibration, setIrtCalibration] = useState<IrtCalibration | null>(null);
    const [, setDetailedAnalysis] = useMemoryState<DetailedItemAnalysisResponse | null>('admin_monitoring_detailedAnalysis', null);

    const [activeTab, setActiveTab] = useMonitoringFilterState<'live' | 'answers' | 'results' | 'analysis' | 'reset' | 'admin' | 'screen'>('activeTab', 'live');
    const [searchName, setSearchName] = useMonitoringFilterState('searchName', '');
    const [filterKelas, setFilterKelas] = useMonitoringFilterState<string[]>('filterKelas', []);
    const [filterRoom, setFilterRoom] = useMonitoringFilterState<string>('filterRoom', '');
    const [filterStatus, setFilterStatus] = useMonitoringFilterState<string>('filterStatus', 'all');
    const [resetStatus, setResetStatus] = useMonitoringFilterState('resetStatus', 'all');
    const [onlyAttention, setOnlyAttention] = useMonitoringFilterState('onlyAttention', false);
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
                if (!initialExamId && examList.length > 0) setSelectedExamId(current => (examList.some(exam => exam.id === current) || isFolderGroupId(current)) ? current : (groupFolderExams(examList).list[0]?.id ?? examList[0].id));
            }
        }
        setIsLoading(false);
    }, [initialExamId, setExams, setIsLoading, setSelectedExamId]);

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
                activeTab === 'analysis' ? getExamAnswersForAnalysisAction(examId) : Promise.resolve({ questions: [], answers: [], detailed: null, irt: null })
            ]);
            if (generation !== examRequestGenerationRef.current) return;
            if (!attemptsResult.success) {
                setLoadError(attemptsResult.error);
                return;
            }
            const attData = attemptsResult.attempts;
            setAttempts(attData);
            setDetailedAnalysis(analysisData.detailed || null);
            if (activeTab === 'analysis') setIrtCalibration(analysisData.irt ?? null);

            setAnalysis(buildItemAnalysis(analysisData, attData));
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



    // Prioritaskan peserta ditutup otomatis yang dapat direset, lalu jumlah pelanggaran.
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


    return (
        <div className="monitoring-page pb-24 max-w-7xl mx-auto">
            <MonitoringWorkspaceHeader
                exams={groupedExams.list} now={monitoringNow} value={pickedExamId}
                onExamChange={setSelectedExamId} onRefresh={folderGroup ? () => setFolderRefresh(count => count + 1) : handleRefresh} refreshing={isRefreshing}
                attempts={attempts} activeTab={activeTab}
                onTabChange={tab => setActiveTab(tab as typeof activeTab)}
                hideDetails={Boolean(folderGroup)}
                tabs={[
                    { id: 'live', label: 'Peserta aktif' },
                    { id: 'answers', label: 'Jawaban' },
                    { id: 'results', label: 'Hasil' },
                    { id: 'analysis', label: 'Analisis' },
                    { id: 'reset', label: 'Reset massal' },
                    ...(hasMonitoringAdministration(selectedExam) ? [{ id: 'admin', label: 'Administrasi' }] : []),
                    ...(canManageScreenShare ? [{ id: 'screen', label: 'Pengecualian layar' }] : []),
                ]}
            >
                {folderGroup ? <FolderExamMonitor key={folderGroup.id} group={folderGroup} userRole="admin"
                    attemptBasePath="/dashboard/admin/monitoring" refreshToken={folderRefresh} /> : <>
                {['live', 'results', 'reset'].includes(activeTab) && <MonitoringParticipantFilters
                    search={searchName} onSearchChange={setSearchName}
                    classOptions={kelasOptions} selectedClasses={filterKelas} onClassesChange={setFilterKelas}
                    roomOptions={roomOptions} selectedRoom={roomFilter} onRoomChange={setFilterRoom}
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
                </>}
            </MonitoringWorkspaceHeader>

            {selectedExamId && hasIRTScoring && (
                <IrtRecalculationNotice
                    attempts={attempts.filter(attempt => attempt.exam_id === selectedExamId)}
                    scoringType={selectedExam?.scoring_type}
                    canCalculate={selectedExam?.canManage === true}
                />
            )}

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
                /></>
            )}

            {selectedExamId && activeTab === 'screen' && canManageScreenShare && (
                <ScreenShareExceptionsPanel key={`screen-share-exceptions-${selectedExamId}`} examId={selectedExamId} attempts={attempts.filter(attempt => attempt.exam_id === selectedExamId)} onChanged={() => void loadExamData(selectedExamId, true)} />
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
            {!pickedExamId && (
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

                    {activeTab === 'analysis' && <IrtParametersPanel key={`irt-${selectedExamId}`} calibration={irtCalibration} scoringType={selectedExam?.scoring_type} exportTitle={selectedExam ? monitoringExamLabel(selectedExam) : undefined} />}
                    <AnimatePresence mode="wait">
                        {/* === REKAP TAB === */}
                        {activeTab === 'results' && (
                            <motion.div
                                key="results"
                                initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
                                className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"
                            >
                                <MonitoringResultsTable attempts={finishedAttempts} hasAnyAttempts={attempts.length > 0} onViewDetails={id => router.push(`/dashboard/admin/monitoring/${id}`)} onRecover={canResetParticipants ? handleResetAttempt : undefined} showRoomInfo={roomOptions.length > 0} />
                            </motion.div>
                        )}

                        {/* === ANALISIS TAB === */}
                        {activeTab === 'analysis' && (
                            <motion.div
                                key="analysis"
                                initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
                            >
                                <ItemAnalysisPanel key={selectedExamId} analysis={analysis} />
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            )}

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
