'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import type { ExamAttemptRecord } from '@/lib/api/proctor';
import { activeMonitoringFacts, activeMonitoringRows } from '@/lib/active-monitoring';
import { formatStudentName, monitoringEventLabels, storageLabels } from '@/lib/monitoring-health';
import { formatMonitoringDuration } from '@/lib/monitoring-time';
import { formatSchoolDateTime, getSchoolTimeZone } from '@/lib/school-time';
import { securityViolationLabel } from '@/lib/security-violations';
import { ParticipantRoomInfo } from './monitoring/ParticipantRoomInfo';

const countdown = (seconds: number | null) => seconds === null ? '—' : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

function DeviceLine({ attempt }: { attempt: ExamAttemptRecord }) {
    const context = attempt.client_context;
    return <div className="mt-2 break-words text-xs font-normal leading-5 text-muted-foreground" title="Browser dari user-agent dan IP jaringan yang tercatat saat kontak terakhir. Beberapa perangkat dapat memakai IP yang sama.">
        {context?.browser || 'Browser belum tercatat'}{context?.os ? ` · ${context.os}` : ''}
        <span className="mx-1.5">·</span>IP: {context?.ip_address || 'Belum tercatat'}
    </div>;
}

const compactReason = (reason: string) => {
    if (reason === 'Tidak ada kontak terbaru') return 'Tanpa kontak';
    if (reason === 'Koneksi belum dilaporkan') return 'Koneksi belum ada';
    if (reason === 'Penyimpanan perangkat gagal') return 'Penyimpanan gagal';
    if (reason === 'Waktu tersisa ≤5 menit') return 'Waktu ≤5 menit';
    if (reason === 'Batas waktu tercapai') return 'Waktu habis';
    const pending = reason.match(/^(Terakhir: )?(\d+) jawaban menunggu sinkronisasi$/);
    if (pending) return `${pending[2]} tertunda${pending[1] ? ' · lama' : ''}`;
    return reason.replace(' peringatan tercatat', ' peringatan');
};

/**
 * Konfirmasi menyelesaikan pengerjaan, di dalam panel detail. SweetAlert tidak
 * dipakai karena `<dialog>` modal berada di top layer dan akan menutupinya.
 */
function FinishAttemptForm({ attempt, onFinish, onDone }: {
    attempt: ExamAttemptRecord;
    onFinish: (attempt: ExamAttemptRecord, reason: string) => Promise<string | null>;
    onDone: () => void;
}) {
    const [open, setOpen] = useState(false);
    const [reason, setReason] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const pending = attempt.sync_health?.pendingAnswerCount ?? 0;
    if (!open) {
        return <button type="button" onClick={() => setOpen(true)} className="mt-3 rounded-lg border border-red-200 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-500 dark:border-red-500/30 dark:text-red-400 dark:hover:bg-red-500/10">Selesaikan pengerjaan</button>;
    }
    const submit = async () => {
        if (!reason.trim() || busy) return;
        setBusy(true);
        setError(null);
        const failure = await onFinish(attempt, reason.trim());
        setBusy(false);
        if (failure) setError(failure);
        else onDone();
    };
    return <div className="mt-4 rounded-lg border border-red-200 bg-red-50/60 p-4 dark:border-red-500/30 dark:bg-red-500/10">
        <h4 className="text-sm font-semibold text-red-800 dark:text-red-300">Selesaikan pengerjaan siswa ini?</h4>
        <p className="mt-1 text-xs leading-5 text-red-800 dark:text-red-300">Ujian siswa langsung berakhir dan jawaban yang sudah tersimpan di server ({attempt.saved_answer_count ?? 0} jawaban) dinilai. Siswa tidak dapat melanjutkan.{pending > 0 ? ` Perangkat siswa melaporkan ${pending} jawaban belum tersinkron — jawaban itu tidak ikut dinilai.` : ''}</p>
        <label className="mt-3 block text-xs font-medium text-foreground" htmlFor={`finish-reason-${attempt.id}`}>Alasan (wajib, tercatat)</label>
        <textarea id={`finish-reason-${attempt.id}`} value={reason} onChange={event => setReason(event.target.value)} maxLength={240} rows={2} placeholder="Contoh: siswa meminta selesai, perangkat rusak, waktu ujian sesi berakhir" className="mt-1 w-full rounded-md border border-border bg-[var(--card)] px-3 py-2 text-xs text-foreground focus-visible:outline-2 focus-visible:outline-blue-500" />
        {error && <p role="alert" className="mt-2 text-xs text-red-700 dark:text-red-300">{error}</p>}
        <div className="mt-3 flex gap-2">
            <button type="button" disabled={!reason.trim() || busy} onClick={submit} className="rounded-lg bg-red-600 px-4 py-2 text-xs font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50">{busy ? 'Menyelesaikan…' : 'Ya, selesaikan'}</button>
            <button type="button" disabled={busy} onClick={() => { setOpen(false); setError(null); }} className="rounded-lg px-4 py-2 text-xs font-medium text-muted-foreground hover:bg-muted">Batal</button>
        </div>
    </div>;
}

export function ActiveParticipantsPanel({ attempts, onViewDetails, onFinish, attentionOnly = false }: {
    attempts: ExamAttemptRecord[];
    onViewDetails?: (id: string) => void;
    /** Hanya diisi untuk pengelola ujian. Mengembalikan pesan galat, atau null bila berhasil. */
    onFinish?: (attempt: ExamAttemptRecord, reason: string) => Promise<string | null>;
    attentionOnly?: boolean;
}) {
    const [page, setPage] = useState(1);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [zone, setZone] = useState<string | null>(null);
    const [clock, setClock] = useState<{ sample?: string; elapsed: number }>({ elapsed: 0 });
    const dialogRef = useRef<HTMLDialogElement>(null);
    const sampledAt = attempts[0]?.server_now;
    const elapsed = clock.sample === sampledAt ? clock.elapsed : 0;
    useEffect(() => {
        let active = true;
        void getSchoolTimeZone().then(value => { if (active) setZone(value); }).catch(() => undefined);
        return () => { active = false; };
    }, []);
    useEffect(() => {
        const start = performance.now();
        const timer = setInterval(() => setClock({ sample: sampledAt, elapsed: Math.floor((performance.now() - start) / 1000) }), 1000);
        return () => clearInterval(timer);
    }, [sampledAt]);
    useEffect(() => {
        const dialog = dialogRef.current;
        if (selectedId && dialog && !dialog.open) dialog.showModal();
        if (!selectedId && dialog?.open) dialog.close();
    }, [selectedId]);
    const date = (value?: string | null) => value ? zone ? formatSchoolDateTime(value, zone) : `${new Date(value).toISOString()} (UTC)` : 'Belum tercatat';
    const rows = activeMonitoringRows(attempts, attentionOnly ? 'attention' : 'all', elapsed);
    const pages = Math.max(1, Math.ceil(rows.length / 25));
    const currentPage = Math.min(page, pages);
    const selected = attempts.find(attempt => attempt.id === selectedId);
    const selectedFacts = selected ? activeMonitoringFacts(selected, elapsed) : null;
    return <section className="mb-4 overflow-hidden rounded-xl border border-border bg-[var(--card)]" aria-label="Peserta ujian aktif">
        <div className="overflow-x-auto focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue-500" tabIndex={0} role="region" aria-label="Tabel peserta aktif, geser untuk melihat seluruh kolom"><table className="w-full min-w-[780px] text-left text-sm">
            <caption className="sr-only">Peserta aktif, diurutkan berdasarkan kebutuhan perhatian dan sisa waktu.</caption>
            <thead className="bg-slate-50/80 text-[11px] text-muted-foreground dark:bg-slate-800/40"><tr>{['Peserta', 'Progres', 'Sisa waktu', 'Koneksi', 'Perhatian', ''].map((label, index) => <th key={index} scope="col" className={`px-5 py-3.5 font-semibold ${index === 0 ? 'w-[27%]' : ''}`}>{label || <span className="sr-only">Tindakan</span>}</th>)}</tr></thead>
            <tbody>{rows.slice((currentPage - 1) * 25, currentPage * 25).map(({ attempt, facts }) => {
                const saved = attempt.saved_answer_count;
                const total = attempt.total_questions;
                const progress = saved != null && total != null && total > 0 ? Math.min(100, Math.max(0, saved / total * 100)) : null;
                return <tr key={attempt.id} className={`border-t border-border align-middle transition-colors hover:bg-slate-50/80 dark:hover:bg-slate-800/40 ${facts.priority === 3 ? 'bg-amber-50/40 dark:bg-amber-500/5' : ''}`}>
                    <td className="px-5 py-4"><div className="text-xs font-semibold text-foreground">{formatStudentName(attempt.profiles?.full_name, 'Tanpa nama')}</div>
                        <div className="mt-1 text-[11px] text-muted-foreground">{attempt.kelas_name || 'Kelas belum tercatat'}</div></td>
                    <td className="px-5 py-4"><span className="text-xs font-semibold tabular-nums text-foreground" aria-label={`${saved ?? 'Belum diketahui'} dari ${total ?? 'belum diketahui'} jawaban tersimpan`}>{saved ?? '—'} <span className="font-normal text-muted-foreground">/ {total ?? '—'}</span></span>
                        {progress !== null && <div className="mt-2 h-1 w-24 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700" role="progressbar" aria-label={`Progres ${attempt.profiles?.full_name || 'peserta'}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)}><div className="h-full rounded-full bg-blue-500" style={{ width: `${progress}%` }} /></div>}</td>
                    <td className="whitespace-nowrap px-5 py-4"><strong className={`text-xs font-semibold tabular-nums ${facts.ending ? 'text-amber-700 dark:text-amber-400' : 'text-foreground'}`}>{countdown(facts.remainingSeconds)}</strong></td>
                    <td className="whitespace-nowrap px-5 py-4"><span className="inline-flex items-center gap-2 text-[11px] text-muted-foreground"><span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${facts.connection === 'online' ? 'bg-emerald-500' : facts.connection === 'offline' ? 'bg-amber-500' : 'bg-slate-400'}`} />{facts.connection === 'online' ? 'Terhubung' : facts.connection === 'offline' ? 'Tanpa kontak' : 'Belum diketahui'}</span></td>
                    <td className="w-[240px] px-5 py-4 text-[10px]">{facts.reasons.length ? <div className="flex flex-wrap gap-1.5">{facts.reasons.slice(0, 2).map(reason => <span key={reason} title={reason} className="inline-flex whitespace-nowrap rounded-md bg-amber-50 px-2 py-1 font-medium text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">{compactReason(reason)}</span>)}{facts.reasons.length > 2 && <span className="inline-flex rounded-md bg-amber-50 px-2 py-1 font-medium text-amber-800 dark:bg-amber-500/10 dark:text-amber-300" title={facts.reasons.slice(2).join(' · ')}><span aria-hidden="true">+{facts.reasons.length - 2}</span><span className="sr-only">{facts.reasons.slice(2).join('; ')}</span></span>}</div> : <span className="text-muted-foreground" aria-label="Tidak ada peringatan">—</span>}</td>
                    <td className="px-5 py-4 text-right"><button type="button" onClick={() => setSelectedId(attempt.id)} aria-label={`Detail ${formatStudentName(attempt.profiles?.full_name, 'peserta')}`} className="rounded-md px-2 py-2 text-xs font-semibold text-blue-600 transition-colors hover:bg-blue-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 dark:text-blue-400 dark:hover:bg-blue-500/10">Detail</button></td>
                </tr>;
            })}</tbody>
        </table></div>
        {!rows.length && <p className="px-5 py-12 text-center text-sm text-muted-foreground">{attentionOnly ? 'Tidak ada peserta aktif yang memerlukan perhatian.' : 'Tidak ada peserta aktif yang cocok dengan filter.'}</p>}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-3 text-[11px] text-muted-foreground"><span>{rows.length ? `${(currentPage - 1) * 25 + 1}–${Math.min(currentPage * 25, rows.length)} dari ${rows.length} peserta` : '0 peserta'}</span>{pages > 1 && <nav className="flex items-center gap-3" aria-label="Halaman peserta aktif">
            <span>{currentPage} / {pages}</span><button type="button" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)} className="flex items-center gap-1 rounded-md p-1.5 hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 disabled:cursor-not-allowed disabled:opacity-30"><ChevronLeft size={14} />Sebelumnya</button>
            <button type="button" disabled={currentPage >= pages} onClick={() => setPage(currentPage + 1)} className="flex items-center gap-1 rounded-md p-1.5 hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 disabled:cursor-not-allowed disabled:opacity-30">Berikutnya<ChevronRight size={14} /></button></nav>}</div>
        <dialog ref={dialogRef} onCancel={() => setSelectedId(null)} onClose={() => setSelectedId(null)} className="fixed inset-y-0 left-auto right-0 m-0 h-full max-h-none w-full max-w-lg border-l border-border bg-[var(--card)] p-0 text-foreground shadow-xl backdrop:bg-slate-900/30" aria-labelledby="active-participant-title">
            <div className="flex h-full flex-col"><div className="flex items-center justify-between border-b border-border p-5"><h3 id="active-participant-title" className="font-semibold">Detail Peserta</h3><button type="button" onClick={() => setSelectedId(null)} aria-label="Tutup detail peserta" className="rounded-lg p-2 hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"><X size={18} /></button></div>
                {selected && selectedFacts ? <div className="flex-1 overflow-y-auto p-5 text-sm">
                    <h4 className="font-semibold text-foreground">{formatStudentName(selected.profiles?.full_name, 'Tanpa nama')}</h4><p className="mt-1 text-xs text-muted-foreground">{selected.kelas_name || 'Kelas belum tercatat'} · NIS {selected.profiles?.identity_number || '—'}</p><DeviceLine attempt={selected} />
                    <ParticipantRoomInfo attempt={selected} />
                    {selectedFacts.reasons.length > 0 && <div className="mt-5 rounded-lg bg-amber-50 p-3 dark:bg-amber-500/10"><h4 className="text-xs font-semibold text-amber-800 dark:text-amber-300">Perlu perhatian</h4><ul className="mt-2 space-y-1 text-xs leading-5 text-amber-800 dark:text-amber-300">{selectedFacts.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul></div>}
                    <dl className="my-6 grid grid-cols-2 gap-x-5 gap-y-5">{[
                        ['Status', selected.status === 'in_progress' ? 'Mengerjakan' : 'Sesi berakhir'], ['Sisa waktu', countdown(selectedFacts.remainingSeconds)],
                        ['Jawaban server', `${selected.saved_answer_count ?? '—'} / ${selected.total_questions ?? '—'}`], ['Lokal terakhir', selected.sync_health ? `${selected.sync_health.localAnswerCount} jawaban${selectedFacts.fresh ? '' : ' (laporan lama)'}` : 'Belum dilaporkan'],
                        ['Menunggu sinkronisasi', selected.sync_health ? `${selectedFacts.pending}${selectedFacts.fresh ? '' : ' (laporan lama)'}` : 'Belum dilaporkan'],
                        ['Penyimpanan', selected.sync_health ? storageLabels[selected.sync_health.storageState] : 'Belum dilaporkan'],
                        ['Mulai', date(selected.started_at)], ['Batas sesi', date(selected.deadline_at)],
                        ['Lama mengerjakan', formatMonitoringDuration(selectedFacts.workedSeconds)], ['Kontak terakhir', date(selected.last_seen_at)],
                        ['Jawaban disimpan', date(selected.last_answer_saved_at)], ['Data perangkat', date(selected.client_context?.observed_at)],
                    ].map(([label, value]) => <div key={label}><dt className="text-[11px] text-muted-foreground">{label}</dt><dd className="mt-1 break-words text-xs leading-5 text-foreground">{value}</dd></div>)}</dl>
                    <h4 className="mb-3 border-t border-border pt-5 font-semibold">Riwayat aktivitas</h4><p className="mb-3 text-xs text-muted-foreground">Catatan perangkat dan koneksi tidak selalu merupakan pelanggaran.</p>
                    <ol className="space-y-3">{[...(selected.monitoring_history || [])].sort((a,b) => Date.parse(b.at) - Date.parse(a.at)).map((event,index) => <li key={`${event.at}-${index}`} className="border-l-2 border-border pl-3"><div className="text-[11px] text-muted-foreground">{date(event.at)}</div><div className="mt-1 text-xs">{monitoringEventLabels[event.type] || securityViolationLabel(event.type)}</div>{event.reason && <p className="mt-1 text-xs text-muted-foreground">{event.reason}</p>}</li>)}</ol>
                    {!selected.monitoring_history?.length && <p className="text-xs text-muted-foreground">Belum ada riwayat.</p>}
                    {onViewDetails && <button type="button" onClick={() => { onViewDetails(selected.id); setSelectedId(null); }} className="mt-6 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500">Buka rincian jawaban</button>}
                    {onFinish && selected.status === 'in_progress' && <div className="border-t border-border pt-3 mt-6"><FinishAttemptForm key={selected.id} attempt={selected} onFinish={onFinish} onDone={() => setSelectedId(null)} /></div>}
                </div> : <p className="p-5 text-sm text-muted-foreground">Peserta tidak lagi ada dalam daftar ini. Tutup panel untuk melihat data terbaru.</p>}
            </div>
        </dialog>
    </section>;
}
