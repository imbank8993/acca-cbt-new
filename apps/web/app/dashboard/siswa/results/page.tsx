"use client";
import { getStudentResultsResult,type StudentResult } from '@/lib/api/students';
import { formatSchoolDateTime } from '@/lib/school-time';
import { useSchoolTimeZone } from '@/lib/useSchoolTimeZone';
import { getSessionUser } from '@/lib/session';
import { useMemoryState } from '@/lib/useMemoryState';
import { motion } from 'framer-motion';
import { Award,BookOpen,ChevronRight,Clock,Loader2,RefreshCw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback,useEffect,useState } from 'react';

export default function StudentResultsPage() {
    const { timeZone, error: timeZoneError } = useSchoolTimeZone();
    const [results, setResults] = useMemoryState<StudentResult[]>('siswa_results_results', []);
    const [isLoading, setIsLoading] = useMemoryState('siswa_results_isLoading', true);
    const [, setFullName] = useState<string>('');
    const [loadError, setLoadError] = useState('');
    const router = useRouter();

    const loadResults = useCallback(async () => {
        setIsLoading(true);
        setLoadError('');
        const user = await getSessionUser();
        if (user) {
            const response = await getStudentResultsResult();
            if (response.success) setResults(response.results);
            else setLoadError(response.error || 'Hasil ujian tidak dapat dimuat.');
            setFullName(user.fullName ?? '');
        } else {
            setLoadError('Sesi berakhir. Silakan login kembali.');
        }
        setIsLoading(false);
    }, [setFullName, setIsLoading, setResults]);

    useEffect(() => {
        const timer = window.setTimeout(() => void loadResults(), 0);
        return () => window.clearTimeout(timer);
    }, [loadResults]);

    return (
        <div className="max-w-7xl mx-auto pb-24 space-y-6 animate-in fade-in duration-700">
            {timeZoneError && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{timeZoneError}</div>}
            {/* Top Stat & Refresh Bar */}
            <div className="flex items-center justify-between gap-4 bg-white border border-slate-200 rounded-2xl p-4 shadow-xs">
                <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-600">Total Ujian Selesai:</span>
                    <span className="text-base font-black text-[#3083FF] font-mono bg-blue-50 border border-blue-100 px-2.5 py-0.5 rounded-lg leading-none">{results.length}</span>
                </div>
                <button
                    onClick={loadResults}
                    className="flex items-center gap-1.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-700 px-3.5 py-2 rounded-xl font-bold text-xs transition-all shadow-xs active:scale-95 shrink-0"
                >
                    <RefreshCw size={14} className={isLoading ? "animate-spin" : ""} />
                    Muat Ulang
                </button>
            </div>

            {isLoading ? (
                <div className="flex flex-col items-center justify-center py-24 space-y-3">
                    <Loader2 size={36} className="text-[#3083FF] animate-spin" />
                    <p className="text-slate-400 font-bold text-xs tracking-wider uppercase font-sans">Memuat hasil studi...</p>
                </div>
            ) : loadError ? (
                <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-8 text-center">
                    <p className="font-bold text-red-700">Hasil ujian gagal dimuat</p>
                    <p className="mt-1 text-sm text-red-600">{loadError}</p>
                    <button type="button" onClick={loadResults} className="mt-4 px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-semibold">Coba Lagi</button>
                </div>
            ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    {results.map((attempt) => {
                        const canViewDetails = attempt.exams?.show_results === true;

                        return (
                            <motion.button
                                type="button"
                                layout
                                key={attempt.id}
                                disabled={!canViewDetails}
                                aria-label={canViewDetails ? `Buka hasil ${attempt.exams?.title || 'ujian'}` : undefined}
                                onClick={() => canViewDetails ? router.push(`/dashboard/siswa/results/${attempt.id}`) : null}
                                className={`w-full text-left bg-white border border-slate-100 rounded-2xl p-5 flex flex-col sm:flex-row gap-4 transition-all duration-300 group relative overflow-hidden shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3083FF] focus-visible:ring-offset-2 ${
                                    canViewDetails 
                                        ? 'cursor-pointer hover:border-indigo-100 hover:shadow-xl hover:shadow-[#3083FF]/5' 
                                        : 'opacity-90'
                                }`}
                            >
                                <div className={`absolute top-0 left-0 w-1 h-full bg-slate-200 transition-colors ${canViewDetails ? 'group-hover:bg-[#3083FF]' : ''}`}></div>

                                <div className="flex items-start gap-4 flex-1 pl-1 min-w-0">
                                    <div className="w-10 h-10 bg-indigo-50 border border-indigo-100/50 rounded-xl flex items-center justify-center shrink-0 group-hover:bg-[#3083FF] group-hover:border-[#3083FF] transition-colors text-indigo-600 group-hover:text-white">
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
                                            {!canViewDetails && (
                                                <span className="px-2 py-0.5 rounded-md text-[9px] font-bold bg-slate-100 text-slate-600 border border-slate-200 leading-none">
                                                    NILAI BELUM DIBUKA GURU
                                                </span>
                                            )}
                                        </div>
                                        <h3 className="font-bold text-slate-800 text-sm group-hover:text-[#3083FF] transition-colors line-clamp-2 leading-snug">
                                            {attempt.exams?.title || 'Ujian Tidak Diketahui'}
                                        </h3>
                                        <p className="text-xs text-slate-400 flex items-center gap-1 font-medium font-sans">
                                            <Clock size={12} className="text-slate-300" />
                                            {formatSchoolDateTime(attempt.finished_at, timeZone)}
                                        </p>
                                    </div>
                                </div>

                                <div className="shrink-0 flex items-center justify-between sm:justify-start gap-4 border-t sm:border-t-0 sm:border-l border-slate-100 pt-3.5 sm:pt-0 sm:pl-4 mt-2 sm:mt-0">
                                    {attempt.exams?.show_results === true && (
                                        <div className="flex items-center gap-4">
                                            <div className="text-center min-w-[70px]">
                                                <p className={`text-[8px] font-extrabold uppercase tracking-widest mb-0.5 ${attempt.needs_manual_grading ? 'text-amber-600' : 'text-slate-400'}`}>
                                                    {attempt.total_score == null ? 'Menunggu Penilaian' : attempt.needs_manual_grading ? 'Nilai Sementara' : 'Klasik'}
                                                </p>
                                                <div className="flex items-baseline justify-center gap-0.5">
                                                    <span className="text-xl font-black text-[#3083FF] font-mono">{attempt.total_score == null ? '—' : Number(attempt.total_score).toFixed(0)}</span>
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
                                                        <span className="text-xl font-black text-[#3083FF] font-mono">{Number(attempt.score_irt).toFixed(2)}</span>
                                                        <span className="text-[9px] font-bold text-slate-400">/100</span>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                    {canViewDetails && (
                                        <div className="w-8 h-8 rounded-full bg-slate-50 border border-slate-200 flex items-center justify-center group-hover:bg-[#3083FF] group-hover:border-[#3083FF] transition-colors shrink-0">
                                            <ChevronRight size={16} className="text-slate-400 group-hover:text-white transition-colors" />
                                        </div>
                                    )}
                                </div>
                            </motion.button>
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
