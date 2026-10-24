"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { registerPageFab, unregisterPageFab } from '@/app/components/mobile/page-fab';
import './validations-mobile.css';
import Link from 'next/link';
import {
    ShieldCheck,
    Plus,
    Calendar,
    CheckCircle2,
    Clock,
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
    decideValidation,
    listMyValidationTasks,
    type ValidationSession,
    type ValidationStatus,
} from '@/lib/api/validations';
import { listQuestionBanks, type QuestionBank } from '@/lib/api/questions';
import { getSessionUser } from '@/lib/session';
import { AssignValidationModal } from './AssignValidationModal';
import { ValidationReportModal } from './ValidationReportModal';

interface ValidationsListPageProps {
    role: 'Admin' | 'Proktor';
}

export function ValidationsListPage({ role }: ValidationsListPageProps) {
    const [validations, setValidations] = useState<ValidationSession[]>([]);
    const [banks, setBanks] = useState<QuestionBank[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState<string>('all');
    const [isAssignModalOpen, setIsAssignModalOpen] = useState(false);
    const [selectedDetailVal, setSelectedDetailVal] = useState<ValidationSession | null>(null);
    const [reportValId, setReportValId] = useState<string | null>(null);
    const [decision, setDecision] = useState<'approved' | 'revision_needed' | 'rejected'>('approved');
    const [savingDecision, setSavingDecision] = useState(false);
    const [decisionError, setDecisionError] = useState<string | null>(null);
    const [myTasksCount, setMyTasksCount] = useState<number>(0);
    const [currentUserId, setCurrentUserId] = useState<string | null>(null);

    useEffect(() => {
        const token = {};
        registerPageFab(token, {
            label: 'Tambah Validasi',
            icon: 'plus',
            run: () => setIsAssignModalOpen(true),
        });
        return () => unregisterPageFab(token);
    }, []);

    const saveDecision = async () => {
        if (!selectedDetailVal) return;
        setSavingDecision(true);
        setDecisionError(null);
        try {
            const result = await decideValidation(selectedDetailVal.id, decision);
            if (!result.success) throw new Error(result.error || 'Gagal menyimpan keputusan.');
            setSelectedDetailVal(current => current?.id === selectedDetailVal.id ? { ...current, status: decision } : current);
            await loadData();
        } catch (error) {
            setDecisionError(error instanceof Error ? error.message : 'Gagal menyimpan keputusan.');
        } finally {
            setSavingDecision(false);
        }
    };

    const loadData = useCallback(async () => {
        setLoading(true);
        setLoadError(null);
        try {
            const [valList, bankList, sessionUser, myTasks] = await Promise.all([
                listValidations(),
                listQuestionBanks(),
                getSessionUser(),
                listMyValidationTasks().catch(() => []),
            ]);
            setValidations(valList);
            setBanks(bankList);
            if (sessionUser) {
                setCurrentUserId(sessionUser.id);
            }
            setMyTasksCount(myTasks.length);
        } catch (e) {
            console.error('Failed to load validations', e);
            setLoadError(e instanceof Error ? e.message : 'Daftar validasi belum dapat dimuat.');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadData();
    }, [loadData]);

    const myAssignedCount = validations.filter(v => v.validators?.some(val => val.validator_id === currentUserId)).length;

    const filtered = validations.filter(v => {
        const matchesSearch =
            v.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
            v.bank?.title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
            v.bank?.subject?.toLowerCase().includes(searchQuery.toLowerCase()) ||
            v.validators?.some(val => val.profile?.full_name?.toLowerCase().includes(searchQuery.toLowerCase()));

        if (!matchesSearch) return false;
        if (statusFilter === 'all') return true;
        if (statusFilter === 'my_tasks') {
            return v.validators?.some(val => val.validator_id === currentUserId);
        }
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
                    <span className="text-xs font-medium text-amber-700 dark:text-amber-400">
                        Perlu Revisi
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
            {/* Navigasi Tab Peran Terpadu */}
            <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-800 pb-px mb-1">
                <Link
                    href={role === 'Admin' ? '/dashboard/admin/questions/validations' : '/dashboard/proktor/questions/validations'}
                    className="px-4 py-2 text-xs font-bold border-b-2 border-primary text-primary flex items-center gap-2 transition-all"
                >
                    <ShieldCheck size={14} /> Kelola Sesi Validasi ({role})
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-primary/10 text-primary">
                        {validations.length}
                    </span>
                </Link>
                <Link
                    href="/dashboard/guru/validations"
                    className="px-4 py-2 text-xs font-bold border-b-2 border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 flex items-center gap-2 transition-all"
                >
                    <UserCheck size={14} /> Tugas Validasi Saya
                    {myTasksCount > 0 && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300">
                            {myTasksCount}
                        </span>
                    )}
                </Link>
            </div>

            {/* Filter Toolbar (Standardized) */}
            <FilterToolbar className="validation-toolbar">
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
                        ...(myAssignedCount > 0 ? [{ value: 'my_tasks', label: `Tugas Saya (${myAssignedCount})` }] : []),
                        { value: 'pending', label: 'Menunggu' },
                        { value: 'in_progress', label: 'Sedang Divalidasi' },
                        { value: 'revision_needed', label: 'Perlu Revisi' },
                        { value: 'approved', label: 'Disetujui' },
                        { value: 'rejected', label: 'Ditolak' },
                    ]}
                />
                <FilterActions className="validation-create-actions">
                    <Button
                        onClick={() => setIsAssignModalOpen(true)}
                        className="bg-primary hover:bg-primary/90 text-white font-bold flex items-center gap-1.5 text-xs shadow-md shadow-primary/20"
                    >
                        <Plus size={15} /> Tambah Validasi
                    </Button>
                </FilterActions>
            </FilterToolbar>

            {loadError && !loading && (
                <div role="alert" className="p-3 rounded-xl border border-red-200 bg-red-50 text-xs text-red-700 dark:bg-red-950/30 dark:border-red-900 dark:text-red-300">
                    {loadError}
                </div>
            )}

            {/* List Data / Desktop Table */}
            {loading ? (
                <div className="py-20 flex flex-col items-center justify-center gap-3 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800">
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
                        className="validation-create-action bg-primary text-white font-bold text-xs"
                    >
                        <Plus size={14} className="mr-1.5" /> Tambah Validasi
                    </Button>
                </div>
            ) : (
                <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                    <th className="py-3 px-4">Bank Soal</th>
                                    <th className="py-3 px-4">Tim Guru Validator</th>
                                    <th className="py-3 px-4">Status Validasi</th>
                                    <th className="py-3 px-4">Batas Waktu</th>
                                    <th className="py-3 px-4 text-right">Aksi</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                                {filtered.map(item => {
                                    const submittedCount = item.validators?.filter(v => v.status === 'submitted').length || 0;
                                    const totalValidators = item.validators?.length || 0;
                                    const creatorName = item.bank?.creator_name || (item.bank as { creator?: { full_name?: string } } | null)?.creator?.full_name || 'Guru Mapel';

                                    return (
                                        <tr key={item.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors">
                                            {/* Bank Soal */}
                                            <td className="py-3.5 px-4 max-w-xs">
                                                <p className="font-bold text-slate-800 dark:text-slate-100 line-clamp-1" title={item.title}>
                                                    {item.title}
                                                </p>
                                                <p className="text-[11px] text-slate-400 flex items-center gap-1 mt-0.5">
                                                    <Layers size={11} />
                                                    {item.bank?.subject || 'Mapel Umum'} • {creatorName}
                                                </p>
                                            </td>

                                            {/* Tim Validator */}
                                            <td className="py-3.5 px-4">
                                                <div className="space-y-1">
                                                    <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                                                        <UserCheck size={12} className="text-primary" />
                                                        <span>{submittedCount} / {totalValidators} Selesai</span>
                                                    </div>
                                                    <div className="flex flex-col gap-1 max-w-xs">
                                                        {item.validators?.map(v => (
                                                            <span
                                                                key={v.id}
                                                                className="text-[11px] text-[#3083FF] dark:!text-blue-400"
                                                            >
                                                                {v.profile?.full_name || 'Validator'}
                                                            </span>
                                                        ))}
                                                    </div>
                                                </div>
                                            </td>

                                            {/* Status Validasi */}
                                            <td className="py-3.5 px-4 whitespace-nowrap">
                                                {getStatusBadge(item.status)}
                                            </td>

                                            {/* Batas Waktu */}
                                            <td className="py-3.5 px-4 whitespace-nowrap text-slate-600 dark:text-slate-400 font-medium text-[11px]">
                                                {item.deadline ? (
                                                    <span className="flex items-center gap-1">
                                                        <Calendar size={12} className="text-slate-400" />
                                                        {new Date(item.deadline).toLocaleDateString('id-ID')}
                                                    </span>
                                                ) : (
                                                    <span className="text-slate-400">Tanpa batas</span>
                                                )}
                                            </td>

                                            {/* Aksi */}
                                            <td className="py-3.5 px-4 text-right whitespace-nowrap">
                                                <div className="flex items-center justify-end gap-1.5">
                                                    <button
                                                        type="button"
                                                        onClick={() => setReportValId(item.id)}
                                                        className="text-slate-600 hover:text-primary dark:text-slate-300 dark:hover:text-primary font-semibold flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors border border-slate-200 dark:border-slate-700"
                                                        title="Cetak Laporan Validasi"
                                                    >
                                                        <Printer size={13} /> Laporan
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            setSelectedDetailVal(item);
                                                            setDecision(['approved', 'revision_needed', 'rejected'].includes(item.status)
                                                                ? item.status as 'approved' | 'revision_needed' | 'rejected' : 'approved');
                                                            setDecisionError(null);
                                                        }}
                                                        className="text-slate-600 hover:text-slate-800 dark:text-slate-300 dark:hover:text-slate-100 font-semibold flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors border border-slate-200 dark:border-slate-700"
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
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
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
                        {selectedDetailVal.approval_rule === 'admin_decides' && (
                            <div className="space-y-3 rounded-xl border border-slate-200 dark:border-slate-800 p-3 text-xs">
                                <label htmlFor="validation-decision" className="font-bold">Keputusan akhir Admin/Proktor</label>
                                <p className="text-slate-500">Keputusan ini menjadi catatan dan pemberitahuan; Guru tetap dapat memublikasikan bank soal.</p>
                                <select id="validation-decision" value={decision}
                                    onChange={event => setDecision(event.target.value as typeof decision)}
                                    disabled={savingDecision}
                                    className="w-full rounded-lg border border-slate-300 bg-white p-2 dark:bg-slate-900">
                                    <option value="approved">Disetujui</option>
                                    <option value="revision_needed">Perlu Revisi</option>
                                    <option value="rejected">Ditolak</option>
                                </select>
                                {(!selectedDetailVal.validators?.length || selectedDetailVal.validators.some(v => v.status !== 'submitted')) && (
                                    <p className="text-amber-600">Menunggu seluruh validator menyelesaikan rekomendasinya.</p>
                                )}
                                {decisionError && <p role="alert" className="text-red-600">{decisionError}</p>}
                                <Button onClick={saveDecision} disabled={savingDecision || !selectedDetailVal.validators?.length || selectedDetailVal.validators.some(v => v.status !== 'submitted')}>
                                    {savingDecision ? 'Menyimpan...' : 'Simpan Keputusan'}
                                </Button>
                            </div>
                        )}
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
                                                <strong className="uppercase">{{ approved: 'Disetujui', revision_needed: 'Perlu revisi', rejected: 'Ditolak' }[v.general_recommendation]}</strong>
                                            </p>
                                        )}
                                        {v.general_comment && (
                                            <p className="text-[11px] text-slate-500 italic bg-slate-50 dark:bg-slate-800/80 p-2 rounded-lg">
                                                &quot;{v.general_comment}&quot;
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
