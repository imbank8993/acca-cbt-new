'use client';

import { Fragment, useState } from 'react';
import { ChevronDown, Eye, FileSpreadsheet, RotateCcw } from 'lucide-react';
import { Modal, ModalBody, ModalFooter, ModalHeader } from '@/app/components/ui/modal';
import { Button } from '@/app/components/ui/button';
import type { ExamAttemptRecord } from '@/lib/api/proctor';
import { formatStudentName, getScoreColorClass } from '@/lib/monitoring-health';
import { monitoringScoreModels } from '@/lib/monitoring-score-models';
import { savedAnswerCount } from '@/lib/monitoring-answer-count';
import { ParticipantRoomInfo } from './ParticipantRoomInfo';
import { hasThetaIrtScale } from '@acca-cbt/shared';

function getAttemptResultFacts(att: ExamAttemptRecord) {
    const isUnstarted = att.status === 'belum';
    const isAutoSubmitted = att.status === 'auto_submitted';
    const warningCount = att.warning_count ?? 0;
    const scoreModels = monitoringScoreModels(att);
    const classicalModel = scoreModels.find(model => model.type === 'classical');
    const score = isUnstarted ? null : classicalModel?.score ?? null;
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
    ].filter(item => hasThetaIrtScale(att) && item.score != null && !scoreModels.some(model => model.type === item.type));
    if (hasThetaIrtScale(att) && att.score_irt != null && !scoreModels.some(model => model.type.startsWith('irt')) && extraIrtScores.length === 0) {
        extraIrtScores.push({ type: 'irt', label: 'Skor IRT', score: att.score_irt });
    }
    const irtScores = ['submitted', 'auto_submitted'].includes(att.status)
        ? [...scoreModels.filter(model => model.type.startsWith('irt')), ...extraIrtScores]
            .filter(model => model.score != null && Number.isFinite(Number(model.score)))
        : [];
    const statusText = isAutoSubmitted ? 'Ditutup otomatis' : att.status === 'submitted' ? 'Selesai' : isUnstarted ? 'Belum mulai' : 'Mengerjakan';
    const statusBadgeClass = isAutoSubmitted
        ? 'bg-rose-50 text-rose-700'
        : att.status === 'submitted'
            ? 'bg-emerald-50 text-emerald-700'
            : 'bg-slate-100 text-slate-600';
    return {
        isUnstarted,
        isAutoSubmitted,
        warningCount,
        scoreModels,
        classicalModel,
        score,
        answered,
        total,
        durationMinutes,
        breakdown,
        extraIrtScores,
        irtScores,
        statusText,
        statusBadgeClass,
    };
}

export function MonitoringResultsTable({ attempts, hasAnyAttempts, onViewDetails, onRecover, showRoomInfo = false }: {
    attempts: ExamAttemptRecord[];
    hasAnyAttempts: boolean;
    onViewDetails: (id: string) => void;
    onRecover?: (attempt: ExamAttemptRecord) => Promise<void> | void;
    showRoomInfo?: boolean;
}) {
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const selectedAttempt = selectedId ? attempts.find(att => att.id === selectedId) ?? null : null;
    const selectedFacts = selectedAttempt ? getAttemptResultFacts(selectedAttempt) : null;

    return <div className="monitoring-results-table overflow-x-auto">
        <table className="w-full sm:min-w-[780px] text-left text-xs sm:text-sm">
            <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                    <th scope="col" className="p-3 sm:px-4 sm:py-3">Peserta</th>
                    <th scope="col" className="hidden px-4 py-3 sm:table-cell">Status</th>
                    <th scope="col" className="hidden px-4 py-3 text-center sm:table-cell">Soal</th>
                    <th scope="col" className="p-3 w-[115px] sm:w-auto sm:px-4 sm:py-3 sm:text-right">Skor</th>
                    <th scope="col" className="hidden px-4 py-3 text-right sm:table-cell">IRT (θ)</th>
                    <th scope="col" className="hidden px-4 py-3 text-center sm:table-cell">Peringatan</th>
                    <th scope="col" className="hidden px-4 py-3 text-right sm:table-cell">Aksi</th>
                </tr>
            </thead>
            <tbody>
                {attempts.length === 0 ? <tr><td colSpan={7} className="px-4 py-12 text-center text-sm text-slate-500">
                    {hasAnyAttempts ? 'Belum ada peserta yang selesai atau cocok dengan filter.' : 'Belum ada data.'}
                </td></tr> : attempts.map(att => {
                    const {
                        isUnstarted,
                        warningCount,
                        scoreModels,
                        classicalModel,
                        score,
                        answered,
                        total,
                        durationMinutes,
                        breakdown,
                        extraIrtScores,
                        irtScores,
                        statusText,
                        statusBadgeClass,
                    } = getAttemptResultFacts(att);
                    const expanded = expandedId === att.id;
                    return <Fragment key={att.id}>
                        <tr
                            onClick={() => setSelectedId(att.id)}
                            className="border-b border-slate-100 cursor-pointer transition-colors hover:bg-slate-50 active:bg-slate-100"
                        >
                            <td className="p-3 sm:px-4 sm:py-3">
                                <button type="button" className="monitoring-participant-name font-medium sm:font-semibold text-slate-800" onClick={event => { event.stopPropagation(); setSelectedId(att.id); }}>{formatStudentName(att.profiles?.full_name, 'Tanpa Nama')}</button>
                                <span className="mt-1 sm:mt-0.5 block text-xs text-slate-500">{att.profiles?.identity_number ? `${att.profiles.identity_number} · ` : ''}{att.kelas_name || 'Tanpa kelas'}</span>
                                {showRoomInfo && <div className="hidden sm:block"><ParticipantRoomInfo attempt={att} /></div>}
                                <span className="mt-2 block text-[11px] text-slate-500 sm:hidden">{statusText} · {answered ?? '—'} / {total ?? '—'} terjawab</span>
                            </td>
                            <td className="hidden px-4 py-3 sm:table-cell">
                                <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${statusBadgeClass}`}>
                                    {statusText}
                                </span>
                            </td>
                            <td className="hidden whitespace-nowrap px-4 py-3 text-center font-medium tabular-nums text-slate-700 sm:table-cell" title="Jumlah soal yang dijawab dan tersimpan di server dibanding total soal">
                                {answered ?? '—'}<span className="text-slate-400">/{total ?? '—'}</span>
                            </td>
                            <td className={`p-3 w-[115px] sm:w-auto sm:px-4 sm:py-3 sm:text-right font-semibold tabular-nums ${getScoreColorClass(score)}`}>
                                <div>{score === null ? isUnstarted ? '—' : classicalModel?.pendingLabel ?? 'Menunggu nilai' : score.toFixed(2)}</div>
                                <div className="mt-0.5 text-[11px] font-medium text-slate-500 sm:hidden">
                                    {answered ?? '—'} / {total ?? '—'} terjawab
                                </div>
                            </td>
                            <td className="hidden whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums text-slate-800 sm:table-cell">
                                {irtScores.length === 0 ? <span className="text-slate-400">—</span> : (
                                    <div className="flex flex-col gap-1">
                                        {irtScores.map(model => <span key={model.type}>
                                            {irtScores.length > 1 && <span className="mr-1.5 text-xs font-normal text-slate-500">{model.label}</span>}
                                            {Number(model.score).toFixed(2)}
                                        </span>)}
                                    </div>
                                )}
                            </td>
                            <td className={`hidden px-4 py-3 text-center font-medium tabular-nums sm:table-cell ${warningCount > 0 ? 'text-amber-700' : 'text-slate-400'}`}>{warningCount > 0 ? warningCount : '—'}</td>
                            <td className="hidden px-4 py-3 sm:table-cell" onClick={e => e?.stopPropagation?.()}>
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
                        {expanded && <tr id={`result-detail-${att.id}`} className="hidden border-b border-slate-200 bg-slate-50/70 sm:table-row"><td colSpan={7} className="px-4 py-4">
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

        <Modal
            open={Boolean(selectedAttempt && selectedFacts)}
            onClose={() => setSelectedId(null)}
            size="lg"
            variant="default"
            labelledBy="result-detail-modal-title"
        >
            <ModalHeader
                id="result-detail-modal-title"
                title="Detail Hasil Peserta"
                icon={<FileSpreadsheet className="text-[#3083FF]" size={20} />}
                onClose={() => setSelectedId(null)}
            />
            {selectedAttempt && selectedFacts && (
                <>
                    <ModalBody className="space-y-3.5 text-xs">
                        <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3 flex items-center justify-between gap-3 text-xs">
                            <div className="min-w-0 flex-1">
                                <p className="font-bold text-slate-800 truncate">{formatStudentName(selectedAttempt.profiles?.full_name, 'Tanpa Nama')}</p>
                                <p className="mt-0.5 text-slate-500 truncate">
                                    {selectedAttempt.profiles?.identity_number ? `${selectedAttempt.profiles.identity_number} · ` : ''}{selectedAttempt.kelas_name || 'Tanpa kelas'}
                                </p>
                                <ParticipantRoomInfo attempt={selectedAttempt} />
                            </div>
                            {onRecover && selectedAttempt.canReset === true && ['in_progress', 'submitted', 'auto_submitted', 'belum'].includes(selectedAttempt.status) && (
                                <button
                                    type="button"
                                    onClick={() => {
                                        const target = selectedAttempt;
                                        setSelectedId(null);
                                        void onRecover(target);
                                    }}
                                    className="ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-xs font-semibold text-blue-700 transition hover:bg-blue-100"
                                >
                                    <RotateCcw size={13} />
                                    {selectedAttempt.status === 'in_progress' ? 'Reset sesi' : selectedAttempt.status === 'belum' ? 'Susulan' : 'Susulan / Pulihkan'}
                                </button>
                            )}
                        </div>

                        <dl className="grid grid-cols-3 divide-x divide-slate-200 rounded-xl border border-slate-200 bg-slate-50/60 py-3 text-center">
                            <div className="px-2">
                                <dt className="text-[11px] text-slate-500">Soal Terjawab</dt>
                                <dd className="mt-1 text-base font-bold tabular-nums text-slate-800">
                                    {selectedFacts.answered ?? '—'} <span className="text-xs font-normal text-slate-500">/ {selectedFacts.total ?? '—'}</span>
                                </dd>
                            </div>
                            <div className="px-2">
                                <dt className="text-[11px] text-slate-500">Skor Klasik</dt>
                                <dd className={`mt-1 text-base font-bold tabular-nums ${getScoreColorClass(selectedFacts.score)}`}>
                                    {selectedFacts.score === null ? selectedFacts.isUnstarted ? '—' : selectedFacts.classicalModel?.pendingLabel ?? 'Menunggu' : selectedFacts.score.toFixed(2)}
                                </dd>
                            </div>
                            <div className="px-2">
                                <dt className="text-[11px] text-slate-500">IRT (θ)</dt>
                                <dd className="mt-1 text-base font-bold tabular-nums text-slate-800">
                                    {selectedFacts.irtScores.length === 0 ? '—' : Number(selectedFacts.irtScores[0].score).toFixed(2)}
                                </dd>
                            </div>
                        </dl>

                        <dl className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white px-3.5 py-1">
                            <div className="flex items-center justify-between gap-4 py-2.5">
                                <dt className="text-slate-500">Status Pengerjaan</dt>
                                <dd>
                                    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${selectedFacts.statusBadgeClass}`}>
                                        {selectedFacts.statusText}
                                    </span>
                                </dd>
                            </div>
                            <div className="flex items-center justify-between gap-4 py-2.5">
                                <dt className="text-slate-500">Durasi Pengerjaan</dt>
                                <dd className="font-semibold text-slate-800">
                                    {selectedFacts.durationMinutes === null ? '—' : `${Math.floor(selectedFacts.durationMinutes / 60)}j ${selectedFacts.durationMinutes % 60}m`}
                                </dd>
                            </div>
                            <div className="flex items-center justify-between gap-4 py-2.5">
                                <dt className="text-slate-500">Waktu Mulai</dt>
                                <dd className="font-medium text-slate-700 tabular-nums">
                                    {selectedAttempt.started_at ? new Date(selectedAttempt.started_at).toLocaleString('id-ID') : '—'}
                                </dd>
                            </div>
                            <div className="flex items-center justify-between gap-4 py-2.5">
                                <dt className="text-slate-500">Waktu Selesai</dt>
                                <dd className="font-medium text-slate-700 tabular-nums">
                                    {selectedAttempt.finished_at ? new Date(selectedAttempt.finished_at).toLocaleString('id-ID') : '—'}
                                </dd>
                            </div>
                            <div className="flex items-center justify-between gap-4 py-2.5">
                                <dt className="text-slate-500">Total Peringatan</dt>
                                <dd className={`font-semibold ${selectedFacts.warningCount > 0 ? 'text-amber-700' : 'text-slate-700'}`}>
                                    {selectedFacts.warningCount > 0 ? `${selectedFacts.warningCount} peringatan` : 'Tidak ada'}
                                </dd>
                            </div>
                            <div className="flex items-center justify-between gap-4 py-2.5">
                                <dt className="text-slate-500">Rincian Peringatan</dt>
                                <dd className="font-medium text-slate-700">
                                    Tab {selectedFacts.breakdown.pindah_tab} · Tutup {selectedFacts.breakdown.close_tab} · Lainnya {selectedFacts.breakdown.lainnya}
                                </dd>
                            </div>
                        </dl>

                        {selectedFacts.irtScores.length > 1 && (
                            <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-3">
                                <p className="mb-2 font-semibold text-slate-700">Rincian Model IRT</p>
                                <div className="grid grid-cols-3 gap-2">
                                    {selectedFacts.irtScores.map(item => (
                                        <div key={item.type} className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-center">
                                            <span className="block text-[11px] text-slate-500">{item.label}</span>
                                            <strong className="mt-0.5 block text-xs font-bold tabular-nums text-slate-800">
                                                {Number(item.score).toFixed(2)}
                                            </strong>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </ModalBody>
                    <ModalFooter align="end">
                        <Button
                            type="button"
                            variant="primary"
                            disabled={selectedFacts.isUnstarted}
                            onClick={() => {
                                const targetId = selectedAttempt.id;
                                setSelectedId(null);
                                onViewDetails(targetId);
                            }}
                        >
                            Rincian jawaban
                        </Button>
                        <Button
                            type="button"
                            variant="cancel"
                            onClick={() => setSelectedId(null)}
                        >
                            Tutup
                        </Button>
                    </ModalFooter>
                </>
            )}
        </Modal>
    </div>;
}
