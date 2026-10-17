"use client";
import { Spinner } from '@/app/components/ui/Spinner';

import { REFRESH_INTERVAL,useAutoRefresh } from '@/hooks/useAutoRefresh';
import {
getExamAttemptsAction,
getProctorOrganization,
    getRecentViolationsAction,
    listOrganizationExams,
    type ExamAttemptRecord,
    type OrganizationExam,
    type ProctorOrganization,
type ViolationEvent
} from '@/lib/api/proctor';
import { getSessionUser } from '@/lib/session';
import { examTypeLabel } from '@/lib/exam-types';
import {
Activity,
AlertTriangle,
ArrowRight,
CheckCircle2,
Eye,
Layers,
Radio,
RefreshCw,
ShieldAlert
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback,useEffect,useState } from 'react';

export default function PengawasDashboard() {
    const router = useRouter();

    const [isLoading, setIsLoading] = useState(true);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [organization, setOrganization] = useState<ProctorOrganization | null>(null);
    const [exams, setExams] = useState<OrganizationExam[]>([]);
    const [selectedExamId, setSelectedExamId] = useState<string>('');
    const [attempts, setAttempts] = useState<ExamAttemptRecord[]>([]);
    const [violations, setViolations] = useState<ViolationEvent[]>([]);
    const [lastUpdated, setLastUpdated] = useState<Date>(new Date());

    const loadData = useCallback(async (isSilent = false) => {
        if (!isSilent) setIsRefreshing(true);
        setLoadError(null);
        try {
            const user = await getSessionUser();
            if (!user) return;

            const org = await getProctorOrganization();
            setOrganization(org);

            if (org) {
                const examList = await listOrganizationExams();
                setExams(examList);

                // Prioritaskan ujian yang sedang berlangsung atau pertama dalam daftar
                const currentSelectedId = selectedExamId || (examList.length > 0 ? examList[0].id : '');
                if (currentSelectedId) {
                    if (!selectedExamId) setSelectedExamId(currentSelectedId);

                    const [attemptData, violationData] = await Promise.all([
                        getExamAttemptsAction(currentSelectedId),
                        getRecentViolationsAction(currentSelectedId, 15)
                    ]);
                    setAttempts(attemptData);
                    setViolations(violationData);
                }
            }
            setLastUpdated(new Date());
        } catch (error) {
            console.error('[PengawasDashboard] Gagal memuat data pemantauan:', error);
            setLoadError(error instanceof Error ? error.message : 'Data monitoring belum dapat dimuat.');
        } finally {
            setIsLoading(false);
            setIsRefreshing(false);
        }
    }, [selectedExamId]);

    useEffect(() => {
        const initialLoad = window.setTimeout(() => { void loadData(false); }, 0);
        return () => window.clearTimeout(initialLoad);
    }, [loadData]);

    // Pembaruan berkala setiap 30 detik untuk dashboard
    useAutoRefresh(() => loadData(true), REFRESH_INTERVAL.dashboard);

    const handleSelectExam = async (examId: string) => {
        setSelectedExamId(examId);
        setAttempts([]);
        setLoadError(null);
        setIsRefreshing(true);
        try {
            const [attemptData, violationData] = await Promise.all([
                getExamAttemptsAction(examId),
                getRecentViolationsAction(examId, 15)
            ]);
            setAttempts(attemptData);
            setViolations(violationData);
            setLastUpdated(new Date());
        } catch (error) {
            setLoadError(error instanceof Error ? error.message : 'Data monitoring belum dapat dimuat.');
        } finally {
            setIsRefreshing(false);
        }
    };

    // Statistik dari data riil
    const activeStudents = attempts.filter((a) => a.status === 'in_progress' || a.status === 'sedang').length;
    const completedStudents = attempts.filter((a) => a.status === 'finished' || a.status === 'selesai').length;
    const totalViolationsCount = attempts.reduce((acc, curr) => acc + (curr.warning_count || 0), 0);
    const ongoingExamsCount = exams.filter((e) => e.status === 'published' || e.is_published).length;

    const selectedExam = exams.find((e) => e.id === selectedExamId);

    const formatEventLabel = (type: string) => {
        switch (type.toLowerCase()) {
            case 'tab_switch':
            case 'window_blur':
            case 'blur':
                return 'Pindah Tab / Jendela';
            case 'fullscreen_exit':
                return 'Keluar Layar Penuh';
            case 'devtools_open':
                return 'Inspeksi DevTools';
            case 'force_terminated':
                return 'Ditutup Paksa';
            case 'reset_by_proctor':
                return 'Reset oleh Pengawas';
            default:
                return type;
        }
    };

    const formatTime = (ts: string) => {
        try {
            const d = new Date(ts);
            return d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        } catch {
            return ts;
        }
    };

    return (
        <div className="space-y-8">
            {loadError && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                <p className="font-semibold">Peserta monitoring gagal dimuat</p>
                <p className="mt-1">{loadError}</p>
                <button type="button" onClick={() => void loadData(false)} className="mt-2 font-semibold underline">Coba lagi</button>
            </div>}
            {/* Header */}
            <header className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
                <div>
                    <div className="flex items-center gap-3 mb-2">
                        <h1 className="text-3xl font-black text-slate-900 dark:text-white tracking-tight">
                            Live Supervision
                        </h1>
                        <span className="bg-primary/10 text-primary border border-primary/20 text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wider">
                            Pengawas Ruang
                        </span>
                    </div>
                    <p className="text-slate-500 dark:text-slate-400 font-medium text-sm">
                        Pemantauan langsung sesi ujian dan aktivitas peserta CBT{' '}
                        {organization ? `• ${organization.name}` : ''}
                    </p>
                </div>

                <div className="flex items-center gap-3">
                    <button
                        onClick={() => router.push('/dashboard/pengawas/administration')}
                        className="flex items-center gap-2 px-4 py-2.5 bg-[#3083FF] hover:bg-blue-600 text-white font-bold text-xs rounded-xl shadow-xs transition-all"
                        title="Kelola Berita Acara & Daftar Hadir PAS"
                    >
                        <span>Berita Acara & Absensi PAS</span>
                        <ArrowRight size={14} />
                    </button>

                    <button
                        onClick={() => loadData(false)}
                        disabled={isRefreshing}
                        className="flex items-center gap-2 px-4 py-2.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold text-xs rounded-xl shadow-xs transition-all disabled:opacity-50"
                        title="Segarkan data"
                    >
                        <RefreshCw size={14} className={isRefreshing ? 'animate-spin' : ''} />
                        <span>Segarkan</span>
                    </button>

                    <div className="flex items-center gap-2.5 bg-rose-500/10 px-4 py-2.5 rounded-xl border border-rose-500/20">
                        <Radio size={16} className="text-rose-500 animate-pulse" />
                        <span className="text-rose-500 font-black text-xs uppercase tracking-wider">
                            {ongoingExamsCount > 0 ? 'Sesi Aktif' : 'Standby'}
                        </span>
                    </div>
                </div>
            </header>

            {/* Statistik Ringkas */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
                <div className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 p-6 rounded-2xl shadow-xs">
                    <div className="flex items-center justify-between mb-4">
                        <p className="text-xs font-black text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                            Peserta Aktif
                        </p>
                        <div className="p-2.5 bg-blue-500/10 text-blue-600 dark:text-blue-400 rounded-xl">
                            <Activity size={20} />
                        </div>
                    </div>
                    <p className="text-3xl font-black text-slate-900 dark:text-white">
                        {isLoading ? '...' : activeStudents}
                    </p>
                    <p className="text-xs text-slate-400 mt-1 font-medium">Sedang mengerjakan ujian</p>
                </div>

                <div className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 p-6 rounded-2xl shadow-xs">
                    <div className="flex items-center justify-between mb-4">
                        <p className="text-xs font-black text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                            Total Pelanggaran
                        </p>
                        <div className="p-2.5 bg-rose-500/10 text-rose-600 dark:text-rose-400 rounded-xl">
                            <AlertTriangle size={20} />
                        </div>
                    </div>
                    <p className="text-3xl font-black text-slate-900 dark:text-white">
                        {isLoading ? '...' : totalViolationsCount}
                    </p>
                    <p className="text-xs text-slate-400 mt-1 font-medium">Insiden tercatat di ujian ini</p>
                </div>

                <div className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 p-6 rounded-2xl shadow-xs">
                    <div className="flex items-center justify-between mb-4">
                        <p className="text-xs font-black text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                            Ujian Aktif
                        </p>
                        <div className="p-2.5 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded-xl">
                            <Layers size={20} />
                        </div>
                    </div>
                    <p className="text-3xl font-black text-slate-900 dark:text-white">
                        {isLoading ? '...' : ongoingExamsCount}
                    </p>
                    <p className="text-xs text-slate-400 mt-1 font-medium">Ujian terbit di sekolah</p>
                </div>

                <div className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 p-6 rounded-2xl shadow-xs">
                    <div className="flex items-center justify-between mb-4">
                        <p className="text-xs font-black text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                            Selesai Submit
                        </p>
                        <div className="p-2.5 bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 rounded-xl">
                            <CheckCircle2 size={20} />
                        </div>
                    </div>
                    <p className="text-3xl font-black text-slate-900 dark:text-white">
                        {isLoading ? '...' : completedStudents}
                    </p>
                    <p className="text-xs text-slate-400 mt-1 font-medium">Pengerjaan dikumpulkan</p>
                </div>
            </div>

            {/* Pilihan Ujian yang Dipantau */}
            {exams.length > 0 && (
                <div className="bg-white dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-xs">
                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-4">
                        <div>
                            <h2 className="text-lg font-black text-slate-900 dark:text-white">
                                Pilih Sesi Ujian untuk Dipantau
                            </h2>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                                Menampilkan pengerjaan dan log pengawasan ujian terpilih
                            </p>
                        </div>
                        {selectedExamId && (
                            <button
                                onClick={() => router.push(`/dashboard/pengawas/monitoring?exam=${selectedExamId}`)}
                                className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary-dark text-white font-bold text-xs rounded-xl shadow-xs transition-all"
                            >
                                <Eye size={14} />
                                <span>Buka Layar Monitoring Lengkap</span>
                                <ArrowRight size={14} />
                            </button>
                        )}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                        {exams.map((exam) => {
                            const isSelected = exam.id === selectedExamId;
                            return (
                                <button
                                    key={exam.id}
                                    onClick={() => handleSelectExam(exam.id)}
                                    className={`text-left p-4 rounded-xl border transition-all ${
                                        isSelected
                                            ? 'bg-primary/5 dark:bg-primary/10 border-primary text-primary'
                                            : 'bg-slate-50/50 dark:bg-slate-800/40 border-slate-200 dark:border-slate-700/60 hover:border-slate-300 dark:hover:border-slate-600'
                                    }`}
                                >
                                    <div className="flex items-center justify-between mb-1.5">
                                        <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md bg-slate-200/60 dark:bg-slate-700 text-slate-700 dark:text-slate-300">
                                            {exam.exam_type ? examTypeLabel(exam.exam_type) : 'Ujian'}
                                        </span>
                                        <span className="text-[11px] font-bold text-slate-400">
                                            {exam.duration || 60} Menit
                                        </span>
                                    </div>
                                    <p className="font-bold text-sm text-slate-900 dark:text-white line-clamp-1">
                                        {exam.title}
                                    </p>
                                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 line-clamp-1">
                                        {exam.subject || 'Mata Pelajaran'}
                                    </p>
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Security Feed (Real-Time Violation Events) */}
            <div className="bg-white dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-xs">
                <div className="flex items-center justify-between mb-6">
                    <div>
                        <h2 className="text-xl font-black text-slate-900 dark:text-white flex items-center gap-2">
                            <ShieldAlert className="text-rose-500" size={22} />
                            <span>Log Pelanggaran Real-time</span>
                        </h2>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                            {selectedExam ? `Ujian: ${selectedExam.title}` : 'Pilih ujian untuk melihat aktivitas'}
                        </p>
                    </div>

                    <div className="flex items-center gap-3">
                        <span className="text-[11px] text-slate-400 hidden sm:inline">
                            Diperbarui: {lastUpdated.toLocaleTimeString('id-ID')}
                        </span>
                        {selectedExamId && (
                            <button
                                onClick={() => router.push(`/dashboard/pengawas/monitoring?exam=${selectedExamId}`)}
                                className="text-xs font-bold text-primary hover:underline flex items-center gap-1"
                            >
                                <span>Lihat Semua Peserta</span>
                                <ArrowRight size={14} />
                            </button>
                        )}
                    </div>
                </div>

                {isLoading ? (
                    <div className="p-8 flex flex-col items-center justify-center gap-2"><Spinner variant="buble" size={32} /><p className="text-xs font-bold text-slate-400">Memuat log pengawasan...</p></div>
                ) : violations.length === 0 ? (
                    <div className="p-8 text-center bg-slate-50 dark:bg-slate-800/20 border border-dashed border-slate-200 dark:border-slate-800 rounded-2xl">
                        <CheckCircle2 size={32} className="mx-auto mb-2 text-emerald-500" />
                        <p className="font-bold text-sm text-slate-800 dark:text-slate-200">
                            Tidak Ada Pelanggaran Aktif
                        </p>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-sm mx-auto">
                            Semua peserta yang terhubung saat ini berada dalam kondisi tertib dan tidak ada catatan kecurangan yang terdeteksi.
                        </p>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {violations.map((log) => {
                            const isHigh = log.violationCount >= 3;
                            return (
                                <div
                                    key={log.id}
                                    className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-200/80 dark:border-slate-700/60 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all"
                                >
                                    <div className="flex items-center gap-4">
                                        <div
                                            className={`w-3 h-3 rounded-full ${
                                                isHigh
                                                    ? 'bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.6)]'
                                                    : 'bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)]'
                                            }`}
                                        />
                                        <div>
                                            <p className="font-bold text-sm text-slate-900 dark:text-white">
                                                {log.studentName}
                                            </p>
                                            <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                                                {formatEventLabel(log.violationType)}
                                                {log.duration ? ` (${log.duration})` : ''}
                                            </p>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <span className="text-xs font-bold text-slate-500 dark:text-slate-400 block mb-0.5">
                                            {formatTime(log.timestamp)}
                                        </span>
                                        <span
                                            className={`text-[10px] font-black px-2 py-0.5 rounded-md uppercase ${
                                                isHigh
                                                    ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20'
                                                    : 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20'
                                            }`}
                                        >
                                            Peringatan #{log.violationCount}
                                        </span>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}
