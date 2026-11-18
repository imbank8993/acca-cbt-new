'use client';

import { useState } from 'react';
import { CloudUpload } from 'lucide-react';
import type { ExamAttemptRecord } from '@/lib/api/proctor';
import { resetExamAttempt } from '@/lib/api/proctoring';
import { confirmDialog } from '@/lib/confirm-dialog';
import { formatStudentName } from '@/lib/monitoring-health';
import { pendingRecoveryCandidates, uncountedAnswers } from '@/lib/pending-recovery';
import { Button } from '@/app/components/ui/button';

/** Mode "kirim salinan saja": server mewajibkan minimal 60 menit. */
export const PENDING_RECOVERY_MINUTES = [60, 120] as const;
const DEFAULT_REASON = 'Mengirim jawaban lokal yang tertahan di perangkat';

/**
 * Pulihkan massal khusus jawaban tertahan: membuka kembali pengerjaan dalam
 * mode kirim-salinan-saja (siswa tidak dapat mengubah jawaban) di perangkat yang
 * sama. Tidak ada pilihan susulan atau penghapusan jawaban, jadi aman diklik.
 */
export function BulkPendingRecoveryPanel({ attempts, onRefresh }: { attempts: ExamAttemptRecord[]; onRefresh: () => void }) {
    const { confirmed, possible } = pendingRecoveryCandidates(attempts);
    // Yang terkonfirmasi tercentang otomatis; "mungkin tertahan" dipilih manual.
    const [selected, setSelected] = useState<string[]>(() => confirmed.map(attempt => attempt.id));
    const [reason, setReason] = useState(DEFAULT_REASON);
    const [minutes, setMinutes] = useState<number>(PENDING_RECOVERY_MINUTES[0]);
    const [busy, setBusy] = useState(false);
    const [progress, setProgress] = useState('');
    const [result, setResult] = useState<{ ok: number; failures: string[] } | null>(null);
    const listed = [...confirmed, ...possible];
    const chosen = listed.filter(attempt => selected.includes(attempt.id));
    const toggle = (id: string, checked: boolean) => setSelected(ids => checked ? [...ids, id] : ids.filter(item => item !== id));

    const run = async () => {
        if (!chosen.length || !reason.trim()) return;
        const ok = await confirmDialog({
            title: `Pulihkan ${chosen.length} peserta?`,
            text: `Pengerjaan dibuka kembali selama ${minutes} menit dalam mode kirim salinan saja. Siswa membuka ujian di perangkat yang sama; jawaban lokal terkirim otomatis dan jawaban tidak dapat diubah.`,
            confirmText: 'Ya, pulihkan', cancelText: 'Batal',
        });
        if (!ok) return;
        setBusy(true); setResult(null);
        const failures: string[] = [];
        const failedIds: string[] = [];
        let done = 0;
        for (const attempt of chosen) {
            try {
                const response = await resetExamAttempt(attempt.id, reason.trim(), minutes, false, true);
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
        // Yang gagal tetap tercentang untuk dicoba ulang.
        setSelected(failedIds);
        onRefresh();
    };

    const row = (attempt: ExamAttemptRecord, possibleOnly: boolean) => <label key={attempt.id}
        className="flex cursor-pointer items-center justify-between gap-3 py-2.5 text-xs hover:bg-slate-50/70 sm:text-sm">
        <span className="flex min-w-0 flex-1 items-center gap-2.5">
            <input type="checkbox" className="shrink-0" checked={selected.includes(attempt.id)} disabled={busy}
                onChange={event => toggle(attempt.id, event.target.checked)} />
            <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold text-slate-800">{formatStudentName(attempt.profiles?.full_name)}</span>
                <span className="mt-0.5 block truncate text-[11px] text-slate-500 sm:text-xs">
                    {attempt.profiles?.identity_number ? `${attempt.profiles.identity_number} · ` : ''}{attempt.kelas_name || '—'}
                </span>
            </span>
        </span>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${possibleOnly ? 'bg-slate-100 text-slate-600' : 'bg-amber-100 text-amber-800'}`}>
            {possibleOnly ? 'Tanpa kontak saat ditutup' : `${uncountedAnswers(attempt)} jawaban tertahan`}
        </span>
    </label>;

    return <section aria-label="Pulihkan jawaban tertunda" className="space-y-3 rounded-xl border border-slate-200 bg-white p-3.5 sm:p-4">
        <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600"><CloudUpload size={18} aria-hidden="true" /></span>
            <div className="min-w-0">
                <h2 className="text-sm font-bold text-slate-800">Pulihkan jawaban tertunda</h2>
                <p className="mt-1 text-xs leading-relaxed text-slate-500">
                    Untuk peserta yang jawabannya masih tersimpan di perangkat tetapi belum masuk server. Pengerjaan dibuka kembali
                    dalam mode <strong>kirim salinan saja</strong>: siswa membuka ujian di <strong>perangkat yang sama</strong>, jawaban
                    terkirim otomatis, dan jawaban tidak dapat diubah.
                </p>
            </div>
        </div>

        {listed.length === 0 ? <p className="rounded-lg bg-slate-50 px-3 py-4 text-center text-sm text-slate-500">
            Tidak ada peserta dengan jawaban tertahan pada filter ini. Jawaban tertahan baru terdeteksi setelah perangkat siswa sempat online kembali.
        </p> : <>
            <div className="divide-y divide-slate-100 rounded-lg border border-slate-100 px-3">
                {confirmed.length > 0 && <p className="pt-2.5 text-[11px] font-bold uppercase tracking-wide text-amber-700">Dilaporkan perangkat ({confirmed.length})</p>}
                {confirmed.map(attempt => row(attempt, false))}
                {possible.length > 0 && <p className="pt-2.5 text-[11px] font-bold uppercase tracking-wide text-slate-500">Mungkin tertahan · pilih bila perlu ({possible.length})</p>}
                {possible.map(attempt => row(attempt, true))}
            </div>
            <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                <label className="block text-xs font-medium text-slate-600">Alasan (tercatat di riwayat)
                    <input value={reason} onChange={event => setReason(event.target.value)} maxLength={300} disabled={busy}
                        className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800" />
                </label>
                <fieldset className="text-xs font-medium text-slate-600">
                    <legend>Lama dibuka</legend>
                    <div className="mt-1 flex gap-1.5">
                        {PENDING_RECOVERY_MINUTES.map(value => <button key={value} type="button" aria-pressed={minutes === value} disabled={busy}
                            onClick={() => setMinutes(value)}
                            className={`rounded-lg border px-3 py-2 text-xs font-semibold ${minutes === value ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-200 bg-white text-slate-600'}`}>
                            {value} menit
                        </button>)}
                    </div>
                </fieldset>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-slate-500">{chosen.length} dari {listed.length} peserta dipilih{progress ? ` · ${progress}` : ''}</p>
                <Button type="button" onClick={() => void run()} isLoading={busy} disabled={busy || !chosen.length || !reason.trim()}
                    leftIcon={<CloudUpload size={15} />}>Pulihkan {chosen.length} peserta</Button>
            </div>
        </>}

        {result && <div role="status" className={`rounded-lg px-3 py-2 text-xs ${result.failures.length ? 'bg-amber-50 text-amber-900' : 'bg-emerald-50 text-emerald-800'}`}>
            <p className="font-semibold">{result.ok} peserta dibuka kembali. Minta mereka membuka ujian di perangkat yang sama agar jawaban terkirim.</p>
            {result.failures.length > 0 && <ul className="mt-1 list-disc pl-4">{result.failures.map(item => <li key={item}>{item}</li>)}</ul>}
        </div>}
    </section>;
}
