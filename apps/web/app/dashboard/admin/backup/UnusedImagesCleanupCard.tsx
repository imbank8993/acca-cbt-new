"use client";
import { confirmDialog } from '@/lib/confirm-dialog';
import {
    deleteUnusedImages, formatBytes, previewUnusedImages,
    type UnusedImagesCleanupResult, type UnusedImagesPreview,
} from '@/lib/api/storage-cleanup';
import { motion } from 'framer-motion';
import { CheckCircle2, ImageOff, Loader2, ScanSearch, Trash2, XCircle } from 'lucide-react';
import { useState } from 'react';

const MIN_AGE_DAYS = 30;
const SHOWN_ITEMS = 20;

const fileName = (key: string) => key.split('/').pop() || key;
const folderLabel = (key: string) => {
    const parts = key.split('/');
    if (parts[0] === 'banks') return 'Persamaan bank soal';
    return parts[2] === 'banks' ? 'Sampul bank soal' : 'Gambar soal';
};
const dateLabel = (value: string | null) => value
    ? new Date(value).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : '-';

/**
 * Kartu "Bersihkan gambar tak terpakai": pindai dulu (tanpa menghapus), lalu
 * hapus setelah dikonfirmasi. Server memindai ulang sebelum menghapus.
 */
export default function UnusedImagesCleanupCard() {
    const [preview, setPreview] = useState<UnusedImagesPreview | null>(null);
    const [result, setResult] = useState<UnusedImagesCleanupResult | null>(null);
    const [busy, setBusy] = useState<'scan' | 'delete' | null>(null);
    const [error, setError] = useState('');

    const scan = async () => {
        setBusy('scan');
        setError('');
        setResult(null);
        const response = await previewUnusedImages(MIN_AGE_DAYS);
        setBusy(null);
        if (!response.success) {
            setError(response.error || 'Pemindaian gagal.');
            return;
        }
        setPreview(response);
    };

    const remove = async () => {
        if (!preview || preview.items.length === 0) return;
        const keys = preview.items.map(item => item.key);
        const bytes = preview.items.reduce((sum, item) => sum + item.size, 0);
        const confirmed = await confirmDialog({
            title: 'Hapus gambar tak terpakai?',
            text: `${keys.length.toLocaleString('id-ID')} gambar (${formatBytes(bytes)}) akan dihapus permanen dari penyimpanan.\n\n` +
                'Sebelum menghapus, sistem memeriksa ulang; gambar yang ternyata dipakai tetap disimpan. ' +
                'Gambar yang sudah dihapus tidak dapat dikembalikan, kecuali dari file cadangan.',
            variant: 'danger',
            confirmText: 'Ya, Hapus',
            cancelText: 'Batal',
        });
        if (!confirmed) return;
        setBusy('delete');
        setError('');
        const response = await deleteUnusedImages(keys, preview.minAgeDays);
        setBusy(null);
        if (!response.success) {
            setError(response.error || 'Penghapusan gagal.');
            return;
        }
        setResult(response);
        setPreview(null);
    };

    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="md:col-span-2 bg-white border border-amber-200 rounded-lg p-6 shadow-sm"
        >
            <div className="flex items-center gap-4 mb-4">
                <div className="w-12 h-12 shrink-0 bg-amber-50 text-amber-600 border border-amber-200 rounded-lg flex items-center justify-center">
                    <ImageOff size={24} />
                </div>
                <div>
                    <h2 className="text-xl font-bold text-slate-800">Bersihkan Gambar Tak Terpakai</h2>
                    <p className="text-sm text-slate-500">Hapus gambar soal yang tertinggal di penyimpanan setelah soal atau bank soalnya dihapus.</p>
                </div>
            </div>

            <ul className="text-xs text-slate-600 leading-relaxed mb-5 list-disc pl-5 space-y-1">
                <li>Yang diperiksa hanya gambar soal, sampul bank soal, dan gambar persamaan. Avatar, logo, lampiran jawaban siswa, audio, dan dokumen tidak disentuh.</li>
                <li>Gambar dianggap terpakai bila namanya muncul di bagian mana pun di database: soal, opsi, stimulus, petunjuk, salinan soal ujian, materi, dan lainnya.</li>
                <li>Gambar yang diunggah kurang dari {MIN_AGE_DAYS} hari lalu selalu dipertahankan.</li>
                <li>Buat cadangan terlebih dahulu bila ragu. File ekspor Word yang dibuat sebelum pembersihan tetap dapat diimpor; gambarnya diambil dari isi dokumen.</li>
            </ul>

            <div className="flex flex-wrap gap-3">
                <button
                    onClick={scan}
                    disabled={busy !== null}
                    className="flex items-center gap-2 bg-[#3083FF] hover:bg-[#3083FF]/90 text-white px-5 py-2.5 rounded-lg font-bold text-sm transition-all disabled:opacity-50"
                >
                    {busy === 'scan' ? <Loader2 className="animate-spin" size={16} /> : <ScanSearch size={16} />}
                    {busy === 'scan' ? 'Memindai penyimpanan & database...' : 'Pindai Gambar'}
                </button>
                {preview && preview.items.length > 0 && (
                    <button
                        onClick={remove}
                        disabled={busy !== null}
                        className="flex items-center gap-2 bg-red-600 hover:bg-red-700 text-white px-5 py-2.5 rounded-lg font-bold text-sm transition-all disabled:opacity-50"
                    >
                        {busy === 'delete' ? <Loader2 className="animate-spin" size={16} /> : <Trash2 size={16} />}
                        {busy === 'delete'
                            ? 'Memeriksa ulang & menghapus...'
                            : `Hapus ${preview.items.length.toLocaleString('id-ID')} Gambar (${formatBytes(preview.items.reduce((s, i) => s + i.size, 0))})`}
                    </button>
                )}
            </div>

            {preview && (
                <div className="mt-5">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                        <Stat label="Gambar soal diperiksa" value={preview.imageObjects} />
                        <Stat label="Masih dipakai" value={preview.referencedCount} tone="emerald" />
                        <Stat label={`Baru (< ${preview.minAgeDays} hari)`} value={preview.recentCount} />
                        <Stat label="Tak terpakai" value={preview.unusedCount} tone="amber" extra={formatBytes(preview.unusedBytes)} />
                    </div>
                    {preview.truncated && (
                        <p className="text-xs text-amber-700 mb-3">
                            Satu kali pembersihan menghapus paling banyak {preview.items.length.toLocaleString('id-ID')} gambar terbesar. Pindai lagi setelahnya untuk sisanya.
                        </p>
                    )}
                    {preview.listingTruncated && (
                        <p className="text-xs text-amber-700 mb-3">Penyimpanan sangat besar; sebagian berkas belum terdaftar pada pemindaian ini.</p>
                    )}
                    {preview.items.length === 0 ? (
                        <div className="p-3 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-lg flex items-center gap-2 text-sm font-medium">
                            <CheckCircle2 size={16} /> Tidak ada gambar tak terpakai. Penyimpanan sudah bersih.
                        </div>
                    ) : (
                        <div className="border border-slate-200 rounded-lg overflow-hidden">
                            <table className="w-full text-xs">
                                <thead className="bg-slate-50 text-slate-600">
                                    <tr>
                                        <th className="text-left px-3 py-2 font-semibold">Berkas</th>
                                        <th className="text-left px-3 py-2 font-semibold">Jenis</th>
                                        <th className="text-right px-3 py-2 font-semibold">Ukuran</th>
                                        <th className="text-right px-3 py-2 font-semibold">Diunggah</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {preview.items.slice(0, SHOWN_ITEMS).map(item => (
                                        <tr key={item.key} className="border-t border-slate-100">
                                            <td className="px-3 py-1.5 font-mono text-slate-700 truncate max-w-[260px]" title={item.key}>{fileName(item.key)}</td>
                                            <td className="px-3 py-1.5 text-slate-500">{folderLabel(item.key)}</td>
                                            <td className="px-3 py-1.5 text-right text-slate-700">{formatBytes(item.size)}</td>
                                            <td className="px-3 py-1.5 text-right text-slate-500">{dateLabel(item.lastModified)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            {preview.items.length > SHOWN_ITEMS && (
                                <p className="px-3 py-2 text-xs text-slate-500 bg-slate-50 border-t border-slate-100">
                                    dan {(preview.items.length - SHOWN_ITEMS).toLocaleString('id-ID')} gambar lainnya.
                                </p>
                            )}
                        </div>
                    )}
                </div>
            )}

            {result && (
                <div className="mt-5 p-3 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-lg flex items-start gap-2 text-sm font-medium">
                    <CheckCircle2 className="shrink-0 mt-0.5" size={16} />
                    <span>
                        {result.deleted.toLocaleString('id-ID')} gambar dihapus, {formatBytes(result.freedBytes)} ruang dikosongkan.
                        {result.skipped > 0 && ` ${result.skipped.toLocaleString('id-ID')} gambar dilewati karena ternyata sedang dipakai.`}
                        {result.failed > 0 && ` ${result.failed.toLocaleString('id-ID')} gambar gagal dihapus; coba pindai lagi.`}
                    </span>
                </div>
            )}

            {error && (
                <div className="mt-5 p-3 bg-red-50 text-red-700 border border-red-200 rounded-lg flex items-start gap-2 text-sm font-medium">
                    <XCircle className="shrink-0 mt-0.5" size={16} />
                    {error}
                </div>
            )}
        </motion.div>
    );
}

function Stat({ label, value, tone, extra }: { label: string; value: number; tone?: 'emerald' | 'amber'; extra?: string }) {
    const color = tone === 'emerald' ? 'text-emerald-700' : tone === 'amber' ? 'text-amber-700' : 'text-slate-800';
    return (
        <div className="border border-slate-200 rounded-lg p-3">
            <p className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">{label}</p>
            <p className={`text-xl font-bold ${color}`}>{value.toLocaleString('id-ID')}</p>
            {extra && <p className="text-xs text-slate-500">{extra}</p>}
        </div>
    );
}
