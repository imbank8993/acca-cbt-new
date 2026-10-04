'use client';

import { getTopScorers, type ExamTopScorers } from '@/lib/api/proctor';
import { examTypeLabel } from '@/lib/exam-types';
import { Medal, Trophy, Users } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

const REFRESH_MS = 60_000;

/** Gaya peringkat 1 (emas) dan 2 (perak). */
const RANK_STYLE: Record<number, { badge: string; ring: string; score: string }> = {
    1: {
        badge: 'bg-amber-100 text-amber-600 border-amber-200',
        ring: 'bg-amber-50/60 border-amber-100',
        score: 'text-amber-600',
    },
    2: {
        badge: 'bg-slate-100 text-slate-500 border-slate-200',
        ring: 'bg-slate-50/60 border-slate-100',
        score: 'text-slate-600',
    },
};

const formatScore = (n: number) =>
    n.toLocaleString('id-ID', { maximumFractionDigits: 2 });

/**
 * Ringkasan dua peraih nilai tertinggi per ujian.
 *
 * Memuat datanya sendiri (bukan lewat `loadData` dasbor) supaya kegagalan di
 * sini tidak menggagalkan seluruh dasbor, dan supaya penyegarannya bisa lebih
 * jarang dari kartu lain.
 */
export function TopScorersCard({ examLimit = 6 }: { examLimit?: number }) {
    const router = useRouter();
    const [exams, setExams] = useState<ExamTopScorers[]>([]);
    const [loading, setLoading] = useState(true);

    const load = useCallback(async () => {
        try {
            setExams(await getTopScorers(examLimit));
        } catch {
            setExams([]);
        } finally {
            setLoading(false);
        }
    }, [examLimit]);

    useEffect(() => {
        void load();
        const id = setInterval(() => {
            if (document.visibilityState === 'visible') void load();
        }, REFRESH_MS);
        return () => clearInterval(id);
    }, [load]);

    return (
        <div className="bg-white rounded-lg border border-[#3083FF]/30 overflow-hidden shadow-sm">
            <div className="px-6 py-4 border-b border-[#3083FF]/20 bg-gradient-to-r from-[#3083FF]/[.02] to-transparent flex items-center justify-between">
                <div>
                    <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                        <Trophy size={16} className="text-amber-500" /> Nilai Tertinggi per Ujian
                    </h2>
                    <p className="text-xs text-slate-400 mt-0.5">
                        2 siswa teratas dari ujian yang paling baru dikerjakan
                    </p>
                </div>
            </div>

            {loading ? (
                <div className="p-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                    {Array.from({ length: 3 }).map((_, i) => (
                        <div key={i} className="h-32 rounded-lg bg-slate-100 animate-pulse" />
                    ))}
                </div>
            ) : exams.length === 0 ? (
                <div className="py-10 text-center">
                    <div className="w-12 h-12 bg-amber-50 rounded-full flex items-center justify-center mx-auto mb-3">
                        <Trophy size={20} className="text-amber-300" />
                    </div>
                    <p className="text-xs text-slate-500">Belum ada ujian yang selesai dinilai</p>
                </div>
            ) : (
                <div className="p-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                    {exams.map((exam) => (
                        <button
                            key={exam.examId}
                            type="button"
                            onClick={() => router.push('/dashboard/admin/monitoring?exam=' + exam.examId)}
                            className="group text-left rounded-lg border border-slate-200 hover:border-[#3083FF]/50 hover:shadow-md hover:shadow-[#3083FF]/5 transition-all p-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3083FF]"
                        >
                            {/* Judul ujian */}
                            <div className="flex items-start justify-between gap-2 mb-2.5">
                                <p className="text-sm font-semibold text-slate-800 line-clamp-1 group-hover:text-[#3083FF] transition-colors">
                                    {exam.title}
                                </p>
                                {exam.examType && exam.examType !== 'daily' && (
                                    <span className="shrink-0 text-[10px] text-[#3083FF] font-bold bg-[#3083FF]/10 px-1.5 py-0.5 rounded">
                                        {examTypeLabel(exam.examType)}
                                    </span>
                                )}
                            </div>

                            {/* Dua teratas */}
                            <div className="space-y-1.5">
                                {exam.topScorers.map((s) => {
                                    const style = RANK_STYLE[s.rank] ?? RANK_STYLE[2];
                                    return (
                                        <div
                                            key={s.userId}
                                            className={`flex items-center gap-2.5 rounded-md border px-2.5 py-1.5 ${style.ring}`}
                                        >
                                            <span className={`w-6 h-6 shrink-0 rounded-full border flex items-center justify-center ${style.badge}`}>
                                                {s.rank === 1
                                                    ? <Trophy size={12} />
                                                    : <Medal size={12} />}
                                            </span>
                                            <div className="flex-1 min-w-0">
                                                <p className="text-xs font-semibold text-slate-800 truncate">{s.fullName}</p>
                                                {s.identityNumber && (
                                                    <p className="text-[10px] text-slate-400 truncate">{s.identityNumber}</p>
                                                )}
                                            </div>
                                            <span className={`text-sm font-extrabold tabular-nums ${style.score}`}>
                                                {formatScore(s.score)}
                                            </span>
                                        </div>
                                    );
                                })}
                                {exam.topScorers.length < 2 && (
                                    <p className="text-[10px] text-slate-400 px-1">Baru 1 siswa yang selesai dinilai</p>
                                )}
                            </div>

                            {/* Kaki */}
                            <div className="flex items-center justify-between mt-2.5 text-[10px] text-slate-400">
                                <span className="inline-flex items-center gap-1">
                                    <Users size={10} /> {exam.participantCount} siswa dinilai
                                </span>
                                {exam.lastFinishedAt && (
                                    <span>
                                        {new Date(exam.lastFinishedAt).toLocaleDateString('id-ID', {
                                            day: 'numeric', month: 'short', year: 'numeric',
                                        })}
                                    </span>
                                )}
                            </div>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
