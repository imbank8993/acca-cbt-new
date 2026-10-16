'use client';
import { useEffect, useState } from 'react';
import { apiGet } from '@/lib/api/client';
import { useSchoolTimeZone } from '@/lib/useSchoolTimeZone';
import { securityViolationLabel } from '@/lib/security-violations';

interface Evidence { id: string; event_type: string; created_at: string; expires_at: string; available: boolean }
export function AttemptScreenshots({ attemptId }: { attemptId: string }) {
    const { timeZone } = useSchoolTimeZone();
    const [state, setState] = useState<{ attemptId: string; rows: Evidence[]; error: string } | null>(null);
    useEffect(() => {
        let active = true;
        if (!attemptId || attemptId.startsWith('unstarted-')) return;
        void apiGet<{ screenshots: Evidence[] }>(`/api/proctoring/attempts/${encodeURIComponent(attemptId)}/screenshots`)
            .then(result => { if (active) setState({ attemptId, rows: result.success ? result.screenshots : [], error: result.success ? '' : result.error }); })
            .catch(() => { if (active) setState({ attemptId, rows: [], error: 'Bukti screenshot belum dapat dimuat.' }); });
        return () => { active = false; };
    }, [attemptId]);
    if (!attemptId || attemptId.startsWith('unstarted-')) return null;
    const current = state?.attemptId === attemptId ? state : null;
    return <section className="mt-5 border-t border-slate-200 pt-4" aria-label="Bukti screenshot">
        <h3 className="text-sm font-semibold text-slate-800">Bukti Screenshot</h3>
        <p className="mt-1 text-xs text-slate-500">Indikasi untuk diperiksa pengawas. Maksimal 10 gambar per peserta, dihapus setelah 7 hari.</p>
        {!current && <p className="mt-3 text-xs text-slate-500">Memuat bukti...</p>}
        {current?.error && <p role="alert" className="mt-3 text-xs text-red-600">{current.error}</p>}
        {current && !current.error && current.rows.length === 0 && <p className="mt-3 text-xs text-slate-500">Belum ada screenshot tersimpan.</p>}
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {current?.rows.map(row => <article key={row.id} className="overflow-hidden rounded-lg border border-slate-200">
                {row.available ? <a href={`/api/proctoring/screenshots/${encodeURIComponent(row.id)}/image`} target="_blank" rel="noopener noreferrer">
                    {/* Authenticated image route; Next image optimization must not cache private evidence. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img loading="lazy" src={`/api/proctoring/screenshots/${encodeURIComponent(row.id)}/image`} alt={`Screenshot: ${securityViolationLabel(row.event_type)}`} className="max-h-56 w-full object-contain bg-slate-100" />
                </a> : <p className="p-4 text-xs text-slate-500">Masa simpan gambar telah berakhir.</p>}
                <div className="space-y-1 p-3 text-xs text-slate-600">
                    <p className="font-semibold">{securityViolationLabel(row.event_type)}</p>
                    <time dateTime={row.created_at}>{new Date(row.created_at).toLocaleString('id-ID', { timeZone })}</time>
                </div>
            </article>)}
        </div>
    </section>;
}
