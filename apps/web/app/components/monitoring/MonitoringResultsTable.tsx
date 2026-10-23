'use client';

import { Fragment, useState } from 'react';
import { ChevronDown, Eye } from 'lucide-react';
import type { ExamAttemptRecord } from '@/lib/api/proctor';
import { formatStudentName, getScoreColorClass } from '@/lib/monitoring-health';
import { monitoringScoreModels } from '@/lib/monitoring-score-models';
import { savedAnswerCount } from '@/lib/monitoring-answer-count';
import { ParticipantRoomInfo } from './ParticipantRoomInfo';

export function MonitoringResultsTable({ attempts, hasAnyAttempts, onViewDetails, showRoomInfo = false }: {
    attempts: ExamAttemptRecord[];
    hasAnyAttempts: boolean;
    onViewDetails: (id: string) => void;
    showRoomInfo?: boolean;
}) {
    const [expandedId, setExpandedId] = useState<string | null>(null);

    return <div className="overflow-x-auto">
        <table className="w-full min-w-[700px] text-left text-sm">
            <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                    <th scope="col" className="px-4 py-3">Peserta</th>
                    <th scope="col" className="px-4 py-3">Status</th>
                    <th scope="col" className="px-4 py-3 text-center">Soal</th>
                    <th scope="col" className="px-4 py-3 text-right">Skor</th>
                    <th scope="col" className="px-4 py-3 text-center">Peringatan</th>
                    <th scope="col" className="px-4 py-3 text-right">Aksi</th>
                </tr>
            </thead>
            <tbody>
                {attempts.length === 0 ? <tr><td colSpan={6} className="px-4 py-12 text-center text-sm text-slate-500">
                    {hasAnyAttempts ? 'Belum ada peserta yang selesai atau cocok dengan filter.' : 'Belum ada data.'}
                </td></tr> : attempts.map(att => {
                    const isUnstarted = att.status === 'belum';
                    const isAutoSubmitted = att.status === 'auto_submitted';
                    const warningCount = att.warning_count ?? 0;
                    const scoreModels = monitoringScoreModels(att);
                    const classicalModel = scoreModels.find(model => model.type === 'classical');
                    const score = isUnstarted ? null : classicalModel?.score ?? null;
                    const expanded = expandedId === att.id;
                    const answered = savedAnswerCount(att);
                    const total = typeof att.total_questions === 'number' && Number.isSafeInteger(att.total_questions) && att.total_questions >= 0
                        ? att.total_questions : null;
                    const durationMinutes = att.started_at && att.finished_at
                        ? Math.max(0, Math.floor((new Date(att.finished_at).getTime() - new Date(att.started_at).getTime()) / 60000))
                        : null;
                    const breakdown = att.violation_breakdown || { pindah_tab: att.tab_switch_count ?? 0, close_tab: 0, lainnya: 0 };
                    const extraIrtScores = [
                        { type: 'irt_1pl', label: 'IRT 1PL', score: att.detailed_scores?.irt_1pl },
                        { type: 'irt_2pl', label: 'IRT 2PL', score: att.detailed_scores?.irt_2pl },
                        { type: 'irt_3pl', label: 'IRT 3PL', score: att.detailed_scores?.irt_3pl },
                    ].filter(item => item.score != null && !scoreModels.some(model => model.type === item.type));
                    if (att.score_irt != null && !scoreModels.some(model => model.type.startsWith('irt')) && extraIrtScores.length === 0) {
                        extraIrtScores.push({ type: 'irt', label: 'Skor IRT', score: att.score_irt });
                    }
                    return <Fragment key={att.id}>
                        <tr className="border-b border-slate-100 transition-colors hover:bg-slate-50">
                            <td className="px-4 py-3">
                                <span className="font-semibold text-slate-800">{formatStudentName(att.profiles?.full_name, 'Tanpa Nama')}</span>
                                <span className="mt-0.5 block text-xs text-slate-500">{att.kelas_name || 'Tanpa kelas'}</span>
                                {showRoomInfo && <ParticipantRoomInfo attempt={att} />}
                            </td>
                            <td className="px-4 py-3">
                                <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${isAutoSubmitted ? 'bg-rose-50 text-rose-700' : att.status === 'submitted' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                                    {isAutoSubmitted ? 'Ditutup otomatis' : att.status === 'submitted' ? 'Selesai' : isUnstarted ? 'Belum mulai' : 'Mengerjakan'}
                                </span>
                            </td>
                            <td className="whitespace-nowrap px-4 py-3 text-center font-medium tabular-nums text-slate-700" title="Jumlah soal yang dijawab dan tersimpan di server dibanding total soal">
                                {answered ?? '—'}<span className="text-slate-400">/{total ?? '—'}</span>
                            </td>
                            <td className={`px-4 py-3 text-right font-semibold tabular-nums ${getScoreColorClass(score)}`}>{score === null ? isUnstarted ? '—' : classicalModel?.pendingLabel ?? 'Menunggu nilai' : score.toFixed(2)}</td>
                            <td className={`px-4 py-3 text-center font-medium tabular-nums ${warningCount > 0 ? 'text-amber-700' : 'text-slate-400'}`}>{warningCount > 0 ? warningCount : '—'}</td>
                            <td className="px-4 py-3">
                                <div className="flex items-center justify-end gap-2">
                                    <button type="button" onClick={() => setExpandedId(expanded ? null : att.id)} aria-expanded={expanded} aria-controls={expanded ? `result-detail-${att.id}` : undefined} className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
                                        Rincian <ChevronDown size={14} className={expanded ? 'rotate-180' : ''} />
                                    </button>
                                    <button type="button" onClick={() => onViewDetails(att.id)} disabled={isUnstarted} aria-label={`Lihat detail ${formatStudentName(att.profiles?.full_name, 'peserta')}`} className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2">
                                        <Eye size={14} /> Detail
                                    </button>
                                </div>
                            </td>
                        </tr>
                        {expanded && <tr id={`result-detail-${att.id}`} className="border-b border-slate-200 bg-slate-50/70"><td colSpan={6} className="px-4 py-4">
                            <dl className="grid gap-x-8 gap-y-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
                                <div><dt className="text-slate-500">Durasi</dt><dd className="mt-1 font-semibold text-slate-800">{durationMinutes === null ? '—' : `${Math.floor(durationMinutes / 60)}j ${durationMinutes % 60}m`}</dd></div>
                                <div><dt className="text-slate-500">Mulai</dt><dd className="mt-1 font-semibold text-slate-800">{att.started_at ? new Date(att.started_at).toLocaleString('id-ID') : '—'}</dd></div>
                                <div><dt className="text-slate-500">Selesai</dt><dd className="mt-1 font-semibold text-slate-800">{att.finished_at ? new Date(att.finished_at).toLocaleString('id-ID') : '—'}</dd></div>
                                <div><dt className="text-slate-500">Jenis peringatan</dt><dd className="mt-1 font-semibold text-slate-800">Tab {breakdown.pindah_tab} · Tutup {breakdown.close_tab} · Lainnya {breakdown.lainnya}</dd></div>
                            </dl>
                            <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 border-t border-slate-200 pt-3 text-xs">
                                {scoreModels.map(model => <span key={model.type} className="text-slate-600">{model.label}: <strong className="text-slate-800">{model.score === null ? model.pendingLabel : model.score.toFixed(2)}</strong></span>)}
                                {extraIrtScores.map(item => <span key={item.type} className="text-slate-600">{item.label}: <strong className="text-slate-800">{Number(item.score).toFixed(2)}</strong></span>)}
                            </div>
                        </td></tr>}
                    </Fragment>;
                })}
            </tbody>
        </table>
    </div>;
}
