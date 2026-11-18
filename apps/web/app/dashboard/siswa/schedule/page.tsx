"use client";
import { Spinner } from '@/app/components/ui/Spinner';
import { getStudentExamsResult,type StudentScheduledExam } from '@/lib/api/students';
import { formatSchoolDate,formatSchoolDateTime,formatSchoolTimeRange } from '@/lib/school-time';
import { useSchoolTimeZone } from '@/lib/useSchoolTimeZone';
import { getSessionUser } from '@/lib/session';
import { examTypeLabel } from '@/lib/exam-types';
import { recoveryActive, recoveryLabel, scheduleState, scheduleCountdown } from '@/lib/student-schedule';
import { motion } from 'framer-motion';
import { StudentExamCover, SubjectPill } from '@/app/components/student/StudentExamCover';
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

    // Tidak disegarkan otomatis: daftar sempat berkedip menjadi "Memuat…" tiap 30 detik.
    // Hitung mundur dan perpindahan "akan datang" → "tersedia" tetap berjalan dari jam
    // server yang dicatat saat halaman dibuka; data baru dimuat saat halaman dibuka lagi.

    const getStatus = (exam: StudentScheduledExam) => {
        if (scheduleState(exam, now.getTime()) === 'invalid') return { label: 'Jadwal tidak valid', color: '', bg: 'bg-rose-50 text-rose-600 border-rose-100 dark:bg-rose-500/10 dark:text-rose-300 dark:border-rose-500/20', icon: AlertCircle, enabled: false };
        if (exam.status === 'archived') return { label: 'Diarsipkan', color: '', bg: 'bg-slate-50 text-slate-500 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700', icon: Lock, enabled: false };
        // Must be published
        if (!exam.is_published) {
            return { label: 'Belum Publikasi', color: '', bg: 'bg-slate-50 text-slate-500 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700', icon: Lock, enabled: false };
        }

        // Check if completed
        if (exam.isCompleted) {
            return { label: 'Selesai', color: '', bg: 'bg-emerald-50 text-emerald-700 border-emerald-100 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/20', icon: CheckCircle2, enabled: false };
        }

        const startTime = exam.start_time ? new Date(exam.start_time) : null;
        const endTime = exam.end_time ? new Date(exam.end_time) : null;
        const isBeforeStart = startTime && now < startTime;
        const isAfterEnd = endTime && now > endTime;

        // Window not yet open
        if (isBeforeStart) {
            return { label: 'Belum Mulai', color: '', bg: 'bg-sky-50 text-sky-700 border-sky-100 dark:bg-sky-500/10 dark:text-sky-300 dark:border-sky-500/20', icon: Clock, enabled: false };
        }

        // Window closed
        if (isAfterEnd) {
            return { label: 'Waktu Habis', color: '', bg: 'bg-rose-50 text-rose-600 border-rose-100 dark:bg-rose-500/10 dark:text-rose-300 dark:border-rose-500/20', icon: AlertCircle, enabled: false };
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
    // Kartu ringkasan harus berjumlah sama dengan Total Jadwal: ujian yang sudah
    // ditutup tetapi tidak dikerjakan (waktu habis, diarsipkan, jadwal tidak
    // valid) dulu tidak punya kartu sehingga totalnya tampak tidak cocok.
    const completedCount = sortedExams.filter(e => e.isCompleted).length;
    const missedCount = closedExams.length - completedCount;
    return (
        <div className="max-w-7xl mx-auto pb-24 space-y-6">
            {timeZoneError && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{timeZoneError}</div>}

            {/* Ringkasan: kartu bergradasi seperti kartu "Nilai akhir" di halaman hasil. */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4">
                {([
                    { label: 'Tersedia', value: openExams.length, tone: 'from-emerald-500 via-teal-500 to-cyan-500 shadow-teal-500/20' },
                    { label: 'Akan Datang', value: upcomingExams.length, tone: 'from-blue-500 via-indigo-500 to-violet-500 shadow-indigo-500/20' },
                    { label: 'Selesai', value: completedCount, tone: 'from-violet-500 via-purple-500 to-fuchsia-500 shadow-fuchsia-500/20' },
                    { label: 'Tidak Dikerjakan', value: missedCount, tone: 'from-amber-400 via-orange-500 to-rose-500 shadow-orange-500/20' },
                    { label: 'Total Jadwal', value: sortedExams.length, tone: 'from-sky-500 via-blue-500 to-indigo-500 shadow-blue-500/20' },
                ] as const).map(stat => (
                    <div key={stat.label} className={`relative overflow-hidden rounded-2xl bg-gradient-to-br p-4 sm:p-5 text-white shadow-md ${stat.tone} ${stat.label === 'Total Jadwal' ? 'col-span-2 sm:col-span-1' : ''}`}>
                        <div aria-hidden="true" className="pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full bg-white/10" />
                        <p className="text-xs sm:text-sm font-medium text-white/85">{stat.label}</p>
                        <p className="mt-2 text-3xl sm:text-4xl font-bold tracking-tight tabular-nums">{loadError ? '—' : stat.value}</p>
                    </div>
                ))}
            </div>

            {/* Open / Available exams */}
            {openExams.length > 0 && (
                <section className="space-y-4">
                    <div className="flex items-center gap-2 px-1">
                        <div className="w-2 h-2 bg-[#6B9FE8] rounded-full animate-pulse" />
                        <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest">Tersedia Sekarang</h3>
                    </div>
                    <div className="space-y-3">
                        {openExams.map((exam) => {
                            return (
                                <motion.div
                                    key={exam.id}
                                    whileHover={{ x: 4, y: -2 }}
                                    className="p-4 sm:p-5 rounded-2xl border border-slate-100 bg-white shadow-sm transition-all dark:border-slate-800 dark:bg-slate-900/70 flex flex-col md:flex-row items-center justify-between gap-4 group cursor-pointer hover:shadow-lg hover:border-sky-200 dark:hover:border-sky-500/40 relative overflow-hidden"
                                    role="link" tabIndex={0}
                                    onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.click(); }}
                                    onClick={() => { const time = clock.current ? clock.current.time + performance.now() - clock.current.tick : NaN; if (scheduleState(exam, time) === 'open' && !inFlight.current) router.push(`/dashboard/siswa/exam/${exam.id}`); else void loadData(); }}
                                >
                                    <div className="flex items-center gap-4 flex-1 w-full min-w-0">
                                        <StudentExamCover cover={exam.cover_url} title={exam.title} subject={exam.subject} />
                                        <div className="min-w-0 flex-1">
                                            <div className="flex flex-wrap items-center gap-2 mb-1">
                                                <h3 className="font-bold text-slate-800 dark:text-slate-100 text-base truncate group-hover:text-[#3083FF] transition-colors">{exam.title}</h3>
                                                <SubjectPill subject={exam.subject} />
                                                {exam.exam_type && exam.exam_type !== 'daily' && (
                                                    <span className="px-2.5 py-0.5 bg-violet-50 text-violet-600 text-[9px] font-bold uppercase rounded-md border border-violet-100/50">{examTypeLabel(exam.exam_type)}</span>
                                                )}
                                            </div>
                                            <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 font-medium font-sans">
                                                {recoveryActive(exam, now.getTime()) ? (
                                                    <span className="flex items-center gap-1 rounded-lg border border-amber-200 bg-amber-50 px-2 py-0.5 font-bold text-amber-700">
                                                        <Clock size={12} /> {recoveryLabel(exam).badge}: {recoveryLabel(exam).action.toLowerCase()} sebelum {formatSchoolDateTime(exam.recoveryUntil, timeZone)}
                                                    </span>
                                                ) : (
                                                    <span className="flex items-center gap-1">
                                                        <Clock size={12} className="text-slate-400" /> {formatTimeRange(exam.start_time, exam.end_time)}
                                                    </span>
                                                )}
                                                <span className="flex items-center gap-1 text-[#3083FF] font-bold bg-blue-50 px-2 py-0.5 rounded-lg border border-blue-100/30">
                                                    <RefreshCw size={11} /> {exam.duration_minutes || 60} menit
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="w-full md:w-auto">
                                        <div className="bg-[#3083FF] text-white font-bold text-xs px-5 py-2.5 rounded-xl flex items-center justify-center gap-1.5 shadow-md shadow-[#3083FF]/10 group-hover:bg-[#2563EB] group-hover:shadow-lg group-hover:shadow-[#3083FF]/20 transition-all active:scale-95">
                                            {recoveryActive(exam, now.getTime()) ? recoveryLabel(exam).button : exam.isInProgress ? 'Lanjutkan Ujian' : 'Kerjakan'} <ArrowRight size={14} />
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
                                    className="p-4 sm:p-5 rounded-2xl border border-slate-100 bg-white shadow-sm transition-all dark:border-slate-800 dark:bg-slate-900/70 flex flex-col md:flex-row items-center justify-between gap-4 relative overflow-hidden"
                                >
                                    <div className="flex items-center gap-4 flex-1 w-full min-w-0">
                                        <StudentExamCover cover={exam.cover_url} title={exam.title} subject={exam.subject} />
                                        <div className="min-w-0 flex-1">
                                            <div className="flex flex-wrap items-center gap-2 mb-1">
                                                <h3 className="font-bold text-slate-800 dark:text-slate-100 text-base truncate">{exam.title}</h3>
                                                <SubjectPill subject={exam.subject} />
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
                                        <div className="font-bold text-xs px-4 py-2 border rounded-full inline-flex items-center gap-1.5 bg-sky-50 text-sky-700 border-sky-100 dark:bg-sky-500/10 dark:text-sky-300 dark:border-sky-500/20">
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
                                    className="p-4 rounded-2xl border border-slate-100 bg-white shadow-sm transition-all dark:border-slate-800 dark:bg-slate-900/70 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:border-slate-200 dark:hover:border-slate-700 relative overflow-hidden"
                                >
                                    <div className="flex items-center gap-4 flex-1 w-full min-w-0">
                                        <StudentExamCover cover={exam.cover_url} title={exam.title} subject={exam.subject} size={44} />
                                        <div className="flex-1 min-w-0">
                                            <div className="flex flex-wrap items-center gap-2 mb-0.5">
                                                <h3 className="font-bold text-slate-700 dark:text-slate-200 text-sm truncate">{exam.title}</h3>
                                                <SubjectPill subject={exam.subject} />
                                            </div>
                                            <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400 font-sans">
                                                <span className="flex items-center gap-1">
                                                    <CalendarDays size={12} className="text-slate-300" /> {formatDay(exam.start_time)}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="shrink-0 mt-2 sm:mt-0">
                                        <span className={`px-3 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-wider border inline-flex items-center gap-1.5 ${status.bg} ${status.color}`}>
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

            {closedExams.length > historyLimit && <button onClick={() => setHistoryLimit(value => value + 10)} className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">Tampilkan riwayat lainnya</button>}
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

        </div>
    );
};

export default SchedulePage;
