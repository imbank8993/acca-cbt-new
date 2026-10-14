'use client';

import { getTopScorers, type ExamTopScorers } from '@/lib/api/proctor';
import { formatStudentName, getScoreColorClass } from '@/lib/monitoring-health';
import { ChevronLeft, ChevronRight, Medal, Trophy, Users } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

const REFRESH_MS = 60_000;
const EXAMS_PER_PAGE = 3;

/** Gaya peringkat 1 (emas), 2 (perak), dan 3 (perunggu). */
const RANK_STYLE: Record<number, { badge: string; row: string }> = {
    1: {
        badge: 'bg-amber-100 text-amber-600 border-amber-200',
        row: 'bg-amber-50/50 border-amber-100/80',
    },
    2: {
        badge: 'bg-slate-100 text-slate-500 border-slate-200',
        row: 'bg-slate-50/60 border-slate-100',
    },
    3: {
        badge: 'bg-orange-100 text-orange-600 border-orange-200',
        row: 'bg-orange-50/40 border-orange-100/80',
    },
};

const formatScore = (n: number) =>
    n.toLocaleString('id-ID', { maximumFractionDigits: 2 });

/**
 * Kartu ringkas 3 peraih nilai tertinggi per ujian untuk kolom kanan dasbor.
 */
export function TopScorersCard({
    examLimit = 12,
    monitoringBasePath = '/dashboard/admin/monitoring',
}: {
    examLimit?: number;
    monitoringBasePath?: string;
}) {
    const router = useRouter();
    const [exams, setExams] = useState<ExamTopScorers[]>([]);
    const [loading, setLoading] = useState(true);
    const [page, setPage] = useState(0);

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
        let active = true;
        void Promise.resolve().then(() => { if (active) return load(); });
        const id = setInterval(() => {
            if (document.visibilityState === 'visible') void load();
        }, REFRESH_MS);
        return () => { active = false; clearInterval(id); };
    }, [load]);

    const totalPages = Math.max(1, Math.ceil(exams.length / EXAMS_PER_PAGE));
    const safePage = Math.min(page, totalPages - 1);
    const visibleExams = exams.slice(
        safePage * EXAMS_PER_PAGE,
        (safePage + 1) * EXAMS_PER_PAGE,
    );

    return (
        <div className="bg-white rounded-lg border border-[#3083FF]/30 overflow-hidden shadow-sm">
            <div className="px-5 py-4 border-b border-[#3083FF]/20 bg-gradient-to-r from-[#3083FF]/[.02] to-transparent flex items-center justify-between gap-2">
                <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                    <Trophy size={16} className="text-amber-500 shrink-0" />
                    <span className="truncate">Nilai Tertinggi per Ujian</span>
                </h2>

                {exams.length > EXAMS_PER_PAGE && (
                    <div className="flex items-center gap-1 shrink-0">
                        <span className="text-[11px] font-medium text-slate-400 mr-1 tabular-nums">
                            {safePage + 1}/{totalPages}
                        </span>
                        <button
                            type="button"
                            onClick={() => setPage((p) => Math.max(0, p - 1))}
                            disabled={safePage === 0}
                            aria-label="Sebelumnya"
                            className="w-6 h-6 rounded-md border border-slate-200 flex items-center justify-center text-slate-500 hover:text-[#3083FF] hover:border-[#3083FF]/40 disabled:opacity-35 disabled:pointer-events-none transition-colors"
                        >
                            <ChevronLeft size={13} />
                        </button>
                        <button
                            type="button"
                            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                            disabled={safePage >= totalPages - 1}
                            aria-label="Berikutnya"
                            className="w-6 h-6 rounded-md border border-slate-200 flex items-center justify-center text-slate-500 hover:text-[#3083FF] hover:border-[#3083FF]/40 disabled:opacity-35 disabled:pointer-events-none transition-colors"
                        >
                            <ChevronRight size={13} />
                        </button>
                    </div>
                )}
            </div>

            {loading ? (
                <div className="p-4 space-y-3">
                    {Array.from({ length: 3 }).map((_, i) => (
                        <div key={i} className="h-28 rounded-lg bg-slate-100 animate-pulse" />
                    ))}
                </div>
            ) : exams.length === 0 ? (
                <div className="py-12 text-center">
                    <div className="w-12 h-12 bg-amber-50 rounded-full flex items-center justify-center mx-auto mb-3">
                        <Trophy size={20} className="text-amber-300" />
                    </div>
                    <p className="text-xs text-slate-500">Belum ada ujian yang selesai dinilai</p>
                </div>
            ) : (
                <div className="divide-y divide-slate-100">
                    {visibleExams.map((exam) => (
                        <button
                            key={exam.examId}
                            type="button"
                            onClick={() => router.push(`${monitoringBasePath}?exam=${exam.examId}`)}
                            className="w-full group text-left px-5 py-3.5 hover:bg-slate-50/70 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#3083FF]"
                        >
                            {/* Header ujian */}
                            <div className="flex items-center justify-between gap-2 mb-2">
                                <p className="text-xs font-bold text-slate-800 truncate group-hover:text-[#3083FF] transition-colors">
                                    {exam.title}
                                </p>
                                <span className="shrink-0 inline-flex items-center gap-1 text-[10px] font-medium text-slate-400">
                                    <Users size={11} />
                                    {exam.participantCount}
                                </span>
                            </div>

                            <p className="mb-2 text-[10px] text-slate-500">{exam.scoreLabel || 'Klasikal'}{exam.scoredCount < exam.participantCount ? ` · ${exam.scoredCount}/${exam.participantCount} peserta dinilai` : ''}</p>
                            {exam.topScorers.length === 0 && <p className="text-xs text-slate-500">{exam.scoreLabel?.startsWith('IRT') ? 'Menunggu perhitungan IRT' : 'Menunggu penilaian'}</p>}

                            {/* 3 siswa teratas (nama saja tanpa NISN) */}
                            <div className="space-y-1">
                                {exam.topScorers.map((s) => {
                                    const style = RANK_STYLE[s.rank] ?? RANK_STYLE[3];
                                    return (
                                        <div
                                            key={s.userId}
                                            className={`flex items-center gap-2 rounded-md border px-2.5 py-1 ${style.row}`}
                                        >
                                            <span className={`w-5 h-5 shrink-0 rounded-full border flex items-center justify-center ${style.badge}`}>
                                                {s.rank === 1
                                                    ? <Trophy size={10} />
                                                    : <Medal size={10} />}
                                            </span>
                                            <p className="flex-1 min-w-0 text-xs font-medium text-slate-700 truncate">
                                                {formatStudentName(s.fullName, 'Tanpa Nama')}
                                            </p>
                                            <span className={`text-xs font-bold tabular-nums ${getScoreColorClass(s.score)}`}>
                                                {formatScore(s.score)}
                                            </span>
                                        </div>
                                    );
                                })}
                            </div>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

