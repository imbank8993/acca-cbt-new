"use client";
import { PASRoomInput } from "@/app/components/PASRoomInput";
import RoomManagementModal from '@/app/dashboard/admin/pas/RoomManagementModal';
import { InlineSelect } from '@/components/ui/InlineSelect';
import { MultiSelect } from '@/components/ui/MultiSelect';
import type { PASClassSchedule,PASPeriod,PASSession } from '@/app/types/pas';
import {
addPASScheduleAction,
generateExamsFromSchedulesAction,
getPASPeriod,
listOrganizationClasses,
listPASSessions,
listSubjects,
removePASScheduleAction,
type PASSubjectSummary,
} from '@/lib/api/pas';
import type { OrganizationClass } from '@/lib/api/proctor';
import { listQuestionBanks,type QuestionBank } from '@/lib/api/questions';
import { getSessionUser } from '@/lib/session';
import { getSchoolTimeZoneLabel, schoolTodayDate } from '@/lib/school-time';
import { useSchoolTimeZone } from '@/lib/useSchoolTimeZone';
import { useMemoryState } from '@/lib/useMemoryState';
import { AnimatePresence,motion } from 'framer-motion';
import {
AlertTriangle,
ArrowLeft,
BookOpen,
Calendar,
Check,
Clock,
FolderOpen,
Loader2,
Lock,
Monitor,
Plus,
Settings,
Table,
Trash2,
X,
Zap
} from 'lucide-react';
import Link from 'next/link';
import { useParams,useRouter } from 'next/navigation';
import React,{ useCallback,useEffect,useState } from 'react';
import BulkScheduleGrid from './BulkScheduleGrid';

type TabId = 'schedules' | 'live_today' | 'detail';

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
    const [isLoading, setIsLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<TabId>('schedules');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isAddScheduleOpen, setIsAddScheduleOpen] = useState(false);
    const [isBulkInputOpen, setIsBulkInputOpen] = useState(false);
    const [isRoomManagementOpen, setIsRoomManagementOpen] = useState(false);
    const [selectedScheduleIds, setSelectedScheduleIds] = useMemoryState<string[]>('proktor_exams_pas__id__selectedScheduleIds', []);
    const [isGenerating, setIsGenerating] = useState(false);

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
            const [periodData, bankList, classList, subjectList, sessionList] = await Promise.all([
                    getPASPeriod(periodId),
                    listQuestionBanks(true),
                    listOrganizationClasses({ activeYearOnly: true }),
                    listSubjects(),
                    listPASSessions(periodId),
                ]);
                setPeriod(periodData);
                setQBanks(bankList || []);
                setClasses(classList || []);
                setSubjects(subjectList || []);
                setSessions(sessionList || []);
        }
        setIsLoading(false);
    }, [periodId, setClasses, setQBanks, setSessions, setSubjects]);

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
        const createdIds: string[] = [];
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
            if (result.id) {
                createdIds.push(result.id);
            }
        }
        if (createdIds.length > 0) {
            await generateExamsFromSchedulesAction(createdIds);
        }
        setIsAddScheduleOpen(false);
        setScheduleForm({ bank_id: '', subject_id: '', class_ids: [], scheduled_date: '', session_id: '', duration_minutes: 90, room: '' });
        await loadData();
        setIsSubmitting(false);
    };

    const handleRemoveSchedule = async (scheduleId: string) => {
        if (!confirm('Hapus jadwal ini?')) return;
        const result = await removePASScheduleAction(scheduleId);
        if (result.success) await loadData();
        else alert(result.error);
    };

    const toggleScheduleSelect = (id: string) => {
        setSelectedScheduleIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
    };

    const handleGenerateExams = async (idsToGenerate?: string[]) => {
        const targetIds = idsToGenerate || selectedScheduleIds;
        if (targetIds.length === 0) { alert('Pilih jadwal terlebih dahulu.'); return; }
        if (!confirm(`Generate dan aktifkan ${targetIds.length} jadwal ujian di dalam folder "${period?.name || 'ASAS/ASAT'}"?`)) return;
        setIsGenerating(true);
        const result = await generateExamsFromSchedulesAction(targetIds);
        if (result.success) {
            const skipped = result.skipped || [];
            alert([
                `${result.created} ujian berhasil dibuat dengan nama "${period?.name}".`,
                skipped.length > 0 ? `${skipped.length} jadwal dilewati:\n${skipped.join('\n')}` : '',
            ].filter(Boolean).join('\n\n'));
            const skippedIds = new Set(skipped.map((item) => item.split(':')[0].trim()));
            setSelectedScheduleIds((ids) => ids.filter((id) => skippedIds.has(id)));
            await loadData();
        } else { alert(result.error || 'Gagal generate'); }
        setIsGenerating(false);
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

    const getBankTitle = (bankId: string | null, sc?: PASClassSchedule) => {
        if (sc?.question_banks?.title) return sc.question_banks.title;
        return qBanks.find((bank) => bank.id === bankId)?.title || 'Bank soal dihapus';
    };

    const getSchedulesByDateAndTime = (filteredSchedules: PASClassSchedule[]) => {
        const grouped: Record<string, Record<string, PASClassSchedule[]>> = {};
        for (const sc of filteredSchedules) {
            const dateStr = sc.scheduled_date || 'Tanpa Tanggal';
            const timeStr = sc.scheduled_time || 'Tanpa Waktu';
            
            if (!grouped[dateStr]) grouped[dateStr] = {};
            if (!grouped[dateStr][timeStr]) grouped[dateStr][timeStr] = [];
            
            grouped[dateStr][timeStr].push(sc);
        }
        
        // Sort dates
        const sortedDates = Object.keys(grouped).sort();
        const result: Array<{ date: string; sessions: Array<{ time: string; schedules: PASClassSchedule[] }> }> = [];
        
        for (const date of sortedDates) {
            const sortedTimes = Object.keys(grouped[date]).sort();
            result.push({
                date,
                sessions: sortedTimes.map(t => ({
                    time: t,
                    schedules: grouped[date][t]
                }))
            });
        }
        return result;
    };

    if (isLoading) {
        return (
            <div className="flex justify-center py-20">
                <Loader2 size={36} className="text-primary animate-spin" />
            </div>
        );
    }

    if (!period) {
        return (
            <div className="max-w-2xl mx-auto py-20 text-center">
                <AlertTriangle size={48} className="text-amber-400 mx-auto mb-4" />
                <h2 className="text-xl font-bold text-slate-700 mb-2">Periode Tidak Ditemukan</h2>
                <button onClick={() => router.push('/dashboard/admin/exams')} className="px-6 py-2 bg-primary text-white rounded-xl mt-4">Kembali ke Pengaturan</button>
            </div>
        );
    }

    const schedules = period.pas_class_schedules || [];
    const uniqueBankCount = new Set(schedules.map(sc => sc.bank_id).filter(Boolean)).size;
    const readySchedulesCount = schedules.filter(sc => Boolean(sc.exam_id)).length;
    const ungeneratedIds = schedules.filter(sc => !sc.exam_id).map(sc => sc.id);
    
    // Live Today filter
    const todayStr = schoolTodayDate(timeZone);
    const liveSchedules = schedules.filter((schedule) => schedule.scheduled_date === todayStr);

    const groupedSchedules = getSchedulesByDateAndTime(activeTab === 'live_today' ? liveSchedules : schedules);

    return (
        <div className="max-w-7xl mx-auto space-y-5 pb-20">
            {timeZoneError && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{timeZoneError}</div>}
            
            {/* Period Details Header Card */}
            <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-3.5 min-w-0">
                    <Link
                        href="/dashboard/admin/exams"
                        className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition-all border border-slate-200/80 shrink-0"
                        title="Kembali ke Daftar Ujian"
                    >
                        <ArrowLeft size={16} />
                    </Link>
                    <div className="w-11 h-11 rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-center text-[#1E40AF] shrink-0">
                        <FolderOpen size={20} />
                    </div>
                    <div className="min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-blue-50 text-[#1E40AF] border border-blue-200 uppercase">
                                {period.type?.toUpperCase() === 'PAT' ? 'ASAT / PAT' : 'ASAS / PAS'} • {period.semester === "ganjil" ? "Ganjil" : "Genap"}
                            </span>
                            <span className="px-2 py-0.5 bg-slate-100 text-slate-600 text-[10px] font-bold rounded-md border border-slate-200">{period.school_year}</span>
                            {period.is_locked && <span className="px-2 py-0.5 bg-red-50 text-red-600 border border-red-200 text-[10px] font-bold rounded-md flex items-center gap-1"><Lock size={10} /> Terkunci</span>}
                        </div>
                        <h1 className="text-lg font-bold text-slate-800 truncate">{period.name}</h1>
                        <p className="text-slate-400 text-xs font-medium flex items-center gap-1.5 mt-0.5">
                            <Calendar size={12} className="text-slate-400" />
                            <span>{formatDate(period.start_date)} — {formatDate(period.end_date)}</span>
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-2 flex-wrap sm:justify-end shrink-0">
                    <span className="px-2.5 py-1.5 rounded-xl bg-blue-50 text-blue-700 border border-blue-100 text-xs font-semibold flex items-center gap-1.5">
                        <BookOpen size={13} /> {uniqueBankCount} Bank Soal
                    </span>
                    <span className="px-2.5 py-1.5 rounded-xl bg-slate-100 text-slate-700 border border-slate-200 text-xs font-semibold flex items-center gap-1.5">
                        <Calendar size={13} /> {schedules.length} Jadwal Kelas
                    </span>
                    <span className="px-2.5 py-1.5 rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-semibold flex items-center gap-1.5">
                        <Check size={13} /> {readySchedulesCount}/{schedules.length} Siap
                    </span>
                </div>
            </div>

            {/* Tabs & Toolbar Row */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 flex-wrap">
                <div className="flex flex-wrap gap-1 p-1 bg-slate-100 rounded-xl">
                    <button onClick={() => setActiveTab('schedules')}
                        className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                            activeTab === 'schedules' ? 'bg-white text-primary shadow-xs' : 'text-slate-500 hover:text-slate-700'
                        }`}>
                        <Calendar size={14} /> Daftar Bank Soal
                        <span className={`px-1.5 py-0.2 rounded text-[10px] font-bold ${activeTab === 'schedules' ? 'bg-primary/10 text-primary' : 'bg-slate-200 text-slate-500'}`}>
                            {schedules.length}
                        </span>
                    </button>
                    <button onClick={() => setActiveTab('live_today')}
                        className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                            activeTab === 'live_today' ? 'bg-white text-primary shadow-xs' : 'text-slate-500 hover:text-slate-700'
                        }`}>
                        <Zap size={14} className={activeTab === 'live_today' ? 'text-amber-500' : ''} /> Live Hari Ini
                        {liveSchedules.length > 0 && (
                            <span className="flex h-2 w-2 relative ml-0.5">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
                            </span>
                        )}
                    </button>
                    <button onClick={() => setActiveTab('detail')}
                        className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                            activeTab === 'detail' ? 'bg-white text-primary shadow-xs' : 'text-slate-500 hover:text-slate-700'
                        }`}>
                        <Settings size={14} /> Detail Folder
                    </button>
                </div>

                {!period.is_locked && activeTab === 'schedules' && !isBulkInputOpen && (
                    <div className="flex items-center gap-2 flex-wrap">
                        {ungeneratedIds.length > 0 && (
                            <button
                                onClick={() => void handleGenerateExams(ungeneratedIds)}
                                disabled={isGenerating}
                                className="px-3 py-1.5 text-xs font-semibold bg-amber-500 text-white rounded-xl hover:bg-amber-600 disabled:opacity-50 flex items-center gap-1.5 shadow-xs"
                            >
                                {isGenerating ? <Loader2 size={13} className="animate-spin" /> : <Zap size={13} />}
                                Aktifkan Semua ({ungeneratedIds.length})
                            </button>
                        )}
                        <button onClick={() => setIsRoomManagementOpen(true)}
                            className="px-3 py-1.5 text-xs bg-white text-slate-700 border border-slate-200 rounded-xl hover:bg-slate-50 flex items-center gap-1.5 font-medium transition-all shadow-2xs">
                            <Settings size={14} /> Sesi & Ruang
                        </button>
                        <button onClick={() => setIsBulkInputOpen(true)}
                            className="px-3 py-1.5 text-xs bg-white text-slate-700 border border-slate-200 rounded-xl hover:bg-slate-50 flex items-center gap-1.5 font-medium transition-all shadow-2xs">
                            <Table size={14} /> Jadwal Massal
                        </button>
                        <button onClick={() => {
                            setScheduleForm(prev => ({
                                ...prev,
                                scheduled_date: prev.scheduled_date || period.start_date?.split('T')[0] || '',
                                session_id: prev.session_id || sessions[0]?.id || '',
                            }));
                            setIsAddScheduleOpen(true);
                        }}
                            className="px-3.5 py-1.5 text-xs bg-primary text-white rounded-xl hover:bg-primary/90 flex items-center gap-1.5 shadow-xs font-semibold transition-all">
                            <Plus size={15} /> Jadwalkan Bank Soal
                        </button>
                    </div>
                )}
            </div>

            {/* ─── SCHEDULES & LIVE TAB ─── */}
            {(activeTab === 'schedules' || activeTab === 'live_today') && (
                <div className="space-y-4">
                    {isBulkInputOpen && (
                        <BulkScheduleGrid
                            periodId={periodId}
                            period={period}
                            classes={classes}
                            subjects={subjects}
                            qBanks={qBanks}
                            sessions={sessions}
                            onComplete={() => { setIsBulkInputOpen(false); void loadData(); }}
                            onCancel={() => setIsBulkInputOpen(false)}
                        />
                    )}

                    {(!isBulkInputOpen && activeTab === 'live_today' && liveSchedules.length === 0) && (
                        <div className="py-14 text-center text-slate-400 border border-dashed border-slate-200 rounded-2xl bg-white">
                            <Calendar size={36} className="mx-auto mb-2.5 opacity-40 text-slate-400" />
                            <p className="font-semibold text-slate-700 text-sm">Tidak ada jadwal ujian hari ini</p>
                            <p className="text-xs text-slate-400 mt-0.5">Belum ada bank soal di folder ini yang dijadwalkan untuk hari ini.</p>
                        </div>
                    )}

                    {(!isBulkInputOpen && activeTab === 'schedules' && schedules.length === 0) && (
                        <div className="py-14 text-center text-slate-500 border border-dashed border-slate-200 rounded-2xl bg-white p-6">
                            <div className="w-12 h-12 rounded-2xl bg-blue-50 border border-blue-200 flex items-center justify-center text-[#1E40AF] mx-auto mb-3">
                                <FolderOpen size={24} />
                            </div>
                            <p className="font-bold text-slate-800 text-sm">Folder Ujian Masih Kosong</p>
                            <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
                                Jadwalkan bank soal ke kelas tujuan untuk memulai periode ujian ini.
                            </p>
                            {!period.is_locked && (
                                <div className="mt-4 flex items-center justify-center gap-2.5">
                                    <button
                                        onClick={() => {
                                            setScheduleForm(prev => ({
                                                ...prev,
                                                scheduled_date: prev.scheduled_date || period.start_date?.split('T')[0] || '',
                                                session_id: prev.session_id || sessions[0]?.id || '',
                                            }));
                                            setIsAddScheduleOpen(true);
                                        }}
                                        className="px-3.5 py-2 text-xs bg-primary text-white rounded-xl hover:bg-primary/90 inline-flex items-center gap-1.5 font-semibold shadow-xs transition-all"
                                    >
                                        <Plus size={15} /> Jadwalkan Bank Soal
                                    </button>
                                    <button
                                        onClick={() => setIsBulkInputOpen(true)}
                                        className="px-3.5 py-2 text-xs bg-slate-100 text-slate-700 rounded-xl hover:bg-slate-200 inline-flex items-center gap-1.5 font-medium transition-all"
                                    >
                                        <Table size={14} /> Jadwal Massal
                                    </button>
                                </div>
                            )}
                        </div>
                    )}

                    {!isBulkInputOpen && groupedSchedules.map((dayGroup) => (
                        <div key={dayGroup.date} className="bg-white border border-slate-200/80 rounded-2xl overflow-hidden shadow-xs">
                            {/* Header Tanggal */}
                            <div className="bg-slate-50 border-b border-slate-200/80 px-4 py-3 flex items-center justify-between">
                                <div className="flex items-center gap-2.5 font-semibold text-slate-800 text-sm">
                                    <Calendar size={15} className="text-[#3083FF]" />
                                    <span>{formatDate(dayGroup.date)}</span>
                                </div>
                                <span className="text-xs font-semibold text-slate-500 bg-white border border-slate-200 px-2 py-0.5 rounded-lg shadow-2xs">
                                    {dayGroup.sessions.length} Sesi Ujian
                                </span>
                            </div>

                            {/* Daftar Sesi dalam Tanggal tersebut */}
                            <div className="p-4 sm:p-6 space-y-6">
                                {dayGroup.sessions.map((session, sIdx) => (
                                    <div key={session.time} className="relative">
                                        {/* Connector line between sessions if not last */}
                                        {sIdx !== dayGroup.sessions.length - 1 && (
                                            <div className="absolute left-[5.5rem] top-10 bottom-[-1.5rem] w-px bg-slate-200 hidden sm:block" />
                                        )}
                                        
                                        <div className="flex flex-col sm:flex-row gap-4 sm:gap-6">
                                            {/* Jam Sesi */}
                                            <div className="sm:w-20 shrink-0 flex items-start sm:justify-end mt-1">
                                                <div className="flex items-center gap-2 text-slate-700 font-bold bg-slate-100 px-3 py-1.5 rounded-lg">
                                                    <Clock size={14} className="text-primary" />
                                                    {session.time} {getSchoolTimeZoneLabel(timeZone)}
                                                </div>
                                            </div>

                                            {/* Daftar Ujian di Sesi tersebut */}
                                            <div className="flex-1 space-y-3">
                                                {session.schedules.map((sc) => (
                                                    <div key={sc.id} className={`flex flex-col sm:flex-row gap-3 p-4 rounded-xl border transition-all ${
                                                        sc.status === 'active' ? 'bg-green-50 border-green-200 shadow-sm' : 
                                                        sc.status === 'finished' ? 'bg-slate-50 border-slate-100 opacity-70' : 
                                                        'bg-white border-slate-200 hover:border-primary/30 hover:shadow-md'
                                                    }`}>
                                                        <div className="flex items-start gap-3 flex-1 min-w-0">
                                                            <div className="pt-1">
                                                                <input type="checkbox" checked={selectedScheduleIds.includes(sc.id)} onChange={() => toggleScheduleSelect(sc.id)} className="w-4 h-4 rounded text-primary" />
                                                            </div>
                                                            <div className="flex-1 min-w-0">
                                                                <div className="flex items-center gap-2 mb-1 flex-wrap">
                                                                    <span className="font-bold text-slate-800 text-base">{getBankTitle(sc.bank_id, sc)}</span>
                                                                    <span className="px-2 py-0.5 bg-indigo-50 text-indigo-700 border border-indigo-100 text-[10px] font-bold rounded-md">
                                                                        Kelas {sc.classes?.name || 'Semua Kelas'}
                                                                    </span>
                                                                    {sc.room && <span className="px-2 py-0.5 bg-blue-50 text-blue-600 text-[10px] font-bold rounded-md">R. {sc.room}</span>}
                                                                </div>
                                                                
                                                                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                                                                    <span className="text-slate-600 font-medium">Ujian: <strong>{period.name}</strong></span>
                                                                    <span className="flex items-center gap-1.5"><Clock size={12}/> {sc.duration_minutes} mnt</span>
                                                                    <span className="flex items-center gap-1.5"><AlertTriangle size={12}/> Tutup {sc.window_end_time} {getSchoolTimeZoneLabel(timeZone)}</span>
                                                                </div>
                                                            </div>
                                                        </div>

                                                        {/* Status & Actions */}
                                                        <div className="flex sm:flex-col items-center sm:items-end justify-between sm:justify-center gap-2 shrink-0 border-t sm:border-t-0 sm:border-l border-slate-100 pt-3 sm:pt-0 sm:pl-4">
                                                            <div className="flex flex-col items-start sm:items-end gap-1">
                                                                <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full uppercase tracking-wider ${
                                                                    sc.status === 'active' ? 'bg-green-100 text-green-700' : 
                                                                    sc.status === 'finished' ? 'bg-slate-200 text-slate-500' : 
                                                                    'bg-slate-100 text-slate-600'
                                                                }`}>
                                                                    {sc.status === 'scheduled' ? 'TERJADWAL' : sc.status === 'active' ? 'SEDANG UJIAN' : 'SELESAI'}
                                                                </span>
                                                                <div className="flex items-center gap-1 mt-0.5">
                                                                    {sc.exam_id ? (
                                                                        <span className="flex items-center gap-1 text-[10px] text-emerald-600 font-semibold"><Check size={10}/> Siap Ujian</span>
                                                                    ) : (
                                                                        <span className="text-[10px] text-amber-600 font-semibold italic">Belum diaktifkan</span>
                                                                    )}
                                                                </div>
                                                            </div>

                                                            <div className="flex items-center gap-1.5">
                                                                {sc.exam_id && (
                                                                    <Link
                                                                        href={`/dashboard/admin/monitoring?exam=${sc.exam_id}`}
                                                                        className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-primary/10 text-slate-700 hover:text-primary text-[11px] font-bold flex items-center gap-1 transition-all"
                                                                        title="Monitor ujian kelas ini"
                                                                    >
                                                                        <Monitor size={12} /> Monitor
                                                                    </Link>
                                                                )}
                                                                {!period.is_locked && (
                                                                    <button onClick={() => handleRemoveSchedule(sc.id)} className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-50 transition-all" title="Hapus jadwal">
                                                                        <Trash2 size={14} />
                                                                    </button>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))}

                    {/* Bar Aksi Generate Ujian untuk jadwal yang di-check */}
                    {selectedScheduleIds.length > 0 && (
                        <div className="sticky bottom-4 flex items-center gap-3 p-4 bg-blue-50 border border-blue-200 shadow-xl rounded-xl mt-6 z-10">
                            <Zap size={20} className="text-[#1E40AF] shrink-0" />
                            <div className="flex-1">
                                <p className="text-sm font-semibold text-[#1E40AF]">{selectedScheduleIds.length} jadwal dipilih</p>
                                <p className="text-xs text-blue-700">Akan dibuat/diperbarui ujian dengan nama &ldquo;{period.name}&rdquo; untuk dikerjakan siswa</p>
                            </div>
                            <button onClick={() => void handleGenerateExams()} disabled={isGenerating} className="px-5 py-2.5 bg-[#3083FF] hover:bg-[#2563EB] text-white text-xs font-bold rounded-lg disabled:opacity-50 flex items-center gap-1.5 shadow-md">
                                {isGenerating ? <Loader2 size={13} className="animate-spin" /> : <Zap size={13} />}
                                {isGenerating ? 'Memproses...' : 'Generate Ujian'}
                            </button>
                        </div>
                    )}
                </div>
            )}

            {/* ─── DETAIL TAB ─── */}
            {activeTab === 'detail' && (
                <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                            <p className="text-xs text-slate-400 font-medium mb-1">Nama Folder / Nama Ujian</p>
                            <p className="text-sm font-semibold text-slate-900">{period.name}</p>
                        </div>
                        <div>
                            <p className="text-xs text-slate-400 font-medium mb-1">Tipe</p>
                            <p className="text-sm font-semibold text-slate-900 uppercase">{period.type === 'pat' ? 'ASAT / PAT' : 'ASAS / PAS'}</p>
                        </div>
                        <div>
                            <p className="text-xs text-slate-400 font-medium mb-1">Tahun Ajaran</p>
                            <p className="text-sm font-semibold text-slate-900">{period.school_year}</p>
                        </div>
                        <div>
                            <p className="text-xs text-slate-400 font-medium mb-1">Semester</p>
                            <p className="text-sm font-semibold text-slate-900">{period.semester === 'ganjil' ? 'Ganjil' : 'Genap'}</p>
                        </div>
                        <div>
                            <p className="text-xs text-slate-400 font-medium mb-1">Tanggal Mulai</p>
                            <p className="text-sm font-semibold text-slate-900">{formatDate(period.start_date)}</p>
                        </div>
                        <div>
                            <p className="text-xs text-slate-400 font-medium mb-1">Tanggal Selesai</p>
                            <p className="text-sm font-semibold text-slate-900">{formatDate(period.end_date)}</p>
                        </div>
                    </div>
                    <div className="pt-4 border-t border-slate-100">
                        <p className="text-xs text-slate-400 font-medium mb-2">Status</p>
                        <span className={`px-3 py-1.5 text-xs font-bold rounded-full ${period.is_locked ? 'bg-amber-50 text-amber-600' : 'bg-emerald-50 text-emerald-600'}`}>
                            {period.is_locked ? 'TERKUNCI' : 'AKTIF'}
                        </span>
                    </div>
                </div>
            )}

            {/* ─── ADD SCHEDULE MODAL ─── */}
            <AnimatePresence>
                {isAddScheduleOpen && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-black/40 backdrop-blur-xs" onClick={() => setIsAddScheduleOpen(false)} />
                        <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }} className="bg-white w-full max-w-lg rounded-2xl p-6 relative z-10 max-h-[90vh] overflow-y-auto shadow-2xl border border-slate-200">
                            <button onClick={() => setIsAddScheduleOpen(false)} className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 transition-colors">
                                <X size={20} />
                            </button>
                            <div className="flex items-center gap-3 mb-1">
                                <div className="w-10 h-10 rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-center text-[#1E40AF] shrink-0">
                                    <FolderOpen size={20} />
                                </div>
                                <div>
                                    <h3 className="text-base font-bold text-slate-800">Jadwalkan Bank Soal ke Folder</h3>
                                    <p className="text-xs text-slate-400">
                                        Folder: <span className="font-semibold text-slate-600">{period.name}</span>
                                    </p>
                                </div>
                            </div>

                            <form onSubmit={handleAddSchedule} className="mt-5 space-y-4">
                                <div>
                                    <label className="text-xs font-semibold text-slate-700 mb-1.5 block">Bank Soal *</label>
                                    <InlineSelect
                                        value={scheduleForm.bank_id}
                                        onChange={(val) => handleBankChange(val)}
                                        minWidth="100%"
                                        height="40px"
                                        title="Pilih Bank Soal"
                                        options={[
                                            { value: '', label: '— Pilih Bank Soal —' },
                                            ...qBanks.map((b) => ({
                                                value: b.id,
                                                label: `${b.title} — ${b.subject || 'Umum'} (${b.question_count ?? b.total_questions ?? 0} soal)`,
                                            })),
                                        ]}
                                    />
                                </div>

                                <div>
                                    <label className="text-xs font-semibold text-slate-700 mb-1.5 block">Mata Pelajaran (Opsional)</label>
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
                                </div>

                                <div>
                                    <label className="text-xs font-semibold text-slate-700 mb-1.5 block">
                                        Kelas Tujuan * {scheduleForm.class_ids.length > 0 && <span className="text-primary font-normal">({scheduleForm.class_ids.length} kelas dipilih)</span>}
                                    </label>
                                    <MultiSelect
                                        options={classes.map((c) => ({ value: c.id, label: c.name }))}
                                        value={scheduleForm.class_ids}
                                        onChange={(vals) => setScheduleForm(p => ({ ...p, class_ids: vals }))}
                                        placeholder="— Pilih Kelas Tujuan —"
                                        allSelectedText="Semua Kelas Terpilih"
                                        minWidth="100%"
                                        height="40px"
                                        showQuickActions={true}
                                    />
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <div>
                                        <label className="text-xs font-semibold text-slate-700 mb-1.5 block">Tanggal ({getSchoolTimeZoneLabel(timeZone)}) *</label>
                                        <input
                                            type="date"
                                            required
                                            min={period.start_date?.split('T')[0]}
                                            max={period.end_date?.split('T')[0]}
                                            value={scheduleForm.scheduled_date}
                                            onChange={e => setScheduleForm(p => ({ ...p, scheduled_date: e.target.value }))}
                                            className="w-full h-[40px] px-3 bg-white border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 transition-all"
                                        />
                                    </div>
                                    <div>
                                        <label className="text-xs font-semibold text-slate-700 mb-1.5 block">Sesi Ujian *</label>
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
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <div>
                                        <label className="text-xs font-semibold text-slate-700 mb-1.5 block">Durasi (menit)</label>
                                        <input
                                            type="number"
                                            min="1"
                                            value={scheduleForm.duration_minutes}
                                            onChange={e => setScheduleForm(p => ({ ...p, duration_minutes: parseInt(e.target.value) || 0 }))}
                                            className="w-full h-[40px] px-3 bg-white border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 transition-all"
                                        />
                                    </div>
                                    <div>
                                        <label className="text-xs font-semibold text-slate-700 mb-1.5 block">Ruang (opsional)</label>
                                        <PASRoomInput value={scheduleForm.room} onChange={room => setScheduleForm(p => ({ ...p, room }))} />
                                    </div>
                                </div>

                                <div className="pt-2">
                                    <button
                                        type="submit"
                                        disabled={isSubmitting || !scheduleForm.bank_id || scheduleForm.class_ids.length === 0 || !scheduleForm.scheduled_date || !scheduleForm.session_id}
                                        className="w-full h-[42px] bg-primary text-white rounded-xl font-bold text-sm disabled:opacity-50 flex items-center justify-center gap-2 shadow-sm hover:bg-primary/90 transition-all cursor-pointer"
                                    >
                                        {isSubmitting ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                                        {isSubmitting ? 'Menjadwalkan...' : (scheduleForm.class_ids.length > 0 ? `Jadwalkan ke ${scheduleForm.class_ids.length} Kelas` : 'Pilih Kelas Terlebih Dahulu')}
                                    </button>
                                </div>
                            </form>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>

            {/* ─── ROOM & SESSION MANAGEMENT MODAL ─── */}
            <AnimatePresence>
                {isRoomManagementOpen && (
                    <RoomManagementModal
                        period={period}
                        onClose={() => {
                            setIsRoomManagementOpen(false);
                            void loadData(); // Reload sessions in case they changed
                        }}
                    />
                )}
            </AnimatePresence>
        </div>
    );
}
