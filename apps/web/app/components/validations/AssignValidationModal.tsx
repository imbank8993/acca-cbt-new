"use client";

import React, { useState, useEffect } from 'react';
import {
    Calendar,
    UserCheck,
    ShieldCheck,
    Loader2,
    Search,
    BookOpen,
} from 'lucide-react';
import { Button } from '@/app/components/ui/button';
import { Modal, ModalBody, ModalFooter } from '@/app/components/ui/modal';
import { InlineSelect } from '@/app/components/ui/inlineselect';
import { DatePicker } from '@/app/components/ui/DatePicker';
import { listTeachersAndInvigilators, type PASStaffMember } from '@/lib/api/pas';
import { createValidation, type ApprovalRule } from '@/lib/api/validations';
import type { QuestionBank } from '@/lib/api/questions';

interface AssignValidationModalProps {
    isOpen: boolean;
    onClose: () => void;
    banks: QuestionBank[];
    selectedBank?: QuestionBank | null;
    onSuccess: () => void;
}

export function AssignValidationModal({
    isOpen,
    onClose,
    banks,
    selectedBank,
    onSuccess,
}: AssignValidationModalProps) {
    const [targetBankId, setTargetBankId] = useState<string>(selectedBank?.id || '');
    const [title, setTitle] = useState('');
    const [instructions, setInstructions] = useState('');
    const [selectedValidatorIds, setSelectedValidatorIds] = useState<string[]>([]);
    const [deadline, setDeadline] = useState('');
    const [approvalRule, setApprovalRule] = useState<ApprovalRule>('unanimous');

    const [staffList, setStaffList] = useState<PASStaffMember[]>([]);
    const [teacherSearch, setTeacherSearch] = useState('');
    const [staffLoading, setStaffLoading] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);

    useEffect(() => {
        if (selectedBank) {
            setTargetBankId(selectedBank.id);
            setTitle(`Validasi Soal: ${selectedBank.title}`);
        } else if (targetBankId) {
            const b = banks.find(x => x.id === targetBankId);
            if (b) setTitle(`Validasi Soal: ${b.title}`);
        }
    }, [selectedBank, targetBankId, banks]);

    useEffect(() => {
        if (!isOpen) return;
        setStaffLoading(true);
        listTeachersAndInvigilators()
            .then(res => setStaffList(res))
            .catch(() => setStaffList([]))
            .finally(() => setStaffLoading(false));
    }, [isOpen]);

    const toggleValidator = (id: string) => {
        setSelectedValidatorIds(prev =>
            prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
        );
    };

    const filteredStaff = staffList.filter(staff => {
        const query = teacherSearch.toLowerCase();
        return staff.name.toLowerCase().includes(query);
    });

    const handleSubmit = async (e?: React.FormEvent) => {
        if (e) e.preventDefault();
        setErrorMessage(null);

        if (!targetBankId) {
            setErrorMessage('Pilih bank soal yang akan divalidasi.');
            return;
        }
        if (selectedValidatorIds.length === 0) {
            setErrorMessage('Pilih minimal satu orang guru sebagai validator.');
            return;
        }

        setIsSubmitting(true);
        try {
            const res = await createValidation({
                bankId: targetBankId,
                validatorIds: selectedValidatorIds,
                title: title.trim(),
                instructions: instructions.trim(),
                deadline: deadline ? new Date(deadline).toISOString() : undefined,
                approvalRule,
            });

            if (res.success) {
                onSuccess();
                onClose();
            } else {
                setErrorMessage(res.error || 'Gagal membuat tugas validasi.');
            }
        } catch (err: any) {
            setErrorMessage(err.message || 'Terjadi kesalahan sistem.');
        } finally {
            setIsSubmitting(false);
        }
    };

    const bankOptions = [
        { value: '', label: '-- Pilih Bank Soal --' },
        ...banks.map(b => ({
            value: b.id,
            label: `${b.title} (${b.subject || '-'}, ${b.class_level || '-'})`,
        })),
    ];

    const approvalOptions = [
        { value: 'unanimous', label: 'Semua Validator Harus Setuju (Mutlak)' },
        { value: 'any', label: 'Cukup Salah Satu Setuju' },
        { value: 'admin_decides', label: 'Keputusan Akhir oleh Admin/Proktor' },
    ];

    return (
        <Modal
            open={isOpen}
            onClose={onClose}
            size="lg"
            title="Tugaskan Validasi Bank Soal"
            subtitle="Tunjuk guru validator untuk memvalidasi kelayakan naskah butir soal."
            icon="shield-check"
        >
            <ModalBody className="space-y-4 max-h-[70vh] overflow-y-auto">
                {errorMessage && (
                    <div className="p-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 rounded-xl text-red-600 dark:text-red-400 text-xs font-medium">
                        {errorMessage}
                    </div>
                )}

                {/* Bank Soal Selection */}
                <div>
                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                        Bank Soal yang Divalidasi <span className="text-red-500">*</span>
                    </label>
                    {selectedBank ? (
                        <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200 dark:border-slate-700 flex items-center justify-between">
                            <div>
                                <p className="font-bold text-sm text-slate-800 dark:text-slate-100">{selectedBank.title}</p>
                                <p className="text-xs text-slate-400">
                                    {selectedBank.subject || 'Mapel Umum'} • {selectedBank.class_level || 'Semua Kelas'}
                                </p>
                            </div>
                            <span className="px-2.5 py-1 bg-primary/10 text-primary font-bold text-xs rounded-lg">
                                Terpilih
                            </span>
                        </div>
                    ) : (
                        <InlineSelect
                            value={targetBankId}
                            onChange={setTargetBankId}
                            options={bankOptions}
                            minWidth="100%"
                            height="38px"
                        />
                    )}
                </div>

                {/* Judul Penugasan */}
                <div>
                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                        Judul Tugas Validasi
                    </label>
                    <input
                        type="text"
                        value={title}
                        onChange={e => setTitle(e.target.value)}
                        placeholder="Contoh: Validasi Soal PAS Ganjil - Biologi XII"
                        className="w-full px-3.5 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-medium focus:ring-2 focus:ring-primary/20 outline-none"
                    />
                </div>

                {/* Pilih Guru Validator (Dapat di-search) */}
                <div>
                    <div className="flex items-center justify-between mb-1.5">
                        <label className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                            Tim Guru Validator <span className="text-red-500">*</span>
                        </label>
                        <span className="text-[11px] text-slate-400 font-semibold">
                            {selectedValidatorIds.length} validator dipilih
                        </span>
                    </div>

                    {/* Search Guru */}
                    <div className="relative mb-2">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={13} />
                        <input
                            type="text"
                            value={teacherSearch}
                            onChange={e => setTeacherSearch(e.target.value)}
                            placeholder="Cari nama guru validator..."
                            className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-primary/20"
                        />
                    </div>

                    <div className="border border-slate-200 dark:border-slate-800 rounded-xl p-2 max-h-40 overflow-y-auto space-y-1 bg-slate-50/50 dark:bg-slate-800/40">
                        {staffLoading ? (
                            <div className="py-6 flex items-center justify-center gap-2 text-xs text-slate-400">
                                <Loader2 size={16} className="animate-spin" /> Memuat daftar guru...
                            </div>
                        ) : filteredStaff.length === 0 ? (
                            <p className="text-xs text-slate-400 text-center py-4">
                                {teacherSearch ? 'Tidak ada guru yang cocok dengan pencarian.' : 'Tidak ada data guru.'}
                            </p>
                        ) : (
                            filteredStaff.map(staff => {
                                const isSelected = selectedValidatorIds.includes(staff.id);
                                return (
                                    <div
                                        key={staff.id}
                                        onClick={() => toggleValidator(staff.id)}
                                        className={`flex items-center justify-between p-2 rounded-lg cursor-pointer transition-colors ${
                                            isSelected
                                                ? 'bg-primary/10 border border-primary/30 text-primary dark:text-blue-400 font-semibold'
                                                : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 border border-transparent'
                                        }`}
                                    >
                                        <div className="flex items-center gap-2.5">
                                            <input
                                                type="checkbox"
                                                checked={isSelected}
                                                onChange={() => {}}
                                                className="rounded text-primary focus:ring-0"
                                            />
                                            <span className="text-xs">{staff.name}</span>
                                        </div>
                                        <div className="flex items-center gap-1">
                                            {staff.roles?.map(r => (
                                                <span
                                                    key={r}
                                                    className="px-1.5 py-0.5 text-[9px] bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded font-medium"
                                                >
                                                    {r}
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>
                </div>

                {/* Deadline & Kebijakan Persetujuan (InlineSelect) */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                            <Calendar size={13} /> Batas Waktu Validasi
                        </label>
                        <DatePicker
                            value={deadline}
                            onChange={setDeadline}
                            placeholder="Pilih tanggal batas..."
                            min={new Date().toISOString().split('T')[0]}
                        />
                    </div>

                    <div>
                        <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                            Kebijakan Persetujuan
                        </label>
                        <InlineSelect
                            value={approvalRule}
                            onChange={val => setApprovalRule(val as ApprovalRule)}
                            options={approvalOptions}
                            minWidth="100%"
                            height="34px"
                        />
                    </div>
                </div>

                {/* Instruksi Khusus */}
                <div>
                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                        Instruksi Khusus untuk Validator (Opsional)
                    </label>
                    <textarea
                        rows={2}
                        value={instructions}
                        onChange={e => setInstructions(e.target.value)}
                        placeholder="Contoh: Periksa kesesuaian soal HOTS nomor 20-30 dan kejelasan gambar stimulus pada tabel."
                        className="w-full p-2.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-medium focus:ring-2 focus:ring-primary/20 outline-none resize-none"
                    />
                </div>
            </ModalBody>

            <ModalFooter>
                <Button variant="ghost" onClick={onClose} disabled={isSubmitting} size="sm">
                    Batal
                </Button>
                <Button
                    onClick={handleSubmit}
                    disabled={isSubmitting || !targetBankId || selectedValidatorIds.length === 0}
                    className="bg-primary hover:bg-primary/90 text-white font-bold flex items-center gap-1.5 text-xs shadow-sm"
                    size="sm"
                >
                    {isSubmitting ? (
                        <>
                            <Loader2 size={14} className="animate-spin" />
                            Menyimpan...
                        </>
                    ) : (
                        <>
                            <ShieldCheck size={14} />
                            Terbitkan Tugas Validasi
                        </>
                    )}
                </Button>
            </ModalFooter>
        </Modal>
    );
}
