'use client';
import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { apiGet, apiSend } from '@/lib/api/client';
import { confirmDialog } from '@/lib/confirm-dialog';
import { useSchoolTimeZone } from '@/lib/useSchoolTimeZone';
import { securityViolationLabel } from '@/lib/security-violations';

interface Evidence { id: string; event_type: string; created_at: string; expires_at: string; available: boolean; deleted_at?: string | null; byte_size?: number | null }
export function AttemptScreenshots({ attemptId }: { attemptId: string }) {
    const { timeZone } = useSchoolTimeZone();
    const [state, setState] = useState<{ attemptId: string; rows: Evidence[]; canDelete: boolean; error: string } | null>(null);
    const [deleting, setDeleting] = useState<string | null>(null);
    const [reload, setReload] = useState(0);
    useEffect(() => {
        let active = true;
        if (!attemptId || attemptId.startsWith('unstarted-')) return;
        const load = () => apiGet<{ screenshots: Evidence[]; canDelete?: boolean }>(`/api/proctoring/attempts/${encodeURIComponent(attemptId)}/screenshots`)
            .then(result => { if (active) setState({ attemptId, rows: result.success ? result.screenshots : [], canDelete: result.success && result.canDelete === true, error: result.success ? '' : result.error }); })
            .catch(() => { if (active) setState({ attemptId, rows: [], canDelete: false, error: 'Bukti screenshot belum dapat dimuat.' }); });
        void load();
        const timer = window.setInterval(() => { void load(); }, 10_000);
        return () => { active = false; window.clearInterval(timer); };
    }, [attemptId, reload]);
    if (!attemptId || attemptId.startsWith('unstarted-')) return null;
    const current = state?.attemptId === attemptId ? state : null;
    const storedBytes = (current?.rows || []).reduce((total, row) => total + (row.available ? Number(row.byte_size) || 0 : 0), 0);
    const remove = async (row: Evidence) => {
        const ok = await confirmDialog({
            title: 'Hapus screenshot?',
            text: 'Gambar dihapus permanen dan tidak dapat dikembalikan. Catatan kejadiannya tetap tersimpan.',
            confirmText: 'Ya, hapus', cancelText: 'Batal', variant: 'danger',
        });
        if (!ok) return;
        setDeleting(row.id);
        const result = await apiSend(`/api/proctoring/screenshots/${encodeURIComponent(row.id)}`, undefined, 'DELETE').catch(() => null);
        setDeleting(null);
        if (!result?.success) {
            setState(previous => previous ? { ...previous, error: result?.error || 'Screenshot belum dapat dihapus.' } : previous);
            return;
        }
        setReload(value => value + 1);
    };
    return <section className="mt-5 border-t border-slate-200 pt-4" aria-label="Bukti screenshot">
        <h3 className="text-sm font-semibold text-slate-800">Bukti Screenshot</h3>
        <p className="mt-1 text-xs text-slate-500">Indikasi untuk diperiksa pengawas. Tanpa batas jumlah, paling besar 50 MB per peserta (terpakai {(storedBytes / 1024 / 1024).toFixed(1)} MB), dihapus otomatis setelah 7 hari.</p>
        {!current && <p className="mt-3 text-xs text-slate-500">Memuat bukti...</p>}
        {current?.error && <p role="alert" className="mt-3 text-xs text-red-600">{current.error}</p>}
        {current && !current.error && current.rows.length === 0 && <p className="mt-3 text-xs text-slate-500">Belum ada screenshot tersimpan.</p>}
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {current?.rows.map(row => <article key={row.id} className="overflow-hidden rounded-lg border border-slate-200">
                {row.available ? <a href={`/api/proctoring/screenshots/${encodeURIComponent(row.id)}/image`} target="_blank" rel="noopener noreferrer">
                    {/* Authenticated image route; Next image optimization must not cache private evidence. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img loading="lazy" src={`/api/proctoring/screenshots/${encodeURIComponent(row.id)}/image`} alt={`Screenshot: ${securityViolationLabel(row.event_type)}`} className="max-h-56 w-full object-contain bg-slate-100" />
                </a> : <p className="p-4 text-xs text-slate-500">{row.deleted_at && Date.parse(row.expires_at) > Date.now() ? 'Gambar telah dihapus.' : 'Masa simpan gambar telah berakhir.'}</p>}
                <div className="flex items-start justify-between gap-2 p-3 text-xs text-slate-600">
                    <div className="min-w-0 space-y-1">
                        <p className="font-semibold">{securityViolationLabel(row.event_type)}</p>
                        <time dateTime={row.created_at}>{new Date(row.created_at).toLocaleString('id-ID', { timeZone })}</time>
                    </div>
                    {current.canDelete && row.available && <button type="button" onClick={() => void remove(row)} disabled={deleting === row.id}
                        aria-label="Hapus screenshot" title="Hapus screenshot"
                        className="shrink-0 rounded-md border border-red-200 p-1.5 text-red-600 hover:bg-red-50 disabled:opacity-50"><Trash2 size={14} aria-hidden="true" /></button>}
                </div>
            </article>)}
        </div>
    </section>;
}
