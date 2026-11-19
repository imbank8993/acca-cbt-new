'use client';
import { useEffect, useMemo, useState } from 'react';
import { Camera, RefreshCw, Search, Trash2 } from 'lucide-react';
import { apiGet, apiSend } from '@/lib/api/client';
import { confirmDialog } from '@/lib/confirm-dialog';
import { useSchoolTimeZone } from '@/lib/useSchoolTimeZone';
import { securityViolationLabel } from '@/lib/security-violations';

interface ExamScreenshot {
    id: string;
    attempt_id: string;
    event_type: string;
    created_at: string;
    expires_at: string;
    deleted_at?: string | null;
    byte_size?: number | null;
    available: boolean;
    student_name: string | null;
    student_number: string | null;
}

const PAGE_SIZE = 48;
/** Disegarkan pelan: setiap gambar didekripsi server saat dibuka. */
const REFRESH_MS = 30_000;

/**
 * Tab Screenshot di monitoring: semua bukti screenshot satu ujian. Proktor/Admin
 * dapat memilih beberapa gambar lalu menghapusnya; Guru pengawas hanya melihat.
 * Menghapus hanya membuang gambar; catatan kejadiannya tetap tersimpan.
 */
export function ExamScreenshotsPanel({ examId }: { examId: string }) {
    const { timeZone } = useSchoolTimeZone();
    const [data, setData] = useState<{ examId: string; rows: ExamScreenshot[]; canDelete: boolean } | null>(null);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [loading, setLoading] = useState(false);
    const [query, setQuery] = useState('');
    const [showRemoved, setShowRemoved] = useState(false);
    const [limit, setLimit] = useState(PAGE_SIZE);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [deleting, setDeleting] = useState(false);

    const [reloadToken, setReloadToken] = useState(0);

    useEffect(() => {
        let active = true;
        const fetchRows = () => apiGet<{ screenshots: ExamScreenshot[]; canDelete?: boolean }>(
            `/api/proctoring/exams/${encodeURIComponent(examId)}/screenshots`,
        ).then(result => {
            if (!active) return;
            setLoading(false);
            if (!result.success) {
                setError(result.error || 'Daftar screenshot belum dapat dimuat.');
                return;
            }
            setError('');
            setData({ examId, rows: result.screenshots || [], canDelete: result.canDelete === true });
        }).catch(() => {
            if (!active) return;
            setLoading(false);
            setError('Daftar screenshot belum dapat dimuat.');
        });
        void fetchRows();
        const timer = window.setInterval(() => {
            if (document.visibilityState === 'visible') void fetchRows();
        }, REFRESH_MS);
        return () => { active = false; window.clearInterval(timer); };
    }, [examId, reloadToken]);

    const refresh = () => {
        setLoading(true);
        setReloadToken(value => value + 1);
    };

    const current = data?.examId === examId ? data : null;
    const rows = useMemo(() => current?.rows || [], [current]);
    const canDelete = current?.canDelete === true;

    const visible = useMemo(() => {
        const needle = query.trim().toLowerCase();
        return rows.filter(row => (showRemoved || row.available) && (!needle ||
            (row.student_name || '').toLowerCase().includes(needle) ||
            (row.student_number || '').toLowerCase().includes(needle) ||
            securityViolationLabel(row.event_type).toLowerCase().includes(needle)));
    }, [rows, query, showRemoved]);
    const shown = visible.slice(0, limit);
    const selectable = shown.filter(row => row.available);

    // Pilihan hanya untuk gambar yang masih ada di daftar terbaru.
    const availableIds = useMemo(() => new Set(rows.filter(row => row.available).map(row => row.id)), [rows]);
    const chosen = [...selected].filter(id => availableIds.has(id));
    const allShownChosen = selectable.length > 0 && selectable.every(row => selected.has(row.id));
    const storedBytes = rows.reduce((total, row) => total + (row.available ? Number(row.byte_size) || 0 : 0), 0);
    const removedCount = rows.length - availableIds.size;

    const toggle = (id: string) => setSelected(previous => {
        const next = new Set(previous);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
    });
    const toggleShown = () => setSelected(previous => {
        const next = new Set(previous);
        for (const row of selectable) {
            if (allShownChosen) next.delete(row.id); else next.add(row.id);
        }
        return next;
    });

    const remove = async (ids: string[]) => {
        if (!ids.length || deleting) return;
        const ok = await confirmDialog({
            title: ids.length === 1 ? 'Hapus screenshot?' : `Hapus ${ids.length} screenshot?`,
            text: 'Gambar dihapus permanen dan tidak dapat dikembalikan. Catatan kejadiannya tetap tersimpan.',
            confirmText: 'Ya, hapus', cancelText: 'Batal', variant: 'danger',
        });
        if (!ok) return;
        setDeleting(true);
        setNotice('');
        const result = await apiSend<{ deleted: number; failed: Array<{ id: string; error: string }> }>(
            '/api/proctoring/screenshots/delete', { ids }, 'POST',
        ).catch(() => null);
        setDeleting(false);
        if (!result?.success) {
            setError(result?.error || 'Screenshot belum dapat dihapus.');
            return;
        }
        const failed = result.failed || [];
        setError(failed.length ? `${failed.length} screenshot gagal dihapus: ${failed[0].error}` : '');
        setNotice(`${result.deleted} screenshot dihapus.`);
        setSelected(previous => {
            const next = new Set(previous);
            for (const id of ids) if (!failed.some(item => item.id === id)) next.delete(id);
            return next;
        });
        setReloadToken(value => value + 1);
    };

    const formatTime = (value: string) => new Date(value).toLocaleString('id-ID', {
        timeZone, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit',
    });

    return <section aria-label="Screenshot peserta" className="space-y-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
                        <Camera size={16} aria-hidden="true" /> Screenshot peserta
                    </h3>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                        {availableIds.size} gambar tersimpan ({(storedBytes / 1024 / 1024).toFixed(1)} MB)
                        {removedCount > 0 ? ` · ${removedCount} sudah dihapus atau kedaluwarsa` : ''}. Gambar dihapus otomatis setelah 7 hari.
                        {!canDelete && current ? ' Hanya Proktor atau Admin yang dapat menghapus.' : ''}
                    </p>
                </div>
                <button type="button" onClick={refresh} disabled={loading}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
                    <RefreshCw size={13} className={loading ? 'animate-spin' : ''} aria-hidden="true" /> Muat ulang
                </button>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-3">
                <label className="relative min-w-[14rem] flex-1">
                    <span className="sr-only">Cari nama, NIS, atau jenis kejadian</span>
                    <Search size={14} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input type="search" value={query} onChange={event => { setQuery(event.target.value); setLimit(PAGE_SIZE); }}
                        placeholder="Cari nama, NIS, atau kejadian"
                        className="w-full rounded-lg border border-slate-200 py-2 pl-8 pr-3 text-sm dark:border-slate-700 dark:bg-slate-950" />
                </label>
                <label className="inline-flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                    <input type="checkbox" checked={showRemoved} onChange={event => setShowRemoved(event.target.checked)} />
                    Tampilkan yang sudah dihapus
                </label>
                {canDelete && <>
                    <label className="inline-flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                        <input type="checkbox" checked={allShownChosen} disabled={!selectable.length} onChange={toggleShown} />
                        Pilih semua yang tampil
                    </label>
                    <button type="button" onClick={() => void remove(chosen)} disabled={!chosen.length || deleting}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-2 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-40">
                        <Trash2 size={13} aria-hidden="true" /> {deleting ? 'Menghapus…' : `Hapus terpilih (${chosen.length})`}
                    </button>
                </>}
            </div>
            {error && <p role="alert" className="mt-3 text-xs text-red-600">{error}</p>}
            {notice && !error && <p role="status" className="mt-3 text-xs text-emerald-700">{notice}</p>}
        </div>

        {!current && !error && <p className="text-sm text-slate-500">Memuat screenshot…</p>}
        {current && visible.length === 0 && <p className="rounded-2xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-500 dark:border-slate-700">
            {rows.length === 0 ? 'Belum ada screenshot untuk ujian ini.' : 'Tidak ada screenshot yang cocok dengan pencarian.'}
        </p>}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {shown.map(row => {
                const isChosen = selected.has(row.id);
                return <article key={row.id}
                    className={`overflow-hidden rounded-xl border bg-white dark:bg-slate-900 ${isChosen ? 'border-red-400 ring-2 ring-red-200 dark:ring-red-500/30' : 'border-slate-200 dark:border-slate-800'}`}>
                    <div className="relative">
                        {row.available ? <a href={`/api/proctoring/screenshots/${encodeURIComponent(row.id)}/image`} target="_blank" rel="noopener noreferrer">
                            {/* Rute gambar terautentikasi; optimasi gambar Next tidak boleh menyimpan bukti privat. */}
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img loading="lazy" src={`/api/proctoring/screenshots/${encodeURIComponent(row.id)}/image`}
                                alt={`Screenshot ${row.student_name || 'peserta'}: ${securityViolationLabel(row.event_type)}`}
                                className="h-44 w-full bg-slate-100 object-contain dark:bg-slate-950" />
                        </a> : <p className="flex h-44 items-center justify-center bg-slate-50 p-4 text-center text-xs text-slate-500 dark:bg-slate-950">
                            {row.deleted_at ? 'Gambar telah dihapus.' : 'Masa simpan gambar telah berakhir.'}
                        </p>}
                        {canDelete && row.available && <label className="absolute left-2 top-2 inline-flex cursor-pointer items-center rounded-md bg-white/90 p-1.5 shadow dark:bg-slate-900/90">
                            <span className="sr-only">Pilih screenshot {row.student_name || ''}</span>
                            <input type="checkbox" checked={isChosen} onChange={() => toggle(row.id)} />
                        </label>}
                    </div>
                    <div className="flex items-start justify-between gap-2 p-3 text-xs text-slate-600 dark:text-slate-300">
                        <div className="min-w-0 space-y-0.5">
                            <p className="truncate font-semibold text-slate-800 dark:text-slate-100">{row.student_name || 'Tanpa nama'}</p>
                            {row.student_number && <p className="text-slate-400">{row.student_number}</p>}
                            <p>{securityViolationLabel(row.event_type)}</p>
                            <time dateTime={row.created_at} className="text-slate-400">{formatTime(row.created_at)}</time>
                        </div>
                        {canDelete && row.available && <button type="button" onClick={() => void remove([row.id])} disabled={deleting}
                            aria-label="Hapus screenshot" title="Hapus screenshot"
                            className="shrink-0 rounded-md border border-red-200 p-1.5 text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-500/30 dark:hover:bg-red-500/10">
                            <Trash2 size={14} aria-hidden="true" />
                        </button>}
                    </div>
                </article>;
            })}
        </div>
        {visible.length > shown.length && <div className="text-center">
            <button type="button" onClick={() => setLimit(value => value + PAGE_SIZE)}
                className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
                Tampilkan lebih banyak ({visible.length - shown.length} lagi)
            </button>
        </div>}
    </section>;
}
