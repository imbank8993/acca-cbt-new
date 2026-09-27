"use client";
import { Spinner } from '@/app/components/ui/Spinner';
import React, { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
    Ghost,
    Award,
    ArrowRight,
    Clock,
    Sparkles,
    Loader2,
    CheckCircle2,
    BookOpen,
    TrendingUp,
    ChevronRight,
    Timer,
    FileText,
    Zap,
    Eye,
    AlertCircle
} from 'lucide-react';
import { REFRESH_INTERVAL, useAutoRefresh } from '@/lib/useAutoRefresh';
import { getSessionUser } from '@/lib/session';
import { getStudentExams, getStudentResultsAction } from '@/lib/api/students';
import { getSetting, pickAnnouncements, type Announcement } from '@/lib/api/settings';
import { useRouter } from 'next/navigation';
import { useMemoryState } from '@/lib/useMemoryState';
import { linkifyText } from '@/lib/text-format';

export default function SiswaDashboard() {
    const [exams, setExams] = useMemoryState<any[]>('siswa_exams', []);
    const [results, setResults] = useMemoryState<any[]>('siswa_results', []);
    const [loading, setLoading] = useMemoryState('siswa_loading', true);
    const [user, setUser] = useState<any>(null);
    const [fullName, setFullName] = useState<string>('');
    const [announcements, setAnnouncements] = useMemoryState<any[]>('siswa_announcements', []);
    const router = useRouter();

    const loadData = useCallback(async () => {
        setLoading(true);
        const user = await getSessionUser();
        if (!user) {
            router.replace('/');
            return;
        }
        setUser(user);

        const [ex, res, announcementConfig] = await Promise.all([
            getStudentExams(),
            getStudentResultsAction(),
            getSetting<Announcement | Announcement[]>('announcement_config'),
        ]);

        setExams(ex);
        setResults(res);
        setFullName(user.fullName ?? '');
        setAnnouncements(pickAnnouncements(announcementConfig, 'show_siswa'));
        setLoading(false);
    }, [router]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    // Jadwal dan hasil disegarkan berkala. Dulu keduanya didorong langganan
    // realtime Supabase yang menyebut tabel `exams` dan `exam_attempts` — nama
    // sebelum seluruh tabel CBT diberi awalan `cbt_`, jadi langganan itu sudah
    // tidak menerima apa pun bahkan sebelum Supabase ditinggalkan.
    useAutoRefresh(loadData, REFRESH_INTERVAL.dashboard);



    const getDayNum = (dateStr: string | null | undefined) => {
        if (!dateStr) return '--';
        try {
            const date = new Date(dateStr.match(/(Z|[+-]\d{2}:\d{2})$/) ? dateStr : dateStr + 'Z');
            if (isNaN(date.getTime())) return '--';
            const wibDate = new Date(date.getTime() + (7 * 60 * 60 * 1000));
            return wibDate.getUTCDate().toString();
        } catch (e) {
            console.error('getDayNum error:', e);
            return '--';
        }
    };

    const getMonthName = (dateStr: string | null | undefined) => {
        if (!dateStr) return 'TBA';
        try {
            const date = new Date(dateStr.match(/(Z|[+-]\d{2}:\d{2})$/) ? dateStr : dateStr + 'Z');
            if (isNaN(date.getTime())) return 'TBA';
            const wibDate = new Date(date.getTime() + (7 * 60 * 60 * 1000));
            const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
            return months[wibDate.getUTCMonth()].toUpperCase();
        } catch (e) {
            console.error('getMonthName error:', e);
            return 'TBA';
        }
    };

    const formatTime = (startStr: string | null | undefined, endStr: string | null | undefined) => {
        if (!startStr) return '--:-- WIB';
        try {
            const s = new Date(startStr.match(/(Z|[+-]\d{2}:\d{2})$/) ? startStr : startStr + 'Z');
            const e = endStr ? new Date(endStr.match(/(Z|[+-]\d{2}:\d{2})$/) ? endStr : endStr + 'Z') : null;
            if (isNaN(s.getTime())) return '--:-- WIB';
            
            const sWib = new Date(s.getTime() + (7 * 60 * 60 * 1000));
            const eWib = e && !isNaN(e.getTime()) ? new Date(e.getTime() + (7 * 60 * 60 * 1000)) : null;

            const sH = String(sWib.getUTCHours()).padStart(2, '0');
            const sM = String(sWib.getUTCMinutes()).padStart(2, '0');
            const eH = eWib ? String(eWib.getUTCHours()).padStart(2, '0') : '..';
            const eM = eWib ? String(eWib.getUTCMinutes()).padStart(2, '0') : '..';
            return `${sH}:${sM} - ${eH}:${eM} WIB`;
        } catch (e) {
            console.error('formatTime error:', e);
            return '--:-- WIB';
        }
    };

    const averageScore = results.length > 0 
        ? Math.round(results.reduce((acc, r) => acc + (Number(r.total_score) || 0), 0) / results.length) 
        : 0;

    const completedExamsCount = results.filter(r => r.status === 'submitted' || r.status === 'auto_submitted').length;


    const renderExamCard = (exam: any, i: number) => {
        const isReady = exam.status === 'active' || exam.status === 'draft' || exam.status === 'scheduled';
        const isCompleted = exam.isCompleted;
        return (
            <div
                key={exam.id || i}
                className="p-4 bg-white border border-slate-100 hover:border-indigo-100/80 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-all duration-300 relative overflow-hidden group shadow-sm hover:shadow-md"
            >
                <div className={`absolute left-0 top-0 h-full w-1 ${isCompleted ? 'bg-slate-300' : isReady ? 'bg-emerald-500' : 'bg-blue-400'}`} />
                
                <div className="flex items-center gap-3.5 flex-1 pl-1 min-w-0 text-left">
                    {/* Date Badge */}
                    <div className="w-10 h-10 bg-indigo-50 border border-indigo-100/30 rounded-xl flex flex-col items-center justify-center shrink-0 group-hover:bg-[#3083FF] group-hover:border-[#3083FF] transition-colors text-indigo-600 group-hover:text-white">
                        {getDayNum(exam.start_time) === '--' ? (
                            <Zap size={16} />
                        ) : (
                            <>
                                <p className="text-sm font-bold leading-none">{getDayNum(exam.start_time)}</p>
                                <p className="text-[8px] font-bold uppercase mt-0.5 opacity-80">{getMonthName(exam.start_time)}</p>
                            </>
                        )}
                    </div>

                    <div className="space-y-1 min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5 mb-0.5">
                            {isCompleted ? (
                                <span className="px-2 py-0.5 rounded-md text-[9px] font-bold bg-slate-100 text-slate-500 border border-slate-200 leading-none">
                                    Selesai
                                </span>
                            ) : isReady ? (
                                <span className="px-2 py-0.5 rounded-md text-[9px] font-bold bg-emerald-50 text-emerald-600 border border-emerald-100 flex items-center gap-1 leading-none">
                                    <span className="w-1 h-1 rounded-full bg-emerald-500 animate-pulse"></span>
                                    Aktif
                                </span>
                            ) : (
                                <span className="px-2 py-0.5 rounded-md text-[9px] font-bold bg-blue-50 text-blue-600 border border-blue-100 leading-none">
                                    {exam.status}
                                </span>
                            )}
                            <span className="px-2 py-0.5 rounded-md text-[9px] font-bold bg-blue-50 text-[#3083FF] border border-blue-100/30 flex items-center gap-1 leading-none">
                                <Timer size={10} />
                                {exam.duration_minutes} Menit
                            </span>
                        </div>

                        <h3 className="font-bold text-slate-800 text-sm group-hover:text-[#3083FF] transition-colors line-clamp-1 leading-snug">{exam.title}</h3>
                        
                        <p className="text-xs text-slate-400 flex items-center gap-1.5 font-sans font-medium">
                            <Clock size={12} className="text-slate-300" />
                            {formatTime(exam.start_time, exam.end_time) === '--:-- WIB' ? 'Waktu Fleksibel' : formatTime(exam.start_time, exam.end_time)}
                        </p>
                    </div>
                </div>

                <div className="shrink-0 mt-2 sm:mt-0 z-10 pl-1">
                    {isCompleted ? (
                        <button
                            onClick={() => router.push('/dashboard/siswa/results')}
                            className="w-full sm:w-auto bg-slate-50 hover:bg-emerald-50 text-slate-600 hover:text-emerald-700 border border-slate-200 hover:border-emerald-200 text-[10px] font-bold px-3.5 py-1.5 rounded-xl flex items-center justify-center gap-1.5 transition-all active:scale-95"
                        >
                            Hasil <CheckCircle2 size={12} className="text-emerald-500" />
                        </button>
                    ) : isReady ? (
                        <button
                            onClick={() => router.push(`/dashboard/siswa/exam/${exam.id}`)}
                            className="w-full sm:w-auto bg-[#3083FF] hover:bg-[#2563EB] text-white text-[10px] font-bold px-3.5 py-1.5 rounded-xl flex items-center justify-center gap-1.5 transition-colors shadow-sm active:scale-95"
                        >
                            Mulai <ArrowRight size={12} />
                        </button>
                    ) : (
                        <div className="text-[9px] font-bold text-slate-400 uppercase px-2.5 py-1 bg-slate-50 rounded-lg border border-slate-100">{exam.status}</div>
                    )}
                </div>
            </div>
        );
    };

    return (
        <div className="max-w-7xl mx-auto pb-24 space-y-6">

            {announcements.length > 0 && (
                <div className="space-y-4">
                    {announcements.map((ann, idx) => (
                        <div key={ann.id || idx} className="bg-blue-50/50 border border-blue-200/60 rounded-2xl p-4 flex items-start gap-4">
                            <div className="bg-blue-100/80 text-blue-600 p-2 rounded-xl mt-0.5 shrink-0">
                                <AlertCircle size={18} />
                            </div>
                            <div className="text-left">
                                <h3 className="font-bold text-blue-900 mb-0.5 text-sm">{ann.title}</h3>
                                <p className="text-xs md:text-sm text-blue-800 whitespace-pre-wrap leading-relaxed font-sans font-medium" dangerouslySetInnerHTML={{ __html: linkifyText(ann.content) }}></p>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* ── Stats Grid ── */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Rata-rata Nilai */}
                <div className="bg-white border border-slate-100 rounded-2xl p-5 hover:shadow-xl hover:shadow-[#3083FF]/5 transition-all duration-300 relative overflow-hidden flex items-center justify-between gap-4">
                    <div className="absolute left-0 top-0 h-full w-1.5 bg-[#3083FF]" />
                    <div className="flex items-center gap-3.5">
                        <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center text-[#3083FF] border border-indigo-100/50">
                            <Award size={18} />
                        </div>
                        <div className="text-left">
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest leading-none mb-1.5">Rata-Rata Nilai</p>
                            <p className="text-2xl font-black text-slate-800 leading-none font-mono">
                                {averageScore}
                                <span className="text-xs text-slate-400 font-normal ml-1">/100</span>
                            </p>
                        </div>
                    </div>
                </div>

                {/* Ujian Selesai */}
                <div className="bg-white border border-slate-100 rounded-2xl p-5 hover:shadow-xl hover:shadow-[#3083FF]/5 transition-all duration-300 relative overflow-hidden flex items-center justify-between gap-4">
                    <div className="absolute left-0 top-0 h-full w-1.5 bg-emerald-500" />
                    <div className="flex items-center gap-3.5">
                        <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center text-emerald-600 border border-emerald-100/50">
                            <CheckCircle2 size={18} />
                        </div>
                        <div className="text-left">
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest leading-none mb-1.5">Ujian Selesai</p>
                            <p className="text-2xl font-black text-slate-800 leading-none font-mono">{completedExamsCount}</p>
                        </div>
                    </div>
                </div>
            </div>

            {/* ── Layout: Ujian dan Riwayat ── */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* ── Left: Exam List ── */}
                <div className="space-y-4">
                    <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden shadow-sm">
                        <div className="px-5 py-4 border-b border-slate-100 flex justify-between items-center gap-4">
                            <div className="text-left">
                                <h2 className="text-base font-bold text-slate-800 flex items-center gap-2">
                                    <BookOpen size={16} className="text-[#3083FF]" />
                                    Ujian Sekolah Anda
                                </h2>
                                <p className="text-xs text-slate-400 mt-0.5">Ujian aktif dan terjadwal dari sekolah</p>
                            </div>
                            <button 
                                onClick={() => router.push('/dashboard/siswa/schedule')} 
                                className="inline-flex items-center gap-1 px-3 py-1.5 bg-blue-50 hover:bg-[#3083FF] text-[#3083FF] hover:text-white text-[10px] font-bold rounded-xl transition-all active:scale-95 shrink-0 font-sans"
                            >
                                <span className="w-1 h-1 bg-[#3083FF] rounded-full animate-pulse group-hover:bg-white"></span>
                                Jadwal Anda
                            </button>
                        </div>

                        <div className="p-4 space-y-3">
                            {loading ? (
                                <div className="py-12 flex flex-col items-center justify-center gap-3">
                                    <Spinner variant="buble" size={32} />
                                    <p className="text-xs text-slate-400 font-bold uppercase tracking-wider">Memuat daftar ujian...</p>
                                </div>
                            ) : exams.length === 0 ? (
                                <div className="py-12 text-center border border-dashed border-slate-200 rounded-2xl">
                                    <Ghost size={28} className="text-slate-300 mx-auto mb-3" />
                                    <p className="text-sm font-bold text-slate-700">Belum Ada Ujian</p>
                                    <p className="text-xs text-slate-400 mt-1">Tidak ada ujian terjadwal saat ini.</p>
                                </div>
                            ) : (
                                exams.map((exam, i) => renderExamCard(exam, i))
                            )}
                        </div>
                    </div>
                </div>

                {/* ── Right: Riwayat Nilai ── */}
                <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden shadow-sm flex flex-col">
                    <div className="px-5 py-4 border-b border-slate-100 text-left">
                        <h2 className="text-base font-bold text-slate-800 flex items-center gap-2">
                            <TrendingUp size={16} className="text-[#3083FF]" />
                            Riwayat Nilai
                        </h2>
                        <p className="text-xs text-slate-400 mt-0.5">Performa ujian terakhir Anda</p>
                    </div>
                    <div className="p-5 flex-1 flex flex-col justify-between">
                        <div className="space-y-4">
                            {results.length === 0 ? (
                                <div className="text-center py-12 flex flex-col items-center justify-center h-full">
                                    <FileText size={24} className="text-slate-300 mx-auto mb-2" />
                                    <p className="text-xs text-slate-400 font-medium">Belum ada ujian diselesaikan.</p>
                                </div>
                            ) : (
                                results.slice(0, 4).map((res, i) => {
                                    const score = Number(res.total_score) || 0;
                                    const barColorClass = score >= 80 ? 'bg-emerald-500' : score >= 65 ? 'bg-[#3083FF]' : 'bg-rose-500';
                                    const textColorClass = score >= 80 ? 'text-emerald-600' : score >= 65 ? 'text-[#3083FF]' : 'text-rose-600';

                                    return (
                                        <div key={res.id || i} className="space-y-1.5 text-left">
                                            <div className="flex justify-between items-start">
                                                <p className="font-semibold text-slate-700 text-xs truncate pr-2 leading-none">{res.exams?.title || 'Ujian'}</p>
                                                <p className="text-[10px] text-slate-400 shrink-0 leading-none">
                                                    <span className={`text-xs font-black font-mono ${textColorClass}`}>{score.toFixed(0)}</span>/100
                                                </p>
                                            </div>
                                            <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                                                <div className={`h-full rounded-full ${barColorClass}`} style={{ width: `${Math.min(100, Math.max(0, score))}%` }}></div>
                                            </div>
                                        </div>
                                    );
                                })
                            )}
                        </div>
                        
                        <button 
                            onClick={() => router.push('/dashboard/siswa/results')} 
                            className="w-full text-center text-xs font-bold text-[#3083FF] hover:text-[#2563EB] pt-4 mt-6 border-t border-slate-100 flex items-center justify-center gap-1 group transition-colors active:scale-[0.98]"
                        >
                            Laporan Lengkap
                            <ChevronRight size={13} className="group-hover:translate-x-0.5 transition-transform" />
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
