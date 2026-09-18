"use client";
import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import {
    School, Search, Plus, Trash2, X, Loader2, Check,
    Copy, Users, ChevronRight, CalendarDays, Bookmark, Pencil, Upload, Download
} from 'lucide-react';
import { getProctorOrganization, listOrganizationClasses, createClassAction, editClassAction, deleteClassAction, listOrganizationSchoolYears, importClassesAction, getStudentsByClassAction } from '@/lib/api/proctor';
import { getSessionUser } from '@/lib/session';
import { useMemoryState } from '@/lib/useMemoryState';

const currentYear = new Date().getFullYear();
const generateYearOptions = (): string[] => {
    const years: string[] = [];
    for (let y = currentYear + 1; y >= currentYear - 5; y--) {
        years.push(`${y}/${y + 1}`);
    }
    return years;
};

export default function SettingsClassesPage() {
    const [classes, setClasses] = useMemoryState<any[]>('proktor_settings_classes_classes', []);
    const [org, setOrg] = useState<any>(null);
    const [isLoading, setIsLoading] = useMemoryState('proktor_settings_classes_isLoading', true);
    const [searchQuery, setSearchQuery] = useState('');
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [isImportModalOpen, setIsImportModalOpen] = useState(false);
    const [editingClass, setEditingClass] = useState<any>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [classForm, setClassForm] = useState({
        name: '',
        type: 'reguler' as 'reguler' | 'tambahan',
        schoolYear: ''
    });
    const [classTypeFilter, setClassTypeFilter] = useState<'all' | 'reguler' | 'tambahan'>('all');
    const [yearFilter, setYearFilter] = useState<string>('all');
    const [copiedCode, setCopiedCode] = useState<string | null>(null);

    const [isStudentModalOpen, setIsStudentModalOpen] = useState(false);
    const [selectedClassForStudents, setSelectedClassForStudents] = useState<any>(null);
    const [classStudents, setClassStudents] = useState<any[]>([]);
    const [isLoadingStudents, setIsLoadingStudents] = useState(false);

    const handleViewStudents = async (cls: any) => {
        setSelectedClassForStudents(cls);
        setIsStudentModalOpen(true);
        setIsLoadingStudents(true);
        const students = await getStudentsByClassAction(cls.id, cls.type === 'tambahan');
        setClassStudents(students);
        setIsLoadingStudents(false);
    };

    useEffect(() => { loadData();
        // Auto-injected smart sync (Window Focus)
        const handleFocus = () => { if (typeof loadData === 'function') loadData(); };
        window.addEventListener('focus', handleFocus);
        return () => window.removeEventListener('focus', handleFocus); }, []);

    const loadData = async () => {
        // setIsLoading(true); // Disabled for silent background sync
        const user = await getSessionUser();
        if (user) {
            const organization = await getProctorOrganization();
            if (organization) {
                setOrg(organization);
                const [classList, yearList] = await Promise.all([
                    listOrganizationClasses(organization.id),
                    listOrganizationSchoolYears(organization.id),
                ]);
                setClasses(classList || []);
                setYearOptions(yearList);
                // Set default year to current school year
                const defaultYear = `${currentYear}/${currentYear + 1}`;
                if (!classForm.schoolYear) {
                    setClassForm(prev => ({ ...prev, schoolYear: defaultYear }));
                }
            }
        }
        setIsLoading(false);
    };

    const [yearOptions, setYearOptions] = useState<string[]>(generateYearOptions());

    const handleCreateClass = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!org) return;
        setIsSubmitting(true);
        const result = await createClassAction(
            org.id,
            classForm.name,
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

    const handleDeleteClass = async (classId: string) => {
        if (!confirm('Yakin ingin menghapus kelas ini? Semua data terkait akan ikut terhapus.')) return;
        setIsSubmitting(true);
        const result = await deleteClassAction(classId);
        if (result.success) {
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

    const openEditModal = (cls: any) => {
        setEditingClass(cls);
        setClassForm({ name: cls.name, type: cls.type, schoolYear: cls.school_year || '' });
        setIsEditModalOpen(true);
    };

    const handleCopyCode = (code: string) => {
        navigator.clipboard.writeText(code);
        setCopiedCode(code);
        setTimeout(() => setCopiedCode(null), 2000);
    };

    const filtered = React.useMemo(() => {
        return classes.filter(cls => {
            const matchSearch = cls.name?.toLowerCase().includes(searchQuery.toLowerCase());
            const matchType = classTypeFilter === 'all' || cls.type === classTypeFilter;
            const matchYear = yearFilter === 'all' || cls.school_year === yearFilter;
            return matchSearch && matchType && matchYear;
        });
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

    // Group classes by school year for display
    const classesByYear = React.useMemo(() => {
        return filtered.reduce((acc, cls) => {
            const year = cls.school_year || 'Tanpa Tahun Ajaran';
            if (!acc[year]) acc[year] = [];
            acc[year].push(cls);
            return acc;
        }, {} as Record<string, any[]>);
    }, [filtered]);

    return (
        <div className="max-w-7xl mx-auto pb-20">
            {/* Header — Navy gradient */}
            <div className="relative overflow-hidden rounded-lg acca-hero-gradient mb-6 shadow-xl shadow-[#0038A8]/20">
                {/* Decorative blobs */}
                <div className="absolute -top-12 -right-12 w-72 h-72 bg-[#0038A8]/10 rounded-full blur-3xl" />
                <div className="absolute -bottom-12 -left-12 w-56 h-56 bg-white/5 rounded-full blur-2xl" />

                <div className="relative px-8 py-4 flex flex-col md:flex-row md:items-center md:justify-between">
                    <div>
                        <h1 className="text-2xl font-bold text-white mb-1">Kelola Kelas</h1>
                        <p className="text-white text-sm font-semibold flex items-center gap-2">
                            
                            {org?.name || 'Memuat...'}
                        </p>
                    </div>
                    <Link href="/dashboard/admin" className="mt-4 md:mt-0">
                        <button className="px-4 py-2 bg-white/10 border border-white/20 text-white rounded-lg hover:bg-white/20 flex items-center gap-2 text-sm font-medium transition-all">
                            <ChevronRight size={16} className="rotate-180" /> Kembali
                        </button>
                    </Link>
                </div>
            </div>

            {/* Stats Cards - Outside Banner */}
            <div className="grid grid-cols-4 gap-x-2 mb-6">
                <div className="bg-white rounded-lg border border-[#030C4D]/30 text-center px-4 py-3">
                    <div className="w-10 h-10 mx-auto mb-2 rounded-lg flex items-center justify-center bg-[#030C4D]/10 border border-[#030C4D]/30">
                        <School size={18} className="text-[#030C4D]" />
                    </div>
                    <p className="text-2xl font-bold text-[#0038A8]">{classes.length}</p>
                    <p className="text-xs text-slate-500">Total</p>
                </div>
                <div className="bg-white rounded-lg border border-[#030C4D]/30 text-center px-4 py-3">
                    <div className="w-10 h-10 mx-auto mb-2 rounded-lg flex items-center justify-center bg-[#030C4D]/10 border border-[#030C4D]/30">
                        <Check size={18} className="text-emerald-500" />
                    </div>
                    <p className="text-2xl font-bold text-[#0038A8]">{classes.filter(c => c.type === 'reguler').length}</p>
                    <p className="text-xs text-slate-500">Utama</p>
                </div>
                <div className="bg-white rounded-lg border border-[#030C4D]/30 text-center px-4 py-3">
                    <div className="w-10 h-10 mx-auto mb-2 rounded-lg flex items-center justify-center bg-[#030C4D]/10 border border-[#030C4D]/30">
                        <School size={18} className="text-amber-500" />
                    </div>
                    <p className="text-2xl font-bold text-[#0038A8]">{classes.filter(c => c.type === 'tambahan').length}</p>
                    <p className="text-xs text-slate-500">Tambahan</p>
                </div>
                <div className="bg-white rounded-lg border border-[#030C4D]/30 text-center px-4 py-3">
                    <div className="w-10 h-10 mx-auto mb-2 rounded-lg flex items-center justify-center bg-[#030C4D]/10 border border-[#030C4D]/30">
                        <CalendarDays size={18} className="text-violet-500" />
                    </div>
                    <p className="text-2xl font-bold text-[#0038A8]">{yearOptions.length}</p>
                    <p className="text-xs text-slate-500">Thn Ajaran</p>
                </div>
            </div>

            {/* Actions Row */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
                {/* Filter + Search */}
                <div className="flex flex-col sm:flex-row gap-3 flex-wrap">
                    <div className="flex gap-1 p-1 bg-white border border-[#030C4D]/30 rounded-lg">
                        {(['all', 'reguler', 'tambahan'] as const).map(type => (
                            <button key={type} onClick={() => setClassTypeFilter(type)}
                                className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
                                    classTypeFilter === type ? 'bg-[#030C4D] text-white shadow-sm' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'
                                }`}>
                                {type === 'all' ? 'Semua' : type === 'reguler' ? 'Utama' : 'Tambahan'}
                            </button>
                        ))}
                    </div>
                    <select
                        value={yearFilter}
                        onChange={e => setYearFilter(e.target.value)}
                        className="bg-white border border-[#030C4D]/30 rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-[#0038A8]/20 outline-none"
                    >
                        <option value="all">Semua Tahun Ajaran</option>
                        {yearOptions.map(y => (
                            <option key={y} value={y}>{y}</option>
                        ))}
                    </select>
                </div>

                <div className="flex gap-2">
                    <button onClick={handleExport} className="px-4 py-2 text-sm bg-white border border-[#030C4D]/30 text-slate-700 rounded-lg hover:bg-slate-50 flex items-center gap-2 transition-all">
                        <Download size={16} /> Export
                    </button>
                    <button onClick={() => setIsImportModalOpen(true)} className="px-4 py-2 text-sm bg-white border border-[#030C4D]/30 text-slate-700 rounded-lg hover:bg-slate-50 flex items-center gap-2 transition-all">
                        <Upload size={16} /> Import
                    </button>
                    <button
                        onClick={() => setIsModalOpen(true)}
                        className="px-4 py-2.5 bg-[#0038A8] text-white rounded-lg hover:bg-[#0038A8] flex items-center gap-2 text-sm font-semibold shadow-lg shadow-[#0038A8]/20 transition-all"
                    >
                        <Plus size={16} /> Buat Kelas
                    </button>
                </div>
            </div>

            {/* Search */}
            <div className="relative mb-6">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                <input
                    type="text"
                    placeholder="Cari kelas..."
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    className="w-full bg-white border border-[#030C4D]/30 rounded-lg py-3 pl-10 pr-4 text-sm focus:ring-2 focus:ring-[#0038A8]/20 focus:border-[#0038A8] outline-none"
                />
            </div>

            {/* Grid grouped by year — Mobile */}
            {isLoading ? (
                <div className="flex justify-center py-16">
                    <div className="w-8 h-8 border-3 border-[#030C4D]/20 border-t-[#030C4D] rounded-full animate-spin" />
                </div>
            ) : filtered.length === 0 ? (
                <div className="py-16 text-center bg-white border border-[#030C4D]/30 rounded-lg">
                    <School size={40} className="mx-auto mb-3 text-slate-300" />
                    <p className="text-slate-500 font-medium">Tidak ada kelas ditemukan</p>
                    <p className="text-sm text-slate-400 mt-1">Klik "Buat Kelas" untuk menambah kelas baru</p>
                </div>
            ) : (
                <>
                    {/* Desktop: Table */}
                    <div className="hidden lg:block bg-white border border-[#030C4D]/30 rounded-lg overflow-hidden shadow-sm">
                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead>
                                    <tr className="border-b border-[#030C4D]/20 bg-[#030C4D]/5">
                                        <th className="text-left text-[10px] font-bold text-[#030C4D] uppercase tracking-wider px-6 py-4">Nama Kelas</th>
                                        <th className="text-left text-[10px] font-bold text-[#030C4D] uppercase tracking-wider px-6 py-4">Tahun Ajaran</th>
                                        <th className="text-left text-[10px] font-bold text-[#030C4D] uppercase tracking-wider px-6 py-4">Tipe</th>
                                        <th className="text-left text-[10px] font-bold text-[#030C4D] uppercase tracking-wider px-6 py-4">Kode</th>
                                        <th className="text-center text-[10px] font-bold text-[#030C4D] uppercase tracking-wider px-6 py-4">Siswa</th>
                                        <th className="text-right text-[10px] font-bold text-[#030C4D] uppercase tracking-wider px-6 py-4">Aksi</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-[#030C4D]/10">
                                    {filtered.map((cls, i) => (
                                        <tr key={cls.id} className="hover:bg-[#030C4D]/5 transition-colors group">
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
                                                <span className={`inline-flex px-2.5 py-1 rounded-lg text-[10px] font-semibold uppercase tracking-wider ${
                                                    cls.type === 'reguler' ? 'bg-emerald-50 text-emerald-600 border border-emerald-200' : 'bg-[#0038A8]/10 text-[#0038A8] border border-[#030C4D]/30'
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
                                                <button onClick={() => handleViewStudents(cls)} className="inline-flex items-center gap-1 text-sm font-semibold text-[#030C4D] bg-[#030C4D]/10 hover:bg-[#030C4D]/20 transition-all px-3 py-1 rounded-lg border border-[#030C4D]/20 cursor-pointer">
                                                    <Users size={12} />
                                                    {cls.studentCount || 0}
                                                </button>
                                            </td>
                                            <td className="px-6 py-4">
                                                <div className="flex items-center justify-end gap-1">
                                                    {cls.canEdit !== false && (
                                                        <button onClick={() => openEditModal(cls)} className="p-2 text-slate-400 hover:text-[#030C4D] hover:bg-[#030C4D]/10 rounded-lg transition-all border border-transparent hover:border-[#030C4D]/30" title="Edit">
                                                            <Pencil size={14} />
                                                        </button>
                                                    )}
                                                    {cls.type !== 'reguler' && (
                                                        <button onClick={() => handleCopyCode(cls.join_code)} className="p-2 text-slate-400 hover:text-[#030C4D] hover:bg-[#030C4D]/10 rounded-lg transition-all border border-transparent hover:border-[#030C4D]/30" title="Salin kode">
                                                            <Copy size={14} />
                                                        </button>
                                                    )}
                                                    {cls.canDelete !== false && (
                                                        <button onClick={() => handleDeleteClass(cls.id)} className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all border border-transparent hover:border-red-200" title="Hapus">
                                                            <Trash2 size={14} />
                                                        </button>
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
                                    <Bookmark size={14} className="text-[#030C4D]" />
                                    <h3 className="text-sm font-semibold text-slate-600 uppercase tracking-wider">{year}</h3>
                                    <span className="text-xs text-slate-400 bg-[#0038A8]/10 px-2 py-0.5 rounded-lg border border-[#030C4D]/30">{(yearClasses as any[]).length} kelas</span>
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                    {(yearClasses as any[]).map((cls: any, i: number) => (
                                        <motion.div
                                            key={cls.id}
                                            initial={{ opacity: 0, y: 12 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            transition={{ delay: i * 0.05 }}
                                            className="bg-white border border-[#030C4D]/30 rounded-lg p-4 hover:shadow-md transition-all"
                                        >
                                            <div className="flex items-start justify-between mb-3">
                                                <span className={`px-3 py-1 rounded-lg text-xs font-semibold uppercase tracking-wider ${cls.type === 'reguler' ? 'bg-emerald-50 text-emerald-600 border border-emerald-200' : 'bg-[#0038A8]/10 text-[#0038A8] border border-[#030C4D]/30'}`}>
                                                    {cls.type === 'reguler' ? 'Utama' : 'Tambahan'}
                                                </span>
                                                <div className="flex items-center gap-1">
                                                    {cls.canEdit !== false && <button onClick={() => openEditModal(cls)} className="p-1.5 text-slate-400 hover:text-[#030C4D] hover:bg-[#030C4D]/10 rounded-lg transition-all"><Pencil size={13} /></button>}
                                                    {cls.type !== 'reguler' && <button onClick={() => handleCopyCode(cls.join_code)} className="p-1.5 text-slate-400 hover:text-[#030C4D] hover:bg-[#030C4D]/10 rounded-lg transition-all"><Copy size={13} /></button>}
                                                    {cls.canDelete !== false && <button onClick={() => handleDeleteClass(cls.id)} className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"><Trash2 size={13} /></button>}
                                                </div>
                                            </div>
                                            <div className="flex flex-col mb-2">
                                                <h3 className="text-base font-semibold text-slate-900">{cls.name}</h3>
                                                {cls.type === 'reguler' && cls.program && (
                                                    <span className="text-[11px] text-slate-500 uppercase font-bold tracking-wider">Program: {cls.program}</span>
                                                )}
                                            </div>
                                            <div className="flex items-center justify-between">
                                                <span className="text-xs text-slate-400">Kode: <span className={`font-mono font-medium ${copiedCode === cls.join_code ? 'text-emerald-500' : 'text-slate-600'}`}>{cls.join_code || '—'}</span></span>
                                                <button onClick={() => handleViewStudents(cls)} className="text-xs font-medium text-[#030C4D] bg-[#030C4D]/10 hover:bg-[#030C4D]/20 transition-all px-2 py-1 rounded-lg border border-[#030C4D]/20 cursor-pointer"><Users size={10} className="inline mr-1" />{cls.studentCount || 0} siswa</button>
                                            </div>
                                        </motion.div>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                </>
            )}

            {/* Create Modal */}
            <AnimatePresence>
                {isModalOpen && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
                        <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} className="bg-white w-full max-w-md rounded-2xl p-6 relative border border-[#030C4D]/30">
                            <button onClick={() => setIsModalOpen(false)} className="absolute top-4 right-4 text-slate-400 hover:text-slate-600">
                                <X size={20} />
                            </button>
                            {/* Header */}
                            <div className="flex items-center gap-3 mb-6 pb-4 border-b border-[#030C4D]/20">
                                <div className="w-10 h-10 rounded-lg bg-[#030C4D]/10 text-[#030C4D] flex items-center justify-center border border-[#030C4D]/30">
                                    <School size={18} />
                                </div>
                                <div>
                                    <h3 className="text-lg font-bold text-slate-900">Buat Kelas Baru</h3>
                                    <p className="text-xs text-slate-500">Tambah kelas baru untuk organisasi</p>
                                </div>
                            </div>
                            <form onSubmit={handleCreateClass} className="space-y-4">
                                <div>
                                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">Nama Kelas <span className="text-red-500">*</span></label>
                                    <input
                                        required
                                        type="text"
                                        placeholder="Contoh: X IPA 1"
                                        value={classForm.name}
                                        onChange={e => setClassForm({ ...classForm, name: e.target.value })}
                                        className="w-full border border-[#030C4D]/30 rounded-xl p-3 text-sm focus:ring-2 focus:ring-[#0038A8]/20 focus:border-[#0038A8]/50 outline-none"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">Tahun Ajaran <span className="text-red-500">*</span></label>
                                    <select
                                        value={classForm.schoolYear}
                                        onChange={e => setClassForm({ ...classForm, schoolYear: e.target.value })}
                                        className="w-full border border-[#030C4D]/30 rounded-xl p-3 text-sm focus:ring-2 focus:ring-[#0038A8]/20 outline-none"
                                    >
                                        {yearOptions.map(y => (
                                            <option key={y} value={y}>{y}</option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">Tipe Kelas <span className="text-red-500">*</span></label>
                                    <select
                                        value={classForm.type}
                                        onChange={e => setClassForm({ ...classForm, type: e.target.value as any })}
                                        className="w-full border border-[#030C4D]/30 rounded-xl p-3 text-sm focus:ring-2 focus:ring-[#0038A8]/20 outline-none"
                                    >
                                        <option value="reguler">Reguler</option>
                                        <option value="tambahan">Tambahan</option>
                                    </select>
                                </div>
                                <button type="submit" disabled={isSubmitting}
                                    className="w-full py-3 bg-[#030C4D] text-white rounded-xl font-semibold flex items-center justify-center gap-2 disabled:opacity-50 hover:bg-[#030C4D]/90 transition-colors">
                                    {isSubmitting ? <Loader2 size={18} className="animate-spin" /> : <Check size={18} />}
                                    Buat Kelas
                                </button>
                            </form>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>

            {/* Edit Modal */}
            <AnimatePresence>
                {isEditModalOpen && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
                        <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} className="bg-white w-full max-w-md rounded-2xl p-6 relative border border-[#030C4D]/30">
                            <button onClick={() => setIsEditModalOpen(false)} className="absolute top-4 right-4 text-slate-400 hover:text-slate-600">
                                <X size={20} />
                            </button>
                            {/* Header */}
                            <div className="flex items-center gap-3 mb-6 pb-4 border-b border-[#030C4D]/20">
                                <div className="w-10 h-10 rounded-lg bg-[#030C4D]/10 text-[#030C4D] flex items-center justify-center border border-[#030C4D]/30">
                                    <Pencil size={18} />
                                </div>
                                <div>
                                    <h3 className="text-lg font-bold text-slate-900">Edit Kelas</h3>
                                    <p className="text-xs text-slate-500">Ubah detail kelas</p>
                                </div>
                            </div>
                            <form onSubmit={handleEditClass} className="space-y-4">
                                <div>
                                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">Nama Kelas <span className="text-red-500">*</span></label>
                                    <input
                                        required
                                        type="text"
                                        placeholder="Contoh: X IPA 1"
                                        value={classForm.name}
                                        onChange={e => setClassForm({ ...classForm, name: e.target.value })}
                                        className="w-full border border-[#030C4D]/30 rounded-xl p-3 text-sm focus:ring-2 focus:ring-[#0038A8]/20 focus:border-[#0038A8]/50 outline-none"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">Tahun Ajaran <span className="text-red-500">*</span></label>
                                    <select
                                        value={classForm.schoolYear}
                                        onChange={e => setClassForm({ ...classForm, schoolYear: e.target.value })}
                                        className="w-full border border-[#030C4D]/30 rounded-xl p-3 text-sm focus:ring-2 focus:ring-[#0038A8]/20 outline-none"
                                    >
                                        {yearOptions.map(y => (
                                            <option key={y} value={y}>{y}</option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">Tipe Kelas <span className="text-red-500">*</span></label>
                                    <select
                                        value={classForm.type}
                                        onChange={e => setClassForm({ ...classForm, type: e.target.value as any })}
                                        className="w-full border border-[#030C4D]/30 rounded-xl p-3 text-sm focus:ring-2 focus:ring-[#0038A8]/20 outline-none"
                                    >
                                        <option value="reguler">Reguler</option>
                                        <option value="tambahan">Tambahan</option>
                                    </select>
                                </div>
                                <button type="submit" disabled={isSubmitting}
                                    className="w-full py-3 bg-[#030C4D] text-white rounded-xl font-semibold flex items-center justify-center gap-2 disabled:opacity-50 hover:bg-[#030C4D]/90 transition-colors">
                                    {isSubmitting ? <Loader2 size={18} className="animate-spin" /> : <Check size={18} />}
                                    Simpan Perubahan
                                </button>
                            </form>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>

            {/* Import Modal */}
            <AnimatePresence>
                {isImportModalOpen && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
                        <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} className="bg-white w-full max-w-md rounded-2xl p-6 relative border border-[#030C4D]/30">
                            <button onClick={() => setIsImportModalOpen(false)} className="absolute top-4 right-4 text-slate-400 hover:text-slate-600">
                                <X size={20} />
                            </button>
                            <div className="flex items-center gap-3 mb-6 pb-4 border-b border-[#030C4D]/20">
                                <div className="w-10 h-10 rounded-lg bg-[#030C4D]/10 text-[#030C4D] flex items-center justify-center border border-[#030C4D]/30">
                                    <Upload size={18} />
                                </div>
                                <div>
                                    <h3 className="text-lg font-bold text-slate-900">Import Kelas</h3>
                                    <p className="text-xs text-slate-500">Upload file Excel (.xlsx)</p>
                                </div>
                            </div>
                            <input type="file" accept=".xlsx, .xls"
                                onChange={async (e) => {
                                    const file = e.target.files?.[0];
                                    if (!file || !org) return;
                                    const XLSX = await import('xlsx');
                                    const reader = new FileReader();
                                    reader.onload = async (event) => {
                                        const data = new Uint8Array(event.target?.result as ArrayBuffer);
                                        const workbook = XLSX.read(data, { type: 'array' });
                                        const worksheet = workbook.Sheets[workbook.SheetNames[0]];
                                        const jsonData = XLSX.utils.sheet_to_json(worksheet) as any[];
                                        const formattedData = jsonData.map(row => ({
                                            name: String(row['Nama Kelas'] || row.name || '').trim(),
                                            type: String(row['Tipe'] || row.type || 'reguler').toLowerCase().trim() as 'reguler' | 'tambahan',
                                            schoolYear: String(row['Tahun Ajaran'] || row.schoolYear || '').trim() || undefined
                                        })).filter(r => r.name);
                                        if (formattedData.length === 0) { alert('Tidak ada data valid ditemukan.'); return; }
                                        setIsSubmitting(true);
                                        await importClassesAction(org.id, formattedData);
                                        setIsImportModalOpen(false);
                                        await loadData();
                                        setIsSubmitting(false);
                                    };
                                    reader.readAsArrayBuffer(file);
                                }}
                                className="w-full border border-slate-200 rounded-xl p-3 text-sm file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-[#030C4D] file:text-white file:text-sm file:font-medium hover:file:bg-[#030C4D]/90 cursor-pointer"
                            />
                            <p className="text-xs text-slate-400 mt-2">Format: Nama Kelas, Tipe, Tahun Ajaran</p>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>

            {/* Student Modal */}
            <AnimatePresence>
                {isStudentModalOpen && selectedClassForStudents && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
                        <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} className="bg-white w-full max-w-lg rounded-2xl p-6 relative border border-[#030C4D]/30 max-h-[85vh] flex flex-col">
                            <button onClick={() => setIsStudentModalOpen(false)} className="absolute top-4 right-4 text-slate-400 hover:text-slate-600">
                                <X size={20} />
                            </button>
                            <div className="mb-4">
                                <h3 className="text-lg font-bold text-slate-900">Daftar Siswa</h3>
                                <p className="text-sm text-slate-500">Kelas: <span className="font-semibold text-[#030C4D]">{selectedClassForStudents.name}</span></p>
                            </div>
                            
                            <div className="flex-1 overflow-y-auto min-h-[200px] border border-slate-100 rounded-xl bg-slate-50/50 p-2">
                                {isLoadingStudents ? (
                                    <div className="flex flex-col items-center justify-center h-full text-slate-400">
                                        <Loader2 size={24} className="animate-spin mb-2 text-[#030C4D]" />
                                        <p className="text-sm">Memuat data siswa...</p>
                                    </div>
                                ) : classStudents.length === 0 ? (
                                    <div className="flex flex-col items-center justify-center h-full text-slate-400">
                                        <Users size={32} className="mb-2 opacity-20" />
                                        <p className="text-sm">Belum ada siswa di kelas ini.</p>
                                    </div>
                                ) : (
                                    <ul className="space-y-1">
                                        {classStudents.map((s, idx) => (
                                            <li key={s.id} className="flex items-center justify-between p-3 bg-white border border-slate-100 rounded-lg hover:border-[#030C4D]/20 transition-colors">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-8 h-8 rounded-full bg-[#030C4D]/10 flex items-center justify-center text-[#030C4D] font-bold text-xs">
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
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>
        </div>
    );
}