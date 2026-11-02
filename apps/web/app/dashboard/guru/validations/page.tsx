"use client";

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
    Calendar,
    Clock,
    Play,
    CheckCircle2,
    AlertCircle,
    XCircle,
    Layers,
    RefreshCw,
} from 'lucide-react';
import { Button } from '@/app/components/ui/button';
import { Spinner } from '@/app/components/ui/Spinner';
import { ValidationTabs } from '@/app/components/validations/ValidationTabs';
import { ValidationFolders } from '@/app/components/validations/ValidationFolders';
import {
    FilterToolbar,
    FilterSearch,
    FilterSelect,
    FilterActions,
} from '@/app/components/ui/filtertoolbar';
import { listMyValidationTasks, type ValidationTask } from '@/lib/api/validations';
import { getSessionUser } from '@/lib/session';
import type { AuthUser } from '@acca-cbt/shared';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Sama dengan aturan server: tanggal lama 00:00 UTC berlaku sampai akhir hari. */
function isDeadlinePassed(deadline?: string | null): boolean {
    if (!deadline) return false;
    let time = new Date(deadline).getTime();
    if (!Number.isFinite(time)) return false;
    if (time % DAY_MS === 0) time += DAY_MS - 1;
    return time < Date.now();
}

/** Tugas telaah ulang: pembuat soal sudah memperbaiki dan validator belum mengirim hasil putaran ini. */
function isReReview(task: ValidationTask): boolean {
    return (task.validation.round ?? 1) > 1 && task.status !== 'submitted';
}

export default function GuruValidationTasksPage() {
    const [tasks, setTasks] = useState<ValidationTask[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState<string>('all');
    const [folderFilter, setFolderFilter] = useState('all');
    const [user, setUser] = useState<AuthUser | null>(null);
    const [sessionLoading, setSessionLoading] = useState(true);
    const [tasksCount, setTasksCount] = useState<number>();

    const loadTasks = useCallback(async () => {
        setLoading(true);
        setLoadError(null);
        try {
            const list = await listMyValidationTasks();
            setTasks(list);
            setTasksCount(list.length);
        } catch (e) {
            console.error('Failed to load my validation tasks', e);
            setLoadError(e instanceof Error ? e.message : 'Tugas validasi belum dapat dimuat.');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        let cancelled = false;
        void getSessionUser().then(sessionUser => {
            if (!cancelled) setUser(sessionUser);
        }).catch(error => {
            console.error('Failed to load validation role', error);
        }).finally(() => {
            if (!cancelled) setSessionLoading(false);
        });
        return () => { cancelled = true; };
    }, []);

    useEffect(() => {
        const timer = window.setTimeout(() => { void loadTasks(); }, 0);
        return () => window.clearTimeout(timer);
    }, [loadTasks]);

    const canManage = Boolean(user?.resolved?.admin || user?.resolved?.proktor || user?.resolved?.superadmin);
    const manageRoleLabel = user?.resolved?.admin || user?.resolved?.superadmin ? 'Admin' : 'Proktor';
    const taskFolders = Array.from(new Map(tasks.filter(task => task.validation.folder).map(task => [task.validation.folder!.id, task.validation.folder!])).values());
    const filtered = tasks.filter(task => {
        const val = task.validation;
        if (folderFilter === 'none' && val.folder_id) return false;
        if (folderFilter !== 'all' && folderFilter !== 'none' && val.folder_id !== folderFilter) return false;
        const title = val.title || '';
        const subject = val.bank?.subject || '';
        const creator = val.bank?.creator_name || (val.bank as { creator?: { full_name?: string } } | null)?.creator?.full_name || '';
        const q = searchQuery.toLowerCase();
        const matchesSearch = title.toLowerCase().includes(q) || subject.toLowerCase().includes(q) || creator.toLowerCase().includes(q);

        if (!matchesSearch) return false;
        if (statusFilter === 'all') return true;
        if (statusFilter === 'submitted') return task.status === 'submitted';
        if (statusFilter === 're_review') return isReReview(task);
        if (statusFilter === 'overdue') return task.status !== 'submitted' && isDeadlinePassed(val.deadline);
        if (statusFilter === 'in_progress') return task.status === 'in_progress' && !isReReview(task);
        if (statusFilter === 'assigned') return task.status === 'assigned' && !isReReview(task);
        return true;
    });

    const getRecommendationInfo = (rec?: string | null) => {
        switch (rec) {
            case 'approved':
                return {
                    label: 'Disetujui',
                    className: 'text-emerald-700 dark:text-emerald-300',
                    icon: <CheckCircle2 size={12} />
                };
            case 'revision_needed':
                return {
                    label: 'Perlu Revisi',
                    className: 'text-amber-700 dark:text-amber-300',
                    icon: <AlertCircle size={12} />
                };
            case 'rejected':
                return {
                    label: 'Ditolak',
                    className: 'text-rose-700 dark:text-rose-300',
                    icon: <XCircle size={12} />
                };
            default:
                return null;
        }
    };

    const getStatusBadge = (task: ValidationTask) => {
        const status = task.status;
        if (status !== 'submitted' && isDeadlinePassed(task.validation.deadline)) {
            return (
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-rose-600 dark:text-rose-400 whitespace-nowrap">
                    <XCircle size={12} /> Batas Waktu Terlewat
                </span>
            );
        }
        if (isReReview(task)) {
            return (
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-violet-600 dark:text-violet-400 whitespace-nowrap">
                    <RefreshCw size={12} /> Perlu Ditelaah Ulang
                </span>
            );
        }
        if (status === 'submitted') {
            return (
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400 whitespace-nowrap">
                    <CheckCircle2 size={12} /> Validasi Selesai
                </span>
            );
        }
        if (status === 'in_progress') {
            return (
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-600 dark:text-blue-400 whitespace-nowrap">
                    <Clock size={12} /> Sedang Dikerjakan
                </span>
            );
        }
        return (
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-600 dark:text-amber-400 whitespace-nowrap">
                <AlertCircle size={12} /> Belum Dikerjakan
            </span>
        );
    };

    return (
        <div className="flex flex-col gap-4 sm:gap-6">
            <ValidationTabs activeTab="tasks" manageRole={canManage ? manageRoleLabel : undefined}
                tasksCount={tasksCount} sessionLoading={sessionLoading} />

            <ValidationFolders folders={taskFolders} folderIds={tasks.map(task => task.validation.folder_id)} value={folderFilter} onChange={setFolderFilter} />

            {/* Filter Toolbar (Standardized ACCA Design) */}
            <FilterToolbar className="validation-toolbar">
                <FilterSearch
                    value={searchQuery}
                    onChange={setSearchQuery}
                    placeholder="Cari bank soal, mapel, atau penyusun..."
                    width={320}
                />
                <FilterSelect
                    label="Status"
                    value={statusFilter}
                    onChange={setStatusFilter}
                    options={[
                        { value: 'all', label: 'Semua Status' },
                        { value: 'assigned', label: 'Belum Dikerjakan' },
                        { value: 're_review', label: 'Perlu Ditelaah Ulang' },
                        { value: 'overdue', label: 'Batas Waktu Terlewat' },
                        { value: 'in_progress', label: 'Sedang Dikerjakan' },
                        { value: 'submitted', label: 'Validasi Selesai' },
                    ]}
                />
                <FilterActions className="flex items-center gap-2">
                    <Button
                        variant="outline"
                        onClick={loadTasks}
                        className="flex items-center gap-1.5 text-xs font-bold h-[38px] px-3"
                    >
                        <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Refresh
                    </Button>
                </FilterActions>
            </FilterToolbar>

            {loadError && !loading && (
                <div role="alert" className="p-3 rounded-xl border border-red-200 bg-red-50 text-xs text-red-700 dark:bg-red-950/30 dark:border-red-900 dark:text-red-300">
                    {loadError}
                </div>
            )}

            {/* Content Area */}
            {loading ? (
                <div className="py-20 flex flex-col items-center justify-center gap-3 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800">
                    <Spinner size={32} />
                    <p className="text-xs text-slate-400 font-medium">Memuat tugas validasi Anda...</p>
                </div>
            ) : filtered.length === 0 ? (
                <div className="py-16 bg-white dark:bg-slate-900 rounded-2xl border border-dashed border-slate-200 dark:border-slate-800 text-center p-6">
                    <div className="w-14 h-14 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center mx-auto mb-3">
                        <CheckCircle2 size={28} />
                    </div>
                    <h3 className="text-base font-bold text-slate-800 dark:text-slate-100">
                        Tidak Ada Tugas Validasi
                    </h3>
                    <p className="text-xs text-slate-500 max-w-sm mx-auto mt-1">
                        {tasks.length === 0
                            ? 'Saat ini Anda belum memiliki tugas penelaahan bank soal dari Admin atau Proktor.'
                            : 'Tidak ada tugas yang cocok dengan filter pencarian.'}
                    </p>
                </div>
            ) : (
                /* Desktop/Responsive Table View - Perfectly Consistent with Admin View */
                <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                    <th className="py-3 px-4">Bank Soal</th>
                                    <th className="py-3 px-4">Arahan Proktor</th>
                                    <th className="py-3 px-4">Status Tugas</th>
                                    <th className="py-3 px-4">Rekomendasi Anda</th>
                                    <th className="py-3 px-4">Batas Waktu</th>
                                    <th className="py-3 px-4 text-right">Aksi</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                                {filtered.map(task => {
                                    const val = task.validation;
                                    const isSubmitted = task.status === 'submitted';
                                    const overdue = !isSubmitted && isDeadlinePassed(val.deadline);
                                    const reReview = isReReview(task);
                                    const creatorName = val.bank?.creator_name || (val.bank as { creator?: { full_name?: string } } | null)?.creator?.full_name || 'Guru Mapel';
                                    const recInfo = getRecommendationInfo(task.general_recommendation);

                                    return (
                                        <tr key={task.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors">
                                            {/* Bank Soal */}
                                            <td className="py-3.5 px-4 max-w-xs">
                                                <p className="font-bold text-slate-800 dark:text-slate-100 line-clamp-1" title={val.title}>
                                                    {val.title}
                                                </p>
                                                <p className="text-[11px] text-slate-400 flex items-center gap-1 mt-0.5">
                                                    <Layers size={11} />
                                                    {val.bank?.subject || 'Mapel Umum'} • {val.bank?.class_level || 'Semua Kelas'} • {creatorName}
                                                </p>
                                            </td>

                                            {/* Arahan Proktor */}
                                            <td className="py-3.5 px-4 max-w-xs">
                                                {val.instructions ? (
                                                    <p className="text-[11px] text-slate-600 dark:text-slate-300 italic line-clamp-2" title={val.instructions}>
                                                        &quot;{val.instructions}&quot;
                                                    </p>
                                                ) : (
                                                    <span className="text-slate-400 text-[11px]">-</span>
                                                )}
                                            </td>

                                            {/* Status Tugas */}
                                            <td className="py-3.5 px-4 whitespace-nowrap">
                                                {getStatusBadge(task)}
                                            </td>

                                            {/* Rekomendasi Anda */}
                                            <td className="py-3.5 px-4 whitespace-nowrap">
                                                {recInfo ? (
                                                    <span className={`inline-flex items-center gap-1 text-[11px] font-bold ${recInfo.className}`}>
                                                        {recInfo.icon} {recInfo.label}
                                                    </span>
                                                ) : (
                                                    <span className="text-slate-400 text-[11px]">-</span>
                                                )}
                                            </td>

                                            {/* Batas Waktu */}
                                            <td className="py-3.5 px-4 whitespace-nowrap text-slate-600 dark:text-slate-400 font-medium text-[11px]">
                                                {val.deadline ? (
                                                    <span className={`flex items-center gap-1 ${overdue ? 'text-rose-600 dark:text-rose-400 font-semibold' : ''}`}>
                                                        <Calendar size={12} className={overdue ? '' : 'text-slate-400'} />
                                                        {new Date(val.deadline).toLocaleDateString('id-ID')}{overdue ? ' (terlewat)' : ''}
                                                    </span>
                                                ) : (
                                                    <span className="text-slate-400">Tanpa batas</span>
                                                )}
                                            </td>

                                            {/* Aksi */}
                                            <td className="py-3.5 px-4 text-right whitespace-nowrap">
                                                <Link
                                                    href={`/dashboard/guru/validations/${val.id}/review`}
                                                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                                                        isSubmitted || overdue
                                                            ? 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700'
                                                            : 'bg-primary text-white hover:bg-primary/90 shadow-sm shadow-primary/20'
                                                    }`}
                                                >
                                                    <Play size={12} className={isSubmitted || overdue ? '' : 'fill-white'} />
                                                    {isSubmitted ? 'Buka Hasil Validasi' : overdue ? 'Lihat Lembar Validasi' : reReview ? 'Mulai Telaah Ulang' : 'Mulai Validasi'}
                                                </Link>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
}
