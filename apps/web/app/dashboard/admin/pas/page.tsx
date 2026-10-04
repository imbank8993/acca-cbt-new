"use client";
import {
    createPASPeriodAction,
    deletePASPeriodAction,
    listPASPeriods,
    listSubjects,
    lockPASPeriodAction,
    PASSubjectSummary,
} from '@/lib/api/pas';
import { getActiveSchoolYear,getProctorOrganization,ProctorOrganization } from '@/lib/api/proctor';
import { getSessionUser } from '@/lib/session';
import { useMemoryState } from '@/lib/useMemoryState';
import type { PASPeriod } from '@/app/types/pas';
import type { AuthUser } from '@acca-cbt/shared';
import { AnimatePresence,motion } from 'framer-motion';
import {
BookOpen,
Calendar,
Check,
ChevronRight,
FolderOpen,
Loader2,Lock,
Plus,Search,
Trash2,
Unlock,
X
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import React,{ useCallback,useEffect,useState } from 'react';

type PeriodType = 'pas' | 'pat' | 'pts' | 'pkn';
type Semester = 'ganjil' | 'genap';

export default function ProctorPASPage({ activeTab = 'all' }: { activeTab?: string }) {
    const router = useRouter();
    const [user, setUser] = useState<AuthUser | null>(null);
    const [org, setOrg] = useState<ProctorOrganization | null>(null);
    const [periods, setPeriods] = useMemoryState<PASPeriod[]>('proktor_pas_periods', []);
    const [, setSubjects] = useMemoryState<PASSubjectSummary[]>('proktor_pas_subjects', []);
    const [isLoading, setIsLoading] = useMemoryState('proktor_pas_isLoading', true);
    const [searchQuery, setSearchQuery] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isAddPeriodOpen, setIsAddPeriodOpen] = useState(false);

    const [periodForm, setPeriodForm] = useState({
        name: '',
        type: 'pas' as PeriodType,
        school_year: '',
        semester: 'ganjil' as Semester,
        start_date: '',
        end_date: '',
    });

    const loadData = useCallback(async () => {
        // setIsLoading(true); // Disabled for silent background sync
        const authUser = await getSessionUser();
        if (authUser) {
            setUser(authUser);
            const orgData = await getProctorOrganization();
            if (orgData) {
                setOrg(orgData);
                const [periodList, subjectList, activeYear] = await Promise.all([
                    listPASPeriods(),
                    listSubjects(),
                    getActiveSchoolYear()
                ]);
                setPeriods(periodList || []);
                setSubjects(subjectList || []);
                if (activeYear && activeYear.year) {
                    setPeriodForm(prev => ({ ...prev, school_year: activeYear.year }));
                }
            }
        }
        setIsLoading(false);
    }, [setIsLoading, setPeriods, setSubjects]);

    useEffect(() => {
        const initialLoad = window.setTimeout(() => { void loadData(); }, 0);
        const handleFocus = () => { void loadData(); };
        window.addEventListener('focus', handleFocus);
        return () => {
            window.clearTimeout(initialLoad);
            window.removeEventListener('focus', handleFocus);
        };
    }, [loadData]);

    const handleCreatePeriod = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!org || !user) return;
        setIsSubmitting(true);

        const result = await createPASPeriodAction({
            name: periodForm.name,
            type: periodForm.type,
            school_year: periodForm.school_year,
            semester: periodForm.semester,
            start_date: periodForm.start_date,
            end_date: periodForm.end_date,
        });

        if (result.success) {
            setIsAddPeriodOpen(false);
            setPeriodForm(prev => ({ ...prev, name: '', type: 'pas', semester: 'ganjil', start_date: '', end_date: '' }));
            await loadData();
            if (result.id) {
                router.push(`/dashboard/admin/exams/pas/${result.id}`);
            }
        } else {
            alert(result.error || 'Gagal membuat folder ujian');
        }
        setIsSubmitting(false);
    };

    const handleToggleLock = async (periodId: string, currentLock: boolean) => {
        if (!confirm(currentLock
            ? 'Buka kunci folder ujian ini?'
            : 'Kunci folder ujian ini? Jadwal di dalamnya tidak bisa diubah setelah dikunci.')) return;

        const result = await lockPASPeriodAction(periodId, !currentLock);
        if (result.success) await loadData();
        else alert(result.error);
    };

    const handleDeletePeriod = async (periodId: string) => {
        if (!confirm('Yakin menghapus folder ujian ASAS/ASAT ini beserta jadwal yang belum dikerjakan?')) return;
        const result = await deletePASPeriodAction(periodId);
        if (result.success) await loadData();
        else alert(result.error);
    };

    const formatDate = (dateStr: string) => {
        if (!dateStr) return '-';
        return new Date(dateStr).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
    };

    const getPeriodTypeLabel = (type: string) => {
        const labels: Record<string, string> = { pas: 'ASAS / PAS', pat: 'ASAT / PAT', pts: 'PTS / UTS', pkn: 'Asesmen Lainnya' };
        return labels[type] || type.toUpperCase();
    };

    const filteredPeriods = periods.filter(p => {
        const matchesSearch = p.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
                              p.school_year?.toLowerCase().includes(searchQuery.toLowerCase());
        
        if (!matchesSearch) return false;

        if (activeTab && activeTab !== 'all') {
            const now = new Date();
            const start = new Date(p.start_date);
            const end = new Date(p.end_date);
            end.setHours(23, 59, 59, 999);
            const isActive = start <= now && end >= now && !p.is_locked;
            const isFinished = end < now;
            const isDraft = !isActive && !isFinished;

            if (activeTab === 'active' && !isActive) return false;
            if (activeTab === 'finished' && !isFinished) return false;
            if (activeTab === 'draft' && !isDraft) return false;
        }

        return true;
    });

    if (isLoading) {
        return (
            <div className="flex justify-center py-20">
                <Loader2 size={48} className="text-primary animate-spin" />
            </div>
        );
    }

    return (
        <div className="max-w-6xl mx-auto space-y-6 pb-20">
            {/* Actions Bar */}
            <div className="flex flex-col sm:flex-row items-center gap-3">
                <div className="relative flex-1 w-full">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                    <input
                        type="text"
                        placeholder="Cari folder ujian ASAS/ASAT..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full bg-white border border-slate-200 rounded-xl py-3 pl-10 pr-4 text-sm focus:ring-2 focus:ring-primary/10 outline-none"
                    />
                </div>
                <button
                    onClick={() => setIsAddPeriodOpen(true)}
                    className="w-full sm:w-auto px-6 py-3 text-sm bg-primary text-white rounded-xl hover:bg-primary/90 flex items-center justify-center gap-2 shadow-lg shadow-primary/20 font-medium transition-all cursor-pointer"
                >
                    <Plus size={16} /> Buat Folder ASAS/ASAT
                </button>
            </div>

            {/* Period List */}
            {filteredPeriods.length === 0 ? (
                <div className="py-16 text-center text-slate-400 border-2 border-dashed border-slate-200 rounded-2xl">
                    <FolderOpen size={40} className="mx-auto mb-3 opacity-40" />
                    <p className="font-medium">Belum ada Folder Ujian ASAS/ASAT</p>
                    <p className="text-sm mt-1">Klik &quot;Buat Folder ASAS/ASAT&quot; untuk membuat rumah ujian baru dan menjadwalkan bank soal di dalamnya</p>
                </div>
            ) : (
                <div className="space-y-4">
                    {filteredPeriods.map((period) => {
                        const now = new Date();
                        const start = new Date(period.start_date);
                        const end = new Date(period.end_date);
                        end.setHours(23, 59, 59, 999);
                        const isActive = start <= now && end >= now && !period.is_locked;
                        const isPast = end < now;
                        const bankCount = period._count?.pas_subjects || 0;
                        const scheduleCount = period._count?.pas_class_schedules || 0;

                        return (
                            <motion.div
                                key={period.id}
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                className={`bg-white border rounded-xl p-5 md:p-6 transition-all hover:shadow-md ${
                                    period.is_locked ? 'border-slate-200 opacity-75' :
                                    isActive ? 'border-blue-200 shadow-sm bg-blue-50/10' :
                                    isPast ? 'border-slate-100 opacity-60' : 'border-slate-200'
                                }`}
                            >
                                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                                    <div
                                        onClick={() => router.push(`/dashboard/admin/exams/pas/${period.id}`)}
                                        className="flex items-start gap-4 flex-1 cursor-pointer group"
                                    >
                                        <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 border transition-colors ${
                                            period.is_locked ? 'bg-slate-50 text-slate-400 border-slate-200' :
                                            isActive ? 'bg-blue-50 text-blue-600 border-blue-200 group-hover:bg-blue-100' : 'bg-slate-50 text-slate-500 border-slate-200 group-hover:border-blue-200 group-hover:text-blue-600'
                                        }`}>
                                            <FolderOpen size={22} />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex flex-wrap items-center gap-2 mb-1.5">
                                                <span className="px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider bg-blue-50 text-[#3083FF] border border-blue-200">
                                                    FOLDER UJIAN
                                                </span>
                                                <span className={`px-2.5 py-0.5 rounded-md text-xs font-semibold ${
                                                    period.is_locked ? 'bg-slate-100 text-slate-500' :
                                                    isActive ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
                                                    isPast ? 'bg-slate-50 text-slate-400 border border-slate-200' : 'bg-slate-50 text-slate-600 border border-slate-200'
                                                }`}>
                                                    {getPeriodTypeLabel(period.type)} • {period.semester === 'ganjil' ? 'Semester Ganjil' : 'Semester Genap'}
                                                </span>
                                                <span className="px-2 py-0.5 bg-slate-50 text-slate-500 text-xs font-semibold border border-slate-200 rounded-md">
                                                    {period.school_year}
                                                </span>
                                                {period.is_locked && (
                                                    <span className="px-2 py-0.5 bg-amber-50 text-amber-600 text-xs font-bold rounded-md border border-amber-200 flex items-center gap-1">
                                                        <Lock size={10} /> TERKUNCI
                                                    </span>
                                                )}
                                            </div>
                                            <h3 className="font-bold text-slate-900 text-lg leading-tight mb-2 group-hover:text-[#3083FF] transition-colors">{period.name}</h3>
                                            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs sm:text-sm text-slate-500 mt-1">
                                                <span className="flex items-center gap-1.5 font-medium">
                                                    <Calendar size={14} className={isActive ? 'text-blue-500' : 'text-slate-400'} />
                                                    <span className="text-slate-600">{formatDate(period.start_date)}</span> — <span className="text-slate-600">{formatDate(period.end_date)}</span>
                                                </span>
                                                <span className="flex items-center gap-1.5 font-medium">
                                                    <BookOpen size={14} className={isActive ? 'text-blue-500' : 'text-slate-400'} />
                                                    <span className="text-slate-700 font-semibold">{bankCount} Bank Soal</span>
                                                    <span className="text-slate-400">•</span>
                                                    <span className="text-slate-600">{scheduleCount} Jadwal Kelas</span>
                                                </span>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-2 shrink-0">
                                        <button
                                            onClick={() => router.push(`/dashboard/admin/exams/pas/${period.id}`)}
                                            className="px-4 py-2 text-xs sm:text-sm bg-[#3083FF] text-white hover:bg-[#2563EB] rounded-lg transition-all font-semibold flex items-center gap-1.5 shadow-sm cursor-pointer">
                                            Buka Folder <ChevronRight size={14} />
                                        </button>

                                        {!period.is_locked && (
                                            <button
                                                onClick={() => handleToggleLock(period.id, false)}
                                                className="p-2 text-slate-400 hover:text-amber-500 hover:bg-amber-50 rounded-lg transition-all"
                                                title="Kunci Folder">
                                                <Lock size={15} />
                                            </button>
                                        )}

                                        {period.is_locked && (
                                            <button
                                                onClick={() => handleToggleLock(period.id, true)}
                                                className="p-2 text-slate-400 hover:text-emerald-500 hover:bg-emerald-50 rounded-lg transition-all"
                                                title="Buka Kunci Folder">
                                                <Unlock size={15} />
                                            </button>
                                        )}

                                        {!period.is_locked && (
                                            <button
                                                onClick={() => handleDeletePeriod(period.id)}
                                                className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"
                                                title="Hapus Folder">
                                                <Trash2 size={15} />
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </motion.div>
                        );
                    })}
                </div>
            )}

            {/* CREATE PERIOD MODAL */}
            <AnimatePresence>
                {isAddPeriodOpen && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
                        <motion.div
                            initial={{ scale: 0.95, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.95, opacity: 0 }}
                            className="bg-white w-full max-w-lg rounded-2xl p-6 relative max-h-[90vh] overflow-y-auto">
                            <button onClick={() => setIsAddPeriodOpen(false)} className="absolute top-4 right-4 text-slate-400 hover:text-slate-600">
                                <X size={20} />
                            </button>
                            <div className="flex items-center gap-2.5 mb-4">
                                <div className="w-10 h-10 bg-primary/10 rounded-xl flex items-center justify-center">
                                    <FolderOpen size={20} className="text-primary" />
                                </div>
                                <div>
                                    <h3 className="text-lg font-bold text-slate-900">Buat Folder Ujian ASAS/ASAT</h3>
                                    <p className="text-xs text-slate-500">Rumah ujian untuk memilih & menjadwalkan banyak bank soal</p>
                                </div>
                            </div>
                            <form onSubmit={handleCreatePeriod} className="space-y-4">
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1.5">Nama Folder / Nama Ujian *</label>
                                    <input required type="text" placeholder="Contoh: ASAS Ganjil 2025/2026"
                                        value={periodForm.name}
                                        onChange={e => setPeriodForm({ ...periodForm, name: e.target.value })}
                                        className="w-full border border-slate-200 rounded-xl p-3 text-sm focus:ring-2 focus:ring-primary/10 outline-none" />
                                    <p className="text-[11px] text-slate-400 mt-1">Nama folder ini akan menjadi nama ujian untuk setiap bank soal yang dijadwalkan di dalamnya.</p>
                                </div>
                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 mb-1.5">Kategori</label>
                                        <select value={periodForm.type}
                                            onChange={e => setPeriodForm({ ...periodForm, type: e.target.value as PeriodType })}
                                            className="w-full border border-slate-200 rounded-xl p-3 text-sm focus:ring-2 focus:ring-primary/10 outline-none">
                                            <option value="pas">ASAS / PAS (Akhir Semester)</option>
                                            <option value="pat">ASAT / PAT (Akhir Tahun)</option>
                                            <option value="pts">PTS / UTS</option>
                                            <option value="pkn">Asesmen Lainnya</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 mb-1.5">Semester</label>
                                        <select value={periodForm.semester}
                                            onChange={e => setPeriodForm({ ...periodForm, semester: e.target.value as Semester })}
                                            className="w-full border border-slate-200 rounded-xl p-3 text-sm focus:ring-2 focus:ring-primary/10 outline-none">
                                            <option value="ganjil">Ganjil</option>
                                            <option value="genap">Genap</option>
                                        </select>
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1.5">Tahun Ajaran *</label>
                                    <input required type="text" placeholder="Contoh: 2025/2026"
                                        value={periodForm.school_year}
                                        onChange={e => setPeriodForm({ ...periodForm, school_year: e.target.value })}
                                        className="w-full border border-slate-200 rounded-xl p-3 text-sm focus:ring-2 focus:ring-primary/10 outline-none" />
                                </div>
                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 mb-1.5">Tanggal Mulai</label>
                                        <input required type="date"
                                            value={periodForm.start_date}
                                            onChange={e => setPeriodForm({ ...periodForm, start_date: e.target.value })}
                                            className="w-full border border-slate-200 rounded-xl p-3 text-sm focus:ring-2 focus:ring-primary/10 outline-none" />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 mb-1.5">Tanggal Selesai</label>
                                        <input required type="date"
                                            min={periodForm.start_date || undefined}
                                            value={periodForm.end_date}
                                            onChange={e => setPeriodForm({ ...periodForm, end_date: e.target.value })}
                                            className="w-full border border-slate-200 rounded-xl p-3 text-sm focus:ring-2 focus:ring-primary/10 outline-none" />
                                    </div>
                                </div>
                                <button type="submit" disabled={isSubmitting}
                                    className="w-full py-3 bg-primary text-white rounded-xl font-semibold flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer">
                                    {isSubmitting ? <Loader2 size={18} className="animate-spin" /> : <Check size={18} />}
                                    Buat Folder & Pilih Bank Soal
                                </button>
                            </form>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>
        </div>
    );
}
