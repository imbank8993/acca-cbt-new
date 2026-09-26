"use client";
import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Users, LogIn, School, Loader2, Check, LogOut, Info, Sparkles, Building, User } from 'lucide-react';
import { getSessionUser } from '@/lib/session';
import { listStudentClasses, joinClassAction, leaveClassAction } from '@/lib/api/students';
import { useMemoryState } from '@/lib/useMemoryState';

export default function SiswaClassesPage() {
    const [classes, setClasses] = useMemoryState<any[]>('siswa_classes_classes', []);
    const [isLoading, setIsLoading] = useMemoryState('siswa_classes_isLoading', true);
    const [joinCode, setJoinCode] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [userId, setUserId] = useState<string | null>(null);
    const [fullName, setFullName] = useState<string>('');

    useEffect(() => {
        loadData();
        // Auto-injected smart sync (Window Focus)
        const handleFocus = () => { if (typeof loadData === 'function') loadData(); };
        window.addEventListener('focus', handleFocus);
        return () => window.removeEventListener('focus', handleFocus);
    }, []);

    const loadData = async () => {
        // setIsLoading(true); // Disabled for silent background sync
        const user = await getSessionUser();
        if (user) {
            setUserId(user.id);
            setClasses(await listStudentClasses());
            setFullName(user.fullName ?? '');
        }
        setIsLoading(false);
    };

    const handleJoinClass = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!userId || !joinCode.trim()) return;

        setIsSubmitting(true);
        const result = await joinClassAction(joinCode);
        if (result.success) {
            alert(`Berhasil bergabung dengan kelas: ${result.className}`);
            setJoinCode('');
            loadData();
        } else {
            alert('Gagal bergabung: ' + result.error);
        }
        setIsSubmitting(false);
    };

    const handleLeaveClass = async (classId: string, className: string, type: string) => {
        if (type === 'reguler') {
            alert('Anda tidak bisa keluar dari kelas reguler. Hubungi proktor.');
            return;
        }

        if (confirm(`Apakah Anda yakin ingin keluar dari kelas tambahan "${className}"?`)) {
            setIsLoading(true);
            const result = await leaveClassAction(classId);
            if (result.success) {
                alert(`Berhasil keluar dari kelas: ${result.className}`);
                loadData();
            } else {
                alert(`Gagal keluar: ${result.error}`);
                setIsLoading(false);
            }
        }
    };

    return (
        <div className="max-w-7xl mx-auto pb-24 space-y-6">

            {/* Gabung Kelas Section */}
            <div className="bg-white border border-slate-100 rounded-2xl p-5 md:p-6 shadow-sm hover:shadow-md transition-all duration-300 flex flex-col lg:flex-row items-center justify-between gap-5 relative overflow-hidden">
                <div className="absolute top-0 right-0 w-24 h-24 bg-[#030C4D]/5 rounded-bl-full pointer-events-none" />
                
                <div className="flex gap-4 items-start flex-1 w-full text-left">
                    <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center text-[#0038A8] shrink-0">
                        <LogIn size={18} />
                    </div>
                    <div className="space-y-1">
                        <h3 className="text-lg font-bold text-slate-800 tracking-tight">
                            Gabung Kelas Baru
                        </h3>
                        <p className="text-slate-500 text-xs md:text-sm font-medium leading-relaxed">
                            Masukkan kode akses unik dari Guru atau Proktor Anda untuk masuk ke kelas tambahan.
                        </p>
                    </div>
                </div>

                <form onSubmit={handleJoinClass} className="flex flex-col sm:flex-row gap-2.5 w-full lg:w-auto z-10 shrink-0">
                    <div className="relative w-full sm:w-[260px]">
                        <input
                            required
                            type="text"
                            placeholder="KODE KELAS (MISAL: X9A)"
                            value={joinCode}
                            onChange={e => setJoinCode(e.target.value)}
                            className="w-full bg-slate-50 hover:bg-slate-100/70 border border-slate-200 focus:bg-white rounded-xl py-2.5 px-4 focus:ring-4 focus:ring-indigo-500/10 focus:border-[#0038A8] outline-none font-bold text-slate-800 placeholder:text-slate-400 font-mono tracking-wider uppercase transition-all text-xs shadow-inner"
                        />
                    </div>
                    <button
                        type="submit"
                        disabled={isSubmitting || !joinCode.trim()}
                        className="bg-[#0038A8] hover:bg-[#020510] text-white font-bold px-6 py-2.5 rounded-xl shadow-md shadow-[#0038A8]/20 transition-all duration-300 flex items-center justify-center gap-1.5 active:scale-95 disabled:opacity-50 text-xs whitespace-nowrap"
                    >
                        {isSubmitting ? (
                            <Loader2 size={15} className="animate-spin" />
                        ) : (
                            <Check size={15} />
                        )}
                        Bergabung
                    </button>
                </form>
            </div>

            {/* Daftar Kelas */}
            <div className="space-y-5">
                <div className="flex justify-between items-center px-1">
                    <div className="flex items-center gap-2.5">
                        <div className="w-2.5 h-5 bg-[#030C4D] rounded-full" />
                        <h3 className="text-lg font-bold text-slate-800">Kelas Aktif</h3>
                    </div>
                    <button 
                        onClick={loadData} 
                        className="text-xs font-bold text-indigo-600 hover:text-[#030C4D] hover:bg-indigo-50 px-3 py-2 rounded-xl transition-all flex items-center gap-2 active:scale-95"
                    >
                        <Loader2 size={14} className={isLoading ? 'animate-spin' : ''} />
                        Segarkan Data
                    </button>
                </div>

                {isLoading ? (
                    <div className="flex flex-col items-center justify-center py-24 space-y-4">
                        <div className="w-12 h-12 border-4 border-slate-100 border-t-[#030C4D] rounded-full animate-spin"></div>
                        <p className="text-slate-400 font-bold text-xs tracking-widest uppercase">Memuat kelas Anda...</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {classes.map((cls, index) => {
                            const isReguler = cls.type === 'reguler';
                            
                            return (
                                <motion.div
                                    key={cls.id}
                                    layout
                                    initial={{ opacity: 0, y: 12 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ duration: 0.3, delay: index * 0.04 }}
                                    className="group bg-white border border-slate-100 rounded-2xl p-5 hover:border-indigo-100/80 transition-all duration-300 hover:shadow-xl hover:shadow-[#030C4D]/5 relative overflow-hidden flex flex-col h-full"
                                >
                                    {/* Top Accent Line */}
                                    <div className={`absolute top-0 left-0 w-full h-1 transition-all duration-300 ${
                                        isReguler 
                                            ? 'bg-gradient-to-r from-[#0038A8] to-[#c2185b] group-hover:h-1.5' 
                                            : 'bg-gradient-to-r from-amber-500 to-pink-500 group-hover:h-1.5'
                                    }`}></div>

                                    {/* Card Header */}
                                    <div className="flex justify-between items-center mb-4 pt-1">
                                        <span className={`px-2.5 py-1 rounded-lg text-[9px] font-bold uppercase tracking-wider border ${
                                            isReguler 
                                                ? 'bg-blue-50 text-[#0038A8] border-blue-100/60' 
                                                : 'bg-amber-50/50 text-amber-700 border-amber-500/10'
                                        }`}>
                                            {isReguler ? `Kelas Utama • ${cls.program || 'REGULER'}` : 'Kelas Tambahan'}
                                        </span>
                                        <div className="w-9 h-9 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-center text-slate-400 group-hover:bg-indigo-50 group-hover:text-[#0038A8] group-hover:border-indigo-100/50 transition-all duration-300">
                                            <School size={16} />
                                        </div>
                                    </div>

                                    {/* Class Title */}
                                    <h3 className="text-lg font-bold text-slate-800 tracking-tight mb-4 group-hover:text-[#0038A8] transition-colors line-clamp-2 leading-snug">
                                        {cls.name}
                                    </h3>

                                    {/* Class Details Container */}
                                    <div className="mt-auto space-y-2.5 pt-4 border-t border-slate-100/60">
                                        {/* Creator */}
                                        <div className="flex items-center gap-3 py-1 px-1.5 rounded-xl hover:bg-slate-50 transition-colors">
                                            <div className="w-7 h-7 rounded-lg bg-indigo-50 flex items-center justify-center text-indigo-600 shrink-0">
                                                <User size={13} className="stroke-[2.5]" />
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <span className="block text-[9px] font-bold text-slate-400 uppercase tracking-widest leading-none mb-1">Dibuat Oleh</span>
                                                <span className="block text-xs font-semibold text-slate-700 truncate leading-none">{isReguler ? 'Proktor Pusat' : 'Guru / Proktor'}</span>
                                            </div>
                                        </div>

                                        {/* Organization */}
                                        <div className="flex items-center gap-3 py-1 px-1.5 rounded-xl hover:bg-slate-50 transition-colors">
                                            <div className="w-7 h-7 rounded-lg bg-emerald-50/80 flex items-center justify-center text-emerald-600 shrink-0">
                                                <Building size={13} className="stroke-[2.5]" />
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <span className="block text-[9px] font-bold text-slate-400 uppercase tracking-widest leading-none mb-1">Sekolah</span>
                                                <span className="block text-xs font-semibold text-slate-700 truncate leading-none">{cls.orgName || 'Sekolah'}</span>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Leave Class Action for additional classes */}
                                    {!isReguler && (
                                        <div className="mt-4 pt-3 border-t border-slate-100">
                                            <button
                                                onClick={() => handleLeaveClass(cls.id, cls.name, cls.type)}
                                                className="w-full bg-rose-50/50 hover:bg-rose-50 text-rose-500 border border-rose-100/50 hover:border-rose-200 font-bold text-xs py-2 rounded-xl transition-all flex items-center justify-center gap-1.5 active:scale-[0.98]"
                                            >
                                                <LogOut size={13} /> Keluar Kelas
                                            </button>
                                        </div>
                                    )}
                                </motion.div>
                            );
                        })}

                        {/* Empty State */}
                        {classes.length === 0 && (
                            <div className="col-span-full py-20 px-6 text-center bg-white border border-dashed border-slate-200 rounded-[32px] shadow-sm max-w-xl mx-auto w-full flex flex-col items-center">
                                <div className="w-20 h-20 bg-indigo-50 rounded-3xl flex items-center justify-center mb-6 relative">
                                    <School size={36} className="text-[#030C4D]" />
                                    <Sparkles size={18} className="text-amber-400 absolute -top-1 -right-1 animate-pulse" />
                                </div>
                                <h3 className="text-xl font-bold text-slate-800 mb-2">Wah, Kelasmu Masih Kosong! 🎒</h3>
                                <p className="text-slate-500 text-sm font-medium max-w-sm mb-0">
                                    Kamu belum terdaftar di kelas manapun. Yuk, hubungi Wali Kelas atau Proktor untuk mendapatkan kode kelas tambahan Anda, lalu masukkan pada formulir di atas.
                                </p>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
