'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Camera, ChevronLeft, ChevronRight, ExternalLink, Images, RefreshCw, Search, Trash2, X } from 'lucide-react';
import { apiGet, apiSend } from '@/lib/api/client';
import { confirmDialog } from '@/lib/confirm-dialog';
import { useSchoolTimeZone } from '@/lib/useSchoolTimeZone';
import { securityViolationLabel } from '@/lib/security-violations';
import { groupScreenshotsByStudent } from '@/lib/screenshot-groups';

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
    /** Diisi panel: boleh dihapus pengguna ini (Proktor/Admin sekolah ujiannya). */
    canDelete?: boolean;
}

/** Jumlah kartu peserta per halaman. */
const PAGE_SIZE = 48;
/** Disegarkan pelan: setiap gambar didekripsi server saat dibuka. */
const REFRESH_MS = 30_000;

const imageUrl = (id: string) => `/api/proctoring/screenshots/${encodeURIComponent(id)}/image`;

/**
 * Tab Screenshot di monitoring: bukti screenshot satu ujian, atau beberapa ujian
 * sekaligus (folder ASAS/AM). Ditampilkan satu kartu per peserta dengan gambar
 * terbarunya; bila peserta punya lebih dari satu gambar, tombol "lainnya"
 * membuka semua gambarnya. Proktor/Admin dapat memilih beberapa gambar lalu
 * menghapusnya; Guru dan Pengawas hanya melihat, dan server membatasi Pengawas
 * pada peserta ruangnya. `attemptIds` (opsional) mengikuti filter peserta yang
 * sedang aktif di ruang kerja monitoring (kelas, ruang, pencarian).
 * Menghapus hanya membuang gambar; catatan kejadiannya tetap tersimpan.
 */
export function ExamScreenshotsPanel({ examId, examIds, attemptIds }: { examId?: string; examIds?: string[]; attemptIds?: string[] }) {
    const { timeZone } = useSchoolTimeZone();
    const ids = useMemo(() => [...new Set(examIds?.length ? examIds : examId ? [examId] : [])].sort(), [examId, examIds]);
    const key = ids.join(',');
    const [data, setData] = useState<{ key: string; rows: ExamScreenshot[] } | null>(null);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [loading, setLoading] = useState(false);
    const [query, setQuery] = useState('');
    const [showRemoved, setShowRemoved] = useState(false);
    const [limit, setLimit] = useState(PAGE_SIZE);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [deleting, setDeleting] = useState(false);
    /** Peserta yang galerinya sedang dibuka. */
    const [openAttempt, setOpenAttempt] = useState<string | null>(null);
    /** Gambar yang sedang dibuka di viewer (berpindah di antara gambar peserta yang sama). */
    const [viewing, setViewing] = useState<{ attemptId: string; id: string } | null>(null);

    const [reloadToken, setReloadToken] = useState(0);

    useEffect(() => {
        let active = true;
        const examList = key ? key.split(',') : [];
        const fetchRows = () => Promise.all(examList.map(id => apiGet<{ screenshots: ExamScreenshot[]; canDelete?: boolean }>(
            `/api/proctoring/exams/${encodeURIComponent(id)}/screenshots`,
        ))).then(results => {
            if (!active) return;
            setLoading(false);
            const failed = results.find(result => !result.success);
            if (failed && !failed.success) {
                setError(failed.error || 'Daftar screenshot belum dapat dimuat.');
                return;
            }
            setError('');
            const rows = results.flatMap(result => result.success
                ? (result.screenshots || []).map(row => ({ ...row, canDelete: result.canDelete === true })) : []);
            rows.sort((a, b) => b.created_at.localeCompare(a.created_at));
            setData({ key, rows });
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
    }, [key, reloadToken]);

    const refresh = () => {
        setLoading(true);
        setReloadToken(value => value + 1);
    };

    const current = data?.key === key ? data : null;
    const attemptKey = attemptIds ? [...attemptIds].sort().join(',') : null;
    const rows = useMemo(() => {
        const all = current?.rows || [];
        if (attemptKey === null) return all;
        const allowed = new Set(attemptKey ? attemptKey.split(',') : []);
        return all.filter(row => allowed.has(row.attempt_id));
    }, [current, attemptKey]);
    const canDelete = rows.some(row => row.canDelete);

    const visible = useMemo(() => {
        const needle = query.trim().toLowerCase();
        return rows.filter(row => (showRemoved || row.available) && (!needle ||
            (row.student_name || '').toLowerCase().includes(needle) ||
            (row.student_number || '').toLowerCase().includes(needle) ||
            securityViolationLabel(row.event_type).toLowerCase().includes(needle)));
    }, [rows, query, showRemoved]);
    const groups = useMemo(() => groupScreenshotsByStudent(visible), [visible]);
    const shownGroups = groups.slice(0, limit);
    const isDeletable = (row: ExamScreenshot) => row.available && row.canDelete === true;
    const selectable = shownGroups.flatMap(group => group.rows.filter(isDeletable));
    // Galeri tertutup sendiri bila peserta itu tidak lagi tampil (semua gambarnya dihapus/tersaring).
    const openGroup = openAttempt ? groups.find(group => group.attemptId === openAttempt) || null : null;
    const closeGallery = useCallback(() => setOpenAttempt(null), []);
    const closeViewer = useCallback(() => setViewing(null), []);
    // Viewer hanya berpindah di antara gambar yang masih tersedia milik peserta yang sama.
    const viewerRows = viewing ? (groups.find(group => group.attemptId === viewing.attemptId)?.rows || []).filter(row => row.available) : [];
    const viewerIndex = viewing ? viewerRows.findIndex(row => row.id === viewing.id) : -1;
    const openViewer = (row: ExamScreenshot) => { if (row.available) setViewing({ attemptId: row.attempt_id, id: row.id }); };

    // Pilihan hanya untuk gambar yang masih ada di daftar terbaru.
    const availableIds = useMemo(() => new Set(rows.filter(row => row.available).map(row => row.id)), [rows]);
    const deletableIds = useMemo(() => new Set(rows.filter(row => row.available && row.canDelete).map(row => row.id)), [rows]);
    const chosen = [...selected].filter(id => deletableIds.has(id));
    const allShownChosen = selectable.length > 0 && selectable.every(row => selected.has(row.id));
    const storedBytes = rows.reduce((total, row) => total + (row.available ? Number(row.byte_size) || 0 : 0), 0);
    const removedCount = rows.length - availableIds.size;
    const studentCount = useMemo(() => new Set(rows.filter(row => row.available).map(row => row.attempt_id)).size, [rows]);

    const toggle = (id: string) => setSelected(previous => {
        const next = new Set(previous);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
    });
    const toggleMany = (items: ExamScreenshot[], on: boolean) => setSelected(previous => {
        const next = new Set(previous);
        for (const row of items) {
            if (on) next.add(row.id); else next.delete(row.id);
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
                        {availableIds.size} gambar tersimpan dari {studentCount} peserta ({(storedBytes / 1024 / 1024).toFixed(1)} MB)
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
                    <input type="search" value={query} onChange={event => { setQuery(event.target.value); setLimit(PAGE_SIZE); setOpenAttempt(null); }}
                        placeholder="Cari nama, NIS, atau kejadian"
                        className="w-full rounded-lg border border-slate-200 py-2 pl-8 pr-3 text-sm dark:border-slate-700 dark:bg-slate-950" />
                </label>
                <label className="inline-flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                    <input type="checkbox" checked={showRemoved} onChange={event => { setShowRemoved(event.target.checked); setOpenAttempt(null); }} />
                    Tampilkan yang sudah dihapus
                </label>
                {canDelete && <>
                    <label className="inline-flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                        <input type="checkbox" checked={allShownChosen} disabled={!selectable.length} onChange={() => toggleMany(selectable, !allShownChosen)} />
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
        {current && groups.length === 0 && <p className="rounded-2xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-500 dark:border-slate-700">
            {rows.length === 0 ? 'Belum ada screenshot untuk peserta yang ditampilkan.' : 'Tidak ada screenshot yang cocok dengan pencarian.'}
        </p>}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {shownGroups.map(group => {
                const latest = group.rows[0];
                const others = group.rows.length - 1;
                const deletable = group.rows.filter(isDeletable);
                const allChosen = deletable.length > 0 && deletable.every(row => selected.has(row.id));
                const someChosen = deletable.some(row => selected.has(row.id));
                const name = latest.student_name || 'Tanpa nama';
                return <article key={group.attemptId} data-testid="student-screenshots"
                    className={`flex flex-col overflow-hidden rounded-xl border bg-white dark:bg-slate-900 ${someChosen ? 'border-red-400 ring-2 ring-red-200 dark:ring-red-500/30' : 'border-slate-200 dark:border-slate-800'}`}>
                    <div className="relative">
                        <ScreenshotImage row={latest} onOpen={() => openViewer(latest)} />
                        {deletable.length > 0 && <label className="absolute left-2 top-2 inline-flex cursor-pointer items-center rounded-md bg-white/90 p-1.5 shadow dark:bg-slate-900/90"
                            title={deletable.length > 1 ? `Pilih semua ${deletable.length} gambar ${name}` : `Pilih screenshot ${name}`}>
                            <span className="sr-only">{deletable.length > 1 ? `Pilih semua ${deletable.length} gambar ${name}` : `Pilih screenshot ${name}`}</span>
                            <input type="checkbox" checked={allChosen}
                                ref={input => { if (input) input.indeterminate = someChosen && !allChosen; }}
                                onChange={() => toggleMany(deletable, !allChosen)} />
                        </label>}
                        {group.rows.length > 1 && <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-slate-900/80 px-2 py-0.5 text-[11px] font-semibold text-white">
                            <Images size={12} aria-hidden="true" /> {group.rows.length}
                        </span>}
                    </div>
                    <div className="flex flex-1 flex-col gap-2 p-3 text-xs text-slate-600 dark:text-slate-300">
                        <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 space-y-0.5">
                                <p className="truncate font-semibold text-slate-800 dark:text-slate-100">{name}</p>
                                {latest.student_number && <p className="text-slate-400">{latest.student_number}</p>}
                                <p>{securityViolationLabel(latest.event_type)}</p>
                                <time dateTime={latest.created_at} className="text-slate-400">{formatTime(latest.created_at)}</time>
                            </div>
                            {deletable.length > 0 && <button type="button" onClick={() => void remove(deletable.map(row => row.id))} disabled={deleting}
                                aria-label={deletable.length > 1 ? `Hapus semua ${deletable.length} screenshot ${name}` : 'Hapus screenshot'}
                                title={deletable.length > 1 ? `Hapus semua ${deletable.length} screenshot peserta ini` : 'Hapus screenshot'}
                                className="shrink-0 rounded-md border border-red-200 p-1.5 text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-500/30 dark:hover:bg-red-500/10">
                                <Trash2 size={14} aria-hidden="true" />
                            </button>}
                        </div>
                        {others > 0 && <button type="button" onClick={() => setOpenAttempt(group.attemptId)}
                            className="mt-auto inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-300 dark:hover:bg-blue-500/20">
                            <Images size={13} aria-hidden="true" /> Lihat {others} lainnya
                        </button>}
                    </div>
                </article>;
            })}
        </div>
        {groups.length > shownGroups.length && <div className="text-center">
            <button type="button" onClick={() => setLimit(value => value + PAGE_SIZE)}
                className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
                Tampilkan lebih banyak ({groups.length - shownGroups.length} peserta lagi)
            </button>
        </div>}

        {openGroup && <StudentScreenshotsDialog rows={openGroup.rows} selected={selected} deleting={deleting}
            formatTime={formatTime} onToggle={toggle} onToggleMany={toggleMany} onRemove={ids => void remove(ids)}
            onOpenViewer={openViewer} onClose={closeGallery} />}
        {viewerIndex >= 0 && <ScreenshotViewer rows={viewerRows} index={viewerIndex} formatTime={formatTime}
            onIndex={index => setViewing({ attemptId: viewerRows[index].attempt_id, id: viewerRows[index].id })} onClose={closeViewer} />}
    </section>;
}

function ScreenshotImage({ row, onOpen, className = 'h-44' }: { row: ExamScreenshot; onOpen: () => void; className?: string }) {
    if (!row.available) {
        return <p className={`flex ${className} items-center justify-center bg-slate-50 p-4 text-center text-xs text-slate-500 dark:bg-slate-950`}>
            {row.deleted_at ? 'Gambar telah dihapus.' : 'Masa simpan gambar telah berakhir.'}
        </p>;
    }
    const image = <>
        {/* Rute gambar terautentikasi; optimasi gambar Next tidak boleh menyimpan bukti privat. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img loading="lazy" src={imageUrl(row.id)}
            alt={`Screenshot ${row.student_name || 'peserta'}: ${securityViolationLabel(row.event_type)}`}
            className={`${className} w-full bg-slate-100 object-contain dark:bg-slate-950`} />
    </>;
    // Klik gambar membukanya di viewer.
    return <button type="button" onClick={onOpen} className="block w-full cursor-zoom-in" aria-label={`Perbesar screenshot ${row.student_name || 'peserta'}`}>{image}</button>;
}

function StudentScreenshotsDialog({ rows, selected, deleting, formatTime, onToggle, onToggleMany, onRemove, onOpenViewer, onClose }: {
    rows: ExamScreenshot[];
    selected: Set<string>;
    deleting: boolean;
    formatTime: (value: string) => string;
    onToggle: (id: string) => void;
    onToggleMany: (rows: ExamScreenshot[], on: boolean) => void;
    onRemove: (ids: string[]) => void;
    onOpenViewer: (row: ExamScreenshot) => void;
    onClose: () => void;
}) {
    useEffect(() => {
        const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        const overflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = overflow; };
    }, [onClose]);

    const first = rows[0];
    const name = first?.student_name || 'Tanpa nama';
    const deletable = rows.filter(row => row.available && row.canDelete);
    const chosen = deletable.filter(row => selected.has(row.id));
    const allChosen = deletable.length > 0 && chosen.length === deletable.length;

    return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-2 sm:p-6" onClick={onClose}>
        <div role="dialog" aria-modal="true" aria-labelledby="student-screenshots-title" onClick={event => event.stopPropagation()}
            className="flex max-h-full w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl dark:bg-slate-900">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 p-4 dark:border-slate-800">
                <div className="min-w-0">
                    <h4 id="student-screenshots-title" className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{name}</h4>
                    <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                        {first?.student_number ? `${first.student_number} · ` : ''}{rows.length} screenshot, terbaru lebih dulu
                    </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    {deletable.length > 0 && <>
                        <label className="inline-flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                            <input type="checkbox" checked={allChosen} onChange={() => onToggleMany(deletable, !allChosen)} />
                            Pilih semua
                        </label>
                        <button type="button" onClick={() => onRemove(chosen.map(row => row.id))} disabled={!chosen.length || deleting}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-40">
                            <Trash2 size={13} aria-hidden="true" /> {deleting ? 'Menghapus…' : `Hapus terpilih (${chosen.length})`}
                        </button>
                    </>}
                    <button type="button" onClick={onClose} aria-label="Tutup"
                        className="rounded-lg border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
                        <X size={16} aria-hidden="true" />
                    </button>
                </div>
            </div>
            <div className="grid grid-cols-1 gap-3 overflow-y-auto p-4 sm:grid-cols-2 lg:grid-cols-3">
                {rows.map((row, index) => {
                    const isChosen = selected.has(row.id);
                    const canRemove = row.available && row.canDelete === true;
                    return <article key={row.id}
                        className={`overflow-hidden rounded-xl border ${isChosen ? 'border-red-400 ring-2 ring-red-200 dark:ring-red-500/30' : 'border-slate-200 dark:border-slate-800'}`}>
                        <div className="relative">
                            <ScreenshotImage row={row} className="h-52" onOpen={() => onOpenViewer(row)} />
                            {canRemove && <label className="absolute left-2 top-2 inline-flex cursor-pointer items-center rounded-md bg-white/90 p-1.5 shadow dark:bg-slate-900/90">
                                <span className="sr-only">Pilih screenshot {index + 1}</span>
                                <input type="checkbox" checked={isChosen} onChange={() => onToggle(row.id)} />
                            </label>}
                            <span className="absolute right-2 top-2 rounded-full bg-slate-900/80 px-2 py-0.5 text-[11px] font-semibold text-white">{index + 1}/{rows.length}</span>
                        </div>
                        <div className="flex items-start justify-between gap-2 p-3 text-xs text-slate-600 dark:text-slate-300">
                            <div className="min-w-0 space-y-0.5">
                                <p>{securityViolationLabel(row.event_type)}</p>
                                <time dateTime={row.created_at} className="text-slate-400">{formatTime(row.created_at)}</time>
                            </div>
                            {canRemove && <button type="button" onClick={() => onRemove([row.id])} disabled={deleting}
                                aria-label="Hapus screenshot" title="Hapus screenshot"
                                className="shrink-0 rounded-md border border-red-200 p-1.5 text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-500/30 dark:hover:bg-red-500/10">
                                <Trash2 size={14} aria-hidden="true" />
                            </button>}
                        </div>
                    </article>;
                })}
            </div>
        </div>
    </div>;
}

/**
 * Viewer layar penuh: satu screenshot sebesar layar, berpindah dengan tombol
 * kiri/kanan, tombol panah keyboard, atau geser (HP). Esc menutup viewer saja;
 * galeri di belakangnya tetap terbuka.
 */
function ScreenshotViewer({ rows, index, formatTime, onIndex, onClose }: {
    rows: ExamScreenshot[];
    index: number;
    formatTime: (value: string) => string;
    onIndex: (index: number) => void;
    onClose: () => void;
}) {
    const row = rows[index];
    const hasPrev = index > 0;
    const hasNext = index < rows.length - 1;
    const touchX = useRef<number | null>(null);
    const go = useCallback((step: number) => {
        const next = index + step;
        if (next >= 0 && next < rows.length) onIndex(next);
    }, [index, rows.length, onIndex]);

    useEffect(() => {
        // Fase capture + stopPropagation: Esc/panah tidak ikut menutup galeri di belakang.
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
            else if (event.key === 'ArrowLeft') go(-1);
            else if (event.key === 'ArrowRight') go(1);
            else return;
            event.preventDefault();
            event.stopPropagation();
        };
        window.addEventListener('keydown', onKey, true);
        return () => window.removeEventListener('keydown', onKey, true);
    }, [go, onClose]);
    useEffect(() => {
        const overflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => { document.body.style.overflow = overflow; };
    }, []);
    // Muat lebih dulu gambar sebelah supaya perpindahan terasa instan.
    useEffect(() => {
        for (const neighbour of [rows[index - 1], rows[index + 1]]) {
            if (neighbour) new window.Image().src = imageUrl(neighbour.id);
        }
    }, [rows, index]);

    if (!row) return null;
    const navButton = 'absolute top-1/2 z-10 -translate-y-1/2 rounded-full bg-white/10 p-2 text-white hover:bg-white/25 disabled:pointer-events-none disabled:opacity-0 sm:p-3';
    return <div role="dialog" aria-modal="true" aria-label={`Screenshot ${row.student_name || 'peserta'} ${index + 1} dari ${rows.length}`}
        className="fixed inset-0 z-[60] flex flex-col bg-black/95 text-white" onClick={onClose}
        onTouchStart={event => { touchX.current = event.touches[0]?.clientX ?? null; }}
        onTouchEnd={event => {
            const start = touchX.current;
            touchX.current = null;
            const end = event.changedTouches[0]?.clientX;
            if (start === null || end === undefined || Math.abs(end - start) < 50) return;
            go(end < start ? 1 : -1);
        }}>
        <div className="flex items-start justify-between gap-3 p-3 sm:p-4" onClick={event => event.stopPropagation()}>
            <div className="min-w-0 text-xs sm:text-sm">
                <p className="truncate font-semibold">{row.student_name || 'Tanpa nama'}{row.student_number ? ` · ${row.student_number}` : ''}</p>
                <p className="text-white/70">{securityViolationLabel(row.event_type)}</p>
                <time dateTime={row.created_at} className="text-white/50">{formatTime(row.created_at)}</time>
            </div>
            <div className="flex shrink-0 items-center gap-2">
                <span className="rounded-full bg-white/10 px-2.5 py-1 text-xs font-semibold tabular-nums">{index + 1} / {rows.length}</span>
                <a href={imageUrl(row.id)} target="_blank" rel="noopener noreferrer" aria-label="Buka gambar asli di tab baru" title="Buka gambar asli di tab baru"
                    className="rounded-full bg-white/10 p-2 hover:bg-white/25"><ExternalLink size={16} aria-hidden="true" /></a>
                <button type="button" onClick={onClose} aria-label="Tutup viewer" title="Tutup (Esc)"
                    className="rounded-full bg-white/10 p-2 hover:bg-white/25"><X size={18} aria-hidden="true" /></button>
            </div>
        </div>
        <div className="relative flex min-h-0 flex-1 items-center justify-center px-2 pb-4 sm:px-16">
            <button type="button" onClick={event => { event.stopPropagation(); go(-1); }} disabled={!hasPrev}
                aria-label="Screenshot sebelumnya" title="Sebelumnya (←)" className={`${navButton} left-2 sm:left-4`}>
                <ChevronLeft size={28} aria-hidden="true" />
            </button>
            {/* Rute gambar terautentikasi; optimasi gambar Next tidak boleh menyimpan bukti privat. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img key={row.id} src={imageUrl(row.id)} onClick={event => event.stopPropagation()}
                alt={`Screenshot ${row.student_name || 'peserta'}: ${securityViolationLabel(row.event_type)}`}
                className="max-h-full max-w-full select-none rounded-lg object-contain shadow-2xl" draggable={false} />
            <button type="button" onClick={event => { event.stopPropagation(); go(1); }} disabled={!hasNext}
                aria-label="Screenshot berikutnya" title="Berikutnya (→)" className={`${navButton} right-2 sm:right-4`}>
                <ChevronRight size={28} aria-hidden="true" />
            </button>
        </div>
    </div>;
}
