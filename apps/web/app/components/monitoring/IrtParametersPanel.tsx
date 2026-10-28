'use client';

import { useState } from 'react';
import { AlertTriangle, Download, Info, Sigma } from 'lucide-react';
import { Button } from '@/app/components/ui/button';
import { alertDialog } from '@/lib/confirm-dialog';
import { difficultyLabel, discriminationLabel, type IrtCalibration } from '@/lib/irt-calibration';

const PAGE_SIZE = 15;
const TONE: Record<string, string> = {
    easy: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    medium: 'border-amber-200 bg-amber-50 text-amber-700',
    hard: 'border-red-200 bg-red-50 text-red-700',
    low: 'border-red-200 bg-red-50 text-red-700',
    fair: 'border-amber-200 bg-amber-50 text-amber-700',
    good: 'border-emerald-200 bg-emerald-50 text-emerald-700',
};

const usesIrt = (scoringType?: string | null) => String(scoringType || '').split(',').some(type => type.trim().startsWith('irt'));

/**
 * Ciri tiap soal dari Kalkulasi IRT terakhir: proporsi benar (p), tingkat kesulitan (b),
 * daya beda (a), dan peluang menebak (c). Nilai siswa IRT tidak menjumlahkan angka ini;
 * angka ini dipakai untuk menaksir kemampuan siswa dari pola benar-salahnya.
 */
export function IrtParametersPanel({ calibration, scoringType, title = 'Parameter soal IRT', exportTitle, timeZone }: {
    calibration?: IrtCalibration | null;
    scoringType?: string | null;
    title?: string;
    /** Nama ujian untuk nama berkas Excel "Analisis_IRT_<nama>.xlsx". */
    exportTitle?: string;
    timeZone?: string;
}) {
    const [page, setPage] = useState(1);
    const [reviewOnly, setReviewOnly] = useState(false);
    const [exporting, setExporting] = useState(false);
    if (!calibration && !usesIrt(scoringType)) return null;

    if (!calibration) {
        return <section className="mb-4 flex items-start gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs text-slate-600">
            <Info size={14} className="mt-0.5 shrink-0 text-blue-600" />
            <p><span className="font-semibold text-slate-800">{title}</span> muncul setelah tombol Kalkulasi IRT dijalankan pada tab Hasil.</p>
        </section>;
    }

    const showA = calibration.models.some(model => model === 'irt_2pl' || model === 'irt_3pl');
    const showC = calibration.models.includes('irt_3pl');
    const flagged = calibration.items.filter(item => item.flags.length);
    const rows = reviewOnly ? flagged : calibration.items;
    const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    const current = Math.min(page, pages);
    const visible = rows.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);
    const count = (flag: string) => calibration.items.filter(item => item.flags.includes(flag)).length;
    const calculatedAt = new Date(calibration.calculated_at);
    const exportIrt = async () => {
        setExporting(true);
        try {
            const { exportIrtParametersToExcel } = await import('@/lib/export-excel-analysis');
            await exportIrtParametersToExcel(calibration, exportTitle || title, timeZone);
        } catch (error) {
            await alertDialog({ title: 'Export IRT Belum Berhasil', text: error instanceof Error ? error.message : 'Berkas belum dapat dibuat.', variant: 'danger' });
        } finally {
            setExporting(false);
        }
    };

    return <section aria-label={title} className="mb-4 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="space-y-2 border-b border-slate-100 px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900"><Sigma size={15} className="text-blue-600" />{title}</h3>
                <div className="flex flex-wrap items-center gap-2">
                    <p className="text-[11px] text-slate-500">
                        Dihitung {Number.isNaN(calculatedAt.getTime()) ? '-' : calculatedAt.toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })}
                        {' '}dari {calibration.participant_count} peserta · {calibration.models.map(model => model.replace('irt_', '').toUpperCase()).join(', ') || 'IRT'}
                    </p>
                    <Button size="sm" variant="outline" onClick={() => void exportIrt()} isLoading={exporting} disabled={exporting || !calibration.items.length}
                        leftIcon={<Download size={14} />}>Export IRT</Button>
                </div>
            </div>
            <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                {[['Terlalu mudah', count('Terlalu mudah')], ['Terlalu sulit', count('Terlalu sulit')], ...(showA ? [['Daya beda rendah', count('Daya beda rendah')]] : [])]
                    .map(([label, value]) => <span key={label} className={`rounded-full border px-2 py-0.5 ${Number(value) ? 'border-amber-300 bg-amber-50 text-amber-800' : 'border-slate-200 bg-slate-50 text-slate-500'}`}>{label}: <strong>{value}</strong></span>)}
                <label className="ml-auto inline-flex cursor-pointer items-center gap-1.5 text-slate-600">
                    <input type="checkbox" checked={reviewOnly} onChange={event => { setReviewOnly(event.target.checked); setPage(1); }} />
                    Hanya yang perlu ditinjau
                </label>
            </div>
            {calibration.warnings.map(warning => <p key={warning} className="flex items-start gap-1.5 text-[11px] text-amber-800"><AlertTriangle size={12} className="mt-0.5 shrink-0" />{warning}</p>)}
            <details className="text-[11px] text-slate-600">
                <summary className="cursor-pointer font-semibold text-blue-700">Cara membaca angka ini</summary>
                <ul className="mt-1.5 list-disc space-y-1 pl-4">
                    <li><strong>Benar (p)</strong>: persentase peserta yang menjawab benar.</li>
                    <li><strong>Kesulitan (b)</strong>: di bawah −1 mudah, −1 s.d. 1 sedang, di atas 1 sulit. Siswa dengan kemampuan setara b berpeluang 50% menjawab benar.</li>
                    {showA && <li><strong>Daya beda (a)</strong>: makin besar, makin baik soal membedakan siswa pandai dan kurang. Di bawah 0,5 sebaiknya ditinjau.</li>}
                    {showC && <li><strong>Tebakan (c)</strong>: peluang benar karena menebak (1 ÷ jumlah opsi).</li>}
                    <li>Skor IRT dilaporkan sebagai estimasi kemampuan siswa (θ) dari pola benar-salah, tanpa konversi ke 0–100. Nilai θ dapat negatif, nol, atau positif. Nilai klasikal tetap 0–100; poin esai masuk klasikal dan tidak dicampur dengan θ.</li>
                </ul>
            </details>
        </div>
        <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-xs">
                <thead className="bg-slate-50 text-[11px] text-slate-500">
                    <tr>
                        <th scope="col" className="w-12 px-4 py-2 font-semibold">No</th>
                        <th scope="col" className="px-3 py-2 font-semibold">Soal</th>
                        <th scope="col" className="px-3 py-2 text-right font-semibold">Benar (p)</th>
                        <th scope="col" className="px-3 py-2 font-semibold">Kesulitan (b)</th>
                        {showA && <th scope="col" className="px-3 py-2 font-semibold">Daya beda (a)</th>}
                        {showC && <th scope="col" className="px-3 py-2 text-right font-semibold">Tebakan (c)</th>}
                        <th scope="col" className="px-4 py-2 font-semibold">Catatan</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                    {visible.map(item => {
                        const difficulty = difficultyLabel(item.b);
                        const discrimination = discriminationLabel(item.a);
                        return <tr key={item.item_id} className={item.flags.length ? 'bg-amber-50/30' : undefined}>
                            <td className="px-4 py-2.5 font-bold tabular-nums text-slate-700">{item.number || '-'}</td>
                            <td className="max-w-[360px] px-3 py-2.5 text-slate-700">
                                <p className="line-clamp-2">{item.text || '—'}</p>
                                {item.part && <p className="mt-0.5 truncate text-[11px] text-slate-500">Pernyataan: {item.part}</p>}
                            </td>
                            <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{Math.round(item.p * 100)}%<span className="block text-[10px] text-slate-400">{item.correct}/{item.total}</span></td>
                            <td className="px-3 py-2.5"><span className="tabular-nums text-slate-700">{item.b.toFixed(2)}</span> <span className={`ml-1 rounded border px-1.5 py-0.5 text-[10px] font-semibold ${TONE[difficulty.tone]}`}>{difficulty.label}</span></td>
                            {showA && <td className="px-3 py-2.5"><span className="tabular-nums text-slate-700">{item.a.toFixed(2)}</span> <span className={`ml-1 rounded border px-1.5 py-0.5 text-[10px] font-semibold ${TONE[discrimination.tone]}`}>{discrimination.label}</span></td>}
                            {showC && <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{item.c.toFixed(2)}</td>}
                            <td className="px-4 py-2.5 text-[11px] text-amber-800">{item.flags.join(', ') || <span className="text-slate-400">—</span>}</td>
                        </tr>;
                    })}
                </tbody>
            </table>
            {!visible.length && <p className="px-4 py-8 text-center text-xs text-slate-500">{reviewOnly ? 'Tidak ada soal yang perlu ditinjau.' : 'Belum ada butir objektif yang dihitung.'}</p>}
        </div>
        {pages > 1 && <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-4 py-2 text-[11px]">
            <span className="tabular-nums text-slate-500">{(current - 1) * PAGE_SIZE + 1}–{Math.min(current * PAGE_SIZE, rows.length)} dari {rows.length} butir</span>
            <div className="flex items-center gap-1.5">
                <button type="button" onClick={() => setPage(current - 1)} disabled={current <= 1} className="rounded-md border border-slate-200 px-2.5 py-1 font-semibold text-slate-600 disabled:opacity-40">Sebelumnya</button>
                <span className="tabular-nums text-slate-600">{current} / {pages}</span>
                <button type="button" onClick={() => setPage(current + 1)} disabled={current >= pages} className="rounded-md border border-slate-200 px-2.5 py-1 font-semibold text-slate-600 disabled:opacity-40">Berikutnya</button>
            </div>
        </div>}
    </section>;
}
