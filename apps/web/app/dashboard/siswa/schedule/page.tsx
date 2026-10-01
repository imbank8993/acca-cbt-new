"use client";
import { Spinner } from '@/app/components/ui/Spinner';
import { getStudentExamsResult,type StudentScheduledExam } from '@/lib/api/students';
import { formatSchoolDate,formatSchoolTimeRange } from '@/lib/school-time';
import { useSchoolTimeZone } from '@/lib/useSchoolTimeZone';
import { getSessionUser } from '@/lib/session';
import { REFRESH_INTERVAL,useAutoRefresh } from '@/lib/useAutoRefresh';
import { useMemoryState } from '@/lib/useMemoryState';
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
import { useCallback,useEffect,useState } from 'react';

const SchedulePage = () => {
    const { timeZone, error: timeZoneError } = useSchoolTimeZone();
    const [exams, setExams] = useMemoryState<StudentScheduledExam[]>('siswa_schedule_exams', []);
    const [loading, setLoading] = useMemoryState('siswa_schedule_loading', true);
    const [now, setNow] = useState(new Date());
    const [loadError, setLoadError] = useState('');
    const router = useRouter();

    const loadData = useCallback(async () => {
        setLoading(true);
        setLoadError('');
        const user = await getSessionUser();
        if (user) {
            const response = await getStudentExamsResult();
            if (response.success) setExams(response.exams);
            else setLoadError(response.error || 'Jadwal ujian tidak dapat dimuat.');
        } else {
            setLoadError('Sesi berakhir. Silakan login kembali.');
        }
        setLoading(false);
    }, [setExams, setLoading]);

    useEffect(() => {
        const initialLoad = window.setTimeout(() => void loadData(), 0);
        // Jam dinding diperbarui tiap menit supaya hitung mundur tetap akurat.
        const interval = setInterval(() => setNow(new Date()), 60000);
        return () => {
            window.clearTimeout(initialLoad);
            clearInterval(interval);
        };
    }, [loadData]);

    // Jadwal ujian disegarkan berkala; langganan realtime Supabase sudah tidak ada.
    useAutoRefresh(loadData, REFRESH_INTERVAL.dashboard);

    const getStatus = (exam: StudentScheduledExam) => {
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

    const formatTimeUntil = (dateStr: string) => {
        if (!dateStr) return '';
        const diff = new Date(dateStr).getTime() - now.getTime();
        if (diff <= 0) return '';
        const days = Math.floor(diff / (1000 * 60 * 60 * 24));
        const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        if (days > 0) return `${days}h ${hours}m lagi`;
        if (hours > 0) return `${hours}j ${minutes}m lagi`;
        return `${minutes}m lagi`;
    };

    const isOpenNow = (exam: StudentScheduledExam) => exam.is_published && !exam.isCompleted &&
        (!exam.start_time || now >= new Date(exam.start_time)) &&
        (!exam.end_time || now <= new Date(exam.end_time));

    // Sort exams: yang benar-benar sedang terbuka lebih dulu, lalu waktu mulai.
    const sortedExams = [...exams].sort((a, b) => {
        const aOpen = isOpenNow(a);
        const bOpen = isOpenNow(b);
        if (aOpen && !bOpen) return -1;
        if (!aOpen && bOpen) return 1;
        const aStart = a.start_time ? new Date(a.start_time).getTime() : Infinity;
        const bStart = b.start_time ? new Date(b.start_time).getTime() : Infinity;
        return aStart - bStart;
    });

    const openExams = sortedExams.filter(isOpenNow);
    const upcomingExams = sortedExams.filter(e => e.is_published && !e.isCompleted && e.start_time && now < new Date(e.start_time));
    const closedExams = sortedExams.filter(e => e.isCompleted || (e.is_published && e.end_time && now > new Date(e.end_time)));
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
                                    onClick={() => router.push(`/dashboard/siswa/exam/${exam.id}`)}
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
                                                    <span className="px-2.5 py-0.5 bg-violet-50 text-violet-600 text-[9px] font-bold uppercase rounded-md border border-violet-100/50">{exam.exam_type}</span>
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
                                            Kerjakan <ArrowRight size={14} />
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
                                                    <span className="px-2.5 py-0.5 bg-violet-50 text-violet-600 text-[9px] font-bold uppercase rounded-md border border-violet-100/50">{exam.exam_type}</span>
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
                        {closedExams.slice(0, 10).map((exam) => {
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
