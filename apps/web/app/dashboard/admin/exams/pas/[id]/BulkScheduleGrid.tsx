"use client";
import React, { useState, useRef, useEffect } from 'react';
import { Plus, Trash2, Save, X, Loader2, Info } from 'lucide-react';
import { addPASScheduleAction } from '@/lib/api/pas';

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

export default function BulkScheduleGrid({ periodId, period, classes, subjects, qBanks, sessions, onComplete, onCancel }: BulkScheduleGridProps) {
    const [rows, setRows] = useState([
        { id: Date.now(), subject_id: '', class_id: '', bank_id: '', date: '', session_id: '', room: '' }
    ]);
    const [isSaving, setIsSaving] = useState(false);
    const tableRef = useRef<HTMLTableElement>(null);

    const handleAddRow = () => {
        setRows(prev => [...prev, { id: Date.now(), subject_id: '', class_id: '', bank_id: '', date: '', session_id: '', room: '' }]);
    };

    const handleRemoveRow = (id: number) => {
        if (rows.length === 1) return;
        setRows(prev => prev.filter(r => r.id !== id));
    };

    const handleChange = (id: number, field: string, value: string) => {
        setRows(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r));
    };

    const handleKeyDown = (e: React.KeyboardEvent, index: number, field: string) => {
        if (e.key === 'Tab') {
            // If it's the last row and the last field (room), add a new row automatically
            if (index === rows.length - 1 && field === 'room') {
                e.preventDefault();
                handleAddRow();
                // Focus will be handled by a slight delay or manual ref management, but simple auto-add is good enough.
                setTimeout(() => {
                    const inputs = tableRef.current?.querySelectorAll('input, select');
                    if (inputs) {
                        // The newly added row's first input would be roughly the next one
                        const nextSelect = tableRef.current?.querySelector(`tr:last-child td:first-child select`) as HTMLElement;
                        nextSelect?.focus();
                    }
                }, 50);
            }
        }
    };

    const handleSave = async () => {
        // Validate
        const validRows = rows.filter(r => r.subject_id && r.class_id && r.bank_id && r.date && r.session_id);
        if (validRows.length === 0) {
            alert('Tidak ada baris yang valid untuk disimpan. Pastikan semua kolom wajib diisi (Mapel, Kelas, Bank Soal, Tanggal, Sesi).');
            return;
        }

        setIsSaving(true);
        try {
            // Save sequentially or parallel
            const promises = validRows.map(row => 
                addPASScheduleAction({
                    pas_period_id: periodId,
                    bank_id: row.bank_id,
                    subject_id: row.subject_id,
                    class_id: row.class_id,
                    scheduled_date: row.date,
                    session_id: row.session_id,
                    room: row.room
                })
            );
            await Promise.all(promises);
            onComplete();
        } catch (err) {
            console.error(err);
            alert('Gagal menyimpan beberapa jadwal.');
        }
        setIsSaving(false);
    };

    return (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden flex flex-col">
            <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
                <div>
                    <h3 className="font-bold text-slate-800 flex items-center gap-2">
                        Input Massal Excel-Style
                    </h3>
                    <p className="text-xs text-slate-500 mt-1">Gunakan tombol Tab di keyboard untuk pindah kolom otomatis.</p>
                </div>
                <div className="flex items-center gap-2">
                    <button onClick={onCancel} className="p-2 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-200 transition-all">
                        <X size={18} />
                    </button>
                </div>
            </div>

            <div className="p-4 overflow-x-auto">
                <table ref={tableRef} className="w-full text-sm border-collapse">
                    <thead>
                        <tr>
                            <th className="border border-slate-300 bg-slate-100 px-3 py-2 text-left font-semibold text-slate-700 w-[15%]">Mata Pelajaran *</th>
                            <th className="border border-slate-300 bg-slate-100 px-3 py-2 text-left font-semibold text-slate-700 w-[15%]">Kelas *</th>
                            <th className="border border-slate-300 bg-slate-100 px-3 py-2 text-left font-semibold text-slate-700 w-[20%]">Bank Soal *</th>
                            <th className="border border-slate-300 bg-slate-100 px-3 py-2 text-left font-semibold text-slate-700 w-[15%]">Tanggal *</th>
                            <th className="border border-slate-300 bg-slate-100 px-3 py-2 text-left font-semibold text-slate-700 w-[20%]">Sesi Ujian *</th>
                            <th className="border border-slate-300 bg-slate-100 px-3 py-2 text-left font-semibold text-slate-700 w-[10%]">Ruangan</th>
                            <th className="border border-slate-300 bg-slate-100 px-3 py-2 w-[5%] text-center">Aksi</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((row, index) => (
                            <tr key={row.id} className="hover:bg-slate-50 group">
                                <td className="border border-slate-300 p-0">
                                    <select
                                        value={row.subject_id}
                                        onChange={(e) => handleChange(row.id, 'subject_id', e.target.value)}
                                        onKeyDown={(e) => handleKeyDown(e, index, 'subject_id')}
                                        className="w-full p-2 bg-transparent outline-none focus:ring-2 focus:ring-primary/50 focus:bg-primary/5"
                                    >
                                        <option value="">Pilih Mapel...</option>
                                        {subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                                    </select>
                                </td>
                                <td className="border border-slate-300 p-0">
                                    <select
                                        value={row.class_id}
                                        onChange={(e) => handleChange(row.id, 'class_id', e.target.value)}
                                        onKeyDown={(e) => handleKeyDown(e, index, 'class_id')}
                                        className="w-full p-2 bg-transparent outline-none focus:ring-2 focus:ring-primary/50 focus:bg-primary/5"
                                    >
                                        <option value="">Pilih Kelas...</option>
                                        {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                    </select>
                                </td>
                                <td className="border border-slate-300 p-0">
                                    <select
                                        value={row.bank_id}
                                        onChange={(e) => handleChange(row.id, 'bank_id', e.target.value)}
                                        onKeyDown={(e) => handleKeyDown(e, index, 'bank_id')}
                                        className="w-full p-2 bg-transparent outline-none focus:ring-2 focus:ring-primary/50 focus:bg-primary/5"
                                    >
                                        <option value="">Pilih Bank Soal...</option>
                                        {qBanks.map(b => <option key={b.id} value={b.id}>{b.title}</option>)}
                                    </select>
                                </td>
                                <td className="border border-slate-300 p-0">
                                    <input
                                        type="date"
                                        min={period?.start_date ? period.start_date.split('T')[0] : undefined}
                                        max={period?.end_date ? period.end_date.split('T')[0] : undefined}
                                        value={row.date}
                                        onChange={(e) => handleChange(row.id, 'date', e.target.value)}
                                        onKeyDown={(e) => handleKeyDown(e, index, 'date')}
                                        className="w-full p-2 bg-transparent outline-none focus:ring-2 focus:ring-primary/50 focus:bg-primary/5"
                                    />
                                </td>
                                <td className="border border-slate-300 p-0">
                                    <select
                                        value={row.session_id}
                                        onChange={(e) => handleChange(row.id, 'session_id', e.target.value)}
                                        onKeyDown={(e) => handleKeyDown(e, index, 'session_id')}
                                        className="w-full p-2 bg-transparent outline-none focus:ring-2 focus:ring-primary/50 focus:bg-primary/5"
                                    >
                                        <option value="">Pilih Sesi...</option>
                                        {sessions.map(s => (
                                            <option key={s.id} value={s.id}>{s.name} ({s.start_time.substring(0, 5)} - {s.end_time.substring(0, 5)})</option>
                                        ))}
                                    </select>
                                </td>
                                <td className="border border-slate-300 p-0">
                                    <input
                                        type="text"
                                        placeholder="Ruangan"
                                        value={row.room}
                                        onChange={(e) => handleChange(row.id, 'room', e.target.value)}
                                        onKeyDown={(e) => handleKeyDown(e, index, 'room')}
                                        className="w-full p-2 bg-transparent outline-none focus:ring-2 focus:ring-primary/50 focus:bg-primary/5"
                                    />
                                </td>
                                <td className="border border-slate-300 p-0 text-center">
                                    <button 
                                        onClick={() => handleRemoveRow(row.id)}
                                        disabled={rows.length === 1}
                                        className="p-2 text-slate-400 hover:text-red-500 disabled:opacity-30 disabled:hover:text-slate-400 transition-colors"
                                    >
                                        <Trash2 size={16} />
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                <div className="mt-4 flex items-center gap-3">
                    <button 
                        onClick={handleAddRow}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-slate-100 text-slate-700 hover:bg-slate-200 font-medium rounded-lg transition-colors border border-slate-200"
                    >
                        <Plus size={14} /> Tambah Baris
                    </button>
                    <div className="flex items-center gap-1.5 text-xs text-slate-500">
                        <Info size={14} />
                        Tips: Tekan tombol "Tab" di kolom Ruangan untuk menambah baris otomatis.
                    </div>
                </div>
            </div>

            <div className="p-4 bg-slate-50 border-t border-slate-200 flex justify-end gap-3">
                <button 
                    onClick={onCancel}
                    className="px-5 py-2 text-sm font-medium text-slate-600 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 transition-colors"
                >
                    Batal
                </button>
                <button 
                    onClick={handleSave}
                    disabled={isSaving}
                    className="px-5 py-2 text-sm font-bold text-white bg-[#030C4D] rounded-xl hover:bg-[#020510] flex items-center gap-2 transition-colors disabled:opacity-50"
                >
                    {isSaving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                    Simpan Semua Jadwal
                </button>
            </div>
        </div>
    );
}
