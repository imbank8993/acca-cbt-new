'use client';

import { useState } from 'react';
import { TimerReset } from 'lucide-react';
import type { ExamAttemptRecord } from '@/lib/api/proctor';
import { extendExamAttemptTime } from '@/lib/api/proctoring';
import { confirmDialog } from '@/lib/confirm-dialog';
import { formatStudentName } from '@/lib/monitoring-health';
import { Button } from '@/app/components/ui/button';

export const EXTEND_QUICK_MINUTES = [5, 10, 15, 30] as const;

/** Siswa yang dapat diberi tambahan waktu: sedang mengerjakan, bukan mode kirim saja. */
export function extendableAttempts<T extends Pick<ExamAttemptRecord, 'canReset' | 'status' | 'metadata'>>(attempts: T[]): T[] {
    return attempts.filter(attempt => attempt.canReset === true && attempt.status === 'in_progress' &&
        attempt.metadata?.recovery_submit_only !== true);
}

function remainingLabel(attempt: ExamAttemptRecord): string {
    const seconds = attempt.remaining_seconds;
    if (typeof seconds !== 'number') return '—';
    if (seconds <= 0) return 'waktu habis';
    const minutes = Math.ceil(seconds / 60);
    return `sisa ${minutes} mnt`;
}

/**
 * Tambah waktu untuk banyak siswa sekaligus (mis. setelah listrik/jaringan ruang
 * padam). Hanya memperpanjang batas waktu; jawaban, status, dan catatan
 * pelanggaran tidak diubah. Perangkat siswa memuat ulang sendiri ke batas baru.
 */
export function BulkExtendTimePanel({ attempts, onRefresh }: { attempts: ExamAttemptRecord[]; onRefresh: () => void }) {
    const eligible = extendableAttempts(attempts)
        .sort((a, b) => String(a.profiles?.full_name || '').localeCompare(String(b.profiles?.full_name || ''), 'id'));
    const [selected, setSelected] = useState<string[]>([]);
    const [minutesInput, setMinutesInput] = useState('10');
    const [reason, setReason] = useState('');
    const [busy, setBusy] = useState(false);
    const [progress, setProgress] = useState('');
    const [result, setResult] = useState<{ ok: number; failures: string[] } | null>(null);
    const chosen = eligible.filter(attempt => selected.includes(attempt.id));
    const allSelected = eligible.length > 0 && chosen.length === eligible.length;
    const minutes = Number.parseInt(minutesInput, 10);
    const validMinutes = Number.isInteger(minutes) && minutes >= 1 && minutes <= 240;
    const validReason = reason.trim().length >= 5;

    const run = async () => {
        if (!chosen.length || !validMinutes || !validReason) return;
        const ok = await confirmDialog({
            title: `Tambah ${minutes} menit untuk ${chosen.length} siswa?`,
            text: 'Batas waktu tiap siswa diperpanjang dari batas waktunya saat ini. Jawaban dan catatan pelanggaran tidak berubah. Halaman ujian siswa memuat ulang sendiri.',
            confirmText: 'Ya, tambah waktu', cancelText: 'Batal',
        });
        if (!ok) return;
        setBusy(true); setResult(null);
        const failures: string[] = [];
        const failedIds: string[] = [];
        let done = 0;
        for (const attempt of chosen) {
            try {
                const response = await extendExamAttemptTime(attempt.id, minutes, reason.trim());
                if (!response.success) throw new Error('error' in response ? String(response.error) : 'Gagal memproses');
                done++;
            } catch (error) {
                failedIds.push(attempt.id);
                failures.push(`${formatStudentName(attempt.profiles?.full_name)}: ${error instanceof Error ? error.message : 'Gagal memproses'}`);
            }
            setProgress(`${done + failures.length} dari ${chosen.length} diproses…`);
        }
        setBusy(false); setProgress('');
        setResult({ ok: done, failures });
        setSelected(failedIds);
        onRefresh();
    };

    return <section aria-label="Tambah waktu" className="space-y-3 rounded-xl border border-slate-200 bg-white p-3.5 sm:p-4">
        <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600"><TimerReset size={18} aria-hidden="true" /></span>
            <div className="min-w-0">
                <h2 className="text-sm font-bold text-slate-800">Tambah waktu</h2>
                <p className="mt-1 text-xs leading-relaxed text-slate-500">
                    Untuk siswa yang <strong>sedang mengerjakan</strong>, mis. setelah listrik atau jaringan ruang padam. Batas waktu
                    diperpanjang dari batas saat ini; <strong>jawaban dan catatan pelanggaran tidak berubah</strong>. Siswa yang ujiannya
                    sudah ditutup memakai Pulihkan atau susulan.
                </p>
            </div>
        </div>

        {eligible.length === 0 ? <p className="rounded-lg bg-slate-50 px-3 py-4 text-center text-sm text-slate-500">
            Tidak ada siswa yang sedang mengerjakan dan dapat diberi tambahan waktu.
        </p> : <>
            <label className="flex items-center gap-2.5 border-b border-slate-100 pb-2 text-xs font-medium text-slate-700 sm:text-sm">
                <input type="checkbox" checked={allSelected} disabled={busy}
                    onChange={() => setSelected(allSelected ? [] : eligible.map(attempt => attempt.id))} />
                Pilih semua siswa yang sedang mengerjakan ({eligible.length})
            </label>
            <div className="max-h-[50vh] divide-y divide-slate-100 overflow-y-auto">
                {eligible.map(attempt => <label key={attempt.id} className="flex cursor-pointer items-center justify-between gap-3 py-2.5 text-xs hover:bg-slate-50/70 sm:text-sm">
                    <span className="flex min-w-0 flex-1 items-center gap-2.5">
                        <input type="checkbox" className="shrink-0" checked={selected.includes(attempt.id)} disabled={busy}
                            onChange={event => setSelected(ids => event.target.checked ? [...ids, attempt.id] : ids.filter(id => id !== attempt.id))} />
                        <span className="min-w-0 flex-1">
                            <span className="block truncate font-semibold text-slate-800">{formatStudentName(attempt.profiles?.full_name)}</span>
                            <span className="mt-0.5 block truncate text-[11px] text-slate-500 sm:text-xs">
                                {attempt.profiles?.identity_number ? `${attempt.profiles.identity_number} · ` : ''}{attempt.kelas_name || '—'}
                            </span>
                        </span>
                    </span>
                    <span className="shrink-0 text-xs tabular-nums text-slate-500">{remainingLabel(attempt)}</span>
                </label>)}
            </div>
            <div className="grid gap-3 sm:grid-cols-[auto_1fr]">
                <fieldset className="text-xs font-medium text-slate-600">
                    <legend>Tambahan waktu</legend>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        {EXTEND_QUICK_MINUTES.map(value => <button key={value} type="button" disabled={busy} aria-pressed={minutes === value}
                            onClick={() => setMinutesInput(String(value))}
                            className={`rounded-lg border px-3 py-2 text-xs font-semibold ${minutes === value ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-200 bg-white text-slate-600'}`}>
                            +{value}
                        </button>)}
                        <input type="number" min={1} max={240} value={minutesInput} disabled={busy} aria-label="Menit tambahan"
                            onChange={event => setMinutesInput(event.target.value)}
                            className="w-20 rounded-lg border border-slate-200 px-2 py-2 text-sm" />
                        <span>menit</span>
                    </div>
                </fieldset>
                <label className="block text-xs font-medium text-slate-600">Alasan (tercatat di riwayat)
                    <input value={reason} onChange={event => setReason(event.target.value)} maxLength={500} disabled={busy}
                        placeholder="Contoh: Listrik padam 10 menit di ruang 3"
                        className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800" />
                </label>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-slate-500">{chosen.length} dari {eligible.length} siswa dipilih{progress ? ` · ${progress}` : ''}
                    {!validReason && chosen.length > 0 ? ' · isi alasan (min. 5 huruf)' : ''}</p>
                <Button type="button" onClick={() => void run()} isLoading={busy} disabled={busy || !chosen.length || !validMinutes || !validReason}
                    leftIcon={<TimerReset size={15} />}>Tambah {validMinutes ? minutes : ''} menit untuk {chosen.length} siswa</Button>
            </div>
        </>}

        {result && <div role="status" className={`rounded-lg px-3 py-2 text-xs ${result.failures.length ? 'bg-amber-50 text-amber-900' : 'bg-emerald-50 text-emerald-800'}`}>
            <p className="font-semibold">{result.ok} siswa mendapat tambahan waktu.</p>
            {result.failures.length > 0 && <ul className="mt-1 list-disc pl-4">{result.failures.map(item => <li key={item}>{item}</li>)}</ul>}
        </div>}
    </section>;
}
