"use client";

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
    ShieldCheck,
    Calendar,
    Clock,
    Play,
    CheckCircle2,
    AlertCircle,
    User,
    BookOpen,
    Layers,
    RefreshCw,
} from 'lucide-react';
import { Button } from '@/app/components/ui/button';
import { Spinner } from '@/app/components/ui/Spinner';
import { listMyValidationTasks, type ValidationTask } from '@/lib/api/validations';

export default function GuruValidationTasksPage() {
    const [tasks, setTasks] = useState<ValidationTask[]>([]);
    const [loading, setLoading] = useState(true);

    const loadTasks = useCallback(async () => {
        setLoading(true);
        try {
            const list = await listMyValidationTasks();
            setTasks(list);
        } catch (e) {
            console.error('Failed to load my validation tasks', e);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadTasks();
    }, [loadTasks]);

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div>
                    <h1 className="text-xl md:text-2xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2.5">
                        <ShieldCheck className="text-primary" size={26} />
                        Tugas Validasi Bank Soal
                    </h1>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                        Daftar bank soal yang ditugaskan kepada Anda untuk divalidasi.
                    </p>
                </div>
                <Button
                    variant="outline"
                    onClick={loadTasks}
                    className="flex items-center gap-2 text-xs font-bold"
                >
                    <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
                </Button>
            </div>

            {loading ? (
                <div className="py-20 flex flex-col items-center justify-center gap-3">
                    <Spinner size={32} />
                    <p className="text-xs text-slate-400 font-medium">Memuat tugas validasi Anda...</p>
                </div>
            ) : tasks.length === 0 ? (
                <div className="py-16 bg-white dark:bg-slate-900 rounded-2xl border border-dashed border-slate-200 dark:border-slate-800 text-center p-6">
                    <div className="w-14 h-14 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center mx-auto mb-3">
                        <CheckCircle2 size={28} />
                    </div>
                    <h3 className="text-base font-bold text-slate-800 dark:text-slate-100">
                        Tidak Ada Tugas Validasi Aktif
                    </h3>
                    <p className="text-xs text-slate-500 max-w-sm mx-auto mt-1">
                        Saat ini Anda belum memiliki tugas penelaahan bank soal dari Admin atau Proktor.
                    </p>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                    {tasks.map(task => {
                        const val = task.validation;
                        const isSubmitted = task.status === 'submitted';

                        return (
                            <div
                                key={task.id}
                                className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm hover:shadow-md transition-all p-5 flex flex-col justify-between"
                            >
                                <div>
                                    <div className="flex items-center justify-between gap-2 mb-3">
                                        <span
                                            className={`px-2.5 py-1 rounded-full text-xs font-semibold flex items-center gap-1.5 ${
                                                isSubmitted
                                                    ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400'
                                                    : task.status === 'in_progress'
                                                    ? 'bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400'
                                                    : 'bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400'
                                            }`}
                                        >
                                            {isSubmitted ? (
                                                <>
                                                    <CheckCircle2 size={12} /> Validasi Selesai
                                                </>
                                            ) : task.status === 'in_progress' ? (
                                                <>
                                                    <Clock size={12} /> Sedang Dikerjakan
                                                </>
                                            ) : (
                                                <>
                                                    <AlertCircle size={12} /> Belum Dikerjakan
                                                </>
                                            )}
                                        </span>

                                        <span className="text-[11px] text-slate-400 flex items-center gap-1">
                                            <Calendar size={12} />
                                            {val.deadline
                                                ? new Date(val.deadline).toLocaleDateString('id-ID')
                                                : 'Tanpa batas'}
                                        </span>
                                    </div>

                                    <h3 className="font-bold text-sm text-slate-800 dark:text-slate-100 line-clamp-2 mb-1.5">
                                        {val.title}
                                    </h3>

                                    <div className="text-xs text-slate-500 dark:text-slate-400 space-y-1 mb-4">
                                        <p className="flex items-center gap-1.5">
                                            <Layers size={13} className="text-slate-400" />
                                            {val.bank?.subject || 'Mapel Umum'} • {val.bank?.class_level || 'Semua Kelas'}
                                        </p>
                                        <p className="flex items-center gap-1.5">
                                            <User size={13} className="text-slate-400" />
                                            Penyusun: {val.bank?.creator_name || (val.bank as any)?.creator?.full_name || 'Guru Mapel'}
                                        </p>
                                    </div>

                                    {val.instructions && (
                                        <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl text-xs text-slate-600 dark:text-slate-300 mb-4 border border-slate-100 dark:border-slate-800">
                                            <span className="font-bold text-slate-700 dark:text-slate-200 block mb-0.5">
                                                Arahan Proktor:
                                            </span>
                                            <p className="line-clamp-2 italic">"{val.instructions}"</p>
                                        </div>
                                    )}

                                    {isSubmitted && task.general_recommendation && (
                                        <div className="p-2.5 bg-emerald-50/50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900/40 rounded-xl text-xs text-emerald-700 dark:text-emerald-300 mb-4">
                                            <span className="font-bold">Rekomendasi Anda: </span>
                                            <span className="capitalize">{task.general_recommendation.replace('_', ' ')}</span>
                                        </div>
                                    )}
                                </div>

                                <div className="pt-3 border-t border-slate-100 dark:border-slate-800">
                                    <Link
                                        href={`/dashboard/guru/validations/${val.id}/review`}
                                        className="w-full"
                                    >
                                        <Button
                                            className={`w-full text-xs font-bold flex items-center justify-center gap-2 ${
                                                isSubmitted
                                                    ? 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200'
                                                    : 'bg-primary text-white hover:bg-primary/90 shadow-md shadow-primary/20'
                                            }`}
                                        >
                                            <Play size={14} className={isSubmitted ? '' : 'fill-white'} />
                                            {isSubmitted ? 'Buka Kembali Hasil Validasi' : 'Mulai Simulasi & Validasi Soal'}
                                        </Button>
                                    </Link>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
