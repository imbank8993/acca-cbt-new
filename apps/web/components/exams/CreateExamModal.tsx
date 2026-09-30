'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
    AlertCircle,
    FileText,
    Globe,
    Loader2,
    Plus,
    Settings,
    Users,
} from 'lucide-react';
import { Modal, ModalBody, ModalFooter, ModalField } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { InlineSelect } from '@/components/ui/InlineSelect';
import { MultiSelect } from '@/components/ui/MultiSelect';
import { DateTimePicker } from '@/components/ui/DateTimePicker';
import { AssignExamModal } from './AssignExamModal';
import {
    createExamAction,
    editExamAction,
    assignExamAction,
    listExamAssignmentsAction,
    listClassStudents,
} from '@/lib/api/proctor';
import type {
    ClassStudent,
    OrganizationClass,
    OrganizationExam,
    ProctorOrganization,
} from '@/lib/api/proctor';
import type { QuestionBank } from '@/lib/api/questions';
import { getSessionUser } from '@/lib/session';

export type ExamType = 'daily' | 'pas' | 'pat' | 'assignment' | 'lainnya';

export const SCORING_OPTIONS = [
    { value: 'classical', label: 'Penilaian Klasik', info: 'Nilai dihitung berdasarkan proporsi jawaban benar (0-100).' },
    { value: 'irt_1pl', label: 'IRT Rasch (1PL)', info: 'Mempertimbangkan tingkat kesukaran tiap butir soal.' },
    { value: 'irt_2pl', label: 'IRT 2PL (Bobot Kesukaran + Pembeda)', info: 'Mempertimbangkan daya beda dan tingkat kesukaran soal.' },
    { value: 'irt_3pl', label: 'IRT 3PL (Bobot Lengkap + Tebakan)', info: 'Mempertimbangkan daya beda, kesukaran, dan peluang tebakan semu.' }
];

export interface CreateExamModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSuccess: () => Promise<void> | void;
    exam?: OrganizationExam | null;
    questionBanks?: QuestionBank[];
    publishedBanks?: QuestionBank[];
    classes: OrganizationClass[];
    classStudents?: Record<string, ClassStudent[]>;
    role?: 'admin' | 'guru' | 'proktor';
    organization?: ProctorOrganization | null;
}

interface ExamFormData {
    title: string;
    description: string;
    examType: ExamType;
    duration: number | string;
    randomizeQuestions: boolean;
    randomizeOptions: boolean;
    showResults: boolean;
    isSafeMode: boolean;
    maxViolations: number | null;
    bankId: string;
    startTime: string;
    endTime: string;
    selectedClassIds: string[];
    classAssignments: Record<string, { mode: 'all' | 'selected'; studentIds: string[] }>;
    scoringTypes: string[];
    isForever: boolean;
    isPublic: boolean;
    documentUrl: string;
    videoUrl: string;
    assignmentDescription: string;
    allowFileUpload: boolean;
    allowedFileTypes: string[];
    requireBank: boolean;
}

const DEFAULT_FORM_DATA: ExamFormData = {
    title: '',
    description: '',
    examType: 'daily',
    duration: 60,
    randomizeQuestions: true,
    randomizeOptions: true,
    showResults: false,
    isSafeMode: true,
    maxViolations: 3,
    bankId: '',
    startTime: '',
    endTime: '',
    selectedClassIds: [],
    classAssignments: {},
    scoringTypes: ['classical'],
    isForever: false,
    isPublic: false,
    documentUrl: '',
    videoUrl: '',
    assignmentDescription: '',
    allowFileUpload: false,
    allowedFileTypes: ['pdf'],
    requireBank: true,
};

function utcToLocalDateTime(utcStr: string): string {
    if (!utcStr) return '';
    try {
        const d = new Date(utcStr);
        if (isNaN(d.getTime())) return '';
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        const hours = String(d.getHours()).padStart(2, '0');
        const minutes = String(d.getMinutes()).padStart(2, '0');
        return `${year}-${month}-${day}T${hours}:${minutes}`;
    } catch {
        return '';
    }
}

export const CreateExamModal: React.FC<CreateExamModalProps> = ({
    isOpen,
    onClose,
    onSuccess,
    exam,
    questionBanks,
    publishedBanks,
    classes,
    classStudents = {},
    role = 'admin',
}) => {
    const isEdit = Boolean(exam);

    const availableBanks = useMemo(() => {
        if (publishedBanks) return publishedBanks;
        return (questionBanks || []).filter((b) => b.is_published);
    }, [publishedBanks, questionBanks]);

    const [formData, setFormData] = useState<ExamFormData>(DEFAULT_FORM_DATA);
    const [localClassStudents, setLocalClassStudents] = useState<Record<string, ClassStudent[]>>(classStudents);
    const [isAssignPickerOpen, setIsAssignPickerOpen] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isLoadingAssignments, setIsLoadingAssignments] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Sync external classStudents prop if available
    useEffect(() => {
        if (!classStudents || Object.keys(classStudents).length === 0) return;
        const syncId = window.setTimeout(() => {
            setLocalClassStudents((prev) => ({ ...prev, ...classStudents }));
        }, 0);
        return () => window.clearTimeout(syncId);
    }, [classStudents]);

    // Inisialisasi data form saat modal dibuka
    useEffect(() => {
        if (!isOpen) return;
        let isMounted = true;
        const initializeId = window.setTimeout(() => {
          if (!isMounted) return;
          setError(null);
          setIsSubmitting(false);

          if (exam) {
            // MODE EDIT
            const isForever = !exam.start_time && !exam.end_time;
            const initFormData: ExamFormData = {
                title: exam.title || '',
                description: exam.description || '',
                examType: (exam.exam_type as ExamType) || 'daily',
                duration: exam.duration_minutes || 60,
                randomizeQuestions: exam.randomize_questions ?? true,
                randomizeOptions: exam.randomize_options ?? true,
                showResults: exam.show_results ?? false,
                isSafeMode: exam.metadata?.is_safe_mode ?? true,
                maxViolations: exam.metadata?.max_violations === null
                    ? null
                    : (typeof exam.metadata?.max_violations === 'number'
                        ? exam.metadata.max_violations
                        : 3),
                bankId: exam.question_bank_id || '',
                startTime: exam.start_time ? utcToLocalDateTime(exam.start_time) : '',
                endTime: exam.end_time ? utcToLocalDateTime(exam.end_time) : '',
                selectedClassIds: [],
                classAssignments: {},
                scoringTypes: exam.scoring_type ? exam.scoring_type.split(',') : ['classical'],
                isForever,
                isPublic: exam.metadata?.is_public ?? false,
                documentUrl: exam.metadata?.document_url || '',
                videoUrl: exam.metadata?.video_url || '',
                assignmentDescription: exam.metadata?.assignment_description || '',
                allowFileUpload: exam.metadata?.allow_file_upload ?? false,
                allowedFileTypes: exam.metadata?.allowed_file_types || ['pdf'],
                requireBank: exam.metadata?.require_bank ?? true,
            };
            setFormData(initFormData);

            // Muat penugasan yang sudah ada untuk ujian ini
            if (!exam.metadata?.is_public) {
                setIsLoadingAssignments(true);
                listExamAssignmentsAction([exam.id])
                    .then(({ targets, participants }) => {
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
                            if (classParticipants.length > 0) {
                                defaults[clsId] = { mode: 'selected', studentIds: classParticipants };
                            } else {
                                defaults[clsId] = { mode: 'all', studentIds: [] };
                            }
                        }

                        for (const cls of classes) {
                            if (!defaults[cls.id]) {
                                defaults[cls.id] = { mode: 'all', studentIds: [] };
                            }
                        }

                        setFormData((prev) => ({
                            ...prev,
                            selectedClassIds: existingClassIds,
                            classAssignments: defaults,
                        }));
                    })
                    .catch((err) => {
                        console.error('Gagal memuat penugasan kelas:', err);
                    })
                    .finally(() => {
                        setIsLoadingAssignments(false);
                    });
            }
          } else {
            // MODE BUAT BARU
            const defaultBankId = availableBanks[0]?.id || '';
            const defaults: Record<string, { mode: 'all' | 'selected'; studentIds: string[] }> = {};
            for (const cls of classes) {
                defaults[cls.id] = { mode: 'all', studentIds: [] };
            }
            setFormData({
                ...DEFAULT_FORM_DATA,
                bankId: defaultBankId,
                classAssignments: defaults,
            });
          }
        }, 0);
        return () => {
            isMounted = false;
            window.clearTimeout(initializeId);
        };
    }, [isOpen, exam, availableBanks, classes]);

    // Muat daftar siswa kelas terpilih jika belum tersedia
    useEffect(() => {
        if (!isOpen) return;
        const missingClassIds = formData.selectedClassIds.filter(
            (id) => !localClassStudents[id] || localClassStudents[id].length === 0
        );
        if (missingClassIds.length > 0) {
            listClassStudents(missingClassIds)
                .then((res) => {
                    setLocalClassStudents((prev) => ({ ...prev, ...res }));
                })
                .catch((err) => {
                    console.error('Gagal mengambil daftar siswa:', err);
                });
        }
    }, [isOpen, formData.selectedClassIds, localClassStudents]);

    const examTypeOptions = useMemo(() => {
        if (role === 'guru') {
            return [
                { value: 'daily', label: 'Ulangan Harian' },
                { value: 'assignment', label: 'Tugas' },
                { value: 'lainnya', label: 'Ujian Lainnya' },
            ];
        }
        return [
            { value: 'daily', label: 'Ulangan Harian' },
            { value: 'pas', label: 'ASAS/PAS' },
            { value: 'pat', label: 'ASAT/PAT' },
            { value: 'assignment', label: 'Tugas' },
            { value: 'lainnya', label: 'Ujian Lainnya' },
        ];
    }, [role]);

    const isBankRequired = formData.examType !== 'pas' && (formData.examType !== 'assignment' || formData.requireBank);
    const isBankMissing = !isEdit && isBankRequired && (!formData.bankId || availableBanks.length === 0);

    // Hitung total siswa yang akan menerima penugasan
    const totalCalculatedStudents = useMemo(() => {
        let count = 0;
        for (const clsId of formData.selectedClassIds) {
            const assignment = formData.classAssignments[clsId];
            const students = localClassStudents[clsId] || [];
            const fallbackCount = classes.find((c) => c.id === clsId)?.studentCount || 0;
            if (assignment?.mode === 'selected') {
                count += assignment.studentIds.length;
            } else {
                count += students.length > 0 ? students.length : fallbackCount;
            }
        }
        return count;
    }, [formData.selectedClassIds, formData.classAssignments, localClassStudents, classes]);

    const handleSubmitExam = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);

        const user = await getSessionUser();
        if (!user) {
            setError('Sesi telah berakhir. Silakan login kembali.');
            return;
        }

        const skipBankValidation = formData.examType === 'pas' ||
            (formData.examType === 'assignment' && !formData.requireBank);

        if (!skipBankValidation && !formData.bankId && !isEdit) {
            setError('Pilih Bank Soal terlebih dahulu.');
            return;
        }

        if (!formData.title.trim()) {
            setError(`Judul ${formData.examType === 'assignment' ? 'Tugas' : 'Ujian'} wajib diisi.`);
            return;
        }

        if (!formData.isForever) {
            if (formData.examType !== 'assignment' && !formData.startTime) {
                setError('Waktu Mulai wajib diisi.');
                return;
            }
            if (!formData.endTime) {
                setError(`${formData.examType === 'assignment' ? 'Batas Waktu Pengumpulan' : 'Waktu Selesai'} wajib diisi.`);
                return;
            }
            if (formData.examType !== 'assignment' && formData.startTime && formData.endTime) {
                if (new Date(formData.startTime) >= new Date(formData.endTime)) {
                    setError('Waktu Selesai harus lebih lambat dari Waktu Mulai.');
                    return;
                }
            }
        }

        setIsSubmitting(true);
        try {
            if (
                formData.isSafeMode &&
                formData.maxViolations !== null &&
                (!Number.isInteger(formData.maxViolations) || formData.maxViolations < 1 || formData.maxViolations > 100)
            ) {
                setError('Batas pelanggaran harus berupa angka bulat antara 1 dan 100.');
                setIsSubmitting(false);
                return;
            }
            const parsedDuration = formData.duration === '' ? 60 : parseInt(String(formData.duration), 10);
            const validDuration = isNaN(parsedDuration) ? 60 : parsedDuration;
            const finalDuration = formData.examType === 'assignment' && !formData.requireBank ? 0 : Math.max(0, validDuration);

            const payload = {
                title: formData.title.trim(),
                description: formData.description.trim() || undefined,
                duration: finalDuration,
                examType: formData.examType,
                startTime: formData.isForever ? undefined : (formData.startTime || undefined),
                endTime: formData.isForever ? undefined : (formData.endTime || undefined),
                randomizeQuestions: formData.randomizeQuestions,
                randomizeOptions: formData.randomizeOptions,
                showResults: formData.showResults,
                isSafeMode: formData.isSafeMode,
                maxViolations: formData.maxViolations,
                scoringType: formData.scoringTypes.join(','),
                isPublic: formData.examType === 'lainnya' ? formData.isPublic : false,
                documentUrl: formData.examType === 'assignment' ? formData.documentUrl : undefined,
                videoUrl: formData.examType === 'assignment' ? formData.videoUrl : undefined,
                assignmentDescription: formData.examType === 'assignment' ? formData.assignmentDescription : undefined,
                allowFileUpload: formData.examType === 'assignment' ? formData.allowFileUpload : undefined,
                allowedFileTypes: formData.examType === 'assignment' && formData.allowFileUpload ? formData.allowedFileTypes : undefined,
                requireBank: formData.examType === 'assignment' ? formData.requireBank : true,
            };

            let targetExamId = exam?.id;

            if (isEdit && exam) {
                const result = await editExamAction(exam.id, payload);
                if (!result.success) {
                    setError(result.error || 'Gagal mengubah detail ujian.');
                    setIsSubmitting(false);
                    return;
                }
            } else {
                const result = await createExamAction({
                    ...payload,
                    questionBankId: skipBankValidation ? undefined : formData.bankId,
                });
                if (!result.success) {
                    setError(result.error || 'Gagal membuat ujian.');
                    setIsSubmitting(false);
                    return;
                }
                targetExamId = result.id;
            }

            // Atur penugasan kelas dan peserta jika targetExamId ada
            if (targetExamId) {
                if (payload.isPublic) {
                    // Ujian publik: bersihkan sasaran kelas spesifik
                    await assignExamAction(targetExamId, [], [], false);
                } else if (formData.selectedClassIds.length > 0 || isEdit) {
                    const targetClassIds: string[] = [];
                    const participantAssignments: { userId: string; classId: string }[] = [];

                    for (const clsId of formData.selectedClassIds) {
                        const assignment = formData.classAssignments[clsId] || { mode: 'all', studentIds: [] };
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

                    await assignExamAction(
                        targetExamId,
                        targetClassIds,
                        participantAssignments,
                        false
                    );
                }
            }

            onClose();
            await onSuccess();
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'Terjadi kesalahan sistem.';
            setError(message);
        } finally {
            setIsSubmitting(false);
        }
    };

    if (!isOpen) return null;

    return (
        <>
            <Modal
                open={isOpen}
                onClose={onClose}
                size="xl"
                variant={isEdit ? 'default' : 'add'}
                icon={isEdit ? <Settings size={18} /> : <Plus size={18} />}
                title={
                    isEdit
                        ? `Edit ${formData.examType === 'assignment' ? 'Tugas' : 'Ujian'}`
                        : `Buat ${formData.examType === 'assignment' ? 'Tugas' : 'Ujian'} Baru`
                }
                labelledBy="modal-exam-form"
                className="create-exam-modal"
            >
            <form onSubmit={handleSubmitExam}>
                <ModalBody className="create-exam-modal__body">
                    {error && (
                        <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-600 flex items-center gap-2">
                            <AlertCircle size={15} className="shrink-0" />
                            <span>{error}</span>
                        </div>
                    )}

                    {/* Detail utama */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <ModalField label="Jenis Ujian" required>
                            <InlineSelect
                                options={examTypeOptions}
                                value={formData.examType}
                                onChange={(val) => {
                                    const nextType = val as ExamType;
                                    setFormData((prev) => ({
                                        ...prev,
                                        examType: nextType,
                                        isPublic: nextType === 'lainnya' ? prev.isPublic : false,
                                        requireBank: nextType === 'assignment' ? prev.requireBank : true,
                                    }));
                                }}
                            />
                        </ModalField>
                        <ModalField label="Sistem Penilaian" required>
                            <MultiSelect
                                options={SCORING_OPTIONS.map((opt) => ({
                                    value: opt.value,
                                    label: opt.label,
                                }))}
                                value={formData.scoringTypes}
                                onChange={(selectedVals) => {
                                    const hasIRT = selectedVals.some((type) => type.startsWith('irt_'));
                                    setFormData((prev) => ({
                                        ...prev,
                                        scoringTypes: selectedVals,
                                        ...(hasIRT ? { showResults: false } : {}),
                                    }));
                                }}
                                placeholder="Pilih Sistem Penilaian..."
                                allSelectedText="Semua Terpilih"
                            />
                        </ModalField>
                    </div>

                    {/* Identitas ujian */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <ModalField label={`Judul ${formData.examType === 'assignment' ? 'Tugas' : 'Ujian'}`} required>
                            <input
                                required
                                type="text"
                                placeholder={formData.examType === 'assignment' ? 'Contoh: Tugas Matematika' : 'Contoh: UTS Matematika'}
                                value={formData.title}
                                onChange={(e) => setFormData((prev) => ({ ...prev, title: e.target.value }))}
                            />
                        </ModalField>
                        <ModalField label="Deskripsi">
                            <input
                                type="text"
                                placeholder="Deskripsi singkat (opsional)..."
                                value={formData.description}
                                onChange={(e) => setFormData((prev) => ({ ...prev, description: e.target.value }))}
                            />
                        </ModalField>
                    </div>

                    {/* Bank Soal & Durasi (Jika bukan PAS dan bukan Assignment) */}
                    {formData.examType !== 'pas' && formData.examType !== 'assignment' && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <ModalField
                                label="Bank Soal"
                                required={!isEdit}
                                hint={isEdit ? 'Bank soal tidak dapat diganti setelah ujian dibuat' : undefined}
                            >
                                {isEdit ? (
                                    <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-700 flex items-center justify-between">
                                        <div>
                                            <span className="font-semibold text-slate-800">
                                                {availableBanks.find((b) => b.id === formData.bankId)?.title ||
                                                    exam?.question_bank_title ||
                                                    'Bank Soal Terpilih'}
                                            </span>
                                            <p className="text-[11px] text-slate-400 mt-0.5">
                                                {availableBanks.find((b) => b.id === formData.bankId)?.question_count ??
                                                    availableBanks.find((b) => b.id === formData.bankId)?.total_questions ??
                                                    0}{' '}
                                                Soal
                                            </p>
                                        </div>
                                        <span className="text-[10px] bg-slate-200 text-slate-600 px-2 py-0.5 rounded font-medium">
                                            Terkunci
                                        </span>
                                    </div>
                                ) : availableBanks.length === 0 ? (
                                    <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-700 flex items-center gap-1.5">
                                        <AlertCircle size={14} /> Belum ada bank soal yang diterbitkan.
                                    </div>
                                ) : (
                                    <InlineSelect
                                        value={formData.bankId}
                                        onChange={(val) => setFormData((prev) => ({ ...prev, bankId: val }))}
                                        options={[
                                            { value: '', label: '— Pilih Bank Soal —' },
                                            ...availableBanks.map((bank) => ({
                                                value: bank.id,
                                                label: `${bank.title} (${bank.question_count ?? bank.total_questions ?? 0} Soal)`,
                                            })),
                                        ]}
                                    />
                                )}
                            </ModalField>
                            <ModalField label="Durasi (Menit)" required>
                                <input
                                    required
                                    type="number"
                                    min="5"
                                    max="300"
                                    value={formData.duration}
                                    onChange={(e) => setFormData((prev) => ({ ...prev, duration: e.target.value }))}
                                />
                            </ModalField>
                        </div>
                    )}

                    {/* Waktu Pelaksanaan */}
                    <div className="bg-slate-50 p-3 rounded-xl border border-slate-200/80 flex flex-col gap-2.5">
                        <label className="flex items-center gap-2 cursor-pointer w-max select-none">
                            <input
                                type="checkbox"
                                checked={formData.isForever}
                                onChange={(e) =>
                                    setFormData((prev) => ({
                                        ...prev,
                                        isForever: e.target.checked,
                                        startTime: e.target.checked ? '' : prev.startTime,
                                        endTime: e.target.checked ? '' : prev.endTime,
                                    }))
                                }
                                className="w-4 h-4 rounded border-slate-300 text-[#3083FF] focus:ring-[#3083FF]/20"
                            />
                            <span className="text-xs font-semibold text-slate-700">Berlaku Terus Tanpa Batas Waktu</span>
                        </label>
                        {!formData.isForever && (
                            <div className={`grid ${formData.examType === 'assignment' ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-2'} gap-3 mt-1`}>
                                {formData.examType !== 'assignment' && (
                                    <ModalField label="Waktu Mulai" required={!formData.isForever}>
                                        <DateTimePicker
                                            value={formData.startTime}
                                            onChange={(val) => setFormData((prev) => ({ ...prev, startTime: val }))}
                                            label="Waktu Mulai"
                                            required={!formData.isForever}
                                        />
                                    </ModalField>
                                )}
                                <ModalField
                                    label={formData.examType === 'assignment' ? 'Batas Waktu Pengumpulan' : 'Waktu Selesai'}
                                    required={!formData.isForever}
                                >
                                    <DateTimePicker
                                        value={formData.endTime}
                                        onChange={(val) => setFormData((prev) => ({ ...prev, endTime: val }))}
                                        label={formData.examType === 'assignment' ? 'Batas Waktu' : 'Waktu Selesai'}
                                        required={!formData.isForever}
                                    />
                                </ModalField>
                            </div>
                        )}
                    </div>

                    {/* Panel Pengaturan Tugas */}
                    {formData.examType === 'assignment' && (
                        <div className="bg-amber-50/60 p-3.5 rounded-xl border border-amber-200/80 flex flex-col gap-3.5">
                            <div className="flex items-center gap-2 mb-0.5">
                                <FileText size={16} className="text-amber-600" />
                                <h4 className="text-xs font-bold text-amber-900 uppercase tracking-wide">Pengaturan Tugas</h4>
                            </div>

                            <ModalField label="Instruksi Tugas">
                                <textarea
                                    rows={3}
                                    placeholder="Tuliskan instruksi tugas di sini..."
                                    value={formData.assignmentDescription}
                                    onChange={(e) => setFormData((prev) => ({ ...prev, assignmentDescription: e.target.value }))}
                                />
                            </ModalField>

                            <label className="flex items-start gap-2.5 cursor-pointer group select-none">
                                <input
                                    type="checkbox"
                                    checked={formData.requireBank}
                                    disabled={isEdit}
                                    onChange={(e) =>
                                        setFormData((prev) => ({
                                            ...prev,
                                            requireBank: e.target.checked,
                                            bankId: e.target.checked ? prev.bankId : '',
                                            duration: e.target.checked ? prev.duration || 60 : 0,
                                        }))
                                    }
                                    className="mt-0.5 w-4 h-4 rounded border-amber-400 text-amber-600 focus:ring-amber-500/20 disabled:bg-slate-200"
                                />
                                <div>
                                    <span className="text-xs font-semibold text-slate-800">
                                        Sertakan Soal dari Bank Soal {isEdit && '(Terkunci)'}
                                    </span>
                                </div>
                            </label>

                            {formData.requireBank && (
                                <div className="ml-6 p-3 bg-white rounded-xl border border-amber-200 grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <ModalField
                                        label="Bank Soal"
                                        required={!isEdit}
                                        hint={isEdit ? 'Bank soal tidak dapat diganti setelah tugas dibuat' : undefined}
                                    >
                                        {isEdit ? (
                                            <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-700 flex items-center justify-between">
                                                <div>
                                                    <span className="font-semibold text-slate-800">
                                                        {availableBanks.find((b) => b.id === formData.bankId)?.title ||
                                                            exam?.question_bank_title ||
                                                            'Bank Soal Terpilih'}
                                                    </span>
                                                    <p className="text-[11px] text-slate-400 mt-0.5">
                                                        {availableBanks.find((b) => b.id === formData.bankId)?.question_count ??
                                                            availableBanks.find((b) => b.id === formData.bankId)?.total_questions ??
                                                            0}{' '}
                                                        Soal
                                                    </p>
                                                </div>
                                                <span className="text-[10px] bg-slate-200 text-slate-600 px-2 py-0.5 rounded font-medium">
                                                    Terkunci
                                                </span>
                                            </div>
                                        ) : availableBanks.length === 0 ? (
                                            <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-700 flex items-center gap-1.5">
                                                <AlertCircle size={14} /> Belum ada bank soal.
                                            </div>
                                        ) : (
                                            <InlineSelect
                                                value={formData.bankId}
                                                onChange={(val) => setFormData((prev) => ({ ...prev, bankId: val }))}
                                                options={[
                                                    { value: '', label: '— Pilih Bank Soal —' },
                                                    ...availableBanks.map((bank) => ({
                                                        value: bank.id,
                                                        label: `${bank.title} (${bank.question_count ?? bank.total_questions ?? 0} Soal)`,
                                                    })),
                                                ]}
                                            />
                                        )}
                                    </ModalField>
                                    <ModalField label="Durasi Pengerjaan Soal (Menit)" hint="0 / kosong jika tidak dibatasi waktu layar">
                                        <input
                                            type="number"
                                            min="0"
                                            max="300"
                                            placeholder="Tidak dibatasi (0)"
                                            value={formData.duration}
                                            onChange={(e) => setFormData((prev) => ({ ...prev, duration: e.target.value }))}
                                        />
                                    </ModalField>
                                </div>
                            )}

                            <label className="flex items-start gap-2.5 cursor-pointer group select-none">
                                <input
                                    type="checkbox"
                                    checked={formData.allowFileUpload}
                                    onChange={(e) => setFormData((prev) => ({ ...prev, allowFileUpload: e.target.checked }))}
                                    className="mt-0.5 w-4 h-4 rounded border-amber-400 text-amber-600 focus:ring-amber-500/20"
                                />
                                <div>
                                    <span className="text-xs font-semibold text-slate-800">Siswa Wajib Unggah File</span>
                                </div>
                            </label>

                            {formData.allowFileUpload && (
                                <div className="ml-6 p-3 bg-white rounded-xl border border-amber-200">
                                    <ModalField label="Jenis File yang Diizinkan">
                                        <MultiSelect
                                            options={[
                                                { value: 'pdf', label: '.pdf (Dokumen PDF)' },
                                                { value: 'docx', label: '.docx (Microsoft Word)' },
                                                { value: 'jpg', label: '.jpg (Gambar JPEG)' },
                                                { value: 'png', label: '.png (Gambar PNG)' },
                                                { value: 'zip', label: '.zip (Arsip ZIP)' },
                                                { value: 'xlsx', label: '.xlsx (Excel Spreadsheet)' },
                                                { value: 'pptx', label: '.pptx (PowerPoint)' },
                                            ]}
                                            value={formData.allowedFileTypes}
                                            onChange={(vals) => setFormData((prev) => ({ ...prev, allowedFileTypes: vals }))}
                                            placeholder="Pilih format file..."
                                            allSelectedText="Semua Jenis File"
                                            columns={2}
                                        />
                                    </ModalField>
                                </div>
                            )}

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <ModalField label="URL Referensi Materi (Opsional)">
                                    <input
                                        type="url"
                                        placeholder="https://drive.google.com/..."
                                        value={formData.documentUrl}
                                        onChange={(e) => setFormData((prev) => ({ ...prev, documentUrl: e.target.value }))}
                                    />
                                </ModalField>
                                <ModalField label="URL Video Pembelajaran (Opsional)">
                                    <input
                                        type="url"
                                        placeholder="https://youtube.com/..."
                                        value={formData.videoUrl}
                                        onChange={(e) => setFormData((prev) => ({ ...prev, videoUrl: e.target.value }))}
                                    />
                                </ModalField>
                            </div>
                        </div>
                    )}

                    {/* ─── Peserta & Kelas Sasaran ─── */}
                    <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200/80 flex flex-col gap-3">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <Users size={16} className="text-[#3083FF]" />
                                <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wide">
                                    Peserta & Kelas Sasaran
                                </h4>
                            </div>
                            {formData.examType === 'lainnya' && (
                                <label className="flex items-center gap-2 cursor-pointer select-none">
                                    <input
                                        type="checkbox"
                                        checked={formData.isPublic}
                                        onChange={(e) =>
                                            setFormData((prev) => ({
                                                ...prev,
                                                isPublic: e.target.checked,
                                                selectedClassIds: e.target.checked ? [] : prev.selectedClassIds,
                                            }))
                                        }
                                        className="w-4 h-4 rounded border-slate-300 text-emerald-500 focus:ring-emerald-500/20"
                                    />
                                    <span className="text-xs font-semibold text-slate-700">
                                        Ujian Umum (Semua Siswa)
                                    </span>
                                </label>
                            )}
                        </div>

                        {formData.isPublic ? (
                            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-700 flex items-center gap-2">
                                <Globe size={16} className="shrink-0" />
                                <span>Dapat diakses semua siswa aktif.</span>
                            </div>
                        ) : (
                            <div className="bg-white p-3.5 rounded-xl border border-slate-200/90 shadow-2xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                                <div className="flex items-start sm:items-center gap-3 min-w-0">
                                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                                        formData.selectedClassIds.length > 0
                                            ? 'bg-[#3083FF]/10 text-[#3083FF]'
                                            : 'bg-slate-100 text-slate-400'
                                    }`}>
                                        <Users size={20} />
                                    </div>
                                    <div className="min-w-0">
                                        <div className="text-xs font-bold text-slate-800">
                                            {isLoadingAssignments ? (
                                                <span className="flex items-center gap-1.5 text-slate-500 font-medium">
                                                    <Loader2 size={13} className="animate-spin text-[#3083FF]" />
                                                    Memuat penugasan peserta...
                                                </span>
                                            ) : formData.selectedClassIds.length > 0 ? (
                                                <span>
                                                    {formData.selectedClassIds.length} Kelas Dipilih &bull;{' '}
                                                    <strong className="text-emerald-600">
                                                        {totalCalculatedStudents} Siswa
                                                    </strong>{' '}
                                                    Ditugaskan
                                                </span>
                                            ) : (
                                                <span className="text-slate-600 font-semibold">
                                                    Belum Ada Peserta yang Ditugaskan
                                                </span>
                                            )}
                                        </div>
                                        <div className="text-[11px] text-slate-500 mt-1">
                                            {formData.selectedClassIds.length > 0 && (
                                                <div className="flex flex-wrap gap-1 mt-0.5">
                                                    {formData.selectedClassIds.slice(0, 4).map((cid) => {
                                                        const cls = classes.find((c) => c.id === cid);
                                                        const assignment = formData.classAssignments[cid];
                                                        const isCustom = assignment?.mode === 'selected';
                                                        return (
                                                            <span
                                                                key={cid}
                                                                className="px-2 py-0.5 rounded-md bg-slate-100 border border-slate-200 text-slate-700 font-medium text-[10px]"
                                                            >
                                                                {cls?.name || 'Kelas'}{' '}
                                                                {isCustom ? `(${assignment.studentIds.length} siswa)` : ''}
                                                            </span>
                                                        );
                                                    })}
                                                    {formData.selectedClassIds.length > 4 && (
                                                        <span className="px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-500 font-medium text-[10px]">
                                                            +{formData.selectedClassIds.length - 4} kelas lainnya
                                                        </span>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                <Button
                                    type="button"
                                    variant={formData.selectedClassIds.length > 0 ? 'secondary' : 'primary'}
                                    onClick={() => setIsAssignPickerOpen(true)}
                                    className="shrink-0 self-start sm:self-auto cursor-pointer"
                                    leftIcon={<Users size={14} />}
                                >
                                    {formData.selectedClassIds.length > 0 ? 'Atur Ulang Peserta' : 'Atur Peserta'}
                                </Button>
                            </div>
                        )}
                    </div>

                    {/* Opsi Pengaturan Tambahan */}
                    <div className="p-3 bg-slate-50/80 rounded-xl border border-slate-200/80 flex flex-wrap gap-x-5 gap-y-2.5 select-none">
                        <label className="flex items-center gap-2 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={formData.randomizeQuestions}
                                onChange={(e) => setFormData((prev) => ({ ...prev, randomizeQuestions: e.target.checked }))}
                                className="w-4 h-4 rounded border-slate-300 text-[#3083FF] focus:ring-[#3083FF]/20"
                            />
                            <span className="text-xs font-medium text-slate-700">Acak Soal</span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={formData.randomizeOptions}
                                onChange={(e) => setFormData((prev) => ({ ...prev, randomizeOptions: e.target.checked }))}
                                className="w-4 h-4 rounded border-slate-300 text-[#3083FF] focus:ring-[#3083FF]/20"
                            />
                            <span className="text-xs font-medium text-slate-700">Acak Opsi</span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={formData.isSafeMode}
                                onChange={(e) => setFormData((prev) => ({ ...prev, isSafeMode: e.target.checked }))}
                                className="w-4 h-4 rounded border-slate-300 text-[#3083FF] focus:ring-[#3083FF]/20"
                            />
                            <span className="text-xs font-medium text-slate-700">Mode Aman (Proctoring)</span>
                        </label>
                        {formData.isSafeMode && (
                            <div className="basis-full mt-1 rounded-lg border border-blue-100 bg-blue-50/70 p-3">
                                <p className="text-xs font-semibold text-slate-700 mb-2">Tindakan setelah pelanggaran</p>
                                <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
                                    <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                                        <input
                                            type="radio"
                                            name="violation-limit-mode"
                                            checked={formData.maxViolations !== null}
                                            onChange={() => setFormData((prev) => ({
                                                ...prev,
                                                maxViolations: prev.maxViolations ?? 3,
                                            }))}
                                            className="text-[#3083FF] focus:ring-[#3083FF]/20"
                                        />
                                        Selesaikan ujian otomatis setelah
                                        <input
                                            type="number"
                                            min={1}
                                            max={100}
                                            step={1}
                                            aria-label="Batas jumlah pelanggaran"
                                            disabled={formData.maxViolations === null}
                                            value={formData.maxViolations ?? 3}
                                            onChange={(e) => setFormData((prev) => ({
                                                ...prev,
                                                maxViolations: Math.max(1, Math.min(100, Number(e.target.value) || 1)),
                                            }))}
                                            className="w-16 rounded-md border border-slate-300 bg-white px-2 py-1 text-center disabled:opacity-50"
                                        />
                                        pelanggaran
                                    </label>
                                    <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                                        <input
                                            type="radio"
                                            name="violation-limit-mode"
                                            checked={formData.maxViolations === null}
                                            onChange={() => setFormData((prev) => ({ ...prev, maxViolations: null }))}
                                            className="text-[#3083FF] focus:ring-[#3083FF]/20"
                                        />
                                        Tanpa batas — catat semua, jangan selesaikan otomatis
                                    </label>
                                </div>
                            </div>
                        )}
                        <label
                            className={`flex items-center gap-2 ${
                                formData.scoringTypes.some((t) => t.startsWith('irt_')) ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
                            }`}
                        >
                            <input
                                type="checkbox"
                                checked={formData.showResults}
                                disabled={formData.scoringTypes.some((t) => t.startsWith('irt_'))}
                                onChange={(e) => setFormData((prev) => ({ ...prev, showResults: e.target.checked }))}
                                className="w-4 h-4 rounded border-slate-300 text-[#3083FF] focus:ring-[#3083FF]/20 disabled:bg-slate-200"
                            />
                            <span className="text-xs font-medium text-slate-700">
                                Tampilkan Nilai
                                {formData.scoringTypes.some((t) => t.startsWith('irt_')) && ' (Nonaktif untuk IRT)'}
                            </span>
                        </label>
                    </div>
                </ModalBody>
                <ModalFooter>
                    <Button
                        type="button"
                        variant="cancel"
                        onClick={onClose}
                        disabled={isSubmitting}
                        icon="cancel"
                    >
                        Batal
                    </Button>
                    <Button
                        type="submit"
                        variant="primary"
                        isLoading={isSubmitting}
                        disabled={isSubmitting || isBankMissing}
                        icon={isSubmitting ? undefined : "save"}
                    >
                        {isEdit ? 'Simpan Perubahan' : 'Simpan sebagai Draft'}
                    </Button>
                </ModalFooter>
            </form>
        </Modal>

        {/* ─── MODAL ATUR PESERTA TERSENDIRI ─── */}
        <AssignExamModal
            isOpen={isAssignPickerOpen}
            onClose={() => setIsAssignPickerOpen(false)}
            exam={exam || null}
            examTitle={
                formData.title ||
                (exam?.title
                    ? exam.title
                    : formData.examType === 'assignment'
                    ? 'Tugas Baru'
                    : 'Ujian Baru')
            }
            classes={classes}
            classStudents={localClassStudents}
            initialSelectedClassIds={formData.selectedClassIds}
            initialClassAssignments={formData.classAssignments}
            onSaveAssignments={(newClassIds, newAssignments) => {
                setFormData((prev) => ({
                    ...prev,
                    selectedClassIds: newClassIds,
                    classAssignments: newAssignments,
                }));
                setIsAssignPickerOpen(false);
            }}
            overlayClassName="!z-[10050]"
        />
        </>
    );
};

export const ExamFormModal = CreateExamModal;
export default CreateExamModal;
