"use client";
import '@/app/components/classes/classes.css';
import { Button } from '@/app/components/ui/button';
import { FilterActions,FilterSearch,FilterSelect,FilterToolbar } from '@/app/components/ui/filtertoolbar';
import { Modal,ModalBody,ModalField,ModalFooter,ModalHeader } from '@/app/components/ui/modal';
import { Spinner } from '@/app/components/ui/Spinner';
import {
type ClassStudent,
createClassAction,
deleteClassAction,
editClassAction,
getActiveSchoolYear,
getProctorOrganization,
getStudentsByClassAction,
importClassesAction,
listOrganizationClasses,
listOrganizationSchoolYears,
type OrganizationClass,
type ProctorOrganization,
} from '@/lib/api/proctor';
import { getSessionUser } from '@/lib/session';
import { useMemoryState } from '@/lib/useMemoryState';
import { motion } from 'framer-motion';
import {
Bookmark,
CalendarDays,
Check,
Copy,
School,
Users
} from 'lucide-react';
import React,{ useCallback,useEffect,useState } from 'react';

const currentYear = new Date().getFullYear();
const generateYearOptions = (): string[] => {
    const years: string[] = [];
    for (let y = currentYear + 1; y >= currentYear - 5; y--) {
        years.push(`${y}/${y + 1}`);
    }
    return years;
};

/** Ekstrak tingkatan kelas dari nama kelas (misal: X/10, XI/11, XII/12, VII/7, dsb). */
function extractGradeLevel(className: string): number {
    if (!className) return 99;
    const name = className.trim().toUpperCase();

    // 1. Angka Romawi: XII (12), XI (11), X (10), IX (9), VIII (8), VII (7), dsb.
    const romanMatch =
        name.match(/\b(XII|XI|X|IX|VIII|VII|VI|V|IV|III|II|I)\b/i) ||
        name.match(/^(XII|XI|X|IX|VIII|VII|VI|V|IV|III|II|I)/i);
    if (romanMatch) {
        const r = romanMatch[1].toUpperCase();
        const romanMap: Record<string, number> = {
            XII: 12, XI: 11, X: 10, IX: 9, VIII: 8, VII: 7, VI: 6, V: 5, IV: 4, III: 3, II: 2, I: 1,
        };
        if (romanMap[r]) return romanMap[r];
    }

    // 2. Angka Arab di batas kata (misal: "10 MIPA", "11-IPS", "Kelas 12", "7A")
    const numMatch =
        name.match(/^(1[0-2]|[1-9])(?=[^0-9]|$)/) ||
        name.match(/(?:KELAS\s+|TINGKAT\s+)?(1[0-2]|[1-9])(?=[^0-9]|$)/);
    if (numMatch) {
        return parseInt(numMatch[1], 10);
    }

    return 99;
}

/**
 * Sortir cerdas untuk daftar kelas:
 * 1. Prioritaskan kelas yang memiliki siswa (> 0) lebih dulu dibanding kelas kosong (0).
 * 2. Kelompokkan per tingkatan kelas secara berurutan (misal: X -> XI -> XII atau 7 -> 8 -> 9).
 * 3. Urutkan alfabetis secara natural (misal: "X MIPA 1" sebelum "X MIPA 2").
 */
function compareClasses(
    a: { name?: string; studentCount?: number },
    b: { name?: string; studentCount?: number },
): number {
    const hasA = (a.studentCount || 0) > 0 ? 1 : 0;
    const hasB = (b.studentCount || 0) > 0 ? 1 : 0;
    if (hasA !== hasB) {
        return hasB - hasA;
    }

    const gradeA = extractGradeLevel(a.name || '');
    const gradeB = extractGradeLevel(b.name || '');
    if (gradeA !== gradeB) {
        return gradeA - gradeB;
    }

    return (a.name || '').localeCompare(b.name || '', undefined, {
        numeric: true,
        sensitivity: 'base',
    });
}

export default function SettingsClassesPage() {
    const [classes, setClasses] = useMemoryState<OrganizationClass[]>('admin_settings_classes_classes', []);
    const [org, setOrg] = useState<ProctorOrganization | null>(null);
    const [isLoading, setIsLoading] = useMemoryState('admin_settings_classes_isLoading', true);
    const [searchQuery, setSearchQuery] = useState('');
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [isImportModalOpen, setIsImportModalOpen] = useState(false);
    const [deleteClassTarget, setDeleteClassTarget] = useState<OrganizationClass | null>(null);
    const [editingClass, setEditingClass] = useState<OrganizationClass | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [classForm, setClassForm] = useState({
        name: '',
        type: 'reguler' as 'reguler' | 'tambahan',
        schoolYear: ''
    });
    const [classTypeFilter, setClassTypeFilter] = useState<'all' | 'reguler' | 'tambahan'>('all');
    const defaultCurrentYear = `${currentYear}/${currentYear + 1}`;
    const [yearFilter, setYearFilter] = useState<string>(defaultCurrentYear);
    const [copiedCode, setCopiedCode] = useState<string | null>(null);

    const [isStudentModalOpen, setIsStudentModalOpen] = useState(false);
    const [selectedClassForStudents, setSelectedClassForStudents] = useState<OrganizationClass | null>(null);
    const [classStudents, setClassStudents] = useState<ClassStudent[]>([]);
    const [isLoadingStudents, setIsLoadingStudents] = useState(false);
    const [yearOptions, setYearOptions] = useState<string[]>(generateYearOptions());

    const handleViewStudents = async (cls: OrganizationClass) => {
        setSelectedClassForStudents(cls);
        setIsStudentModalOpen(true);
        setIsLoadingStudents(true);
        const students = await getStudentsByClassAction(cls.id, cls.type === 'tambahan');
        setClassStudents(students || []);
        setIsLoadingStudents(false);
    };

    const loadData = useCallback(async () => {
        const user = await getSessionUser();
        if (user) {
            const organization = await getProctorOrganization();
            if (organization) {
                setOrg(organization);
                const [classList, yearList, activeYearData] = await Promise.all([
                    listOrganizationClasses(),
                    listOrganizationSchoolYears(),
                    getActiveSchoolYear(),
                ]);
                setClasses(classList || []);
                setYearOptions(yearList || []);
                const runningYear = activeYearData?.year || yearList?.[0] || defaultCurrentYear;
                setYearFilter(prev => (!prev || prev === 'all' || prev === defaultCurrentYear ? runningYear : prev));
                setClassForm(prev => prev.schoolYear ? prev : ({ ...prev, schoolYear: runningYear }));
            }
        }
        setIsLoading(false);
    }, [defaultCurrentYear, setClasses, setIsLoading]);

    useEffect(() => {
        const initialLoad = window.setTimeout(() => void loadData(), 0);
        const handleFocus = () => void loadData();
        window.addEventListener('focus', handleFocus);
        return () => {
            window.clearTimeout(initialLoad);
            window.removeEventListener('focus', handleFocus);
        };
    }, [loadData]);

    const handleCreateClass = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!org) return;
        setIsSubmitting(true);
        const result = await createClassAction(classForm.name,
            classForm.type,
            classForm.schoolYear || undefined
        );
        if (result.success) {
            setIsModalOpen(false);
            setClassForm({ name: '', type: 'reguler', schoolYear: classForm.schoolYear });
            await loadData();
        } else {
            alert(result.error || 'Gagal membuat kelas');
        }
        setIsSubmitting(false);
    };

    const confirmDeleteClass = async () => {
        if (!deleteClassTarget) return;
        setIsSubmitting(true);
        const result = await deleteClassAction(deleteClassTarget.id);
        if (result.success) {
            setDeleteClassTarget(null);
            await loadData();
        } else {
            alert(result.error || 'Gagal menghapus kelas');
        }
        setIsSubmitting(false);
    };

    const handleEditClass = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!editingClass) return;
        setIsSubmitting(true);
        const result = await editClassAction(editingClass.id, classForm.name, classForm.type, classForm.schoolYear || undefined);
        if (result.success) {
            setIsEditModalOpen(false);
            setEditingClass(null);
            setClassForm({ name: '', type: 'reguler', schoolYear: classForm.schoolYear });
            await loadData();
        } else {
            alert(result.error || 'Gagal mengedit kelas');
        }
        setIsSubmitting(false);
    };

    const openEditModal = (cls: OrganizationClass) => {
        setEditingClass(cls);
        setClassForm({ name: cls.name, type: cls.type, schoolYear: cls.school_year || '' });
        setIsEditModalOpen(true);
    };

    const handleCopyCode = (code?: string | null) => {
        if (!code) return;
        void navigator.clipboard.writeText(code);
        setCopiedCode(code);
        setTimeout(() => setCopiedCode(null), 2000);
    };

    const filtered = React.useMemo(() => {
        return classes.filter(cls => {
            const matchSearch = cls.name?.toLowerCase().includes(searchQuery.toLowerCase());
            const matchType = classTypeFilter === 'all' || cls.type === classTypeFilter;
            const matchYear =
                yearFilter === 'all' ||
                cls.school_year === yearFilter ||
                (cls.type === 'tambahan' && (!cls.school_year || cls.school_year === yearFilter));
            return matchSearch && matchType && matchYear;
        }).sort(compareClasses);
    }, [classes, searchQuery, classTypeFilter, yearFilter]);

    const handleExport = async () => {
        const XLSX = await import('xlsx');
        const exportData = classes.map(c => ({
            'Nama Kelas': c.name || '',
            'Tipe': c.type || 'reguler',
            'Tahun Ajaran': c.school_year || ''
        }));
        
        if (exportData.length === 0) {
            exportData.push({ 'Nama Kelas': '', 'Tipe': 'reguler', 'Tahun Ajaran': '' });
        }
        
        const worksheet = XLSX.utils.json_to_sheet(exportData);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Data Kelas');
        XLSX.writeFile(workbook, 'Data_Kelas.xlsx');
    };

    const handleImportFile = async (file: File) => {
        if (!file || !org) return;
        const XLSX = await import('xlsx');
        const reader = new FileReader();
        reader.onload = async (event) => {
            const data = new Uint8Array(event.target?.result as ArrayBuffer);
            const workbook = XLSX.read(data, { type: 'array' });
            const worksheet = workbook.Sheets[workbook.SheetNames[0]];
            const jsonData = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet);
            const formattedData = jsonData.map(row => ({
                name: String(row['Nama Kelas'] || row.name || '').trim(),
                type: String(row['Tipe'] || row.type || 'reguler').toLowerCase().trim() as 'reguler' | 'tambahan',
                schoolYear: String(row['Tahun Ajaran'] || row.schoolYear || '').trim() || undefined
            })).filter(r => r.name);
            if (formattedData.length === 0) {
                alert('Tidak ada data valid ditemukan dalam file.');
                return;
            }
            setIsSubmitting(true);
            const result = await importClassesAction(formattedData);
            setIsImportModalOpen(false);
            await loadData();
            setIsSubmitting(false);
            if (result.failedCount > 0) {
                alert(`Impor selesai: ${result.successCount} berhasil, ${result.failedCount} gagal.`);
            } else {
                alert(`Berhasil mengimpor ${result.successCount} kelas.`);
            }
        };
        reader.readAsArrayBuffer(file);
    };

    // Group classes by school year for display
    const classesByYear = React.useMemo(() => {
        return filtered.reduce((acc, cls) => {
            const year = cls.school_year || 'Tanpa Tahun Ajaran';
            if (!acc[year]) acc[year] = [];
            acc[year].push(cls);
            return acc;
        }, {} as Record<string, OrganizationClass[]>);
    }, [filtered]);

    return (
        <div className="max-w-7xl mx-auto pb-20">

            {/* Stats Cards */}
            <div className="grid grid-cols-4 gap-x-2 mb-6">
                <div className="bg-white rounded-lg border border-[#3083FF]/30 text-center px-4 py-3">
                    <div className="w-10 h-10 mx-auto mb-2 rounded-lg flex items-center justify-center bg-[#3083FF]/10 border border-[#3083FF]/30">
                        <School size={18} className="text-[#3083FF]" />
                    </div>
                    <p className="text-2xl font-bold text-[#3083FF]">{classes.length}</p>
                    <p className="text-xs text-slate-500">Total</p>
                </div>
                <div className="bg-white rounded-lg border border-[#3083FF]/30 text-center px-4 py-3">
                    <div className="w-10 h-10 mx-auto mb-2 rounded-lg flex items-center justify-center bg-[#3083FF]/10 border border-[#3083FF]/30">
                        <Check size={18} className="text-emerald-500" />
                    </div>
                    <p className="text-2xl font-bold text-[#3083FF]">{classes.filter(c => c.type === 'reguler').length}</p>
                    <p className="text-xs text-slate-500">Utama</p>
                </div>
                <div className="bg-white rounded-lg border border-[#3083FF]/30 text-center px-4 py-3">
                    <div className="w-10 h-10 mx-auto mb-2 rounded-lg flex items-center justify-center bg-[#3083FF]/10 border border-[#3083FF]/30">
                        <School size={18} className="text-amber-500" />
                    </div>
                    <p className="text-2xl font-bold text-[#3083FF]">{classes.filter(c => c.type === 'tambahan').length}</p>
                    <p className="text-xs text-slate-500">Tambahan</p>
                </div>
                <div className="bg-white rounded-lg border border-[#3083FF]/30 text-center px-4 py-3">
                    <div className="w-10 h-10 mx-auto mb-2 rounded-lg flex items-center justify-center bg-[#3083FF]/10 border border-[#3083FF]/30">
                        <CalendarDays size={18} className="text-violet-500" />
                    </div>
                    <p className="text-2xl font-bold text-[#3083FF]">{yearOptions.length}</p>
                    <p className="text-xs text-slate-500">Thn Ajaran</p>
                </div>
            </div>

            {/* FilterToolbar Bersama */}
            <div className="mb-6">
                <FilterToolbar actionsInline>
                    <FilterSearch
                        value={searchQuery}
                        onChange={setSearchQuery}
                        placeholder="Cari kelas..."
                        label="Cari Kelas"
                    />

                    <FilterSelect
                        label="Tipe Kelas"
                        value={classTypeFilter}
                        onChange={val => setClassTypeFilter(val as typeof classTypeFilter)}
                        options={[
                            { value: 'all', label: 'Semua Tipe' },
                            { value: 'reguler', label: 'Utama' },
                            { value: 'tambahan', label: 'Tambahan' }
                        ]}
                    />

                    <FilterSelect
                        label="Tahun Ajaran"
                        value={yearFilter}
                        onChange={setYearFilter}
                        options={[
                            { value: 'all', label: 'Semua Tahun Ajaran' },
                            ...yearOptions.map(y => ({ value: y, label: y }))
                        ]}
                    />

                    <FilterActions>
                        <Button
                            variant="outline"
                            icon="import"
                            onClick={() => setIsImportModalOpen(true)}
                        >
                            Import
                        </Button>
                        <Button
                            variant="outline"
                            icon="export"
                            onClick={handleExport}
                        >
                            Export
                        </Button>
                        <Button
                            variant="primary"
                            icon="add"
                            onClick={() => {
                                setClassForm({ name: '', type: 'reguler', schoolYear: classForm.schoolYear || yearFilter });
                                setIsModalOpen(true);
                            }}
                        >
                            Buat Kelas
                        </Button>
                    </FilterActions>
                </FilterToolbar>
            </div>

            {/* List / Table */}
            {isLoading ? (
                <div className="flex justify-center py-16">
                    <Spinner variant="buble" size={32} />
                </div>
            ) : filtered.length === 0 ? (
                <div className="py-16 text-center bg-white border border-[#3083FF]/30 rounded-lg">
                    <School size={40} className="mx-auto mb-3 text-slate-300" />
                    <p className="text-slate-500 font-medium">Tidak ada kelas ditemukan</p>
                    <p className="text-sm text-slate-400 mt-1">Klik &quot;Buat Kelas&quot; untuk menambah kelas baru</p>
                </div>
            ) : (
                <>
                    {/* Desktop: Table */}
                    <div className="hidden lg:block bg-white border border-[#3083FF]/30 rounded-lg overflow-hidden shadow-sm">
                        <div className="overflow-x-auto">
                            <table className="classes-table w-full">
                                <thead>
                                    <tr className="border-b border-[#3083FF]/20 bg-[#3083FF]/5">
                                        <th className="text-left text-[10px] font-bold text-[#3083FF] uppercase tracking-wider px-6 py-4">Nama Kelas</th>
                                        <th className="text-left text-[10px] font-bold text-[#3083FF] uppercase tracking-wider px-6 py-4">Tahun Ajaran</th>
                                        <th className="text-left text-[10px] font-bold text-[#3083FF] uppercase tracking-wider px-6 py-4">Tipe</th>
                                        <th className="text-left text-[10px] font-bold text-[#3083FF] uppercase tracking-wider px-6 py-4">Kode</th>
                                        <th className="text-center text-[10px] font-bold text-[#3083FF] uppercase tracking-wider px-6 py-4">Siswa</th>
                                        <th className="text-right text-[10px] font-bold text-[#3083FF] uppercase tracking-wider px-6 py-4">Aksi</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-[#3083FF]/10">
                                    {filtered.map((cls) => (
                                        <tr key={cls.id} className="hover:bg-[#3083FF]/5 transition-colors group">
                                            <td className="px-6 py-4">
                                                <div className="flex flex-col">
                                                    <span className="font-semibold text-slate-800 text-sm">{cls.name}</span>
                                                    {cls.type === 'reguler' && cls.program && (
                                                        <span className="text-[10px] text-slate-500 mt-0.5 uppercase tracking-wider font-bold">Program: {cls.program}</span>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="px-6 py-4">
                                                <span className="text-sm text-slate-500">{cls.school_year || '—'}</span>
                                            </td>
                                            <td className="px-6 py-4">
                                                <span className={`classes-type inline-flex px-2.5 py-1 rounded-lg text-[10px] font-semibold uppercase tracking-wider ${
                                                    cls.type === 'reguler' ? 'bg-emerald-50 text-emerald-600 border border-emerald-200' : 'bg-[#3083FF]/10 text-[#3083FF] border border-[#3083FF]/30'
                                                }`}>
                                                    {cls.type === 'reguler' ? 'Utama' : 'Tambahan'}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4">
                                                <span className={`font-mono text-sm font-medium ${copiedCode === cls.join_code ? 'text-emerald-500' : 'text-slate-600'}`}>
                                                    {cls.join_code || '—'}
                                                    {copiedCode === cls.join_code && <Check size={11} className="inline ml-1 text-emerald-500" />}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 text-center">
                                                <button
                                                    onClick={() => handleViewStudents(cls)}
                                                    className="classes-student-count inline-flex items-center gap-1.5 text-sm font-semibold text-[#3083FF] bg-[#3083FF]/10 hover:bg-[#3083FF]/20 transition-all px-3 py-1 rounded-lg border border-[#3083FF]/20 cursor-pointer"
                                                >
                                                    <Users size={13} />
                                                    {cls.studentCount || 0}
                                                </button>
                                            </td>
                                            <td className="px-6 py-4">
                                                <div className="flex items-center justify-end gap-1.5">
                                                    {cls.canEdit !== false && (
                                                        <Button
                                                            size="sm"
                                                            variant="edit"
                                                            icon="edit"
                                                            onClick={() => openEditModal(cls)}
                                                            title="Edit Kelas"
                                                        />
                                                    )}
                                                    {cls.type !== 'reguler' && (
                                                        <Button
                                                            size="sm"
                                                            variant="outline"
                                                            onClick={() => handleCopyCode(cls.join_code)}
                                                            title="Salin Kode Gabung"
                                                            leftIcon={copiedCode === cls.join_code ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
                                                        />
                                                    )}
                                                    {cls.canDelete !== false && (
                                                        <Button
                                                            size="sm"
                                                            variant="danger"
                                                            icon="delete"
                                                            onClick={() => setDeleteClassTarget(cls)}
                                                            title="Hapus Kelas"
                                                        />
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* Mobile: Card Grid */}
                    <div className="lg:hidden space-y-4">
                        {Object.entries(classesByYear).map(([year, yearClasses]) => (
                            <div key={year}>
                                <div className="flex items-center gap-2 mb-3">
                                    <Bookmark size={14} className="text-[#3083FF]" />
                                    <h3 className="text-sm font-semibold text-slate-600 uppercase tracking-wider">{year}</h3>
                                    <span className="text-xs text-slate-400 bg-[#3083FF]/10 px-2 py-0.5 rounded-lg border border-[#3083FF]/30">{yearClasses.length} kelas</span>
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                    {yearClasses.map((cls, i) => (
                                        <motion.div
                                            key={cls.id}
                                            initial={{ opacity: 0, y: 12 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            transition={{ delay: i * 0.05 }}
                                            className="bg-white border border-[#3083FF]/30 rounded-lg p-4 hover:shadow-md transition-all"
                                        >
                                            <div className="flex items-start justify-between mb-2">
                                                <span className={`text-[10px] font-bold uppercase tracking-wider ${cls.type === 'reguler' ? 'text-emerald-600 dark:text-emerald-400' : 'text-[#3083FF] dark:text-blue-400'}`}>
                                                    {cls.type === 'reguler' ? 'Utama' : 'Tambahan'}
                                                </span>
                                                <div className="flex items-center gap-1">
                                                    {cls.canEdit !== false && (
                                                        <Button size="sm" variant="edit" icon="edit" onClick={() => openEditModal(cls)} />
                                                    )}
                                                    {cls.type !== 'reguler' && (
                                                        <Button size="sm" variant="outline" onClick={() => handleCopyCode(cls.join_code)} leftIcon={<Copy size={13} />} />
                                                    )}
                                                    {cls.canDelete !== false && (
                                                        <Button size="sm" variant="danger" icon="delete" onClick={() => setDeleteClassTarget(cls)} />
                                                    )}
                                                </div>
                                            </div>
                                            <div className="flex flex-col mb-2">
                                                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 leading-snug">{cls.name}</h3>
                                                {cls.type === 'reguler' && cls.program && (
                                                    <span className="text-[10px] text-slate-500 uppercase font-medium tracking-wider mt-0.5">Program: {cls.program}</span>
                                                )}
                                            </div>
                                            <div className="flex items-center justify-between">
                                                <span className="text-xs text-slate-400">Kode: <span className={`font-mono font-medium ${copiedCode === cls.join_code ? 'text-emerald-500' : 'text-slate-600'}`}>{cls.join_code || '—'}</span></span>
                                                <button
                                                    onClick={() => handleViewStudents(cls)}
                                                    className="text-xs font-medium text-[#3083FF] bg-[#3083FF]/10 hover:bg-[#3083FF]/20 transition-all px-2 py-1 rounded-lg border border-[#3083FF]/20 cursor-pointer"
                                                >
                                                    <Users size={10} className="inline mr-1" />{cls.studentCount || 0} siswa
                                                </button>
                                            </div>
                                        </motion.div>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                </>
            )}

            {/* Modal Buat Kelas */}
            <Modal
                open={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                size="md"
                variant="add"
                labelledBy="modal-create-class"
            >
                <ModalHeader
                    id="modal-create-class"
                    icon="plus-lg"
                    title="Buat Kelas Baru"
                    subtitle="Tambah kelas baru untuk sekolah"
                    onClose={() => setIsModalOpen(false)}
                />
                <form onSubmit={handleCreateClass}>
                    <ModalBody>
                        <ModalField label="Nama Kelas" required>
                            <input
                                required
                                type="text"
                                placeholder="Contoh: X IPA 1"
                                value={classForm.name}
                                onChange={e => setClassForm({ ...classForm, name: e.target.value })}
                            />
                        </ModalField>

                        <ModalField label="Tahun Ajaran" required>
                            <select
                                value={classForm.schoolYear}
                                onChange={e => setClassForm({ ...classForm, schoolYear: e.target.value })}
                            >
                                {yearOptions.map(y => (
                                    <option key={y} value={y}>{y}</option>
                                ))}
                            </select>
                        </ModalField>

                        <ModalField label="Tipe Kelas" required>
                            <select
                                value={classForm.type}
                                onChange={e => setClassForm({ ...classForm, type: e.target.value as typeof classForm.type })}
                            >
                                <option value="reguler">Reguler (Utama)</option>
                                <option value="tambahan">Tambahan</option>
                            </select>
                        </ModalField>
                    </ModalBody>
                    <ModalFooter>
                        <Button type="button" variant="cancel" onClick={() => setIsModalOpen(false)} disabled={isSubmitting} icon="cancel">
                            Batal
                        </Button>
                        <Button type="submit" variant="primary" isLoading={isSubmitting} icon="save">
                            Buat Kelas
                        </Button>
                    </ModalFooter>
                </form>
            </Modal>

            {/* Modal Edit Kelas */}
            <Modal
                open={isEditModalOpen}
                onClose={() => setIsEditModalOpen(false)}
                size="md"
                variant="edit"
                labelledBy="modal-edit-class"
            >
                <ModalHeader
                    id="modal-edit-class"
                    icon="pencil-square"
                    title="Edit Kelas"
                    subtitle="Ubah detail informasi kelas"
                    onClose={() => setIsEditModalOpen(false)}
                />
                <form onSubmit={handleEditClass}>
                    <ModalBody>
                        <ModalField label="Nama Kelas" required>
                            <input
                                required
                                type="text"
                                placeholder="Contoh: X IPA 1"
                                value={classForm.name}
                                onChange={e => setClassForm({ ...classForm, name: e.target.value })}
                            />
                        </ModalField>

                        <ModalField label="Tahun Ajaran" required>
                            <select
                                value={classForm.schoolYear}
                                onChange={e => setClassForm({ ...classForm, schoolYear: e.target.value })}
                            >
                                {yearOptions.map(y => (
                                    <option key={y} value={y}>{y}</option>
                                ))}
                            </select>
                        </ModalField>

                        <ModalField label="Tipe Kelas" required>
                            <select
                                value={classForm.type}
                                onChange={e => setClassForm({ ...classForm, type: e.target.value as typeof classForm.type })}
                            >
                                <option value="reguler">Reguler (Utama)</option>
                                <option value="tambahan">Tambahan</option>
                            </select>
                        </ModalField>
                    </ModalBody>
                    <ModalFooter>
                        <Button type="button" variant="cancel" onClick={() => setIsEditModalOpen(false)} disabled={isSubmitting} icon="cancel">
                            Batal
                        </Button>
                        <Button type="submit" variant="primary" isLoading={isSubmitting} icon="save">
                            Simpan Perubahan
                        </Button>
                    </ModalFooter>
                </form>
            </Modal>

            {/* Modal Import Kelas */}
            <Modal
                open={isImportModalOpen}
                onClose={() => setIsImportModalOpen(false)}
                size="md"
                variant="default"
                labelledBy="modal-import-class"
            >
                <ModalHeader
                    id="modal-import-class"
                    icon="file-earmark-excel"
                    title="Import Kelas"
                    subtitle="Upload file Excel (.xlsx, .xls) untuk import data kelas"
                    onClose={() => setIsImportModalOpen(false)}
                />
                <ModalBody>
                    <ModalField label="Pilih Berkas Excel" hint="Format kolom yang didukung: Nama Kelas, Tipe, Tahun Ajaran">
                        <input
                            type="file"
                            accept=".xlsx, .xls"
                            disabled={isSubmitting}
                            onChange={async (e) => {
                                const file = e.target.files?.[0];
                                if (file) await handleImportFile(file);
                            }}
                        />
                    </ModalField>
                </ModalBody>
                <ModalFooter>
                    <Button variant="cancel" onClick={() => setIsImportModalOpen(false)} disabled={isSubmitting} icon="cancel">
                        Tutup
                    </Button>
                </ModalFooter>
            </Modal>

            {/* Modal Daftar Siswa */}
            <Modal
                open={isStudentModalOpen && !!selectedClassForStudents}
                onClose={() => setIsStudentModalOpen(false)}
                size="lg"
                variant="default"
                labelledBy="modal-students-title"
            >
                <ModalHeader
                    id="modal-students-title"
                    icon="people"
                    title="Daftar Siswa"
                    subtitle={`Kelas: ${selectedClassForStudents?.name || ''}`}
                    onClose={() => setIsStudentModalOpen(false)}
                />
                <ModalBody>
                    {isLoadingStudents ? (
                        <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                            <Spinner variant="buble" size={28} />
                            <p className="text-sm mt-3">Memuat data siswa...</p>
                        </div>
                    ) : classStudents.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                            <Users size={36} className="mb-2 opacity-30 text-[#3083FF]" />
                            <p className="text-sm font-medium">Belum ada siswa di kelas ini.</p>
                        </div>
                    ) : (
                        <ul className="space-y-1.5 max-h-[50vh] overflow-y-auto pr-1">
                            {classStudents.map((s, idx) => (
                                <li key={s.id} className="flex items-center justify-between p-3 bg-white border border-slate-200 rounded-xl hover:border-[#3083FF]/40 transition-colors">
                                    <div className="flex items-center gap-3">
                                        <div className="w-8 h-8 rounded-full bg-[#3083FF]/10 text-[#3083FF] flex items-center justify-center font-bold text-xs">
                                            {idx + 1}
                                        </div>
                                        <div className="flex flex-col">
                                            <span className="text-sm font-semibold text-slate-800">{s.name}</span>
                                            <span className="text-xs text-slate-500">NISN: <span className="font-mono">{s.identity_number || '-'}</span></span>
                                        </div>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    )}
                </ModalBody>
                <ModalFooter>
                    <Button variant="cancel" onClick={() => setIsStudentModalOpen(false)} icon="cancel">
                        Tutup
                    </Button>
                </ModalFooter>
            </Modal>

            {/* Modal Hapus Kelas */}
            {deleteClassTarget && (
                <Modal
                    open={!!deleteClassTarget}
                    onClose={() => setDeleteClassTarget(null)}
                    size="sm"
                    variant="delete"
                    labelledBy="modal-delete-class"
                >
                    <ModalHeader
                        id="modal-delete-class"
                        icon="trash3"
                        title={`Hapus Kelas "${deleteClassTarget.name}"?`}
                        subtitle="Semua data terkait kelas ini akan ikut terhapus. Tindakan ini tidak dapat dibatalkan."
                        onClose={() => setDeleteClassTarget(null)}
                    />
                    <ModalFooter>
                        <Button
                            type="button"
                            variant="cancel"
                            onClick={() => setDeleteClassTarget(null)}
                            disabled={isSubmitting}
                            icon="cancel"
                        >
                            Batal
                        </Button>
                        <Button
                            type="button"
                            variant="danger"
                            onClick={confirmDeleteClass}
                            isLoading={isSubmitting}
                            icon="delete"
                        >
                            Ya, Hapus
                        </Button>
                    </ModalFooter>
                </Modal>
            )}
        </div>
    );
}
