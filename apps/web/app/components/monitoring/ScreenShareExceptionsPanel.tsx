'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Loader2, ShieldCheck } from 'lucide-react';
import { alertDialog } from '@/lib/confirm-dialog';
import { setExamScreenShareExceptionAction, type ExamAttemptRecord } from '@/lib/api/proctor';
import { formatStudentName } from '@/lib/monitoring-health';

export function ScreenShareExceptionsPanel({ examId, attempts, onChanged }: {
    examId: string;
    attempts: ExamAttemptRecord[];
    onChanged: () => void;
}) {
    const participants = useMemo(() => [...new Map(attempts.filter(row => row.user_id).map(row => [row.user_id, row])).values()]
        .sort((a, b) => formatStudentName(a.profiles?.full_name, '').localeCompare(formatStudentName(b.profiles?.full_name, ''))), [attempts]);
    const [studentId, setStudentId] = useState('');
    const [reason, setReason] = useState('');
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        if (!participants.some(row => row.user_id === studentId)) setStudentId(participants[0]?.user_id || '');
    }, [participants, studentId]);

    const selected = participants.find(row => row.user_id === studentId);
    const exception = selected?.screen_share_exception || null;
    const active = selected?.status === 'in_progress';

    useEffect(() => { setReason(exception?.reason || ''); }, [studentId, exception?.reason]);

    if (participants.length === 0) return null;

    async function save() {
        if (!selected || busy) return;
        const enabled = !exception;
        if (enabled && !reason.trim()) {
            await alertDialog({ title: 'Alasan diperlukan', text: 'Tuliskan alasan pemberian pengecualian untuk peserta ini.', variant: 'danger' });
            return;
        }
        setBusy(true);
        try {
            const result = await setExamScreenShareExceptionAction(examId, selected.user_id, enabled, reason.trim());
            if (!result.success) {
                await alertDialog({ title: 'Pengecualian belum tersimpan', text: result.error || 'Silakan coba lagi.', variant: 'danger' });
                return;
            }
            onChanged();
        } finally {
            setBusy(false);
        }
    }

    return (
        <details className="rounded-xl border border-amber-200 bg-white shadow-sm">
            <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-semibold text-slate-800">
                <ShieldCheck size={17} className="text-amber-600" />
                Pengecualian berbagi layar
                <span className="ml-auto rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
                    {participants.filter(row => row.screen_share_exception).length} peserta
                </span>
            </summary>
            <div className="border-t border-amber-100 p-4">
                <p className="mb-3 flex items-start gap-2 text-xs leading-relaxed text-slate-600">
                    <AlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-600" />
                    Pengecualian hanya berlaku untuk peserta terpilih pada ujian ini. Alasannya dicatat; aturan ujian lainnya tetap berlaku.
                </p>
                <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto] md:items-end">
                    <label className="block text-xs font-semibold text-slate-600">
                        Peserta
                        <select value={studentId} onChange={event => setStudentId(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-slate-800">
                            {participants.map(row => <option key={row.user_id} value={row.user_id}>{formatStudentName(row.profiles?.full_name, 'Tanpa Nama')} · {row.kelas_name || '-'}</option>)}
                        </select>
                    </label>
                    <label className="block text-xs font-semibold text-slate-600">
                        Alasan
                        <input value={reason} maxLength={240} onChange={event => setReason(event.target.value)} disabled={Boolean(exception)} placeholder="Contoh: perangkat tidak mendukung berbagi layar" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal text-slate-800 disabled:bg-slate-100" />
                    </label>
                    <button type="button" onClick={() => void save()} disabled={busy || !selected || (Boolean(exception) && active) || (!exception && !reason.trim())} className={`rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 ${exception ? 'bg-slate-600 hover:bg-slate-700' : 'bg-amber-600 hover:bg-amber-700'}`}>
                        {busy ? <Loader2 size={16} className="animate-spin" /> : exception ? 'Cabut pengecualian' : 'Beri pengecualian'}
                    </button>
                </div>
                {exception && <p className="mt-2 text-xs text-emerald-700">Pengecualian aktif: {exception.reason}{active ? ' · tidak dapat dicabut selama peserta sedang mengerjakan' : ''}</p>}
            </div>
        </details>
    );
}
