"use client";
import { alertDialog, confirmDialog, deleteConfirmDialog } from '@/lib/confirm-dialog';
import {
    createPASPeriodAction,
    deletePASPeriodAction,
    listPASPeriods,
    listSubjects,
    lockPASPeriodAction,
    PASSubjectSummary,
} from '@/lib/api/pas';
import { getActiveSchoolYear,getProctorOrganization,ProctorOrganization } from '@/lib/api/proctor';
import { InlineSelect } from '@/components/ui/InlineSelect';
import { matchesExamType, semesterAssessmentLabel } from '@/lib/exam-types';
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
    Edit3,
    FolderOpen,
    Loader2,Lock,
    Plus,Search,
    Trash2,
    Unlock,
    UserCheck,
    X
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import React,{ useCallback,useEffect,useState } from 'react';
import { Modal, ModalBody, ModalFooter, ModalField } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import EditPASPeriodModal from '@/app/components/pas/EditPASPeriodModal';

type PeriodType = 'pas' | 'pat' | 'pts' | 'pkn' | 'am';
type Semester = 'ganjil' | 'genap';

export default function ProctorPASPage({ activeTab = 'all', typeFilter = 'all', onTypeFilterChange }: { activeTab?: string; typeFilter?: string; onTypeFilterChange?: (type: string) => void }) {
    const router = useRouter();
    const [user, setUser] = useState<AuthUser | null>(null);
    const [org, setOrg] = useState<ProctorOrganization | null>(null);
    const [periods, setPeriods] = useMemoryState<PASPeriod[]>('proktor_pas_periods', []);
    const [, setSubjects] = useMemoryState<PASSubjectSummary[]>('proktor_pas_subjects', []);
    const [isLoading, setIsLoading] = useMemoryState('proktor_pas_isLoading', true);
    const [searchQuery, setSearchQuery] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isAddPeriodOpen, setIsAddPeriodOpen] = useState(false);
    const [editingPeriod, setEditingPeriod] = useState<PASPeriod | null>(null);

    const [periodForm, setPeriodForm] = useState({
        name: '',
        type: 'pas' as PeriodType,
        school_year: '',
        semester: 'ganjil' as Semester,
        start_date: '',
        end_date: '',
        committee_chair_name: '',
        committee_chair_nip: '',
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
            committee_chair_name: periodForm.committee_chair_name.trim() || undefined,
            committee_chair_nip: periodForm.committee_chair_nip.trim() || undefined,
        });

        if (result.success) {
            setIsAddPeriodOpen(false);
            setPeriodForm(prev => ({
                ...prev,
                name: '',
                type: 'pas',
                semester: 'ganjil',
                start_date: '',
                end_date: '',
                committee_chair_name: '',
                committee_chair_nip: '',
            }));
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
        if (!await confirmDialog({
            title: currentLock ? 'Buka Kunci Folder Ujian?' : 'Kunci Folder Ujian?',
            text: currentLock
                ? 'Buka kunci folder ujian ini?'
                : 'Kunci folder ujian ini? Jadwal di dalamnya tidak bisa diubah setelah dikunci.',
            variant: currentLock ? 'info' : 'warning',
            confirmText: currentLock ? 'Ya, Buka Kunci' : 'Ya, Kunci Folder',
        })) return;

        const result = await lockPASPeriodAction(periodId, !currentLock);
        if (result.success) await loadData();
        else await alertDialog({ title: 'Gagal', text: result.error, variant: 'danger' });
    };

    const handleDeletePeriod = async (periodId: string) => {
        if (!await deleteConfirmDialog('Hapus Folder Ujian?', 'Yakin menghapus folder ujian ini beserta jadwal yang belum dikerjakan?')) return;
        const result = await deletePASPeriodAction(periodId);
        if (result.success) await loadData();
        else await alertDialog({ title: 'Gagal', text: result.error, variant: 'danger' });
    };

    const formatDate = (dateStr: string) => {
        if (!dateStr) return '-';
        return new Date(dateStr).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
    };

    const getPeriodTypeLabel = (type: string) => semesterAssessmentLabel(type);

    const filteredPeriods = periods.filter(p => {
        if (!matchesExamType(p.type, typeFilter)) return false;
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
            {onTypeFilterChange && (
                <div className="max-w-sm">
                    <InlineSelect
                        aria-label="Jenis ujian folder"
                        value={typeFilter}
                        onChange={onTypeFilterChange}
                        options={[
                            { value: 'all', label: 'Semua Jenis Ujian' },
                            { value: 'asas_asat', label: 'ASAS/ASAT' },
                            { value: 'am', label: 'Asesmen Madrasah' },
                        ]}
                    />
                </div>
            )}
            <div className="flex flex-col sm:flex-row items-center gap-3">
                <div className="relative flex-1 w-full">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                    <input
                        type="text"
                        placeholder="Cari folder ujian..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full bg-white border border-slate-200 rounded-xl py-3 pl-10 pr-4 text-sm focus:ring-2 focus:ring-primary/10 outline-none"
                    />
                </div>
                <button
                    onClick={() => {
                        setPeriodForm(prev => ({ ...prev, type: typeFilter === 'am' ? 'am' : 'pas' }));
                        setIsAddPeriodOpen(true);
                    }}
                    className="w-full sm:w-auto px-6 py-3 text-sm bg-primary text-white rounded-xl hover:bg-primary/90 flex items-center justify-center gap-2 shadow-lg shadow-primary/20 font-medium transition-all cursor-pointer"
                >
                    <Plus size={16} /> Buat Folder Ujian
                </button>
            </div>

            {/* Period List */}
            {filteredPeriods.length === 0 ? (
                <div className="py-16 text-center text-slate-400 border-2 border-dashed border-slate-200 rounded-2xl">
                    <FolderOpen size={40} className="mx-auto mb-3 opacity-40" />
                    <p className="font-medium">Belum ada Folder Ujian</p>
                    <p className="text-sm mt-1">Klik &quot;Buat Folder Ujian&quot; untuk membuat rumah ujian baru dan menjadwalkan bank soal di dalamnya</p>
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
                                                {period.committee_chair_name && (
                                                    <span className="flex items-center gap-1.5 font-medium text-slate-600">
                                                        <UserCheck size={14} className={isActive ? 'text-blue-500' : 'text-slate-400'} />
                                                        <span>Ketua Panitia: <strong className="text-slate-700">{period.committee_chair_name}</strong></span>
                                                    </span>
                                                )}
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
                                                onClick={() => setEditingPeriod(period)}
                                                className="p-2 text-slate-400 hover:text-[#3083FF] hover:bg-blue-50 rounded-lg transition-all cursor-pointer"
                                                title="Edit Folder & Ketua Panitia">
                                                <Edit3 size={15} />
                                            </button>
                                        )}

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
            <Modal
                open={isAddPeriodOpen}
                onClose={() => setIsAddPeriodOpen(false)}
                size="xl"
                variant="add"
                icon={<FolderOpen size={18} />}
                title={`Buat Folder Ujian ${periodForm.type === 'am' ? 'Asesmen Madrasah' : 'ASAS / ASAT'}`}
                subtitle="Rumah ujian untuk memilih & menjadwalkan banyak bank soal"
                labelledBy="modal-create-pas-period"
                className="create-exam-modal"
            >
                <form onSubmit={handleCreatePeriod}>
                    <ModalBody className="create-exam-modal__body">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <ModalField label="Nama Folder / Nama Ujian" required hint="Nama ini akan menjadi nama ujian untuk setiap bank soal di dalamnya">
                                <input
                                    required
                                    type="text"
                                    placeholder={periodForm.type === 'am' ? 'Contoh: Asesmen Madrasah 2026/2027' : 'Contoh: ASAS Ganjil 2025/2026'}
                                    value={periodForm.name}
                                    onChange={e => setPeriodForm({ ...periodForm, name: e.target.value })}
                                />
                            </ModalField>

                            <ModalField label="Semester" required>
                                <InlineSelect
                                    value={periodForm.semester}
                                    onChange={val => setPeriodForm({ ...periodForm, semester: val as Semester })}
                                    options={[
                                        { value: 'ganjil', label: 'Semester Ganjil' },
                                        { value: 'genap', label: 'Semester Genap' },
                                    ]}
                                />
                            </ModalField>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                            <ModalField label="Kategori Asesmen" required>
                                <InlineSelect
                                    value={periodForm.type}
                                    onChange={val => setPeriodForm({ ...periodForm, type: val as PeriodType })}
                                    // ASAS dan ASAT satu pilihan; PTS/lainnya tidak tampil
                                    // di folder ASAS/AM sehingga tidak ditawarkan lagi.
                                    options={[
                                        { value: 'pas', label: 'ASAS / ASAT' },
                                        { value: 'am', label: 'Asesmen Madrasah' },
                                    ]}
                                />
                            </ModalField>

                            <ModalField label="Tahun Ajaran" required>
                                <input
                                    required
                                    type="text"
                                    placeholder="Contoh: 2025/2026"
                                    value={periodForm.school_year}
                                    onChange={e => setPeriodForm({ ...periodForm, school_year: e.target.value })}
                                />
                            </ModalField>

                            <div className="grid grid-cols-2 gap-2">
                                <ModalField label="Tanggal Mulai" required>
                                    <input
                                        required
                                        type="date"
                                        value={periodForm.start_date}
                                        onChange={e => setPeriodForm({ ...periodForm, start_date: e.target.value })}
                                    />
                                </ModalField>

                                <ModalField label="Tanggal Selesai" required>
                                    <input
                                        required
                                        type="date"
                                        min={periodForm.start_date || undefined}
                                        value={periodForm.end_date}
                                        onChange={e => setPeriodForm({ ...periodForm, end_date: e.target.value })}
                                    />
                                </ModalField>
                            </div>
                        </div>

                        <div className="pt-2 border-t border-slate-100">
                            <div className="flex items-center gap-1.5 mb-2">
                                <UserCheck size={14} className="text-[#3083FF]" />
                                <span className="text-xs font-bold text-slate-800">Kepanitiaan Ujian (Administrasi Dokumen)</span>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <ModalField label="Nama Lengkap & Gelar Ketua Panitia" hint="Dicantumkan pada Berita Acara dan Daftar Hadir">
                                    <input
                                        type="text"
                                        placeholder="Contoh: Drs. H. Ahmad Fauzi, M.Pd."
                                        value={periodForm.committee_chair_name}
                                        onChange={e => setPeriodForm({ ...periodForm, committee_chair_name: e.target.value })}
                                    />
                                </ModalField>

                                <ModalField label="NIP Ketua Panitia (Opsional)">
                                    <input
                                        type="text"
                                        placeholder="Contoh: 197505102000031002 atau -"
                                        value={periodForm.committee_chair_nip}
                                        onChange={e => setPeriodForm({ ...periodForm, committee_chair_nip: e.target.value })}
                                    />
                                </ModalField>
                            </div>
                        </div>
                    </ModalBody>

                    <ModalFooter>
                        <Button
                            type="button"
                            variant="cancel"
                            onClick={() => setIsAddPeriodOpen(false)}
                            disabled={isSubmitting}
                            icon="cancel"
                        >
                            Batal
                        </Button>
                        <Button
                            type="submit"
                            variant="primary"
                            isLoading={isSubmitting}
                            disabled={isSubmitting || !periodForm.name.trim()}
                            icon={isSubmitting ? undefined : "save"}
                        >
                            Buat Folder & Pilih Bank Soal
                        </Button>
                    </ModalFooter>
                </form>
            </Modal>

            {editingPeriod && (
                <EditPASPeriodModal
                    isOpen={Boolean(editingPeriod)}
                    period={editingPeriod}
                    onClose={() => setEditingPeriod(null)}
                    onSuccess={(updated) => {
                        setPeriods((prev) =>
                            prev.map((p) => (p.id === updated.id ? { ...p, ...updated } : p)),
                        );
                    }}
                />
            )}
        </div>
    );
}
