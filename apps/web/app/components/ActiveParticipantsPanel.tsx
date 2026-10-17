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
    return <div className="mt-1 break-words text-xs font-normal text-slate-500" title="Browser dari user-agent dan IP jaringan yang tercatat saat kontak terakhir. Beberapa perangkat dapat memakai IP yang sama.">
        {context?.browser || 'Browser belum tercatat'}{context?.os ? ` · ${context.os}` : ''}
        <span className="mx-1.5">·</span>IP: {context?.ip_address || 'Belum tercatat'}
    </div>;
}

export function ActiveParticipantsPanel({ attempts, onViewDetails }: {
    attempts: ExamAttemptRecord[];
    onViewDetails?: (id: string) => void;
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
    const rows = activeMonitoringRows(attempts, 'all', elapsed);
    const pages = Math.max(1, Math.ceil(rows.length / 25));
    const currentPage = Math.min(page, pages);
    const selected = attempts.find(attempt => attempt.id === selectedId);
    const selectedFacts = selected ? activeMonitoringFacts(selected, elapsed) : null;
    return <section className="mb-4 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm" aria-label="Peserta ujian aktif">
        <div className="overflow-x-auto"><table className="w-full min-w-[880px] text-left text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500"><tr>{['No.', 'Peserta', 'Progres', 'Sisa waktu', 'Koneksi', 'Perhatian', ''].map((label, index) => <th key={index} className="px-5 py-3 font-semibold">{label}</th>)}</tr></thead>
            <tbody>{rows.slice((currentPage - 1) * 25, currentPage * 25).map(({ attempt, facts }, index) => {
                const saved = attempt.saved_answer_count;
                const total = attempt.total_questions;
                const progress = saved != null && total != null && total > 0 ? Math.min(100, Math.max(0, saved / total * 100)) : null;
                return <tr key={attempt.id} className={`border-t border-slate-100 align-top hover:bg-slate-50 ${facts.priority === 3 ? 'bg-amber-50/40' : ''}`}>
                    <td className="px-5 py-4 text-xs text-slate-500 tabular-nums">{(currentPage - 1) * 25 + index + 1}</td>
                    <td className="px-5 py-4"><button type="button" onClick={() => setSelectedId(attempt.id)} className="text-left text-xs font-semibold text-slate-800 hover:text-blue-600">{formatStudentName(attempt.profiles?.full_name, 'Tanpa nama')}</button>
                        <DeviceLine attempt={attempt} /><div className="mt-1 text-xs text-slate-500">{attempt.profiles?.identity_number || '—'} · {attempt.kelas_name || '—'}</div>
                        <ParticipantRoomInfo attempt={attempt} /></td>
                    <td className="px-5 py-4"><span className="font-semibold text-slate-800">{saved ?? '—'} / {total ?? '—'}</span><div className="mt-1 text-[11px] text-slate-500">Jawaban tersimpan</div>
                        {progress !== null && <div className="mt-2 h-1.5 w-24 rounded-full bg-slate-100" role="progressbar" aria-label={`Progres ${attempt.profiles?.full_name || 'peserta'}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)}><div className="h-full rounded-full bg-blue-500" style={{ width: `${progress}%` }} /></div>}</td>
                    <td className="px-5 py-4"><strong className={`tabular-nums ${facts.ending ? 'text-amber-700' : 'text-slate-800'}`}>{countdown(facts.remainingSeconds)}</strong><div className="mt-1 text-[11px] text-slate-500">Mulai {date(attempt.started_at)}</div></td>
                    <td className="px-5 py-4"><span className={`text-xs font-medium ${facts.connection === 'online' ? 'text-blue-700' : facts.connection === 'offline' ? 'text-amber-700' : 'text-slate-500'}`}>{facts.connection === 'online' ? 'Terhubung' : facts.connection === 'offline' ? 'Tidak ada kontak terbaru' : 'Belum diketahui'}</span><div className="mt-1 text-[11px] text-slate-500">Terakhir {date(attempt.last_seen_at)}</div></td>
                    <td className="max-w-[240px] px-5 py-4 text-xs">{facts.reasons.length ? facts.reasons.map(reason => <div key={reason} className="mb-1 text-amber-800">{reason}</div>) : <span className="text-slate-400">Tidak ada peringatan</span>}</td>
                    <td className="px-5 py-4"><button type="button" onClick={() => setSelectedId(attempt.id)} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-blue-600 hover:bg-blue-50">Detail</button></td>
                </tr>;
            })}</tbody>
        </table></div>
        {!rows.length && <p className="px-5 py-12 text-center text-sm text-slate-500">Tidak ada peserta aktif yang cocok dengan filter.</p>}
        {pages > 1 && <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3 text-xs text-slate-500"><span>{rows.length} peserta · halaman {currentPage} / {pages}</span><div className="flex gap-3">
            <button type="button" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)} className="flex items-center gap-1 disabled:opacity-30"><ChevronLeft size={14} />Sebelumnya</button>
            <button type="button" disabled={currentPage >= pages} onClick={() => setPage(currentPage + 1)} className="flex items-center gap-1 disabled:opacity-30">Berikutnya<ChevronRight size={14} /></button></div></div>}
        <dialog ref={dialogRef} onCancel={() => setSelectedId(null)} className="fixed inset-y-0 left-auto right-0 m-0 h-full max-h-none w-full max-w-lg border-l border-slate-200 bg-white p-0 shadow-xl backdrop:bg-slate-900/30" aria-labelledby="active-participant-title">
            <div className="flex h-full flex-col"><div className="flex items-center justify-between border-b border-slate-200 p-5"><h3 id="active-participant-title" className="font-semibold">Detail Peserta</h3><button type="button" onClick={() => setSelectedId(null)} aria-label="Tutup detail peserta" className="rounded-lg p-2 hover:bg-slate-100"><X size={18} /></button></div>
                {selected && selectedFacts ? <div className="flex-1 overflow-y-auto p-5 text-sm">
                    <h4 className="font-semibold text-slate-800">{formatStudentName(selected.profiles?.full_name, 'Tanpa nama')}</h4><DeviceLine attempt={selected} /><p className="mt-1 text-xs text-slate-500">{selected.profiles?.identity_number || '—'} · {selected.kelas_name || '—'}</p>
                    <ParticipantRoomInfo attempt={selected} />
                    <dl className="my-6 grid grid-cols-2 gap-4">{[
                        ['Status', selected.status === 'in_progress' ? 'Mengerjakan' : 'Sesi berakhir'], ['Sisa waktu', countdown(selectedFacts.remainingSeconds)],
                        ['Jawaban server', `${selected.saved_answer_count ?? '—'} / ${selected.total_questions ?? '—'}`], ['Lokal terakhir', selected.sync_health ? `${selected.sync_health.localAnswerCount} jawaban${selectedFacts.fresh ? '' : ' (laporan lama)'}` : 'Belum dilaporkan'],
                        ['Menunggu sinkronisasi', selected.sync_health ? `${selectedFacts.pending}${selectedFacts.fresh ? '' : ' (laporan lama)'}` : 'Belum dilaporkan'],
                        ['Penyimpanan', selected.sync_health ? storageLabels[selected.sync_health.storageState] : 'Belum dilaporkan'],
                        ['Mulai', date(selected.started_at)], ['Batas sesi', date(selected.deadline_at)],
                        ['Lama mengerjakan', formatMonitoringDuration(selectedFacts.workedSeconds)], ['Kontak terakhir', date(selected.last_seen_at)],
                        ['Jawaban disimpan', date(selected.last_answer_saved_at)], ['Data perangkat', date(selected.client_context?.observed_at)],
                    ].map(([label, value]) => <div key={label}><dt className="text-xs text-slate-500">{label}</dt><dd className="mt-1 break-words text-slate-800">{value}</dd></div>)}</dl>
                    <h4 className="mb-3 font-semibold">Riwayat aktivitas</h4><p className="mb-3 text-xs text-slate-500">Catatan perangkat dan koneksi tidak selalu merupakan pelanggaran.</p>
                    <ol className="space-y-3">{[...(selected.monitoring_history || [])].sort((a,b) => Date.parse(b.at) - Date.parse(a.at)).map((event,index) => <li key={`${event.at}-${index}`} className="border-l-2 border-slate-200 pl-3"><div className="text-xs text-slate-500">{date(event.at)}</div><div className="mt-1">{monitoringEventLabels[event.type] || securityViolationLabel(event.type)}</div>{event.reason && <p className="mt-1 text-xs text-slate-500">{event.reason}</p>}</li>)}</ol>
                    {!selected.monitoring_history?.length && <p className="text-xs text-slate-500">Belum ada riwayat.</p>}
                    {onViewDetails && <button type="button" onClick={() => { onViewDetails(selected.id); setSelectedId(null); }} className="mt-6 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white">Buka rincian jawaban</button>}
                </div> : <p className="p-5 text-sm text-slate-500">Peserta tidak lagi ada dalam daftar ini. Tutup panel untuk melihat data terbaru.</p>}
            </div>
        </dialog>
    </section>;
}
