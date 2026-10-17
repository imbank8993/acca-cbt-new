"use client";

import type { PASPeriod,PASSession } from '@/app/types/pas';
import { addPASScheduleAction,listMasterRooms,type MasterRoom,type PASRoom,type PASSubjectSummary } from '@/lib/api/pas';
import type { OrganizationClass } from '@/lib/api/proctor';
import type { QuestionBank } from '@/lib/api/questions';
import {
    isBlankScheduleRow,
    parseImportedScheduleRows,
    resolveBankSubjectId,
    saveBulkScheduleRows,
    type BulkScheduleRow,
} from '@/lib/pas/bulk-schedule';
import { getSchoolTimeZoneLabel } from '@/lib/school-time';
import { useSchoolTimeZone } from '@/lib/useSchoolTimeZone';
import {
    CheckCircle2,
    Copy,
    Download,
    FileSpreadsheet,
    Info,
    Loader2,
    Plus,
    RotateCcw,
    Save,
    Trash2,
    XCircle,
} from 'lucide-react';
import React,{ useEffect,useId,useMemo,useRef,useState } from 'react';

interface BulkScheduleGridProps {
    periodId: string;
    period: PASPeriod;
    classes: OrganizationClass[];
    subjects: PASSubjectSummary[];
    qBanks: QuestionBank[];
    sessions: PASSession[];
    rooms?: PASRoom[];
    onComplete: () => void;
    onCancel: () => void;
}

let rowSequence = 0;

function createRow(defaults?: Partial<BulkScheduleRow>): BulkScheduleRow {
    rowSequence += 1;
    return {
        id: `${Date.now()}-${rowSequence}`,
        subject_id: '',
        class_id: '',
        bank_id: '',
        date: '',
        session_id: '',
        duration_minutes: 90,
        room: '',
        status: 'idle',
        ...defaults,
    };
}

export default function BulkScheduleGrid({
    periodId, period, classes, subjects, qBanks, sessions, rooms = [], onComplete, onCancel,
}: BulkScheduleGridProps) {
    const { timeZone, error: timeZoneError } = useSchoolTimeZone();
    const roomDatalistId = useId();
    const defaultDate = period?.start_date?.split('T')[0] || '';
    const defaultSessionId = sessions[0]?.id || '';

    const [rows, setRows] = useState<BulkScheduleRow[]>(() => [
        createRow({ date: defaultDate, session_id: defaultSessionId }),
    ]);
    const [masterRooms, setMasterRooms] = useState<MasterRoom[]>([]);
    const [isSaving, setIsSaving] = useState(false);
    const [isImporting, setIsImporting] = useState(false);
    const [summary, setSummary] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);
    const tableRef = useRef<HTMLTableElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        let cancelled = false;
        listMasterRooms().then((data) => {
            if (!cancelled) setMasterRooms(data);
        }).catch(() => {
            // Saran master ruang bersifat opsional pada tabel massal
        });
        return () => { cancelled = true; };
    }, []);

    const roomSuggestions = useMemo(() => {
        const combined = [...rooms.map((r) => r.name), ...masterRooms.map((r) => r.name)];
        return combined.filter((name, index) =>
            Boolean(name?.trim()) &&
            combined.findIndex((candidate) => candidate.trim().toLowerCase() === name.trim().toLowerCase()) === index,
        );
    }, [rooms, masterRooms]);

    const handleAddRow = () => {
        const lastRow = rows[rows.length - 1];
        setRows((previous) => [
            ...previous,
            createRow({
                date: lastRow?.date || defaultDate,
                session_id: lastRow?.session_id || defaultSessionId,
                duration_minutes: lastRow?.duration_minutes || 90,
            }),
        ]);
    };

    const handleDuplicateRow = (index: number) => {
        if (isSaving) return;
        const source = rows[index];
        if (!source) return;
        const duplicated = createRow({
            bank_id: source.bank_id,
            subject_id: source.subject_id,
            class_id: '',
            date: source.date,
            session_id: source.session_id,
            duration_minutes: source.duration_minutes ?? 90,
            room: source.room,
        });
        setRows((previous) => [
            ...previous.slice(0, index + 1),
            duplicated,
            ...previous.slice(index + 1),
        ]);
        setSummary(null);
    };

    const handleRemoveRow = (id: string) => {
        if (rows.length === 1 || isSaving) return;
        setRows((previous) => previous.filter((row) => row.id !== id));
    };

    const handleResetRows = () => {
        if (isSaving) return;
        setRows([createRow({ date: defaultDate, session_id: defaultSessionId })]);
        setSummary(null);
    };

    const handleChange = (id: string, field: keyof BulkScheduleRow, value: string | number) => {
        setRows((previous) => previous.map((row) => {
            if (row.id !== id || row.status === 'saved') return row;
            if (field === 'bank_id') {
                const bankId = String(value);
                const resolvedSubjectId = resolveBankSubjectId(bankId, qBanks, subjects, row.subject_id);
                return {
                    ...row,
                    bank_id: bankId,
                    subject_id: resolvedSubjectId,
                    status: 'idle',
                    error: undefined,
                };
            }
            return { ...row, [field]: value, status: 'idle', error: undefined };
        }));
        setSummary(null);
    };

    const handleKeyDown = (event: React.KeyboardEvent, index: number, field: string) => {
        if (event.key !== 'Tab' || event.shiftKey || index !== rows.length - 1 || field !== 'room') return;
        event.preventDefault();
        handleAddRow();
        setTimeout(() => {
            const nextSelect = tableRef.current?.querySelector('tbody tr:last-child td:first-child select') as HTMLElement;
            nextSelect?.focus();
        }, 50);
    };

    const handleDownloadTemplate = async () => {
        const XLSX = await import('xlsx');
        const sampleBank = qBanks[0]?.title || '';
        const sampleSubject = subjects[0]?.name || '';
        const sampleClass = classes[0]?.name || '';
        const sampleSession = sessions[0]?.name || '';
        const sampleRoom = roomSuggestions[0] || '';

        const templateRows = [
            {
                'Bank Soal': sampleBank,
                'Mata Pelajaran': sampleSubject,
                'Kelas': sampleClass,
                'Tanggal': defaultDate,
                'Sesi Ujian': sampleSession,
                'Durasi (Menit)': 90,
                'Ruangan': sampleRoom,
            },
        ];

        const maxRefLen = Math.max(qBanks.length, subjects.length, classes.length, sessions.length, roomSuggestions.length, 1);
        const refRows = Array.from({ length: maxRefLen }, (_, idx) => ({
            'Daftar Bank Soal': qBanks[idx]?.title || '',
            'Daftar Mata Pelajaran': subjects[idx]?.name || '',
            'Daftar Kelas': classes[idx]?.name || '',
            'Daftar Sesi Ujian': sessions[idx] ? `${sessions[idx].name} (${sessions[idx].start_time.slice(0, 5)}-${sessions[idx].end_time.slice(0, 5)})` : '',
            'Daftar Ruangan': roomSuggestions[idx] || '',
        }));

        const workbook = XLSX.utils.book_new();
        const scheduleSheet = XLSX.utils.json_to_sheet(templateRows);
        scheduleSheet['!cols'] = [
            { wch: 32 },
            { wch: 24 },
            { wch: 18 },
            { wch: 15 },
            { wch: 18 },
            { wch: 16 },
            { wch: 20 },
        ];
        const refSheet = XLSX.utils.json_to_sheet(refRows);
        refSheet['!cols'] = [
            { wch: 32 },
            { wch: 24 },
            { wch: 18 },
            { wch: 26 },
            { wch: 20 },
        ];

        XLSX.utils.book_append_sheet(workbook, scheduleSheet, 'Jadwal Massal');
        XLSX.utils.book_append_sheet(workbook, refSheet, 'Referensi Data');
        const safePeriodName = (period.name || 'PAS').replace(/[^a-zA-Z0-9_-]+/g, '_');
        XLSX.writeFile(workbook, `Template_Jadwal_Massal_${safePeriodName}.xlsx`);
    };

    const handleImportFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) return;

        setIsImporting(true);
        setSummary(null);
        try {
            const buffer = await file.arrayBuffer();
            const XLSX = await import('xlsx');
            const workbook = XLSX.read(new Uint8Array(buffer), { type: 'array' });
            const firstSheetName = workbook.SheetNames[0];
            if (!firstSheetName) {
                setSummary({ kind: 'error', message: 'Berkas tidak memiliki lembar kerja yang valid.' });
                return;
            }
            const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[firstSheetName], { defval: '' });
            const imported = parseImportedScheduleRows(
                rawRows,
                { classes, subjects, qBanks, sessions, defaultDate },
                () => {
                    rowSequence += 1;
                    return `${Date.now()}-${rowSequence}`;
                },
            );

            if (imported.length === 0) {
                setSummary({ kind: 'error', message: 'Tidak ada baris jadwal yang ditemukan di dalam berkas.' });
                return;
            }

            setRows((previous) => {
                const nonBlank = previous.filter((r) => !isBlankScheduleRow(r));
                return [...nonBlank, ...imported];
            });

            const invalidCount = imported.filter((r) => r.status === 'error').length;
            if (invalidCount > 0) {
                setSummary({
                    kind: 'error',
                    message: `${imported.length} baris dimuat dari berkas, namun ${invalidCount} baris memiliki nama referensi yang belum cocok. Periksa kolom bertanda merah sebelum menyimpan.`,
                });
            } else {
                setSummary({
                    kind: 'success',
                    message: `${imported.length} baris jadwal berhasil dimuat dari berkas. Periksa kembali lalu klik Simpan Semua Jadwal.`,
                });
            }
        } catch {
            setSummary({ kind: 'error', message: 'Gagal membaca berkas Excel/CSV. Pastikan format berkas sesuai template.' });
        } finally {
            setIsImporting(false);
        }
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
                return { ...row, status: 'error', error: 'Lengkapi semua kolom wajib (Bank Soal, Kelas, Tanggal, Sesi).' };
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
    const tzLabel = getSchoolTimeZoneLabel(timeZone);

    return (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-2xs overflow-hidden flex flex-col">
            <div className="p-4 sm:px-5 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50/70">
                <div>
                    <h3 className="font-bold text-slate-900 text-sm">Penjadwalan Massal</h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                        Tambahkan banyak jadwal sekaligus melalui tabel atau impor dari berkas Excel/CSV.
                    </p>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                    <button
                        type="button"
                        onClick={() => void handleDownloadTemplate()}
                        disabled={isSaving || isImporting}
                        className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors disabled:opacity-50"
                    >
                        <Download size={14} className="text-[#3083FF]" />
                        Unduh Template Excel
                    </button>
                    <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={isSaving || isImporting}
                        className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors disabled:opacity-50"
                    >
                        {isImporting ? <Loader2 size={14} className="animate-spin text-emerald-600" /> : <FileSpreadsheet size={14} className="text-emerald-600" />}
                        Import Excel / CSV
                    </button>
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept=".xlsx,.xls,.csv"
                        onChange={(e) => void handleImportFile(e)}
                        className="hidden"
                    />
                </div>
            </div>

            {summary && (
                <div role="status" className={`mx-4 mt-4 rounded-xl border px-4 py-3 text-xs font-medium ${summary.kind === 'success'
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                    : 'border-amber-200 bg-amber-50 text-amber-900'}`}>
                    {summary.message}
                </div>
            )}

            <datalist id={roomDatalistId}>
                {roomSuggestions.map((roomName) => (
                    <option key={roomName} value={roomName} />
                ))}
            </datalist>

            <div className="p-4 overflow-x-auto">
                <table ref={tableRef} className="w-full min-w-[1040px] text-xs border-collapse">
                    <thead>
                        <tr className="border-b border-slate-200 bg-slate-50 text-slate-600">
                            <th className="px-2.5 py-2.5 text-left font-semibold min-w-[210px]">Bank Soal *</th>
                            <th className="px-2.5 py-2.5 text-left font-semibold min-w-[165px]">Mata Pelajaran</th>
                            <th className="px-2.5 py-2.5 text-left font-semibold min-w-[130px]">Kelas *</th>
                            <th className="px-2.5 py-2.5 text-left font-semibold min-w-[140px]">Tanggal * ({tzLabel})</th>
                            <th className="px-2.5 py-2.5 text-left font-semibold min-w-[165px]">Sesi Ujian *</th>
                            <th className="px-2.5 py-2.5 text-left font-semibold w-[96px]">Durasi (Mnt)</th>
                            <th className="px-2.5 py-2.5 text-left font-semibold min-w-[135px]">Ruangan</th>
                            <th className="px-2.5 py-2.5 text-left font-semibold min-w-[150px]">Status</th>
                            <th className="px-2.5 py-2.5 text-center font-semibold w-[80px]">Aksi</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                        {rows.map((row, index) => {
                            const disabled = isSaving || row.status === 'saved';
                            const controlClass = `w-full h-9 px-2.5 bg-white border rounded-lg text-xs text-slate-800 outline-none focus:border-[#3083FF] focus:ring-1 focus:ring-[#3083FF]/20 disabled:opacity-60 ${
                                row.status === 'error' ? 'border-red-300 bg-red-50/40' : 'border-slate-200'
                            }`;
                            return (
                                <tr key={row.id} className={row.status === 'saved' ? 'bg-emerald-50/40' : 'hover:bg-slate-50/60'}>
                                    <td className="p-1.5">
                                        <select
                                            value={row.bank_id}
                                            disabled={disabled}
                                            onChange={(event) => handleChange(row.id, 'bank_id', event.target.value)}
                                            onKeyDown={(event) => handleKeyDown(event, index, 'bank_id')}
                                            className={controlClass}
                                        >
                                            <option value="">Pilih Bank Soal...</option>
                                            {qBanks.map((bank) => (
                                                <option key={bank.id} value={bank.id}>{bank.title}</option>
                                            ))}
                                        </select>
                                    </td>
                                    <td className="p-1.5">
                                        <select
                                            value={row.subject_id}
                                            disabled={disabled}
                                            onChange={(event) => handleChange(row.id, 'subject_id', event.target.value)}
                                            onKeyDown={(event) => handleKeyDown(event, index, 'subject_id')}
                                            className={controlClass}
                                        >
                                            <option value="">Otomatis / Opsional</option>
                                            {subjects.map((subject) => (
                                                <option key={subject.id} value={subject.id}>{subject.name}</option>
                                            ))}
                                        </select>
                                    </td>
                                    <td className="p-1.5">
                                        <select
                                            value={row.class_id}
                                            disabled={disabled}
                                            onChange={(event) => handleChange(row.id, 'class_id', event.target.value)}
                                            onKeyDown={(event) => handleKeyDown(event, index, 'class_id')}
                                            className={controlClass}
                                        >
                                            <option value="">Pilih Kelas...</option>
                                            {classes.map((item) => (
                                                <option key={item.id} value={item.id}>{item.name}</option>
                                            ))}
                                        </select>
                                    </td>
                                    <td className="p-1.5">
                                        <input
                                            type="date"
                                            min={period?.start_date?.split('T')[0]}
                                            max={period?.end_date?.split('T')[0]}
                                            value={row.date}
                                            disabled={disabled}
                                            onChange={(event) => handleChange(row.id, 'date', event.target.value)}
                                            onKeyDown={(event) => handleKeyDown(event, index, 'date')}
                                            className={controlClass}
                                        />
                                    </td>
                                    <td className="p-1.5">
                                        <select
                                            value={row.session_id}
                                            disabled={disabled}
                                            onChange={(event) => handleChange(row.id, 'session_id', event.target.value)}
                                            onKeyDown={(event) => handleKeyDown(event, index, 'session_id')}
                                            className={controlClass}
                                        >
                                            <option value="">Pilih Sesi...</option>
                                            {sessions.map((session) => (
                                                <option key={session.id} value={session.id}>
                                                    {session.name} ({session.start_time.substring(0, 5)} - {session.end_time.substring(0, 5)} {tzLabel})
                                                </option>
                                            ))}
                                        </select>
                                    </td>
                                    <td className="p-1.5">
                                        <input
                                            type="number"
                                            min="1"
                                            value={row.duration_minutes ?? 90}
                                            disabled={disabled}
                                            onChange={(event) => handleChange(row.id, 'duration_minutes', parseInt(event.target.value, 10) || 0)}
                                            onKeyDown={(event) => handleKeyDown(event, index, 'duration_minutes')}
                                            className={controlClass}
                                        />
                                    </td>
                                    <td className="p-1.5">
                                        <input
                                            type="text"
                                            list={roomDatalistId}
                                            placeholder="Opsional..."
                                            value={row.room}
                                            disabled={disabled}
                                            onChange={(event) => handleChange(row.id, 'room', event.target.value)}
                                            onKeyDown={(event) => handleKeyDown(event, index, 'room')}
                                            className={controlClass}
                                        />
                                    </td>
                                    <td className="px-2.5 py-2 align-middle">
                                        {row.status === 'saving' && <span className="flex items-center gap-1.5 text-blue-700 font-medium"><Loader2 size={14} className="animate-spin shrink-0" /> Menyimpan</span>}
                                        {row.status === 'saved' && <span className="flex items-center gap-1.5 text-emerald-700 font-medium"><CheckCircle2 size={14} className="shrink-0" /> Tersimpan</span>}
                                        {row.status === 'error' && <span className="flex items-start gap-1.5 text-red-600"><XCircle size={14} className="mt-0.5 shrink-0" /> <span>{row.error}</span></span>}
                                        {row.status === 'idle' && <span className="text-slate-400">Belum disimpan</span>}
                                    </td>
                                    <td className="p-1.5 text-center">
                                        <div className="flex items-center justify-center gap-1">
                                            <button
                                                type="button"
                                                onClick={() => handleDuplicateRow(index)}
                                                disabled={isSaving}
                                                title="Duplikat baris untuk kelas lain"
                                                aria-label="Duplikat baris"
                                                className="p-1.5 text-slate-400 hover:text-[#3083FF] rounded-lg disabled:opacity-30 transition-colors"
                                            >
                                                <Copy size={14} />
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => handleRemoveRow(row.id)}
                                                disabled={rows.length === 1 || disabled}
                                                title="Hapus baris"
                                                aria-label="Hapus baris"
                                                className="p-1.5 text-slate-400 hover:text-red-500 rounded-lg disabled:opacity-30 transition-colors"
                                            >
                                                <Trash2 size={14} />
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
                <div className="mt-4 flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-2 flex-wrap">
                        <button
                            type="button"
                            onClick={handleAddRow}
                            disabled={isSaving}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-slate-100 text-slate-700 hover:bg-slate-200 rounded-lg border border-slate-200 disabled:opacity-50"
                        >
                            <Plus size={14} /> Tambah Baris
                        </button>
                        {rows.length > 1 && savedCount === 0 && (
                            <button
                                type="button"
                                onClick={handleResetRows}
                                disabled={isSaving}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-500 hover:text-slate-700 rounded-lg disabled:opacity-50"
                            >
                                <RotateCcw size={13} /> Reset Baris
                            </button>
                        )}
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-slate-500">
                        <Info size={14} className="shrink-0" />
                        <span>Gunakan tombol duplikat pada baris untuk menyalin jadwal ke kelas lain dengan cepat, atau pisahkan nama kelas dengan koma di Excel.</span>
                    </div>
                </div>
                {timeZoneError && <p role="alert" className="mt-3 text-sm text-red-700">{timeZoneError}</p>}
            </div>

            <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-3 flex-wrap">
                <span className="text-xs text-slate-500">
                    {savedCount > 0 ? `${savedCount} dari ${rows.length} baris sudah tersimpan.` : `${rows.length} baris pada daftar.`}
                </span>
                <div className="flex justify-end gap-2.5">
                    <button
                        type="button"
                        onClick={handleClose}
                        disabled={isSaving}
                        className="px-4 py-2 text-xs font-semibold text-slate-600 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 disabled:opacity-50"
                    >
                        {savedCount > 0 ? 'Selesai' : 'Kembali ke Jadwal'}
                    </button>
                    <button
                        type="button"
                        onClick={() => void handleSave()}
                        disabled={isSaving}
                        className="px-4 py-2 text-xs font-bold text-white bg-[#3083FF] rounded-xl hover:bg-[#2563EB] flex items-center gap-1.5 disabled:opacity-50"
                    >
                        {isSaving ? <Loader2 size={15} className="animate-spin" /> : retryCount > 0 ? <RotateCcw size={15} /> : <Save size={15} />}
                        {isSaving ? 'Menyimpan...' : retryCount > 0 ? `Coba Lagi ${retryCount} Baris` : 'Simpan Semua Jadwal'}
                    </button>
                </div>
            </div>
        </div>
    );
}
