'use client';

import { useMemo, useState } from 'react';
import { AlertTriangle, Loader2, Search, ShieldCheck } from 'lucide-react';
import { alertDialog } from '@/lib/confirm-dialog';
import { setExamScreenShareExceptionAction, type ExamAttemptRecord } from '@/lib/api/proctor';
import { formatStudentName } from '@/lib/monitoring-health';

const FINISHED_STATUSES = ['completed', 'submitted', 'auto_submitted', 'graded'];

function statusLabel(status?: string | null): { text: string; className: string } {
    if (status === 'in_progress') return { text: 'Mengerjakan', className: 'bg-blue-50 text-blue-700' };
    if (status && FINISHED_STATUSES.includes(status)) return { text: 'Selesai', className: 'bg-slate-100 text-slate-600' };
    return { text: 'Belum mulai', className: 'bg-slate-50 text-slate-500' };
}

export function ScreenShareExceptionsPanel({ examId, attempts, onChanged }: {
    examId: string;
    attempts: ExamAttemptRecord[];
    onChanged: () => void;
}) {
    // Satu baris per siswa; yang sudah dikecualikan tampil paling atas.
    const participants = useMemo(() => [...new Map(attempts.filter(row => row.user_id).map(row => [row.user_id, row])).values()]
        .sort((a, b) => Number(Boolean(b.screen_share_exception)) - Number(Boolean(a.screen_share_exception))
            || formatStudentName(a.profiles?.full_name, '').localeCompare(formatStudentName(b.profiles?.full_name, ''))), [attempts]);
    const [query, setQuery] = useState('');
    const [reasons, setReasons] = useState<Record<string, string>>({});
    const [busyId, setBusyId] = useState<string | null>(null);

    const exceptedCount = participants.filter(row => row.screen_share_exception).length;
    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return participants;
        return participants.filter(row =>
            formatStudentName(row.profiles?.full_name, '').toLowerCase().includes(q)
            || (row.kelas_name || '').toLowerCase().includes(q));
    }, [participants, query]);

    if (participants.length === 0) {
        return (
            <section className="rounded-xl border border-amber-200 bg-white p-6 text-center text-sm text-slate-500 shadow-sm">
                Belum ada peserta pada ujian ini.
            </section>
        );
    }

    async function save(row: ExamAttemptRecord) {
        if (busyId) return;
        const enabled = !row.screen_share_exception;
        const reason = (reasons[row.user_id] || '').trim();
        if (enabled && !reason) {
            await alertDialog({ title: 'Alasan diperlukan', text: 'Tuliskan alasan pemberian pengecualian untuk peserta ini.', variant: 'danger' });
            return;
        }
        setBusyId(row.user_id);
        try {
            const result = await setExamScreenShareExceptionAction(examId, row.user_id, enabled, enabled ? reason : (row.screen_share_exception?.reason || ''));
            if (!result.success) {
                await alertDialog({ title: 'Pengecualian belum tersimpan', text: result.error || 'Silakan coba lagi.', variant: 'danger' });
                return;
            }
            setReasons(prev => { const next = { ...prev }; delete next[row.user_id]; return next; });
            onChanged();
        } finally {
            setBusyId(null);
        }
    }

    return (
        <section className="rounded-xl border border-amber-200 bg-white shadow-sm">
            <header className="flex items-center gap-2 px-4 py-3 text-sm font-semibold text-slate-800">
                <ShieldCheck size={17} className="text-amber-600" />
                Pengecualian berbagi layar
                <span className="ml-auto rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
                    {exceptedCount} dari {participants.length} peserta dikecualikan
                </span>
            </header>
            <div className="border-t border-amber-100 p-4">
                <p className="mb-3 flex items-start gap-2 text-xs leading-relaxed text-slate-600">
                    <AlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-600" />
                    Pengecualian hanya berlaku untuk peserta terpilih pada ujian ini. Alasannya dicatat; aturan ujian lainnya tetap berlaku.
                </p>
                <label className="relative mb-3 block">
                    <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Cari nama siswa atau kelas"
                        className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm text-slate-800" />
                </label>

                <div className="max-h-[60vh] overflow-y-auto rounded-lg border border-slate-200">
                    {filtered.length === 0 ? (
                        <p className="p-6 text-center text-sm text-slate-400">Tidak ada peserta yang cocok dengan pencarian.</p>
                    ) : (
                        <ul className="divide-y divide-slate-100">
                            {filtered.map(row => {
                                const exception = row.screen_share_exception || null;
                                const active = row.status === 'in_progress';
                                const status = statusLabel(row.status);
                                const reason = reasons[row.user_id] || '';
                                const busy = busyId === row.user_id;
                                return (
                                    <li key={row.user_id} className={`grid gap-2 px-3 py-2.5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_auto] md:items-center ${exception ? 'bg-emerald-50/50' : ''}`}>
                                        <div className="min-w-0">
                                            <div className="truncate text-sm font-medium text-slate-800">{formatStudentName(row.profiles?.full_name, 'Tanpa Nama')}</div>
                                            <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-500">
                                                <span>{row.kelas_name || '-'}</span>
                                                <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${status.className}`}>{status.text}</span>
                                            </div>
                                        </div>
                                        {exception ? (
                                            <div className="min-w-0 text-xs text-emerald-800">
                                                <span className="font-semibold">Dikecualikan:</span> {exception.reason}
                                                {active && <span className="block text-slate-500">Tidak dapat dicabut selama peserta sedang mengerjakan.</span>}
                                            </div>
                                        ) : (
                                            <input value={reason} maxLength={240} aria-label={`Alasan pengecualian untuk ${formatStudentName(row.profiles?.full_name, 'peserta')}`}
                                                onChange={event => setReasons(prev => ({ ...prev, [row.user_id]: event.target.value }))}
                                                onKeyDown={event => { if (event.key === 'Enter' && reason.trim()) void save(row); }}
                                                placeholder="Alasan, mis. perangkat tidak mendukung berbagi layar"
                                                className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-800" />
                                        )}
                                        <button type="button" onClick={() => void save(row)}
                                            disabled={Boolean(busyId) || (Boolean(exception) && active) || (!exception && !reason.trim())}
                                            className={`inline-flex min-w-[96px] items-center justify-center rounded-lg px-3 py-1.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 ${exception ? 'bg-slate-600 hover:bg-slate-700' : 'bg-amber-600 hover:bg-amber-700'}`}>
                                            {busy ? <Loader2 size={14} className="animate-spin" /> : exception ? 'Cabut' : 'Beri pengecualian'}
                                        </button>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </div>
            </div>
        </section>
    );
}
