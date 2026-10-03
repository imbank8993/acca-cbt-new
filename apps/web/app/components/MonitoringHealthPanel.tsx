"use client";
import { useEffect, useState } from 'react';
import type { ExamAttemptRecord } from '@/lib/api/proctor';
import { gradingLabel, monitoringAttention, monitoringEventLabels, storageLabels } from '@/lib/monitoring-health';
import { formatSchoolDateTime, getSchoolTimeZone } from '@/lib/school-time';

export function MonitoringHealthPanel({ attempts, onRecover }: {
    attempts: ExamAttemptRecord[];
    onRecover?: (id: string, name: string) => Promise<void>;
}) {
    const [onlyAttention, setOnlyAttention] = useState(false);
    const [elapsed, setElapsed] = useState(0);
    const [zone, setZone] = useState<string | null>(null);
    const [historyId, setHistoryId] = useState<string | null>(null);
    const [page, setPage] = useState(1);
    const sampledAt = attempts[0]?.server_now;
    useEffect(() => {
        let alive = true;
        void getSchoolTimeZone().then(value => { if (alive) setZone(value); }).catch(() => undefined);
        return () => { alive = false; };
    }, []);
    useEffect(() => {
        const started = performance.now();
        const tick = () => setElapsed(Math.floor((performance.now() - started) / 1000));
        const timer = setInterval(tick, 1000);
        return () => clearInterval(timer);
    }, [sampledAt]);
    const date = (value?: string | null) => !value ? 'Belum tercatat' : zone
        ? formatSchoolDateTime(value, zone) : `${new Date(value).toISOString()} (UTC)`;
    const needingAttention = attempts.filter(attempt => monitoringAttention(attempt, elapsed).length > 0);
    const rows = (onlyAttention ? needingAttention : attempts).slice().sort((a, b) =>
        monitoringAttention(b, elapsed).length - monitoringAttention(a, elapsed).length);
    const pageCount = Math.max(1, Math.ceil(rows.length / 25));
    const currentPage = Math.min(page, pageCount);
    const visibleRows = rows.slice((currentPage - 1) * 25, currentPage * 25);
    return <section className="my-5 rounded-xl border border-slate-200 bg-white p-4 text-slate-800" aria-label="Keamanan jawaban dan waktu ujian">
        <div className="flex flex-wrap items-center justify-between gap-3">
            <div><h2 className="font-bold">Jawaban & waktu ujian</h2>
                <p className="text-xs text-slate-500">{needingAttention.length} peserta perlu perhatian · Snapshot server: {date(attempts[0]?.server_now)}</p></div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={onlyAttention} onChange={event => { setOnlyAttention(event.target.checked); setPage(1); }} />Hanya perlu perhatian</label>
        </div>
        <p className="my-3 text-xs text-slate-500">Jumlah tersimpan berasal dari server. Jawaban lokal dan antrean kiriman adalah laporan terakhir perangkat; tidak dapat dipastikan selama perangkat tidak terhubung.</p>
        <div className="overflow-x-auto"><table className="w-full min-w-[850px] text-left text-xs">
            <thead><tr className="border-b bg-slate-50"><th className="p-2">Peserta</th><th className="p-2">Jawaban server</th><th className="p-2">Laporan perangkat</th><th className="p-2">Waktu & koneksi</th><th className="p-2">Status & riwayat</th></tr></thead>
            <tbody>{visibleRows.map(attempt => {
                const health = attempt.sync_health;
                const reasons = monitoringAttention(attempt, elapsed);
                const remaining = attempt.remaining_seconds == null ? null : Math.max(0, attempt.remaining_seconds - elapsed);
                const reportAge = health && attempt.server_now ? (Date.parse(attempt.server_now) - Date.parse(health.receivedAt)) / 1000 + elapsed : Infinity;
                const fresh = health?.fresh && reportAge <= 45;
                return <tr key={attempt.id} className={`border-b align-top ${reasons.length ? 'bg-amber-50/60' : ''}`}>
                    <td className="p-2"><strong>{attempt.profiles?.full_name || 'Tanpa nama'}</strong><div>{attempt.profiles?.identity_number || '—'} · {attempt.kelas_name || '—'}</div></td>
                    <td className="p-2"><strong>{attempt.saved_answer_count ?? '—'} / {attempt.total_questions ?? '—'} soal</strong><div>Kosong di server: {attempt.unanswered_count ?? '—'}</div><div className="mt-1 text-slate-500">Simpan terakhir: {date(attempt.last_answer_saved_at)}</div></td>
                    <td className="p-2">{health ? <><div>Terakhir dilaporkan: {health.localAnswerCount} terisi lokal</div><div>{health.pendingAnswerCount} perubahan belum terkirim</div><div>Penyimpanan: {storageLabels[health.storageState]}</div><div className="mt-1 text-slate-500">{date(health.receivedAt)}{!fresh && ' · Laporan lama'}</div></> : 'Belum ada laporan perangkat'}</td>
                    <td className="p-2"><strong>{attempt.status === 'in_progress' && remaining !== null ? `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}` : '—'}</strong><div>Tenggat: {date(attempt.deadline_at)}</div><div>{attempt.status !== 'in_progress' ? 'Sesi tidak aktif' : elapsed > 45 ? 'Data perlu diperbarui' : attempt.connection_status === 'online' ? 'Terakhir terhubung' : 'Tidak ada kabar terbaru'}</div><div className="text-slate-500">{date(attempt.last_seen_at)}</div></td>
                    <td className="p-2"><strong>{gradingLabel(attempt)}</strong>{reasons.map(reason => <div key={reason} className="mt-1 text-amber-800">{reason}</div>)}
                        <details className="mt-2" open={historyId === attempt.id} onToggle={event => {
                            if (event.currentTarget.open) setHistoryId(attempt.id);
                            else setHistoryId(current => current === attempt.id ? null : current);
                        }}><summary className="cursor-pointer text-blue-700">Riwayat ({attempt.monitoring_history?.length || 0})</summary>
                            <p className="my-2 text-slate-500">Riwayat koneksi adalah pengamatan berkala, bukan rekaman setiap detik. Data lama mungkin belum tersedia.</p>
                            {historyId === attempt.id && <ol className="max-h-60 space-y-2 overflow-auto">{attempt.monitoring_history?.map((event, index) => <li key={`${event.at}:${index}`} className="border-l-2 pl-2">
                                <strong>{monitoringEventLabels[event.type] || event.type}</strong><div>{date(event.at)}</div>
                                {event.actor_id && <div>Oleh: {event.actor_name || event.actor_id}</div>}{event.reason && <div>Alasan: {event.reason}</div>}
                                {event.recovery_until && <div>Tenggat baru: {date(event.recovery_until)}</div>}
                                {event.gap_seconds != null && <div>Jeda tanpa kabar: {event.gap_seconds} detik (perkiraan)</div>}
                                {event.pending_answer_count != null && <div>Dilaporkan belum terkirim: {event.pending_answer_count}</div>}
                            </li>)}</ol>}
                        </details>
                        {onRecover && ['submitted', 'auto_submitted'].includes(attempt.status) && <button className="mt-2 rounded border border-blue-300 px-2 py-1 text-blue-700" onClick={() => void onRecover(attempt.id, attempt.profiles?.full_name || 'Siswa')}>Susulan / Pulihkan</button>}
                    </td>
                </tr>;
            })}</tbody>
        </table></div>
        {pageCount > 1 && <div className="mt-3 flex items-center justify-between text-xs"><span>Halaman {currentPage} / {pageCount} · {rows.length} peserta</span><div className="flex gap-3"><button disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>Sebelumnya</button><button disabled={currentPage >= pageCount} onClick={() => setPage(currentPage + 1)}>Berikutnya</button></div></div>}
        {!rows.length && <p className="py-4 text-sm text-slate-500">{onlyAttention ? 'Tidak ada peserta pada filter ini.' : 'Data monitoring belum tersedia.'}</p>}
    </section>;
}
