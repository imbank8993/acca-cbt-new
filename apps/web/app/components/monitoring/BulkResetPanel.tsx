'use client';

import { useEffect, useRef, useState } from 'react';
import type { ExamAttemptRecord } from '@/lib/api/proctor';
import { resetExamAttempt, startMakeupExam } from '@/lib/api/proctoring';
import { formatStudentName } from '@/lib/monitoring-health';
import { Button } from '@/app/components/ui/button';
import { ResetExamModal } from './ResetExamModal';
import { hasIrtScore } from '@/lib/irt-status';
import { Search, X } from 'lucide-react';

export function BulkResetPanel({ attempts, examDuration, onRefresh }: {
  attempts: ExamAttemptRecord[];
  examDuration?: number;
  onRefresh: () => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [batch, setBatch] = useState<ExamAttemptRecord[]>([]);
  const completed = useRef(new Set<string>());
  const [result, setResult] = useState('');
  const [progress, setProgress] = useState('');
  const panelRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const resize = () => {
      const available = window.innerHeight - Math.max(0, panel.getBoundingClientRect().top) - 24;
      const minHeight = Math.max(520, Math.round(window.innerHeight * 0.72));
      panel.style.height = `${Math.max(minHeight, available)}px`;
    };
    resize();
    const observer = new ResizeObserver(resize);
    if (panel.parentElement) observer.observe(panel.parentElement);
    window.addEventListener('resize', resize);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', resize);
    };
  }, []);
  const eligible = attempts.filter(a => a.canReset === true && ['submitted', 'auto_submitted'].includes(a.status));
  const query = search.trim().toLocaleLowerCase('id-ID');
  const visible = query
    ? eligible.filter(a => formatStudentName(a.profiles?.full_name).toLocaleLowerCase('id-ID').includes(query))
    : eligible;
  const chosen = eligible.filter(a => selected.includes(a.id));
  const allVisibleSelected = visible.length > 0 && visible.every(a => selected.includes(a.id));
  const toggleVisible = () => {
    const visibleIds = new Set(visible.map(a => a.id));
    setSelected(ids => allVisibleSelected
      ? ids.filter(id => !visibleIds.has(id))
      : Array.from(new Set([...ids, ...visible.map(a => a.id)])));
  };

  return (
    <section ref={panelRef} aria-label="Reset massal" className="mb-4 flex min-h-[520px] flex-col rounded-xl border border-slate-200 bg-white p-3.5 sm:p-4">
      {eligible.length === 0 ? (
        <p className="text-sm text-slate-500">Belum ada siswa yang dapat direset pada filter ini.</p>
      ) : <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-bold text-slate-800">Pilih siswa untuk direset</h2>
          <p className="mt-1 text-xs font-semibold text-blue-700">{eligible.length} tersedia · {chosen.length} terpilih</p>
        </div>
        <Button disabled={!chosen.length} onClick={() => {
          completed.current.clear();
          setResult('');
          setProgress('');
          setBatch(chosen);
        }}>Reset {chosen.length} siswa terpilih</Button>
      </div>
      <div className="mt-2.5 flex min-h-0 flex-1 flex-col">
          <div className="relative mb-2">
            <Search size={17} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              inputMode="search"
              aria-label="Cari nama siswa untuk direset"
              placeholder="Cari nama siswa..."
              value={search}
              onChange={event => setSearch(event.target.value)}
              className="h-10 w-full rounded-lg border border-slate-200 bg-white pl-10 pr-10 text-sm text-slate-800 outline-none placeholder:text-slate-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            />
            {search && <button type="button" aria-label="Hapus pencarian" onClick={() => setSearch('')}
              className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700">
              <X size={15} aria-hidden="true" />
            </button>}
          </div>
          <div className="mb-2 flex items-center justify-between gap-2 border-b border-slate-100 pb-2.5 text-xs sm:text-sm text-slate-700">
            <label className="flex min-w-0 items-center gap-2.5 font-medium cursor-pointer">
              <input type="checkbox" disabled={!visible.length} checked={allVisibleSelected} onChange={toggleVisible} />
              <span>Pilih semua siswa yang ditampilkan</span>
            </label>
            <span className="shrink-0 text-[11px] text-slate-500">{visible.length} tampil</span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain divide-y divide-slate-100">
            {visible.length === 0 && <p className="py-8 text-center text-sm text-slate-500">Nama siswa tidak ditemukan.</p>}
            {visible.map(a => <label key={a.id} className="flex cursor-pointer items-center justify-between gap-3 py-2.5 text-xs sm:text-sm hover:bg-slate-50/70">
              <span className="flex min-w-0 flex-1 items-center gap-2.5">
                <input type="checkbox" className="shrink-0" checked={selected.includes(a.id)} onChange={e => setSelected(ids => e.target.checked ? [...ids, a.id] : ids.filter(id => id !== a.id))} />
                <span className="min-w-0 flex-1">
                  <span className="block break-words font-semibold text-slate-800">{formatStudentName(a.profiles?.full_name)}</span>
                  <span className="mt-0.5 block truncate text-[11px] sm:text-xs text-slate-500">{a.profiles?.identity_number ? `${a.profiles.identity_number} · ` : ''}{a.kelas_name || '—'}</span>
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span className={a.status === 'auto_submitted' ? 'block text-xs font-semibold text-red-700' : 'block text-xs font-medium text-slate-600'}>
                  {a.status === 'auto_submitted' ? 'Ditutup otomatis' : 'Selesai'}
                </span>
                {a.status === 'auto_submitted' && (
                  <span className="mt-0.5 block text-[11px] font-medium text-red-600/80">Prioritas reset</span>
                )}
              </span>
            </label>)}
          </div>
      </div>
      </>}
      {result && <p role="status" className="mt-3 text-sm text-slate-700">{result}</p>}
      <ResetExamModal
        open={batch.length > 0}
        attempt={batch[0] || null}
        participantSummary={`${batch.length} siswa: ${batch.map(a => formatStudentName(a.profiles?.full_name)).join(', ')}. ${progress}`}
        examDuration={examDuration}
        irtScoredCount={batch.filter(hasIrtScore).length}
        onClose={() => { setBatch([]); onRefresh(); }}
        onConfirm={async (_id, mode, reason, duration, resumeClosed) => {
          const failures: string[] = [];
          for (const attempt of batch) {
            if (completed.current.has(attempt.id)) continue;
            try {
              const response = mode === 'SUSULAN'
                ? await startMakeupExam(attempt.id, reason, duration)
                : await resetExamAttempt(attempt.id, reason, duration, false, resumeClosed ? false : undefined, resumeClosed);
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
