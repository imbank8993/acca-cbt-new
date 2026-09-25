"use client";
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
                    <div className="w-10 h-10 bg-indigo-50 border border-indigo-100/30 rounded-xl flex flex-col items-center justify-center shrink-0 group-hover:bg-[#0038A8] group-hover:border-[#0038A8] transition-colors text-indigo-600 group-hover:text-white">
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
                            <span className="px-2 py-0.5 rounded-md text-[9px] font-bold bg-blue-50 text-[#0038A8] border border-blue-100/30 flex items-center gap-1 leading-none">
                                <Timer size={10} />
                                {exam.duration_minutes} Menit
                            </span>
                        </div>

                        <h3 className="font-bold text-slate-800 text-sm group-hover:text-[#0038A8] transition-colors line-clamp-1 leading-snug">{exam.title}</h3>
                        
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
                            className="w-full sm:w-auto bg-[#0038A8] hover:bg-[#020510] text-white text-[10px] font-bold px-3.5 py-1.5 rounded-xl flex items-center justify-center gap-1.5 transition-colors shadow-sm active:scale-95"
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
        );
}
