"use client";
import '@/components/exams/exams-mobile.css';
import { AssignExamModal } from '@/components/exams/AssignExamModal';
import { CreateExamModal } from '@/components/exams/CreateExamModal';
import { DeleteExamModal } from '@/components/exams/DeleteExamModal';
import { alertDialog, confirmDialog } from '@/lib/confirm-dialog';
import { Spinner } from '@/app/components/ui/Spinner';
import { InlineSelect } from '@/components/ui/InlineSelect';
import { MultiSelect } from '@/components/ui/MultiSelect';
import SearchableSelect from '@/components/ui/SearchableSelect';
import { FilterActions, FilterSearch, FilterSelect, FilterToolbar } from '@/app/components/ui/filtertoolbar';
import { Button } from '@/app/components/ui/button';
import { addExamConfigBankAction,addExamConfigExamAction,createExamConfigAction,getExamConfig,listExamConfigs } from '@/lib/api/exam-configs';
import { deleteExam,purgeTrialExam,setExamArchived } from '@/lib/api/exams';
import type { ExamConfig,ExamConfigBank,PASPeriod } from '@/app/types/pas';
import { deletePASPeriodAction, listPASPeriods, listSubjects } from '@/lib/api/pas';
import {
createSchoolYearAction,
getProctorOrganization,
listClassStudents,
listExamAssignmentsAction,
listOrganizationClasses,
listOrganizationExams,
listSchoolYears,
publishExamAction
} from '@/lib/api/proctor';
import { listOrganizationLabels,listQuestionBanks } from '@/lib/api/questions';
import type { OrganizationLabel,QuestionBank } from '@/lib/api/questions';
import type { ClassStudent,OrganizationClass,OrganizationExam,ProctorOrganization,SchoolSubject,SchoolYear } from '@/lib/api/proctor';
import { getSessionUser } from '@/lib/session';
import { isFolderExamCategory, matchesExamType } from '@/lib/exam-types';
import { formatSchoolDateTime, getSchoolTimeZoneLabel } from '@/lib/school-time';
import { useSchoolTimeZone } from '@/lib/useSchoolTimeZone';
import { REFRESH_INTERVAL,useAutoRefresh } from '@/lib/useAutoRefresh';
import { useMemoryState } from '@/lib/useMemoryState';
import { AnimatePresence,motion } from 'framer-motion';
import {
AlertCircle,
Archive,
BookOpen,
Calendar,
CheckCircle2,
ClipboardCheck,
Clock,
Eye,EyeOff,
FileText,
FolderOpen,
Globe,GlobeLock,
Loader2,
Lock,
Plus,Search,
Settings,
Trash2,
Unlock,
Users,
X,
Zap
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import React,{ useCallback,useEffect,useMemo,useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import ProctorPASPage from '../pas/page';

type TabId = 'all' | 'draft' | 'active' | 'finished' | 'archived' | 'pas';
type SortBy = 'newest' | 'oldest' | 'name';

const ExamsPage = () => {
    const { timeZone, error: timeZoneError } = useSchoolTimeZone();
    const [exams, setExams] = useMemoryState<OrganizationExam[]>('proktor_exams_exams', []);
    const [qBanks, setQBanks] = useMemoryState<QuestionBank[]>('proktor_exams_qBanks', []);
    const [org, setOrg] = useState<ProctorOrganization | null>(null);
    const [classes, setClasses] = useMemoryState<OrganizationClass[]>('proktor_exams_classes', []);
    const [isLoading, setIsLoading] = useMemoryState('proktor_exams_isLoading', true);
    const [searchQuery, setSearchQuery] = useState('');
    const router = useRouter();
    const [activeTab, setActiveTab] = useState<TabId>('all');
    const [typeFilter, setTypeFilter] = useState<string>('all');
    const [sortBy, setSortBy] = useState<SortBy>('newest');

    // Labels state
    const [, setLabels] = useMemoryState<OrganizationLabel[]>('proktor_exams_labels', []);

    // Subjects state
    const [subjects, setSubjects] = useMemoryState<SchoolSubject[]>('proktor_exams_subjects', []);

    // FOLDER / Exam Config & PAS Period state
    const [examConfigs, setExamConfigs] = useMemoryState<ExamConfig[]>('proktor_exams_examConfigs', []);
    const [pasPeriods, setPasPeriods] = useMemoryState<PASPeriod[]>('admin_exams_pasPeriods', []);
    const [selectedConfigId, setSelectedConfigId] = useState<string | null>(null);
    const [selectedConfig, setSelectedConfig] = useState<ExamConfig | null>(null);
    const [configBanks, setConfigBanks] = useMemoryState<ExamConfigBank[]>('proktor_exams_configBanks', []);
    const [, setSelectedConfigExamIds] = useMemoryState<string[]>('proktor_exams_selectedConfigExamIds', []);
    const [, setIsLoadingConfig] = useState(false);
    const [] = useState(false);
    const [, setIsConfigDetailOpen] = useState(false);

    // Folder config modal
    const [isConfigModalOpen, setIsConfigModalOpen] = useState(false);
    const [configForm, setConfigForm] = useState({
        name: '', school_year: '', semester: '',
        start_date: '', end_date: ''
    });
    const [schoolYears, setSchoolYears] = useMemoryState<SchoolYear[]>('proktor_exams_schoolYears', []);
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
    const [examAssignments, setExamAssignments] = useState<Record<string, { classCount: number, studentCount: number }>>({});
    const [classStudents, setClassStudents] = useState<Record<string, ClassStudent[]>>({});
    const [isSubmitting, setIsSubmitting] = useState(false);
    // Per-exam publish/unpublish in-flight id, so ONLY the clicked card's button
    // shows a spinner (the shared isSubmitting can't tell buttons apart).
    const [publishingId, setPublishingId] = useState<string | null>(null);
    // Modals
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [isAssignModalOpen, setIsAssignModalOpen] = useState(false);
    const [selectedExam, setSelectedExam] = useState<OrganizationExam | null>(null);
    const [examToDelete, setExamToDelete] = useState<OrganizationExam | null>(null);

    const loadData = useCallback(async () => {
        // setIsLoading(true); // Disabled for silent background sync
        try {
            const user = await getSessionUser();
            if (user) {
                const organization = await getProctorOrganization();
                if (organization) {
                    setOrg(organization);
                    const [examList, bankList, classList, pasPeriodList, realPasPeriods, labelList, subjectList, schoolYearList] = await Promise.all([
                        listOrganizationExams(),
                        listQuestionBanks(true),
                        listOrganizationClasses({ activeYearOnly: true }),
                        listExamConfigs(),
                        listPASPeriods(),
                        listOrganizationLabels(),
                        listSubjects(),
                        listSchoolYears(),
                    ]);

                    // Fetch existing exam assignments via SERVER ACTION — query
                    // langsung dari client memakai anon key sehingga RLS memblokir
                    // cbt_exam_targets/participants dan status selalu "belum ditugaskan".
                    const examIds = examList.map((exam) => exam.id);
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
                    setPasPeriods(realPasPeriods || []);
                    setClasses(classList || []);
                    setLabels(labelList || []);
                    setSubjects(subjectList || []);
                    setSchoolYears(schoolYearList || []);
                    setExamAssignments(assignmentMap);

                    // Pre-load students for all classes via SERVER ACTION.
                    // Query langsung dari client memakai anon key (service role tidak ada di browser)
                    // sehingga RLS memblokir cbt_class_members/cbt_profiles → siswa tampil 0.
                    const studentMap = await listClassStudents(classList.map((item) => item.id));
                    setClassStudents(studentMap);
                }
            }
        } catch (err) {
            console.error('Failed to load exams page data:', err);
        } finally {
            setIsLoading(false);
        }
    }, [setClasses, setExamConfigs, setExams, setIsLoading, setLabels, setPasPeriods, setQBanks, setSchoolYears, setSubjects]);

    useEffect(() => {
        const timer = window.setTimeout(() => void loadData(), 0);
        return () => window.clearTimeout(timer);
    }, [loadData]);

    // Daftar ujian disegarkan berkala; langganan realtime Supabase sudah tidak ada.
    useAutoRefresh(loadData, REFRESH_INTERVAL.dashboard);






    const handlePublishToggle = async (exam: OrganizationExam) => {
        const assignment = examAssignments[exam.id] || { classCount: 0, studentCount: 0 };
        const isPublic = exam.metadata?.is_public === true;
        // Penugasan bisa berupa kelas penuh (classCount) ATAU siswa terpilih
        // saja (studentCount tanpa classCount) — keduanya sah untuk publish.
        if (!exam.is_published && assignment.classCount === 0 && assignment.studentCount === 0 && !isPublic) {
            // Not yet assigned — open assign modal instead
            openAssign(exam);
            return;
        }
        if (!await confirmDialog({
            title: exam.is_published ? 'Unpublish Ujian?' : 'Publish Ujian?',
            text: exam.is_published
                ? `Unpublish ujian "${exam.title}" dan kembalikan statusnya menjadi draf?`
                : `Publish ujian "${exam.title}" agar tersedia bagi peserta sesuai jadwal dan penugasan?`,
            confirmText: 'Ya', cancelText: 'Tidak', variant: 'warning',
        })) return;
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

    const handleDeleteExam = (exam: OrganizationExam) => {
        setExamToDelete(exam);
    };

    const handleArchiveExam = async (exam: OrganizationExam) => {
        const archive = exam.status !== 'archived';
        const confirmed = await confirmDialog({
            title: archive ? 'Arsipkan Ujian?' : 'Pulihkan Ujian?',
            text: archive
                ? 'Arsipkan ujian ini? Jawaban dan nilai tetap disimpan.'
                : 'Pulihkan ujian ini sebagai draft?',
            variant: archive ? 'warning' : 'info',
            confirmText: archive ? 'Ya, Arsipkan' : 'Ya, Pulihkan',
        });
        if (!confirmed) return;
        setIsLoading(true);
        const result = await setExamArchived(exam.id, archive);
        if (result.success) {
            await loadData();
        } else {
            await alertDialog({
                title: 'Gagal',
                text: result.error || 'Status arsip gagal diubah.',
                variant: 'danger',
            });
        }
        setIsLoading(false);
    };

    const getExamStatus = (exam: OrganizationExam) => {
        if (exam.status === 'archived') return 'archived';
        const now = new Date();
        const start = exam.start_time ? new Date(exam.start_time) : null;
        const end = exam.end_time ? new Date(exam.end_time) : null;
        const isFinished = exam.status === 'finished' || (end ? end < now : false);
        const isActive = !!exam.is_published && (!start || start <= now) && (!end || end >= now) && !isFinished;
        if (!exam.is_published) return 'draft';
        if (isActive) return 'active';
        if (isFinished) return 'finished';
        return 'unknown';
    };

    const isPasGeneratedExam = (e: OrganizationExam): boolean => {
        return Boolean(e.metadata?.is_pas_exam === true || e.metadata?.pas_period_id);
    };

    const getExamTabFilter = (e: OrganizationExam, tabId: TabId): boolean => {
        if (isPasGeneratedExam(e)) return false;
        if (!matchesExamType(e.exam_type, typeFilter)) return false;
        if (tabId === 'all') return getExamStatus(e) !== 'archived';
        return getExamStatus(e) === tabId;
    };

    const matchesPasPeriodTab = (p: PASPeriod, tabId: TabId): boolean => {
        if (!matchesExamType(p.type, typeFilter)) return false;
        const now = new Date();
        const start = new Date(p.start_date ?? 0);
        const end = new Date(p.end_date ?? 0);
        end.setHours(23, 59, 59, 999);
        const isActive = start <= now && end >= now && !p.is_locked;
        const isFinished = end < now;
        const isDraft = !isActive && !isFinished;

        if (tabId === 'all') return true;
        if (tabId === 'draft') return isDraft;
        if (tabId === 'active') return isActive;
        if (tabId === 'finished') return isFinished;
        return false;
    };

    const filterByTab = (examList: OrganizationExam[]): OrganizationExam[] => {
        return examList.filter(e => getExamTabFilter(e, activeTab));
    };

    const sortExams = (list: OrganizationExam[]): OrganizationExam[] => {
        return [...list].sort((a, b) => {
            if (sortBy === 'name') return (a.title || '').localeCompare(b.title || '');
            if (sortBy === 'oldest') return new Date(a.created_at ?? 0).getTime() - new Date(b.created_at ?? 0).getTime();
            return new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime();
        });
    };

    const filteredExams = sortExams(
        filterByTab(exams).filter(e =>
            e.title?.toLowerCase().includes(searchQuery.toLowerCase())
        )
    );

    const filteredPasFolders = typeFilter === 'all'
        ? pasPeriods.filter(p =>
            matchesPasPeriodTab(p, activeTab) &&
            p.name?.toLowerCase().includes(searchQuery.toLowerCase())
          )
        : [];

    const tabs: { id: TabId; label: string; icon: LucideIcon; color: string }[] = [
        { id: 'all', label: 'Semua', icon: FolderOpen, color: 'text-slate-500' },
        { id: 'draft', label: 'Draft', icon: AlertCircle, color: 'text-red-500' },
        { id: 'active', label: 'Aktif', icon: Zap, color: 'text-emerald-500' },
        { id: 'finished', label: 'Selesai', icon: CheckCircle2, color: 'text-slate-400' },
        { id: 'archived', label: 'Arsip', icon: Archive, color: 'text-violet-500' },
    ];

    const openEdit = (exam: OrganizationExam) => {
        setSelectedExam(exam);
        setIsEditModalOpen(true);
    };

    const openAssign = (exam: OrganizationExam) => {
        setSelectedExam(exam);
        setIsAssignModalOpen(true);
    };

    const formatDateTime = (str: string | null | undefined) => {
        return formatSchoolDateTime(str, timeZone);
    };

    const getExamWindow = (exam: OrganizationExam) => {
        if (!exam.start_time && !exam.end_time) return 'Kapan saja';
        if (exam.start_time && !exam.end_time) return `Mulai ${formatDateTime(exam.start_time)}`;
        return `${formatDateTime(exam.start_time)} - ${formatDateTime(exam.end_time)}`;
    };

    const publishedBanks = useMemo(() => qBanks.filter((b) => b.is_published), [qBanks]);


    // ─── Folder / Exam Config helpers ─────────────────────────
    const openConfigDetail = async (configId: string) => {
        setSelectedConfigId(configId);
        setIsLoadingConfig(true);
        setIsConfigDetailOpen(false);
        setSelectedConfigExamIds([]);
        try {
            const data = await getExamConfig(configId);
            setSelectedConfig(data);
            setConfigBanks(data?.exam_config_banks || []);
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

        const targetSchoolYear = configForm.school_year.trim();
        if (targetSchoolYear) {
            const yearPattern = /^\d{4}\/\d{4}$/;
            if (!yearPattern.test(targetSchoolYear)) {
                alert('Format tahun ajaran harus YYYY/YYYY, contoh: 2024/2025');
                setIsSubmittingConfig(false);
                return;
            }

            const exists = schoolYears.some(sy => sy.year.trim() === targetSchoolYear);
            if (!exists) {
                const addSyResult = await createSchoolYearAction({ year: targetSchoolYear });
                if (!addSyResult.success) {
                    alert('Gagal menambah tahun ajaran baru: ' + (addSyResult.error || 'Unknown error'));
                    setIsSubmittingConfig(false);
                    return;
                }
            }
        }

        const result = await createExamConfigAction({
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
        const list = await listExamConfigs();
        setExamConfigs(list);
        const syList = await listSchoolYears();
        setSchoolYears(syList || []);
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
        } else if (!result.success) alert('Gagal: ' + result.error);
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



    return (
        <div className="max-w-7xl mx-auto pb-24">
            {timeZoneError && <div role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{timeZoneError}</div>}

            {/* Tab Navigation */}
            <div className="exam-status-tabs flex gap-2 mb-6">
                {tabs.map(tab => {
                    const Icon = tab.icon;
                    let count = 0;
                    if (isFolderExamCategory(typeFilter)) {
                        count = pasPeriods.filter(p => matchesPasPeriodTab(p, tab.id)).length;
                    } else if (typeFilter === 'all') {
                        count = exams.filter(e => getExamTabFilter(e, tab.id)).length + pasPeriods.filter(p => matchesPasPeriodTab(p, tab.id)).length;
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
                                    ? 'bg-[#3083FF] text-white shadow-lg'
                                    : 'bg-white text-slate-600 border border-[#3083FF]/30 hover:border-[#3083FF] hover:bg-[#3083FF]/5'
                            }`}
                        >
                            <Icon size={16} className={isActive ? 'text-white' : tab.color} />
                            <span>{tab.label}</span>
                            <span className={`ml-auto lg:ml-0 px-2 py-0.5 rounded-full text-[10px] sm:text-xs font-bold ${
                                isActive
                                    ? 'bg-white/20 text-white'
                                    : tab.id === 'draft'
                                        ? 'bg-red-50 text-red-600 border border-red-200'
                                        : 'bg-[#3083FF]/10 text-[#3083FF]'
                            }`}>
                                {count}
                            </span>
                        </button>
                    );
                })}
            </div>

            {/* Search + Filters + Sort */}
            {!isFolderExamCategory(typeFilter) && (
                <div className="mb-6">
                    <FilterToolbar actionsInline>
                        <FilterSearch
                            value={searchQuery}
                            onChange={setSearchQuery}
                            placeholder="Cari ujian..."
                            label="Cari Ujian"
                            grow={1}
                        />

                        <FilterSelect
                            label="Jenis Ujian"
                            value={typeFilter}
                            onChange={val => setTypeFilter(val as string)}
                            options={[
                                { value: 'all', label: 'Semua Jenis Ujian' },
                                { value: 'daily', label: 'Ulangan Harian' },
                                { value: 'asas_asat', label: 'ASAS/ASAT' },
                                { value: 'am', label: 'Asesmen Madrasah' },
                                { value: 'tryout', label: 'Try Out' },
                                { value: 'assignment', label: 'Tugas' },
                                { value: 'lainnya', label: 'Lainnya' },
                            ]}
                        />

                        <FilterSelect
                            label="Urutkan"
                            value={sortBy}
                            onChange={val => setSortBy(val as SortBy)}
                            options={[
                                { value: 'newest', label: 'Terbaru' },
                                { value: 'oldest', label: 'Terlama' },
                                { value: 'name', label: 'Nama' },
                            ]}
                        />

                        <FilterActions>
                            <Button
                                variant="primary"
                                icon="add"
                                onClick={() => setIsAddModalOpen(true)}
                            >
                                Buat Ujian Baru
                            </Button>
                        </FilterActions>
                    </FilterToolbar>
                </div>
            )}

            {/* ─────────────── PAS TAB CONTENT ─────────────── */}
            {isFolderExamCategory(typeFilter) && (
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-1 sm:p-6 mb-6">
                    <ProctorPASPage key={typeFilter} activeTab={activeTab} typeFilter={typeFilter} onTypeFilterChange={setTypeFilter} />
                </div>
            )}

            {/* ─────────────── CREATE FOLDER CONFIG MODAL ─────────────── */}
            <AnimatePresence>
                {isConfigModalOpen && (
                    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
                        <motion.div
                            initial={{ scale: 0.95, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.95, opacity: 0 }}
                            className="bg-white w-full max-w-md rounded-2xl p-6 relative border border-[#3083FF]/30"
                        >
                            <button onClick={() => setIsConfigModalOpen(false)} className="absolute top-4 right-4 text-slate-400 hover:text-slate-600">
                                <X size={20} />
                            </button>
                            <div className="flex items-center gap-3 mb-6 pb-4 border-b border-[#3083FF]/20">
                                <div className="w-10 h-10 rounded-lg bg-[#3083FF]/10 text-[#3083FF] flex items-center justify-center border border-[#3083FF]/30">
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
                                        className="w-full border border-[#3083FF]/30 rounded-xl p-3 text-sm focus:ring-2 focus:ring-[#3083FF]/20 outline-none"
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
                                            className="w-full border border-[#3083FF]/30 rounded-xl p-3 text-sm focus:ring-2 focus:ring-[#3083FF]/20 outline-none"
                                        />
                                        {isYearDropdownOpen && (
                                            <>
                                                <div 
                                                    className="fixed inset-0 z-10" 
                                                    onClick={() => setIsYearDropdownOpen(false)}
                                                />
                                                <div className="absolute z-20 w-full mt-1 bg-white border border-[#3083FF]/20 rounded-xl shadow-lg max-h-48 overflow-y-auto">
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
                                                                        className="w-full text-left px-4 py-2.5 text-sm hover:bg-[#3083FF]/5 text-slate-700 transition-colors border-b border-slate-100 last:border-0"
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
                                    <InlineSelect
                                        value={configForm.semester}
                                        onChange={val => setConfigForm(p => ({ ...p, semester: val }))}
                                        height="42px"
                                        className="w-full"
                                        options={[
                                            { value: '', label: 'Pilih Semester (Opsional)' },
                                            { value: 'semua', label: 'Semua' },
                                            { value: 'ganjil', label: 'Ganjil' },
                                            { value: 'genap', label: 'Genap' },
                                        ]}
                                    />
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 mb-1.5">Tanggal Mulai</label>
                                        <input type="date" value={configForm.start_date}
                                            onChange={e => setConfigForm(p => ({ ...p, start_date: e.target.value }))}
                                            className="w-full border border-[#3083FF]/30 rounded-xl p-3 text-sm" />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 mb-1.5">Tanggal Selesai</label>
                                        <input type="date" value={configForm.end_date}
                                            onChange={e => setConfigForm(p => ({ ...p, end_date: e.target.value }))}
                                            className="w-full border border-[#3083FF]/30 rounded-xl p-3 text-sm" />
                                    </div>
                                </div>
                                <button type="submit" disabled={isSubmittingConfig}
                                    className="w-full py-3 bg-[#3083FF] text-white rounded-xl font-semibold flex items-center justify-center gap-2 disabled:opacity-50 hover:bg-[#3083FF]/90 transition-colors">
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
                    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
                        <motion.div
                            initial={{ scale: 0.95, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.95, opacity: 0 }}
                            className="bg-white w-full max-w-md rounded-2xl p-6 relative border border-[#3083FF]/30"
                        >
                            <button onClick={() => setIsAddBankModalOpen(false)} className="absolute top-4 right-4 text-slate-400 hover:text-slate-600">
                                <X size={20} />
                            </button>
                            <div className="flex items-center gap-3 mb-6 pb-4 border-b border-[#3083FF]/20">
                                <div className="w-10 h-10 rounded-lg bg-[#3083FF]/10 text-[#3083FF] flex items-center justify-center border border-[#3083FF]/30">
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
                                    <SearchableSelect
                                        options={qBanks.filter(b => b.is_published).map(bank => ({
                                            value: bank.id,
                                            label: bank.title,
                                            subLabel: `${bank.question_count ?? bank.total_questions ?? 0} Soal`,
                                        }))}
                                        value={addBankForm.bank_id}
                                        onChange={val => setAddBankForm(p => ({ ...p, bank_id: String(val || '') }))}
                                        placeholder="— Cari & Pilih Bank Soal —"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1.5">Mata Pelajaran</label>
                                    <SearchableSelect
                                        options={subjects.map(sub => ({
                                            value: sub.id,
                                            label: sub.name,
                                        }))}
                                        value={addBankForm.subject_id || ''}
                                        onChange={val => setAddBankForm(p => ({ ...p, subject_id: String(val || '') }))}
                                        placeholder="— Cari & Pilih (opsional) —"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1.5">Durasi (menit)</label>
                                    <input type="number" min="5" max="300" value={addBankForm.duration_minutes}
                                        onChange={e => setAddBankForm(p => ({ ...p, duration_minutes: parseInt(e.target.value) || 90 }))}
                                        className="w-full border border-[#3083FF]/30 rounded-xl p-3 text-sm" />
                                </div>
                                <button type="submit"
                                    className="w-full py-3 bg-[#3083FF] text-white rounded-xl font-semibold flex items-center justify-center gap-2 hover:bg-[#3083FF]/90 transition-colors">
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
                    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
                        <motion.div
                            initial={{ scale: 0.95, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.95, opacity: 0 }}
                            className="bg-white w-full max-w-lg rounded-2xl p-6 relative border border-[#3083FF]/30"
                        >
                            <button onClick={() => setIsAddClassModalOpen(false)} className="absolute top-4 right-4 text-slate-400 hover:text-slate-600">
                                <X size={20} />
                            </button>
                            <div className="flex items-center gap-3 mb-6 pb-4 border-b border-[#3083FF]/20">
                                <div className="w-10 h-10 rounded-lg bg-[#3083FF]/10 text-[#3083FF] flex items-center justify-center border border-[#3083FF]/30">
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
                                    <SearchableSelect
                                        options={configBanks.map(bank => ({
                                            value: bank.id,
                                            label: bank.question_banks?.title || 'Bank soal',
                                        }))}
                                        value={addClassForm.bank_id}
                                        onChange={val => setAddClassForm(p => ({ ...p, bank_id: String(val || '') }))}
                                        placeholder="— Cari & Pilih Bank Soal —"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1.5">Kelas *</label>
                                    <MultiSelect
                                        options={classes.map(cls => ({
                                            value: cls.id,
                                            label: cls.name,
                                        }))}
                                        value={addClassForm.class_ids}
                                        onChange={val => setAddClassForm(p => ({ ...p, class_ids: val }))}
                                        placeholder="Pilih kelas..."
                                        allSelectedText="Semua Kelas Terpilih"
                                    />
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 mb-1.5">Tanggal *</label>
                                        <input type="date" required value={addClassForm.scheduled_date}
                                            onChange={e => setAddClassForm(p => ({ ...p, scheduled_date: e.target.value }))}
                                            className="w-full border border-[#3083FF]/30 rounded-xl p-3 text-sm" />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 mb-1.5">Jam Mulai ({getSchoolTimeZoneLabel(timeZone)}) *</label>
                                        <input type="time" required value={addClassForm.scheduled_time}
                                            onChange={e => setAddClassForm(p => ({ ...p, scheduled_time: e.target.value }))}
                                            className="w-full border border-[#3083FF]/30 rounded-xl p-3 text-sm" />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 mb-1.5">Window Tutup ({getSchoolTimeZoneLabel(timeZone)}) *</label>
                                        <input type="time" required value={addClassForm.window_end_time}
                                            onChange={e => setAddClassForm(p => ({ ...p, window_end_time: e.target.value }))}
                                            className="w-full border border-[#3083FF]/30 rounded-xl p-3 text-sm" />
                                    </div>
                                </div>
                                <button type="submit"
                                    className="w-full py-3 bg-[#3083FF] text-white rounded-xl font-semibold flex items-center justify-center gap-2 hover:bg-[#3083FF]/90 transition-colors">
                                    <Plus size={16} /> Simpan Jadwal
                                </button>
                            </form>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>


            {/* Exam List */}
            {!isFolderExamCategory(typeFilter) && (
                isLoading ? (
                <div className="flex justify-center py-16">
                    <Spinner variant="buble" size={32} />
                </div>
            ) : (filteredExams.length === 0 && filteredPasFolders.length === 0) ? (
                <div className="py-16 text-center text-slate-400 border-2 border-dashed border-[#3083FF]/30 rounded-lg">
                    <ClipboardCheck size={40} className="mx-auto mb-3 opacity-40" />
                    <p className="font-medium">Tidak ada ujian{activeTab === 'draft' ? ' draft' : activeTab === 'active' ? ' aktif' : ''}</p>
                    <p className="text-sm mt-1">Klik &quot;Buat Ujian Baru&quot; untuk memulai</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-4">
                    {filteredPasFolders.map((period) => {
                        const bankCount = period._count?.pas_subjects || 0;
                        const scheduleCount = period._count?.pas_class_schedules || 0;
                        const fmtDate = (d: string) => d ? new Date(d).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) : '-';
                        const now = new Date();
                        const start = new Date(period.start_date ?? 0);
                        const end = new Date(period.end_date ?? 0);
                        end.setHours(23, 59, 59, 999);
                        const isActive = start <= now && end >= now && !period.is_locked;
                        const isFinished = end < now;
                        const isDraft = !isActive && !isFinished;
                        return (
                            <div
                                key={`pas-folder-${period.id}`}
                                onClick={() => router.push('/dashboard/admin/exams/pas/' + period.id)}
                                className={`bg-white rounded-xl overflow-hidden transition-all hover:shadow-lg cursor-pointer border ${
                                    isDraft
                                        ? 'border-red-200 hover:border-red-300'
                                        : 'border-blue-200 hover:border-blue-400'
                                }`}
                            >
                                <div className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                                    <div className="flex items-start gap-3.5 min-w-0 flex-1">
                                        <div className={`w-10 h-10 sm:w-12 sm:h-12 rounded-xl flex items-center justify-center shrink-0 border ${
                                            isDraft
                                                ? 'bg-red-50 text-red-600 border border-red-200'
                                                : 'bg-blue-50 text-[#1E40AF] border border-blue-200'
                                        }`}>
                                            <FolderOpen size={20} className={isDraft ? 'text-red-600' : 'text-[#1E40AF]'} />
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <div className="flex flex-wrap items-center gap-2 mb-1">
                                                <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider border ${
                                                    isDraft
                                                        ? 'bg-red-50 text-red-600 border border-red-200'
                                                        : 'bg-blue-50 text-[#1E40AF] border border-blue-200'
                                                }`}>
                                                    FOLDER UJIAN {period.type === 'am' ? 'Asesmen Madrasah' : period.type === 'pat' ? 'ASAT / PAT' : 'ASAS / PAS'} • {period.semester === 'ganjil' ? 'GANJIL' : 'GENAP'}
                                                </span>
                                                {isDraft && (
                                                    <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-red-50 text-red-600 border border-red-200">
                                                        Draft
                                                    </span>
                                                )}
                                                <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-200">
                                                    {period.school_year}
                                                </span>
                                                {period.is_locked && (
                                                    <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-red-50 text-red-600 border border-red-200 flex items-center gap-1">
                                                        <Lock size={10} /> Terkunci
                                                    </span>
                                                )}
                                            </div>
                                            <h3 className="font-bold text-slate-800 text-sm sm:text-base leading-tight">{period.name}</h3>
                                            <div className="flex flex-wrap items-center gap-3 mt-2 text-xs text-slate-600">
                                                <span className={`px-2.5 py-1 rounded-lg border font-semibold flex items-center gap-1.5 ${
                                                    isDraft
                                                        ? 'bg-red-50 text-red-700 border-red-100'
                                                        : 'bg-blue-50 text-blue-700 border border-blue-100'
                                                }`}>
                                                    <BookOpen size={12} className={isDraft ? 'text-red-600' : 'text-blue-600'} /> {bankCount} Bank Soal • {scheduleCount} Jadwal Kelas
                                                </span>
                                                <span className="flex items-center gap-1.5 text-slate-500">
                                                    <Calendar size={12} className="text-slate-400" />
                                                    {fmtDate(period.start_date)} — {fmtDate(period.end_date)}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="exam-folder-actions flex items-center gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
                                        <button
                                            onClick={() => router.push('/dashboard/admin/exams/pas/' + period.id)}
                                            className="px-3.5 py-2 text-xs bg-[#3083FF] text-white hover:bg-[#2563EB] rounded-lg transition-all font-semibold flex items-center gap-1.5 shadow-sm shadow-[#3083FF]/20 cursor-pointer"
                                        >
                                            <FolderOpen size={14} />
                                            Buka Folder
                                        </button>
                                        <button
                                            type="button"
                                            onClick={async () => {
                                                const ok = await confirmDialog({
                                                    title: 'Hapus Folder Ujian?',
                                                    text: `Semua jadwal, ruang, dan data administrasi di dalam folder "${period.name}" akan dihapus permanen. Lanjutkan?`,
                                                    confirmText: 'Ya, Hapus Folder',
                                                    cancelText: 'Batal',
                                                    variant: 'danger',
                                                });
                                                if (!ok) return;
                                                const res = await deletePASPeriodAction(period.id);
                                                if (res.success) {
                                                    await alertDialog({ title: 'Berhasil', text: 'Folder ujian berhasil dihapus.', variant: 'success' });
                                                    await loadData();
                                                } else {
                                                    await alertDialog({ title: 'Gagal Menghapus', text: res.error || 'Terjadi kesalahan saat menghapus folder.', variant: 'danger' });
                                                }
                                            }}
                                            className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 border border-slate-200 rounded-lg transition-all flex items-center justify-center cursor-pointer"
                                            title="Hapus Folder Ujian"
                                        >
                                            <Trash2 size={14} />
                                        </button>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                    {filteredExams.map((exam) => {
                        const bank = qBanks.find(b => b.id === exam.question_bank_id);
                        const assignment = examAssignments[exam.id] || { classCount: 0, studentCount: 0 };
                        const isAssigned = assignment.classCount > 0 || assignment.studentCount > 0;
                        const isPublic = exam.metadata?.is_public === true;
                        const canPublish = isAssigned || isPublic;
                        const isArchived = exam.status === 'archived';
                        return (
                            <div key={exam.id} className={`bg-white border rounded-xl overflow-hidden transition-all hover:shadow-lg ${
                                exam.is_published
                                    ? 'border-[#3083FF]/30 hover:border-[#3083FF]'
                                    : isArchived
                                        ? 'border-slate-200 hover:border-slate-300'
                                        : 'border-red-200 hover:border-red-300'
                            }`}>
                                {/* Card Header */}
                                <div className="p-4 sm:p-5">
                                    <div className="flex items-start gap-3">
                                        <div className={`w-10 h-10 sm:w-12 sm:h-12 rounded-lg flex items-center justify-center shrink-0 border ${
                                            exam.is_published
                                                ? 'bg-[#3083FF]/10 text-[#3083FF] border-[#3083FF]/40'
                                                : isArchived
                                                    ? 'bg-slate-100 text-slate-600 border border-slate-200'
                                                    : 'bg-red-50 text-red-600 border border-red-200'
                                        }`}>
                                            {exam.is_published ? (
                                                <Globe size={18} className="text-[#3083FF]" />
                                            ) : isArchived ? (
                                                <Archive size={18} className="text-slate-500" />
                                            ) : (
                                                <GlobeLock size={18} className="text-red-600" />
                                            )}
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            {(!exam.is_published || isArchived) && (
                                                <div className="flex flex-wrap items-center gap-2 mb-1.5">
                                                    <span className={`px-2 py-0.5 rounded-lg text-[10px] sm:text-xs font-semibold ${
                                                        isArchived
                                                            ? 'bg-slate-100 text-slate-600 border border-slate-200'
                                                            : 'bg-red-50 text-red-600 border border-red-200'
                                                    }`}>
                                                        {isArchived ? 'Diarsipkan' : 'Draft'}
                                                    </span>
                                                </div>
                                            )}
                                            <h3 className="font-bold text-slate-800 text-sm sm:text-base leading-tight">{exam.title}</h3>
                                            <p className="mt-1 text-xs text-slate-500">
                                                Dibuat oleh <span className="font-semibold text-slate-700">{exam.creatorName || 'Tidak diketahui'}</span>
                                            </p>
                                        </div>
                                    </div>

                                    {/* Bank soal dan peserta dalam satu baris */}
                                    <div className="mt-3 flex min-w-0 items-center gap-2 text-xs text-slate-500">
                                        <span className="min-w-0 truncate" title={bank?.title || 'Bank soal dihapus'}>
                                            {bank?.title || 'Bank soal dihapus'}
                                        </span>
                                        <span aria-hidden="true" className="shrink-0">•</span>
                                        <span className={'shrink-0 whitespace-nowrap' + (!isPublic && !isAssigned ? ' text-red-600' : '')}>
                                            {isPublic
                                                ? 'Umum • Semua siswa'
                                                : isAssigned
                                                    ? assignment.classCount > 0
                                                        ? assignment.classCount + ' kelas'
                                                        : assignment.studentCount + ' siswa'
                                                    : 'Belum ditugaskan'}
                                        </span>
                                    </div>

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
                                <div className="exam-card-actions flex flex-wrap gap-2 px-4 pb-4">
                                    {/* Publish Toggle */}
                                    <button
                                        onClick={() => handlePublishToggle(exam)}
                                        disabled={isSubmitting || publishingId === exam.id || exam.status === 'archived'}
                                        className={`flex-1 sm:flex-none px-3 py-2 rounded-lg text-xs font-semibold transition-all flex items-center justify-center gap-1.5 disabled:opacity-70 disabled:cursor-wait ${
                                            exam.is_published
                                                ? 'bg-red-50 text-red-600 hover:bg-red-500 hover:text-white border border-red-200 hover:border-red-500'
                                                : canPublish
                                                    ? 'bg-[#3083FF] text-white hover:bg-[#2563EB] shadow-sm shadow-[#3083FF]/20'
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
                                                {exam.is_published ? 'Unpublish' : 'Publish'}
                                            </>
                                        )}
                                    </button>

                                    {/* Monitor */}
                                    <button
                                        onClick={() => router.push('/dashboard/admin/monitoring?exam=' + exam.id)}
                                        className="flex-1 sm:flex-none px-3 py-2 text-xs bg-[#3083FF] text-white hover:bg-[#3083FF]/90 rounded-lg transition-all font-medium flex items-center justify-center gap-1.5"
                                    >
                                        <Eye size={12} />
                                        Monitor
                                    </button>

                                    {/* Review Tugas — only for assignment type */}
                                    {exam.exam_type === 'assignment' && (
                                        <button
                                            onClick={() => router.push('/dashboard/admin/assignments/' + exam.id)}
                                            className="exam-review-action flex-1 sm:flex-none px-3 py-2 text-xs bg-amber-500 text-white hover:bg-amber-600 rounded-lg transition-all font-medium flex items-center justify-center gap-1.5"
                                        >
                                            <FileText size={12} />
                                            Review Tugas
                                        </button>
                                    )}

                                    {/* Edit */}
                                    <button
                                        onClick={() => openEdit(exam)}
                                        className="p-2 text-slate-400 hover:text-[#3083FF] hover:bg-[#3083FF]/10 rounded-lg transition-all border border-slate-200 hover:border-[#3083FF]/30"
                                    >
                                        <Settings size={14} />
                                    </button>

                                    {/* Assign */}
                                    <button
                                        onClick={() => openAssign(exam)}
                                        className={`p-2 rounded-lg transition-all border ${
                                            isAssigned
                                                ? 'text-[#3083FF] hover:text-[#2563EB] hover:bg-[#3083FF]/10 border-[#3083FF]/30 hover:border-[#3083FF]'
                                                : 'text-slate-400 hover:text-[#3083FF] hover:bg-[#3083FF]/10 border-slate-200 hover:border-[#3083FF]/30'
                                        }`}
                                        title={isAssigned ? 'Ubah penugasan kelas' : 'Tugaskan ke kelas'}
                                    >
                                        <Users size={14} />
                                    </button>

                                    {/* Delete */}
                                    <button
                                        onClick={() => handleArchiveExam(exam)}
                                        className="p-2 text-slate-400 hover:text-violet-600 hover:bg-violet-50 rounded-lg transition-all border border-slate-200 hover:border-violet-200"
                                        title={exam.status === 'archived' ? 'Pulihkan sebagai draft' : 'Arsipkan tanpa menghapus hasil'}
                                    >
                                        {exam.status === 'archived' ? <Unlock size={14} /> : <Archive size={14} />}
                                    </button>

                                    {/* Delete */}
                                    <button
                                        onClick={() => handleDeleteExam(exam)}
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
            <CreateExamModal
                isOpen={isAddModalOpen}
                onClose={() => setIsAddModalOpen(false)}
                onSuccess={loadData}
                publishedBanks={publishedBanks}
                classes={classes}
                classStudents={classStudents}
                role="admin"
            />

            {/* ─────────────── EDIT MODAL ─────────────── */}
            <CreateExamModal
                isOpen={isEditModalOpen}
                onClose={() => {
                    setIsEditModalOpen(false);
                    setSelectedExam(null);
                }}
                exam={selectedExam}
                onSuccess={loadData}
                publishedBanks={publishedBanks}
                classes={classes}
                classStudents={classStudents}
                role="admin"
            />

            {/* ─────────────── ASSIGN MODAL ─────────────── */}
            <AssignExamModal
                isOpen={isAssignModalOpen}
                onClose={() => {
                    setIsAssignModalOpen(false);
                    setSelectedExam(null);
                }}
                exam={selectedExam}
                classes={classes}
                classStudents={classStudents}
                onSuccess={loadData}
            />

            {/* ─────────────── DELETE MODAL ─────────────── */}
            <DeleteExamModal
                isOpen={!!examToDelete}
                onClose={() => setExamToDelete(null)}
                exam={examToDelete}
                onSuccess={loadData}
            />
        </div>
    );
};

export default ExamsPage;
