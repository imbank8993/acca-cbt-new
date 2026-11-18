"use client";

import { useToast } from '@/app/components/ui/Toast';
import { joinClassAction, leaveClassAction, listStudentClasses, type StudentClass } from '@/lib/api/students';
import { getErrorMessage } from '@/lib/errors';
import { getSessionUser } from '@/lib/session';
import { useMemoryState } from '@/lib/useMemoryState';
import { AnimatePresence, motion } from 'framer-motion';
import {
    AlertCircle,
    Check,
    ChevronRight,
    GraduationCap,
    KeyRound,
    Loader2,
    LogOut,
    Plus,
    School,
    X,
} from 'lucide-react';
import Link from 'next/link';
import React, { useCallback, useEffect, useMemo, useState } from 'react';

type FilterTab = 'all' | 'reguler' | 'tambahan';

const CLASS_CARD_GRADIENTS = [
    'from-blue-500 via-indigo-600 to-violet-600 shadow-indigo-500/20',
    'from-emerald-500 via-teal-600 to-cyan-700 shadow-teal-500/20',
    'from-amber-600 via-orange-600 to-rose-600 shadow-orange-500/20',
    'from-sky-500 via-blue-600 to-indigo-600 shadow-blue-500/20',
] as const;

export default function SiswaClassesPage() {
    const [classes, setClasses] = useMemoryState<StudentClass[]>('siswa_classes_classes', []);
    const [isLoading, setIsLoading] = useMemoryState('siswa_classes_isLoading', true);
    const [selectedTab, setSelectedTab] = useState<FilterTab>('all');

    // State Gabung Kelas Modal
    const [isJoinModalOpen, setIsJoinModalOpen] = useState(false);
    const [joinCode, setJoinCode] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    // State Keluar Kelas
    const [userId, setUserId] = useState<string | null>(null);
    const [leavingClassId, setLeavingClassId] = useState<string | null>(null);
    const [classToLeave, setClassToLeave] = useState<{ id: string; name: string } | null>(null);

    const toast = useToast();

    const loadData = useCallback(async () => {
        const user = await getSessionUser();
        if (user) {
            setUserId(user.id);
            setClasses(await listStudentClasses());
        }
        setIsLoading(false);
    }, [setClasses, setIsLoading]);

    useEffect(() => {
        const initialLoad = window.setTimeout(() => void loadData(), 0);
        const handleFocus = () => void loadData();
        window.addEventListener('focus', handleFocus);
        return () => {
            window.clearTimeout(initialLoad);
            window.removeEventListener('focus', handleFocus);
        };
    }, [loadData]);

    const handleJoinClass = async (e: React.FormEvent) => {
        e.preventDefault();
        const code = joinCode.trim();
        if (!userId || !code) return;

        setIsSubmitting(true);
        try {
            const result = await joinClassAction(code);
            if (result.success) {
                toast.success('Berhasil Bergabung', `Anda telah masuk ke kelas: ${result.className}`);
                setJoinCode('');
                setIsJoinModalOpen(false);
                void loadData();
            } else {
                toast.error('Gagal Bergabung', result.error || 'Kode kelas tidak valid.');
            }
        } catch (err) {
            toast.error('Terjadi Kesalahan', getErrorMessage(err) || 'Gagal menghubungi server.');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleConfirmLeave = async () => {
        if (!classToLeave) return;
        setLeavingClassId(classToLeave.id);
        try {
            const result = await leaveClassAction(classToLeave.id);
            if (result.success) {
                toast.success('Berhasil Keluar', `Anda telah keluar dari kelas: ${result.className}`);
                void loadData();
            } else {
                toast.error('Gagal Keluar', result.error || 'Tidak dapat keluar dari kelas.');
            }
        } catch (err) {
            toast.error('Terjadi Kesalahan', getErrorMessage(err) || 'Gagal menghubungi server.');
        } finally {
            setLeavingClassId(null);
            setClassToLeave(null);
        }
    };

    // Filter & hitung kelas
    const counts = useMemo(() => {
        const reguler = classes.filter(c => c.type === 'reguler').length;
        const tambahan = classes.filter(c => c.type !== 'reguler').length;
        return { total: classes.length, reguler, tambahan };
    }, [classes]);

    const filteredClasses = useMemo(() => {
        if (selectedTab === 'reguler') return classes.filter(c => c.type === 'reguler');
        if (selectedTab === 'tambahan') return classes.filter(c => c.type !== 'reguler');
        return classes;
    }, [classes, selectedTab]);

    return (
        <div className="max-w-7xl mx-auto pb-24 space-y-5 px-3 sm:px-6">

            <h1 className="sr-only">Kelas Saya</h1>
            <div className="flex items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-700">
                <div role="group" aria-label="Filter kelas" className="flex min-w-0 items-center gap-4 overflow-x-auto no-scrollbar sm:gap-6">
                    {([
                        { value: 'all', label: 'Semua', count: counts.total },
                        { value: 'reguler', label: 'Kelas Utama', count: counts.reguler },
                        ...(counts.tambahan > 0 ? [{ value: 'tambahan', label: 'Tambahan', count: counts.tambahan }] : []),
                    ] as { value: FilterTab; label: string; count: number }[]).map(tab => (
                        <button
                            key={tab.value}
                            type="button"
                            aria-pressed={selectedTab === tab.value}
                            onClick={() => setSelectedTab(tab.value)}
                            className={`shrink-0 border-b-2 py-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#3083FF] ${selectedTab === tab.value
                                ? 'border-[#3083FF] text-[#3083FF]'
                                : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'}`}
                        >
                            {tab.label} ({tab.count})
                        </button>
                    ))}
                </div>
                <button
                    type="button"
                    onClick={() => setIsJoinModalOpen(true)}
                    className="mb-1 inline-flex shrink-0 items-center justify-center gap-1.5 rounded-xl bg-[#3083FF] px-3 py-2 text-xs font-semibold text-white shadow-xs shadow-[#3083FF]/20 transition-all hover:bg-[#2563EB] active:scale-95 sm:px-3.5"
                >
                    <Plus size={15} />
                    <span>Gabung Kelas</span>
                </button>
            </div>

            {/* ── 3. Daftar Kartu Kelas ── */}
            {isLoading ? (
                <div className="flex flex-col items-center justify-center py-20 space-y-3">
                    <Loader2 size={24} className="animate-spin text-[#3083FF]" />
                    <p className="text-slate-400 font-semibold text-xs tracking-wide uppercase">Memuat kelas Anda...</p>
                </div>
            ) : filteredClasses.length === 0 ? (
                /* ── Empty State ── */
                <div className="py-16 px-6 text-center bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-2xl shadow-xs max-w-md mx-auto w-full flex flex-col items-center">
                    <div className="w-12 h-12 bg-blue-50 dark:bg-slate-800 rounded-2xl flex items-center justify-center mb-3.5 text-[#3083FF]">
                        <GraduationCap size={24} />
                    </div>
                    <h3 className="text-base font-bold text-slate-800 dark:text-slate-100 mb-1">
                        {classes.length === 0 ? 'Belum Terdaftar di Kelas' : 'Tidak Ada Kelas di Kategori Ini'}
                    </h3>
                    <p className="text-slate-500 dark:text-slate-400 text-xs font-normal max-w-xs leading-relaxed mb-4">
                        {classes.length === 0
                            ? 'Anda belum terdaftar di kelas manapun. Masukkan kode akses kelas tambahan yang diberikan guru atau hubungi proktor Anda.'
                            : 'Coba pilih tab filter lainnya untuk melihat daftar kelas Anda.'}
                    </p>
                    {classes.length === 0 && (
                        <button
                            type="button"
                            onClick={() => setIsJoinModalOpen(true)}
                            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#3083FF] hover:bg-[#2563EB] text-white text-xs font-semibold shadow-xs transition-all active:scale-95"
                        >
                            <KeyRound size={14} />
                            <span>Masukkan Kode Kelas</span>
                        </button>
                    )}
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5 sm:gap-4">
                    {filteredClasses.map((cls, index) => {
                        const isReguler = cls.type === 'reguler';
                        const gradient = CLASS_CARD_GRADIENTS[classes.indexOf(cls) % CLASS_CARD_GRADIENTS.length];

                        return (
                            <motion.div
                                key={cls.id || index}
                                layout
                                initial={{ opacity: 0, y: 6 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.18, delay: index * 0.02 }}
                                className={`relative flex min-h-[190px] min-w-0 flex-col overflow-hidden rounded-2xl bg-gradient-to-br p-5 text-white shadow-md transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg ${gradient}`}
                            >
                                <div aria-hidden="true" className="pointer-events-none absolute -right-7 -top-7 h-28 w-28 rounded-full bg-white/10" />

                                <div className="relative flex items-start justify-between gap-3">
                                    <div className="flex min-w-0 items-center gap-2.5">
                                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/15">
                                            <School size={17} aria-hidden="true" />
                                        </div>
                                        <div className="min-w-0">
                                            <p className="text-xs font-semibold leading-tight text-white/95">
                                                {isReguler ? 'Kelas Utama' : 'Kelas Tambahan'}
                                            </p>
                                            {cls.program && (
                                                <p className="mt-0.5 break-words text-[11px] leading-tight text-white/75">{cls.program}</p>
                                            )}
                                        </div>
                                    </div>
                                    {!isReguler && (
                                        <button
                                            type="button"
                                            onClick={() => setClassToLeave({ id: cls.id, name: cls.name })}
                                            title="Keluar dari kelas ini"
                                            aria-label={`Keluar dari kelas ${cls.name}`}
                                            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/15 text-white transition-colors hover:bg-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white active:scale-95"
                                        >
                                            <LogOut size={15} />
                                        </button>
                                    )}
                                </div>

                                <div className="relative mt-5 min-w-0 flex-1">
                                    <h2 className="break-words text-xl font-bold leading-snug tracking-tight text-white">
                                        {cls.name}
                                    </h2>
                                    <p className="mt-1 text-xs font-medium leading-relaxed text-white/85">
                                        {isReguler ? 'Program Reguler Akademik' : 'Bimbingan & Pengayaan Tambahan'}
                                    </p>
                                </div>

                                <div className="relative mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-white/20 pt-3">
                                    <span className="text-[11px] font-medium text-white/80">
                                        Tersedia di Jadwal Ujian
                                    </span>
                                    <Link
                                        href="/dashboard/siswa/schedule"
                                        className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-white/15 px-2.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                                    >
                                        <span>Jadwal</span>
                                        <ChevronRight size={14} aria-hidden="true" />
                                    </Link>
                                </div>
                            </motion.div>
                        );
                    })}
                </div>
            )}

            {/* ── 4. Modal Gabung Kelas (Clean & Focused) ── */}
            <AnimatePresence>
                {isJoinModalOpen && (
                    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/40 dark:bg-slate-950/70 backdrop-blur-xs">
                        <motion.div
                            initial={{ opacity: 0, y: 40 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: 40 }}
                            transition={{ duration: 0.2 }}
                            className="bg-white dark:bg-slate-900 border-t sm:border border-slate-200 dark:border-slate-800 rounded-t-3xl sm:rounded-2xl p-6 max-w-sm w-full shadow-2xl space-y-4 text-left"
                        >
                            {/* Mobile Drag Indicator */}
                            <div className="w-10 h-1 bg-slate-200 dark:bg-slate-700 rounded-full mx-auto sm:hidden" />

                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-[#3083FF]/10 text-[#3083FF] flex items-center justify-center shrink-0 border border-blue-100/60 dark:border-[#3083FF]/20">
                                        <KeyRound size={18} />
                                    </div>
                                    <div>
                                        <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">
                                            Gabung Kelas Tambahan
                                        </h3>
                                        <p className="text-xs text-slate-500 dark:text-slate-400">
                                            Masukkan kode akses dari Guru
                                        </p>
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setIsJoinModalOpen(false);
                                        setJoinCode('');
                                    }}
                                    className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
                                >
                                    <X size={18} />
                                </button>
                            </div>

                            <form onSubmit={handleJoinClass} className="space-y-3.5 pt-1">
                                <input
                                    required
                                    autoFocus
                                    type="text"
                                    placeholder="CONTOH: X9A"
                                    value={joinCode}
                                    onChange={e => setJoinCode(e.target.value)}
                                    className="w-full bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 focus:bg-white dark:focus:bg-slate-800 rounded-xl py-2.5 px-3.5 focus:ring-2 focus:ring-[#3083FF]/20 focus:border-[#3083FF] outline-none font-bold text-slate-800 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 font-mono tracking-wider uppercase transition-all text-xs"
                                />

                                <div className="flex gap-2">
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setIsJoinModalOpen(false);
                                            setJoinCode('');
                                        }}
                                        className="flex-1 py-2 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                                    >
                                        Batal
                                    </button>
                                    <button
                                        type="submit"
                                        disabled={isSubmitting || !joinCode.trim()}
                                        className="flex-1 bg-[#3083FF] hover:bg-[#2563EB] text-white font-semibold py-2 px-4 rounded-xl shadow-xs shadow-[#3083FF]/20 transition-all flex items-center justify-center gap-1.5 active:scale-95 disabled:opacity-50 text-xs"
                                    >
                                        {isSubmitting ? (
                                            <Loader2 size={14} className="animate-spin" />
                                        ) : (
                                            <Check size={14} />
                                        )}
                                        <span>Bergabung</span>
                                    </button>
                                </div>
                            </form>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>

            {/* ── 5. Modal Konfirmasi Keluar Kelas ── */}
            <AnimatePresence>
                {classToLeave && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 dark:bg-slate-950/70 backdrop-blur-xs">
                        <motion.div
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.95 }}
                            transition={{ duration: 0.15 }}
                            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 max-w-sm w-full shadow-xl space-y-4 text-left"
                        >
                            <div className="w-10 h-10 rounded-xl bg-rose-50 dark:bg-rose-950/40 text-rose-500 flex items-center justify-center border border-rose-100 dark:border-rose-800/40">
                                <AlertCircle size={20} />
                            </div>

                            <div>
                                <h3 className="font-bold text-slate-800 dark:text-slate-100 text-base">
                                    Keluar dari Kelas?
                                </h3>
                                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                                    Anda akan keluar dari kelas tambahan <strong className="text-slate-700 dark:text-slate-200 font-semibold">&quot;{classToLeave.name}&quot;</strong>. Ujian yang ditugaskan ke kelas ini tidak akan muncul lagi di daftar ujian Anda.
                                </p>
                            </div>

                            <div className="flex gap-2 justify-end pt-2">
                                <button
                                    type="button"
                                    onClick={() => setClassToLeave(null)}
                                    className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors"
                                >
                                    Batal
                                </button>
                                <button
                                    type="button"
                                    disabled={leavingClassId === classToLeave.id}
                                    onClick={handleConfirmLeave}
                                    className="px-4 py-2 text-xs font-semibold text-white bg-rose-500 hover:bg-rose-600 rounded-xl transition-colors disabled:opacity-50 flex items-center gap-1.5 shadow-xs"
                                >
                                    {leavingClassId === classToLeave.id && <Loader2 size={13} className="animate-spin" />}
                                    <span>Keluar Kelas</span>
                                </button>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>

        </div>
    );
}
