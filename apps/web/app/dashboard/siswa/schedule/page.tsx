"use client";
import { Spinner } from '@/app/components/ui/Spinner';
import { getStudentExamsResult,type StudentScheduledExam } from '@/lib/api/students';
import { formatSchoolDate,formatSchoolTimeRange } from '@/lib/school-time';
import { useSchoolTimeZone } from '@/lib/useSchoolTimeZone';
import { getSessionUser } from '@/lib/session';
import { examTypeLabel } from '@/lib/exam-types';
import { REFRESH_INTERVAL,useAutoRefresh } from '@/lib/useAutoRefresh';
import { scheduleState, scheduleCountdown } from '@/lib/student-schedule';
import { motion } from 'framer-motion';
import {
AlertCircle,
ArrowRight,
CalendarDays,
CheckCircle2,
Clock,
Ghost,
Lock,RefreshCw
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback,useEffect,useRef,useState } from 'react';

const SchedulePage = () => {
    const { timeZone, error: timeZoneError } = useSchoolTimeZone();
    const [exams, setExams] = useState<StudentScheduledExam[]>([]);
    const [loading, setLoading] = useState(true);
    const [now, setNow] = useState(new Date());
    const [loadError, setLoadError] = useState('');
    const router = useRouter();
    const generation = useRef(0);
    const inFlight = useRef(false);
    const clock = useRef<{ time: number; tick: number } | null>(null);
    const [historyLimit, setHistoryLimit] = useState(10);

    const loadData = useCallback(async () => {
        if (inFlight.current) return;
        inFlight.current = true;
        const request = ++generation.current;
        setLoading(true); setLoadError('');
        try {
            const user = await getSessionUser({ refresh: true });
            if (!user) throw new Error('Sesi berakhir. Silakan login kembali.');
            const response = await getStudentExamsResult();
            if (request !== generation.current) return;
            if (!response.success) throw new Error(response.error || 'Jadwal ujian tidak dapat dimuat.');
            if (response.userId !== user.id) throw new Error('Sesi akun berubah. Muat ulang halaman.');
            const time = Date.parse(response.serverTime);
            if (!Number.isFinite(time)) throw new Error('Waktu server belum dapat diverifikasi. Coba lagi.');
            clock.current = { time, tick: performance.now() };
            setNow(new Date(time)); setExams(response.exams);
        } catch (err) {
            if (request === generation.current) { setExams([]); clock.current = null; setLoadError(err instanceof Error ? err.message : 'Jadwal ujian gagal dimuat.'); }
        } finally {
            if (request === generation.current) { inFlight.current = false; setLoading(false); }
        }
    }, []);

    useEffect(() => {
        const initialLoad = window.setTimeout(() => void loadData(), 0);
        const interval = setInterval(() => {
            if (clock.current) setNow(new Date(clock.current.time + performance.now() - clock.current.tick));
        }, 1000);
        return () => { window.clearTimeout(initialLoad); clearInterval(interval); generation.current++; inFlight.current = false; };
    }, [loadData]);

    // Jadwal ujian disegarkan berkala; langganan realtime Supabase sudah tidak ada.
    useAutoRefresh(loadData, REFRESH_INTERVAL.dashboard);

    const getStatus = (exam: StudentScheduledExam) => {
        if (scheduleState(exam, now.getTime()) === 'invalid') return { label: 'Jadwal tidak valid', color: 'text-red-500', bg: 'bg-red-50 border-red-100', icon: AlertCircle, enabled: false };
        if (exam.status === 'archived') return { label: 'Diarsipkan', color: 'text-slate-500', bg: 'bg-slate-50 border-slate-200', icon: Lock, enabled: false };
        // Must be published
        if (!exam.is_published) {
            return { label: 'Belum Publikasi', color: 'text-slate-400', bg: 'bg-slate-50 border-slate-200', icon: Lock, enabled: false };
        }

        // Check if completed
        if (exam.isCompleted) {
            return { label: 'Selesai', color: 'text-emerald-600', bg: 'bg-emerald-50 border-emerald-200', icon: CheckCircle2, enabled: false };
        }

        const startTime = exam.start_time ? new Date(exam.start_time) : null;
        const endTime = exam.end_time ? new Date(exam.end_time) : null;
        const isBeforeStart = startTime && now < startTime;
        const isAfterEnd = endTime && now > endTime;

        // Window not yet open
        if (isBeforeStart) {
            return { label: 'Belum Mulai', color: 'text-blue-600', bg: 'bg-blue-50 border-blue-200', icon: Clock, enabled: false };
        }

        // Window closed
        if (isAfterEnd) {
            return { label: 'Waktu Habis', color: 'text-red-500', bg: 'bg-red-50 border-red-100', icon: AlertCircle, enabled: false };
        }

        // Window open — student can start
        return { label: 'Kerjakan Sekarang', color: 'text-white', bg: 'bg-[#3083FF] hover:bg-[#2563EB]', icon: ArrowRight, enabled: true };
    };

    const formatDay = (date: string | null | undefined) => formatSchoolDate(date, timeZone);
    const formatTimeRange = (start: string | null | undefined, end: string | null | undefined) =>
        formatSchoolTimeRange(start, end, timeZone);

    const formatTimeUntil = (date: string) => scheduleCountdown(date, now.getTime());
    const isOpenNow = (exam: StudentScheduledExam) => scheduleState(exam, now.getTime()) === 'open';

    // Sort exams: yang benar-benar sedang terbuka lebih dulu, lalu waktu mulai.
    const sortedExams = [...(loading || loadError ? [] : exams)].sort((a, b) => {
        const aOpen = isOpenNow(a);
        const bOpen = isOpenNow(b);
        if (aOpen && !bOpen) return -1;
        if (!aOpen && bOpen) return 1;
        const aStart = a.start_time ? new Date(a.start_time).getTime() : Infinity;
        const bStart = b.start_time ? new Date(b.start_time).getTime() : Infinity;
        return aStart - bStart;
    });

    const openExams = sortedExams.filter(isOpenNow);
    const upcomingExams = sortedExams.filter(e => scheduleState(e, now.getTime()) === 'upcoming');
    const closedExams = sortedExams.filter(e => ['closed', 'invalid'].includes(scheduleState(e, now.getTime())));
    return (
        <div className="max-w-7xl mx-auto pb-24 space-y-6">
            {timeZoneError && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{timeZoneError}</div>}

            {/* Stats bar */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-white border border-slate-100 rounded-2xl p-4 text-center shadow-sm hover:shadow-md transition-shadow">
                    <p className="text-2xl font-black text-emerald-600 font-mono">{loadError ? '—' : openExams.length}</p>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">Tersedia</p>
                </div>
                <div className="bg-white border border-slate-100 rounded-2xl p-4 text-center shadow-sm hover:shadow-md transition-shadow">
                    <p className="text-2xl font-black text-blue-600 font-mono">{loadError ? '—' : upcomingExams.length}</p>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">Akan Datang</p>
                </div>
                <div className="bg-white border border-slate-100 rounded-2xl p-4 text-center shadow-sm hover:shadow-md transition-shadow">
                    <p className="text-2xl font-black text-[#3083FF] font-mono">{loadError ? '—' : sortedExams.filter(e => e.isCompleted).length}</p>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">Selesai</p>
                </div>
                <div className="bg-white border border-slate-100 rounded-2xl p-4 text-center shadow-sm hover:shadow-md transition-shadow">
                    <p className="text-2xl font-black text-slate-500 font-mono">{loadError ? '—' : sortedExams.length}</p>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">Total Jadwal</p>
                </div>
            </div>

            {/* Open / Available exams */}
            {openExams.length > 0 && (
                <section className="space-y-4">
                    <div className="flex items-center gap-2 px-1">
                        <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
                        <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest">Tersedia Sekarang</h3>
                    </div>
                    <div className="space-y-3">
                        {openExams.map((exam) => {
                            return (
                                <motion.div
                                    key={exam.id}
                                    whileHover={{ x: 4, y: -2 }}
                                    className="p-5 bg-white border border-slate-100 rounded-2xl flex flex-col md:flex-row items-center justify-between gap-4 group cursor-pointer transition-all shadow-sm hover:shadow-lg relative overflow-hidden"
                                    role="link" tabIndex={0}
                                    onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.click(); }}
                                    onClick={() => { const time = clock.current ? clock.current.time + performance.now() - clock.current.tick : NaN; if (scheduleState(exam, time) === 'open' && !inFlight.current) router.push(`/dashboard/siswa/exam/${exam.id}`); else void loadData(); }}
                                >
                                    <div className="absolute left-0 top-0 h-full w-1 bg-emerald-500" />
                                    
                                    <div className="flex items-center gap-4 flex-1 w-full min-w-0 pl-1.5">
                                        <div className="w-12 h-12 bg-emerald-50 border border-emerald-100 rounded-xl flex items-center justify-center shrink-0 group-hover:bg-[#3083FF] group-hover:border-[#3083FF] transition-all text-emerald-600 group-hover:text-white">
                                            <Clock size={18} />
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <div className="flex flex-wrap items-center gap-2 mb-1">
                                                <h3 className="font-bold text-slate-800 text-base truncate group-hover:text-[#3083FF] transition-colors">{exam.title}</h3>
                                                {exam.exam_type && exam.exam_type !== 'daily' && (
                                                    <span className="px-2.5 py-0.5 bg-violet-50 text-violet-600 text-[9px] font-bold uppercase rounded-md border border-violet-100/50">{examTypeLabel(exam.exam_type)}</span>
                                                )}
                                            </div>
                                            <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 font-medium font-sans">
                                                <span className="flex items-center gap-1">
                                                    <Clock size={12} className="text-slate-400" /> {formatTimeRange(exam.start_time, exam.end_time)}
                                                </span>
                                                <span className="flex items-center gap-1 text-[#3083FF] font-bold bg-blue-50 px-2 py-0.5 rounded-lg border border-blue-100/30">
                                                    <RefreshCw size={11} /> {exam.duration_minutes || 60} menit
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="w-full md:w-auto">
                                        <div className="bg-[#3083FF] text-white font-bold text-xs px-5 py-2.5 rounded-xl flex items-center justify-center gap-1.5 shadow-md shadow-[#3083FF]/10 group-hover:bg-[#2563EB] group-hover:shadow-lg group-hover:shadow-[#3083FF]/20 transition-all active:scale-95">
                                            {exam.isInProgress ? 'Lanjutkan Ujian' : 'Kerjakan'} <ArrowRight size={14} />
                                        </div>
                                    </div>
                                </motion.div>
                            );
                        })}
                    </div>
                </section>
            )}

            {/* Upcoming */}
            {upcomingExams.length > 0 && (
                <section className="space-y-4">
                    <div className="flex items-center gap-2 px-1">
                        <div className="w-2 h-2 bg-blue-500 rounded-full" />
                        <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest">Akan Datang</h3>
                    </div>
                    <div className="space-y-3">
                        {upcomingExams.map((exam) => {
                            const until = formatTimeUntil(exam.start_time || '');
                            return (
                                <div key={exam.id}
                                    className="p-5 bg-white border border-slate-100 rounded-2xl flex flex-col md:flex-row items-center justify-between gap-4 relative overflow-hidden shadow-sm opacity-80"
                                >
                                    <div className="absolute left-0 top-0 h-full w-1 bg-blue-400" />
                                    
                                    <div className="flex items-center gap-4 flex-1 w-full min-w-0 pl-1.5">
                                        <div className="w-12 h-12 bg-blue-50 border border-blue-100 rounded-xl flex items-center justify-center shrink-0 text-blue-500">
                                            <CalendarDays size={18} />
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <div className="flex flex-wrap items-center gap-2 mb-1">
                                                <h3 className="font-bold text-slate-800 text-base truncate">{exam.title}</h3>
                                                {exam.exam_type && exam.exam_type !== 'daily' && (
                                                    <span className="px-2.5 py-0.5 bg-violet-50 text-violet-600 text-[9px] font-bold uppercase rounded-md border border-violet-100/50">{examTypeLabel(exam.exam_type)}</span>
                                                )}
                                            </div>
                                            <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 font-medium font-sans">
                                                <span className="flex items-center gap-1">
                                                    <CalendarDays size={12} className="text-slate-400" /> {formatDay(exam.start_time)}
                                                </span>
                                                <span className="flex items-center gap-1">
                                                    <Clock size={12} className="text-slate-400" /> {formatTimeRange(exam.start_time, exam.end_time)}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="w-full md:w-auto text-right">
                                        <div className="text-blue-600 font-bold text-xs px-4 py-2 bg-blue-50 border border-blue-100 rounded-xl inline-flex items-center gap-1.5">
                                            <Clock size={13} /> {until}
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </section>
            )}

            {/* Completed */}
            {closedExams.length > 0 && (
                <section className="space-y-4">
                    <div className="flex items-center gap-2 px-1">
                        <CheckCircle2 size={14} className="text-slate-400" />
                        <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest">Selesai / Waktu Habis</h3>
                    </div>
                    <div className="space-y-3">
                        {closedExams.slice(0, historyLimit).map((exam) => {
                            const status = getStatus(exam);
                            const Icon = status.icon || CheckCircle2;
                            return (
                                <div key={exam.id}
                                    className="p-4 bg-white border border-slate-100 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-all hover:border-slate-200 relative overflow-hidden shadow-sm"
                                >
                                    <div className="absolute left-0 top-0 h-full w-1 bg-slate-300" />
                                    
                                    <div className="flex items-center gap-4 flex-1 w-full min-w-0 pl-1.5">
                                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border ${status.bg} ${status.color}`}>
                                            <Icon size={16} />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <h3 className="font-bold text-slate-700 text-sm truncate mb-0.5">{exam.title}</h3>
                                            <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400 font-sans">
                                                <span className="flex items-center gap-1">
                                                    <CalendarDays size={12} className="text-slate-300" /> {formatDay(exam.start_time)}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="shrink-0 mt-2 sm:mt-0">
                                        <span className={`px-3 py-1.5 rounded-lg text-[9px] font-bold uppercase tracking-wider border inline-flex items-center gap-1.5 ${status.bg} ${status.color}`}>
                                            <Icon size={11} />
                                            {status.label}
                                        </span>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </section>
            )}

            {closedExams.length > historyLimit && <button onClick={() => setHistoryLimit(value => value + 10)} className="rounded-lg border px-4 py-2 text-sm">Tampilkan riwayat lainnya</button>}
            {/* Empty state */}
            {loading ? (
                <div className="p-16 bg-white border border-slate-100 rounded-2xl shadow-sm flex flex-col items-center justify-center space-y-3">
                    <Spinner variant="buble" size={32} />
                    <p className="text-slate-400 font-bold text-xs tracking-wider uppercase font-sans">Memuat jadwal ujian...</p>
                </div>
            ) : loadError ? (
                <div role="alert" className="p-10 bg-rose-50 border border-rose-200 rounded-2xl text-center max-w-xl mx-auto w-full flex flex-col items-center">
                    <div className="w-16 h-16 bg-white rounded-2xl flex items-center justify-center mb-4 border border-rose-100">
                        <AlertCircle size={28} className="text-rose-500" />
                    </div>
                    <h3 className="text-lg font-bold text-slate-700 mb-1">Jadwal Belum Dapat Dimuat</h3>
                    <p className="text-slate-600 text-sm max-w-sm mb-5">{loadError}</p>
                    <button type="button" onClick={loadData}
                        className="px-5 py-2.5 bg-[#3083FF] text-white rounded-xl font-bold text-xs hover:bg-[#2563EB] flex items-center gap-2 transition-all">
                        <RefreshCw size={13} /> Coba Lagi
                    </button>
                </div>
            ) : exams.length === 0 ? (
                <div className="p-16 bg-white border border-dashed border-slate-200 rounded-2xl shadow-sm text-center max-w-xl mx-auto w-full flex flex-col items-center">
                    <div className="w-16 h-16 bg-slate-50 rounded-2xl flex items-center justify-center mb-4 border border-slate-100">
                        <Ghost size={28} className="text-slate-300" />
                    </div>
                    <h3 className="text-lg font-bold text-slate-700 mb-1">Belum Ada Jadwal Ujian</h3>
                    <p className="text-slate-500 text-sm max-w-sm mb-0">Tidak ada jadwal ujian untuk saat ini. Hubungi proktor jika ada kesalahan.</p>
                </div>
            ) : null}

            {/* Refresh button */}
            <div className="flex justify-center">
                <button onClick={loadData}
                    className="px-5 py-2.5 bg-white border border-slate-200 text-slate-500 rounded-xl font-bold text-xs hover:bg-slate-50 flex items-center gap-2 transition-all shadow-sm active:scale-95">
                    <RefreshCw size={13} className={loading ? "animate-spin" : ""} /> Perbarui Jadwal
                </button>
            </div>
        </div>
    );
};

export default SchedulePage;
