"use client";

import { addPASScheduleAction } from '@/lib/api/pas';
import { saveBulkScheduleRows,type BulkScheduleRow } from '@/lib/pas/bulk-schedule';
import { CheckCircle2,Info,Loader2,Plus,RotateCcw,Save,Trash2,X,XCircle } from 'lucide-react';
import React,{ useRef,useState } from 'react';

interface BulkScheduleGridProps {
    periodId: string;
    period: any;
    classes: any[];
    subjects: any[];
    qBanks: any[];
    sessions: any[];
    onComplete: () => void;
    onCancel: () => void;
}

let rowSequence = 0;

function createRow(): BulkScheduleRow {
    rowSequence += 1;
    return {
        id: `${Date.now()}-${rowSequence}`,
        subject_id: '', class_id: '', bank_id: '', date: '', session_id: '', room: '',
        status: 'idle',
    };
}

export default function BulkScheduleGrid({
    periodId, period, classes, subjects, qBanks, sessions, onComplete, onCancel,
}: BulkScheduleGridProps) {
    const [rows, setRows] = useState<BulkScheduleRow[]>([createRow()]);
    const [isSaving, setIsSaving] = useState(false);
    const [summary, setSummary] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);
    const tableRef = useRef<HTMLTableElement>(null);

    const handleAddRow = () => setRows((previous) => [...previous, createRow()]);

    const handleRemoveRow = (id: string) => {
        if (rows.length === 1 || isSaving) return;
        setRows((previous) => previous.filter((row) => row.id !== id));
    };

    const handleChange = (id: string, field: keyof BulkScheduleRow, value: string) => {
        setRows((previous) => previous.map((row) => row.id === id && row.status !== 'saved'
            ? { ...row, [field]: value, status: 'idle', error: undefined }
            : row));
        setSummary(null);
    };

    const handleKeyDown = (event: React.KeyboardEvent, index: number, field: string) => {
        if (event.key !== 'Tab' || index !== rows.length - 1 || field !== 'room') return;
        event.preventDefault();
        handleAddRow();
        setTimeout(() => {
            const nextSelect = tableRef.current?.querySelector('tr:last-child td:first-child select') as HTMLElement;
            nextSelect?.focus();
        }, 50);
    };

    const handleSave = async () => {
        if (isSaving) return;
        setIsSaving(true);
        setSummary(null);
        setRows((previous) => previous.map((row) => row.status === 'saved'
            ? row
            : { ...row, status: 'saving', error: undefined }));

        const result = await saveBulkScheduleRows(periodId, rows, addPASScheduleAction);
        const outcomes = new Map(result.outcomes.map((outcome) => [outcome.rowId, outcome]));
        const incomplete = new Set(result.incompleteIds);
        const duplicates = new Set(result.duplicateIds);

        setRows((previous) => previous.map((row) => {
            if (row.status === 'saved') return row;
            if (incomplete.has(row.id)) {
                return { ...row, status: 'error', error: 'Lengkapi semua kolom wajib.' };
            }
            if (duplicates.has(row.id)) {
                return { ...row, status: 'error', error: 'Bank soal dan kelas ini sudah ada di baris lain.' };
            }
            const outcome = outcomes.get(row.id);
            if (outcome) {
                return outcome.success
                    ? { ...row, status: 'saved', error: undefined }
                    : { ...row, status: 'error', error: outcome.error };
            }
            return { ...row, status: 'idle', error: undefined };
        }));

        const succeeded = result.outcomes.filter((outcome) => outcome.success).length;
        const failed = result.outcomes.length - succeeded;
        const invalid = result.incompleteIds.length + result.duplicateIds.length;
        const remaining = failed + invalid;

        if (result.outcomes.length === 0 && invalid === 0) {
            setSummary({ kind: 'error', message: 'Tidak ada baris yang siap disimpan.' });
        } else if (remaining === 0) {
            setSummary({ kind: 'success', message: `${succeeded} jadwal berhasil disimpan.` });
            setIsSaving(false);
            onComplete();
            return;
        } else {
            setSummary({
                kind: 'error',
                message: `${succeeded} jadwal tersimpan, ${remaining} baris perlu diperbaiki atau dicoba lagi.`,
            });
        }
        setIsSaving(false);
    };

    const savedCount = rows.filter((row) => row.status === 'saved').length;
    const retryCount = rows.filter((row) => row.status === 'error').length;
    const handleClose = savedCount > 0 ? onComplete : onCancel;

    return (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden flex flex-col">
            <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
                <div>
                    <h3 className="font-bold text-slate-800">Input Massal Excel-Style</h3>
                    <p className="text-xs text-slate-500 mt-1">Setiap baris menampilkan hasil simpan sendiri. Coba lagi hanya mengirim baris yang belum berhasil.</p>
                </div>
                <button onClick={handleClose} disabled={isSaving} aria-label="Tutup input massal"
                    className="p-2 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-200 transition-all disabled:opacity-50">
                    <X size={18} />
                </button>
            </div>

            {summary && (
                <div role="status" className={`mx-4 mt-4 rounded-xl border px-4 py-3 text-sm ${summary.kind === 'success'
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                    : 'border-amber-200 bg-amber-50 text-amber-900'}`}>
                    {summary.message}
                </div>
            )}

            <div className="p-4 overflow-x-auto">
                <table ref={tableRef} className="w-full text-sm border-collapse">
                    <thead>
                        <tr>
                            {['Mata Pelajaran *', 'Kelas *', 'Bank Soal *', 'Tanggal *', 'Sesi Ujian *', 'Ruangan'].map((heading) => (
                                <th key={heading} className="border border-slate-300 bg-slate-100 px-3 py-2 text-left font-semibold text-slate-700">{heading}</th>
                            ))}
                            <th className="border border-slate-300 bg-slate-100 px-3 py-2 text-left font-semibold text-slate-700 min-w-40">Status</th>
                            <th className="border border-slate-300 bg-slate-100 px-3 py-2 text-center">Aksi</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((row, index) => {
                            const disabled = isSaving || row.status === 'saved';
                            const fieldClass = `w-full p-2 bg-transparent outline-none focus:ring-2 focus:ring-primary/50 focus:bg-primary/5 disabled:text-slate-500 ${row.status === 'error' ? 'bg-red-50' : ''}`;
                            return (
                                <tr key={row.id} className={row.status === 'saved' ? 'bg-emerald-50/60' : 'hover:bg-slate-50'}>
                                    <td className="border border-slate-300 p-0">
                                        <select value={row.subject_id} disabled={disabled} onChange={(event) => handleChange(row.id, 'subject_id', event.target.value)} onKeyDown={(event) => handleKeyDown(event, index, 'subject_id')} className={fieldClass}>
                                            <option value="">Pilih Mapel...</option>
                                            {subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}
                                        </select>
                                    </td>
                                    <td className="border border-slate-300 p-0">
                                        <select value={row.class_id} disabled={disabled} onChange={(event) => handleChange(row.id, 'class_id', event.target.value)} onKeyDown={(event) => handleKeyDown(event, index, 'class_id')} className={fieldClass}>
                                            <option value="">Pilih Kelas...</option>
                                            {classes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                                        </select>
                                    </td>
                                    <td className="border border-slate-300 p-0">
                                        <select value={row.bank_id} disabled={disabled} onChange={(event) => handleChange(row.id, 'bank_id', event.target.value)} onKeyDown={(event) => handleKeyDown(event, index, 'bank_id')} className={fieldClass}>
                                            <option value="">Pilih Bank Soal...</option>
                                            {qBanks.map((bank) => <option key={bank.id} value={bank.id}>{bank.title}</option>)}
                                        </select>
                                    </td>
                                    <td className="border border-slate-300 p-0">
                                        <input type="date" min={period?.start_date?.split('T')[0]} max={period?.end_date?.split('T')[0]} value={row.date} disabled={disabled} onChange={(event) => handleChange(row.id, 'date', event.target.value)} onKeyDown={(event) => handleKeyDown(event, index, 'date')} className={fieldClass} />
                                    </td>
                                    <td className="border border-slate-300 p-0">
                                        <select value={row.session_id} disabled={disabled} onChange={(event) => handleChange(row.id, 'session_id', event.target.value)} onKeyDown={(event) => handleKeyDown(event, index, 'session_id')} className={fieldClass}>
                                            <option value="">Pilih Sesi...</option>
                                            {sessions.map((session) => <option key={session.id} value={session.id}>{session.name} ({session.start_time.substring(0, 5)} - {session.end_time.substring(0, 5)})</option>)}
                                        </select>
                                    </td>
                                    <td className="border border-slate-300 p-0">
                                        <input type="text" placeholder="Ruangan" value={row.room} disabled={disabled} onChange={(event) => handleChange(row.id, 'room', event.target.value)} onKeyDown={(event) => handleKeyDown(event, index, 'room')} className={fieldClass} />
                                    </td>
                                    <td className="border border-slate-300 px-3 py-2">
                                        {row.status === 'saving' && <span className="flex items-center gap-1.5 text-blue-700"><Loader2 size={14} className="animate-spin" /> Menyimpan</span>}
                                        {row.status === 'saved' && <span className="flex items-center gap-1.5 text-emerald-700"><CheckCircle2 size={14} /> Tersimpan</span>}
                                        {row.status === 'error' && <span className="flex items-start gap-1.5 text-red-700"><XCircle size={14} className="mt-0.5 shrink-0" /> {row.error}</span>}
                                        {row.status === 'idle' && <span className="text-slate-400">Belum disimpan</span>}
                                    </td>
                                    <td className="border border-slate-300 p-0 text-center">
                                        <button onClick={() => handleRemoveRow(row.id)} disabled={rows.length === 1 || disabled} aria-label="Hapus baris" className="p-2 text-slate-400 hover:text-red-500 disabled:opacity-30 transition-colors">
                                            <Trash2 size={16} />
                                        </button>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
                <div className="mt-4 flex items-center gap-3 flex-wrap">
                    <button onClick={handleAddRow} disabled={isSaving} className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-slate-100 text-slate-700 hover:bg-slate-200 font-medium rounded-lg border border-slate-200 disabled:opacity-50">
                        <Plus size={14} /> Tambah Baris
                    </button>
                    <div className="flex items-center gap-1.5 text-xs text-slate-500">
                        <Info size={14} /> Baris kosong diabaikan; baris yang terisi sebagian ditandai untuk dilengkapi.
                    </div>
                </div>
            </div>

            <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-3 flex-wrap">
                <span className="text-xs text-slate-500">{savedCount > 0 ? `${savedCount} baris sudah tersimpan.` : 'Belum ada baris tersimpan.'}</span>
                <div className="flex justify-end gap-3">
                    <button onClick={handleClose} disabled={isSaving} className="px-5 py-2 text-sm font-medium text-slate-600 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 disabled:opacity-50">
                        {savedCount > 0 ? 'Tutup' : 'Batal'}
                    </button>
                    <button onClick={handleSave} disabled={isSaving} className="px-5 py-2 text-sm font-bold text-white bg-[#3083FF] rounded-xl hover:bg-[#2563EB] flex items-center gap-2 disabled:opacity-50">
                        {isSaving ? <Loader2 size={16} className="animate-spin" /> : retryCount > 0 ? <RotateCcw size={16} /> : <Save size={16} />}
                        {isSaving ? 'Menyimpan...' : retryCount > 0 ? `Coba Lagi ${retryCount} Baris` : 'Simpan Semua Jadwal'}
                    </button>
                </div>
            </div>
        </div>
    );
}
