"use client";

import React, { useState, useEffect } from 'react';
import { X, Check, Loader2, FolderEdit, UserCheck } from 'lucide-react';
import { Button } from '@/app/components/ui/button';
import { updatePASPeriodAction } from '@/lib/api/pas';
import { alertDialog } from '@/lib/confirm-dialog';
import type { PASPeriod } from '@/app/types/pas';

export interface EditPASPeriodModalProps {
    isOpen: boolean;
    period: PASPeriod | null;
    onClose: () => void;
    onSuccess: (updatedPeriod: PASPeriod) => void;
}

type PeriodType = 'pas' | 'pat' | 'pts' | 'pkn' | 'am';
type Semester = 'ganjil' | 'genap';

export default function EditPASPeriodModal({
    isOpen,
    period,
    onClose,
    onSuccess,
}: EditPASPeriodModalProps) {
    const [name, setName] = useState('');
    const [type, setType] = useState<PeriodType>('pas');
    const [schoolYear, setSchoolYear] = useState('');
    const [semester, setSemester] = useState<Semester>('ganjil');
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [committeeChairName, setCommitteeChairName] = useState('');
    const [committeeChairNip, setCommitteeChairNip] = useState('');

    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (period) {
            setName(period.name || '');
            setType((period.type as PeriodType) || 'pas');
            setSchoolYear(period.school_year || '');
            setSemester((period.semester as Semester) || 'ganjil');
            setStartDate(period.start_date ? period.start_date.split('T')[0] : '');
            setEndDate(period.end_date ? period.end_date.split('T')[0] : '');
            setCommitteeChairName(period.committee_chair_name || '');
            setCommitteeChairNip(period.committee_chair_nip || '');
            setError(null);
        }
    }, [period, isOpen]);

    if (!isOpen || !period) return null;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const trimmedName = name.trim();
        if (!trimmedName) {
            setError('Nama folder ujian wajib diisi.');
            return;
        }

        setIsSaving(true);
        setError(null);
        try {
            const res = await updatePASPeriodAction(period.id, {
                name: trimmedName,
                type,
                school_year: schoolYear.trim(),
                semester,
                start_date: startDate,
                end_date: endDate,
                committee_chair_name: committeeChairName.trim() || undefined,
                committee_chair_nip: committeeChairNip.trim() || undefined,
            });

            if (!res.success) {
                setError(res.error || 'Gagal menyimpan perubahan folder ujian.');
                return;
            }

            onSuccess(res as unknown as PASPeriod);
            onClose();
        } catch (err: any) {
            setError(err?.message || 'Terjadi kesalahan saat menyimpan.');
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 animate-in fade-in duration-150">
            <div className="bg-white w-full max-w-lg rounded-2xl p-6 relative shadow-2xl max-h-[90vh] overflow-y-auto">
                <button
                    type="button"
                    onClick={onClose}
                    className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 transition-colors p-1"
                >
                    <X size={20} />
                </button>

                <div className="flex items-center gap-3 mb-5">
                    <div className="w-10 h-10 bg-blue-50 border border-blue-200 rounded-xl flex items-center justify-center text-[#3083FF] shrink-0">
                        <FolderEdit size={20} />
                    </div>
                    <div>
                        <h3 className="text-base font-bold text-slate-900">Edit Folder Ujian</h3>
                        <p className="text-xs text-slate-500">Ubah identitas folder, jadwal, dan susunan kepanitiaan ujian</p>
                    </div>
                </div>

                {error && (
                    <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                        {error}
                    </div>
                )}

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label className="block text-xs font-bold text-slate-700 mb-1">
                            Nama Folder / Nama Ujian <span className="text-red-500">*</span>
                        </label>
                        <input
                            type="text"
                            required
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="Contoh: ASAS Ganjil 2025/2026"
                            className="w-full h-10 px-3 text-xs bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-[#3083FF] focus:ring-1 focus:ring-[#3083FF]/20"
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-xs font-bold text-slate-700 mb-1">Kategori Ujian</label>
                            <select
                                value={type}
                                onChange={(e) => setType(e.target.value as PeriodType)}
                                className="w-full h-10 px-3 text-xs bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-[#3083FF]"
                            >
                                <option value="pas">ASAS / PAS (Akhir Semester)</option>
                                <option value="pat">ASAT / PAT (Akhir Tahun)</option>
                                <option value="pts">PTS / UTS</option>
                                <option value="pkn">Asesmen Lainnya</option>
                                <option value="am">Asesmen Madrasah</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-slate-700 mb-1">Semester</label>
                            <select
                                value={semester}
                                onChange={(e) => setSemester(e.target.value as Semester)}
                                className="w-full h-10 px-3 text-xs bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-[#3083FF]"
                            >
                                <option value="ganjil">Semester Ganjil</option>
                                <option value="genap">Semester Genap</option>
                            </select>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div>
                            <label className="block text-xs font-bold text-slate-700 mb-1">
                                Tahun Ajaran <span className="text-red-500">*</span>
                            </label>
                            <input
                                type="text"
                                required
                                value={schoolYear}
                                onChange={(e) => setSchoolYear(e.target.value)}
                                placeholder="2025/2026"
                                className="w-full h-10 px-3 text-xs bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-[#3083FF]"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-slate-700 mb-1">Tanggal Mulai</label>
                            <input
                                type="date"
                                required
                                value={startDate}
                                onChange={(e) => setStartDate(e.target.value)}
                                className="w-full h-10 px-3 text-xs bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-[#3083FF]"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-slate-700 mb-1">Tanggal Selesai</label>
                            <input
                                type="date"
                                required
                                min={startDate || undefined}
                                value={endDate}
                                onChange={(e) => setEndDate(e.target.value)}
                                className="w-full h-10 px-3 text-xs bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-[#3083FF]"
                            />
                        </div>
                    </div>

                    {/* Section: Susunan Kepanitiaan (Ketua Panitia) */}
                    <div className="pt-3 border-t border-slate-100">
                        <div className="flex items-center gap-1.5 mb-2.5">
                            <UserCheck size={14} className="text-[#3083FF]" />
                            <h4 className="text-xs font-bold text-slate-800">Kepanitiaan Ujian</h4>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div>
                                <label className="block text-xs font-medium text-slate-700 mb-1">
                                    Nama Ketua Panitia
                                </label>
                                <input
                                    type="text"
                                    value={committeeChairName}
                                    onChange={(e) => setCommitteeChairName(e.target.value)}
                                    placeholder="Contoh: Drs. H. Ahmad Fauzi, M.Pd."
                                    className="w-full h-10 px-3 text-xs bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-[#3083FF]"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-slate-700 mb-1">
                                    NIP Ketua Panitia (Opsional)
                                </label>
                                <input
                                    type="text"
                                    value={committeeChairNip}
                                    onChange={(e) => setCommitteeChairNip(e.target.value)}
                                    placeholder="197505102000031002"
                                    className="w-full h-10 px-3 text-xs bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-[#3083FF]"
                                />
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2 text-xs font-medium text-slate-600 hover:text-slate-800 rounded-xl hover:bg-slate-100 transition-colors"
                        >
                            Batal
                        </button>
                        <Button
                            type="submit"
                            disabled={isSaving || !name.trim()}
                            className="bg-[#3083FF] hover:bg-[#256cd1] text-white text-xs h-9 px-5 rounded-xl flex items-center gap-1.5"
                        >
                            {isSaving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                            Simpan Perubahan
                        </Button>
                    </div>
                </form>
            </div>
        </div>
    );
}
