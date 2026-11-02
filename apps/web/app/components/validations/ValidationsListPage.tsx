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
    AlertCircle,
    Clock,
    UserCheck,
    ChevronRight,
    RefreshCw,
    XCircle,
    Layers,
    Play,
    Printer,
    Trash2,
    UserPlus,
    UserMinus,
} from 'lucide-react';
import { confirmDialog } from '@/lib/confirm-dialog';
import { DatePicker } from '@/app/components/ui/DatePicker';
import { listTeachersAndInvigilators, type PASStaffMember } from '@/lib/api/pas';
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
    updateValidation,
    deleteValidation,
    listValidationFolders,
    type ValidationFolder,
    type ValidationSession,
    type ValidationStatus,
} from '@/lib/api/validations';
import { listQuestionBanks, type QuestionBank } from '@/lib/api/questions';
import { getSessionUser } from '@/lib/session';
import { AssignValidationModal } from './AssignValidationModal';
import { ValidationReportModal } from './ValidationReportModal';
import { ValidationTabs } from './ValidationTabs';
import { ValidationFolders } from './ValidationFolders';

const VALIDATOR_ROLES = ['Guru', 'Proktor', 'Admin'];
const RUNNING_STATUSES: ValidationStatus[] = ['pending', 'in_progress', 'resubmitted'];

/** 'yyyy-mm-dd' lokal untuk DatePicker dari tanggal ISO. */
function toDateInput(value?: string | null): string {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

interface ValidationsListPageProps {
    role: 'Admin' | 'Proktor';
}

export function ValidationsListPage({ role }: ValidationsListPageProps) {
    const [validations, setValidations] = useState<ValidationSession[]>([]);
    const [folders, setFolders] = useState<ValidationFolder[]>([]);
    const [folderFilter, setFolderFilter] = useState('all');
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
    const [myTasksCount, setMyTasksCount] = useState<number>();
    const [currentUserId, setCurrentUserId] = useState<string | null>(null);
    const [editDeadline, setEditDeadline] = useState('');
    const [staffList, setStaffList] = useState<PASStaffMember[]>([]);
    const [addValidatorId, setAddValidatorId] = useState('');
    const [managing, setManaging] = useState(false);
    const [manageError, setManageError] = useState<string | null>(null);

    const openDetail = (item: ValidationSession) => {
        setSelectedDetailVal(item);
        setDecision(['approved', 'revision_needed', 'rejected'].includes(item.status)
            ? item.status as 'approved' | 'revision_needed' | 'rejected' : 'approved');
        setDecisionError(null);
        setManageError(null);
        setEditDeadline(toDateInput(item.deadline));
        setAddValidatorId('');
        if (!staffList.length) void listTeachersAndInvigilators().then(setStaffList).catch(() => setStaffList([]));
    };

    /** Jalankan perubahan sesi lalu muat ulang daftar dan rincian yang sedang dibuka. */
    const runManage = async (work: () => Promise<{ success: boolean; error?: string }>, fallback: string, closeAfter = false) => {
        if (!selectedDetailVal) return;
        const id = selectedDetailVal.id;
        setManaging(true);
        setManageError(null);
        try {
            const result = await work();
            if (!result.success) throw new Error(result.error || fallback);
            const [fresh, freshFolders] = await Promise.all([listValidations(), listValidationFolders()]);
            setValidations(fresh);
            setFolders(freshFolders);
            const next = closeAfter ? null : fresh.find(v => v.id === id) || null;
            setSelectedDetailVal(next);
            if (next) setEditDeadline(toDateInput(next.deadline));
            setAddValidatorId('');
        } catch (error) {
            setManageError(error instanceof Error ? error.message : fallback);
        } finally {
            setManaging(false);
        }
    };

    const saveDeadline = (clear = false) => runManage(() => updateValidation(selectedDetailVal!.id, {
        // DatePicker memberi tanggal saja; batas waktu = akhir hari itu (waktu lokal).
        deadline: clear || !editDeadline ? null : new Date(`${editDeadline}T23:59:59.999`).toISOString(),
    }), 'Batas waktu gagal disimpan.');

    const addValidator = () => addValidatorId && runManage(
        () => updateValidation(selectedDetailVal!.id, { addValidatorIds: [addValidatorId] }), 'Validator gagal ditambahkan.');

    const removeValidator = async (validatorId: string, name: string) => {
        if (!await confirmDialog({ title: 'Keluarkan validator?', text: `${name} akan dikeluarkan dari sesi ini.`, confirmText: 'Keluarkan', cancelText: 'Batal', variant: 'danger' })) return;
        await runManage(() => updateValidation(selectedDetailVal!.id, { removeValidatorIds: [validatorId] }), 'Validator gagal dikeluarkan.');
    };

    const removeSession = async () => {
        if (!selectedDetailVal) return;
        if (!await confirmDialog({ title: 'Hapus sesi validasi?', text: 'Seluruh catatan, penilaian butir, dan rekomendasi pada sesi ini ikut terhapus. Tindakan ini tidak dapat dibatalkan.', confirmText: 'Hapus', cancelText: 'Batal', variant: 'danger' })) return;
        await runManage(() => deleteValidation(selectedDetailVal.id), 'Sesi validasi gagal dihapus.', true);
    };

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
            const [valList, bankList, sessionUser, myTasks, folderList] = await Promise.all([
                listValidations(),
                listQuestionBanks(),
                getSessionUser(),
                listMyValidationTasks().catch(() => []),
                listValidationFolders(),
            ]);
            setValidations(valList);
            setFolders(folderList);
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
        if (folderFilter === 'none' && v.folder_id) return false;
        if (folderFilter !== 'all' && folderFilter !== 'none' && v.folder_id !== folderFilter) return false;
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
                    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400">
                        <AlertCircle size={12} aria-hidden="true" /> Perlu Revisi
                    </span>
                );
            case 'resubmitted':
                return (
                    <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300 flex items-center gap-1.5">
                        <RefreshCw size={12} /> Menunggu Telaah Ulang
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
        <div className="flex flex-col gap-4 sm:gap-6">
            <ValidationTabs activeTab="manage" manageRole={role} tasksCount={myTasksCount} />

            <ValidationFolders folders={folders} folderIds={validations.map(item => item.folder_id)} value={folderFilter} onChange={setFolderFilter} onRefresh={loadData} />

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
                        { value: 'resubmitted', label: 'Menunggu Telaah Ulang' },
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
                        {validations.length === 0 ? 'Belum Ada Penugasan Validasi' : 'Tidak Ada Validasi di Tampilan Ini'}
                    </h3>
                    <p className="text-xs text-slate-500 max-w-sm mx-auto mt-1 mb-4">
                        {folderFilter !== 'all' ? 'Tambahkan validasi ke folder ini, atau pindahkan sesi yang sudah ada melalui Rincian.' : 'Tugaskan guru sebagai validator untuk memeriksa kualitas soal, kunci jawaban, dan stimulus sebelum ujian dimulai.'}
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
                                                {item.folder && <p className="mt-1 text-[10px] text-blue-600 dark:text-blue-300">{item.folder.name}</p>}
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
                                                {(item.round ?? 1) > 1 && <p className="mt-1 text-[10px] text-slate-400">Putaran {item.round}</p>}
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
                                                        onClick={() => openDetail(item)}
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
                folders={folders}
                initialFolderId={folderFilter !== 'all' && folderFilter !== 'none' ? folderFilter : undefined}
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
                        <label className="block text-xs font-semibold space-y-2">
                            <span>Folder Validasi</span>
                            <select aria-label="Pindahkan sesi ke folder" value={selectedDetailVal.folder_id || ''} disabled={managing}
                                onChange={event => { void runManage(() => updateValidation(selectedDetailVal.id, { folderId: event.target.value || null }), 'Sesi gagal dipindahkan.'); }}
                                className="validation-folder-input">
                                <option value="">Tanpa Folder</option>
                                {folders.map(folder => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
                            </select>
                        </label>
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

                        {/* Kelola sesi: batas waktu & anggota validator */}
                        <div className="space-y-3 rounded-xl border border-slate-200 dark:border-slate-800 p-3 text-xs">
                            <p className="font-bold text-slate-700 dark:text-slate-200">Kelola sesi</p>
                            <div className="flex flex-col sm:flex-row sm:items-end gap-2">
                                <div className="flex-1">
                                    <span className="block text-slate-500 mb-1">Batas waktu</span>
                                    <DatePicker value={editDeadline} onChange={setEditDeadline} placeholder="Tanpa batas waktu"
                                        min={new Date().toISOString().split('T')[0]} />
                                </div>
                                <div className="flex gap-2">
                                    <Button size="sm" onClick={() => saveDeadline()} disabled={managing || !editDeadline || editDeadline === toDateInput(selectedDetailVal.deadline)}>
                                        Simpan
                                    </Button>
                                    {selectedDetailVal.deadline && (
                                        <Button size="sm" variant="outline" onClick={() => saveDeadline(true)} disabled={managing}>
                                            Hapus batas
                                        </Button>
                                    )}
                                </div>
                            </div>
                            {RUNNING_STATUSES.includes(selectedDetailVal.status) ? (
                                <div className="flex flex-col sm:flex-row sm:items-end gap-2">
                                    <label className="flex-1">
                                        <span className="block text-slate-500 mb-1">Tambah validator</span>
                                        <select value={addValidatorId} onChange={event => setAddValidatorId(event.target.value)} disabled={managing}
                                            className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 p-2">
                                            <option value="">Pilih guru…</option>
                                            {staffList
                                                .filter(staff => (staff.roles || []).some(role => VALIDATOR_ROLES.includes(role)))
                                                .filter(staff => staff.id !== selectedDetailVal.bank?.created_by)
                                                .filter(staff => !selectedDetailVal.validators?.some(v => v.validator_id === staff.id))
                                                .map(staff => <option key={staff.id} value={staff.id}>{staff.name}</option>)}
                                        </select>
                                    </label>
                                    <Button size="sm" onClick={addValidator} disabled={managing || !addValidatorId} className="flex items-center gap-1">
                                        <UserPlus size={13} /> Tambah
                                    </Button>
                                </div>
                            ) : (
                                <p className="text-slate-500">Anggota validator hanya dapat diubah selama sesi masih berjalan.</p>
                            )}
                            {manageError && <p role="alert" className="text-red-600">{manageError}</p>}
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
                                            <span className="flex items-center gap-2 text-[11px] font-semibold text-slate-400">
                                                {v.status === 'submitted' ? 'Selesai Validasi' : (selectedDetailVal.round ?? 1) > 1 ? 'Menelaah Ulang' : 'Belum Selesai'}
                                                {v.status === 'assigned' && RUNNING_STATUSES.includes(selectedDetailVal.status) && (selectedDetailVal.validators?.length || 0) > 1 && (
                                                    <button type="button" disabled={managing}
                                                        onClick={() => removeValidator(v.validator_id, v.profile?.full_name || 'Validator')}
                                                        className="text-rose-500 hover:text-rose-700 disabled:opacity-40" title="Keluarkan validator">
                                                        <UserMinus size={13} />
                                                    </button>
                                                )}
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
                        <div className="flex flex-wrap gap-2">
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() => setReportValId(selectedDetailVal.id)}
                                className="flex items-center gap-1.5 text-xs font-bold"
                            >
                                <Printer size={14} /> Cetak Laporan Validasi
                            </Button>
                            <Button
                                type="button"
                                variant="danger"
                                onClick={removeSession}
                                disabled={managing}
                                className="flex items-center gap-1.5 text-xs font-bold"
                            >
                                <Trash2 size={14} /> Hapus Sesi
                            </Button>
                        </div>
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
