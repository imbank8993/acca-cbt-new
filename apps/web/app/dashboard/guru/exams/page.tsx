"use client";
import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    ClipboardCheck, Plus, Search, Calendar, Play,
    Trash2, Clock, Loader2, X, Check, Users,
    Settings, ChevronRight, CheckCircle2, Globe, GlobeLock,
    Info, BookOpen, AlertCircle, Eye, EyeOff, Filter,
    CalendarDays, FolderOpen, GraduationCap, Lock, Unlock, Zap, Shield, ChevronDown, FileText
} from 'lucide-react';
import {
    getProctorOrganization,
    listOrganizationExams,
    createExamAction,
    listOrganizationClasses,
    listClassStudents,
    assignExamAction,
    editExamAction,
    publishExamAction,
    listSchoolYears,
    createSchoolYearAction,
    listExamAssignmentsAction
} from '@/lib/api/proctor';
import { deleteExam } from '@/lib/api/exams';
import { listQuestionBanks, listOrganizationLabels, createOrganizationLabel } from '@/lib/api/questions';
import { getSessionUser } from '@/lib/session';
import { REFRESH_INTERVAL, useAutoRefresh } from '@/lib/useAutoRefresh';
import { listExamConfigs, getExamConfig, createExamConfigAction, deleteExamConfigAction, lockExamConfigAction, addExamConfigBankAction, removeExamConfigBankAction, addExamConfigExamAction, removeExamConfigExamAction, generateExamsFromConfigAction  } from '@/lib/api/exam-configs';
import { listSubjects } from '@/lib/api/pas';
import { useRouter } from 'next/navigation';
import { useMemoryState } from '@/lib/useMemoryState';

type TabId = 'all' | 'draft' | 'active' | 'finished' | 'pas';
type SortBy = 'newest' | 'oldest' | 'name';

// Helper: Convert UTC ISO string to WIB datetime-local format for input display
// WIB = UTC+7
const utcToLocalDateTime = (utcStr: string): string => {
    if (!utcStr) return '';
    // Parse as UTC
    const date = new Date(utcStr.match(/(Z|[+-]\d{2}:\d{2})$/) ? utcStr : utcStr + 'Z');
    if (isNaN(date.getTime())) return '';
    // Convert to WIB (UTC+7) by adding 7 hours
    const wibDate = new Date(date.getTime() + (7 * 60 * 60 * 1000));
    const year = wibDate.getUTCFullYear();
    const month = String(wibDate.getUTCMonth() + 1).padStart(2, '0');
    const day = String(wibDate.getUTCDate()).padStart(2, '0');
    const hours = String(wibDate.getUTCHours()).padStart(2, '0');
    const minutes = String(wibDate.getUTCMinutes()).padStart(2, '0');
    return `${year}-${month}-${day}T${hours}:${minutes}`;
};

const ExamsPage = () => {
    const [exams, setExams] = useMemoryState<any[]>('guru_exams_exams', []);
    const [qBanks, setQBanks] = useMemoryState<any[]>('guru_exams_qBanks', []);
    const [org, setOrg] = useState<any>(null);
    const [classes, setClasses] = useMemoryState<any[]>('guru_exams_classes', []);
    const [isLoading, setIsLoading] = useMemoryState('guru_exams_isLoading', true);
    const [searchQuery, setSearchQuery] = useState('');
    const router = useRouter();
    const [students, setStudents] = useMemoryState<any[]>('guru_exams_students', []);
    const [activeTab, setActiveTab] = useState<TabId>('all');
    const [typeFilter, setTypeFilter] = useState<string>('all');
    const [sortBy, setSortBy] = useState<SortBy>('newest');

    // Labels state
    const [labels, setLabels] = useMemoryState<any[]>('guru_exams_labels', []);
    const getLabelColor = (name: string) => labels.find(l => l.name === name)?.color || '#6366f1';

    // Subjects state
    const [subjects, setSubjects] = useMemoryState<any[]>('guru_exams_subjects', []);

    // FOLDER / Exam Config state
    const [examConfigs, setExamConfigs] = useMemoryState<any[]>('guru_exams_examConfigs', []);
    const [selectedConfigId, setSelectedConfigId] = useState<string | null>(null);
    const [selectedConfig, setSelectedConfig] = useState<any>(null);
    const [configBanks, setConfigBanks] = useMemoryState<any[]>('guru_exams_configBanks', []);
    const [configExams, setConfigExams] = useMemoryState<any[]>('guru_exams_configExams', []);
    const [selectedConfigExamIds, setSelectedConfigExamIds] = useMemoryState<string[]>('guru_exams_selectedConfigExamIds', []);
    const [isLoadingConfig, setIsLoadingConfig] = useState(false);
    const [isGenerating, setIsGenerating] = useState(false);
    const [isConfigDetailOpen, setIsConfigDetailOpen] = useState(false);

    // Folder config modal
    const [isConfigModalOpen, setIsConfigModalOpen] = useState(false);
    const [configForm, setConfigForm] = useState({
        name: '', school_year: '', semester: '',
        start_date: '', end_date: ''
    });
    const [schoolYears, setSchoolYears] = useMemoryState<any[]>('guru_exams_schoolYears', []);
    const [isYearDropdownOpen, setIsYearDropdownOpen] = useState(false);
    const [isSubmittingConfig, setIsSubmittingConfig] = useState(false);

    // Add bank modal
    const [isAddBankModalOpen, setIsAddBankModalOpen] = useState(false);
    const [addBankForm, setAddBankForm] = useState({
        bank_id: '', subject_id: '' as string, duration_minutes: 90
    });

    // Add class modal
    const [isAddClassModalOpen, setIsAddClassModalOpen] = useState(false);
    const [addClassForm, setAddClassForm] = useState({
        bank_id: '', class_ids: [] as string[],
        scheduled_date: '', scheduled_time: '', window_end_time: ''
    });
    const [formData, setFormData] = useState({
        title: '',
        description: '',
        examType: 'daily' as 'daily' | 'pas' | 'pat' | 'assignment' | 'lainnya',
        duration: 60,
        randomizeQuestions: true,
        randomizeOptions: true,
        showResults: false,
        isSafeMode: true,
        bankId: '',
        startTime: '',
        endTime: '',
        selectedClassIds: [] as string[],
        scoringTypes: ['classical'] as string[],
        isForever: false,
        isPublic: false,
        documentUrl: '',
        videoUrl: '',
        // Assignment-specific fields
        assignmentDescription: '',
        allowFileUpload: false,
        allowedFileTypes: ['pdf'] as string[],
        requireBank: true,
    });
    // Enhanced assignment state: per-class student selection
    const [classAssignments, setClassAssignments] = useState<Record<string, { mode: 'all' | 'selected', studentIds: string[] }>>({});
    const [assignData, setAssignData] = useState<{classIds: string[], userIds: string[]}>({ classIds: [], userIds: [] });
    const [examAssignments, setExamAssignments] = useState<Record<string, { classCount: number, studentCount: number }>>({});
    const [classStudents, setClassStudents] = useState<Record<string, any[]>>({});
    const [selectedClassForStudents, setSelectedClassForStudents] = useState<string | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    // Per-exam publish/unpublish in-flight id, so ONLY the clicked card's button
    // shows a spinner (the shared isSubmitting can't tell buttons apart).
    const [publishingId, setPublishingId] = useState<string | null>(null);
    // Modals
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [isAssignModalOpen, setIsAssignModalOpen] = useState(false);
    const [isScoringDropdownOpen, setIsScoringDropdownOpen] = useState(false);
    const [selectedExam, setSelectedExam] = useState<any>(null);

    const SCORING_OPTIONS = [
        { value: 'classical', label: 'Klasik (Total Benar)' },
        { value: 'irt_1pl', label: 'IRT (1 Parameter Logistic)', info: 'Ideal untuk >100 peserta.' },
        { value: 'irt_2pl', label: 'IRT (2 Parameter Logistic)', info: 'Ideal untuk >200 peserta.' },
        { value: 'irt_3pl', label: 'IRT (3 Parameter Logistic)', info: 'Ideal untuk >500 peserta.' }
    ];

    useEffect(() => { loadData(); }, []);

    const loadData = async () => {
        // setIsLoading(true); // Disabled for silent background sync
        try {
            const user = await getSessionUser();
            if (user) {
                const organization = await getProctorOrganization();
                if (organization) {
                    setOrg(organization);
                    const [examList, bankList, classList, pasPeriodList, labelList, subjectList, schoolYearList] = await Promise.all([
                        listOrganizationExams(organization.id),
                        listQuestionBanks(organization.id, true),
                        listOrganizationClasses(organization.id, { activeYearOnly: true }),
                        listExamConfigs(organization.id),
                        listOrganizationLabels(organization.id),
                        listSubjects(organization.id),
                        listSchoolYears(organization.id),
                    ]);

                    // Fetch existing exam assignments via SERVER ACTION — query
                    // langsung dari client memakai anon key sehingga RLS memblokir
                    // cbt_exam_targets/participants dan status selalu "belum ditugaskan".
                    const examIds = examList.map((e: any) => e.id);
                    const { targets: targetRows, participants: participantRows } =
                        await listExamAssignmentsAction(examIds);

                    // Build assignment map
                    const assignmentMap: Record<string, { classCount: number, studentCount: number }> = {};
                    const classStudentCountMap: Record<string, number> = {};
                    for (const cls of classList) classStudentCountMap[cls.id] = cls.studentCount || 0;

                    for (const t of targetRows) {
                        if (!assignmentMap[t.exam_id]) assignmentMap[t.exam_id] = { classCount: 0, studentCount: 0 };
                        assignmentMap[t.exam_id].classCount++;
                        // Add all students from this class (reguler or tambahan)
                        const clsKey = t.class_id || t.additional_class_id || '';
                        assignmentMap[t.exam_id].studentCount += classStudentCountMap[clsKey] || 0;
                    }
                    // Individual participants (for susulan)
                    for (const p of participantRows) {
                        if (!assignmentMap[p.exam_id]) assignmentMap[p.exam_id] = { classCount: 0, studentCount: 0 };
                        assignmentMap[p.exam_id].studentCount++;
                    }

                    setExams(examList || []);
                    setQBanks(bankList || []);
                    setClasses(classList || []);
                    setExamConfigs(pasPeriodList || []);
                    setConfigBanks(bankList || []);
                    setClasses(classList || []);
                    setLabels(labelList || []);
                    setSubjects(subjectList || []);
                    setSchoolYears(schoolYearList || []);
                    setExamAssignments(assignmentMap);

                    // Pre-load students for all classes via SERVER ACTION.
                    // Query langsung dari client memakai anon key (service role tidak ada di browser)
                    // sehingga RLS memblokir cbt_class_members/cbt_profiles → siswa tampil 0.
                    const studentMap = await listClassStudents(classList.map((c: any) => c.id));
                    setClassStudents(studentMap);
                }
            }
        } catch (err) {
            console.error('Failed to load exams page data:', err);
        } finally {
            setIsLoading(false);
        }
    };

    // Daftar ujian disegarkan berkala; langganan realtime Supabase sudah tidak ada.
    useAutoRefresh(loadData, REFRESH_INTERVAL.dashboard);

    const refreshExamAssignment = async (examId: string) => {
        const { targets, participants } = await listExamAssignmentsAction([examId]);

        let studentCount = 0;
        for (const t of targets) {
            const clsKey = t.class_id || t.additional_class_id || '';
            studentCount += (classStudents[clsKey] || []).length;
        }
        studentCount += participants.length;

        setExamAssignments(prev => ({
            ...prev,
            [examId]: { classCount: targets.length, studentCount }
        }));
    };

    const handleCreateExam = async (e: React.FormEvent) => {
        e.preventDefault();
        const user = await getSessionUser();
        if (!org || !user) return;
        // Skip bank validation if: PAS type OR assignment without requireBank
        const skipBankValidation = formData.examType === 'pas' || 
            (formData.examType === 'assignment' && !formData.requireBank);
        if (!skipBankValidation && !formData.bankId) {
            alert('Pilih Bank Soal terlebih dahulu.');
            return;
        }
        setIsSubmitting(true);
        const result = await createExamAction({
            orgId: org.id,
            title: formData.title,
            description: formData.description,
            duration: formData.duration,
            examType: formData.examType,
            startTime: formData.startTime || undefined,
            endTime: formData.endTime || undefined,
            randomizeQuestions: formData.randomizeQuestions,
            randomizeOptions: formData.randomizeOptions,
            showResults: formData.showResults,
            isSafeMode: formData.isSafeMode,
            questionBankId: formData.requireBank || formData.examType !== 'assignment' ? formData.bankId : undefined,
            scoringType: formData.scoringTypes.join(','),
            isPublic: formData.isPublic,
            documentUrl: formData.documentUrl,
            videoUrl: formData.videoUrl,
            assignmentDescription: formData.assignmentDescription,
            allowFileUpload: formData.allowFileUpload,
            allowedFileTypes: formData.allowedFileTypes,
            requireBank: formData.requireBank,
        });
        if (!result.success) {
            alert(result.error);
            setIsSubmitting(false);
            return;
        }
        {
            // Assign selected classes immediately
            if (formData.selectedClassIds.length > 0) {
                await assignExamAction(result.id, formData.selectedClassIds, [], false);
            }
            setIsAddModalOpen(false);
            setFormData({
                title: '', description: '', examType: 'daily' as any, duration: 60,
                randomizeQuestions: true, randomizeOptions: true,
                showResults: false, isSafeMode: true, bankId: qBanks[0]?.id || '',
                startTime: '', endTime: '', selectedClassIds: [],
                scoringTypes: ['classical'],
                isForever: false, isPublic: false, documentUrl: '', videoUrl: '',
                assignmentDescription: '', allowFileUpload: false, allowedFileTypes: ['pdf'], requireBank: true,
            });
            await loadData();
        }
        setIsSubmitting(false);
    };

    const handleEditExam = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedExam) return;
        setIsSubmitting(true);

        // Log what we're sending
        console.log('[handleEditExam] startTime:', JSON.stringify(formData.startTime), 'endTime:', JSON.stringify(formData.endTime));

        const result = await editExamAction(selectedExam.id, {
            title: formData.title,
            description: formData.description,
            examType: formData.examType,
            duration: formData.duration,
            startTime: formData.startTime || undefined,
            endTime: formData.endTime || undefined,
            randomizeQuestions: formData.randomizeQuestions,
            randomizeOptions: formData.randomizeOptions,
            showResults: formData.showResults,
            isSafeMode: formData.isSafeMode,
            scoringType: formData.scoringTypes.join(','),
            isPublic: formData.isPublic,
            documentUrl: formData.documentUrl,
            videoUrl: formData.videoUrl,
            assignmentDescription: formData.assignmentDescription,
            allowFileUpload: formData.allowFileUpload,
            allowedFileTypes: formData.allowedFileTypes,
            requireBank: formData.requireBank,
        });
        if (result.success) {
            setIsEditModalOpen(false);
            setSelectedExam(null);
            await loadData();
        } else {
            alert(result.error || 'Gagal menyimpan');
        }
        setIsSubmitting(false);
    };

    const handleAssignExam = async () => {
        if (!selectedExam) return;
        setIsSubmitting(true);

        // Determine which class-level targets vs individual participants
        const targetClassIds: string[] = [];
        const participantUserIds: string[] = [];

        for (const clsId of assignData.classIds) {
            const assignment = classAssignments[clsId] || { mode: 'all', studentIds: [] };
            if (assignment.mode === 'all') {
                targetClassIds.push(clsId);
            } else {
                // Individual students only
                participantUserIds.push(...assignment.studentIds);
            }
        }

        const activate = !selectedExam.is_published;
        const result = await assignExamAction(selectedExam.id, targetClassIds, participantUserIds, activate);
        if (result.success) {
            setIsAssignModalOpen(false);
            setSelectedExam(null);
            setClassAssignments({});
            await loadData();
        } else {
            alert(result.error || 'Gagal assign');
        }
        setIsSubmitting(false);
    };

    const handlePublishToggle = async (exam: any) => {
        const assignment = examAssignments[exam.id] || { classCount: 0, studentCount: 0 };
        const isPublic = exam.metadata?.is_public === true;
        // Penugasan bisa berupa kelas penuh (classCount) ATAU siswa terpilih
        // saja (studentCount tanpa classCount) — keduanya sah untuk publish.
        if (!exam.is_published && assignment.classCount === 0 && assignment.studentCount === 0 && !isPublic) {
            // Not yet assigned — open assign modal instead
            openAssign(exam);
            return;
        }
        setIsSubmitting(true);
        setPublishingId(exam.id);
        try {
            const result = await publishExamAction(exam.id, !exam.is_published);
            if (result.success) {
                await loadData();
            } else {
                alert(result.error || 'Gagal mengubah status');
            }
        } finally {
            setPublishingId(null);
            setIsSubmitting(false);
        }
    };

    const handleDeleteExam = async (examId: string) => {
        if (!confirm('Yakin ingin menghapus ujian ini? Semua data pengerjaan akan ikut terhapus.')) return;
        setIsLoading(true);
        const result = await deleteExam(examId);
        if (result.success) await loadData();
        setIsLoading(false);
    };

    const getExamStatus = (e: any) => {
        const now = new Date();
        const start = e.start_time ? new Date(e.start_time) : null;
        const end = e.end_time ? new Date(e.end_time) : null;
        const isFinished = e.status === 'finished' || (end ? end < now : false);
        const isActive = !!e.is_published && (!start || start <= now) && (!end || end >= now) && !isFinished;
        if (!e.is_published) return 'draft';
        if (isActive) return 'active';
        if (isFinished) return 'finished';
        return 'unknown';
    };

    const getExamTabFilter = (e: any, tabId: TabId): boolean => {
        if (typeFilter !== 'all' && e.exam_type !== typeFilter) return false;
        if (tabId === 'all') return true;
        return getExamStatus(e) === tabId;
    };

    const filterByTab = (examList: any[]): any[] => {
        return examList.filter(e => getExamTabFilter(e, activeTab));
    };

    const sortExams = (list: any[]): any[] => {
        return [...list].sort((a, b) => {
            if (sortBy === 'name') return (a.title || '').localeCompare(b.title || '');
            if (sortBy === 'oldest') return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
            return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        });
    };

    const filteredExams = sortExams(
        filterByTab(exams).filter(e =>
            e.title?.toLowerCase().includes(searchQuery.toLowerCase())
        )
    );

    const tabs: { id: TabId; label: string; icon: any; color: string }[] = [
        { id: 'all', label: 'Semua', icon: FolderOpen, color: 'text-slate-500' },
        { id: 'draft', label: 'Draft', icon: AlertCircle, color: 'text-amber-500' },
        { id: 'active', label: 'Aktif', icon: Zap, color: 'text-emerald-500' },
        { id: 'finished', label: 'Selesai', icon: CheckCircle2, color: 'text-slate-400' },
    ];

    const openEdit = (exam: any) => {
        setSelectedExam(exam);
        setFormData({
            title: exam.title || '',
            description: exam.description || '',
            examType: exam.exam_type || 'daily',
            duration: exam.duration_minutes || 60,
            randomizeQuestions: exam.randomize_questions ?? true,
            randomizeOptions: exam.randomize_options ?? true,
            showResults: exam.show_results ?? false,
            isSafeMode: exam.metadata?.is_safe_mode ?? true,
            bankId: exam.question_bank_id || '',
            // Convert UTC ISO string to local datetime-local format for input display
            startTime: exam.start_time ? utcToLocalDateTime(exam.start_time) : '',
            endTime: exam.end_time ? utcToLocalDateTime(exam.end_time) : '',
            scoringTypes: exam.scoring_type ? exam.scoring_type.split(',') : ['classical'],
            isForever: !exam.start_time && !exam.end_time,
            isPublic: exam.metadata?.is_public ?? false,
            documentUrl: exam.metadata?.document_url || '',
            videoUrl: exam.metadata?.video_url || '',
            selectedClassIds: [],
            // Assignment fields
            assignmentDescription: exam.metadata?.assignment_description || '',
            allowFileUpload: exam.metadata?.allow_file_upload ?? false,
            allowedFileTypes: exam.metadata?.allowed_file_types || ['pdf'],
            requireBank: exam.metadata?.require_bank ?? true,
        });
        setIsEditModalOpen(true);
    };

    const openAssign = (exam: any) => {
        setSelectedExam(exam);
        // Load existing assignment
        loadExamAssignments(exam.id).then(existing => {
            setAssignData({ classIds: existing.classIds, userIds: [] });
            // Load existing individual participants per class
            const existingParticipants = existing.participants;
            const defaults: Record<string, { mode: 'all' | 'selected', studentIds: string[] }> = {};
            for (const clsId of existing.classIds) {
                const classParticipants = existingParticipants
                    .filter((p: any) => p.class_id === clsId)
                    .map((p: any) => p.user_id);
                defaults[clsId] = classParticipants.length > 0
                    ? { mode: 'selected', studentIds: classParticipants }
                    : { mode: 'all', studentIds: [] };
            }
            // Also add classes with no targets (but we set them as 'all' by default)
            for (const cls of classes) {
                if (!defaults[cls.id]) {
                    defaults[cls.id] = { mode: 'all', studentIds: [] };
                }
            }
            setClassAssignments(defaults);
        });
        setIsAssignModalOpen(true);
    };

    const loadExamAssignments = async (examId: string) => {
        const { targets, participants } = await listExamAssignmentsAction([examId]);
        // Kelas terpilih = target kelas penuh + kelas asal peserta individual
        // (kelas mode "siswa terpilih" tidak punya baris target, hanya peserta).
        const classIds = [...new Set([
            ...targets.map((t) => t.class_id || t.additional_class_id),
            ...participants.map((p) => p.class_id),
        ].filter(Boolean) as string[])];
        return { classIds, participants };
    };

    const formatDateTime = (str: string | null) => {
        if (!str) return '-';
        const date = new Date(str.match(/(Z|[+-]\d{2}:\d{2})$/) ? str : str + 'Z');
        if (isNaN(date.getTime())) return '-';
        // Convert UTC to WIB (UTC+7)
        const wibDate = new Date(date.getTime() + (7 * 60 * 60 * 1000));
        const day = String(wibDate.getUTCDate()).padStart(2, '0');
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
        const month = months[wibDate.getUTCMonth()];
        const year = wibDate.getUTCFullYear();
        const h = String(wibDate.getUTCHours()).padStart(2, '0');
        const m = String(wibDate.getUTCMinutes()).padStart(2, '0');
        return `${day} ${month} ${year} ${h}:${m} WIB`;
    };

    const getExamWindow = (exam: any) => {
        if (!exam.start_time && !exam.end_time) return 'Kapan saja';
        if (exam.start_time && !exam.end_time) return `Mulai ${formatDateTime(exam.start_time)}`;
        return `${formatDateTime(exam.start_time)} - ${formatDateTime(exam.end_time)}`;
    };

    const publishedBanks = qBanks.filter(b => b.is_published);
    const draftBanks = qBanks.filter(b => !b.is_published);


    // ─── Folder / Exam Config helpers ─────────────────────────
    const openConfigDetail = async (configId: string) => {
        setSelectedConfigId(configId);
        setIsLoadingConfig(true);
        setIsConfigDetailOpen(false);
        setSelectedConfigExamIds([]);
        try {
            const data = await getExamConfig(configId);
            setSelectedConfig(data);
            setConfigBanks((data as any)?.exam_config_banks || []);
            setConfigExams((data as any)?.exam_config_exams || []);
            setIsConfigDetailOpen(true);
        } catch (err) { console.error(err); }
        setIsLoadingConfig(false);
    };

    const handleCreateConfig = async (e: React.FormEvent) => {
        e.preventDefault();
        const user = await getSessionUser();
        if (!org || !user) return;
        if (!configForm.name.trim()) { alert('Isi nama folder.'); return; }
        setIsSubmittingConfig(true);

        let targetSchoolYear = configForm.school_year.trim();
        if (targetSchoolYear) {
            const yearPattern = /^\d{4}\/\d{4}$/;
            if (!yearPattern.test(targetSchoolYear)) {
                alert('Format tahun ajaran harus YYYY/YYYY, contoh: 2024/2025');
                setIsSubmittingConfig(false);
                return;
            }

            const exists = schoolYears.some(sy => sy.year.trim() === targetSchoolYear);
            if (!exists) {
                const addSyResult = await createSchoolYearAction(org.id, { year: targetSchoolYear });
                if (!addSyResult.success) {
                    alert('Gagal menambah tahun ajaran baru: ' + (addSyResult.error || 'Unknown error'));
                    setIsSubmittingConfig(false);
                    return;
                }
            }
        }

        const result = await createExamConfigAction(org.id, {
            name: configForm.name,
            school_year: targetSchoolYear || undefined,
            semester: configForm.semester || undefined,
            start_date: configForm.start_date || undefined,
            end_date: configForm.end_date || undefined,
        });
        setIsSubmittingConfig(false);
        if (!result.success) {
            alert('Gagal: ' + result.error);
            return;
        }
        setIsConfigModalOpen(false);
        setConfigForm({ name: '', school_year: '', semester: '', start_date: '', end_date: '' });
        const list = await listExamConfigs(org.id);
        setExamConfigs(list);
        const syList = await listSchoolYears(org.id);
        setSchoolYears(syList || []);
    };

    const handleDeleteConfig = async (configId: string) => {
        if (!confirm('Hapus folder ini beserta semua jadwal?')) return;
        const result = await deleteExamConfigAction(configId);
        if (result.success) {
            const list = await listExamConfigs(org.id);
            setExamConfigs(list);
            if (selectedConfigId === configId) {
                setSelectedConfigId(null);
                setSelectedConfig(null);
                setIsConfigDetailOpen(false);
            }
        } else { alert('Gagal: ' + (result.error || 'Unknown error')); }
    };

    const handleToggleConfigLock = async (configId: string, currentLock: boolean) => {
        const result = await lockExamConfigAction(configId, !currentLock);
        if (result.success) {
            const list = await listExamConfigs(org.id);
            setExamConfigs(list);
            if (selectedConfigId === configId) {
                const updated = await getExamConfig(configId);
                setSelectedConfig(updated);
            }
        }
    };

    const handleAddBankToConfig = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedConfigId) return;
        if (!addBankForm.bank_id) { alert('Pilih bank soal.'); return; }
        const result = await addExamConfigBankAction({
            exam_config_id: selectedConfigId,
            bank_id: addBankForm.bank_id,
            subject_id: addBankForm.subject_id || undefined,
            duration_minutes: addBankForm.duration_minutes,
        });
        if (result.success) {
            setIsAddBankModalOpen(false);
            setAddBankForm({ bank_id: '', subject_id: '' as string, duration_minutes: 90 });
            await openConfigDetail(selectedConfigId);
        } else { alert('Gagal: ' + (result.error || 'Unknown error')); }
    };

    const handleRemoveBankFromConfig = async (bankId: string) => {
        if (!confirm('Hapus bank soal dari folder?')) return;
        const result = await removeExamConfigBankAction(bankId);
        if (!result.success) {
            alert('Gagal: ' + result.error);
            return;
        }
        if (selectedConfigId) await openConfigDetail(selectedConfigId);
    };

    const handleAddClassExam = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedConfigId) return;
        if (!addClassForm.bank_id) { alert('Pilih bank soal.'); return; }
        if (addClassForm.class_ids.length === 0) { alert('Pilih minimal 1 kelas.'); return; }
        if (!addClassForm.scheduled_date) { alert('Isi tanggal.'); return; }
        if (!addClassForm.scheduled_time) { alert('Isi jam mulai.'); return; }
        if (!addClassForm.window_end_time) { alert('Isi window tutup.'); return; }
        let added = 0;
        for (const classId of addClassForm.class_ids) {
            const result = await addExamConfigExamAction({
                exam_config_id: selectedConfigId,
                exam_config_bank_id: addClassForm.bank_id,
                class_id: classId,
                scheduled_date: addClassForm.scheduled_date,
                scheduled_time: addClassForm.scheduled_time,
                window_end_time: addClassForm.window_end_time,
            });
            if (result.success) added++;
        }
        if (added > 0) {
            setIsAddClassModalOpen(false);
            setAddClassForm({ bank_id: '', class_ids: [], scheduled_date: '', scheduled_time: '', window_end_time: '' });
            if (selectedConfigId) await openConfigDetail(selectedConfigId);
        } else { alert('Gagal menyimpan jadwal.'); }
    };

    const handleRemoveConfigExam = async (configExamId: string) => {
        if (!confirm('Hapus jadwal ini?')) return;
        const result = await removeExamConfigExamAction(configExamId);
        if (result.success && selectedConfigId) await openConfigDetail(selectedConfigId);
    };

    const handleGenerateConfigExams = async () => {
        if (selectedConfigExamIds.length === 0) { alert('Pilih jadwal terlebih dahulu.'); return; }
        if (!confirm(`Generate ujian untuk ${selectedConfigExamIds.length} jadwal?`)) return;
        setIsGenerating(true);
        const result = await generateExamsFromConfigAction(selectedConfigExamIds);
        setIsGenerating(false);
        if (result.success) {
            alert(`Berhasil membuat ${result.created} ujian!${result.skipped?.length ? '\nLewati: ' + result.skipped.join(', ') : ''}`);
            setSelectedConfigExamIds([]);
            if (selectedConfigId) await openConfigDetail(selectedConfigId);
        } else { alert(result.error || 'Gagal generate.'); }
    };

    const toggleConfigExamSelection = (id: string) => {
        setSelectedConfigExamIds(prev =>
            prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]
        );
    };
    return (
        <div className="max-w-7xl mx-auto pb-24">

            {/* ── Hero Header — Navy Gradient ── */}
            {/* ── Stats Grid ── */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
                {[
                    { id: 'all', label: 'Semua' },
                    { id: 'daily', label: 'Ulangan Harian' },
                    { id: 'assignment', label: 'Tugas' },
                    { id: 'lainnya', label: 'Ujian Lainnya' }
                ].map(type => {
                    let draft = 0;
                    let active = 0;
                    let finished = 0;
                    let total = 0;

                    if (type.id === 'pas') {
                        total = examConfigs.length;
                        examConfigs.forEach(p => {
                            const now = new Date();
                            const start = new Date(p.start_date);
                            const end = new Date(p.end_date);
                            const isActive = start <= now && end >= now && !p.is_locked;
                            const isFinished = end < now;
                            if (isActive) active++;
                            else if (isFinished) finished++;
                            else draft++;
                        });
                    } else {
                        const typeExams = type.id === 'all' ? exams : exams.filter(e => e.exam_type === type.id);
                        total = typeExams.length;
                        draft = typeExams.filter(e => getExamStatus(e) === 'draft').length;
                        active = typeExams.filter(e => getExamStatus(e) === 'active').length;
                        finished = typeExams.filter(e => getExamStatus(e) === 'finished').length;
                    }
                    
                    const isSelected = typeFilter === type.id;
                    
                    return (
                        <div 
                            key={type.id} 
                            onClick={() => setTypeFilter(type.id as any)}
                            className={`bg-white rounded-xl p-4 flex flex-col items-center justify-center min-h-[100px] text-center cursor-pointer transition-all duration-200 hover:-translate-y-1 ${
                                isSelected 
                                ? 'border-2 border-[#030C4D] shadow-md ring-4 ring-[#030C4D]/10' 
                                : 'border border-[#030C4D]/20 shadow-sm hover:shadow-md'
                            }`}
                        >
                            <h3 className={`font-bold text-[10px] xl:text-[11px] uppercase tracking-wider mb-1 ${isSelected ? 'text-[#030C4D]' : 'text-slate-500'}`}>{type.label}</h3>
                            <span className="text-3xl font-black text-[#030C4D] leading-none mb-2.5">{total}</span>
                            
                        </div>
                    );
                })}
            </div>

            {/* Tab Navigation */}
            <div className="grid grid-cols-2 lg:flex lg:flex-row gap-2 mb-6">
                {tabs.map(tab => {
                    const Icon = tab.icon;
                    let count = 0;
                    if (typeFilter === 'pas') {
                        count = examConfigs.filter(p => {
                            const now = new Date();
                            const start = new Date(p.start_date);
                            const end = new Date(p.end_date);
                            const isActive = start <= now && end >= now && !p.is_locked;
                            const isFinished = end < now;
                            const isDraft = !isActive && !isFinished;
                            
                            if (tab.id === 'all') return true;
                            if (tab.id === 'draft') return isDraft;
                            if (tab.id === 'active') return isActive;
                            if (tab.id === 'finished') return isFinished;
                            return false;
                        }).length;
                    } else {
                        count = exams.filter(e => getExamTabFilter(e, tab.id)).length;
                    }
                    const isActive = activeTab === tab.id;
                    return (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={`flex items-center justify-center gap-1.5 sm:gap-2 px-2 sm:px-4 py-2.5 rounded-lg font-medium text-xs sm:text-sm transition-all whitespace-nowrap shrink-0 ${
                                isActive
                                    ? 'bg-[#030C4D] text-white shadow-lg'
                                    : 'bg-white text-slate-600 border border-[#030C4D]/30 hover:border-[#030C4D] hover:bg-[#030C4D]/5'
                            }`}
                        >
                            <Icon size={16} className={isActive ? 'text-white' : tab.color} />
                            <span>{tab.label}</span>
                            <span className={`ml-auto lg:ml-0 px-2 py-0.5 rounded-full text-[10px] sm:text-xs font-bold ${
                                isActive
                                    ? 'bg-white/20 text-white'
                                    : 'bg-[#030C4D]/10 text-[#030C4D]'
                            }`}>
                                {count}
                            </span>
                        </button>
                    );
                })}
            </div>

            {/* Search + Filters + Sort */}
            {typeFilter !== 'pas' && (
                <div className="flex flex-col sm:flex-row gap-3 mb-6">
                    <div className="relative flex-1">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                        <input
                            type="text"
                            placeholder="Cari ujian..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full bg-white border border-[#030C4D]/30 rounded-lg py-3 pl-10 pr-4 text-sm focus:ring-2 focus:ring-[#030C4D]/20 focus:border-[#030C4D] outline-none"
                        />
                    </div>
                    <div className="relative w-full sm:w-auto">
                        <select
                            value={typeFilter}
                            onChange={e => setTypeFilter(e.target.value as any)}
                            className="w-full appearance-none bg-white border border-[#030C4D]/30 rounded-lg pl-4 pr-10 py-3 text-sm focus:ring-2 focus:ring-[#030C4D]/20 outline-none text-slate-600 cursor-pointer"
                        >
                            <option value="all">Semua Jenis Ujian</option>
                            <option value="daily">Ulangan Harian</option>
                            <option value="assignment">Tugas</option>
                            <option value="lainnya">Ujian Lainnya</option>
                        </select>
                        <ChevronDown className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={16} />
                    </div>
                    <div className="relative w-full sm:w-auto">
                        <select
                            value={sortBy}
                            onChange={e => setSortBy(e.target.value as SortBy)}
                            className="w-full appearance-none bg-white border border-[#030C4D]/30 rounded-lg pl-4 pr-10 py-3 text-sm focus:ring-2 focus:ring-[#030C4D]/20 outline-none text-slate-600 cursor-pointer"
                        >
                            <option value="newest">Terbaru</option>
                            <option value="oldest">Terlama</option>
                            <option value="name">Nama</option>
                        </select>
                        <ChevronDown className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={16} />
                    </div>
                    <button
                        onClick={() => setIsAddModalOpen(true)}
                        className="px-5 py-3 text-sm bg-[#030C4D] text-white rounded-lg hover:bg-[#020510] flex items-center justify-center gap-2 font-semibold shadow-lg shadow-[#030C4D]/20 whitespace-nowrap cursor-pointer"
                    >
                        <Plus size={16} /> Buat Ujian Baru
                    </button>
                </div>
            )}


            {/* ─────────────── CREATE FOLDER CONFIG MODAL ─────────────── */}
            <AnimatePresence>
                {isConfigModalOpen && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
                        <motion.div
                            initial={{ scale: 0.95, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.95, opacity: 0 }}
                            className="bg-white w-full max-w-md rounded-2xl p-6 relative border border-[#030C4D]/30"
                        >
                            <button onClick={() => setIsConfigModalOpen(false)} className="absolute top-4 right-4 text-slate-400 hover:text-slate-600">
                                <X size={20} />
                            </button>
                            <div className="flex items-center gap-3 mb-6 pb-4 border-b border-[#030C4D]/20">
                                <div className="w-10 h-10 rounded-lg bg-[#030C4D]/10 text-[#030C4D] flex items-center justify-center border border-[#030C4D]/30">
                                    <FolderOpen size={18} />
                                </div>
                                <div>
                                    <h3 className="text-lg font-bold text-slate-900">Folder Ujian Baru</h3>
                                    <p className="text-xs text-slate-500">Kelompokkan bank soal + jadwal</p>
                                </div>
                            </div>
                            <form onSubmit={handleCreateConfig} className="space-y-4">
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1.5">Nama Folder *</label>
                                    <input
                                        required type="text" placeholder="Contoh: PAS Genap 2024/2025"
                                        value={configForm.name}
                                        onChange={e => setConfigForm(p => ({ ...p, name: e.target.value }))}
                                        className="w-full border border-[#030C4D]/30 rounded-xl p-3 text-sm focus:ring-2 focus:ring-[#030C4D]/20 outline-none"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1.5">Tahun Ajaran</label>
                                    <div className="relative">
                                        <input
                                            type="text"
                                            placeholder="Contoh: 2024/2025"
                                            value={configForm.school_year}
                                            onChange={e => {
                                                setConfigForm(p => ({ ...p, school_year: e.target.value }));
                                                setIsYearDropdownOpen(true);
                                            }}
                                            onFocus={() => setIsYearDropdownOpen(true)}
                                            className="w-full border border-[#030C4D]/30 rounded-xl p-3 text-sm focus:ring-2 focus:ring-[#030C4D]/20 outline-none"
                                        />
                                        {isYearDropdownOpen && (
                                            <>
                                                <div 
                                                    className="fixed inset-0 z-10" 
                                                    onClick={() => setIsYearDropdownOpen(false)}
                                                />
                                                <div className="absolute z-20 w-full mt-1 bg-white border border-[#030C4D]/20 rounded-xl shadow-lg max-h-48 overflow-y-auto">
                                                    {schoolYears.length > 0 ? (
                                                        (() => {
                                                            const filtered = schoolYears.filter(sy => 
                                                                sy.year?.toLowerCase().includes(configForm.school_year.toLowerCase())
                                                            );
                                                            return filtered.length > 0 ? (
                                                                filtered.map((sy, i) => (
                                                                    <button
                                                                        key={i}
                                                                        type="button"
                                                                        className="w-full text-left px-4 py-2.5 text-sm hover:bg-[#030C4D]/5 text-slate-700 transition-colors border-b border-slate-100 last:border-0"
                                                                        onClick={() => {
                                                                            setConfigForm(p => ({ ...p, school_year: sy.year }));
                                                                            setIsYearDropdownOpen(false);
                                                                        }}
                                                                    >
                                                                        {sy.year}
                                                                    </button>
                                                                ))
                                                            ) : (
                                                                <div className="px-4 py-2.5 text-xs text-slate-500 italic">
                                                                    Tekan enter/simpan untuk menambah &quot;{configForm.school_year}&quot;
                                                                </div>
                                                            );
                                                        })()
                                                    ) : (
                                                        <div className="px-4 py-2.5 text-xs text-slate-500 italic">
                                                            Belum ada data. Ketik untuk membuat baru.
                                                        </div>
                                                    )}
                                                </div>
                                            </>
                                        )}
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1.5">Semester</label>
                                    <select value={configForm.semester}
                                        onChange={e => setConfigForm(p => ({ ...p, semester: e.target.value }))}
                                        className="w-full border border-[#030C4D]/30 rounded-xl p-3 text-sm focus:ring-2 focus:ring-[#030C4D]/20 outline-none">
                                        <option value="">Pilih Semester (Opsional)</option>
                                        <option value="semua">Semua</option>
                                        <option value="ganjil">Ganjil</option>
                                        <option value="genap">Genap</option>
                                    </select>
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 mb-1.5">Tanggal Mulai</label>
                                        <input type="date" value={configForm.start_date}
                                            onChange={e => setConfigForm(p => ({ ...p, start_date: e.target.value }))}
                                            className="w-full border border-[#030C4D]/30 rounded-xl p-3 text-sm" />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 mb-1.5">Tanggal Selesai</label>
                                        <input type="date" value={configForm.end_date}
                                            onChange={e => setConfigForm(p => ({ ...p, end_date: e.target.value }))}
                                            className="w-full border border-[#030C4D]/30 rounded-xl p-3 text-sm" />
                                    </div>
                                </div>
                                <button type="submit" disabled={isSubmittingConfig}
                                    className="w-full py-3 bg-[#030C4D] text-white rounded-xl font-semibold flex items-center justify-center gap-2 disabled:opacity-50 hover:bg-[#030C4D]/90 transition-colors">
                                    {isSubmittingConfig ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
                                    Buat Folder
                                </button>
                            </form>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>

            {/* ─────────────── ADD BANK SOAL MODAL ─────────────── */}
            <AnimatePresence>
                {isAddBankModalOpen && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
                        <motion.div
                            initial={{ scale: 0.95, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.95, opacity: 0 }}
                            className="bg-white w-full max-w-md rounded-2xl p-6 relative border border-[#030C4D]/30"
                        >
                            <button onClick={() => setIsAddBankModalOpen(false)} className="absolute top-4 right-4 text-slate-400 hover:text-slate-600">
                                <X size={20} />
                            </button>
                            <div className="flex items-center gap-3 mb-6 pb-4 border-b border-[#030C4D]/20">
                                <div className="w-10 h-10 rounded-lg bg-[#030C4D]/10 text-[#030C4D] flex items-center justify-center border border-[#030C4D]/30">
                                    <BookOpen size={18} />
                                </div>
                                <div>
                                    <h3 className="text-lg font-bold text-slate-900">Tambah Bank Soal</h3>
                                    <p className="text-xs text-slate-500 truncate">{selectedConfig?.name}</p>
                                </div>
                            </div>
                            <form onSubmit={handleAddBankToConfig} className="space-y-4">
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1.5">Bank Soal *</label>
                                    <select required value={addBankForm.bank_id}
                                        onChange={e => setAddBankForm(p => ({ ...p, bank_id: e.target.value }))}
                                        className="w-full border border-[#030C4D]/30 rounded-xl p-3 text-sm">
                                        <option value="">— Pilih Bank Soal —</option>
                                        {qBanks.filter(b => b.is_published).map(bank => (
                                            <option key={bank.id} value={bank.id}>{bank.title}</option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1.5">Mata Pelajaran</label>
                                    <select value={addBankForm.subject_id || ''}
                                        onChange={e => setAddBankForm(p => ({ ...p, subject_id: e.target.value }))}
                                        className="w-full border border-[#030C4D]/30 rounded-xl p-3 text-sm">
                                        <option value="">— Pilih (opsional) —</option>
                                        {subjects.map(sub => (
                                            <option key={sub.id} value={sub.id}>{sub.name}</option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1.5">Durasi (menit)</label>
                                    <input type="number" min="5" max="300" value={addBankForm.duration_minutes}
                                        onChange={e => setAddBankForm(p => ({ ...p, duration_minutes: parseInt(e.target.value) || 90 }))}
                                        className="w-full border border-[#030C4D]/30 rounded-xl p-3 text-sm" />
                                </div>
                                <button type="submit"
                                    className="w-full py-3 bg-[#030C4D] text-white rounded-xl font-semibold flex items-center justify-center gap-2 hover:bg-[#030C4D]/90 transition-colors">
                                    <Plus size={16} /> Simpan
                                </button>
                            </form>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>

            {/* ─────────────── ADD CLASS SCHEDULE MODAL ─────────────── */}
            <AnimatePresence>
                {isAddClassModalOpen && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
                        <motion.div
                            initial={{ scale: 0.95, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.95, opacity: 0 }}
                            className="bg-white w-full max-w-lg rounded-2xl p-6 relative border border-[#030C4D]/30"
                        >
                            <button onClick={() => setIsAddClassModalOpen(false)} className="absolute top-4 right-4 text-slate-400 hover:text-slate-600">
                                <X size={20} />
                            </button>
                            <div className="flex items-center gap-3 mb-6 pb-4 border-b border-[#030C4D]/20">
                                <div className="w-10 h-10 rounded-lg bg-[#030C4D]/10 text-[#030C4D] flex items-center justify-center border border-[#030C4D]/30">
                                    <Calendar size={18} />
                                </div>
                                <div>
                                    <h3 className="text-lg font-bold text-slate-900">Tambah Kelas</h3>
                                    <p className="text-xs text-slate-500">Jadwal ujian per kelas</p>
                                </div>
                            </div>
                            <form onSubmit={handleAddClassExam} className="space-y-4">
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1.5">Bank Soal *</label>
                                    <select required value={addClassForm.bank_id}
                                        onChange={e => setAddClassForm(p => ({ ...p, bank_id: e.target.value }))}
                                        className="w-full border border-[#030C4D]/30 rounded-xl p-3 text-sm">
                                        <option value="">— Pilih Bank Soal —</option>
                                        {configBanks.map(bank => (
                                            <option key={bank.id} value={bank.id}>{bank.question_banks?.title || 'Bank soal'}</option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1.5">Kelas *</label>
                                    <div className="flex flex-wrap gap-2 max-h-[120px] overflow-y-auto p-2 bg-slate-50 rounded-xl border border-[#030C4D]/20">
                                        {classes.length === 0 ? (
                                            <p className="text-xs text-slate-400 px-2">Belum ada kelas.</p>
                                        ) : classes.map(cls => (
                                            <button key={cls.id} type="button"
                                                onClick={() => {
                                                    const ids = addClassForm.class_ids.includes(cls.id)
                                                        ? addClassForm.class_ids.filter(id => id !== cls.id)
                                                        : [...addClassForm.class_ids, cls.id];
                                                    setAddClassForm(p => ({ ...p, class_ids: ids }));
                                                }}
                                                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${addClassForm.class_ids.includes(cls.id) ? 'bg-[#030C4D] text-white border border-[#030C4D]' : 'bg-white text-slate-600 border border-[#030C4D]/30 hover:border-[#030C4D]/60'}`}>
                                                {cls.name}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 mb-1.5">Tanggal *</label>
                                        <input type="date" required value={addClassForm.scheduled_date}
                                            onChange={e => setAddClassForm(p => ({ ...p, scheduled_date: e.target.value }))}
                                            className="w-full border border-[#030C4D]/30 rounded-xl p-3 text-sm" />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 mb-1.5">Jam Mulai *</label>
                                        <input type="time" required value={addClassForm.scheduled_time}
                                            onChange={e => setAddClassForm(p => ({ ...p, scheduled_time: e.target.value }))}
                                            className="w-full border border-[#030C4D]/30 rounded-xl p-3 text-sm" />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 mb-1.5">Window Tutup *</label>
                                        <input type="time" required value={addClassForm.window_end_time}
                                            onChange={e => setAddClassForm(p => ({ ...p, window_end_time: e.target.value }))}
                                            className="w-full border border-[#030C4D]/30 rounded-xl p-3 text-sm" />
                                    </div>
                                </div>
                                <button type="submit"
                                    className="w-full py-3 bg-[#030C4D] text-white rounded-xl font-semibold flex items-center justify-center gap-2 hover:bg-[#030C4D]/90 transition-colors">
                                    <Plus size={16} /> Simpan Jadwal
                                </button>
                            </form>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>


            {/* Exam List */}
            {typeFilter !== 'pas' && (
                isLoading ? (
                <div className="flex justify-center py-16">
                    <div className="w-8 h-8 border-3 border-[#030C4D]/20 border-t-[#030C4D] rounded-full animate-spin" />
                </div>
            ) : filteredExams.length === 0 ? (
                <div className="py-16 text-center text-slate-400 border-2 border-dashed border-[#030C4D]/30 rounded-lg">
                    <ClipboardCheck size={40} className="mx-auto mb-3 opacity-40" />
                    <p className="font-medium">Tidak ada ujian{activeTab === 'draft' ? ' draft' : activeTab === 'active' ? ' aktif' : ''}</p>
                    <p className="text-sm mt-1">Klik "Buat Ujian Baru" untuk memulai</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-4">
                    {filteredExams.map((exam) => {
                        const bank = qBanks.find(b => b.id === exam.question_bank_id);
                        const assignment = examAssignments[exam.id] || { classCount: 0, studentCount: 0 };
                        const isAssigned = assignment.classCount > 0 || assignment.studentCount > 0;
                        const isPublic = exam.metadata?.is_public === true;
                        const canPublish = isAssigned || isPublic;
                        return (
                            <div key={exam.id} className="bg-white border border-[#030C4D]/30 rounded-xl overflow-hidden hover:border-[#030C4D] hover:shadow-lg transition-all">
                                {/* Card Header */}
                                <div className="p-4 sm:p-5">
                                    <div className="flex items-start gap-3">
                                        <div className={`w-10 h-10 sm:w-12 sm:h-12 rounded-lg flex items-center justify-center shrink-0 border ${
                                            exam.is_published
                                                ? 'bg-emerald-50 text-emerald-600 border-emerald-200'
                                                : 'bg-[#030C4D]/10 text-[#030C4D] border-[#030C4D]/40'
                                        }`}>
                                            {exam.is_published ? <Globe size={18} /> : <GlobeLock size={18} />}
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <div className="flex flex-wrap items-center gap-2 mb-2">
                                                <span className={`px-2 py-0.5 rounded-lg text-[10px] sm:text-xs font-semibold ${
                                                    exam.is_published
                                                        ? 'bg-emerald-100 text-emerald-700 border border-emerald-200'
                                                        : 'bg-[#030C4D]/10 text-[#030C4D] border border-[#030C4D]/30'
                                                }`}>
                                                    {exam.is_published ? 'Dipublikasikan' : 'Draft'}
                                                </span>
                                                {exam.exam_type && exam.exam_type !== 'daily' && (
                                                    <span className="px-2 py-0.5 bg-[#030C4D]/5 text-[#030C4D] text-[10px] sm:text-xs font-bold rounded-lg border border-[#030C4D]/20">
                                                        {exam.exam_type.toUpperCase()}
                                                    </span>
                                                )}
                                            </div>
                                            <h3 className="font-bold text-slate-800 text-sm sm:text-base leading-tight">{exam.title}</h3>
                                        </div>
                                    </div>

                                    {/* Bank info badge */}
                                    <div className="mt-3 px-3 py-2 bg-[#030C4D]/5 rounded-lg border border-[#030C4D]/20">
                                        <p className="text-xs text-[#030C4D] font-medium truncate">
                                            <BookOpen size={11} className="inline mr-1.5" />
                                            {bank?.title || 'Bank soal dihapus'}
                                        </p>
                                    </div>

                                    {/* Assignment Status Badge */}
                                    {isPublic ? (
                                        <div className="mt-2 px-3 py-2 bg-emerald-50 rounded-lg border border-emerald-200 flex items-center gap-2">
                                            <Globe size={12} className="text-emerald-600 shrink-0" />
                                            <p className="text-xs text-emerald-700 font-medium">
                                                <strong>Ujian Umum (Publik)</strong> • Tersedia untuk siswa anggota aktif sekolah ini
                                            </p>
                                        </div>
                                    ) : isAssigned ? (
                                        <div className="mt-2 px-3 py-2 bg-emerald-50 rounded-lg border border-emerald-200 flex items-center gap-2">
                                            <CheckCircle2 size={12} className="text-emerald-600 shrink-0" />
                                            <p className="text-xs text-emerald-700 font-medium">
                                                Ditugaskan ke <strong>{assignment.classCount} kelas</strong> • <strong>{assignment.studentCount} siswa</strong>
                                            </p>
                                        </div>
                                    ) : (
                                        <div className="mt-2 px-3 py-2 bg-red-50 rounded-lg border border-red-200 flex items-center gap-2">
                                            <AlertCircle size={12} className="text-red-600 shrink-0" />
                                            <p className="text-xs text-red-700 font-medium">
                                                Belum ditugaskan ke kelas manapun
                                            </p>
                                        </div>
                                    )}

                                    {/* Info row */}
                                    <div className="flex flex-wrap items-center gap-3 sm:gap-4 mt-3 text-xs sm:text-sm text-slate-500">
                                        <span className="flex items-center gap-1.5">
                                            <Clock size={12} className="text-slate-400" />
                                            <strong className="text-slate-600">{exam.duration_minutes}</strong>m
                                        </span>
                                        <span className="flex items-center gap-1.5">
                                            <Calendar size={12} className="text-slate-400" />
                                            <span className="hidden sm:inline">{getExamWindow(exam)}</span>
                                            <span className="sm:hidden">Jadwal</span>
                                        </span>
                                    </div>

                                    {exam.description && (
                                        <p className="text-xs text-slate-400 mt-2 line-clamp-2">{exam.description}</p>
                                    )}
                                </div>

                                {/* Card Actions */}
                                <div className="flex flex-wrap gap-2 px-4 pb-4">
                                    {/* Publish Toggle */}
                                    <button
                                        onClick={() => handlePublishToggle(exam)}
                                        disabled={isSubmitting || publishingId === exam.id}
                                        className={`flex-1 sm:flex-none px-3 py-2 rounded-lg text-xs font-semibold transition-all flex items-center justify-center gap-1.5 disabled:opacity-70 disabled:cursor-wait ${
                                            exam.is_published
                                                ? 'bg-[#030C4D]/10 text-[#030C4D] hover:bg-[#030C4D]/20 border border-[#030C4D]/30'
                                                : canPublish
                                                    ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200 border border-emerald-200'
                                                    : 'bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed'
                                        }`}
                                        title={!exam.is_published && !canPublish ? 'Tugaskan ke kelas terlebih dahulu sebelum mempublish' : ''}
                                    >
                                        {publishingId === exam.id ? (
                                            <>
                                                <Loader2 size={12} className="animate-spin" />
                                                Memproses…
                                            </>
                                        ) : (
                                            <>
                                                {exam.is_published ? <EyeOff size={12} /> : <Eye size={12} />}
                                                {exam.is_published ? 'Unpub' : 'Publish'}
                                            </>
                                        )}
                                    </button>

                                    {/* Monitor */}
                                    <button
                                        onClick={() => router.push('/dashboard/guru/monitoring?exam=' + exam.id)}
                                        className="flex-1 sm:flex-none px-3 py-2 text-xs bg-[#030C4D] text-white hover:bg-[#030C4D]/90 rounded-lg transition-all font-medium flex items-center justify-center gap-1.5"
                                    >
                                        <Eye size={12} />
                                        Monitor
                                    </button>

                                    {/* Review Tugas — only for assignment type */}
                                    {exam.exam_type === 'assignment' && (
                                        <button
                                            onClick={() => router.push('/dashboard/guru/assignments/' + exam.id)}
                                            className="flex-1 sm:flex-none px-3 py-2 text-xs bg-amber-500 text-white hover:bg-amber-600 rounded-lg transition-all font-medium flex items-center justify-center gap-1.5"
                                        >
                                            <FileText size={12} />
                                            Review Tugas
                                        </button>
                                    )}

                                    {/* Edit */}
                                    <button
                                        onClick={() => openEdit(exam)}
                                        className="p-2 text-slate-400 hover:text-[#030C4D] hover:bg-[#030C4D]/10 rounded-lg transition-all border border-slate-200 hover:border-[#030C4D]/30"
                                    >
                                        <Settings size={14} />
                                    </button>

                                    {/* Assign */}
                                    <button
                                        onClick={() => openAssign(exam)}
                                        className={`p-2 rounded-lg transition-all border ${
                                            isAssigned
                                                ? 'text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 border-emerald-200 hover:border-emerald-300'
                                                : 'text-[#030C4D] hover:text-[#030C4D] hover:bg-[#030C4D]/10 border-[#030C4D]/30 hover:border-[#030C4D]'
                                        }`}
                                        title={isAssigned ? 'Ubah penugasan kelas' : 'Tugaskan ke kelas'}
                                    >
                                        <Users size={14} />
                                    </button>

                                    {/* Delete */}
                                    <button
                                        onClick={() => handleDeleteExam(exam.id)}
                                        className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all border border-slate-200 hover:border-red-200"
                                    >
                                        <Trash2 size={14} />
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            ))}

            {/* ─────────────── CREATE MODAL ─────────────── */}
            <AnimatePresence>
                {isAddModalOpen && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
                        <motion.div
                            initial={{ scale: 0.95, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.95, opacity: 0 }}
                            className="bg-white w-full max-w-lg rounded-2xl p-6 relative max-h-[90vh] overflow-y-auto border border-[#030C4D]/30"
                        >
                            <button onClick={() => setIsAddModalOpen(false)} className="absolute top-4 right-4 text-slate-400 hover:text-slate-600">
                                <X size={20} />
                            </button>
                            {/* Header */}
                            <div className="flex items-center gap-3 mb-6 pb-4 border-b border-[#030C4D]/20">
                                <div className="w-10 h-10 rounded-lg bg-[#030C4D]/10 text-[#030C4D] flex items-center justify-center border border-[#030C4D]/30">
                                    <Plus size={18} />
                                </div>
                                <div>
                                    <h3 className="text-lg font-bold text-slate-900">Buat {formData.examType === 'assignment' ? 'Tugas' : 'Ujian'} Baru</h3>
                                    <p className="text-xs text-slate-500">Ujian baru dibuat sebagai draft.</p>
                                </div>
                            </div>

                            <form onSubmit={handleCreateExam} className="flex flex-col gap-3">
                                {/* Jenis Ujian & Sistem Penilaian */}
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 mb-1">Jenis Ujian</label>
                                        <select
                                            value={formData.examType}
                                            onChange={e => setFormData({ ...formData, examType: e.target.value as any })}
                                            className="w-full border border-[#030C4D]/30 rounded-xl p-2.5 text-sm focus:ring-2 focus:ring-[#030C4D]/20 outline-none"
                                        >
                                            <option value="daily">Ulangan Harian</option>
                                            <option value="assignment">Tugas</option>
                                            <option value="lainnya">Ujian Lainnya</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 mb-1">Sistem Penilaian</label>
                                        <div className="relative">
                                            <div 
                                                onClick={() => setIsScoringDropdownOpen(!isScoringDropdownOpen)}
                                                className="w-full border border-[#030C4D]/30 rounded-xl p-2.5 text-sm focus:ring-2 focus:ring-[#030C4D]/20 outline-none flex justify-between items-center cursor-pointer bg-white"
                                            >
                                                <span className="truncate">
                                                    {formData.scoringTypes.length > 0 
                                                        ? formData.scoringTypes.map(v => SCORING_OPTIONS.find(o => o.value === v)?.label).join(', ') 
                                                        : 'Pilih Sistem Penilaian'}
                                                </span>
                                                <ChevronDown size={16} className={`text-slate-400 transition-transform ${isScoringDropdownOpen ? 'rotate-180' : ''}`} />
                                            </div>
                                            
                                            {isScoringDropdownOpen && (
                                                <div className="absolute z-50 w-full mt-1 bg-white border border-[#030C4D]/20 rounded-xl shadow-lg max-h-48 overflow-y-auto py-1">
                                                    {SCORING_OPTIONS.map(option => (
                                                        <label key={option.value} className="flex flex-col px-3 py-2 hover:bg-slate-50 cursor-pointer">
                                                            <div className="flex items-center gap-2">
                                                                <input 
                                                                    type="checkbox" 
                                                                    checked={formData.scoringTypes.includes(option.value)}
                                                                    onChange={(e) => {
                                                                        if (e.target.checked) {
                                                                            const newScoringTypes = [...formData.scoringTypes, option.value];
                                                                            const hasIRT = newScoringTypes.some(type => type.startsWith('irt_'));
                                                                            setFormData({ 
                                                                                ...formData, 
                                                                                scoringTypes: newScoringTypes,
                                                                                ...(hasIRT ? { showResults: false } : {}) 
                                                                            });
                                                                        } else {
                                                                            setFormData({ ...formData, scoringTypes: formData.scoringTypes.filter(v => v !== option.value) });
                                                                        }
                                                                    }}
                                                                    className="rounded border-slate-300 text-[#030C4D] focus:ring-[#030C4D]"
                                                                />
                                                                <span className="text-sm text-slate-700">{option.label}</span>
                                                            </div>
                                                            {option.info && (
                                                                <span className="text-[10px] text-slate-500 ml-6 mt-0.5 leading-tight">{option.info}</span>
                                                            )}
                                                        </label>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                {/* Title & Deskripsi */}
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 mb-1">Judul {formData.examType === 'assignment' ? 'Tugas' : 'Ujian'} *</label>
                                        <input
                                            required type="text" placeholder={formData.examType === 'assignment' ? "Contoh: Tugas Matematika" : "Contoh: UTS Matematika"}
                                            value={formData.title}
                                            onChange={e => setFormData({ ...formData, title: e.target.value })}
                                            className="w-full border border-[#030C4D]/30 rounded-xl p-2.5 text-sm focus:ring-2 focus:ring-[#030C4D]/20 outline-none"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 mb-1">Deskripsi (opsional)</label>
                                        <input
                                            type="text" placeholder="Deskripsi singkat..."
                                            value={formData.description}
                                            onChange={e => setFormData({ ...formData, description: e.target.value })}
                                            className="w-full border border-[#030C4D]/30 rounded-xl p-2.5 text-sm focus:ring-2 focus:ring-[#030C4D]/20 outline-none"
                                        />
                                    </div>
                                </div>

                                {/* Bank Soal & Durasi */}
                                {formData.examType !== 'pas' && formData.examType !== 'assignment' && (
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                        <div>
                                            <label className="block text-sm font-medium text-slate-700 mb-1">Bank Soal *</label>
                                            {publishedBanks.length === 0 ? (
                                                <div className="p-2.5 bg-[#030C4D]/10 border border-[#030C4D]/30 rounded-xl text-xs text-[#030C4D] flex items-center gap-1.5">
                                                    <AlertCircle size={14} /> Belum ada bank soal.
                                                </div>
                                            ) : (
                                                <select
                                                    required value={formData.bankId}
                                                    onChange={e => setFormData({ ...formData, bankId: e.target.value })}
                                                    className="w-full border border-[#030C4D]/30 rounded-xl p-2.5 text-sm focus:ring-2 focus:ring-[#030C4D]/20 outline-none"
                                                >
                                                    <option value="">— Pilih Bank Soal —</option>
                                                    {publishedBanks.map(bank => (
                                                        <option key={bank.id} value={bank.id}>{bank.title}</option>
                                                    ))}
                                                </select>
                                            )}
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-slate-700 mb-1">Durasi (menit) *</label>
                                            <input
                                                required type="number" min="5" max="300"
                                                value={formData.duration}
                                                onChange={e => setFormData({ ...formData, duration: parseInt(e.target.value) || 60 })}
                                                className="w-full border border-[#030C4D]/30 rounded-xl p-2.5 text-sm focus:ring-2 focus:ring-[#030C4D]/20 outline-none"
                                            />
                                        </div>
                                    </div>
                                )}

                                {/* Waktu */}
                                <div className="bg-slate-50 p-2.5 rounded-xl border border-[#030C4D]/20 flex flex-col gap-2">
                                    <label className="flex items-center gap-2 cursor-pointer w-max">
                                        <input type="checkbox" checked={formData.isForever} onChange={e => setFormData({ ...formData, isForever: e.target.checked, startTime: e.target.checked ? '' : formData.startTime, endTime: e.target.checked ? '' : formData.endTime })} className="w-4 h-4 rounded border-slate-300 text-[#030C4D] focus:ring-[#030C4D]/20" />
                                        <span className="text-sm font-medium text-slate-700">Berlaku Terus Tanpa Batas Waktu</span>
                                    </label>
                                    {!formData.isForever && (
                                        <div className={`grid ${formData.examType === 'assignment' ? 'grid-cols-1' : 'grid-cols-2'} gap-3 mt-1`}>
                                            {formData.examType !== 'assignment' && (
                                                <div>
                                                    <label className="block text-xs font-medium text-slate-700 mb-1">Waktu Mulai</label>
                                                    <input
                                                        required={!formData.isForever} type="datetime-local" step="60"
                                                        value={formData.startTime} onChange={e => setFormData({ ...formData, startTime: e.target.value })}
                                                        className="w-full border border-[#030C4D]/30 rounded-xl p-2 text-xs focus:ring-2 focus:ring-[#030C4D]/20 outline-none"
                                                    />
                                                </div>
                                            )}
                                            <div>
                                                <label className="block text-xs font-medium text-slate-700 mb-1">{formData.examType === 'assignment' ? 'Batas Waktu Pengumpulan' : 'Waktu Selesai'}</label>
                                                <input
                                                    required={!formData.isForever} type="datetime-local" step="60"
                                                    value={formData.endTime} onChange={e => setFormData({ ...formData, endTime: e.target.value })}
                                                    className="w-full border border-[#030C4D]/30 rounded-xl p-2 text-xs focus:ring-2 focus:ring-[#030C4D]/20 outline-none"
                                                />
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {/* Tugas - Assignment Panel */}
                                {formData.examType === 'assignment' && (
                                    <div className="bg-amber-50 p-4 rounded-xl border border-amber-200 flex flex-col gap-4">
                                        <div className="flex items-center gap-2 mb-1">
                                            <FileText size={16} className="text-amber-600" />
                                            <h4 className="text-sm font-semibold text-amber-800">Pengaturan Tugas</h4>
                                        </div>

                                        {/* Instruksi / Deskripsi Penugasan */}
                                        <div>
                                            <label className="block text-xs font-medium text-slate-700 mb-1">Instruksi / Deskripsi Penugasan <span className="text-slate-400">(Opsional)</span></label>
                                            <textarea
                                                rows={4}
                                                placeholder="Tuliskan instruksi tugas secara detail di sini..."
                                                value={formData.assignmentDescription}
                                                onChange={e => setFormData({ ...formData, assignmentDescription: e.target.value })}
                                                className="w-full border border-amber-300 rounded-xl p-2.5 text-sm focus:ring-2 focus:ring-amber-400 outline-none resize-none"
                                            />
                                        </div>

                                        {/* Toggle: Require Bank Soal (Moved to top of assignment options) */}
                                        <label className="flex items-start gap-3 cursor-pointer group">
                                            <input
                                                type="checkbox"
                                                checked={formData.requireBank}
                                                onChange={e => setFormData({ ...formData, requireBank: e.target.checked, bankId: e.target.checked ? formData.bankId : '', duration: e.target.checked ? (formData.duration || 60) : 0 })}
                                                className="mt-0.5 w-4 h-4 rounded border-amber-400 text-amber-600 focus:ring-amber-500/20"
                                            />
                                            <div>
                                                <span className="text-sm font-medium text-slate-700">Sertakan Soal dari Bank Soal</span>
                                                <p className="text-[11px] text-slate-500">Jika dicentang, siswa akan mengerjakan soal pilihan sebelum mengumpulkan tugas.</p>
                                            </div>
                                        </label>

                                        {formData.requireBank && (
                                            <div className="ml-7 p-3 bg-white rounded-lg border border-amber-200 grid grid-cols-1 sm:grid-cols-2 gap-3 mb-2">
                                                <div>
                                                    <label className="block text-sm font-medium text-slate-700 mb-1">Bank Soal *</label>
                                                    {publishedBanks.length === 0 ? (
                                                        <div className="p-2.5 bg-[#030C4D]/10 border border-[#030C4D]/30 rounded-xl text-xs text-[#030C4D] flex items-center gap-1.5">
                                                            <AlertCircle size={14} /> Belum ada bank soal.
                                                        </div>
                                                    ) : (
                                                        <select
                                                            required value={formData.bankId}
                                                            onChange={e => setFormData({ ...formData, bankId: e.target.value })}
                                                            className="w-full border border-amber-300 rounded-xl p-2.5 text-sm focus:ring-2 focus:ring-amber-400 outline-none"
                                                        >
                                                            <option value="">— Pilih Bank Soal —</option>
                                                            {publishedBanks.map(bank => (
                                                                <option key={bank.id} value={bank.id}>{bank.title}</option>
                                                            ))}
                                                        </select>
                                                    )}
                                                </div>
                                                <div>
                                                    <label className="block text-sm font-medium text-slate-700 mb-1">Durasi Pengerjaan Bank Soal (opsional)</label>
                                                    <input
                                                        type="number" min="0" max="300"
                                                        placeholder="Tidak dibatasi (0)"
                                                        value={formData.duration || ''}
                                                        onChange={e => setFormData({ ...formData, duration: parseInt(e.target.value) || 0 })}
                                                        className="w-full border border-amber-300 rounded-xl p-2.5 text-sm focus:ring-2 focus:ring-amber-400 outline-none"
                                                    />
                                                    <p className="text-[10px] text-slate-400 mt-1">Kosongkan/isi 0 jika tidak ada batas waktu layar (hanya dibatasi waktu pengumpulan)</p>
                                                </div>
                                            </div>
                                        )}

                                        {/* Toggle: Allow File Upload */}
                                        <label className="flex items-start gap-3 cursor-pointer group">
                                            <input
                                                type="checkbox"
                                                checked={formData.allowFileUpload}
                                                onChange={e => setFormData({ ...formData, allowFileUpload: e.target.checked })}
                                                className="mt-0.5 w-4 h-4 rounded border-amber-400 text-amber-600 focus:ring-amber-500/20"
                                            />
                                            <div>
                                                <span className="text-sm font-medium text-slate-700">Siswa Wajib Unggah File</span>
                                                <p className="text-[11px] text-slate-500">Siswa harus mengunggah dokumen tugas mereka.</p>
                                            </div>
                                        </label>

                                        {/* File Types - shown when allowFileUpload is true */}
                                        {formData.allowFileUpload && (
                                            <div className="ml-7 p-3 bg-white rounded-lg border border-amber-200">
                                                <p className="text-xs font-semibold text-slate-600 mb-2">Jenis File yang Diizinkan:</p>
                                                <div className="flex flex-wrap gap-2">
                                                    {['pdf', 'docx', 'jpg', 'png', 'zip', 'xlsx', 'pptx'].map(ft => (
                                                        <label key={ft} className="flex items-center gap-1.5 cursor-pointer">
                                                            <input
                                                                type="checkbox"
                                                                checked={formData.allowedFileTypes.includes(ft)}
                                                                onChange={e => {
                                                                    if (e.target.checked) {
                                                                        setFormData({ ...formData, allowedFileTypes: [...formData.allowedFileTypes, ft] });
                                                                    } else {
                                                                        setFormData({ ...formData, allowedFileTypes: formData.allowedFileTypes.filter(t => t !== ft) });
                                                                    }
                                                                }}
                                                                className="w-3.5 h-3.5 rounded border-slate-300 text-amber-600"
                                                            />
                                                            <span className="text-xs font-mono text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded">.{ft}</span>
                                                        </label>
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        {/* URL dokumen & video */}
                                        <div className="grid grid-cols-1 gap-3">
                                            <div>
                                                <label className="block text-xs font-medium text-slate-700 mb-1">URL File Dokumen Referensi <span className="text-slate-400">(Opsional)</span></label>
                                                <input
                                                    type="url" placeholder="Contoh: https://drive.google.com/..."
                                                    value={formData.documentUrl} onChange={e => setFormData({ ...formData, documentUrl: e.target.value })}
                                                    className="w-full border border-amber-300 rounded-xl p-2.5 text-sm focus:ring-2 focus:ring-amber-400 outline-none"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-xs font-medium text-slate-700 mb-1">URL Video Pembelajaran <span className="text-slate-400">(Opsional)</span></label>
                                                <input
                                                    type="url" placeholder="Contoh: https://youtube.com/..."
                                                    value={formData.videoUrl} onChange={e => setFormData({ ...formData, videoUrl: e.target.value })}
                                                    className="w-full border border-amber-300 rounded-xl p-2.5 text-sm focus:ring-2 focus:ring-amber-400 outline-none"
                                                />
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {/* Kelas Target */}
                                {formData.examType === 'lainnya' && (
                                    <div className="bg-slate-50 p-2.5 rounded-xl border border-[#030C4D]/20 flex flex-col gap-2">
                                        <label className="flex items-center gap-2 cursor-pointer w-max">
                                            <input type="checkbox" checked={formData.isPublic} onChange={e => setFormData({ ...formData, isPublic: e.target.checked, selectedClassIds: e.target.checked ? [] : formData.selectedClassIds })} className="w-4 h-4 rounded border-slate-300 text-emerald-500 focus:ring-emerald-500/20" />
                                            <span className="text-sm font-medium text-slate-700">Ujian Umum (Bisa diakses semua siswa)</span>
                                        </label>
                                        {!formData.isPublic && (
                                            <div className="flex flex-wrap gap-1.5 max-h-[80px] overflow-y-auto mt-1">
                                                {classes.length === 0 ? (
                                                    <p className="text-[11px] text-slate-400">Belum ada kelas.</p>
                                                ) : classes.map(cls => (
                                                    <button
                                                        key={cls.id} type="button"
                                                        onClick={() => {
                                                            const ids = formData.selectedClassIds.includes(cls.id)
                                                                ? formData.selectedClassIds.filter(id => id !== cls.id)
                                                                : [...formData.selectedClassIds, cls.id];
                                                            setFormData({ ...formData, selectedClassIds: ids });
                                                        }}
                                                        className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-all ${
                                                            formData.selectedClassIds.includes(cls.id)
                                                                ? 'bg-[#030C4D] text-white'
                                                                : 'bg-white text-slate-600 border border-[#030C4D]/20'
                                                        }`}
                                                    >
                                                        {cls.name}
                                                    </button>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* Options */}
                                <div className="flex flex-wrap gap-x-4 gap-y-2 px-1 py-1">
                                    <label className="flex items-center gap-1.5 cursor-pointer">
                                        <input type="checkbox" checked={formData.randomizeQuestions} onChange={e => setFormData({ ...formData, randomizeQuestions: e.target.checked })} className="w-3.5 h-3.5 rounded border-slate-300 text-[#030C4D] focus:ring-[#030C4D]/20" />
                                        <span className="text-xs font-medium text-slate-700">Acak Soal</span>
                                    </label>
                                    <label className="flex items-center gap-1.5 cursor-pointer">
                                        <input type="checkbox" checked={formData.randomizeOptions} onChange={e => setFormData({ ...formData, randomizeOptions: e.target.checked })} className="w-3.5 h-3.5 rounded border-slate-300 text-[#030C4D] focus:ring-[#030C4D]/20" />
                                        <span className="text-xs font-medium text-slate-700">Acak Opsi</span>
                                    </label>
                                    <label className="flex items-center gap-1.5 cursor-pointer">
                                        <input type="checkbox" checked={formData.isSafeMode} onChange={e => setFormData({ ...formData, isSafeMode: e.target.checked })} className="w-3.5 h-3.5 rounded border-slate-300 text-[#030C4D] focus:ring-[#030C4D]/20" />
                                        <span className="text-xs font-medium text-slate-700">Mode Aman (Proctoring)</span>
                                    </label>
                                    <label className={`flex items-center gap-1.5 ${formData.scoringTypes.some(t => t.startsWith('irt_')) ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}>
                                        <input type="checkbox" 
                                            checked={formData.showResults} 
                                            disabled={formData.scoringTypes.some(t => t.startsWith('irt_'))}
                                            onChange={e => setFormData({ ...formData, showResults: e.target.checked })} 
                                            className="w-3.5 h-3.5 rounded border-slate-300 text-[#030C4D] focus:ring-[#030C4D]/20 disabled:bg-slate-200" />
                                        <span className="text-xs font-medium text-slate-700">
                                            Tampilkan Nilai
                                            {formData.scoringTypes.some(t => t.startsWith('irt_')) && " (Nonaktif untuk IRT)"}
                                        </span>
                                    </label>
                                </div>


                                <button type="submit" disabled={isSubmitting || publishedBanks.length === 0}
                                    className="w-full py-2.5 mt-1 bg-[#030C4D] text-white rounded-xl font-semibold flex items-center justify-center gap-2 disabled:opacity-50 hover:bg-[#030C4D]/90 transition-colors">
                                    {isSubmitting ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
                                    Simpan sebagai Draft
                                </button>
                            </form>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>

            {/* ─────────────── EDIT MODAL ─────────────── */}
            <AnimatePresence>
                {isEditModalOpen && selectedExam && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
                        <motion.div
                            initial={{ scale: 0.95, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.95, opacity: 0 }}
                            className="bg-white w-full max-w-md rounded-2xl p-6 relative max-h-[90vh] overflow-y-auto border border-[#030C4D]/30"
                        >
                            <button onClick={() => setIsEditModalOpen(false)} className="absolute top-4 right-4 text-slate-400 hover:text-slate-600">
                                <X size={20} />
                            </button>
                            {/* Header */}
                            <div className="flex items-center gap-3 mb-6 pb-4 border-b border-[#030C4D]/20">
                                <div className="w-10 h-10 rounded-lg bg-[#030C4D]/10 text-[#030C4D] flex items-center justify-center border border-[#030C4D]/30">
                                    <Settings size={18} />
                                </div>
                                <div>
                                    <h3 className="text-lg font-bold text-slate-900">Edit {formData.examType === 'assignment' ? 'Tugas' : 'Ujian'}</h3>
                                    <p className="text-xs text-slate-500">Ubah detail ujian</p>
                                </div>
                            </div>
                            <form onSubmit={handleEditExam} className="space-y-4">
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1.5">Jenis Ujian</label>
                                    <select value={formData.examType} onChange={e => setFormData({ ...formData, examType: e.target.value as any })}
                                        className="w-full border border-[#030C4D]/30 rounded-xl p-3 text-sm focus:ring-2 focus:ring-[#030C4D]/20 outline-none">
                                        <option value="daily">Ulangan Harian</option>
                                        <option value="assignment">Tugas</option>
                                        <option value="lainnya">Ujian Lainnya</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1.5">Sistem Penilaian</label>
                                    <div className="relative">
                                        <div 
                                            onClick={() => setIsScoringDropdownOpen(!isScoringDropdownOpen)}
                                            className="w-full border border-[#030C4D]/30 rounded-xl p-3 text-sm focus:ring-2 focus:ring-[#030C4D]/20 outline-none flex justify-between items-center cursor-pointer bg-white"
                                        >
                                            <span className="truncate">
                                                {formData.scoringTypes.length > 0 
                                                    ? formData.scoringTypes.map(v => SCORING_OPTIONS.find(o => o.value === v)?.label).join(', ') 
                                                    : 'Pilih Sistem Penilaian'}
                                            </span>
                                            <ChevronDown size={16} className={`text-slate-400 transition-transform ${isScoringDropdownOpen ? 'rotate-180' : ''}`} />
                                        </div>
                                        
                                        {isScoringDropdownOpen && (
                                            <div className="absolute z-50 w-full mt-1 bg-white border border-[#030C4D]/20 rounded-xl shadow-lg max-h-48 overflow-y-auto py-1">
                                                {SCORING_OPTIONS.map(option => (
                                                    <label key={option.value} className="flex flex-col px-3 py-2 hover:bg-slate-50 cursor-pointer">
                                                        <div className="flex items-center gap-2">
                                                            <input 
                                                                type="checkbox" 
                                                                checked={formData.scoringTypes.includes(option.value)}
                                                                onChange={(e) => {
                                                                    if (e.target.checked) {
                                                                        const newScoringTypes = [...formData.scoringTypes, option.value];
                                                                        const hasIRT = newScoringTypes.some(type => type.startsWith('irt_'));
                                                                        setFormData({ 
                                                                            ...formData, 
                                                                            scoringTypes: newScoringTypes,
                                                                            ...(hasIRT ? { showResults: false } : {}) 
                                                                        });
                                                                    } else {
                                                                        setFormData({ ...formData, scoringTypes: formData.scoringTypes.filter(v => v !== option.value) });
                                                                    }
                                                                }}
                                                                className="rounded border-slate-300 text-[#030C4D] focus:ring-[#030C4D]"
                                                            />
                                                            <span className="text-sm text-slate-700">{option.label}</span>
                                                        </div>
                                                        {option.info && (
                                                            <span className="text-[10px] text-slate-500 ml-6 mt-0.5 leading-tight">{option.info}</span>
                                                        )}
                                                    </label>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1.5">Judul {formData.examType === 'assignment' ? 'Tugas' : 'Ujian'}</label>
                                    <input required type="text" value={formData.title}
                                        onChange={e => setFormData({ ...formData, title: e.target.value })}
                                        className="w-full border border-[#030C4D]/30 rounded-xl p-3 text-sm focus:ring-2 focus:ring-[#030C4D]/20 outline-none" />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1.5">Deskripsi</label>
                                    <textarea rows={2} value={formData.description}
                                        onChange={e => setFormData({ ...formData, description: e.target.value })}
                                        className="w-full border border-[#030C4D]/30 rounded-xl p-3 text-sm focus:ring-2 focus:ring-[#030C4D]/20 outline-none resize-none" />
                                </div>
                                <div className="space-y-3">
                                    <label className="flex items-center gap-2 cursor-pointer group mb-1">
                                        <input type="checkbox" checked={formData.isForever} onChange={e => setFormData({ ...formData, isForever: e.target.checked, startTime: e.target.checked ? '' : formData.startTime, endTime: e.target.checked ? '' : formData.endTime })} className="hidden" />
                                        <div className={`w-4 h-4 rounded border ${formData.isForever ? 'bg-[#030C4D] border-[#030C4D]' : 'bg-white border-slate-300'} flex items-center justify-center transition-all`}>
                                            {formData.isForever && <Check size={12} className="text-white" />}
                                        </div>
                                        <span className="text-sm font-medium text-slate-700">Berlaku Terus Tanpa Batas Waktu</span>
                                    </label>

                                    {!formData.isForever && (
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                            <div>
                                                <label className="block text-sm font-medium text-slate-700 mb-1.5">Mulai (WIB)</label>
                                                <input required={!formData.isForever} type="datetime-local" step="60" value={formData.startTime}
                                                    onChange={e => setFormData({ ...formData, startTime: e.target.value })}
                                                    className="w-full border border-[#030C4D]/30 rounded-xl p-3 text-sm focus:ring-2 focus:ring-[#030C4D]/20 outline-none" />
                                            </div>
                                            <div>
                                                <label className="block text-sm font-medium text-slate-700 mb-1.5">Selesai (WIB)</label>
                                                <input required={!formData.isForever} type="datetime-local" step="60" value={formData.endTime}
                                                    onChange={e => setFormData({ ...formData, endTime: e.target.value })}
                                                    className="w-full border border-[#030C4D]/30 rounded-xl p-3 text-sm focus:ring-2 focus:ring-[#030C4D]/20 outline-none" />
                                            </div>
                                        </div>
                                    )}
                                </div>
                                {formData.examType !== 'pas' && formData.examType !== 'assignment' && (
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 mb-1.5">Durasi (menit)</label>
                                        <input required type="number" min="5" max="300" value={formData.duration}
                                            onChange={e => setFormData({ ...formData, duration: parseInt(e.target.value) || 60 })}
                                            className="w-full border border-[#030C4D]/30 rounded-xl p-3 text-sm focus:ring-2 focus:ring-[#030C4D]/20 outline-none" />
                                    </div>
                                )}

                                {/* Tugas - Assignment Panel */}
                                {formData.examType === 'assignment' && (
                                    <div className="bg-amber-50 p-4 rounded-xl border border-amber-200 flex flex-col gap-4">
                                        <div className="flex items-center gap-2 mb-1">
                                            <FileText size={16} className="text-amber-600" />
                                            <h4 className="text-sm font-semibold text-amber-800">Pengaturan Tugas</h4>
                                        </div>

                                        <div>
                                            <label className="block text-xs font-medium text-slate-700 mb-1">Instruksi / Deskripsi Penugasan <span className="text-slate-400">(Opsional)</span></label>
                                            <textarea
                                                rows={4}
                                                placeholder="Tuliskan instruksi tugas secara detail di sini..."
                                                value={formData.assignmentDescription}
                                                onChange={e => setFormData({ ...formData, assignmentDescription: e.target.value })}
                                                className="w-full border border-amber-300 rounded-xl p-2.5 text-sm focus:ring-2 focus:ring-amber-400 outline-none resize-none"
                                            />
                                        </div>

                                        <label className="flex items-start gap-3 cursor-pointer group">
                                            <input
                                                type="checkbox"
                                                checked={formData.requireBank}
                                                disabled
                                                className="mt-0.5 w-4 h-4 rounded border-amber-400 text-amber-600 focus:ring-amber-500/20 bg-slate-100"
                                            />
                                            <div>
                                                <span className="text-sm font-medium text-slate-700">Sertakan Soal dari Bank Soal (Tidak bisa diubah saat edit)</span>
                                                <p className="text-[11px] text-slate-500">Pengaturan Bank Soal hanya dapat dilakukan saat membuat ujian baru.</p>
                                            </div>
                                        </label>

                                        {formData.requireBank && (
                                            <div className="ml-7 p-3 bg-white rounded-lg border border-amber-200">
                                                <div>
                                                    <label className="block text-sm font-medium text-slate-700 mb-1">Durasi Pengerjaan Bank Soal (opsional)</label>
                                                    <input
                                                        type="number" min="0" max="300"
                                                        placeholder="Tidak dibatasi (0)"
                                                        value={formData.duration || ''}
                                                        onChange={e => setFormData({ ...formData, duration: parseInt(e.target.value) || 0 })}
                                                        className="w-full border border-amber-300 rounded-xl p-2.5 text-sm focus:ring-2 focus:ring-amber-400 outline-none"
                                                    />
                                                    <p className="text-[10px] text-slate-400 mt-1">Kosongkan/isi 0 jika tidak ada batas waktu layar</p>
                                                </div>
                                            </div>
                                        )}

                                        <label className="flex items-start gap-3 cursor-pointer group">
                                            <input
                                                type="checkbox"
                                                checked={formData.allowFileUpload}
                                                onChange={e => setFormData({ ...formData, allowFileUpload: e.target.checked })}
                                                className="mt-0.5 w-4 h-4 rounded border-amber-400 text-amber-600 focus:ring-amber-500/20"
                                            />
                                            <div>
                                                <span className="text-sm font-medium text-slate-700">Siswa Wajib Unggah File</span>
                                                <p className="text-[11px] text-slate-500">Siswa harus mengunggah dokumen tugas mereka.</p>
                                            </div>
                                        </label>

                                        {formData.allowFileUpload && (
                                            <div className="ml-7 p-3 bg-white rounded-lg border border-amber-200">
                                                <p className="text-xs font-semibold text-slate-600 mb-2">Jenis File yang Diizinkan:</p>
                                                <div className="flex flex-wrap gap-2">
                                                    {['pdf', 'docx', 'jpg', 'png', 'zip', 'xlsx', 'pptx'].map(ft => (
                                                        <label key={ft} className="flex items-center gap-1.5 cursor-pointer">
                                                            <input
                                                                type="checkbox"
                                                                checked={formData.allowedFileTypes.includes(ft)}
                                                                onChange={e => {
                                                                    if (e.target.checked) {
                                                                        setFormData({ ...formData, allowedFileTypes: [...formData.allowedFileTypes, ft] });
                                                                    } else {
                                                                        setFormData({ ...formData, allowedFileTypes: formData.allowedFileTypes.filter(t => t !== ft) });
                                                                    }
                                                                }}
                                                                className="w-3.5 h-3.5 rounded border-slate-300 text-amber-600"
                                                            />
                                                            <span className="text-xs font-mono text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded">.{ft}</span>
                                                        </label>
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        <div className="grid grid-cols-1 gap-3">
                                            <div>
                                                <label className="block text-xs font-medium text-slate-700 mb-1">URL File Dokumen Referensi <span className="text-slate-400">(Opsional)</span></label>
                                                <input
                                                    type="url" placeholder="Contoh: https://drive.google.com/..."
                                                    value={formData.documentUrl} onChange={e => setFormData({ ...formData, documentUrl: e.target.value })}
                                                    className="w-full border border-amber-300 rounded-xl p-2.5 text-sm focus:ring-2 focus:ring-amber-400 outline-none"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-xs font-medium text-slate-700 mb-1">URL Video Pembelajaran <span className="text-slate-400">(Opsional)</span></label>
                                                <input
                                                    type="url" placeholder="Contoh: https://youtube.com/..."
                                                    value={formData.videoUrl} onChange={e => setFormData({ ...formData, videoUrl: e.target.value })}
                                                    className="w-full border border-amber-300 rounded-xl p-2.5 text-sm focus:ring-2 focus:ring-amber-400 outline-none"
                                                />
                                            </div>
                                        </div>
                                    </div>
                                )}
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                                    <label className="flex items-center gap-2 p-3 bg-slate-50 rounded-xl cursor-pointer border border-[#030C4D]/20 hover:bg-slate-100 transition-colors">
                                        <input type="checkbox" checked={formData.randomizeQuestions}
                                            onChange={e => setFormData({ ...formData, randomizeQuestions: e.target.checked })}
                                            className="w-4 h-4 rounded border-slate-300 text-[#030C4D] focus:ring-[#030C4D]/20" />
                                        <span className="text-sm text-slate-600">Acak Soal</span>
                                    </label>
                                    <label className="flex items-center gap-2 p-3 bg-slate-50 rounded-xl cursor-pointer border border-[#030C4D]/20 hover:bg-slate-100 transition-colors">
                                        <input type="checkbox" checked={formData.randomizeOptions}
                                            onChange={e => setFormData({ ...formData, randomizeOptions: e.target.checked })}
                                            className="w-4 h-4 rounded border-slate-300 text-[#030C4D] focus:ring-[#030C4D]/20" />
                                        <span className="text-sm text-slate-600">Acak Opsi</span>
                                    </label>
                                    <label className="flex items-center gap-2 p-3 bg-slate-50 rounded-xl cursor-pointer border border-[#030C4D]/20 hover:bg-slate-100 transition-colors">
                                        <input type="checkbox" checked={formData.isSafeMode}
                                            onChange={e => setFormData({ ...formData, isSafeMode: e.target.checked })}
                                            className="w-4 h-4 rounded border-slate-300 text-[#030C4D] focus:ring-[#030C4D]/20" />
                                        <span className="text-sm text-slate-600">Mode Aman</span>
                                    </label>
                                    <label className={`flex items-center gap-2 p-3 bg-slate-50 rounded-xl border border-[#030C4D]/20 transition-colors ${formData.scoringTypes.some(t => t.startsWith('irt_')) ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:bg-slate-100'}`}>
                                        <input type="checkbox" checked={formData.showResults}
                                            disabled={formData.scoringTypes.some(t => t.startsWith('irt_'))}
                                            onChange={e => setFormData({ ...formData, showResults: e.target.checked })}
                                            className="w-4 h-4 rounded border-slate-300 text-[#030C4D] focus:ring-[#030C4D]/20 disabled:bg-slate-200" />
                                        <span className="text-sm text-slate-600">
                                            Tampilkan Nilai
                                            {formData.scoringTypes.some(t => t.startsWith('irt_')) && " (Nonaktif)"}
                                        </span>
                                    </label>
                                </div>
                                {formData.examType === 'lainnya' && (
                                    <label className="flex items-center gap-2 cursor-pointer group mt-4">
                                        <input type="checkbox" checked={formData.isPublic} onChange={e => setFormData({ ...formData, isPublic: e.target.checked })} className="hidden" />
                                        <div className={`w-4 h-4 rounded border ${formData.isPublic ? 'bg-emerald-500 border-emerald-500' : 'bg-white border-slate-300'} flex items-center justify-center transition-all`}>
                                            {formData.isPublic && <Check size={12} className="text-white" />}
                                        </div>
                                        <div className="flex flex-col">
                                            <span className="text-sm font-medium text-slate-700">Ujian Umum (Publik)</span>
                                            <span className="text-[11px] text-slate-400">Semua siswa di sekolah dapat mengakses ujian ini.</span>
                                        </div>
                                    </label>
                                )}
                                <button type="submit" disabled={isSubmitting}
                                    className="w-full py-3 bg-[#030C4D] text-white rounded-xl font-semibold disabled:opacity-50 hover:bg-[#030C4D]/90 transition-colors flex items-center justify-center gap-2">
                                    {isSubmitting ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                                    Simpan Perubahan
                                </button>
                            </form>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>

            {/* ─────────────── ASSIGN MODAL ─────────────── */}
            <AnimatePresence>
                {isAssignModalOpen && selectedExam && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
                        <motion.div
                            initial={{ scale: 0.95, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.95, opacity: 0 }}
                            className="bg-white w-full max-w-xl rounded-2xl p-6 relative border border-[#030C4D]/30 max-h-[90vh] overflow-y-auto"
                        >
                            <button onClick={() => setIsAssignModalOpen(false)} className="absolute top-4 right-4 text-slate-400 hover:text-slate-600">
                                <X size={20} />
                            </button>
                            {/* Header */}
                            <div className="flex items-center gap-3 mb-6 pb-4 border-b border-[#030C4D]/20">
                                <div className="w-10 h-10 rounded-lg bg-[#030C4D]/10 text-[#030C4D] flex items-center justify-center border border-[#030C4D]/30">
                                    <Users size={18} />
                                </div>
                                <div>
                                    <h3 className="text-lg font-bold text-slate-900">Tetapkan ke Kelas</h3>
                                    <p className="text-xs text-slate-500 truncate">"{selectedExam?.title}"</p>
                                </div>
                            </div>

                            {selectedExam?.metadata?.is_public ? (
                                <div className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 p-4 rounded-xl text-center my-6">
                                    <Globe size={32} className="mx-auto mb-3 text-emerald-500" />
                                    <p className="font-semibold text-lg mb-1">Ujian Umum (Publik)</p>
                                    <p>Ujian ini tersedia untuk <b>siswa anggota aktif sekolah ini</b> saat dipublikasikan. Anda tidak perlu menetapkan target kelas secara manual. Anggota sekolah lain tidak dapat mengaksesnya.</p>
                                    <button
                                        type="button"
                                        onClick={() => setIsAssignModalOpen(false)}
                                        className="w-full mt-6 py-3 bg-[#030C4D] text-white rounded-xl font-semibold flex items-center justify-center hover:bg-[#030C4D]/90 transition-colors"
                                    >
                                        Tutup
                                    </button>
                                </div>
                            ) : (
                                <>
                                    {/* Info banner */}
                                    <div className="flex items-start gap-2 p-3 bg-[#030C4D]/5 border border-[#030C4D]/20 rounded-xl text-sm text-slate-600 mb-4">
                                        <Info size={14} className="text-[#030C4D] shrink-0 mt-0.5" />
                                        <p>Pilih kelas dan tentukan siswa yang boleh mengerjakan. Cocok untuk ujian susulan — pilih siswa tertentu dari kelas terkait.</p>
                                    </div>

                            <div className="space-y-3 max-h-[400px] overflow-y-auto pr-1">
                                {classes.length === 0 ? (
                                    <p className="text-sm text-slate-400 text-center py-8">Belum ada kelas.</p>
                                ) : classes.map(cls => {
                                    const isSelected = assignData.classIds.includes(cls.id);
                                    const students = classStudents[cls.id] || [];
                                    const assignment = classAssignments[cls.id] || { mode: 'all', studentIds: [] };
                                    const isExpanded = selectedClassForStudents === cls.id;
                                    const selectedCount = assignment.mode === 'all' ? students.length : assignment.studentIds.length;

                                    return (
                                        <div key={cls.id} className={`rounded-xl border transition-all overflow-hidden ${
                                            isSelected
                                                ? 'border-[#030C4D] bg-[#030C4D]/5'
                                                : 'border-[#030C4D]/30 bg-white'
                                        }`}>
                                            {/* Class row */}
                                            <div className="flex items-center gap-3 p-3.5">
                                                <input
                                                    type="checkbox"
                                                    checked={isSelected}
                                                    onChange={() => {
                                                        const ids = isSelected
                                                            ? assignData.classIds.filter(id => id !== cls.id)
                                                            : [...assignData.classIds, cls.id];
                                                        setAssignData({ ...assignData, classIds: ids });
                                                        // Set default: all students
                                                        setClassAssignments(prev => ({
                                                            ...prev,
                                                            [cls.id]: { mode: 'all', studentIds: [] }
                                                        }));
                                                    }}
                                                    className="w-4.5 h-4.5 rounded border-slate-300 text-[#030C4D] shrink-0"
                                                />
                                                <div className="flex-1 min-w-0 cursor-pointer"
                                                    onClick={() => {
                                                        if (!isSelected) {
                                                            const ids = [...assignData.classIds, cls.id];
                                                            setAssignData({ ...assignData, classIds: ids });
                                                            setClassAssignments(prev => ({
                                                                ...prev,
                                                                [cls.id]: { mode: 'all', studentIds: [] }
                                                            }));
                                                        }
                                                    }}
                                                >
                                                    <p className="text-sm font-semibold text-slate-800">{cls.name}</p>
                                                    <p className="text-xs text-slate-400">{students.length} siswa di kelas ini</p>
                                                </div>
                                                {isSelected && students.length > 0 && (
                                                    <button
                                                        onClick={() => setSelectedClassForStudents(isExpanded ? null : cls.id)}
                                                        className={`px-3 py-1.5 text-xs font-semibold rounded-lg border-2 transition-all shrink-0 shadow-sm ${
                                                            isExpanded
                                                                ? 'bg-[#030C4D] text-white border-[#030C4D] shadow-[#030C4D]/20'
                                                                : 'bg-indigo-50 text-[#030C4D] border-[#030C4D]/40 hover:bg-[#030C4D] hover:text-white hover:border-[#030C4D]'
                                                        }`}
                                                    >
                                                        {isExpanded ? '✕ Tutup' : '👤 Pilih Siswa'}
                                                    </button>
                                                )}
                                                {isSelected && (
                                                    <span className="text-xs font-semibold text-emerald-600 shrink-0">
                                                        {selectedCount}/{students.length} siswa
                                                    </span>
                                                )}
                                            </div>

                                            {/* Student selection (expandable) */}
                                            {isSelected && isExpanded && students.length > 0 && (
                                                <div className="border-t border-[#030C4D]/20 px-4 py-3 space-y-2 bg-white">
                                                    {/* Mode selector */}
                                                    <div className="flex gap-3 mb-2">
                                                        <button
                                                            type="button"
                                                            onClick={() => setClassAssignments(prev => ({
                                                                ...prev,
                                                                [cls.id]: { mode: 'all', studentIds: [] }
                                                            }))}
                                                            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all border ${
                                                                assignment.mode === 'all'
                                                                    ? 'bg-[#030C4D] text-white border-[#030C4D]'
                                                                    : 'bg-slate-50 text-slate-500 border-slate-200 hover:border-slate-300'
                                                            }`}
                                                        >
                                                            Semua ({students.length})
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => setClassAssignments(prev => ({
                                                                ...prev,
                                                                [cls.id]: { mode: 'selected', studentIds: [] }
                                                            }))}
                                                            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all border ${
                                                                assignment.mode === 'selected'
                                                                    ? 'bg-[#030C4D] text-white border-[#030C4D]'
                                                                    : 'bg-slate-50 text-slate-500 border-slate-200 hover:border-slate-300'
                                                            }`}
                                                        >
                                                            Pilih Siswa...
                                                        </button>
                                                    </div>

                                                    {/* Student list (only when mode = selected) */}
                                                    {assignment.mode === 'selected' && (
                                                        <div className="max-h-[150px] overflow-y-auto bg-slate-50 rounded-xl border border-slate-200 p-2 space-y-1">
                                                            {students.map(student => {
                                                                const isStudentSelected = assignment.studentIds.includes(student.id);
                                                                return (
                                                                    <label key={student.id} className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-white cursor-pointer transition-all">
                                                                        <input
                                                                            type="checkbox"
                                                                            checked={isStudentSelected}
                                                                            onChange={() => {
                                                                                const ids = isStudentSelected
                                                                                    ? assignment.studentIds.filter(id => id !== student.id)
                                                                                    : [...assignment.studentIds, student.id];
                                                                                setClassAssignments(prev => ({
                                                                                    ...prev,
                                                                                    [cls.id]: { ...assignment, studentIds: ids }
                                                                                }));
                                                                            }}
                                                                            className="w-3.5 h-3.5 rounded border-slate-300 text-[#030C4D]"
                                                                        />
                                                                        <div className="min-w-0 flex-1">
                                                                            <p className="text-xs font-medium text-slate-700 truncate">{student.full_name || 'Tanpa nama'}</p>
                                                                            {student.email && <p className="text-[10px] text-slate-400 truncate">{student.email}</p>}
                                                                        </div>
                                                                    </label>
                                                                );
                                                            })}
                                                            {assignment.studentIds.length > 0 && (
                                                                <button
                                                                    type="button"
                                                                    onClick={() => setClassAssignments(prev => ({
                                                                        ...prev,
                                                                        [cls.id]: { ...assignment, studentIds: [] }
                                                                    }))}
                                                                    className="w-full text-xs text-slate-400 hover:text-[#030C4D] py-1 border-t border-slate-200 mt-1 pt-2"
                                                                >
                                                                    Hapus semua pilihan
                                                                </button>
                                                            )}
                                                        </div>
                                                    )}

                                                    {assignment.mode === 'selected' && assignment.studentIds.length === 0 && (
                                                        <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                                                            Tidak ada siswa dipilih — ujian tidak akan muncul untuk siswa manapun di kelas ini.
                                                        </p>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>

                            {/* Summary */}
                            <div className="mt-4 pt-4 border-t border-[#030C4D]/20">
                                {assignData.classIds.length === 0 ? (
                                    <div className="text-xs text-red-600 bg-red-50 border border-red-200 p-3 rounded-xl">
                                        Belum ada kelas dipilih. Ujian tidak akan muncul di jadwal siswa manapun.
                                    </div>
                                ) : (
                                    <div className="text-xs text-slate-600 bg-emerald-50 border border-emerald-200 p-3 rounded-xl space-y-1">
                                        <p className="font-semibold text-emerald-700">Ringkasan:</p>
                                        <p>• {assignData.classIds.length} kelas dipilih</p>
                                        <p>• {
                                            assignData.classIds.reduce((total, clsId) => {
                                                const a = classAssignments[clsId];
                                                return total + (a?.mode === 'selected' ? a.studentIds.length : (classStudents[clsId] || []).length);
                                            }, 0)
                                        } siswa total yang bisa mengerjakan</p>
                                        <p className="text-slate-500">• Klik "Pilih Siswa" pada kelas untuk membatasi siswa (misal: susulan)</p>
                                    </div>
                                )}
                            </div>

                            <button
                                type="button"
                                onClick={handleAssignExam}
                                disabled={isSubmitting || assignData.classIds.length === 0}
                                className="w-full mt-4 py-3 bg-[#030C4D] text-white rounded-xl font-semibold disabled:opacity-50 flex items-center justify-center gap-2 hover:bg-[#030C4D]/90 transition-colors"
                            >
                                {isSubmitting ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                                Tetapkan
                            </button>
                                </>
                            )}
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>
        </div>
    );
};

export default ExamsPage;
