"use client";
import { useEffect, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, ShieldAlert } from 'lucide-react';
import { FilterSearch, FilterSelect, FilterToggle, FilterToolbar } from './ui/filtertoolbar';
import type { ExamAttemptRecord } from '@/lib/api/proctor';
import { formatStudentName, gradingLabel, monitoringAttention } from '@/lib/monitoring-health';
import { formatSchoolDateTime, getSchoolTimeZone } from '@/lib/school-time';
import { AttemptHistoryModal } from '@/app/components/monitoring';
import { unansweredQuestionCount, sortByAnswerCount, sortByUnansweredCount } from '@/lib/monitoring-answer-count';
import { monitoringTime } from '@/lib/monitoring-time';
import { ParticipantRoomInfo } from './monitoring/ParticipantRoomInfo';

type MonitoringStatusFilter = 'all' | 'submitted' | 'in_progress' | 'auto_submitted' | 'belum';

export function MonitoringHealthPanel({ attempts, onRecover, onViewDetails, defaultExpanded = false }: {
    attempts: ExamAttemptRecord[];
    onRecover?: (attempt: ExamAttemptRecord) => Promise<void> | void;
    onViewDetails?: (id: string) => void;
    defaultExpanded?: boolean;
}) {
    const [onlyAttention, setOnlyAttention] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState<MonitoringStatusFilter>('all');
    const [classFilter, setClassFilter] = useState('');
    const [onlyIncomplete, setOnlyIncomplete] = useState(false);
    const [clock, setClock] = useState<{ sample?: string; elapsed: number }>({ elapsed: 0 });
    const [zone, setZone] = useState<string | null>(null);
    const [page, setPage] = useState(1);
    const [expanded, setExpanded] = useState(defaultExpanded);
    const [selectedAttemptId, setSelectedAttemptId] = useState<string | null>(null);

    const sampledAt = attempts[0]?.server_now;
    const elapsed = clock.sample === sampledAt ? clock.elapsed : 0;
    useEffect(() => {
        let alive = true;
        void getSchoolTimeZone().then(value => { if (alive) setZone(value); }).catch(() => undefined);
        return () => { alive = false; };
    }, []);
    useEffect(() => {
        const started = performance.now();
        const tick = () => setClock({ sample: sampledAt, elapsed: Math.floor((performance.now() - started) / 1000) });
        const timer = setInterval(tick, 1000);
        return () => clearInterval(timer);
    }, [sampledAt]);
    const date = (value?: string | null) => !value ? 'Belum tercatat' : zone
        ? formatSchoolDateTime(value, zone) : `${new Date(value).toISOString()} (UTC)`;
    const needingAttention = attempts.filter(attempt => monitoringAttention(attempt, elapsed).length > 0);
    const classOptions = [...new Set(attempts
        .map(attempt => attempt.kelas_name?.trim())
        .filter((name): name is string => Boolean(name)))]
        .sort((a, b) => a.localeCompare(b, 'id'));
    const normalizedSearch = searchQuery.trim().toLowerCase();
    const rows = (onlyIncomplete ? sortByUnansweredCount : sortByAnswerCount)((onlyAttention ? needingAttention : attempts)
        .filter(attempt => !onlyIncomplete || (unansweredQuestionCount(attempt) ?? 0) > 0)
        .filter(attempt => !classFilter || attempt.kelas_name?.trim() === classFilter)
        .filter(attempt => {
            if (statusFilter === 'submitted') return attempt.status === 'submitted';
            if (statusFilter === 'in_progress') return attempt.status === 'in_progress';
            if (statusFilter === 'auto_submitted') return attempt.status === 'auto_submitted';
            if (statusFilter === 'belum') return !['in_progress', 'auto_submitted', 'submitted'].includes(attempt.status);
            return true;
        })
        .filter(attempt => {
            if (!normalizedSearch) return true;
            return [
                attempt.profiles?.full_name,
                attempt.profiles?.identity_number,
                attempt.kelas_name,
            ].some(value => String(value || '').toLowerCase().includes(normalizedSearch));
        })
        );
    const hasActiveFilter = onlyAttention || statusFilter !== 'all' || Boolean(classFilter) || Boolean(normalizedSearch) || onlyIncomplete;
    const pageCount = Math.max(1, Math.ceil(rows.length / 25));
    const currentPage = Math.min(page, pageCount);
    const visibleRows = rows.slice((currentPage - 1) * 25, currentPage * 25);
    return <section className="my-4 overflow-hidden rounded-xl border border-slate-200 bg-white text-slate-800 shadow-sm" aria-label="Keamanan jawaban dan waktu ujian">
        <button
            type="button"
            aria-expanded={expanded}
            onClick={() => setExpanded(value => !value)}
            className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500"
        >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600"><ShieldAlert size={18} /></span>
            <span className="min-w-0 flex-1">
                <span className="block font-semibold text-sm text-slate-800 truncate">Jawaban & Waktu</span>
                <span className="mt-0.5 block text-xs text-slate-500 truncate">
                    {attempts.length} peserta dipantau
                    {sampledAt ? <span className="hidden sm:inline"> · Server {date(sampledAt)}</span> : ''}
                </span>
            </span>
            <div className="shrink-0 flex items-center gap-2">
                {needingAttention.length > 0 && (
                    <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800 whitespace-nowrap">
                        {needingAttention.length} perhatian
                    </span>
                )}
                <ChevronDown size={18} className={`text-slate-400 transition-transform ${expanded ? 'rotate-180' : ''}`} />
            </div>
        </button>
        {expanded && <div className="border-t border-slate-100 p-4">
        <FilterToolbar>
            <FilterSearch value={searchQuery}
                onChange={value => { setSearchQuery(value); setPage(1); }}
                placeholder="Cari nama, NIS, atau kelas..." label="Cari peserta" />
            <FilterSelect value={statusFilter}
                onChange={value => { setStatusFilter((value || 'all') as MonitoringStatusFilter); setPage(1); }}
                label="Status peserta" width={170} grow={0}
                options={[
                    { value: 'all', label: 'Semua status' },
                    { value: 'submitted', label: 'Selesai' },
                    { value: 'in_progress', label: 'Mengerjakan' },
                    { value: 'auto_submitted', label: 'Ditutup otomatis' },
                    { value: 'belum', label: 'Belum mulai' },
                ]} />
            <FilterSelect value={classFilter}
                onChange={value => { setClassFilter(value); setPage(1); }}
                label="Kelas peserta" width={150} grow={0}
                options={[{ value: '', label: 'Semua kelas' }, ...classOptions.map(name => ({ value: name, label: name }))]} />
            <FilterToggle label="Jawaban" text="Belum terjawab" checked={onlyIncomplete}
                onChange={value => { setOnlyIncomplete(value); setPage(1); }} />
            <FilterToggle label="Perhatian"
                text={`Perlu perhatian${needingAttention.length > 0 ? ` (${needingAttention.length})` : ''}`}
                checked={onlyAttention} onChange={value => { setOnlyAttention(value); setPage(1); }} />
        </FilterToolbar>
        <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200"><table className="w-full sm:min-w-[720px] text-left text-xs">
            <thead><tr className="border-b bg-slate-50 text-slate-500"><th className="p-3 font-semibold">Peserta</th><th className="p-3 font-semibold" aria-sort={onlyIncomplete ? "descending" : "ascending"} title={onlyIncomplete ? "Soal belum dijawab, dari paling banyak" : "Jumlah soal dijawab, dari paling sedikit"}>Jawaban {onlyIncomplete ? "↓" : "↑"}</th><th className="hidden p-3 font-semibold sm:table-cell">Status</th><th className="hidden p-3 font-semibold sm:table-cell">Peringatan</th><th className="hidden p-3 font-semibold sm:table-cell">Aksi</th></tr></thead>
            <tbody>{visibleRows.map(attempt => {
                const health = attempt.sync_health;
                const reasons = monitoringAttention(attempt, elapsed);
                const remaining = monitoringTime(attempt, elapsed).remainingSeconds;
                const reportAge = health && attempt.server_now ? (Date.parse(attempt.server_now) - Date.parse(health.receivedAt)) / 1000 + elapsed : Infinity;
                const fresh = health?.fresh && reportAge <= 45;
                const violationCount = attempt.warning_count ?? 0;
                const active = attempt.status === 'in_progress';
                const statusLabel = active ? 'Mengerjakan'
                    : ['submitted', 'auto_submitted'].includes(attempt.status) ? gradingLabel(attempt) : 'Belum mulai';
                return <tr key={attempt.id} onClick={() => setSelectedAttemptId(attempt.id)} className="border-b align-top last:border-b-0 cursor-pointer transition-colors hover:bg-slate-50/80 active:bg-slate-100">
                    <td className="p-3">
                        <span className="font-medium text-slate-800">{formatStudentName(attempt.profiles?.full_name, 'Tanpa nama')}</span>
                        <div className="mt-1 text-slate-500">{attempt.profiles?.identity_number || '—'} · {attempt.kelas_name || '—'}</div>
                        <div className="hidden sm:block"><ParticipantRoomInfo attempt={attempt} /></div>
                    </td>
                    <td className="p-3 w-[110px] sm:w-auto"><strong>{attempt.saved_answer_count ?? '—'} / {attempt.total_questions ?? '—'} terjawab</strong></td>
                    <td className="hidden p-3 sm:table-cell">
                        <span className="font-medium">{statusLabel}</span>
                        {active && remaining !== null && <div className="mt-1 text-slate-500">Sisa {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, '0')}</div>}
                        {active && attempt.connection_status === 'offline' && <div className="mt-1 text-amber-700">Tidak ada kontak terbaru</div>}
                        {active && fresh && health && health.pendingAnswerCount > 0 && <div className="mt-1 text-amber-700">{health.pendingAnswerCount} jawaban menunggu dikirim</div>}
                        {active && fresh && health?.storageState === 'unavailable' && <div className="mt-1 text-amber-700">Penyimpanan perangkat bermasalah</div>}
                    </td>
                    <td className="hidden p-3 sm:table-cell">
                        <span className={violationCount > 0 ? 'font-medium text-amber-700' : 'text-slate-500'}>{violationCount > 0 ? violationCount + ' peringatan' : '—'}</span>
                        {active && reasons.length > 0 && <div className="mt-1 text-amber-700">Perlu pemeriksaan</div>}
                    </td>
                    <td className="hidden p-3 sm:table-cell" onClick={e => e?.stopPropagation?.()}>
                        <div className="flex flex-wrap gap-2">
                            <button type="button" className="rounded border border-slate-300 px-2 py-1 text-slate-700 hover:bg-slate-50 cursor-pointer" onClick={() => setSelectedAttemptId(attempt.id)}>Detail</button>
                            {onRecover && attempt.canReset === true && ['in_progress', 'submitted', 'auto_submitted', 'belum'].includes(attempt.status) && (
                                <button type="button" className="rounded border border-blue-300 px-2 py-1 text-blue-700 hover:bg-blue-50 cursor-pointer font-medium" onClick={() => void onRecover(attempt)}>{active ? 'Reset sesi' : attempt.status === 'belum' ? 'Susulan' : 'Susulan / Pulihkan'}</button>
                            )}
                        </div>
                    </td>
                </tr>;
            })}</tbody>
        </table></div>
        {pageCount > 1 && (
            <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
                <span>
                    Halaman <strong className="font-semibold text-slate-700">{currentPage}</strong> / {pageCount} · {rows.length} peserta
                </span>
                <div className="flex items-center gap-3">
                    <button
                        type="button"
                        disabled={currentPage <= 1}
                        onClick={() => setPage(currentPage - 1)}
                        className="inline-flex items-center gap-1 font-semibold text-slate-600 transition-colors hover:text-[#3083FF] cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-slate-600"
                    >
                        <ChevronLeft size={14} /> Sebelumnya
                    </button>
                    <button
                        type="button"
                        disabled={currentPage >= pageCount}
                        onClick={() => setPage(currentPage + 1)}
                        className="inline-flex items-center gap-1 font-semibold text-slate-600 transition-colors hover:text-[#3083FF] cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-slate-600"
                    >
                        Berikutnya <ChevronRight size={14} />
                    </button>
                </div>
            </div>
        )}
        {!rows.length && <p className="py-4 text-sm text-slate-500">{hasActiveFilter ? 'Tidak ada peserta pada filter ini.' : 'Data monitoring belum tersedia.'}</p>}
        </div>}

        {/* Shared Modals */}
        <AttemptHistoryModal
            open={!!selectedAttemptId}
            attempt={attempts.find(attempt => attempt.id === selectedAttemptId) || null}
            onClose={() => setSelectedAttemptId(null)}
            showSessionDetails
            elapsedSeconds={elapsed}
            onViewAnswers={onViewDetails}
            onRecover={onRecover}
        />
    </section>;
}
