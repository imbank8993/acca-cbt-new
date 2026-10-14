"use client";
import { useEffect, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, History, Search, ShieldAlert, X } from 'lucide-react';
import { InlineSelect } from '@/components/ui/InlineSelect';
import type { ExamAttemptRecord } from '@/lib/api/proctor';
import { formatStudentName, gradingLabel, monitoringAttention, storageLabels } from '@/lib/monitoring-health';
import { formatSchoolDateTime, getSchoolTimeZone } from '@/lib/school-time';
import { AttemptHistoryModal } from '@/app/components/monitoring';
import { unansweredQuestionCount, sortByAnswerCount, sortByUnansweredCount } from '@/lib/monitoring-answer-count';
import { formatMonitoringDuration, monitoringTime } from '@/lib/monitoring-time';

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
    const [selectedHistoryAttempt, setSelectedHistoryAttempt] = useState<ExamAttemptRecord | null>(null);

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
            className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500"
        >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600"><ShieldAlert size={18} /></span>
            <span className="min-w-0 flex-1">
                <span className="block font-semibold">Jawaban & waktu ujian</span>
                <span className="mt-0.5 block text-xs text-slate-500">
                    {needingAttention.length > 0
                        ? `${needingAttention.length} dari ${attempts.length} peserta perlu perhatian`
                        : `${attempts.length} peserta dipantau`}
                    {sampledAt ? ` · Data server ${date(sampledAt)}` : ''}
                </span>
            </span>
            {needingAttention.length > 0 && (
                <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800">
                    {needingAttention.length} perhatian
                </span>
            )}
            <ChevronDown size={18} className={`shrink-0 text-slate-400 transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </button>
        {expanded && <div className="border-t border-slate-100 p-4">
        <div className="mt-3 flex flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
            <div className="flex min-w-0 flex-1 flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:items-center">
                <div className="relative min-w-[220px] flex-1 sm:max-w-sm">
                    <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={event => {
                            setSearchQuery(event.target.value);
                            setPage(1);
                        }}
                        placeholder="Cari nama peserta, NIS, atau kelas..."
                        aria-label="Cari peserta"
                        className="h-[38px] w-full rounded-lg border border-slate-200 bg-white pl-9 pr-8 text-[13px] text-slate-800 outline-none transition-colors placeholder:text-slate-400 focus:border-[#3083FF] focus:ring-2 focus:ring-[#3083FF]/15"
                    />
                    {searchQuery && (
                        <button
                            type="button"
                            onClick={() => {
                                setSearchQuery('');
                                setPage(1);
                            }}
                            aria-label="Hapus pencarian"
                            title="Hapus pencarian"
                            className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                        >
                            <X size={14} />
                        </button>
                    )}
                </div>
                <button type="button" role="switch" aria-checked={onlyIncomplete}
                    onClick={() => { setOnlyIncomplete(value => !value); setPage(1); }}
                    title="Tampilkan peserta yang belum menjawab semua soal, dari soal belum dijawab terbanyak."
                    className={`flex h-[38px] shrink-0 items-center gap-2 rounded-lg px-3 text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${onlyIncomplete ? 'bg-blue-50 text-blue-700' : 'text-slate-600 hover:bg-slate-50'}`}>
                    <span aria-hidden="true" className={`relative h-5 w-9 rounded-full transition-colors ${onlyIncomplete ? 'bg-blue-500' : 'bg-slate-300'}`}>
                        <span className={`absolute left-0 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${onlyIncomplete ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
                    </span>
                    Belum terjawab
                </button>
                <div className="w-full sm:w-[200px]">
                    <InlineSelect
                        value={statusFilter}
                        onChange={val => {
                            setStatusFilter(val as MonitoringStatusFilter);
                            setPage(1);
                        }}
                        title="Filter status peserta"
                        minWidth="100%"
                        height="38px"
                        className="w-full [&_.uisel-input]:!text-[13px] [&_.uisel-input]:!font-normal"
                        options={[
                            { value: 'all', label: 'Semua' },
                            { value: 'submitted', label: 'Selesai' },
                            { value: 'in_progress', label: 'Mengerjakan' },
                            { value: 'auto_submitted', label: 'Ditutup otomatis' },
                            { value: 'belum', label: 'Belum mulai' },
                        ]}
                    />
                </div>
                <div className="w-full sm:w-[180px]">
                    <InlineSelect
                        value={classFilter}
                        onChange={val => {
                            setClassFilter(val);
                            setPage(1);
                        }}
                        title="Filter kelas peserta"
                        minWidth="100%"
                        height="38px"
                        className="w-full [&_.uisel-input]:!text-[13px] [&_.uisel-input]:!font-normal"
                        options={[
                            { value: '', label: 'Semua kelas' },
                            ...classOptions.map(name => ({ value: name, label: name })),
                        ]}
                    />
                </div>
            </div>
            <label className="flex shrink-0 cursor-pointer items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={onlyAttention} onChange={event => { setOnlyAttention(event.target.checked); setPage(1); }} /><ShieldAlert size={16} className="text-amber-500" />Peringatan</label>
        </div>
        <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200"><table className="w-full min-w-[980px] text-left text-xs">
            <thead><tr className="border-b bg-slate-50 text-slate-500"><th className="w-12 p-3 font-semibold">No.</th><th className="p-3 font-semibold">Peserta</th><th className="p-3 font-semibold" aria-sort={onlyIncomplete ? "descending" : "ascending"} title={onlyIncomplete ? "Soal belum dijawab, dari paling banyak" : "Jumlah soal dijawab, dari paling sedikit"}>Jawaban {onlyIncomplete ? "↓" : "↑"}</th><th className="p-3 font-semibold">Sinkronisasi</th><th className="p-3 font-semibold">Waktu / koneksi</th><th className="p-3 font-semibold">Penilaian / riwayat</th></tr></thead>
            <tbody>{visibleRows.map((attempt, index) => {
                const health = attempt.sync_health;
                const reasons = monitoringAttention(attempt, elapsed);
                const timing = monitoringTime(attempt, elapsed);
                const remaining = timing.remainingSeconds;
                const reportAge = health && attempt.server_now ? (Date.parse(attempt.server_now) - Date.parse(health.receivedAt)) / 1000 + elapsed : Infinity;
                const fresh = health?.fresh && reportAge <= 45;
                const violationCount = attempt.warning_count ?? 0;
                const breakdown = attempt.violation_breakdown;
                const statusLabel = attempt.status === 'in_progress'
                    ? attempt.connection_status === 'offline' ? 'Tidak ada kontak terbaru' : 'Mengerjakan'
                    : attempt.status === 'auto_submitted'
                        ? 'Ditutup otomatis'
                        : attempt.status === 'submitted' ? 'Selesai' : 'Belum mulai';
                return <tr key={attempt.id} className={`border-b align-top last:border-b-0 ${reasons.length ? 'bg-amber-50/60' : 'odd:bg-white even:bg-slate-50/50'} hover:bg-blue-50/50`}>
                    <td className="p-3 text-slate-500 tabular-nums">{(currentPage - 1) * 25 + index + 1}</td>
                    <td className="p-3">
                        <span className="text-xs font-medium text-slate-800">{formatStudentName(attempt.profiles?.full_name, 'Tanpa nama')}</span>
                        <div className="mt-1 text-slate-500">{attempt.profiles?.identity_number || '—'} · {attempt.kelas_name || '—'}</div>
                        <span className={`mt-2 inline-flex rounded-full px-2 py-1 text-[11px] font-semibold ${
                            attempt.status === 'in_progress' ? 'bg-blue-50 text-blue-700'
                                : attempt.status === 'auto_submitted' ? 'bg-amber-100 text-amber-800'
                                    : attempt.status === 'submitted' ? 'bg-emerald-50 text-emerald-700'
                                        : 'bg-slate-100 text-slate-600'
                        }`}>{statusLabel}</span>
                        {(attempt.status === 'in_progress' || attempt.status === 'auto_submitted') && (
                            <div className={`mt-1 ${violationCount > 0 ? 'font-semibold text-amber-800' : 'text-slate-500'}`}>
                                Peringatan {violationCount} · Pindah tab {breakdown?.pindah_tab ?? attempt.tab_switch_count ?? 0}
                                {' · '}Tutup tab {breakdown?.close_tab ?? 0} · Lainnya {breakdown?.lainnya ?? 0}
                            </div>
                        )}
                    </td>
                    <td className="p-3"><strong>{attempt.saved_answer_count ?? '—'} / {attempt.total_questions ?? '—'} soal</strong><div className="mt-1">Belum dijawab: {attempt.unanswered_count ?? '—'}</div><div className="mt-1 text-slate-500">Simpan: {date(attempt.last_answer_saved_at)}</div></td>
                    <td className="p-3">{health ? <><div>Lokal: {health.localAnswerCount} · Antrean: {health.pendingAnswerCount}</div><div>Penyimpanan: {storageLabels[health.storageState]}</div><div className="mt-1 text-slate-500">{date(health.receivedAt)}{!fresh && ' · Laporan lama'}</div></> : <span className="text-slate-500">Belum ada laporan</span>}</td>
                    <td className="p-3">
                        <strong>{attempt.status === 'in_progress' && remaining !== null ? `Sisa ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}` : '—'}</strong>
                        <div className="mt-1">Batas: {date(attempt.deadline_at)}</div>
                        <div>{attempt.status !== 'in_progress' ? 'Sesi berakhir' : elapsed > 45 ? 'Data perlu diperbarui' : attempt.connection_status === 'online' ? 'Terhubung' : 'Tidak ada kontak terbaru'}</div>
                        <div className="text-slate-500">Kontak server terakhir: {date(attempt.last_seen_at)}</div>
                        <div className="mt-1 text-slate-500">Mulai: {date(attempt.started_at)}</div>
                        <div className="mt-1 text-slate-500">Lama mengerjakan: {formatMonitoringDuration(timing.workedSeconds)}</div>
                        {timing.availableSeconds !== null && <div className="mt-1 text-slate-500" title="Dihitung dari waktu mulai hingga batas sesi, termasuk batas akhir jadwal ujian.">Waktu sesi: {formatMonitoringDuration(timing.availableSeconds)}</div>}
                    </td>
                    <td className="p-3">
                        <span className={attempt.status === 'auto_submitted'
                            ? 'inline-flex rounded-full bg-amber-100 px-2 py-1 text-[11px] font-semibold text-amber-800'
                            : 'font-semibold'}>
                            {gradingLabel(attempt)}
                        </span>
                        {reasons.map(reason => <div key={reason} className="mt-1 text-amber-800">{reason}</div>)}

                        <div className="mt-2">
                            <button
                                type="button"
                                onClick={() => setSelectedHistoryAttempt(attempt)}
                                className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50/80 px-2.5 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-100 hover:border-blue-300 transition-all shadow-xs cursor-pointer"
                            >
                                <History size={13} /> Riwayat ({attempt.monitoring_history?.length || 0})
                            </button>
                        </div>

                        <div className="mt-2 flex flex-wrap gap-2">
                            {onViewDetails && <button className="rounded border border-slate-300 px-2 py-1 text-slate-700 hover:bg-slate-50 cursor-pointer" onClick={() => onViewDetails(attempt.id)}>Detail</button>}
                            {onRecover && ['submitted', 'auto_submitted'].includes(attempt.status) && (
                                <button
                                    type="button"
                                    className="rounded border border-blue-300 px-2 py-1 text-blue-700 hover:bg-blue-50 cursor-pointer font-medium"
                                    onClick={() => void onRecover(attempt)}
                                >
                                    Susulan / Pulihkan
                                </button>
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
            open={!!selectedHistoryAttempt}
            attempt={selectedHistoryAttempt}
            onClose={() => setSelectedHistoryAttempt(null)}
        />
    </section>;
}
