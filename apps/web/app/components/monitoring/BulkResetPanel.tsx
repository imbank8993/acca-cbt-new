'use client';

import { useRef, useState } from 'react';
import type { ExamAttemptRecord } from '@/lib/api/proctor';
import { resetExamAttempt, startMakeupExam } from '@/lib/api/proctoring';
import { formatStudentName } from '@/lib/monitoring-health';
import { Button } from '@/app/components/ui/button';
import { ResetExamModal } from './ResetExamModal';

export function BulkResetPanel({ attempts, examDuration, onRefresh }: {
  attempts: ExamAttemptRecord[];
  examDuration?: number;
  onRefresh: () => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [batch, setBatch] = useState<ExamAttemptRecord[]>([]);
  const completed = useRef(new Set<string>());
  const [result, setResult] = useState('');
  const [progress, setProgress] = useState('');
  const eligible = attempts.filter(a => a.canReset === true && ['submitted', 'auto_submitted'].includes(a.status));
  const chosen = eligible.filter(a => selected.includes(a.id));
  const allSelected = eligible.length > 0 && chosen.length === eligible.length;

  return (
    <section className="mb-4 rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold text-slate-800">Reset massal</h2>
          <p className="text-xs text-slate-500">Siswa ditutup otomatis diprioritaskan di atas. Daftar mengikuti filter monitoring.</p>
        </div>
        <Button disabled={!chosen.length} onClick={() => {
          completed.current.clear();
          setResult('');
          setProgress('');
          setBatch(chosen);
        }}>Reset {chosen.length} siswa terpilih</Button>
      </div>
      <details className="mt-3" open>
        <summary className="cursor-pointer text-sm font-semibold text-blue-700">Pilih siswa ({eligible.length} tersedia, {chosen.length} terpilih)</summary>
        {eligible.length > 0 ? <>
          <label className="my-3 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={allSelected} onChange={() => setSelected(allSelected ? [] : eligible.map(a => a.id))} />
            Pilih semua siswa dalam filter
          </label>
          <div className="max-h-72 overflow-y-auto divide-y divide-slate-100">
            {eligible.map(a => <label key={a.id} className="flex cursor-pointer items-center gap-3 py-2 text-sm">
              <input type="checkbox" checked={selected.includes(a.id)} onChange={e => setSelected(ids => e.target.checked ? [...ids, a.id] : ids.filter(id => id !== a.id))} />
              <span className="min-w-0 flex-1"><span className="font-medium">{formatStudentName(a.profiles?.full_name)}</span><span className="block text-xs text-slate-500">{a.kelas_name || '—'} · {a.profiles?.identity_number || '—'}</span></span>
              <span className={a.status === 'auto_submitted' ? 'text-xs font-semibold text-red-700' : 'text-xs text-slate-500'}>{a.status === 'auto_submitted' ? 'Ditutup otomatis · prioritas reset' : 'Selesai'}</span>
            </label>)}
          </div>
        </> : <p className="mt-3 text-sm text-slate-500">Tidak ada siswa yang dapat direset dalam filter ini.</p>}
      </details>
      {result && <p role="status" className="mt-3 text-sm text-slate-700">{result}</p>}
      <ResetExamModal
        open={batch.length > 0}
        attempt={batch[0] || null}
        participantSummary={`${batch.length} siswa: ${batch.map(a => formatStudentName(a.profiles?.full_name)).join(', ')}. ${progress}`}
        examDuration={examDuration}
        onClose={() => { setBatch([]); onRefresh(); }}
        onConfirm={async (_id, mode, reason, duration) => {
          const failures: string[] = [];
          for (const attempt of batch) {
            if (completed.current.has(attempt.id)) continue;
            try {
              const response = mode === 'SUSULAN'
                ? await startMakeupExam(attempt.id, reason, duration)
                : await resetExamAttempt(attempt.id, reason, duration);
              if (!response.success) throw new Error('error' in response ? String(response.error) : 'Gagal memproses');
              completed.current.add(attempt.id);
            } catch (error) {
              failures.push(`${formatStudentName(attempt.profiles?.full_name)}: ${error instanceof Error ? error.message : 'Gagal memproses'}`);
            }
            setProgress(`${completed.current.size} dari ${batch.length} berhasil.`);
          }
          setSelected(ids => ids.filter(id => !completed.current.has(id)));
          setResult(`${completed.current.size} siswa berhasil direset. ${failures.length} siswa gagal.`);
          if (failures.length) throw new Error(`${failures.join('; ')}. Konfirmasi kembali untuk mencoba siswa yang gagal saja, atau tutup untuk memuat ulang data.`);
        }}
      />
    </section>
  );
}
