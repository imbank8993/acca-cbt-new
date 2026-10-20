"use client";
import { sortMonitoringExams } from '@/lib/monitoring-exams';
import { hasMonitoringAdministration } from '@/lib/monitoring-tabs';
import { useMonitoringExamClock } from '@/lib/useMonitoringExamClock';
import { ActiveParticipantsPanel } from '@/app/components/ActiveParticipantsPanel';
import { MonitoringHealthPanel } from '@/app/components/MonitoringHealthPanel';
import { MonitoringPASAdministrationPanel } from '@/app/components/monitoring/MonitoringPASAdministrationPanel';
import { ResetExamModal } from '@/app/components/monitoring';
import { BulkResetPanel } from '@/app/components/monitoring/BulkResetPanel';
import { MonitoringWorkspaceHeader } from '@/app/components/monitoring/MonitoringWorkspaceHeader';
import { MonitoringParticipantFilters } from '@/app/components/monitoring/MonitoringParticipantFilters';
import { Spinner } from '@/app/components/ui/Spinner';

import { REFRESH_INTERVAL,useAutoRefresh } from '@/hooks/useAutoRefresh';
import {
getExamAttemptsAction,
getProctorOrganization,
    getRecentViolationsAction,
    listOrganizationExams,
    type ExamAttemptRecord,
    type OrganizationExam,
    type ViolationEvent
} from '@/lib/api/proctor';
import { getSessionUser } from '@/lib/session';
import { formatStudentName } from '@/lib/monitoring-health';
import {
AlertTriangle,
CheckCircle2,
RotateCcw,
ShieldAlert
} from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { Suspense,useCallback,useEffect,useState } from 'react';

function MonitoringContent() {
    const monitoringNow = useMonitoringExamClock();
    const searchParams = useSearchParams();
    const initialExamId = searchParams.get('exam') || '';

    const [isLoading, setIsLoading] = useState(true);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [exams, setExams] = useState<OrganizationExam[]>([]);
    const [selectedExamId, setSelectedExamId] = useState<string>(initialExamId);
    const [attempts, setAttempts] = useState<ExamAttemptRecord[]>([]);
    const [liveAlerts, setLiveAlerts] = useState<ViolationEvent[]>([]);
    const [searchName, setSearchName] = useState('');
    const [filterKelas, setFilterKelas] = useState<string[]>([]);
    const [activeTab, setActiveTab] = useState('live');
    const [attentionOnly, setAttentionOnly] = useState(false);
    const [resettingId] = useState<string | null>(null);
    const [statusFilter, setStatusFilter] = useState('all');
    const [resetStatus, setResetStatus] = useState('all');

    const loadData = useCallback(async (isSilent = false) => {
        if (!isSilent) setIsRefreshing(true);
        setLoadError(null);
        try {
            const user = await getSessionUser();
            if (!user) return;

            const org = await getProctorOrganization();
            if (org) {
                const examList = sortMonitoringExams(await listOrganizationExams());
                setExams(examList);

                const currentExamId = selectedExamId || initialExamId || (examList.length > 0 ? examList[0].id : '');
                if (currentExamId) {
                    if (!selectedExamId) setSelectedExamId(currentExamId);

                    const [attemptData, violationData] = await Promise.all([
                        getExamAttemptsAction(currentExamId),
                        getRecentViolationsAction(currentExamId, 20)
                    ]);
                    setAttempts(attemptData);
                    setLiveAlerts(violationData);
                }
            }
        } catch (error) {
            console.error('[PengawasMonitoring] Gagal memuat data:', error);
            setLoadError(error instanceof Error ? error.message : 'Data monitoring belum dapat dimuat.');
        } finally {
            setIsLoading(false);
            setIsRefreshing(false);
        }
    }, [selectedExamId, initialExamId]);

    useEffect(() => {
        const initialLoad = window.setTimeout(() => { void loadData(false); }, 0);
        return () => window.clearTimeout(initialLoad);
    }, [loadData]);

    // Live refresh setiap 10 detik saat monitoring aktif
    useAutoRefresh(() => loadData(true), REFRESH_INTERVAL.monitoring);

    const handleExamChange = async (examId: string) => {
        if (activeTab === 'admin' && !hasMonitoringAdministration(exams.find(exam => exam.id === examId))) {
            setActiveTab('live');
        }
        setSelectedExamId(examId);
        setSearchName('');
        setFilterKelas([]);
        setStatusFilter('all');
        setAttentionOnly(false);
        setAttempts([]);
        setLoadError(null);
        setIsRefreshing(true);
        try {
            const [attemptData, violationData] = await Promise.all([
                getExamAttemptsAction(examId),
                getRecentViolationsAction(examId, 20)
            ]);
            setAttempts(attemptData);
            setLiveAlerts(violationData);
        } catch (error) {
            setLoadError(error instanceof Error ? error.message : 'Data monitoring belum dapat dimuat.');
        } finally {
            setIsRefreshing(false);
        }
    };

    const [selectedResetAttempt, setSelectedResetAttempt] = useState<ExamAttemptRecord | null>(null);

    const selectedExam = exams.find(exam => exam.id === selectedExamId);
    const canResetParticipants = selectedExam?.canResetParticipants === true;
    const handleReset = (attempt: ExamAttemptRecord) => {
        if (!canResetParticipants || attempt.canReset !== true || attempt.exam_id !== selectedExamId) return;
        setSelectedResetAttempt(attempt);
    };
    // Ekstraksi kelas unik
    const availableClasses = Array.from(
        new Set(attempts.map((a) => a.kelas_name?.trim()).filter((name): name is string => Boolean(name && name !== '-')))
    ).sort((a, b) => a.localeCompare(b, 'id'));

    // Filter daftar pengerjaan
    const filteredAttempts = attempts.filter((a) => {
        const matchName = [a.profiles?.full_name, a.profiles?.identity_number, a.kelas_name].some(value => String(value || '').toLowerCase().includes(searchName.trim().toLowerCase()));
        const matchClass = filterKelas.length === 0 || filterKelas.includes(a.kelas_name?.trim() || '');
        const matchStatus =
            activeTab !== 'results' || statusFilter === 'all' ||
            (statusFilter === 'in_progress' && (a.status === 'in_progress' || a.status === 'sedang')) ||
            (statusFilter === 'submitted' && (['submitted', 'finished', 'selesai'].includes(a.status))) ||
            (statusFilter === 'auto_submitted' && a.status === 'auto_submitted') ||
            (statusFilter === 'belum' && (a.status === 'belum' || !a.status));
        return matchName && matchClass && matchStatus;
    }).sort((a, b) => Number(b.canReset === true && b.status === 'auto_submitted') - Number(a.canReset === true && a.status === 'auto_submitted') || (b.warning_count ?? 0) - (a.warning_count ?? 0));

    const formatTime = (ts: string | null) => {
        if (!ts) return '-';
        try {
            return new Date(ts).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
        } catch {
            return ts;
        }
    };

    return (
        <div className="monitoring-page space-y-5">
            <MonitoringWorkspaceHeader
                exams={exams}
                now={monitoringNow}
                value={selectedExamId}
                onExamChange={(examId) => void handleExamChange(examId)}
                onRefresh={() => void loadData(false)}
                refreshing={isRefreshing}
                attempts={attempts}
                activeTab={activeTab}
                onTabChange={setActiveTab}
                tabs={[
                    { id: 'live', label: 'Peserta aktif' },
                    { id: 'answers', label: 'Jawaban' },
                    { id: 'results', label: 'Daftar peserta' },
                    { id: 'incidents', label: 'Insiden' },
                    { id: 'reset', label: 'Reset massal' },
                    ...(hasMonitoringAdministration(selectedExam) ? [{ id: 'admin', label: 'Administrasi' }] : []),
                ]}
            >
                {(activeTab === 'live' || activeTab === 'results' || (activeTab === 'reset' && canResetParticipants)) && (
                    <MonitoringParticipantFilters
                        search={searchName}
                        onSearchChange={setSearchName}
                        classOptions={availableClasses}
                        selectedClasses={filterKelas}
                        onClassesChange={setFilterKelas}
                        status={activeTab === 'reset' ? resetStatus : activeTab === 'results' ? statusFilter : undefined}
                        onStatusChange={activeTab === 'reset' ? setResetStatus : activeTab === 'results' ? setStatusFilter : undefined}
                        resetOnly={activeTab === 'reset'}
                        attentionOnly={activeTab === 'live' ? attentionOnly : undefined}
                        onAttentionChange={activeTab === 'live' ? setAttentionOnly : undefined}
                    />
                )}
            </MonitoringWorkspaceHeader>

            {loadError && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                <p className="font-semibold">Peserta monitoring gagal dimuat</p>
                <p className="mt-1">{loadError}</p>
                <button type="button" onClick={() => void loadData(false)} className="mt-2 font-semibold underline">Coba lagi</button>
            </div>}

            {activeTab === 'live' && (isLoading ? (
                <div className="flex min-h-48 items-center justify-center gap-3 rounded-xl border border-slate-200 bg-white text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900">
                    <Spinner variant="buble" size={24} /> Memuat daftar peserta...
                </div>
            ) : <ActiveParticipantsPanel key={selectedExamId} attempts={filteredAttempts} attentionOnly={attentionOnly} />)}

            {activeTab === 'answers' && (
                <MonitoringHealthPanel key={selectedExamId} attempts={attempts.filter(attempt => attempt.exam_id === selectedExamId)} onRecover={canResetParticipants ? handleReset : undefined} defaultExpanded />
            )}

            {activeTab === 'results' && (
                    <div className="bg-white dark:bg-slate-900/50 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-xs">
                        <div className="overflow-x-auto">
                            <table className="w-full table-fixed text-left text-xs sm:table-auto">
                                <thead className="hidden sm:table-header-group">
                                    <tr className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-700/80 text-slate-500 dark:text-slate-400 font-bold uppercase tracking-wider text-[10px]">
                                        <th className="py-3 px-3 sm:px-4">Nama Siswa</th>
                                        <th className="hidden py-3 px-3 sm:table-cell">Kelas</th>
                                        <th className="py-3 px-3">Status</th>
                                        <th className="hidden py-3 px-3 sm:table-cell">Waktu Mulai</th>
                                        <th className="hidden py-3 px-3 sm:table-cell">Pelanggaran</th>
                                        <th className="py-3 px-2 text-right sm:px-4">Aksi</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                    {isLoading ? (
                                        <tr>
                                            <td colSpan={6} className="py-8 text-center text-slate-400"><div className="flex flex-col items-center justify-center gap-2"><Spinner variant="buble" size={32} /><span>Memuat daftar peserta...</span></div></td>
                                        </tr>
                                    ) : filteredAttempts.length === 0 ? (
                                        <tr>
                                            <td colSpan={6} className="py-8 text-center text-slate-400">
                                                Tidak ada peserta yang cocok dengan kriteria filter.
                                            </td>
                                        </tr>
                                    ) : (
                                        filteredAttempts.map((attempt) => {
                                            const isStarted = attempt.status === 'in_progress' || attempt.status === 'sedang';
                                            const isFinished = ['submitted', 'auto_submitted', 'finished', 'selesai'].includes(attempt.status);
                                            const warningCount = attempt.warning_count || 0;
                                            const tabCount = attempt.tab_switch_count || 0;
                                            const isResetting = resettingId === attempt.id;

                                            return (
                                                <tr
                                                    key={attempt.id}
                                                    className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
                                                >
                                                    <td className="py-3 px-3 text-xs font-medium text-slate-900 dark:text-white sm:px-4">
                                                        <div className="truncate">{formatStudentName(attempt.profiles?.full_name, 'Peserta')}</div>
                                                        <div className="mt-1 truncate text-[10px] font-normal text-slate-500 sm:hidden">
                                                            {[attempt.kelas_name, formatTime(attempt.started_at ?? null)].filter(Boolean).join(' · ') || 'Belum mulai'}
                                                        </div>
                                                    </td>
                                                    <td className="hidden py-3 px-3 text-slate-600 dark:text-slate-300 font-medium sm:table-cell">
                                                        {attempt.kelas_name || '-'}
                                                    </td>
                                                    <td className="py-3 px-2 sm:px-3">
                                                        {isStarted && (
                                                            <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${attempt.connection_status === 'offline' ? 'bg-amber-500/10 text-amber-600 border-amber-500/20' : 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20'}`}>
                                                                <span className={`w-1.5 h-1.5 rounded-full ${attempt.connection_status === 'offline' ? 'bg-amber-500' : 'bg-blue-500 animate-pulse'}`} />
                                                                {attempt.connection_status === 'offline' ? 'Koneksi terputus' : 'Mengerjakan'}
                                                            </span>
                                                        )}
                                                        {isFinished && (
                                                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                                                                <CheckCircle2 size={12} />
                                                                Selesai
                                                            </span>
                                                        )}
                                                        {!isStarted && !isFinished && (
                                                            <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-500">
                                                                Belum Masuk
                                                            </span>
                                                        )}
                                                    </td>
                                                    <td className="hidden py-3 px-3 text-slate-500 dark:text-slate-400 sm:table-cell">
                                                        {formatTime(attempt.started_at ?? null)}
                                                    </td>
                                                    <td className="hidden py-3 px-3 sm:table-cell">
                                                        {warningCount > 0 || tabCount > 0 ? (
                                                            <span
                                                                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-black ${
                                                                    warningCount >= 3
                                                                        ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20'
                                                                        : 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20'
                                                                }`}
                                                            >
                                                                <AlertTriangle size={11} />
                                                                {tabCount > 0 ? `${tabCount}x Tab` : `${warningCount} Warn`}
                                                            </span>
                                                        ) : (
                                                            <span className="text-slate-300 dark:text-slate-600">-</span>
                                                        )}
                                                    </td>
                                                    <td className="py-3 px-2 text-right sm:px-4">
                                                        {canResetParticipants && attempt.canReset === true && isFinished && !attempt.id.startsWith('unstarted-') && (
                                                            <button
                                                                onClick={() =>
                                                                    handleReset(attempt)
                                                                }
                                                                disabled={isResetting}
                                                                className="inline-flex items-center gap-1 px-2 py-1.5 text-[10px] font-bold bg-amber-50 dark:bg-amber-500/10 hover:bg-amber-100 dark:hover:bg-amber-500/20 text-amber-700 dark:text-amber-300 rounded-lg border border-amber-200 dark:border-amber-500/30 transition-all disabled:opacity-50 sm:px-2.5 sm:py-1 sm:text-[11px]"
                                                                title="Buka kembali pengerjaan siswa yang sudah submit"
                                                            >
                                                                <RotateCcw
                                                                    size={12}
                                                                    className={isResetting ? 'animate-spin' : ''}
                                                                />
                                                                <span className="sm:hidden">Pulihkan</span>
                                                                <span className="hidden sm:inline">Susulan / Pulihkan</span>
                                                            </button>
                                                        )}
                                                    </td>
                                                </tr>
                                            );
                                        })
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>

            )}

            {activeTab === 'incidents' && (
                <section className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900" aria-label="Insiden keamanan">
                    <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 dark:border-slate-800">
                        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-white"><ShieldAlert size={16} className="text-slate-400" />Insiden terbaru</h2>
                        <span className="text-xs text-slate-400">Diperbarui otomatis</span>
                    </div>
                    {liveAlerts.length === 0 ? (
                        <div className="px-5 py-12 text-center text-sm text-slate-500">Belum ada insiden.</div>
                    ) : <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                        {liveAlerts.map(alert => (
                            <li key={alert.id} className="flex items-start justify-between gap-4 px-5 py-4">
                                <div>
                                    <p className="text-sm font-medium text-slate-800 dark:text-white">{formatStudentName(alert.studentName, 'Peserta')}</p>
                                    <p className="mt-1 text-xs text-slate-500">{alert.violationType} <span className="ml-2 text-amber-700 dark:text-amber-400">#{alert.violationCount}</span></p>
                                </div>
                                <time className="shrink-0 text-xs tabular-nums text-slate-400">{formatTime(alert.timestamp)}</time>
                            </li>
                        ))}
                    </ul>}
                </section>
            )}

            {activeTab === 'reset' && <div className="space-y-4">
                {selectedExamId && canResetParticipants && (
                    <BulkResetPanel key={selectedExamId}
                        attempts={filteredAttempts.filter(attempt => attempt.exam_id === selectedExamId && (resetStatus === 'all' || attempt.status === resetStatus))}
                        examDuration={exams.find(exam => exam.id === selectedExamId)?.duration_minutes}
                        onRefresh={() => void loadData(false)}
                    />
                )}
                {selectedExamId && !canResetParticipants && <p className="rounded-xl border border-slate-200 bg-white px-5 py-4 text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900">Mode lihat saja: reset hanya tersedia untuk pembuat ujian.</p>}
            </div>}

            {activeTab === 'admin' && selectedExam && hasMonitoringAdministration(selectedExam) && (
                <MonitoringPASAdministrationPanel key={`pas-administration-${selectedExam.id}`} exam={selectedExam} attempts={attempts.filter(attempt => attempt.exam_id === selectedExam.id)} userRole="pengawas" />
            )}

            <ResetExamModal
                open={canResetParticipants && selectedResetAttempt?.canReset === true && selectedResetAttempt.exam_id === selectedExamId}
                attempt={selectedResetAttempt}
                examDuration={
                    exams.find(e => e.id === (selectedResetAttempt?.exam_id || selectedExamId))?.duration_minutes ??
                    exams.find(e => e.id === selectedExamId)?.duration_minutes ??
                    exams.find(e => e.id === selectedExamId)?.duration
                }
                onClose={() => setSelectedResetAttempt(null)}
                onSuccess={() => {
                    void loadData(true);
                }}
            />
        </div>
    );
}

export default function PengawasMonitoringPage() {
    return (
        <Suspense
            fallback={
                <div className="p-8 flex flex-col items-center justify-center gap-2"><Spinner variant="buble" size={32} /><p className="text-xs font-bold text-slate-400">Menyiapkan layar monitoring pengawas...</p></div>
            }
        >
            <MonitoringContent />
        </Suspense>
    );
}
