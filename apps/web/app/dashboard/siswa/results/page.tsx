"use client";
import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Award, BookOpen, Clock, Loader2, RefreshCw, ChevronRight, Sparkles } from 'lucide-react';
import { getStudentResultsAction } from '@/lib/api/students';
import { getSessionUser } from '@/lib/session';
import { useRouter } from 'next/navigation';
import { useMemoryState } from '@/lib/useMemoryState';

export default function StudentResultsPage() {
    const [results, setResults] = useMemoryState<any[]>('siswa_results_results', []);
    const [isLoading, setIsLoading] = useMemoryState('siswa_results_isLoading', true);
    const [fullName, setFullName] = useState<string>('');
    const router = useRouter();

    const loadResults = async () => {
        setIsLoading(true);
        const user = await getSessionUser();
        if (user) {
            setResults(await getStudentResultsAction());
            setFullName(user.fullName ?? '');
        }
        setIsLoading(false);
    };

    useEffect(() => {
        loadResults();
    }, []);

    const formatUTCDateTime = (str: string | null | undefined) => {
        if (!str) return '-';
        const date = new Date(str.match(/(Z|[+-]\d{2}:\d{2})$/) ? str : str + 'Z');
        if (isNaN(date.getTime())) return '-';
        const day = String(date.getUTCDate()).padStart(2, '0');
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
        const month = months[date.getUTCMonth()];
        const year = date.getUTCFullYear();
        const h = String(date.getUTCHours()).padStart(2, '0');
        const m = String(date.getUTCMinutes()).padStart(2, '0');
        return `${day} ${month} ${year} ${h}:${m}`;
    };

    return (
        <div className="max-w-7xl mx-auto pb-24 space-y-6 animate-in fade-in duration-700">
            {/* ── Hero Header — Compact acca-hero-gradient ── */}
            <div className="relative overflow-hidden rounded-2xl acca-hero-gradient shadow-xl shadow-[#0038A8]/15 mt-4 md:mt-0 p-6 md:p-8">
                {/* Decorative Glowing Orbs */}
                <div className="absolute -top-12 -right-12 w-72 h-72 bg-white/10 rounded-full blur-3xl pointer-events-none" />
                <div className="absolute -bottom-12 -left-12 w-56 h-56 bg-white/5 rounded-full blur-2xl pointer-events-none" />

                <div className="relative flex flex-col md:flex-row md:items-center md:justify-between gap-5 z-10">
                    <div className="space-y-2">
                        <h1 className="text-2xl md:text-3xl font-extrabold text-white tracking-tight leading-tight">
                            Halo, <span className="text-amber-200">{fullName || 'Siswa'}</span>! 👋
                        </h1>
                        <p className="text-white/80 text-xs md:text-sm max-w-xl font-medium leading-relaxed">
                            Berikut adalah rekapitulasi performa dan nilai hasil ujian belajar Anda.
                        </p>
                    </div>

                    <div className="flex items-center gap-3 self-start md:self-center shrink-0">
                        {/* Compact Stat Badge */}
                        <div className="flex items-center gap-2 bg-white/10 backdrop-blur-md px-3.5 py-2.5 rounded-xl border border-white/15 shadow-lg">
                            <span className="text-xs font-bold text-white/95">Ujian Selesai:</span>
                            <span className="text-base font-black text-white font-mono bg-white/20 px-2 py-0.5 rounded-lg leading-none">{results.length}</span>
                        </div>
                        
                        <button
                            onClick={loadResults}
                            className="flex items-center gap-1.5 bg-white/10 hover:bg-white/20 border border-white/20 text-white px-4 py-2.5 rounded-xl font-bold text-xs transition-all shadow-sm active:scale-95 shrink-0"
                        >
                            <RefreshCw size={14} className={isLoading ? "animate-spin" : ""} />
                            Muat Ulang
                        </button>
                    </div>
                </div>
            </div>

            {isLoading ? (
                <div className="flex flex-col items-center justify-center py-24 space-y-3">
                    <Loader2 size={36} className="text-[#0038A8] animate-spin" />
                    <p className="text-slate-400 font-bold text-xs tracking-wider uppercase font-sans">Memuat hasil studi...</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    {results.map((attempt) => {
                        const canViewDetails = attempt.exams?.show_results && !attempt.needs_manual_grading;

                        return (
                            <motion.div
                                layout
                                key={attempt.id}
                                onClick={() => canViewDetails ? router.push(`/dashboard/siswa/results/${attempt.id}`) : null}
                                className={`bg-white border border-slate-100 rounded-2xl p-5 flex flex-col sm:flex-row gap-4 transition-all duration-300 group relative overflow-hidden shadow-sm ${
                                    canViewDetails 
                                        ? 'cursor-pointer hover:border-indigo-100 hover:shadow-xl hover:shadow-[#030C4D]/5' 
                                        : 'opacity-90'
                                }`}
                            >
                                <div className={`absolute top-0 left-0 w-1 h-full bg-slate-200 transition-colors ${canViewDetails ? 'group-hover:bg-[#0038A8]' : ''}`}></div>

                                <div className="flex items-start gap-4 flex-1 pl-1 min-w-0">
                                    <div className="w-10 h-10 bg-indigo-50 border border-indigo-100/50 rounded-xl flex items-center justify-center shrink-0 group-hover:bg-[#0038A8] group-hover:border-[#0038A8] transition-colors text-indigo-600 group-hover:text-white">
                                        <BookOpen size={18} />
                                    </div>
                                    <div className="space-y-1 min-w-0 flex-1">
                                        <div className="flex flex-wrap items-center gap-1.5 mb-1">
                                            <span className="px-2 py-0.5 rounded-md text-[9px] font-bold bg-emerald-50 text-emerald-600 border border-emerald-100 flex items-center gap-1 leading-none">
                                                SELESAI
                                            </span>
                                            {attempt.needs_manual_grading && (
                                                <span className="px-2 py-0.5 rounded-md text-[9px] font-bold bg-amber-50 text-amber-600 border border-amber-100 leading-none">
                                                    MENUNGGU PENILAIAN
                                                </span>
                                            )}
                                        </div>
                                        <h3 className="font-bold text-slate-800 text-sm group-hover:text-[#0038A8] transition-colors line-clamp-2 leading-snug">
                                            {attempt.exams?.title || 'Ujian Tidak Diketahui'}
                                        </h3>
                                        <p className="text-xs text-slate-400 flex items-center gap-1 font-medium font-sans">
                                            <Clock size={12} className="text-slate-300" />
                                            {formatUTCDateTime(attempt.finished_at)}
                                        </p>
                                    </div>
                                </div>

                                <div className="shrink-0 flex items-center justify-between sm:justify-start gap-4 border-t sm:border-t-0 sm:border-l border-slate-100 pt-3.5 sm:pt-0 sm:pl-4 mt-2 sm:mt-0">
                                    {attempt.exams?.show_results !== false && (
                                        <div className="flex items-center gap-4">
                                            <div className="text-center min-w-[70px]">
                                                <p className={`text-[8px] font-extrabold uppercase tracking-widest mb-0.5 ${attempt.needs_manual_grading ? 'text-amber-600' : 'text-slate-400'}`}>
                                                    {attempt.needs_manual_grading ? 'Nilai Sementara' : 'Klasik'}
                                                </p>
                                                <div className="flex items-baseline justify-center gap-0.5">
                                                    <span className="text-xl font-black text-[#0038A8] font-mono">{Number(attempt.total_score ?? 0).toFixed(0)}</span>
                                                    <span className="text-[9px] font-bold text-slate-400">/100</span>
                                                </div>
                                                {attempt.needs_manual_grading && (
                                                    <p className="text-[8px] font-semibold text-amber-600 mt-0.5 leading-none whitespace-nowrap">Uraian pending</p>
                                                )}
                                            </div>
                                            {attempt.score_irt != null && (
                                                <div className="text-center border-l border-slate-100 pl-4 min-w-[60px]">
                                                    <p className="text-[8px] font-extrabold text-slate-400 uppercase tracking-widest mb-0.5">IRT</p>
                                                    <div className="flex items-baseline justify-center gap-0.5">
                                                        <span className="text-xl font-black text-[#030C4D] font-mono">{Number(attempt.score_irt).toFixed(2)}</span>
                                                        <span className="text-[9px] font-bold text-slate-400">/100</span>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                    {canViewDetails && (
                                        <div className="w-8 h-8 rounded-full bg-slate-50 border border-slate-200 flex items-center justify-center group-hover:bg-[#0038A8] group-hover:border-[#0038A8] transition-colors shrink-0">
                                            <ChevronRight size={16} className="text-slate-400 group-hover:text-white transition-colors" />
                                        </div>
                                    )}
                                </div>
                            </motion.div>
                        )
                    })}

                    {results.length === 0 && (
                        <div className="col-span-full py-20 px-6 text-center bg-white border border-dashed border-slate-200 rounded-2xl max-w-xl mx-auto w-full flex flex-col items-center">
                            <div className="w-16 h-16 bg-slate-50 rounded-2xl flex items-center justify-center mb-4 border border-slate-100">
                                <Award size={28} className="text-slate-300" />
                            </div>
                            <h3 className="text-lg font-bold text-slate-700 mb-1">Belum Ada Hasil Ujian</h3>
                            <p className="text-slate-500 text-sm max-w-sm mb-0">Anda belum menyelesaikan ujian apapun. Hasil ujian akan muncul di sini setelah Anda mengumpulkannya.</p>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
