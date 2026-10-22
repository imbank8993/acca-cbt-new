'use client';

import { isFolderExamCategory } from '@/lib/exam-types';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { availableStudentScoreTypes, studentScoreType, STUDENT_SCORE_LABELS, type StudentScoreType } from '@acca-cbt/shared';
import {
    AlertCircle,
    FileText,
    FolderOpen,
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
import { createPASPeriodAction } from '@/lib/api/pas';
import {
    createExamAction,
    editExamAction,
    assignExamAction,
    getActiveSchoolYear,
    listExamAssignmentsAction,
    listClassStudents,
} from '@/lib/api/proctor';
import type {
    ClassStudent,
    ExamInput,
    OrganizationClass,
    OrganizationExam,
    ProctorOrganization,
} from '@/lib/api/proctor';
import type { QuestionBank } from '@/lib/api/questions';
import { getSessionUser } from '@/lib/session';
import { DEFAULT_SCHOOL_TIME_ZONE, getSchoolTimeZone, getSchoolTimeZoneLabel, schoolTodayDate, utcToSchoolLocalDateTime, addMinutesToLocalDateTime } from '@/lib/school-time';

export type ExamType = 'daily' | 'am' | 'asas_asat' | 'tryout' | 'assignment' | 'lainnya';

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
    studentScoreType: StudentScoreType;
    showAnswerKeys: boolean;
    isSafeMode: boolean;
    screenshotEnabled: boolean;
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
    pasType: 'pas' | 'pat';
    pasSemester: 'ganjil' | 'genap';
    pasSchoolYear: string;
    pasStartDate: string;
    pasEndDate: string;
}

const DEFAULT_FORM_DATA: ExamFormData = {
    title: '',
    description: '',
    examType: 'daily',
    duration: 60,
    randomizeQuestions: true,
    randomizeOptions: true,
    showResults: false,
    studentScoreType: 'classical',
    showAnswerKeys: false,
    isSafeMode: true,
    screenshotEnabled: false,
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
    pasType: 'pas',
    pasSemester: 'ganjil',
    pasSchoolYear: '',
    pasStartDate: '',
    pasEndDate: '',
};

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
    const router = useRouter();
    const isEdit = Boolean(exam);

    const availableBanks = useMemo(() => {
        if (publishedBanks) return publishedBanks;
        return (questionBanks || []).filter((b) => b.is_published);
    }, [publishedBanks, questionBanks]);

    const [formData, setFormData] = useState<ExamFormData>(DEFAULT_FORM_DATA);
    const [timeZone, setTimeZone] = useState(DEFAULT_SCHOOL_TIME_ZONE);
    const [localClassStudents, setLocalClassStudents] = useState<Record<string, ClassStudent[]>>(classStudents);
    const [isAssignPickerOpen, setIsAssignPickerOpen] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isLoadingAssignments, setIsLoadingAssignments] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const initializedModalRef = useRef<string | null>(null);

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
        if (!isOpen) {
            initializedModalRef.current = null;
            return;
        }

        const modalKey = exam ? `edit-${exam.id}` : 'new';
        if (initializedModalRef.current === modalKey) {
            return;
        }
        initializedModalRef.current = modalKey;

        let isMounted = true;
        let initializeId: number | undefined;
        void getSchoolTimeZone().then((zone) => {
          if (!isMounted) return;
          setTimeZone(zone);
          initializeId = window.setTimeout(() => {
          if (!isMounted) return;
          setError(null);
          setIsSubmitting(false);

          if (exam) {
            // MODE EDIT
            const isForever = !exam.start_time && !exam.end_time;
            const todayDate = schoolTodayDate(zone);
            const initFormData: ExamFormData = {
                title: exam.title || '',
                description: exam.description || '',
                examType: exam?.exam_type === 'pas' || exam?.exam_type === 'pat'
                    ? 'asas_asat'
                    : (exam?.exam_type as ExamType) || 'daily',
                duration: exam.duration_minutes || 60,
                randomizeQuestions: exam.randomize_questions ?? true,
                randomizeOptions: exam.randomize_options ?? true,
                showResults: exam.show_results ?? false,
                studentScoreType: studentScoreType(exam),
                showAnswerKeys: exam.metadata?.show_answer_keys === true,
                isSafeMode: exam.metadata?.is_safe_mode ?? true,
                screenshotEnabled: exam.metadata?.screenshot_enabled === true,
                maxViolations: exam.metadata?.max_violations === null
                    ? null
                    : (typeof exam.metadata?.max_violations === 'number'
                        ? exam.metadata.max_violations
                        : 3),
                bankId: exam.question_bank_id || '',
                startTime: exam.start_time ? utcToSchoolLocalDateTime(exam.start_time, zone) : '',
                endTime: exam.end_time ? utcToSchoolLocalDateTime(exam.end_time, zone) : '',
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
                pasType: exam?.exam_type === 'pat' ? 'pat' : 'pas',
                pasSemester: 'ganjil',
                pasSchoolYear: '',
                pasStartDate: todayDate,
                pasEndDate: todayDate,
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
            const todayDate = schoolTodayDate(zone);
            const nextWeekDate = new Date(`${todayDate}T12:00:00`);
            nextWeekDate.setDate(nextWeekDate.getDate() + 7);
            const defaultEndDate = nextWeekDate.toISOString().slice(0, 10);
            const currentYear = new Date().getFullYear();
            const fallbackSchoolYear = `${currentYear}/${currentYear + 1}`;

            setFormData({
                ...DEFAULT_FORM_DATA,
                bankId: defaultBankId,
                classAssignments: defaults,
                pasStartDate: todayDate,
                pasEndDate: defaultEndDate,
                pasSchoolYear: fallbackSchoolYear,
            });

            void getActiveSchoolYear()
                .then((activeYear) => {
                    if (isMounted && activeYear?.year) {
                        setFormData((prev) => ({ ...prev, pasSchoolYear: activeYear.year }));
                    }
                })
                .catch(() => undefined);
          }
          }, 0);
          return initializeId;
        }).catch((loadError: unknown) => {
            if (isMounted) {
                setError(loadError instanceof Error ? loadError.message : 'Zona waktu sekolah gagal dimuat.');
            }
        });
        return () => {
            isMounted = false;
            if (initializeId !== undefined) window.clearTimeout(initializeId);
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
                { value: 'tryout', label: 'Try Out' },
                { value: 'assignment', label: 'Tugas' },
                { value: 'lainnya', label: 'Lainnya' },
            ];
        }
        return [
            { value: 'daily', label: 'Ulangan Harian' },
            { value: 'asas_asat', label: 'ASAS/ASAT (Folder Ujian)' },
            { value: 'am', label: 'Asesmen Madrasah (Folder Ujian)' },
            { value: 'tryout', label: 'Try Out' },
            { value: 'assignment', label: 'Tugas' },
            { value: 'lainnya', label: 'Lainnya' },
        ];
    }, [role]);

    const isPasFolderCreate = !isEdit && isFolderExamCategory(formData.examType);
    const isBankRequired = !isFolderExamCategory(formData.examType) && (formData.examType !== 'assignment' || formData.requireBank);
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

    const handleStartTimeChange = (val: string) => {
        setFormData((prev) => {
            const next = { ...prev, startTime: val };
            if (val && (!prev.endTime || prev.endTime <= val)) {
                const dur = typeof prev.duration === 'number' ? prev.duration : (parseInt(String(prev.duration), 10) || 60);
                next.endTime = addMinutesToLocalDateTime(val, Math.max(5, dur));
            }
            return next;
        });
    };

    const handleDurationChange = (val: string | number) => {
        setFormData((prev) => {
            const next = { ...prev, duration: val };
            const dur = typeof val === 'number' ? val : parseInt(String(val), 10);
            if (!isNaN(dur) && dur > 0 && prev.startTime) {
                if (!prev.endTime || prev.endTime <= prev.startTime) {
                    next.endTime = addMinutesToLocalDateTime(prev.startTime, dur);
                }
            }
            return next;
        });
    };

    const handleSubmitExam = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);

        const user = await getSessionUser();
        if (!user) {
            setError('Sesi telah berakhir. Silakan login kembali.');
            return;
        }

        // Mode Pembuatan Rumah / Folder Ujian ASAS/ASAT
        if (!isEdit && isFolderExamCategory(formData.examType)) {
            if (!formData.title.trim()) {
                setError('Nama folder ujian wajib diisi.');
                return;
            }
            if (!formData.pasSchoolYear.trim()) {
                setError('Tahun Ajaran wajib diisi.');
                return;
            }
            if (!formData.pasStartDate || !formData.pasEndDate) {
                setError('Tanggal Mulai dan Tanggal Selesai periode wajib diisi.');
                return;
            }
            if (formData.pasStartDate > formData.pasEndDate) {
                setError('Tanggal Selesai harus sama atau setelah Tanggal Mulai.');
                return;
            }

            setIsSubmitting(true);
            try {
                const res = await createPASPeriodAction({
                    name: formData.title.trim(),
                    type: formData.examType === 'am' ? 'am' : formData.pasType,
                    school_year: formData.pasSchoolYear.trim(),
                    semester: formData.pasSemester,
                    start_date: formData.pasStartDate,
                    end_date: formData.pasEndDate,
                    screenshot_enabled: formData.screenshotEnabled,
                });

                if (!res.success) {
                    setError(res.error || 'Gagal membuat folder ujian.');
                    setIsSubmitting(false);
                    return;
                }

                onClose();
                await onSuccess();
                if (res.id && (role === 'admin' || role === 'proktor')) {
                    router.push(`/dashboard/${role}/exams/pas/${res.id}`);
                }
            } catch (err: unknown) {
                setError(err instanceof Error ? err.message : 'Terjadi kesalahan sistem.');
            } finally {
                setIsSubmitting(false);
            }
            return;
        }

        const skipBankValidation = isFolderExamCategory(formData.examType) ||
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
                if (formData.startTime >= formData.endTime) {
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
            const storedExamType: ExamInput['examType'] = isFolderExamCategory(formData.examType)
                ? (formData.examType === 'am' ? 'am' : exam?.exam_type === 'pat' ? 'pat' : 'pas')
                : formData.examType;

            const payload = {
                title: formData.title.trim(),
                description: formData.description.trim() || undefined,
                duration: finalDuration,
                examType: storedExamType,
                timeZone,
                startTime: formData.isForever ? undefined : (formData.startTime || undefined),
                endTime: formData.isForever ? undefined : (formData.endTime || undefined),
                randomizeQuestions: formData.randomizeQuestions,
                randomizeOptions: formData.randomizeOptions,
                showResults: formData.showResults,
                studentScoreType: formData.studentScoreType,
                showAnswerKeys: formData.showAnswerKeys,
                isSafeMode: formData.isSafeMode,
                screenshotEnabled: formData.screenshotEnabled,
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
                icon={isEdit ? <Settings size={18} /> : isPasFolderCreate ? <FolderOpen size={18} /> : <Plus size={18} />}
                title={
                    isEdit
                        ? `Edit ${formData.examType === 'assignment' ? 'Tugas' : 'Ujian'}`
                        : isPasFolderCreate
                        ? `Buat Folder Ujian ${formData.examType === 'am' ? 'Asesmen Madrasah' : 'ASAS/ASAT'}`
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
                        {isPasFolderCreate && formData.examType !== 'am' ? (
                            <ModalField label="Kategori Asesmen" required>
                                <InlineSelect
                                    options={[
                                        { value: 'pas', label: 'ASAS / PAS (Akhir Semester)' },
                                        { value: 'pat', label: 'ASAT / PAT (Akhir Tahun)' },
                                    ]}
                                    value={formData.pasType}
                                    onChange={(val) => setFormData((prev) => ({ ...prev, pasType: val as 'pas' | 'pat' }))}
                                />
                            </ModalField>
                        ) : isPasFolderCreate ? null : (
                            <ModalField label="Sistem Penilaian" required>
                                <MultiSelect
                                    options={SCORING_OPTIONS.map((opt) => ({
                                        value: opt.value,
                                        label: opt.label,
                                    }))}
                                    value={formData.scoringTypes}
                                    onChange={(selectedVals) => {
                                        setFormData((prev) => ({
                                            ...prev,
                                            scoringTypes: selectedVals,
                                            studentScoreType: !prev.scoringTypes.some(type => type.startsWith('irt_')) && selectedVals.some(type => type.startsWith('irt_'))
                                                ? studentScoreType({ scoring_type: selectedVals.join(',') })
                                                : availableStudentScoreTypes(selectedVals.join(',')).includes(prev.studentScoreType)
                                                ? prev.studentScoreType : studentScoreType({ scoring_type: selectedVals.join(',') }),
                                        }));
                                    }}
                                    placeholder="Pilih Sistem Penilaian..."
                                    allSelectedText="Semua Terpilih"
                                />
                            </ModalField>
                        )}
                    </div>

                    {isPasFolderCreate ? (
                        <>
                            <div className="p-3.5 bg-blue-50/80 border border-blue-200 rounded-xl flex items-start gap-3">
                                <FolderOpen size={18} className="text-[#3083FF] shrink-0 mt-0.5" />
                                <div className="text-xs text-slate-700 leading-relaxed">
                                    <p className="font-bold text-slate-900 mb-0.5">Rumah / Folder Ujian {formData.examType === 'am' ? 'Asesmen Madrasah' : 'ASAS/ASAT'}</p>
                                    <p>
                                        Tipe ujian ini berfungsi sebagai <strong>Folder Ujian</strong>. Setelah folder dibuat, Anda akan langsung masuk ke dalam folder untuk memilih berbagai <strong>Bank Soal</strong> dan menjadwalkannya ke kelas/siswa. Semua jadwal bank soal di dalamnya akan tampil ke siswa dengan nama ujian yang sama dengan nama folder ini.
                                    </p>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <ModalField label="Nama Folder / Nama Ujian" required hint="Nama ini juga menjadi judul ujian yang tampil di halaman siswa">
                                    <input
                                        required
                                        type="text"
                                        placeholder={formData.examType === 'am' ? 'Contoh: Asesmen Madrasah 2026/2027' : 'Contoh: ASAS Ganjil 2025/2026'}
                                        value={formData.title}
                                        onChange={(e) => setFormData((prev) => ({ ...prev, title: e.target.value }))}
                                    />
                                </ModalField>
                                <ModalField label="Semester" required>
                                    <InlineSelect
                                        options={[
                                            { value: 'ganjil', label: 'Semester Ganjil' },
                                            { value: 'genap', label: 'Semester Genap' },
                                        ]}
                                        value={formData.pasSemester}
                                        onChange={(val) => setFormData((prev) => ({ ...prev, pasSemester: val as 'ganjil' | 'genap' }))}
                                    />
                                </ModalField>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                <ModalField label="Tahun Ajaran" required>
                                    <input
                                        required
                                        type="text"
                                        placeholder="Contoh: 2025/2026"
                                        value={formData.pasSchoolYear}
                                        onChange={(e) => setFormData((prev) => ({ ...prev, pasSchoolYear: e.target.value }))}
                                    />
                                </ModalField>
                                <ModalField label="Tanggal Mulai Periode" required>
                                    <input
                                        required
                                        type="date"
                                        value={formData.pasStartDate}
                                        onChange={(e) => setFormData((prev) => ({ ...prev, pasStartDate: e.target.value }))}
                                    />
                                </ModalField>
                                <ModalField label="Tanggal Selesai Periode" required>
                                    <input
                                        required
                                        type="date"
                                        min={formData.pasStartDate || undefined}
                                        value={formData.pasEndDate}
                                        onChange={(e) => setFormData((prev) => ({ ...prev, pasEndDate: e.target.value }))}
                                    />
                                </ModalField>
                            </div>
                        </>
                    ) : (
                        <>
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
                    {!isFolderExamCategory(formData.examType) && formData.examType !== 'assignment' && (
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
                                    onChange={(e) => handleDurationChange(e.target.value)}
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
                            <>
                                <div className={`grid ${formData.examType === 'assignment' ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-2'} gap-3 mt-1`}>
                                    {formData.examType !== 'assignment' && (
                                        <ModalField label={`Waktu Mulai (${getSchoolTimeZoneLabel(timeZone)})`} required={!formData.isForever}>
                                            <DateTimePicker
                                                timeInputMode="text"
                                                value={formData.startTime}
                                                onChange={handleStartTimeChange}
                                                label="Waktu Mulai"
                                                required={!formData.isForever}
                                                defaultTime="08:00"
                                                timeZone={timeZone}
                                            />
                                        </ModalField>
                                    )}
                                    <ModalField
                                        label={`${formData.examType === 'assignment' ? 'Batas Waktu Pengumpulan' : 'Waktu Selesai'} (${getSchoolTimeZoneLabel(timeZone)})`}
                                        required={!formData.isForever}
                                    >
                                        <DateTimePicker
                                            timeInputMode="text"
                                            value={formData.endTime}
                                            onChange={(val) => setFormData((prev) => ({ ...prev, endTime: val }))}
                                            label={formData.examType === 'assignment' ? 'Batas Waktu' : 'Waktu Selesai'}
                                            required={!formData.isForever}
                                            minDate={formData.startTime ? formData.startTime.slice(0, 10) : undefined}
                                            defaultTime={
                                                formData.startTime
                                                    ? addMinutesToLocalDateTime(formData.startTime, Number(formData.duration) || 60).slice(11, 16) || '09:00'
                                                    : '09:00'
                                            }
                                            timeZone={timeZone}
                                        />
                                    </ModalField>
                                </div>
                                {formData.examType !== 'assignment' && formData.startTime && formData.endTime && formData.startTime >= formData.endTime && (
                                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-2.5 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800 mt-1">
                                        <span className="flex items-center gap-1.5 font-medium">
                                            <AlertCircle size={14} className="text-amber-600 shrink-0" />
                                            Waktu Selesai harus lebih lambat dari Waktu Mulai.
                                        </span>
                                        <button
                                            type="button"
                                            className="text-[11px] font-semibold text-blue-600 hover:text-blue-700 bg-white px-2.5 py-1 rounded border border-blue-200 shadow-xs cursor-pointer w-fit"
                                            onClick={() => {
                                                const dur = typeof formData.duration === 'number' ? formData.duration : (parseInt(String(formData.duration), 10) || 60);
                                                setFormData((prev) => ({
                                                    ...prev,
                                                    endTime: addMinutesToLocalDateTime(prev.startTime, Math.max(5, dur)),
                                                }));
                                            }}
                                        >
                                            Sesuaikan Otomatis (+{formData.duration || 60} Menit)
                                        </button>
                                    </div>
                                )}
                            </>
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
                    <div className="p-4 bg-white rounded-xl border border-slate-200 space-y-4">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
                            <fieldset className="space-y-2.5">
                                <legend className="mb-2 text-xs font-semibold text-slate-500">Pengacakan</legend>
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={formData.randomizeQuestions}
                                    onChange={(e) => setFormData((prev) => ({ ...prev, randomizeQuestions: e.target.checked }))}
                                    className="w-4 h-4 rounded border-slate-300 text-[#3083FF] focus:ring-[#3083FF]/20"
                                />
                                <span className="text-xs font-medium text-slate-700">Acak soal</span>
                            </label>
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={formData.randomizeOptions}
                                    onChange={(e) => setFormData((prev) => ({ ...prev, randomizeOptions: e.target.checked }))}
                                    className="w-4 h-4 rounded border-slate-300 text-[#3083FF] focus:ring-[#3083FF]/20"
                                />
                                <span className="text-xs font-medium text-slate-700">Acak opsi jawaban</span>
                            </label>
                            </fieldset>
                            <fieldset className="space-y-2.5">
                                <legend className="mb-2 text-xs font-semibold text-slate-500">Hasil siswa</legend>
                            <label
                                className="flex items-center gap-2 cursor-pointer"
                            >
                                <input
                                    type="checkbox"
                                    checked={formData.showResults}
                                    onChange={(e) => setFormData((prev) => ({ ...prev, showResults: e.target.checked }))}
                                    className="w-4 h-4 rounded border-slate-300 text-[#3083FF] focus:ring-[#3083FF]/20 disabled:bg-slate-200"
                                />
                                <span className="text-xs font-medium text-slate-700">
                                    Tampilkan nilai
                                </span>
                            </label>
                            <div className="pl-6">
                                <label className="mb-1 block text-[11px] text-slate-500">Nilai yang ditampilkan</label>
                                <InlineSelect value={formData.studentScoreType}
                                    onChange={value => setFormData(prev => ({ ...prev, studentScoreType: value as StudentScoreType }))}
                                    options={availableStudentScoreTypes(formData.scoringTypes.join(',')).map(value => ({ value, label: STUDENT_SCORE_LABELS[value] }))}
                                    title="Nilai yang ditampilkan kepada siswa" height="34px" />
                            </div>
                        <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-slate-700">
                            <input type="checkbox" checked={formData.showAnswerKeys}
                                aria-describedby="exam-answer-keys-hint"
                                onChange={(e) => setFormData(prev => ({ ...prev, showAnswerKeys: e.target.checked }))}
                                className="w-4 h-4 shrink-0 rounded border-slate-300 text-[#3083FF] focus:ring-[#3083FF]/20" />
                            <span>Buka pembahasan</span>
                        </label>
                        <p id="exam-answer-keys-hint" className="pl-6 text-[11px] leading-relaxed text-slate-500">
                            Setelah semua sesi selesai dan nilai dibuka.
                        </p>
                        {formData.scoringTypes.some((t) => t.startsWith('irt_')) && (
                            <p className="pl-6 text-[11px] text-slate-500">Nilai IRT dan pembahasan muncul setelah IRT seluruh peserta dihitung.</p>
                        )}
                            </fieldset>
                        </div>
                        <div className="border-t border-slate-100 pt-4">
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input type="checkbox" checked={formData.isSafeMode}
                                    onChange={(e) => setFormData((prev) => ({ ...prev, isSafeMode: e.target.checked }))}
                                    className="w-4 h-4 rounded border-slate-300 text-[#3083FF] focus:ring-[#3083FF]/20" />
                                <span className="text-xs font-medium text-slate-700">Mode aman</span>
                            </label>
                        {formData.isSafeMode && (
                            <fieldset className="mt-3 ml-6 space-y-2.5">
                                <legend className="mb-2 text-[11px] text-slate-500">Saat terjadi pelanggaran</legend>
                                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-700">
                                    <label className="flex items-center gap-2 cursor-pointer">
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
                                        Akhiri ujian setelah
                                    </label>
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
                                            className="w-14 rounded-md border border-slate-200 bg-white px-2 py-1 text-center disabled:opacity-50"
                                        />
                                        <span>pelanggaran</span>
                                </div>
                                    <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                                        <input
                                            type="radio"
                                            name="violation-limit-mode"
                                            checked={formData.maxViolations === null}
                                            onChange={() => setFormData((prev) => ({ ...prev, maxViolations: null }))}
                                            className="text-[#3083FF] focus:ring-[#3083FF]/20"
                                        />
                                        Catat saja, tanpa mengakhiri ujian
                                    </label>
                            </fieldset>
                        )}
                        </div>
                    </div>
                        </>
                    )}
                    <div className="border-t border-slate-100 pt-4">
                        <label className="flex items-start gap-2 cursor-pointer text-sm text-slate-700">
                            <input type="checkbox" checked={formData.screenshotEnabled}
                                onChange={e => setFormData(prev => ({ ...prev, screenshotEnabled: e.target.checked }))}
                                className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-blue-600" />
                            <span><span className="font-semibold">Aktifkan Screenshot Pelanggaran</span>
                                <span className="mt-1 block text-xs text-slate-500">Siswa wajib berbagi layar penuh. Hanya kejadian tertentu yang disimpan, maksimal 10 gambar per peserta; gambar dihapus setelah 7 hari.</span>
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
                        {isPasFolderCreate
                            ? 'Buat Folder & Pilih Bank Soal'
                            : isEdit
                            ? 'Simpan Perubahan'
                            : 'Simpan sebagai Draft'}
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
