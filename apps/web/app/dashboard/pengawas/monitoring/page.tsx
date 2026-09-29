"use client";
import { getErrorMessage } from '@/lib/errors';
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
import { promptRecoveryReason,resetExamAttempt } from '@/lib/api/proctoring';
import { getSessionUser } from '@/lib/session';
import {
AlertTriangle,
ArrowLeft,
CheckCircle2,
ChevronDown,
Radio,
RefreshCw,
RotateCcw,
Search,
ShieldAlert,
X
} from 'lucide-react';
import { useRouter,useSearchParams } from 'next/navigation';
import { Suspense,useCallback,useEffect,useState } from 'react';

function MonitoringContent() {
    const searchParams = useSearchParams();
    const router = useRouter();
    const initialExamId = searchParams.get('exam') || '';

    const [isLoading, setIsLoading] = useState(true);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [exams, setExams] = useState<OrganizationExam[]>([]);
    const [selectedExamId, setSelectedExamId] = useState<string>(initialExamId);
    const [attempts, setAttempts] = useState<ExamAttemptRecord[]>([]);
    const [liveAlerts, setLiveAlerts] = useState<ViolationEvent[]>([]);
    const [searchName, setSearchName] = useState('');
    const [filterKelas, setFilterKelas] = useState('');
    const [resettingId, setResettingId] = useState<string | null>(null);
    const [statusFilter, setStatusFilter] = useState<'all' | 'in_progress' | 'finished' | 'belum'>('all');

    const loadData = useCallback(async (isSilent = false) => {
        if (!isSilent) setIsRefreshing(true);
        try {
            const user = await getSessionUser();
            if (!user) return;

            const org = await getProctorOrganization();
            if (org) {
                const examList = await listOrganizationExams();
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
        setSelectedExamId(examId);
        setIsRefreshing(true);
        try {
            const [attemptData, violationData] = await Promise.all([
                getExamAttemptsAction(examId),
                getRecentViolationsAction(examId, 20)
            ]);
            setAttempts(attemptData);
            setLiveAlerts(violationData);
        } finally {
            setIsRefreshing(false);
        }
    };

    const handleReset = async (attemptId: string, studentName: string) => {
        const reason = promptRecoveryReason(studentName);
        if (!reason) return;
        if (!confirm(`Konfirmasi pemulihan ujian untuk siswa "${studentName}"?\n\nAlasan: ${reason}`)) {
            return;
        }

        setResettingId(attemptId);
        try {
            const res = await resetExamAttempt(attemptId, reason);
            if (res.success) {
                alert(`${res.serverAnswerCount} jawaban sudah ada di server. Siswa dapat melanjutkan pemulihan.`);
                await loadData(true);
            } else {
                alert(`Gagal mereset ujian: ${res.error}`);
            }
        } catch (err) {
            alert(`Terjadi kesalahan: ${getErrorMessage(err) || 'Gagal mereset'}`);
        } finally {
            setResettingId(null);
        }
    };

    // Ekstraksi kelas unik
    const availableClasses = Array.from(
        new Set(attempts.map((a) => a.kelas_name).filter((k) => k && k !== '-'))
    );

    // Filter daftar pengerjaan
    const filteredAttempts = attempts.filter((a) => {
        const fullName = a.profiles?.full_name || '';
        const matchName = fullName.toLowerCase().includes(searchName.toLowerCase());
        const matchClass = !filterKelas || a.kelas_name === filterKelas;
        const matchStatus =
            statusFilter === 'all' ||
            (statusFilter === 'in_progress' && (a.status === 'in_progress' || a.status === 'sedang')) ||
            (statusFilter === 'finished' && (a.status === 'finished' || a.status === 'selesai')) ||
            (statusFilter === 'belum' && (a.status === 'belum' || !a.status));
        return matchName && matchClass && matchStatus;
    });

    const activeCount = attempts.filter((a) => a.status === 'in_progress' || a.status === 'sedang').length;
    const finishedCount = attempts.filter((a) => a.status === 'finished' || a.status === 'selesai').length;
    const unstartedCount = attempts.filter((a) => a.status === 'belum' || !a.status).length;

    const formatTime = (ts: string | null) => {
        if (!ts) return '-';
        try {
            return new Date(ts).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
        } catch {
            return ts;
        }
    };

    return (
        <div className="space-y-6">
            {/* Header navigasi */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div className="flex items-center gap-3">
                    <button
                        onClick={() => router.push('/dashboard/pengawas')}
                        className="p-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 rounded-xl transition-all"
                        title="Kembali ke Dashboard"
                    >
                        <ArrowLeft size={18} className="text-slate-600 dark:text-slate-300" />
                    </button>
                    <div>
                        <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight flex items-center gap-2">
                            <span>Monitoring Pengawasan Ujian</span>
                            <span className="text-xs bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20 px-2.5 py-0.5 rounded-full font-bold uppercase tracking-wider flex items-center gap-1.5">
                                <Radio size={12} className="animate-pulse" /> Live
                            </span>
                        </h1>
                        <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                            Pantau kehadiran, progres pengerjaan, dan insiden kecurangan peserta
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-3 w-full sm:w-auto">
                    {/* Pilih Ujian */}
                    <div className="relative flex-1 sm:w-64">
                        <select
                            value={selectedExamId}
                            onChange={(e) => handleExamChange(e.target.value)}
                            className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white text-xs font-bold px-3 py-2.5 rounded-xl appearance-none pr-8 shadow-xs focus:outline-none focus:ring-2 focus:ring-primary/20"
                        >
                            {exams.map((exam) => (
                                <option key={exam.id} value={exam.id}>
                                    {exam.title} ({exam.exam_type || 'Ujian'})
                                </option>
                            ))}
                        </select>
                        <ChevronDown size={14} className="absolute right-3 top-3 text-slate-400 pointer-events-none" />
                    </div>

                    <button
                        onClick={() => loadData(false)}
                        disabled={isRefreshing}
                        className="p-2.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 rounded-xl shadow-xs transition-all disabled:opacity-50 text-slate-600 dark:text-slate-300"
                        title="Segarkan data sekarang"
                    >
                        <RefreshCw size={16} className={isRefreshing ? 'animate-spin' : ''} />
                    </button>
                </div>
            </div>

            {/* Quick Stat Pill Tabs */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <button
                    onClick={() => setStatusFilter('all')}
                    className={`p-3.5 rounded-xl border text-left transition-all ${
                        statusFilter === 'all'
                            ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900 border-transparent shadow-xs'
                            : 'bg-white dark:bg-slate-900/60 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300'
                    }`}
                >
                    <p className="text-[10px] font-black uppercase tracking-wider opacity-70">Total Peserta</p>
                    <p className="text-2xl font-black mt-0.5">{attempts.length}</p>
                </button>

                <button
                    onClick={() => setStatusFilter('in_progress')}
                    className={`p-3.5 rounded-xl border text-left transition-all ${
                        statusFilter === 'in_progress'
                            ? 'bg-blue-600 text-white border-transparent shadow-xs'
                            : 'bg-white dark:bg-slate-900/60 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300'
                    }`}
                >
                    <p className="text-[10px] font-black uppercase tracking-wider opacity-70">Sedang Ujian</p>
                    <p className="text-2xl font-black mt-0.5 text-blue-600 dark:text-blue-400 group-hover:text-blue-500">
                        {activeCount}
                    </p>
                </button>

                <button
                    onClick={() => setStatusFilter('finished')}
                    className={`p-3.5 rounded-xl border text-left transition-all ${
                        statusFilter === 'finished'
                            ? 'bg-emerald-600 text-white border-transparent shadow-xs'
                            : 'bg-white dark:bg-slate-900/60 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300'
                    }`}
                >
                    <p className="text-[10px] font-black uppercase tracking-wider opacity-70">Sudah Selesai</p>
                    <p className="text-2xl font-black mt-0.5 text-emerald-600 dark:text-emerald-400">
                        {finishedCount}
                    </p>
                </button>

                <button
                    onClick={() => setStatusFilter('belum')}
                    className={`p-3.5 rounded-xl border text-left transition-all ${
                        statusFilter === 'belum'
                            ? 'bg-amber-600 text-white border-transparent shadow-xs'
                            : 'bg-white dark:bg-slate-900/60 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300'
                    }`}
                >
                    <p className="text-[10px] font-black uppercase tracking-wider opacity-70">Belum Memulai</p>
                    <p className="text-2xl font-black mt-0.5 text-amber-600 dark:text-amber-400">
                        {unstartedCount}
                    </p>
                </button>
            </div>

            {/* Layout Utama: Filter & Tabel Peserta + Feed Pelanggaran */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Kolom Tabel (2 Kolom di Desktop) */}
                <div className="lg:col-span-2 space-y-4">
                    {/* Search & Filter Bar */}
                    <div className="flex flex-col sm:flex-row gap-3 bg-white dark:bg-slate-900/50 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
                        <div className="relative flex-1">
                            <Search size={16} className="absolute left-3 top-3 text-slate-400 pointer-events-none" />
                            <input
                                type="text"
                                placeholder="Cari nama siswa..."
                                value={searchName}
                                onChange={(e) => setSearchName(e.target.value)}
                                className="w-full pl-9 pr-4 py-2 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-medium focus:outline-none focus:ring-2 focus:ring-primary/20 text-slate-900 dark:text-white"
                            />
                            {searchName && (
                                <button
                                    onClick={() => setSearchName('')}
                                    className="absolute right-3 top-3 text-slate-400 hover:text-slate-600"
                                >
                                    <X size={14} />
                                </button>
                            )}
                        </div>

                        {availableClasses.length > 0 && (
                            <div className="sm:w-44">
                                <select
                                    value={filterKelas}
                                    onChange={(e) => setFilterKelas(e.target.value)}
                                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-700 dark:text-slate-300 focus:outline-none"
                                >
                                    <option value="">Semua Kelas</option>
                                    {availableClasses.map((cls) => (
                                        <option key={cls || ''} value={cls || ''}>
                                            {cls}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        )}
                    </div>

                    {/* Tabel Peserta */}
                    <div className="bg-white dark:bg-slate-900/50 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-xs">
                        <div className="overflow-x-auto">
                            <table className="w-full text-left text-xs">
                                <thead>
                                    <tr className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-700/80 text-slate-500 dark:text-slate-400 font-bold uppercase tracking-wider text-[10px]">
                                        <th className="py-3 px-4">Nama Siswa</th>
                                        <th className="py-3 px-3">Kelas</th>
                                        <th className="py-3 px-3">Status</th>
                                        <th className="py-3 px-3">Waktu Mulai</th>
                                        <th className="py-3 px-3">Pelanggaran</th>
                                        <th className="py-3 px-4 text-right">Aksi</th>
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
                                            const isFinished = attempt.status === 'finished' || attempt.status === 'selesai';
                                            const warningCount = attempt.warning_count || 0;
                                            const tabCount = attempt.tab_switch_count || 0;
                                            const isResetting = resettingId === attempt.id;

                                            return (
                                                <tr
                                                    key={attempt.id}
                                                    className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
                                                >
                                                    <td className="py-3 px-4 font-bold text-slate-900 dark:text-white">
                                                        {attempt.profiles?.full_name || 'Peserta'}
                                                    </td>
                                                    <td className="py-3 px-3 text-slate-600 dark:text-slate-300 font-medium">
                                                        {attempt.kelas_name || '-'}
                                                    </td>
                                                    <td className="py-3 px-3">
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
                                                    <td className="py-3 px-3 text-slate-500 dark:text-slate-400">
                                                        {formatTime(attempt.started_at ?? null)}
                                                    </td>
                                                    <td className="py-3 px-3">
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
                                                    <td className="py-3 px-4 text-right">
                                                        {isFinished && !attempt.id.startsWith('unstarted-') && (
                                                            <button
                                                                onClick={() =>
                                                                    handleReset(
                                                                        attempt.id,
                                                                        attempt.profiles?.full_name || 'Siswa'
                                                                    )
                                                                }
                                                                disabled={isResetting}
                                                                className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold bg-amber-50 dark:bg-amber-500/10 hover:bg-amber-100 dark:hover:bg-amber-500/20 text-amber-700 dark:text-amber-300 rounded-lg border border-amber-200 dark:border-amber-500/30 transition-all disabled:opacity-50"
                                                                title="Buka kembali pengerjaan siswa yang sudah submit"
                                                            >
                                                                <RotateCcw
                                                                    size={12}
                                                                    className={isResetting ? 'animate-spin' : ''}
                                                                />
                                                                <span>Reset</span>
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
                </div>

                {/* Kolom Log Insiden Real-time (1 Kolom di Desktop) */}
                <div className="space-y-4">
                    <div className="bg-white dark:bg-slate-900/50 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-sm font-black text-slate-900 dark:text-white flex items-center gap-2">
                                <ShieldAlert size={18} className="text-rose-500" />
                                <span>Feed Insiden Keamanan</span>
                            </h2>
                            <span className="text-[10px] font-bold text-slate-400 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-md">
                                Auto 10s
                            </span>
                        </div>

                        {liveAlerts.length === 0 ? (
                            <div className="py-8 text-center text-slate-400">
                                <CheckCircle2 size={24} className="mx-auto mb-2 text-emerald-500" />
                                <p className="text-xs font-bold">Ruang ujian tertib</p>
                                <p className="text-[11px] text-slate-400 mt-0.5">
                                    Belum ada pelanggaran browser terdeteksi
                                </p>
                            </div>
                        ) : (
                            <div className="space-y-2.5 max-h-[500px] overflow-y-auto pr-1">
                                {liveAlerts.map((alert) => (
                                    <div
                                        key={alert.id}
                                        className="p-3 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-200/80 dark:border-slate-700/60"
                                    >
                                        <div className="flex justify-between items-start gap-2 mb-1">
                                            <p className="font-bold text-xs text-slate-900 dark:text-white">
                                                {alert.studentName}
                                            </p>
                                            <span className="text-[10px] font-bold text-slate-400">
                                                {formatTime(alert.timestamp)}
                                            </span>
                                        </div>
                                        <div className="flex items-center justify-between text-[11px]">
                                            <span className="text-slate-500 dark:text-slate-400 font-medium">
                                                {alert.violationType}
                                            </span>
                                            <span className="text-rose-600 dark:text-rose-400 font-black text-[10px]">
                                                #{alert.violationCount}
                                            </span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>
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
