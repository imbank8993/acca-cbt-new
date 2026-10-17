"use client";

import React, { useState, useEffect } from 'react';
import { FolderEdit, AlertCircle, UserCheck } from 'lucide-react';
import { Modal, ModalBody, ModalFooter, ModalField } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { InlineSelect } from '@/components/ui/InlineSelect';
import { updatePASPeriodAction } from '@/lib/api/pas';
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

    const isAM = type === 'am';

    return (
        <Modal
            open={isOpen}
            onClose={onClose}
            size="xl"
            variant="edit"
            icon={<FolderEdit size={18} />}
            title={`Edit Folder Ujian ${isAM ? 'Asesmen Madrasah' : 'ASAS / ASAT'}`}
            subtitle="Ubah identitas folder ujian, rentang jadwal, serta susunan kepanitiaan ujian"
            labelledBy="modal-edit-pas-period"
            className="create-exam-modal"
        >
            <form onSubmit={handleSubmit}>
                <ModalBody className="create-exam-modal__body">
                    {error && (
                        <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-600 flex items-center gap-2">
                            <AlertCircle size={15} className="shrink-0" />
                            <span>{error}</span>
                        </div>
                    )}

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <ModalField label="Nama Folder / Nama Ujian" required hint="Nama ini menjadi judul ujian yang tampil pada daftar ujian dan siswa">
                            <input
                                type="text"
                                required
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                placeholder={isAM ? 'Contoh: Asesmen Madrasah 2026/2027' : 'Contoh: ASAS Ganjil 2025/2026'}
                            />
                        </ModalField>

                        <ModalField label="Semester" required>
                            <InlineSelect
                                options={[
                                    { value: 'ganjil', label: 'Semester Ganjil' },
                                    { value: 'genap', label: 'Semester Genap' },
                                ]}
                                value={semester}
                                onChange={(val) => setSemester(val as Semester)}
                            />
                        </ModalField>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <ModalField label="Kategori Asesmen" required>
                            <InlineSelect
                                options={[
                                    { value: 'pas', label: 'ASAS / PAS (Akhir Semester)' },
                                    { value: 'pat', label: 'ASAT / PAT (Akhir Tahun)' },
                                    { value: 'pts', label: 'PTS / UTS' },
                                    { value: 'pkn', label: 'Asesmen Lainnya' },
                                    { value: 'am', label: 'Asesmen Madrasah' },
                                ]}
                                value={type}
                                onChange={(val) => setType(val as PeriodType)}
                            />
                        </ModalField>

                        <ModalField label="Tahun Ajaran" required>
                            <input
                                type="text"
                                required
                                value={schoolYear}
                                onChange={(e) => setSchoolYear(e.target.value)}
                                placeholder="Contoh: 2025/2026"
                            />
                        </ModalField>

                        <div className="grid grid-cols-2 gap-2">
                            <ModalField label="Tanggal Mulai" required>
                                <input
                                    type="date"
                                    required
                                    value={startDate}
                                    onChange={(e) => setStartDate(e.target.value)}
                                />
                            </ModalField>

                            <ModalField label="Tanggal Selesai" required>
                                <input
                                    type="date"
                                    required
                                    min={startDate || undefined}
                                    value={endDate}
                                    onChange={(e) => setEndDate(e.target.value)}
                                />
                            </ModalField>
                        </div>
                    </div>

                    {/* Section: Susunan Kepanitiaan (Ketua Panitia) */}
                    <div className="pt-2 border-t border-slate-100">
                        <div className="flex items-center gap-1.5 mb-2">
                            <UserCheck size={14} className="text-[#3083FF]" />
                            <span className="text-xs font-bold text-slate-800">Kepanitiaan Ujian (Administrasi Dokumen)</span>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <ModalField label="Nama Lengkap & Gelar Ketua Panitia" hint="Dicantumkan pada Berita Acara dan Daftar Hadir">
                                <input
                                    type="text"
                                    value={committeeChairName}
                                    onChange={(e) => setCommitteeChairName(e.target.value)}
                                    placeholder="Contoh: Drs. H. Ahmad Fauzi, M.Pd."
                                />
                            </ModalField>

                            <ModalField label="NIP Ketua Panitia (Opsional)">
                                <input
                                    type="text"
                                    value={committeeChairNip}
                                    onChange={(e) => setCommitteeChairNip(e.target.value)}
                                    placeholder="Contoh: 197505102000031002 atau -"
                                />
                            </ModalField>
                        </div>
                    </div>
                </ModalBody>

                <ModalFooter>
                    <Button
                        type="button"
                        variant="cancel"
                        onClick={onClose}
                        disabled={isSaving}
                        icon="cancel"
                    >
                        Batal
                    </Button>
                    <Button
                        type="submit"
                        variant="primary"
                        isLoading={isSaving}
                        disabled={isSaving || !name.trim()}
                        icon={isSaving ? undefined : "save"}
                    >
                        Simpan Perubahan
                    </Button>
                </ModalFooter>
            </form>
        </Modal>
    );
}
