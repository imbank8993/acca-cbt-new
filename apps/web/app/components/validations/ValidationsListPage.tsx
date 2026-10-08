"use client";

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
    ShieldCheck,
    Plus,
    Calendar,
    CheckCircle2,
    Clock,
    AlertCircle,
    UserCheck,
    ChevronRight,
    RefreshCw,
    XCircle,
    Layers,
    Play,
    Printer,
} from 'lucide-react';
import { Button } from '@/app/components/ui/button';
import { Spinner } from '@/app/components/ui/Spinner';
import {
    FilterToolbar,
    FilterSearch,
    FilterSelect,
    FilterActions,
} from '@/app/components/ui/filtertoolbar';
import { Modal, ModalBody, ModalFooter } from '@/app/components/ui/modal';
import {
    listValidations,
    type ValidationSession,
    type ValidationStatus,
} from '@/lib/api/validations';
import { listQuestionBanks, type QuestionBank } from '@/lib/api/questions';
import { AssignValidationModal } from './AssignValidationModal';
import { ValidationReportModal } from './ValidationReportModal';

interface ValidationsListPageProps {
    role: 'Admin' | 'Proktor';
}

export function ValidationsListPage({ role }: ValidationsListPageProps) {
    const [validations, setValidations] = useState<ValidationSession[]>([]);
    const [banks, setBanks] = useState<QuestionBank[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState<string>('all');
    const [isAssignModalOpen, setIsAssignModalOpen] = useState(false);
    const [selectedDetailVal, setSelectedDetailVal] = useState<ValidationSession | null>(null);
    const [reportValId, setReportValId] = useState<string | null>(null);

    const loadData = useCallback(async () => {
        setLoading(true);
        try {
            const [valList, bankList] = await Promise.all([
                listValidations(),
                listQuestionBanks(),
            ]);
            setValidations(valList);
            setBanks(bankList);
        } catch (e) {
            console.error('Failed to load validations', e);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadData();
    }, [loadData]);

    const filtered = validations.filter(v => {
        const matchesSearch =
            v.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
            v.bank?.title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
            v.bank?.subject?.toLowerCase().includes(searchQuery.toLowerCase()) ||
            v.validators?.some(val => val.profile?.full_name?.toLowerCase().includes(searchQuery.toLowerCase()));

        if (!matchesSearch) return false;
        if (statusFilter === 'all') return true;
        return v.status === statusFilter;
    });

    const getStatusBadge = (status: ValidationStatus) => {
        switch (status) {
            case 'pending':
                return (
                    <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300 flex items-center gap-1.5">
                        <Clock size={12} /> Menunggu Review
                    </span>
                );
            case 'in_progress':
                return (
                    <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400 flex items-center gap-1.5">
                        <RefreshCw size={12} className="animate-spin" /> Sedang Divalidasi
                    </span>
                );
            case 'revision_needed':
                return (
                    <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400 flex items-center gap-1.5">
                        <AlertCircle size={12} /> Perlu Revisi
                    </span>
                );
            case 'approved':
                return (
                    <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400 flex items-center gap-1.5">
                        <CheckCircle2 size={12} /> Disetujui (Valid)
                    </span>
                );
            case 'rejected':
                return (
                    <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-50 text-rose-600 dark:bg-rose-950/40 dark:text-rose-400 flex items-center gap-1.5">
                        <XCircle size={12} /> Ditolak
                    </span>
                );
        }
    };

    return (
        <div className="space-y-4">
            {/* Filter Toolbar (Standardized, tanpa heading berulang karena sudah ada di header) */}
            <FilterToolbar>
                <FilterSearch
                    value={searchQuery}
                    onChange={setSearchQuery}
                    placeholder="Cari bank soal, mapel, atau validator..."
                    width={320}
                />
                <FilterSelect
                    label="Status"
                    value={statusFilter}
                    onChange={setStatusFilter}
                    options={[
                        { value: 'all', label: 'Semua Status' },
                        { value: 'pending', label: 'Menunggu' },
                        { value: 'in_progress', label: 'Sedang Divalidasi' },
                        { value: 'revision_needed', label: 'Perlu Revisi' },
                        { value: 'approved', label: 'Disetujui' },
                        { value: 'rejected', label: 'Ditolak' },
                    ]}
                />
                <FilterActions>
                    <Button
                        variant="outline"
                        onClick={loadData}
                        className="flex items-center gap-1.5 text-xs font-bold"
                    >
                        <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Refresh
                    </Button>
                    <Button
                        onClick={() => setIsAssignModalOpen(true)}
                        className="bg-primary hover:bg-primary/90 text-white font-bold flex items-center gap-1.5 text-xs shadow-md shadow-primary/20"
                    >
                        <Plus size={15} /> Tugaskan Validasi Baru
                    </Button>
                </FilterActions>
            </FilterToolbar>

            {/* List / Cards */}
            {loading ? (
                <div className="py-20 flex flex-col items-center justify-center gap-3">
                    <Spinner size={32} />
                    <p className="text-xs text-slate-400 font-medium">Memuat data validasi bank soal...</p>
                </div>
            ) : filtered.length === 0 ? (
                <div className="py-16 bg-white dark:bg-slate-900 rounded-2xl border border-dashed border-slate-200 dark:border-slate-800 text-center p-6">
                    <div className="w-14 h-14 bg-primary/10 rounded-2xl flex items-center justify-center mx-auto mb-3 text-primary">
                        <ShieldCheck size={28} />
                    </div>
                    <h3 className="text-base font-bold text-slate-800 dark:text-slate-100">
                        Belum Ada Penugasan Validasi
                    </h3>
                    <p className="text-xs text-slate-500 max-w-sm mx-auto mt-1 mb-4">
                        Tugaskan guru sebagai validator untuk memeriksa kualitas soal, kunci jawaban, dan stimulus sebelum ujian dimulai.
                    </p>
                    <Button
                        onClick={() => setIsAssignModalOpen(true)}
                        className="bg-primary text-white font-bold text-xs"
                    >
                        <Plus size={14} className="mr-1.5" /> Buat Penugasan Validasi
                    </Button>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {filtered.map(item => {
                        const submittedCount = item.validators?.filter(v => v.status === 'submitted').length || 0;
                        const totalValidators = item.validators?.length || 0;

                        return (
                            <div
                                key={item.id}
                                className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm hover:shadow-md transition-all p-5 flex flex-col justify-between"
                            >
                                <div>
                                    <div className="flex items-start justify-between gap-3 mb-3">
                                        {getStatusBadge(item.status)}
                                        <span className="text-[11px] text-slate-400 flex items-center gap-1">
                                            <Calendar size={12} />
                                            {item.created_at ? new Date(item.created_at).toLocaleDateString('id-ID') : '-'}
                                        </span>
                                    </div>

                                    <h3 className="font-bold text-sm text-slate-800 dark:text-slate-100 line-clamp-2 mb-1">
                                        {item.title}
                                    </h3>
                                    <p className="text-xs text-slate-500 dark:text-slate-400 mb-4 flex items-center gap-1.5">
                                        <Layers size={13} className="text-slate-400" />
                                        {item.bank?.subject || 'Mapel Umum'} • {item.bank?.class_level || 'Semua Kelas'}
                                    </p>

                                    {/* Tim Validator & Progres */}
                                    <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl space-y-2 mb-4 border border-slate-100 dark:border-slate-800">
                                        <div className="flex items-center justify-between text-xs font-semibold">
                                            <span className="text-slate-500 flex items-center gap-1">
                                                <UserCheck size={13} /> Guru Validator
                                            </span>
                                            <span className="text-slate-700 dark:text-slate-300 font-bold">
                                                {submittedCount} / {totalValidators} Selesai
                                            </span>
                                        </div>

                                        <div className="space-y-1">
                                            {item.validators?.map(v => (
                                                <div
                                                    key={v.id}
                                                    className="flex items-center justify-between text-[11px] py-0.5"
                                                >
                                                    <span className="text-slate-700 dark:text-slate-300 font-medium truncate max-w-[150px]">
                                                        {v.profile?.full_name || 'Validator'}
                                                    </span>
                                                    <span
                                                        className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                                                            v.status === 'submitted'
                                                                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400'
                                                                : v.status === 'in_progress'
                                                                ? 'bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-400'
                                                                : 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-400'
                                                        }`}
                                                    >
                                                        {v.status === 'submitted'
                                                            ? 'Selesai'
                                                            : v.status === 'in_progress'
                                                            ? 'Memvalidasi'
                                                            : 'Belum'}
                                                    </span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>

                                <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs gap-2">
                                    <span className="text-[11px] text-slate-400">
                                        {item.deadline
                                            ? `Batas: ${new Date(item.deadline).toLocaleDateString('id-ID')}`
                                            : 'Tanpa batas'}
                                    </span>
                                    <div className="flex items-center gap-1.5">
                                        <button
                                            type="button"
                                            onClick={() => setReportValId(item.id)}
                                            className="text-slate-500 hover:text-primary dark:hover:text-primary font-semibold flex items-center gap-1 text-xs px-2 py-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                                            title="Cetak Laporan Validasi"
                                        >
                                            <Printer size={13} /> Laporan
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setSelectedDetailVal(item)}
                                            className="text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 font-semibold flex items-center gap-0.5 text-xs px-2 py-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                                        >
                                            Rincian <ChevronRight size={13} />
                                        </button>
                                        <Link
                                            href={`/dashboard/guru/validations/${item.id}/review`}
                                            className="px-3 py-1.5 bg-primary text-white hover:bg-primary/90 font-bold rounded-xl flex items-center gap-1.5 text-xs shadow-sm shadow-primary/20 transition-all shrink-0"
                                        >
                                            <Play size={12} className="fill-white" /> Validasi
                                        </Link>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Modal Assign */}
            <AssignValidationModal
                isOpen={isAssignModalOpen}
                onClose={() => setIsAssignModalOpen(false)}
                banks={banks}
                onSuccess={loadData}
            />

            {/* Modal Cetak Laporan Validasi */}
            <ValidationReportModal
                isOpen={!!reportValId}
                onClose={() => setReportValId(null)}
                validationId={reportValId || ''}
            />

            {/* Modal Rincian Catatan Validasi */}
            {selectedDetailVal && (
                <Modal
                    open={!!selectedDetailVal}
                    onClose={() => setSelectedDetailVal(null)}
                    size="lg"
                    title="Rincian Sesi Validasi"
                    subtitle={selectedDetailVal.title}
                    icon={<ShieldCheck size={20} />}
                >
                    <ModalBody className="space-y-4">
                        <div className="grid grid-cols-2 gap-3 p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl text-xs">
                            <div>
                                <span className="text-slate-400">Status Validasi:</span>
                                <div className="mt-1">{getStatusBadge(selectedDetailVal.status)}</div>
                            </div>
                            <div>
                                <span className="text-slate-400">Aturan Kelulusan:</span>
                                <p className="font-bold text-slate-700 dark:text-slate-300 mt-1 capitalize">
                                    {selectedDetailVal.approval_rule === 'unanimous'
                                        ? 'Konsensus Mutlak'
                                        : selectedDetailVal.approval_rule === 'any'
                                        ? 'Salah Satu Setuju'
                                        : 'Keputusan Admin'}
                                </p>
                            </div>
                        </div>

                        {selectedDetailVal.instructions && (
                            <div className="p-3 bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900 rounded-xl text-xs">
                                <p className="font-bold text-blue-800 dark:text-blue-300 mb-1">
                                    Instruksi untuk Validator:
                                </p>
                                <p className="text-blue-700 dark:text-blue-400">{selectedDetailVal.instructions}</p>
                            </div>
                        )}

                        <div>
                            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
                                Status & Kesimpulan Tim Validator
                            </h4>
                            <div className="space-y-2">
                                {selectedDetailVal.validators?.map(v => (
                                    <div
                                        key={v.id}
                                        className="p-3 border border-slate-200 dark:border-slate-800 rounded-xl text-xs space-y-1.5"
                                    >
                                        <div className="flex items-center justify-between">
                                            <span className="font-bold text-slate-800 dark:text-slate-200">
                                                {v.profile?.full_name || 'Guru Validator'}
                                            </span>
                                            <span className="text-[11px] font-semibold text-slate-400">
                                                {v.status === 'submitted' ? 'Selesai Validasi' : 'Belum Selesai'}
                                            </span>
                                        </div>
                                        {v.general_recommendation && (
                                            <p className="text-[11px] text-slate-600 dark:text-slate-300">
                                                Rekomendasi:{' '}
                                                <strong className="uppercase">{v.general_recommendation.replace('_', ' ')}</strong>
                                            </p>
                                        )}
                                        {v.general_comment && (
                                            <p className="text-[11px] text-slate-500 italic bg-slate-50 dark:bg-slate-800/80 p-2 rounded-lg">
                                                "{v.general_comment}"
                                            </p>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    </ModalBody>
                    <ModalFooter align="between">
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => setReportValId(selectedDetailVal.id)}
                            className="flex items-center gap-1.5 text-xs font-bold"
                        >
                            <Printer size={14} /> Cetak Laporan Validasi
                        </Button>
                        <Link
                            href={`/dashboard/guru/validations/${selectedDetailVal.id}/review`}
                            className="w-full sm:w-auto px-4 py-2 bg-primary hover:bg-primary/90 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 shadow-sm shadow-primary/20 shrink-0"
                        >
                            <Play size={14} className="fill-white" /> Buka Lembar Validasi & Simulasi
                        </Link>
                    </ModalFooter>
                </Modal>
            )}
        </div>
    );
}
