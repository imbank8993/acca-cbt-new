"use client";
import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    School,
    Check,
    LogOut,
    Loader2,
    KeyRound,
    AlertCircle,
    GraduationCap
} from 'lucide-react';
import { getSessionUser } from '@/lib/session';
import { listStudentClasses, joinClassAction, leaveClassAction } from '@/lib/api/students';
import { useMemoryState } from '@/lib/useMemoryState';
import { useToast } from '@/app/components/ui/Toast';

export default function SiswaClassesPage() {
    const [classes, setClasses] = useMemoryState<any[]>('siswa_classes_classes', []);
    const [isLoading, setIsLoading] = useMemoryState('siswa_classes_isLoading', true);
    const [joinCode, setJoinCode] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [userId, setUserId] = useState<string | null>(null);
    const [leavingClassId, setLeavingClassId] = useState<string | null>(null);
    const [classToLeave, setClassToLeave] = useState<{ id: string; name: string } | null>(null);

    const toast = useToast();

    useEffect(() => {
        loadData();
        const handleFocus = () => { if (typeof loadData === 'function') loadData(); };
        window.addEventListener('focus', handleFocus);
        return () => window.removeEventListener('focus', handleFocus);
    }, []);

    const loadData = async () => {
        const user = await getSessionUser();
        if (user) {
            setUserId(user.id);
            setClasses(await listStudentClasses());
        }
        setIsLoading(false);
    };

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
                loadData();
            } else {
                toast.error('Gagal Bergabung', result.error || 'Kode kelas tidak valid.');
            }
        } catch (err: any) {
            toast.error('Terjadi Kesalahan', err?.message || 'Gagal menghubungi server.');
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
                loadData();
            } else {
                toast.error('Gagal Keluar', result.error || 'Tidak dapat keluar dari kelas.');
            }
        } catch (err: any) {
            toast.error('Terjadi Kesalahan', err?.message || 'Gagal menghubungi server.');
        } finally {
            setLeavingClassId(null);
            setClassToLeave(null);
        }
    };

    return (
        <div className="max-w-7xl mx-auto pb-24 space-y-6">

            {/* ── Gabung Kelas Baru (Compact & Sleek) ── */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-2xl p-5 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4 text-left">
                <div className="flex items-center gap-3.5">
                    <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-[#3083FF]/10 text-[#3083FF] flex items-center justify-center shrink-0 border border-blue-100/60 dark:border-[#3083FF]/20 shadow-2xs">
                        <KeyRound size={18} />
                    </div>
                    <div>
                        <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100 leading-snug">
                            Gabung Kelas Tambahan
                        </h2>
                        <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                            Punya kode akses dari Guru atau Proktor? Masukkan di sini untuk mendaftar.
                        </p>
                    </div>
                </div>

                <form onSubmit={handleJoinClass} className="flex flex-col sm:flex-row items-center gap-2 w-full md:w-auto shrink-0">
                    <div className="relative w-full sm:w-64">
                        <input
                            required
                            type="text"
                            placeholder="KODE KELAS (MISAL: X9A)"
                            value={joinCode}
                            onChange={e => setJoinCode(e.target.value)}
                            className="w-full bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 focus:bg-white dark:focus:bg-slate-800 rounded-xl py-2 px-3.5 focus:ring-2 focus:ring-[#3083FF]/20 focus:border-[#3083FF] outline-none font-bold text-slate-800 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 font-mono tracking-wider uppercase transition-all text-xs"
                        />
                    </div>
                    <button
                        type="submit"
                        disabled={isSubmitting || !joinCode.trim()}
                        className="w-full sm:w-auto bg-[#3083FF] hover:bg-[#2563EB] text-white font-semibold px-4 py-2 rounded-xl shadow-xs shadow-[#3083FF]/20 transition-all flex items-center justify-center gap-1.5 active:scale-95 disabled:opacity-50 text-xs shrink-0"
                    >
                        {isSubmitting ? (
                            <Loader2 size={14} className="animate-spin" />
                        ) : (
                            <Check size={14} />
                        )}
                        <span>Bergabung</span>
                    </button>
                </form>
            </div>

            {/* ── Daftar Kelas Aktif ── */}
            <div className="space-y-4 text-left">
                <div className="flex items-center justify-between px-0.5">
                    <div className="flex items-center gap-2">
                        <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100">
                            Kelas Terdaftar
                        </h2>
                        {classes.length > 0 && (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#3083FF]/10 text-[#3083FF]">
                                {classes.length}
                            </span>
                        )}
                    </div>
                </div>

                {isLoading ? (
                    <div className="flex flex-col items-center justify-center py-20 space-y-3">
                        <Loader2 size={24} className="animate-spin text-[#3083FF]" />
                        <p className="text-slate-400 font-semibold text-xs tracking-wide uppercase">Memuat kelas Anda...</p>
                    </div>
                ) : classes.length === 0 ? (
                    /* ── Empty State ── */
                    <div className="py-16 px-6 text-center bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-2xl shadow-xs max-w-md mx-auto w-full flex flex-col items-center">
                        <div className="w-12 h-12 bg-blue-50 dark:bg-slate-800 rounded-2xl flex items-center justify-center mb-3.5 text-[#3083FF]">
                            <GraduationCap size={24} />
                        </div>
                        <h3 className="text-base font-bold text-slate-800 dark:text-slate-100 mb-1">
                            Belum Terdaftar di Kelas
                        </h3>
                        <p className="text-slate-500 dark:text-slate-400 text-xs font-normal max-w-xs leading-relaxed">
                            Anda belum terdaftar di kelas manapun. Masukkan kode akses kelas tambahan yang diberikan guru atau hubungi proktor Anda.
                        </p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
                        {classes.map((cls, index) => {
                            const isReguler = cls.type === 'reguler';

                            return (
                                <motion.div
                                    key={cls.id || index}
                                    layout
                                    initial={{ opacity: 0, y: 8 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ duration: 0.2, delay: index * 0.03 }}
                                    className="group bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 hover:border-[#3083FF]/40 dark:hover:border-[#3083FF]/50 rounded-2xl p-5 hover:shadow-md transition-all duration-200 relative overflow-hidden flex flex-col justify-between"
                                >
                                    {/* Subtle Top Accent */}
                                    <div
                                        className={`absolute top-0 left-0 right-0 h-1 ${
                                            isReguler ? 'bg-[#3083FF]' : 'bg-indigo-500'
                                        }`}
                                    />

                                    <div>
                                        {/* Meta Header */}
                                        <div className="flex justify-between items-center mb-3 pt-0.5">
                                            <span
                                                className={`px-2.5 py-0.5 rounded-lg text-[10px] font-bold border tracking-wide uppercase ${
                                                    isReguler
                                                        ? 'bg-blue-50 text-[#3083FF] border-blue-200/60 dark:bg-[#3083FF]/10 dark:text-[#3083FF] dark:border-[#3083FF]/20'
                                                        : 'bg-indigo-50 text-indigo-600 border-indigo-200/60 dark:bg-indigo-950/40 dark:text-indigo-400 dark:border-indigo-800/40'
                                                }`}
                                            >
                                                {isReguler ? `Kelas Utama • ${cls.program || 'REGULER'}` : 'Kelas Tambahan'}
                                            </span>

                                            <div className="w-8 h-8 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700/60 flex items-center justify-center text-slate-400 group-hover:text-[#3083FF] transition-colors">
                                                <School size={15} />
                                            </div>
                                        </div>

                                        {/* Class Name */}
                                        <h3 className="text-base font-bold text-slate-800 dark:text-slate-100 group-hover:text-[#3083FF] dark:group-hover:text-blue-400 transition-colors line-clamp-2 leading-snug">
                                            {cls.name}
                                        </h3>
                                    </div>

                                    {/* Action Footer for Non-Reguler */}
                                    {!isReguler && (
                                        <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800">
                                            <button
                                                type="button"
                                                onClick={() => setClassToLeave({ id: cls.id, name: cls.name })}
                                                className="w-full py-1.5 px-3 rounded-xl border border-rose-200 dark:border-rose-900/40 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 text-xs font-semibold transition-all flex items-center justify-center gap-1.5 active:scale-98"
                                            >
                                                <LogOut size={12} />
                                                <span>Keluar Kelas</span>
                                            </button>
                                        </div>
                                    )}
                                </motion.div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* ── Modal Konfirmasi Keluar Kelas (Elegan & Tanpa Alert Bawaan) ── */}
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
                                    Anda akan keluar dari kelas tambahan <strong className="text-slate-700 dark:text-slate-200 font-semibold">"{classToLeave.name}"</strong>. Ujian yang ditugaskan ke kelas ini tidak akan muncul lagi di daftar ujian Anda.
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
