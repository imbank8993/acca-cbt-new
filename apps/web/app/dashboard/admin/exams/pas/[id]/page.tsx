"use client";
import '@/app/components/pas-room-management.css';
import { alertDialog, confirmDialog, deleteConfirmDialog } from '@/lib/confirm-dialog';
import { PASScheduleActions } from '@/app/components/PASScheduleActions';
import { PASScheduleRooms } from '@/app/components/PASScheduleRooms';
import { PASRoomInput } from "@/app/components/PASRoomInput";
import { PASScheduleStatus, isPASScheduleReady } from '@/app/components/PASScheduleStatus';
import RoomManagementPanel from '@/app/components/pas/RoomManagementPanel';
import { InlineSelect } from '@/app/components/ui/inlineselect';
import { Modal, ModalBody, ModalFooter, ModalField } from '@/app/components/ui/modal';
import { SearchableSelect } from '@/app/components/ui/SearchableSelect';
import type { PASClassSchedule,PASPeriod,PASSession } from '@/app/types/pas';
import {
addPASScheduleAction,
setPASScheduleActivationAction,
getPASPeriod,
listOrganizationClasses,
listPASSessions,
listPASRooms,
    listSubjects,
    removePASScheduleAction,
    type PASRoom,
    type PASSubjectSummary,
} from '@/lib/api/pas';
import type { OrganizationClass } from '@/lib/api/proctor';
import { listQuestionBanks,type QuestionBank } from '@/lib/api/questions';
import { getSessionUser } from '@/lib/session';
import { getSchoolTimeZoneLabel, schoolTodayDate } from '@/lib/school-time';
import { useSchoolTimeZone } from '@/lib/useSchoolTimeZone';
import { useMemoryState } from '@/lib/useMemoryState';
import { Button } from '@/app/components/ui/button';
import {
    AlertTriangle,
    Calendar,
    Check,
    DoorOpen,
    FileText,
    FolderOpen,
    Loader2,
    Lock,
    Search,
    Settings2,
    Table,
    UserCheck,
    X,
    Zap
} from 'lucide-react';
import { useParams,useRouter } from 'next/navigation';
import React,{ useCallback,useEffect,useState } from 'react';
import PASAdministrationPanel from '@/app/components/pas/PASAdministrationPanel';
import { PASExamSettingsPanel } from '@/app/components/pas/PASExamSettingsPanel';
import { PASTodayStatusCard } from '@/app/components/pas/PASTodayStatusCard';
import { CompactExamPeriodHeader, CompactExamPeriodSchedules } from '@/app/components/pas/CompactExamPeriodWorkspace';
import EditPASPeriodModal from '@/app/components/pas/EditPASPeriodModal';
import BulkScheduleGrid from './BulkScheduleGrid';
import { isSemesterAssessmentType } from '@/lib/exam-types';

type TabId = 'schedules' | 'live_today' | 'rooms_sessions' | 'exam_settings' | 'administration' | 'bulk';
type LogisticsSubTab = 'rooms' | 'sessions' | 'invigilators';

export default function AdminPASDetailPage() {
    const { timeZone, error: timeZoneError } = useSchoolTimeZone();
    const router = useRouter();
    const params = useParams();
    const periodId = params.id as string;

    const [period, setPeriod] = useState<PASPeriod | null>(null);
    const [classes, setClasses] = useMemoryState<OrganizationClass[]>('admin_exams_pas__id__classes', []);
    const [subjects, setSubjects] = useMemoryState<PASSubjectSummary[]>('admin_exams_pas__id__subjects', []);
    const [qBanks, setQBanks] = useMemoryState<QuestionBank[]>('admin_exams_pas__id__qBanks', []);
    const [sessions, setSessions] = useMemoryState<PASSession[]>('admin_exams_pas__id__sessions', []);
    const [rooms, setRooms] = useMemoryState<PASRoom[]>('admin_exams_pas__id__rooms', []);
    const [isLoading, setIsLoading] = useState(true);
    const [roomLoadError, setRoomLoadError] = useState('');
    const [activeTab, setActiveTab] = useState<TabId>('schedules');
    // Pelaksanaan kini dipantau di halaman Monitoring; tautan lama ?tab=monitoring diteruskan ke sana.
    useEffect(() => {
        if (new URLSearchParams(window.location.search).get('tab') === 'monitoring') router.replace(`/dashboard/admin/monitoring?exam=${encodeURIComponent(`pas:${periodId}`)}`);
    }, [router, periodId]);
    const [logisticsSubTab, setLogisticsSubTab] = useState<LogisticsSubTab>('rooms');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isAddScheduleOpen, setIsAddScheduleOpen] = useState(false);
    const [selectedScheduleIds, setSelectedScheduleIds] = useMemoryState<string[]>('proktor_exams_pas__id__selectedScheduleIds', []);
    const [isGenerating, setIsGenerating] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [classFilter, setClassFilter] = useState('all');
    const [statusFilter, setStatusFilter] = useState('all');
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);

    const [scheduleForm, setScheduleForm] = useState({
        bank_id: '',
        subject_id: '',
        class_ids: [] as string[],
        scheduled_date: '',
        session_id: '',
        duration_minutes: 90,
        room: '',
    });

    const loadData = useCallback(async () => {
        const authUser = await getSessionUser();
        if (authUser) {
            const [periodData, bankList, classList, subjectList, sessionList, roomList] = await Promise.all([
                    getPASPeriod(periodId),
                    listQuestionBanks(true),
                    listOrganizationClasses({ activeYearOnly: true }),
                    listSubjects(),
                    listPASSessions(periodId),
                    listPASRooms(periodId).then(rooms => {
                        setRoomLoadError('');
                        return rooms;
                    }).catch(error => {
                        setRoomLoadError(error instanceof Error ? error.message : 'Daftar ruang belum dapat dimuat.');
                        return null;
                    }),
                ]);
                setPeriod(periodData);
                setQBanks(bankList || []);
                setClasses(classList || []);
                setSubjects(subjectList || []);
                setSessions(sessionList || []);
                if (roomList !== null) setRooms(roomList);
        }
        setIsLoading(false);
    }, [periodId, setClasses, setQBanks, setRooms, setSessions, setSubjects]);

    useEffect(() => {
        const initialLoad = window.setTimeout(() => void loadData(), 0);
        const handleFocus = () => void loadData();
        window.addEventListener('focus', handleFocus);
        return () => {
            window.clearTimeout(initialLoad);
            window.removeEventListener('focus', handleFocus);
        };
    }, [loadData]);

    const handleBankChange = (bankId: string) => {
        const selectedBank = qBanks.find(b => b.id === bankId);
        let matchedSubjectId = scheduleForm.subject_id;
        const bankSubject = selectedBank?.subject?.trim().toLowerCase();
        if (bankSubject) {
            const foundSubject = subjects.find(
                s => s.name.trim().toLowerCase() === bankSubject
            );
            if (foundSubject) {
                matchedSubjectId = foundSubject.id;
            }
        }
        setScheduleForm(prev => ({
            ...prev,
            bank_id: bankId,
            subject_id: matchedSubjectId,
        }));
    };

    const handleAddSchedule = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!scheduleForm.bank_id || scheduleForm.class_ids.length === 0 || !scheduleForm.scheduled_date || !scheduleForm.session_id) {
            alert('Lengkapi bank soal, minimal satu kelas, tanggal, dan sesi.');
            return;
        }
        setIsSubmitting(true);
        for (const classId of scheduleForm.class_ids) {
            const result = await addPASScheduleAction({
                pas_period_id: periodId,
                bank_id: scheduleForm.bank_id,
                subject_id: scheduleForm.subject_id || undefined,
                class_id: classId,
                scheduled_date: scheduleForm.scheduled_date,
                session_id: scheduleForm.session_id,
                duration_override: scheduleForm.duration_minutes,
                room: scheduleForm.room || undefined,
            });
            if (!result.success) {
                alert('Gagal: ' + result.error);
                setIsSubmitting(false);
                return;
            }
        }
        setIsAddScheduleOpen(false);
        setScheduleForm({ bank_id: '', subject_id: '', class_ids: [], scheduled_date: '', session_id: '', duration_minutes: 90, room: '' });
        await loadData();
        setIsSubmitting(false);
    };

    const handleRemoveSchedule = async (scheduleId: string) => {
        if (!await deleteConfirmDialog('Hapus Jadwal Ujian?', 'Hapus jadwal ini?')) return;
        const result = await removePASScheduleAction(scheduleId);
        if (result.success) await loadData();
        else await alertDialog({ title: 'Gagal', text: result.error, variant: 'danger' });
    };

    const toggleScheduleSelect = (id: string) => {
        setSelectedScheduleIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
    };

    const handleActivation = async (ids: string[], active: boolean) => {
        if (!ids.length || isGenerating) return false;
        if (!await confirmDialog({ title: active ? 'Aktifkan Ujian?' : 'Nonaktifkan Ujian?',
            text: active ? `Aktifkan ${ids.length} jadwal? Kelengkapan diperiksa kembali sebelum aktivasi.`
                : `Nonaktifkan ${ids.length} jadwal? Ujian tidak tersedia untuk siswa; jawaban yang sudah tersimpan tetap dipertahankan.`,
            confirmText: active ? 'Aktifkan' : 'Nonaktifkan' })) return false;
        setIsGenerating(true);
        try {
            const errors: string[] = [];
            for (const id of ids) {
                const result = await setPASScheduleActivationAction(id, active);
                if (!result.success) errors.push(result.error || 'Perubahan aktivasi gagal.');
            }
            await loadData();
            setSelectedScheduleIds([]);
            if (errors.length) await alertDialog({ title: 'Sebagian jadwal belum dapat diproses', text: errors.join('\n'), variant: 'warning' });
            return errors.length === 0;
        } catch (error) {
            await alertDialog({ title: 'Status aktivasi belum dapat diperbarui', text: error instanceof Error ? error.message : 'Muat ulang daftar untuk memeriksa status terakhir.', variant: 'warning' });
            return false;
        } finally { setIsGenerating(false); }
    };

    const formatDate = (dateStr: string | null | undefined) => {
        if (!dateStr) return '-';
        const cleanDate = dateStr.includes('T') ? dateStr.split('T')[0] : dateStr;
        const d = new Date(`${cleanDate}T12:00:00`);
        if (isNaN(d.getTime())) {
            const fallback = new Date(dateStr);
            if (!isNaN(fallback.getTime())) {
                return fallback.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
            }
            return '-';
        }
        return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
    };

    const formatDateWithDay = (dateStr: string | null | undefined) => {
        if (!dateStr) return 'Tanpa Tanggal';
        const cleanDate = dateStr.includes('T') ? dateStr.split('T')[0] : dateStr;
        const d = new Date(`${cleanDate}T12:00:00`);
        if (isNaN(d.getTime())) {
            const fallback = new Date(dateStr);
            if (!isNaN(fallback.getTime())) {
                return fallback.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' });
            }
            return dateStr;
        }
        return d.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' });
    };

    const getBankTitle = (bankId: string | null, sc?: PASClassSchedule) => {
        if (sc?.question_banks?.title) return sc.question_banks.title;
        return qBanks.find((bank) => bank.id === bankId)?.title || 'Bank soal dihapus';
    };

    const getGroupedSchedules = (scheduleList: PASClassSchedule[]) => {
        const grouped: Record<string, Record<string, PASClassSchedule[]>> = {};
        for (const sc of scheduleList) {
            const dateStr = sc.scheduled_date || 'Tanpa Tanggal';
            const timeStr = sc.scheduled_time || 'Tanpa Waktu';

            if (!grouped[dateStr]) grouped[dateStr] = {};
            if (!grouped[dateStr][timeStr]) grouped[dateStr][timeStr] = [];

            grouped[dateStr][timeStr].push(sc);
        }

        const sortedDates = Object.keys(grouped).sort();
        const result: Array<{ date: string; sessions: Array<{ time: string; schedules: PASClassSchedule[] }> }> = [];

        for (const date of sortedDates) {
            const sortedTimes = Object.keys(grouped[date]).sort();
            result.push({
                date,
                sessions: sortedTimes.map((t) => ({
                    time: t,
                    schedules: grouped[date][t].sort((a, b) =>
                        (a.classes?.name || '').localeCompare(b.classes?.name || '', undefined, { numeric: true })
                    ),
                })),
            });
        }
        return result;
    };

    const tzLabel = getSchoolTimeZoneLabel(timeZone);

    if (isLoading) {
        return (
            <div className="flex justify-center py-20">
                <Loader2 size={36} className="text-[#3083FF] animate-spin" />
            </div>
        );
    }

    if (!period) {
        return (
            <div className="max-w-2xl mx-auto py-20 text-center">
                <AlertTriangle size={48} className="text-amber-400 mx-auto mb-4" />
                <h2 className="text-xl font-bold text-slate-700 mb-2">Periode Tidak Ditemukan</h2>
                <Button variant="primary" className="mt-4" onClick={() => router.push('/dashboard/admin/exams')}>
                    Kembali ke Pengaturan
                </Button>
            </div>
        );
    }

    const schedules = period.pas_class_schedules || [];
    const isCompactPeriod = isSemesterAssessmentType(period.type);
    const compactActiveTab = activeTab === 'live_today' ? 'schedules' : activeTab;
    const openAddSchedule = () => {
        if (period.is_locked) return;
        setScheduleForm((prev) => ({
            ...prev,
            scheduled_date: prev.scheduled_date || period.start_date?.split('T')[0] || '',
            session_id: prev.session_id || sessions[0]?.id || '',
        }));
        setIsAddScheduleOpen(true);
    };
    const uniqueBankCount = new Set(schedules.map((sc) => sc.bank_id).filter(Boolean)).size;
    const readySchedulesCount = schedules.filter(isPASScheduleReady).length;
    const readyInactiveIds = schedules.filter(sc => sc.is_activated === false && isPASScheduleReady(sc)).map(sc => sc.id);
    const selectedReadyIds = schedules.filter(sc => selectedScheduleIds.includes(sc.id) && !period.is_locked && sc.is_activated === false && isPASScheduleReady(sc)).map(sc => sc.id);
    const selectedActiveIds = schedules.filter(sc => selectedScheduleIds.includes(sc.id) && sc.is_activated === true).map(sc => sc.id);

    // Live Today filter
    const todayStr = schoolTodayDate(timeZone);
    const liveSchedules = schedules.filter((schedule) => schedule.scheduled_date === todayStr);

    const filteredSchedules = schedules.filter((sc) => {
        if (activeTab === 'live_today' && sc.scheduled_date !== todayStr) return false;

        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase();
            const bankTitle = getBankTitle(sc.bank_id, sc).toLowerCase();
            const subjectName = (sc.subjects?.name || '').toLowerCase();
            const className = (sc.classes?.name || '').toLowerCase();
            const roomName = (sc.room || '').toLowerCase();
            if (!bankTitle.includes(q) && !subjectName.includes(q) && !className.includes(q) && !roomName.includes(q)) {
                return false;
            }
        }

        if (classFilter !== 'all' && sc.class_id !== classFilter) return false;

        if (statusFilter === 'ready' && !isPASScheduleReady(sc)) return false;
        if (statusFilter === 'pending' && isPASScheduleReady(sc)) return false;
        if (statusFilter === 'enabled' && sc.is_activated !== true) return false;
        if (statusFilter === 'disabled' && sc.is_activated !== false) return false;
        if (statusFilter === 'active' && sc.status !== 'active') return false;
        if (statusFilter === 'finished' && sc.status !== 'finished') return false;

        return true;
    });

    const groupedSchedules = getGroupedSchedules(filteredSchedules);

    return (
        <div className="max-w-7xl mx-auto space-y-5 pb-24">
            {roomLoadError && (
                <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">
                    {roomLoadError}
                    <Button type="button" variant="ghost" size="sm" className="ml-2" onClick={() => void loadData()}>Coba lagi</Button>
                </div>
            )}
            {timeZoneError && (
                <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    {timeZoneError}
                </div>
            )}

            {isCompactPeriod && (
                <CompactExamPeriodHeader
                    period={period}
                    schedules={schedules}
                    activeTab={activeTab === 'rooms_sessions' ? (logisticsSubTab === 'sessions' ? 'sessions' : 'rooms') : compactActiveTab}
                    onTabChange={(tab) => {
                        // "Ruang dan Pengawas" dan "Sesi" adalah tab sendiri di folder ASAS/AM.
                        if (tab === 'rooms' || tab === 'sessions') { setLogisticsSubTab(tab); setActiveTab('rooms_sessions'); }
                        else setActiveTab(tab as TabId);
                    }}
                    formatDate={formatDate}
                    onSettings={() => { if (!period.is_locked) setIsEditModalOpen(true); }}
                    onAddSchedule={openAddSchedule}
                    onBulkSchedule={() => { if (!period.is_locked) setActiveTab('bulk'); }}
                />
            )}

            {!isCompactPeriod && <>
            {/* ── Period Details Header Card ── */}
            <div className="bg-white rounded-xl px-6 py-6">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="flex items-start sm:items-center gap-3.5 min-w-0">
                        <div className="min-w-0">
                            {period.is_locked && (
                                <div className="flex mb-1">
                                    <span className="px-2 py-0.5 bg-red-50 text-red-600 border border-red-200 text-[10px] font-bold rounded-md flex items-center gap-1">
                                        <Lock size={10} /> Terkunci
                                    </span>
                                </div>
                            )}
                            <h1 className="text-lg sm:text-xl font-bold text-slate-900 truncate">{period.name}</h1>
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-0.5 text-slate-500 text-xs font-medium">
                                <span className="flex items-center gap-1.5">
                                    <Calendar size={12} className="text-slate-400" />
                                    <span>{formatDate(period.start_date)} — {formatDate(period.end_date)}</span>
                                </span>
                                <span className="text-slate-300">•</span>
                                <span className="flex items-center gap-1.5 text-slate-600">
                                    <UserCheck size={12} className="text-slate-400" />
                                    Ketua Panitia: <strong className="text-slate-700">{period.committee_chair_name || 'Belum diatur'}</strong>
                                    {!period.is_locked && (
                                        <button
                                            type="button"
                                            onClick={() => setIsEditModalOpen(true)}
                                            className="text-[11px] text-[#3083FF] hover:underline font-semibold cursor-pointer ml-0.5"
                                        >
                                            (Ubah)
                                        </button>
                                    )}
                                </span>
                            </div>
                        </div>
                    </div>

                    <dl className="flex flex-wrap gap-6 text-xs md:gap-8">
                        <div><dt className="text-slate-500">Bank soal</dt><dd className="mt-1 font-semibold text-slate-800">{uniqueBankCount}</dd></div>
                        <div><dt className="text-slate-500">Jadwal kelas</dt><dd className="mt-1 font-semibold text-slate-800">{schedules.length}</dd></div>
                        <div><dt className="text-slate-500">Kesiapan</dt><dd className="mt-1 font-semibold text-slate-800">{readySchedulesCount}/{schedules.length} siap</dd></div>
                    </dl>
                </div>
            </div>

            {/* ── Tabs & Actions Toolbar ── */}
            <div className="flex flex-col md:flex-row md:flex-wrap md:items-center justify-between gap-3">
                <div className="pas-folder-tabs flex gap-1 p-1 bg-slate-100 rounded-xl w-full md:w-fit overflow-x-auto shrink-0 [&>button]:shrink-0 [&>button]:whitespace-nowrap">
                    <button
                        onClick={() => setActiveTab('schedules')}
                        className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                            activeTab === 'schedules' ? 'bg-white text-[#3083FF] shadow-xs' : 'text-slate-500 hover:text-slate-700'
                        }`}
                    >
                        <Calendar size={13} />
                        Semua Jadwal
                        <span className={`px-1.5 py-0.2 rounded text-[10px] font-bold ${
                            activeTab === 'schedules' ? 'bg-[#3083FF]/10 text-[#3083FF]' : 'bg-slate-200 text-slate-500'
                        }`}>
                            {schedules.length}
                        </span>
                    </button>

                    <button
                        onClick={() => setActiveTab('live_today')}
                        className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                            activeTab === 'live_today' ? 'bg-white text-[#3083FF] shadow-xs' : 'text-slate-500 hover:text-slate-700'
                        }`}
                    >
                        <Zap size={13} className={activeTab === 'live_today' ? 'text-amber-500' : ''} />
                        Live Hari Ini
                        {liveSchedules.length > 0 && (
                            <span className="flex h-2 w-2 relative ml-0.5">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
                            </span>
                        )}
                    </button>

                    <button
                        type="button"
                        onClick={() => setActiveTab('rooms_sessions')}
                        className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${
                            activeTab === 'rooms_sessions' ? 'bg-white text-[#3083FF] shadow-xs' : 'text-slate-500 hover:text-slate-700'
                        }`}
                    >
                        <DoorOpen size={13} />
                        Ruang & Sesi
                        {rooms.length > 0 && (
                            <span className={`px-1.5 py-0.2 rounded text-[10px] font-bold ${
                                activeTab === 'rooms_sessions' ? 'bg-[#3083FF]/10 text-[#3083FF]' : 'bg-slate-200 text-slate-500'
                            }`}>
                                {rooms.length}
                            </span>
                        )}
                    </button>
                    <button
                        type="button"
                        onClick={() => setActiveTab('administration')}
                        className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${
                            activeTab === 'administration' ? 'bg-white text-[#3083FF] shadow-xs' : 'text-slate-500 hover:text-slate-700'
                        }`}
                    >
                        <FileText size={13} />
                        Administrasi
                    </button>
                    <button
                        type="button"
                        onClick={() => setActiveTab('exam_settings')}
                        className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${
                            activeTab === 'exam_settings' ? 'bg-white text-[#3083FF] shadow-xs' : 'text-slate-500 hover:text-slate-700'
                        }`}
                    >
                        <Settings2 size={13} />
                        Pengaturan Ujian
                    </button>
                    {!period.is_locked && (
                        <button type="button" onClick={() => setActiveTab('bulk')}
                            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${
                                activeTab === 'bulk' ? 'bg-white text-[#3083FF] shadow-xs' : 'text-slate-500 hover:text-slate-700'
                            }`}>
                            <Table size={13} />
                            Jadwal Massal
                        </button>
                    )}
                </div>

                {!period.is_locked && activeTab === 'schedules' && (
                    <div className="flex items-center gap-2 flex-wrap">
                        {readyInactiveIds.length > 0 && (
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => void handleActivation(readyInactiveIds, true)}
                                disabled={isGenerating}
                                leftIcon={isGenerating ? <Loader2 size={13} className="animate-spin" /> : <Zap size={13} className="text-amber-500" />}
                            >
                                Aktifkan yang Siap ({readyInactiveIds.length})
                            </Button>
                        )}

                        <Button
                            variant="primary"
                            size="sm"
                            icon="add"
                            onClick={() => {
                                setScheduleForm((prev) => ({
                                    ...prev,
                                    scheduled_date: prev.scheduled_date || period.start_date?.split('T')[0] || '',
                                    session_id: prev.session_id || sessions[0]?.id || '',
                                }));
                                setIsAddScheduleOpen(true);
                            }}
                        >
                            Jadwalkan Bank Soal
                        </Button>
                    </div>
                )}
            </div>

            </>}

            {activeTab === 'exam_settings' && (
                <PASExamSettingsPanel
                    key={period.id}
                    period={period}
                    onSaved={(examSettings) => setPeriod((prev) => (prev ? { ...prev, exam_settings: examSettings, screenshot_enabled: examSettings.defaults.screenshot_enabled } : prev))}
                    onReload={() => void loadData()}
                />
            )}

            {activeTab === 'rooms_sessions' && (
                <RoomManagementPanel
                    period={period}
                    view={logisticsSubTab}
                    onViewChange={setLogisticsSubTab}
                    onChange={() => void loadData()}
                    hideNav={isCompactPeriod}
                />
            )}

            {activeTab === 'administration' && (
                <PASAdministrationPanel
                    period={period}
                    rooms={rooms}
                    sessions={sessions}
                    onPeriodUpdated={(chair) => {
                        setPeriod((prev) => (prev ? { ...prev, ...chair } : prev));
                    }}
                />
            )}

            {activeTab === 'bulk' && !period.is_locked && (
                <BulkScheduleGrid
                    periodId={periodId}
                    period={period}
                    classes={classes}
                    subjects={subjects}
                    qBanks={qBanks}
                    sessions={sessions}
                    rooms={rooms}
                    onComplete={() => {
                        setActiveTab('schedules');
                        void loadData();
                    }}
                    onCancel={() => setActiveTab('schedules')}
                />
            )}

            {isCompactPeriod && compactActiveTab === 'schedules' && liveSchedules.length > 0 && (
                <PASTodayStatusCard periodId={period.id} today={todayStr}
                    monitoringHref={`/dashboard/admin/monitoring?exam=${encodeURIComponent(`pas:${period.id}`)}`} />
            )}

            {/* ── SCHEDULES & LIVE TAB ── */}
            {isCompactPeriod && compactActiveTab === 'schedules' && (
                <CompactExamPeriodSchedules
                    key={period.id}
                    period={period}
                    classes={classes}
                    sessions={sessions}
                    rooms={rooms}
                    timeZone={timeZone}
                    today={todayStr}
                    bankTitle={getBankTitle}
                    busy={isGenerating}
                    onActivation={handleActivation}
                    onDelete={(id) => void handleRemoveSchedule(id)}
                    onManageRooms={() => {
                        setActiveTab('rooms_sessions');
                        setLogisticsSubTab('rooms');
                    }}
                    monitoringBasePath="/dashboard/admin/monitoring"
                    onAddSchedule={openAddSchedule}
                    onBulkSchedule={() => { if (!period.is_locked) setActiveTab('bulk'); }}
                />
            )}
            {!isCompactPeriod && (activeTab === 'schedules' || activeTab === 'live_today') && (
                <div className="space-y-4">

                    {/* Filter Bar */}
                    {schedules.length > 0 && (
                        <div className="bg-white rounded-xl border border-slate-200/80 p-3 shadow-2xs flex flex-col sm:flex-row gap-2.5 items-stretch sm:items-center">
                            <div className="relative flex-1">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={14} />
                                <input
                                    type="text"
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    placeholder="Cari bank soal, mapel, kelas, atau ruang..."
                                    className="w-full bg-slate-50 border border-slate-200 rounded-lg py-2 pl-9 pr-8 text-xs focus:ring-1 focus:ring-[#3083FF] focus:border-[#3083FF] outline-none text-slate-700"
                                />
                                {searchQuery && (
                                    <button
                                        onClick={() => setSearchQuery('')}
                                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                                    >
                                        <X size={13} />
                                    </button>
                                )}
                            </div>

                            <div className="flex items-center gap-2 flex-wrap">
                                <InlineSelect
                                    value={classFilter}
                                    onChange={(val) => setClassFilter(val)}
                                    options={[
                                        { value: 'all', label: 'Semua Kelas' },
                                        ...classes.map((c) => ({ value: c.id, label: `Kelas ${c.name}` })),
                                    ]}
                                    minWidth="140px"
                                    height="34px"
                                    title="Filter Kelas"
                                />

                                <InlineSelect
                                    value={statusFilter}
                                    onChange={(val) => setStatusFilter(val)}
                                    options={[
                                        { value: 'all', label: 'Semua Status' },
                                        { value: 'ready', label: 'Siap Ujian' },
                                        { value: 'enabled', label: 'Aktif' },
                                        { value: 'disabled', label: 'Nonaktif' },
                                        { value: 'pending', label: 'Belum Lengkap' },
                                        { value: 'active', label: 'Sedang Ujian' },
                                        { value: 'finished', label: 'Selesai' },
                                    ]}
                                    minWidth="130px"
                                    height="34px"
                                    title="Filter Status"
                                />

                                {(searchQuery || classFilter !== 'all' || statusFilter !== 'all') && (
                                    <button
                                        onClick={() => {
                                            setSearchQuery('');
                                            setClassFilter('all');
                                            setStatusFilter('all');
                                        }}
                                        className="px-2.5 py-2 text-xs text-[#3083FF] hover:underline transition-colors whitespace-nowrap font-medium"
                                    >
                                        Reset
                                    </button>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Empty State: Live Today Empty */}
                    {activeTab === 'live_today' && liveSchedules.length === 0 && (
                        <div className="py-14 text-center text-slate-400 border border-dashed border-slate-200 rounded-2xl bg-white">
                            <Calendar size={36} className="mx-auto mb-2.5 opacity-40 text-slate-400" />
                            <p className="font-semibold text-slate-700 text-sm">Tidak ada jadwal ujian hari ini</p>
                            <p className="text-xs text-slate-400 mt-0.5">Belum ada bank soal di folder ini yang dijadwalkan untuk hari ini ({formatDate(todayStr)}).</p>
                        </div>
                    )}

                    {/* Empty State: Folder Empty */}
                    {activeTab === 'schedules' && schedules.length === 0 && (
                        <div className="py-14 text-center text-slate-500 border border-dashed border-slate-200 rounded-2xl bg-white p-6">
                            <div className="w-12 h-12 rounded-2xl bg-blue-50 border border-blue-200 flex items-center justify-center text-[#3083FF] mx-auto mb-3">
                                <FolderOpen size={24} />
                            </div>
                            <p className="font-bold text-slate-800 text-sm">Folder Ujian Masih Kosong</p>
                            <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
                                Jadwalkan bank soal ke kelas tujuan untuk memulai periode ujian ini.
                            </p>
                            {!period.is_locked && (
                                <div className="mt-4 flex items-center justify-center gap-2.5">
                                    <Button
                                        variant="primary"
                                        size="sm"
                                        icon="add"
                                        onClick={() => {
                                            setScheduleForm((prev) => ({
                                                ...prev,
                                                scheduled_date: prev.scheduled_date || period.start_date?.split('T')[0] || '',
                                                session_id: prev.session_id || sessions[0]?.id || '',
                                            }));
                                            setIsAddScheduleOpen(true);
                                        }}
                                    >
                                        Jadwalkan Bank Soal
                                    </Button>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        leftIcon={<Table size={13} />}
                                        onClick={() => setActiveTab('bulk')}
                                    >
                                        Jadwal Massal
                                    </Button>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Empty State: Filter Result Empty */}
                    {schedules.length > 0 && filteredSchedules.length === 0 && (
                        <div className="py-12 text-center text-slate-500 border border-dashed border-slate-200 rounded-2xl bg-white p-6">
                            <Search size={32} className="mx-auto mb-2 text-slate-300" />
                            <p className="font-semibold text-slate-700 text-sm">Tidak ada jadwal yang cocok</p>
                            <p className="text-xs text-slate-400 mt-0.5">Coba ubah kata kunci pencarian atau reset filter kelas dan status.</p>
                            <button
                                onClick={() => {
                                    setSearchQuery('');
                                    setClassFilter('all');
                                    setStatusFilter('all');
                                }}
                                className="mt-3 px-3.5 py-1.5 text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-medium transition-colors"
                            >
                                Reset Filter
                            </button>
                        </div>
                    )}

                    {/* ── Grouped Schedules Table per Date ── */}
                    {groupedSchedules.map((dayGroup) => {
                        const daySchedules = dayGroup.sessions.flatMap((s) => s.schedules);
                        const dayScheduleIds = daySchedules.map((sc) => sc.id);
                        const isAllDaySelected = dayScheduleIds.length > 0 && dayScheduleIds.every((id) => selectedScheduleIds.includes(id));
                        const isSomeDaySelected = dayScheduleIds.some((id) => selectedScheduleIds.includes(id)) && !isAllDaySelected;

                        const toggleSelectAllDay = () => {
                            if (isAllDaySelected) {
                                setSelectedScheduleIds((prev) => prev.filter((id) => !dayScheduleIds.includes(id)));
                            } else {
                                setSelectedScheduleIds((prev) => Array.from(new Set([...prev, ...dayScheduleIds])));
                            }
                        };

                        const isToday = dayGroup.date === todayStr;

                        return (
                            <div key={dayGroup.date} className="bg-white border border-slate-200/80 rounded-2xl overflow-hidden shadow-2xs">
                                {/* Header Tanggal */}
                                <div className="bg-slate-50/80 border-b border-slate-200 px-4 py-3 flex items-center justify-between flex-wrap gap-2">
                                    <div className="flex items-center gap-2.5">
                                        <input
                                            type="checkbox"
                                            checked={isAllDaySelected}
                                            ref={(el) => {
                                                if (el) el.indeterminate = isSomeDaySelected;
                                            }}
                                            onChange={toggleSelectAllDay}
                                            className="w-4 h-4 rounded text-[#3083FF] focus:ring-[#3083FF]/20 cursor-pointer"
                                            title="Pilih semua jadwal di tanggal ini"
                                        />
                                        <div className="flex items-center gap-2">
                                            <Calendar size={14} className="text-[#3083FF]" />
                                            <span className="font-bold text-slate-800 text-sm">
                                                {formatDateWithDay(dayGroup.date)}
                                            </span>
                                            {isToday && (
                                                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                                    Hari Ini
                                                </span>
                                            )}
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-2 text-xs text-slate-500">
                                        <span>{dayGroup.sessions.length} Sesi</span>
                                        <span>•</span>
                                        <span className="font-medium text-slate-700">{daySchedules.length} Jadwal Kelas</span>
                                    </div>
                                </div>

                                {/* Tabel Jadwal */}
                                <div className="overflow-x-auto">
                                    <table className="pas-schedule-table">
                                        <colgroup><col className="pas-col-check" /><col /><col className="pas-col-time" /><col className="pas-col-room" /><col className="pas-col-status" /><col className="pas-col-actions" /></colgroup>
                                        <thead>
                                            <tr className="bg-white border-b border-slate-200/80 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                                                <th className="text-center"><span className="sr-only">Pilih jadwal</span></th>
                                                <th>Bank Soal / Kelas</th>
                                                <th>Sesi & Waktu</th>
                                                <th>Ruang & Pengawas</th>
                                                <th>Status</th>
                                                <th className="text-right">Aksi</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100 text-xs text-slate-700">
                                            {dayGroup.sessions.map((session) => {
                                                const sessionObj = sessions.find((s) => s.id === session.schedules[0]?.session_id);
                                                const sessionName = sessionObj?.name || 'Sesi';
                                                const timeLabel = sessionObj
                                                    ? `${sessionObj.start_time.substring(0, 5)} - ${sessionObj.end_time.substring(0, 5)}`
                                                    : session.time;

                                                return session.schedules.map((sc) => {
                                                    const isSelected = selectedScheduleIds.includes(sc.id);
                                                    const bankTitle = getBankTitle(sc.bank_id, sc);

                                                    return (
                                                        <tr
                                                            key={sc.id}
                                                            className="transition-colors"
                                                            data-selected={isSelected}
                                                        >
                                                            <td className="py-3 px-3 text-center">
                                                                <input
                                                                    type="checkbox"
                                                                    aria-label={`Pilih jadwal ${bankTitle}`}
                                                                    checked={isSelected}
                                                                    onChange={() => toggleScheduleSelect(sc.id)}
                                                                    className="w-4 h-4 rounded text-[#3083FF] focus:ring-[#3083FF]/20 cursor-pointer"
                                                                />
                                                            </td>
                                                            <td className="py-3 px-3">
                                                                <div className="font-bold text-slate-900 text-xs sm:text-sm">
                                                                    {bankTitle}
                                                                </div>
                                                                <div className="mt-1 text-xs font-normal text-slate-500">
                                                                    {sc.classes?.name ? `Kelas ${sc.classes.name.replace(/^kelas\s+/i, '')}` : 'Kelas belum ditentukan'}
                                                                </div>
                                                            </td>
                                                            <td>
                                                                <div className="font-medium text-slate-800">{sessionName} <span className="font-normal text-slate-500">· {sc.duration_minutes || 90} menit</span></div>
                                                                <div className="mt-1 text-xs text-slate-500 tabular-nums">{timeLabel} {tzLabel}</div>
                                                            </td>
                                                            <td className="py-3 px-3">
                                                                <PASScheduleRooms schedule={sc} rooms={rooms} onManage={() => {
                                                                    setActiveTab('rooms_sessions');
                                                                    setLogisticsSubTab('rooms');
                                                                }} />
                                                            </td>
                                                            <td className="py-3 px-3">
                                                                <PASScheduleStatus schedule={sc} />
                                                            </td>
                                                            <td className="py-3 px-3 text-right">
                                                                <PASScheduleActions active={sc.is_activated} busy={isGenerating}
                                                                    canActivate={isPASScheduleReady(sc) && sc.is_activated === false && !period.is_locked}
                                                                    canDelete={!period.is_locked} monitoringHref={sc.exam_id ? `/dashboard/admin/monitoring?exam=${sc.exam_id}` : undefined}
                                                                    onActivate={() => void handleActivation([sc.id], sc.is_activated !== true)}
                                                                    onDelete={() => void handleRemoveSchedule(sc.id)} />
                                                            </td>
                                                        </tr>
                                                    );
                                                });
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        );
                    })}

                    {/* ── Floating Action Bar for Selected Schedules ── */}
                    {selectedScheduleIds.length > 0 && (
                        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 bg-white/95 backdrop-blur-md border border-slate-200 shadow-2xl rounded-2xl px-5 py-3 flex flex-wrap items-center gap-4 max-w-xl w-[92%] sm:w-auto">
                            <div className="w-8 h-8 rounded-lg bg-blue-50 text-[#3083FF] flex items-center justify-center shrink-0">
                                <Zap size={16} />
                            </div>
                            <div className="min-w-0 pr-2">
                                <p className="text-xs font-bold text-slate-800">
                                    {selectedScheduleIds.length} Jadwal Dipilih
                                </p>
                                <p className="text-[11px] text-slate-500 truncate hidden sm:block">
                                    Aktifkan jadwal siap atau nonaktifkan ujian yang dipilih
                                </p>
                            </div>
                            <div className="flex flex-wrap items-center justify-end gap-2 ml-auto">
                                <button
                                    type="button"
                                    onClick={() => setSelectedScheduleIds([])}
                                    className="px-3 py-1.5 text-xs text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors font-medium"
                                >
                                    Batal
                                </button>
                                <Button variant="outline" size="sm" disabled={isGenerating || selectedActiveIds.length === 0}
                                    onClick={() => void handleActivation(selectedActiveIds, false)}>
                                    Nonaktifkan ({selectedActiveIds.length})
                                </Button>
                                <Button
                                    variant="primary"
                                    size="sm"
                                    onClick={() => void handleActivation(selectedReadyIds, true)}
                                    disabled={isGenerating || selectedReadyIds.length === 0}
                                    leftIcon={isGenerating ? <Loader2 size={13} className="animate-spin" /> : <Zap size={13} />}
                                >
                                    {isGenerating ? 'Memproses...' : `Aktifkan (${selectedReadyIds.length})`}
                                </Button>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* ─── ADD SCHEDULE MODAL ─── */}
            <Modal
                open={isAddScheduleOpen}
                onClose={() => setIsAddScheduleOpen(false)}
                size="xl"
                variant="add"
                icon="calendar-plus"
                title="Jadwalkan Bank Soal ke Folder"
                subtitle={<span>Folder: <strong className="text-slate-800 font-semibold">{period.name}</strong></span>}
            >
                <form onSubmit={handleAddSchedule} className="pas-schedule-form flex flex-col flex-1 min-h-0">
                    <ModalBody className="p-6 space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <ModalField label="Bank Soal" required hint="Pilih bank soal yang akan diujikan">
                                <SearchableSelect
                                    value={scheduleForm.bank_id}
                                    onChange={val => handleBankChange(String(val || ''))}
                                    placeholder="Cari atau pilih bank soal..."
                                    searchPlaceholder="Ketik nama bank soal..."
                                    options={qBanks.map(b => ({
                                        value: b.id,
                                        label: b.title,
                                        subLabel: (b.subject || 'Umum') + ' · ' + (b.question_count ?? b.total_questions ?? 0) + ' soal',
                                    }))}
                                />
                            </ModalField>

                            <ModalField label="Mata Pelajaran (Opsional)" hint="Secara default terisi otomatis dari bank soal">
                                <InlineSelect
                                    value={scheduleForm.subject_id}
                                    onChange={(val) => setScheduleForm(p => ({ ...p, subject_id: val }))}
                                    minWidth="100%"
                                    height="40px"
                                    title="Pilih Mata Pelajaran"
                                    options={[
                                        { value: '', label: 'Otomatis dari Bank Soal' },
                                        ...subjects.map((s) => ({
                                            value: s.id,
                                            label: s.name,
                                        })),
                                    ]}
                                />
                            </ModalField>
                        </div>

                        <ModalField
                            label="Kelas Tujuan"
                            required
                            hint={scheduleForm.class_ids.length > 0 ? `${scheduleForm.class_ids.length} kelas dipilih untuk jadwal ini` : 'Pilih satu atau lebih kelas'}
                        >
                            <SearchableSelect
                                multiple
                                options={classes.map(c => ({ value: c.id, label: c.name.replace(/^kelas\s+/i, '') }))}
                                value={scheduleForm.class_ids}
                                onChange={vals => setScheduleForm(p => ({ ...p, class_ids: Array.isArray(vals) ? vals.map(String) : [] }))}
                                placeholder="Cari atau pilih kelas..."
                                searchPlaceholder="Ketik nama kelas..."
                                itemLabel="kelas"
                                showQuickActions
                            />
                        </ModalField>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <ModalField label={`Tanggal (${getSchoolTimeZoneLabel(timeZone)})`} required>
                                <input
                                    type="date"
                                    required
                                    min={period.start_date?.split('T')[0]}
                                    max={period.end_date?.split('T')[0]}
                                    value={scheduleForm.scheduled_date}
                                    onChange={e => setScheduleForm(p => ({ ...p, scheduled_date: e.target.value }))}
                                    className="w-full h-[40px] px-3.5 bg-white border border-slate-200 rounded-xl text-sm text-slate-800 focus:outline-none focus:border-[#3083FF] focus:ring-1 focus:ring-[#3083FF]/20 transition-all"
                                />
                            </ModalField>

                            <ModalField label="Sesi Ujian" required hint="Waktu mulai dan berakhirnya sesi">
                                <InlineSelect
                                    value={scheduleForm.session_id}
                                    onChange={(val) => setScheduleForm(p => ({ ...p, session_id: val }))}
                                    minWidth="100%"
                                    height="40px"
                                    title="Pilih Sesi Ujian"
                                    options={[
                                        { value: '', label: '— Pilih Sesi —' },
                                        ...sessions.map((s) => ({
                                            value: s.id,
                                            label: `${s.name} (${s.start_time.substring(0, 5)} - ${s.end_time.substring(0, 5)})`,
                                        })),
                                    ]}
                                />
                            </ModalField>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <ModalField label="Durasi Pengerjaan (menit)" required>
                                <input
                                    type="number"
                                    min="1"
                                    value={scheduleForm.duration_minutes}
                                    onChange={e => setScheduleForm(p => ({ ...p, duration_minutes: parseInt(e.target.value) || 0 }))}
                                    className="w-full h-[40px] px-3.5 bg-white border border-slate-200 rounded-xl text-sm text-slate-800 focus:outline-none focus:border-[#3083FF] focus:ring-1 focus:ring-[#3083FF]/20 transition-all"
                                />
                            </ModalField>

                            <ModalField label="Ruang Ujian (Opsional)" hint="Nama bebas, tidak harus dari master. Penempatan peserta diatur pada tab Ruang dan pengawas pada tab Pengawas.">
                                <PASRoomInput
                                    value={scheduleForm.room}
                                    onChange={room => setScheduleForm(p => ({ ...p, room }))}
                                    existingRooms={rooms}
                                />
                            </ModalField>
                        </div>
                    </ModalBody>

                    <ModalFooter align="between" className="px-6 py-3.5 bg-slate-50/80 border-t border-slate-200">
                        <Button
                            type="button"
                            variant="cancel"
                            onClick={() => setIsAddScheduleOpen(false)}
                            disabled={isSubmitting}
                        >
                            Batal
                        </Button>
                        <Button
                            type="submit"
                            variant="primary"
                            disabled={isSubmitting || !scheduleForm.bank_id || scheduleForm.class_ids.length === 0 || !scheduleForm.scheduled_date || !scheduleForm.session_id}
                            isLoading={isSubmitting}
                            leftIcon={<Check size={15} />}
                        >
                            {scheduleForm.class_ids.length > 0 ? `Jadwalkan ke ${scheduleForm.class_ids.length} Kelas` : 'Jadwalkan Bank Soal'}
                        </Button>
                    </ModalFooter>
                </form>
            </Modal>

            {isEditModalOpen && period && (
                <EditPASPeriodModal
                    isOpen={isEditModalOpen}
                    period={period}
                    onClose={() => setIsEditModalOpen(false)}
                    onSuccess={(updated) => {
                        setPeriod((prev) => (prev ? { ...prev, ...updated } : prev));
                    }}
                />
            )}
        </div>
    );
}
