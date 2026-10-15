'use client';

import React, { useEffect, useEffectEvent, useMemo, useState } from 'react';
import {
    Globe,
    Loader2,
    Search,
    UserCheck,
    Users,
    X,
} from 'lucide-react';
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { formatStudentName } from '@/lib/monitoring-health';
import { currentRegularClasses } from '@/lib/exam-class-selection';
import type {
    ClassStudent,
    OrganizationClass,
    OrganizationExam,
} from '@/lib/api/proctor';
import {
    assignExamAction,
    listExamAssignmentsAction,
    listClassStudents,
    getActiveSchoolYear,
} from '@/lib/api/proctor';

export interface AssignExamModalProps {
    isOpen: boolean;
    onClose: () => void;
    exam?: OrganizationExam | null;
    classes: OrganizationClass[];
    classStudents?: Record<string, ClassStudent[]>;
    onSuccess?: () => Promise<void> | void;
    initialSelectedClassIds?: string[];
    initialClassAssignments?: Record<string, { mode: 'all' | 'selected'; studentIds: string[] }>;
    examTitle?: string;
    onSaveAssignments?: (
        selectedClassIds: string[],
        classAssignments: Record<string, { mode: 'all' | 'selected'; studentIds: string[] }>
    ) => void;
    overlayClassName?: string;
}

interface SelectedStudentItem {
    studentId: string;
    studentName: string;
    studentEmail?: string;
    classId: string;
    className: string;
    isCustom: boolean;
}

export const AssignExamModal: React.FC<AssignExamModalProps> = ({
    isOpen,
    onClose,
    exam,
    classes,
    classStudents = {},
    onSuccess,
    initialSelectedClassIds,
    initialClassAssignments,
    examTitle,
    onSaveAssignments,
    overlayClassName = '',
}) => {
    const [isLoadingExisting, setIsLoadingExisting] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [activeSchoolYear, setActiveSchoolYear] = useState<string | null>(null);
    const [loadingSchoolYear, setLoadingSchoolYear] = useState(true);
    const regularClasses = useMemo(() => currentRegularClasses(classes, activeSchoolYear), [classes, activeSchoolYear]);
    useEffect(() => {
        if (!isOpen) return;
        let alive = true;
        void Promise.resolve().then(() => {
            if (!alive) return null;
            setActiveSchoolYear(null);
            setLoadingSchoolYear(true);
            return getActiveSchoolYear();
        }).then(year => {
            if (alive) { setActiveSchoolYear(year?.year || null); setLoadingSchoolYear(false); }
        }).catch(() => { if (alive) { setActiveSchoolYear(null); setLoadingSchoolYear(false); } });
        return () => { alive = false; };
    }, [isOpen]);
    const [selectedClassIds, setSelectedClassIds] = useState<string[]>([]);
    const [classAssignments, setClassAssignments] = useState<
        Record<string, { mode: 'all' | 'selected'; studentIds: string[] }>
    >({});
    const [activeClassId, setActiveClassId] = useState<string | null>(null);
    const [localClassStudents, setLocalClassStudents] = useState<Record<string, ClassStudent[]>>({});
    const availableClassStudents = useMemo(
        () => ({ ...classStudents, ...localClassStudents }),
        [classStudents, localClassStudents],
    );

    // Muat siswa kelas jika belum tersedia
    useEffect(() => {
        if (!isOpen) return;
        const missingIds = classes
            .map((c) => c.id)
            .filter((id) => !Object.prototype.hasOwnProperty.call(availableClassStudents, id));
        if (missingIds.length > 0) {
            listClassStudents(missingIds)
                .then((res) => {
                    setLocalClassStudents((prev) => ({ ...prev, ...res }));
                })
                .catch((err) => {
                    console.error('Failed to load class students in AssignExamModal:', err);
                });
        }
    }, [isOpen, classes, availableClassStudents]);

    // Right panel view: 'class_detail' | 'all_selected'
    const [rightView, setRightView] = useState<'class_detail' | 'all_selected'>('class_detail');

    // Search filters
    const [searchClass, setSearchClass] = useState('');
    const [searchStudent, setSearchStudent] = useState('');
    const [searchAllSelected, setSearchAllSelected] = useState('');
    const [error, setError] = useState<string | null>(null);

    // Read the latest initial values only when starting a modal session. Parent
    // refreshes and inline callbacks must not overwrite the user's current draft.
    const initializeAssignments = useEffectEvent(() => {
        let isMounted = true;
        const initializeId = window.setTimeout(() => {
            if (!isOpen) {
                setSelectedClassIds([]);
                setClassAssignments({});
                setActiveClassId(null);
                setSearchClass('');
                setSearchStudent('');
                setSearchAllSelected('');
                setError(null);
                setRightView('class_detail');
                return;
            }

            // Mode pemilih in-memory (misal dipanggil dari CreateExamModal)
            if (onSaveAssignments) {
                const initIds = initialSelectedClassIds ? [...initialSelectedClassIds] : [];
                const defaults: Record<string, { mode: 'all' | 'selected'; studentIds: string[] }> = {};

                for (const cls of classes) {
                    if (initialClassAssignments && initialClassAssignments[cls.id]) {
                        defaults[cls.id] = initialClassAssignments[cls.id];
                    } else {
                        defaults[cls.id] = { mode: 'all', studentIds: [] };
                    }
                }

                setSelectedClassIds(initIds);
                setClassAssignments(defaults);
                if (initIds.length > 0) {
                    setActiveClassId(initIds[0]);
                } else if (classes.length > 0) {
                    setActiveClassId(classes[0].id);
                }
                setIsLoadingExisting(false);
                setError(null);
                return;
            }

            // Mode penugasan langsung untuk ujian yang sudah ada di database
            if (!exam) {
                setSelectedClassIds([]);
                setClassAssignments({});
                return;
            }

            setIsLoadingExisting(false);
            setError(null);
            if (exam.metadata?.is_public) return;

            setIsLoadingExisting(true);
            listExamAssignmentsAction([exam.id])
            .then(({ targets, participants }) => {
                if (!isMounted) return;

                const existingClassIds = [
                    ...new Set([
                        ...targets.map((t) => t.class_id || t.additional_class_id),
                        ...participants.map((p) => p.class_id),
                    ].filter(Boolean) as string[]),
                ];

                const defaults: Record<string, { mode: 'all' | 'selected'; studentIds: string[] }> = {};
                for (const clsId of existingClassIds) {
                    const classParticipants = participants
                        .filter((p) => p.class_id === clsId)
                        .map((p) => p.user_id);
                    defaults[clsId] =
                        classParticipants.length > 0
                            ? { mode: 'selected', studentIds: classParticipants }
                            : { mode: 'all', studentIds: [] };
                }

                for (const cls of classes) {
                    if (!defaults[cls.id]) {
                        defaults[cls.id] = { mode: 'all', studentIds: [] };
                    }
                }

                setSelectedClassIds(existingClassIds);
                setClassAssignments(defaults);

                if (existingClassIds.length > 0) {
                    setActiveClassId(existingClassIds[0]);
                } else if (classes.length > 0) {
                    setActiveClassId(classes[0].id);
                }
            })
            .catch((err) => {
                if (!isMounted) return;
                console.error('Failed to load assignments', err);
                setError('Gagal memuat penugasan kelas yang sudah ada.');
            })
            .finally(() => {
                if (isMounted) setIsLoadingExisting(false);
            });
        }, 0);

        return () => {
            isMounted = false;
            window.clearTimeout(initializeId);
        };
    });

    const assignmentExamId = exam?.id;
    const isPickerMode = Boolean(onSaveAssignments);
    useEffect(() => {
        return initializeAssignments();
    }, [isOpen, assignmentExamId, isPickerMode]);

    // Active class helper
    const activeClass = useMemo(() => {
        return classes.find((c) => c.id === activeClassId) || classes[0] || null;
    }, [classes, activeClassId]);

    // Filtered classes list
    const filteredClasses = useMemo(() => {
        if (!searchClass.trim()) return classes;
        const q = searchClass.toLowerCase();
        return classes.filter((cls) => cls.name.toLowerCase().includes(q));
    }, [classes, searchClass]);

    // Active class students
    const activeStudents = useMemo(() => {
        if (!activeClass) return [];
        return availableClassStudents[activeClass.id] || [];
    }, [activeClass, availableClassStudents]);

    // Active assignment
    const activeAssignment = useMemo(() => {
        if (!activeClass) return { mode: 'all' as const, studentIds: [] };
        return classAssignments[activeClass.id] || { mode: 'all' as const, studentIds: [] };
    }, [activeClass, classAssignments]);

    // Filtered students for active class
    const filteredActiveStudents = useMemo(() => {
        if (!searchStudent.trim()) return activeStudents;
        const q = searchStudent.toLowerCase();
        return activeStudents.filter((s) => {
            const name = (s.full_name || s.name || '').toLowerCase();
            const email = (s.email || s.identity_number || '').toLowerCase();
            return name.includes(q) || email.includes(q);
        });
    }, [activeStudents, searchStudent]);

    // Consolidated list of ALL selected students with their class info
    const allSelectedStudents = useMemo<SelectedStudentItem[]>(() => {
        const list: SelectedStudentItem[] = [];
        for (const clsId of selectedClassIds) {
            const cls = classes.find((c) => c.id === clsId);
            const className = cls?.name || 'Kelas';
            const students = availableClassStudents[clsId] || [];
            const assignment = classAssignments[clsId] || { mode: 'all', studentIds: [] };

            if (assignment.mode === 'all') {
                for (const s of students) {
                    list.push({
                        studentId: s.id,
                        studentName: formatStudentName(s.full_name || s.name, 'Tanpa nama'),
                        studentEmail: s.email || s.identity_number || undefined,
                        classId: clsId,
                        className,
                        isCustom: false,
                    });
                }
            } else {
                for (const s of students) {
                    if (assignment.studentIds.includes(s.id)) {
                        list.push({
                            studentId: s.id,
                            studentName: formatStudentName(s.full_name || s.name, 'Tanpa nama'),
                            studentEmail: s.email || s.identity_number || undefined,
                            classId: clsId,
                            className,
                            isCustom: true,
                        });
                    }
                }
            }
        }
        return list;
    }, [selectedClassIds, classAssignments, classes, availableClassStudents]);

    // Filtered all selected students
    const filteredAllSelected = useMemo(() => {
        if (!searchAllSelected.trim()) return allSelectedStudents;
        const q = searchAllSelected.toLowerCase();
        return allSelectedStudents.filter(
            (s) =>
                s.studentName.toLowerCase().includes(q) ||
                s.className.toLowerCase().includes(q) ||
                (s.studentEmail && s.studentEmail.toLowerCase().includes(q))
        );
    }, [allSelectedStudents, searchAllSelected]);

    // Handlers
    const handleToggleClass = (classId: string) => {
        setSelectedClassIds((prev) => {
            const exists = prev.includes(classId);
            return exists ? prev.filter((id) => id !== classId) : [...prev, classId];
        });

        setClassAssignments((prev) => {
            if (!prev[classId]) {
                return { ...prev, [classId]: { mode: 'all', studentIds: [] } };
            }
            return prev;
        });

        setActiveClassId(classId);
        setRightView('class_detail');
    };

    const handleToggleAllClasses = () => {
            const allIds = regularClasses.map((c) => c.id);
            if (!activeSchoolYear || !allIds.length) return;
            setSelectedClassIds(allIds);
            setClassAssignments((prev) => {
                const next = { ...prev };
                for (const id of allIds) {
                    next[id] = { mode: 'all', studentIds: [] };
                }
                return next;
            });
            setActiveClassId(allIds[0]);
            setRightView('all_selected');
    };

    const handleSetClassMode = (classId: string, mode: 'all' | 'selected') => {
        if (!selectedClassIds.includes(classId)) {
            setSelectedClassIds((prev) => [...prev, classId]);
        }

        setClassAssignments((prev) => {
            const current = prev[classId] || { mode: 'all', studentIds: [] };
            return {
                ...prev,
                [classId]: {
                    ...current,
                    mode,
                    studentIds: mode === 'all' ? [] : current.studentIds,
                },
            };
        });
    };

    const handleToggleStudent = (classId: string, studentId: string) => {
        setClassAssignments((prev) => {
            const current = prev[classId] || { mode: 'selected', studentIds: [] };
            const exists = current.studentIds.includes(studentId);
            const newIds = exists
                ? current.studentIds.filter((id) => id !== studentId)
                : [...current.studentIds, studentId];

            return {
                ...prev,
                [classId]: {
                    ...current,
                    mode: 'selected',
                    studentIds: newIds,
                },
            };
        });
    };

    const handleSelectAllStudentsInClass = (classId: string) => {
        const students = availableClassStudents[classId] || [];
        setClassAssignments((prev) => ({
            ...prev,
            [classId]: {
                mode: 'selected',
                studentIds: students.map((s) => s.id),
            },
        }));
    };

    const handleClearAllStudentsInClass = (classId: string) => {
        setClassAssignments((prev) => ({
            ...prev,
            [classId]: {
                mode: 'selected',
                studentIds: [],
            },
        }));
    };

    const handleRemoveSelectedStudent = (classId: string, studentId: string) => {
        const assignment = classAssignments[classId];
        if (assignment && assignment.mode === 'selected') {
            handleToggleStudent(classId, studentId);
        } else {
            const students = availableClassStudents[classId] || [];
            const remaining = students.filter((s) => s.id !== studentId).map((s) => s.id);
            setClassAssignments((prev) => ({
                ...prev,
                [classId]: {
                    mode: 'selected',
                    studentIds: remaining,
                },
            }));
        }
    };

    const handleSubmit = async () => {
        if (onSaveAssignments) {
            onSaveAssignments(selectedClassIds, classAssignments);
            onClose();
            return;
        }

        if (!exam) return;
        setIsSubmitting(true);
        setError(null);

        const targetClassIds: string[] = [];
        const participantAssignments: { userId: string; classId: string }[] = [];

        for (const clsId of selectedClassIds) {
            const assignment = classAssignments[clsId] || { mode: 'all', studentIds: [] };
            if (assignment.mode === 'all') {
                targetClassIds.push(clsId);
            } else {
                participantAssignments.push(
                    ...assignment.studentIds.map((userId) => ({
                        userId,
                        classId: clsId,
                    }))
                );
            }
        }

        const activate = !exam.is_published;
        const result = await assignExamAction(
            exam.id,
            targetClassIds,
            participantAssignments,
            activate
        );

        setIsSubmitting(false);

        if (result.success) {
            if (onSuccess) await onSuccess();
            onClose();
        } else {
            setError(result.error || 'Gagal menyimpan penugasan kelas.');
        }
    };

    if (!isOpen) return null;

    return (
        <Modal
            open={isOpen}
            onClose={onClose}
            size="xl"
            variant="default"
            icon={<Users size={18} />}
            title={
                <span className="flex items-center gap-2 flex-wrap">
                    <span>Tetapkan Peserta Ujian</span>
                    {(examTitle || exam?.title) && (
                        <span className="text-[11px] font-medium text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md truncate max-w-[260px]">
                            {examTitle || exam?.title}
                        </span>
                    )}
                </span>
            }
            className="md:h-[620px] max-h-[92vh] flex flex-col"
            overlayClassName={overlayClassName}
        >
            {/* ─── Modal Body with 2-Column Split Master-Detail ─── */}
            <ModalBody
                style={{ padding: 0, gap: 0, overflow: 'hidden' }}
                className="flex-1 flex flex-col min-h-0"
            >
                {exam?.metadata?.is_public ? (
                    <div className="flex-1 flex flex-col items-center justify-center p-8 text-center my-auto">
                        <div className="w-14 h-14 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center mb-3 border border-emerald-200">
                            <Globe size={28} />
                        </div>
                        <h4 className="font-bold text-slate-900 text-base mb-1">
                            Ujian Umum (Publik)
                        </h4>
                        <p className="text-xs text-slate-500 max-w-sm mb-6">
                            Ujian ini terbuka secara otomatis untuk seluruh siswa aktif di sekolah ini.
                        </p>
                        <Button type="button" variant="cancel" onClick={onClose}>
                            Tutup
                        </Button>
                    </div>
                ) : isLoadingExisting ? (
                    <div className="flex-1 flex flex-col items-center justify-center text-slate-400 gap-2">
                        <Loader2 size={24} className="animate-spin text-[#3083FF]" />
                        <p className="text-xs font-medium text-slate-500">Memuat data penugasan...</p>
                    </div>
                ) : (
                    <div className="flex-1 grid grid-cols-1 md:grid-cols-12 min-h-0 overflow-hidden divide-y md:divide-y-0 md:divide-x divide-slate-100">
                        {/* ─── LEFT: Classes Master List (Col 5) ───────────── */}
                        <div className="md:col-span-5 flex flex-col min-h-0 bg-slate-50/40 p-4">
                            <div className="flex items-center justify-between mb-2 px-0.5">
                                <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                                    Pilih Kelas ({classes.length})
                                </span>
                                <button
                                    type="button"
                                    onClick={handleToggleAllClasses}
                                    disabled={loadingSchoolYear || !regularClasses.length}
                                    title="Pilih semua siswa dari kelas reguler tahun ajaran aktif"
                                    className="text-[11px] font-semibold text-[#3083FF] hover:underline disabled:opacity-40 disabled:cursor-not-allowed"
                                >
                                    Semua siswa
                                </button>
                                {selectedClassIds.length > 0 && <button type="button" onClick={() => setSelectedClassIds([])} className="text-[11px] text-slate-500 hover:underline">Kosongkan</button>}
                            </div>
                            <p className="mb-2 text-[11px] text-slate-500">{loadingSchoolYear ? 'Memuat tahun ajaran aktif...' : activeSchoolYear ? `Semua siswa: kelas reguler ${activeSchoolYear}` : 'Tahun ajaran aktif belum tersedia; pilih kelas satu per satu.'}</p>
                            <p className="mb-2 text-[11px] text-slate-500">Centang untuk memilih kelas. Klik kartu untuk melihat siswa.</p>

                            {/* Class Search */}
                            <div className="relative mb-2.5">
                                <Search
                                    size={13}
                                    className="absolute left-2.5 top-2.5 text-slate-400"
                                />
                                <input
                                    type="text"
                                    value={searchClass}
                                    onChange={(e) => setSearchClass(e.target.value)}
                                    placeholder="Cari kelas..."
                                    className="w-full text-xs pl-8 pr-3 py-1.5 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-[#3083FF] placeholder:text-slate-400"
                                />
                            </div>

                            {/* Classes Scroll Area */}
                            <div className="flex-1 overflow-y-auto space-y-1.5 pr-0.5 min-h-0">
                                {filteredClasses.length === 0 ? (
                                    <div className="text-center py-8 text-slate-400 text-xs">
                                        Tidak ada kelas ditemukan
                                    </div>
                                ) : (
                                    filteredClasses.map((cls) => {
                                        const isSelected = selectedClassIds.includes(cls.id);
                                        const isActive =
                                            rightView === 'class_detail' && activeClass?.id === cls.id;
                                        const students = classStudents[cls.id] || [];
                                        const assignment = classAssignments[cls.id] || {
                                            mode: 'all',
                                            studentIds: [],
                                        };
                                        const selectedCount =
                                            assignment.mode === 'all'
                                                ? students.length
                                                : assignment.studentIds.length;

                                        return (
                                            <div
                                                key={cls.id}
                                                onClick={() => {
                                                    setActiveClassId(cls.id);
                                                    setRightView('class_detail');
                                                }}
                                                className={`p-2.5 rounded-xl border transition-all cursor-pointer flex items-center justify-between gap-2 ${
                                                    isSelected
                                                        ? 'border-[#3083FF] bg-blue-50/60 shadow-xs ring-1 ring-[#3083FF]/20'
                                                        : isActive
                                                        ? 'border-slate-400 bg-slate-50'
                                                        : 'border-slate-200/80 bg-white hover:border-slate-300 opacity-70 hover:opacity-100'
                                                }`}
                                            >
                                                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                                                    <label onClick={(e) => e.stopPropagation()} className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg hover:bg-blue-100/60">
                                                    <input
                                                        type="checkbox"
                                                        checked={isSelected}
                                                        aria-label={`Pilih kelas ${cls.name}`}
                                                        onClick={(e) => e.stopPropagation()}
                                                        onChange={(e) => {
                                                            e.stopPropagation();
                                                            handleToggleClass(cls.id);
                                                        }}
                                                        className="w-4 h-4 rounded border-slate-300 text-[#3083FF] shrink-0 focus:ring-0 cursor-pointer"
                                                    />
                                                    </label>
                                                    <div className="min-w-0 flex-1">
                                                        <p
                                                            className={`text-xs font-semibold truncate ${
                                                                isSelected
                                                                    ? 'text-[#3083FF]'
                                                                    : 'text-slate-800'
                                                            }`}
                                                        >
                                                            {cls.name}
                                                        </p>
                                                        <p className="text-[10px] text-slate-400">
                                                            {students.length} siswa
                                                        </p>
                                                    </div>
                                                </div>

                                                {/* Status Badge */}
                                                <div className="shrink-0">
                                                    {isSelected ? (
                                                        assignment.mode === 'all' ? (
                                                            <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-md">
                                                                Semua ({students.length})
                                                            </span>
                                                        ) : (
                                                            <span className="text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-md">
                                                                {selectedCount} Siswa
                                                            </span>
                                                        )
                                                    ) : (
                                                        <span className="text-[10px] text-slate-300">
                                                            —
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })
                                )}
                            </div>

                            {/* Quick Switch to View All Selected Students */}
                            <div className="pt-2 mt-2 border-t border-slate-200/70">
                                <button
                                    type="button"
                                    onClick={() => setRightView('all_selected')}
                                    className={`w-full py-2 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-between border ${
                                        rightView === 'all_selected'
                                            ? 'bg-[#3083FF] text-white border-[#3083FF] shadow-xs'
                                            : 'bg-white text-slate-700 border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                                    }`}
                                >
                                    <div className="flex items-center gap-2">
                                        <Users size={14} />
                                        <span>Lihat Siswa Terpilih</span>
                                    </div>
                                    <span
                                        className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full ${
                                            rightView === 'all_selected'
                                                ? 'bg-white/20 text-white'
                                                : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                        }`}
                                    >
                                        {allSelectedStudents.length}
                                    </span>
                                </button>
                            </div>
                        </div>

                        {/* ─── RIGHT: Students Panel (Col 7) ───────────────── */}
                        <div className="md:col-span-7 flex flex-col min-h-0 bg-white p-4">
                            {rightView === 'all_selected' ? (
                                /* ── VIEW: ALL SELECTED STUDENTS ACROSS ALL CLASSES ── */
                                <div className="flex flex-col h-full min-h-0">
                                    <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                                        <h4 className="text-sm font-bold text-slate-900">
                                            Daftar Siswa Terpilih
                                        </h4>
                                        <span className="text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-lg">
                                            {allSelectedStudents.length} Siswa
                                        </span>
                                    </div>

                                    {/* Search Filter */}
                                    <div className="relative my-3">
                                        <Search
                                            size={13}
                                            className="absolute left-2.5 top-2.5 text-slate-400"
                                        />
                                        <input
                                            type="text"
                                            value={searchAllSelected}
                                            onChange={(e) => setSearchAllSelected(e.target.value)}
                                            placeholder="Cari siswa atau kelas..."
                                            className="w-full text-xs pl-8 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-[#3083FF] focus:bg-white placeholder:text-slate-400"
                                        />
                                    </div>

                                    {/* Selected Students List with Class Badges */}
                                    <div className="flex-1 overflow-y-auto space-y-1.5 pr-0.5 min-h-0">
                                        {filteredAllSelected.length === 0 ? (
                                            <div className="text-center py-12 text-slate-400">
                                                <Users size={28} className="mx-auto mb-2 text-slate-300" />
                                                <p className="text-xs font-medium text-slate-500">
                                                    Belum ada siswa terpilih.
                                                </p>
                                                <p className="text-[11px] text-slate-400 mt-0.5">
                                                    Centang kelas di kolom kiri untuk menambahkan peserta.
                                                </p>
                                            </div>
                                        ) : (
                                            filteredAllSelected.map((item) => (
                                                <div
                                                    key={`${item.classId}-${item.studentId}`}
                                                    className="flex items-center justify-between p-2.5 rounded-xl border border-slate-200/80 bg-white hover:border-slate-300 transition-all"
                                                >
                                                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                                                        <div className="w-7 h-7 rounded-full bg-slate-100 text-slate-600 text-[11px] font-bold flex items-center justify-center shrink-0 uppercase border border-slate-200">
                                                            {item.studentName.charAt(0) || 'S'}
                                                        </div>
                                                        <div className="min-w-0 flex-1">
                                                            <p className="text-xs font-medium text-slate-800 truncate">
                                                                {item.studentName}
                                                            </p>
                                                            {item.studentEmail && (
                                                                <p className="text-[10px] text-slate-400 truncate">
                                                                    {item.studentEmail}
                                                                </p>
                                                            )}
                                                        </div>
                                                    </div>

                                                    {/* Class Badge & Mode */}
                                                    <div className="flex items-center gap-2 shrink-0">
                                                        <span className="text-[11px] font-bold text-blue-700 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-md">
                                                            {item.className}
                                                        </span>
                                                        {item.isCustom && (
                                                            <span className="text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-md">
                                                                Susulan
                                                            </span>
                                                        )}
                                                        <button
                                                            type="button"
                                                            onClick={() =>
                                                                handleRemoveSelectedStudent(
                                                                    item.classId,
                                                                    item.studentId
                                                                )
                                                            }
                                                            className="text-slate-300 hover:text-red-500 p-1 transition-colors"
                                                            title="Hapus dari daftar ujian"
                                                        >
                                                            <X size={14} />
                                                        </button>
                                                    </div>
                                                </div>
                                            ))
                                        )}
                                    </div>
                                </div>
                            ) : activeClass ? (
                                /* ── VIEW: CLASS DETAIL & STUDENT SELECTION ────────── */
                                <div className="flex flex-col h-full min-h-0">
                                    {!selectedClassIds.includes(activeClass.id) && <p className="mb-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">Pratinjau siswa. Kelas ini belum dipilih sebagai peserta ujian.</p>}
                                    {/* Class Detail Header */}
                                    <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                                        <div className="flex items-center gap-2 min-w-0">
                                            <h4 className="text-sm font-bold text-slate-800 truncate">
                                                {activeClass.name.toLowerCase().startsWith('kelas ')
                                                    ? activeClass.name
                                                    : `Kelas ${activeClass.name}`}
                                            </h4>
                                            <span className="text-[11px] font-semibold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md shrink-0">
                                                {activeStudents.length} Siswa
                                            </span>
                                        </div>

                                        {/* Minimalist Mode Toggle */}
                                        <div className="inline-flex p-0.5 bg-slate-100 rounded-lg border border-slate-200/80 shrink-0">
                                            <button
                                                type="button"
                                                onClick={() =>
                                                    handleSetClassMode(activeClass.id, 'all')
                                                }
                                                className={`px-2.5 py-1 text-xs font-bold rounded-md transition-all flex items-center gap-1 ${
                                                    activeAssignment.mode === 'all'
                                                        ? 'bg-white text-slate-900 shadow-xs'
                                                    : 'text-slate-500 hover:text-slate-900'
                                                }`}
                                            >
                                                <UserCheck size={12} />
                                                <span>Semua di kelas ini</span>
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() =>
                                                    handleSetClassMode(activeClass.id, 'selected')
                                                }
                                                className={`px-2.5 py-1 text-xs font-bold rounded-md transition-all flex items-center gap-1 ${
                                                    activeAssignment.mode === 'selected'
                                                        ? 'bg-white text-slate-900 shadow-xs'
                                                        : 'text-slate-500 hover:text-slate-900'
                                                }`}
                                            >
                                                <Users size={12} />
                                                <span>Pilih Tertentu</span>
                                            </button>
                                        </div>
                                    </div>

                                    {/* Mode: ALL STUDENTS */}
                                    {activeAssignment.mode === 'all' ? (
                                        <div className="flex-1 flex flex-col min-h-0 mt-3 overflow-hidden">
                                            <div className="flex-1 overflow-y-auto space-y-1.5 pr-0.5 min-h-0">
                                                {activeStudents.length === 0 ? (
                                                    <div className="text-center py-8 text-slate-400 text-xs">
                                                        Belum ada siswa terdaftar di kelas ini.
                                                    </div>
                                                ) : (
                                                    activeStudents.map((student) => {
                                                        const name = formatStudentName(
                                                            student.full_name || student.name,
                                                            'Tanpa nama',
                                                        );
                                                        const emailOrId =
                                                            student.email || student.identity_number || '';
                                                        return (
                                                            <div
                                                                key={student.id}
                                                                className="flex items-center justify-between p-2 rounded-xl border border-slate-200/80 bg-slate-50/50"
                                                            >
                                                                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                                                                    <div className={`w-6 h-6 rounded-full text-[10px] font-bold flex items-center justify-center shrink-0 ${selectedClassIds.includes(activeClass.id) ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-400'}`}>
                                                                        {selectedClassIds.includes(activeClass.id) ? '✓' : '•'}
                                                                    </div>
                                                                    <div className="min-w-0 flex-1">
                                                                        <p className="text-xs font-medium text-slate-800 truncate">
                                                                            {name}
                                                                        </p>
                                                                        {emailOrId && (
                                                                            <p className="text-[10px] text-slate-400 truncate">
                                                                                {emailOrId}
                                                                            </p>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        );
                                                    })
                                                )}
                                            </div>
                                        </div>
                                    ) : (
                                        /* Mode: CUSTOM STUDENTS */
                                        <div className="flex-1 flex flex-col min-h-0 mt-3 overflow-hidden">
                                            {/* Student Search & Quick Select */}
                                            <div className="flex items-center gap-2 mb-2">
                                                <div className="relative flex-1">
                                                    <Search
                                                        size={13}
                                                        className="absolute left-2.5 top-2.5 text-slate-400"
                                                    />
                                                    <input
                                                        type="text"
                                                        value={searchStudent}
                                                        onChange={(e) => setSearchStudent(e.target.value)}
                                                        placeholder="Cari siswa di kelas ini..."
                                                        className="w-full text-xs pl-8 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-[#3083FF] focus:bg-white placeholder:text-slate-400"
                                                    />
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() =>
                                                        handleSelectAllStudentsInClass(activeClass.id)
                                                    }
                                                    className="px-2.5 py-1.5 text-[11px] font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition-colors shrink-0"
                                                >
                                                    Pilih Semua
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() =>
                                                        handleClearAllStudentsInClass(activeClass.id)
                                                    }
                                                    className="px-2.5 py-1.5 text-[11px] font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition-colors shrink-0"
                                                >
                                                    Kosongkan
                                                </button>
                                            </div>

                                            <div className="flex items-center justify-end text-[11px] mb-1.5 px-0.5">
                                                <span className="font-semibold text-[#3083FF] bg-blue-50 px-2 py-0.5 rounded-md border border-blue-200">
                                                    {activeAssignment.studentIds.length} dari {activeStudents.length} siswa dipilih
                                                </span>
                                            </div>

                                            {/* Students Checklist */}
                                            <div className="flex-1 overflow-y-auto space-y-1.5 pr-0.5 min-h-0">
                                                {filteredActiveStudents.length === 0 ? (
                                                    <div className="text-center py-8 text-slate-400 text-xs">
                                                        Tidak ada siswa yang cocok.
                                                    </div>
                                                ) : (
                                                    filteredActiveStudents.map((student) => {
                                                        const isChecked =
                                                            activeAssignment.studentIds.includes(
                                                                student.id
                                                            );
                                                        const name = formatStudentName(
                                                            student.full_name || student.name,
                                                            'Tanpa nama',
                                                        );
                                                        const emailOrId =
                                                            student.email ||
                                                            student.identity_number ||
                                                            '';

                                                        return (
                                                            <label
                                                                key={student.id}
                                                                className={`flex items-center justify-between p-2 rounded-xl border transition-all cursor-pointer ${
                                                                    isChecked
                                                                        ? 'bg-blue-50/70 border-blue-200 shadow-xs'
                                                                        : 'bg-slate-50/40 border-slate-200/80 hover:bg-slate-100/60'
                                                                }`}
                                                            >
                                                                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                                                                    <input
                                                                        type="checkbox"
                                                                        checked={isChecked}
                                                                        onChange={() =>
                                                                            handleToggleStudent(
                                                                                activeClass.id,
                                                                                student.id
                                                                            )
                                                                        }
                                                                        className="w-4 h-4 rounded border-slate-300 text-[#3083FF] shrink-0 focus:ring-0 cursor-pointer"
                                                                    />
                                                                    <div className="w-6 h-6 rounded-full bg-slate-200 text-slate-600 text-[10px] font-bold flex items-center justify-center shrink-0 uppercase">
                                                                        {name.charAt(0) || 'S'}
                                                                    </div>
                                                                    <div className="min-w-0 flex-1">
                                                                        <p
                                                                            className={`text-xs font-semibold truncate ${
                                                                                isChecked
                                                                                    ? 'text-blue-950'
                                                                                    : 'text-slate-800'
                                                                            }`}
                                                                        >
                                                                            {name}
                                                                        </p>
                                                                        {emailOrId && (
                                                                            <p className="text-[10px] text-slate-400 truncate">
                                                                                {emailOrId}
                                                                            </p>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                            </label>
                                                        );
                                                    })
                                                )}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <div className="flex-1 flex flex-col items-center justify-center text-center p-8 text-slate-400">
                                    <p className="text-xs font-semibold text-slate-600">
                                        Pilih kelas di sebelah kiri
                                    </p>
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </ModalBody>

            {/* ─── Standard Modal Footer ──────────────────────────── */}
            {!exam?.metadata?.is_public && (
                <ModalFooter align="between">
                    <div className="flex items-center gap-2">
                        <span
                            className={`w-2 h-2 rounded-full shrink-0 ${
                                allSelectedStudents.length > 0
                                    ? 'bg-emerald-500'
                                    : 'bg-amber-400'
                            }`}
                        />
                        <span className="text-xs text-slate-600 font-medium">
                            <strong className="text-slate-900">
                                {selectedClassIds.length} Kelas
                            </strong>{' '}
                            &bull;{' '}
                            <strong className="text-emerald-700">
                                {allSelectedStudents.length} Siswa Terpilih
                            </strong>
                        </span>
                        {error && (
                            <span className="text-xs text-red-600 font-medium ml-2">
                                {error}
                            </span>
                        )}
                    </div>

                    <div className="flex items-center gap-2">
                        <Button
                            type="button"
                            variant="cancel"
                            onClick={onClose}
                            disabled={isSubmitting}
                        >
                            Batal
                        </Button>
                        <Button
                            type="button"
                            variant="primary"
                            onClick={handleSubmit}
                            disabled={isSubmitting || isLoadingExisting || (!onSaveAssignments && selectedClassIds.length === 0)}
                            isLoading={isSubmitting}
                            icon={onSaveAssignments ? 'check' : 'save'}
                        >
                            {onSaveAssignments ? 'Terapkan Peserta' : 'Tetapkan Ujian'}
                        </Button>
                    </div>
                </ModalFooter>
            )}
        </Modal>
    );
};
