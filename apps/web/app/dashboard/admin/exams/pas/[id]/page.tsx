"use client";
import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    ArrowLeft, Loader2, Plus, X, Check, Trash2,
    Calendar, Clock, BookOpen, Users, Lock,
    AlertTriangle, Settings, Zap
} from 'lucide-react';
import { getProctorOrganization } from '@/lib/api/proctor';
import {
    getPASPeriod,
    listOrganizationClasses,
    addPASScheduleAction,
    removePASScheduleAction,
    generateExamsFromSchedulesAction,
    listSubjects,
    listPASSessions,
} from '@/lib/api/pas';
import { listQuestionBanks } from '@/lib/api/questions';
import { getSessionUser } from '@/lib/session';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { useMemoryState } from '@/lib/useMemoryState';
import BulkScheduleGrid from './BulkScheduleGrid';
import RoomManagementModal from '@/app/dashboard/admin/pas/RoomManagementModal';

type TabId = 'schedules' | 'live_today' | 'detail';

export default function ProctorPASDetailPage() {
    const router = useRouter();
    const params = useParams();
    const periodId = params.id as string;

    const [period, setPeriod] = useState<any>(null);
    const [classes, setClasses] = useMemoryState<any[]>('proktor_exams_pas__id__classes', []);
    const [subjects, setSubjects] = useMemoryState<any[]>('proktor_exams_pas__id__subjects', []);
    const [qBanks, setQBanks] = useMemoryState<any[]>('proktor_exams_pas__id__qBanks', []);
    const [sessions, setSessions] = useMemoryState<any[]>('proktor_exams_pas__id__sessions', []);
    const [orgId, setOrgId] = useMemoryState<string>('proktor_exams_pas__id__orgId', '');
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

    useEffect(() => { loadData();
        // Auto-injected smart sync (Window Focus)
        const handleFocus = () => { if (typeof loadData === 'function') loadData(); };
        window.addEventListener('focus', handleFocus);
        return () => window.removeEventListener('focus', handleFocus); }, [periodId]);

    const loadData = async () => {
        const authUser = await getSessionUser();
        if (authUser) {
            const orgData = await getProctorOrganization();
            if (orgData) {
                const [periodData, bankList, classList, subjectList, sessionList] = await Promise.all([
                    getPASPeriod(periodId),
                    listQuestionBanks(orgData.id, true),
                    listOrganizationClasses(orgData.id, { activeYearOnly: true }),
                    listSubjects(orgData.id),
                    listPASSessions(periodId),
                ]);
                setPeriod(periodData);
                setQBanks(bankList || []);
                setClasses(classList || []);
                setSubjects(subjectList || []);
                setSessions(sessionList || []);
                setOrgId(orgData.id);
            }
        }
        setIsLoading(false);
    };

    const toggleClass = (classId: string) => {
        setScheduleForm(prev => ({
            ...prev,
            class_ids: prev.class_ids.includes(classId)
                ? prev.class_ids.filter(id => id !== classId)
                : [...prev.class_ids, classId]
        }));
    };

    const handleAddSchedule = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!scheduleForm.bank_id || !scheduleForm.subject_id || scheduleForm.class_ids.length === 0 || !scheduleForm.scheduled_date || !scheduleForm.session_id) {
            alert('Lengkapi bank soal, mata pelajaran, minimal satu kelas, tanggal, dan sesi.');
            return;
        }
        setIsSubmitting(true);
        for (const classId of scheduleForm.class_ids) {
            const result = await addPASScheduleAction({
                pas_period_id: periodId,
                bank_id: scheduleForm.bank_id,
                subject_id: scheduleForm.subject_id,
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
        if (!confirm('Hapus jadwal ini?')) return;
        const result = await removePASScheduleAction(scheduleId);
        if (result.success) await loadData();
        else alert(result.error);
    };

    const toggleScheduleSelect = (id: string) => {
        setSelectedScheduleIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
    };

    const handleGenerateExams = async () => {
        if (selectedScheduleIds.length === 0) { alert('Pilih jadwal terlebih dahulu.'); return; }
        if (!confirm(`Generate ${selectedScheduleIds.length} ujian?`)) return;
        setIsGenerating(true);
        const result = await generateExamsFromSchedulesAction(selectedScheduleIds);
        if (result.success) {
            alert(`${result.created} ujian berhasil dibuat.`);
            setSelectedScheduleIds([]);
            await loadData();
        } else { alert(result.error || 'Gagal generate'); }
        setIsGenerating(false);
    };

    const formatDate = (dateStr: string) => {
        if (!dateStr) return '-';
        return new Date(dateStr).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
    };

    const getBankTitle = (bankId: string, sc?: any) => {
        if (sc?.question_banks?.title) return sc.question_banks.title;
        return qBanks.find((b: any) => b.id === bankId)?.title || 'Bank soal dihapus';
    };

    const getSchedulesByDateAndTime = (filteredSchedules: any[]) => {
        const grouped: Record<string, Record<string, any[]>> = {};
        for (const sc of filteredSchedules) {
            const dateStr = sc.scheduled_date || 'Tanpa Tanggal';
            const timeStr = sc.scheduled_time || 'Tanpa Waktu';
            
            if (!grouped[dateStr]) grouped[dateStr] = {};
            if (!grouped[dateStr][timeStr]) grouped[dateStr][timeStr] = [];
            
            grouped[dateStr][timeStr].push(sc);
        }
        
        // Sort dates
        const sortedDates = Object.keys(grouped).sort();
        const result: Array<{ date: string; sessions: Array<{ time: string; schedules: any[] }> }> = [];
        
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
                <Loader2 size={48} className="text-primary animate-spin" />
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

    const schedules = period?.pas_class_schedules || [];
    
    // Live Today filter
    const todayStr = new Date().toISOString().split('T')[0];
    const liveSchedules = schedules.filter((s: any) => s.scheduled_date === todayStr);

    const groupedSchedules = getSchedulesByDateAndTime(activeTab === 'live_today' ? liveSchedules : schedules);

    return (
        <div className="max-w-7xl mx-auto space-y-6 pb-20">
            {/* ── Hero Header — Navy Gradient ── */}
                        {/* Period Details Bar */}
            <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs flex items-start gap-4">
                <Link href="/dashboard/admin/exams" className="mt-1 p-2 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-xl transition-all border border-slate-200">
                    <ArrowLeft size={18} />
                </Link>
                <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                        <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold tracking-wider ${
                            period.is_locked ? "bg-red-50 text-red-600 border border-red-200" : "bg-emerald-50 text-emerald-600 border border-emerald-200"
                        }`}>
                            {period.type?.toUpperCase()} {period.semester === "ganjil" ? "GANJIL" : "GENAP"}
                        </span>
                        <span className="px-2.5 py-0.5 bg-slate-100 text-slate-600 text-[10px] font-bold tracking-wider rounded-full border border-slate-200">{period.school_year}</span>
                        {period.is_locked && <span className="px-2.5 py-0.5 bg-red-50 text-red-600 border border-red-200 text-[10px] font-bold tracking-wider rounded-full flex items-center gap-1"><Lock size={10} /> TERKUNCI</span>}
                    </div>
                    <h1 className="text-xl font-bold text-slate-800 mb-1">{period.name}</h1>
                    <p className="text-slate-500 text-xs font-semibold flex items-center gap-1.5">
                        <Calendar size={13} />
                        {formatDate(period.start_date)} — {formatDate(period.end_date)}
                    </p>
                </div>
            </div>

            {/* Tabs */}
            <div className="flex flex-wrap gap-1 p-1 bg-slate-100 rounded-xl w-max">
                <button onClick={() => setActiveTab('schedules')}
                    className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition-all ${
                        activeTab === 'schedules' ? 'bg-white text-primary shadow-sm' : 'text-slate-500 hover:text-slate-700'
                    }`}>
                    <Calendar size={15} /> Semua Jadwal
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${activeTab === 'schedules' ? 'bg-primary/10 text-primary' : 'bg-slate-200 text-slate-500'}`}>
                        {schedules.length}
                    </span>
                </button>
                <button onClick={() => setActiveTab('live_today')}
                    className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition-all ${
                        activeTab === 'live_today' ? 'bg-white text-primary shadow-sm' : 'text-slate-500 hover:text-slate-700'
                    }`}>
                    <Zap size={15} className={activeTab === 'live_today' ? 'text-amber-500' : ''} /> Live Hari Ini
                    {liveSchedules.length > 0 && (
                        <span className="flex h-2 w-2 relative ml-1">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
                        </span>
                    )}
                </button>
                <button onClick={() => setActiveTab('detail')}
                    className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition-all ${
                        activeTab === 'detail' ? 'bg-white text-primary shadow-sm' : 'text-slate-500 hover:text-slate-700'
                    }`}>
                    <Settings size={15} /> Detail
                </button>
            </div>

            {/* ─── SCHEDULES & LIVE TAB ─── */}
            {(activeTab === 'schedules' || activeTab === 'live_today') && (
                <div className="space-y-6">
                    {!period.is_locked && activeTab === 'schedules' && !isBulkInputOpen && (
                        <div className="flex justify-end gap-3 flex-wrap">
                            <button onClick={() => setIsRoomManagementOpen(true)}
                                className="px-4 py-2 text-sm bg-slate-100 text-slate-700 border border-slate-200 rounded-xl hover:bg-slate-200 flex items-center gap-2 font-medium">
                                <Settings size={16} /> Pengaturan Sesi & Ruang
                            </button>
                            <button onClick={() => setIsBulkInputOpen(true)}
                                className="px-4 py-2 text-sm bg-primary text-white rounded-xl hover:bg-primary/90 flex items-center gap-2 shadow-lg shadow-primary/20 font-medium">
                                <Calendar size={16} /> Atur Jadwal
                            </button>
                        </div>
                    )}

                    {isBulkInputOpen && (
                        <BulkScheduleGrid
                            periodId={periodId}
                            period={period}
                            classes={classes}
                            subjects={subjects}
                            qBanks={qBanks}
                            sessions={sessions}
                            onComplete={() => { setIsBulkInputOpen(false); loadData(); }}
                            onCancel={() => setIsBulkInputOpen(false)}
                        />
                    )}

                    {(!isBulkInputOpen && activeTab === 'live_today' && liveSchedules.length === 0) && (
                        <div className="py-16 text-center text-slate-400 border-2 border-dashed border-slate-200 rounded-2xl bg-slate-50/50">
                            <Calendar size={40} className="mx-auto mb-3 opacity-40" />
                            <p className="font-medium text-slate-600">Tidak ada jadwal ujian hari ini</p>
                            <p className="text-sm mt-1">Ujian PAS untuk hari ini belum dijadwalkan atau Anda sedang salah hari.</p>
                        </div>
                    )}

                    {(!isBulkInputOpen && activeTab === 'schedules' && schedules.length === 0) && (
                        <div className="py-16 text-center text-slate-400 border-2 border-dashed border-slate-200 rounded-2xl">
                            <Calendar size={40} className="mx-auto mb-3 opacity-40" />
                            <p className="font-medium">Belum ada jadwal</p>
                            <p className="text-sm mt-1">Tambahkan jadwal ujian per kelas</p>
                        </div>
                    )}

                    {!isBulkInputOpen && groupedSchedules.map((dayGroup) => (
                        <div key={dayGroup.date} className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
                            {/* Header Tanggal */}
                            <div className="bg-slate-800 p-4 flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-lg bg-slate-700 flex flex-col items-center justify-center text-white">
                                        <span className="text-xs font-bold -mb-1">{new Date(dayGroup.date).toLocaleDateString('id-ID', { weekday: 'short' })}</span>
                                        <span className="text-sm font-black">{new Date(dayGroup.date).getDate()}</span>
                                    </div>
                                    <div>
                                        <h3 className="text-white font-bold text-lg leading-tight">{formatDate(dayGroup.date)}</h3>
                                        <p className="text-slate-400 text-xs">{dayGroup.sessions.length} Sesi Ujian</p>
                                    </div>
                                </div>
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
                                                    {session.time}
                                                </div>
                                            </div>

                                            {/* Daftar Ujian di Sesi tersebut */}
                                            <div className="flex-1 space-y-3">
                                                {session.schedules.map((sc: any) => (
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
                                                                    <span className="px-2 py-0.5 bg-slate-100 text-slate-600 text-[10px] font-bold rounded-md">
                                                                        {sc.classes?.name || 'Semua Kelas'}
                                                                    </span>
                                                                    {sc.room && <span className="px-2 py-0.5 bg-blue-50 text-blue-600 text-[10px] font-bold rounded-md">R. {sc.room}</span>}
                                                                </div>
                                                                
                                                                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                                                                    <span className="flex items-center gap-1.5"><Clock size={12}/> {sc.duration_minutes} mnt</span>
                                                                    <span className="flex items-center gap-1.5"><AlertTriangle size={12}/> Tutup {sc.window_end_time}</span>
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
                                                                        <span className="flex items-center gap-1 text-[10px] text-emerald-500 font-medium"><Check size={10}/> Siap Ujian</span>
                                                                    ) : (
                                                                        <span className="text-[10px] text-amber-500 font-medium italic">Belum digenerate</span>
                                                                    )}
                                                                </div>
                                                            </div>

                                                            {!period.is_locked && (
                                                                <button onClick={() => handleRemoveSchedule(sc.id)} className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-50 transition-all">
                                                                    <Trash2 size={14} />
                                                                </button>
                                                            )}
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
                        <div className="sticky bottom-4 flex items-center gap-3 p-4 bg-amber-50 border border-amber-200 shadow-xl rounded-xl mt-6 z-10">
                            <Zap size={20} className="text-amber-600 shrink-0" />
                            <div className="flex-1">
                                <p className="text-sm font-semibold text-amber-800">{selectedScheduleIds.length} jadwal dipilih</p>
                                <p className="text-xs text-amber-600">Akan dibuat record ujian untuk dikerjakan siswa</p>
                            </div>
                            <button onClick={handleGenerateExams} disabled={isGenerating} className="px-5 py-2.5 bg-amber-500 text-white text-xs font-bold rounded-lg hover:bg-amber-600 disabled:opacity-50 flex items-center gap-1.5 shadow-md">
                                {isGenerating ? <Loader2 size={13} className="animate-spin" /> : <Zap size={13} />}
                                {isGenerating ? 'Generating...' : 'Generate Ujian'}
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
                            <p className="text-xs text-slate-400 font-medium mb-1">Nama</p>
                            <p className="text-sm font-semibold text-slate-900">{period.name}</p>
                        </div>
                        <div>
                            <p className="text-xs text-slate-400 font-medium mb-1">Tipe</p>
                            <p className="text-sm font-semibold text-slate-900 uppercase">{period.type}</p>
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
                        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-black/30" onClick={() => setIsAddScheduleOpen(false)} />
                        <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }} className="bg-white w-full max-w-md rounded-2xl p-6 relative z-10 max-h-[90vh] overflow-y-auto">
                            <button onClick={() => setIsAddScheduleOpen(false)} className="absolute top-4 right-4 text-slate-400"><X size={20} /></button>
                            <div className="flex items-center gap-3 mb-1">
                                <Calendar size={20} className="text-primary" />
                                <h3 className="text-lg font-semibold text-slate-900">Tambah Jadwal Ujian</h3>
                            </div>
                            <p className="text-xs text-slate-500 mb-5">Bank soal + kelas + waktu ujian</p>
                            <form onSubmit={handleAddSchedule} className="space-y-4">
                                <div>
                                    <label className="text-xs font-medium text-slate-600 mb-1.5 block">Bank Soal</label>
                                    <select required value={scheduleForm.bank_id} onChange={e => setScheduleForm(p => ({ ...p, bank_id: e.target.value }))} className="w-full border border-slate-200 rounded-xl p-3 text-sm">
                                        <option value="">Pilih Bank Soal</option>
                                        {qBanks.map((b: any) => (
                                            <option key={b.id} value={b.id}>{b.title} — {b.subject} ({b.question_count} soal)</option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className="text-xs font-medium text-slate-600 mb-1.5 block">Mata Pelajaran</label>
                                    <select required value={scheduleForm.subject_id} onChange={e => setScheduleForm(p => ({ ...p, subject_id: e.target.value }))} className="w-full border border-slate-200 rounded-xl p-3 text-sm">
                                        <option value="">Pilih Mata Pelajaran</option>
                                        {subjects.map((s: any) => (
                                            <option key={s.id} value={s.id}>{s.name}</option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className="text-xs font-medium text-slate-600 mb-1.5 block">Kelas ({scheduleForm.class_ids.length} dipilih)</label>
                                    <div className="flex flex-wrap gap-2 max-h-36 overflow-y-auto p-2 bg-slate-50 rounded-xl border border-slate-200">
                                        {classes.map((c: any) => (
                                            <button key={c.id} type="button" onClick={() => toggleClass(c.id)}
                                                className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${scheduleForm.class_ids.includes(c.id) ? 'bg-primary text-white border-primary' : 'bg-white text-slate-600 border-slate-200 hover:border-primary/40'}`}>
                                                {c.name}
                                            </button>
                                        ))}
                                        {classes.length === 0 && <p className="text-xs text-slate-400">Belum ada kelas</p>}
                                    </div>
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <div>
                                        <label className="text-xs font-medium text-slate-600 mb-1.5 block">Tanggal</label>
                                        <input type="date" required value={scheduleForm.scheduled_date} onChange={e => setScheduleForm(p => ({ ...p, scheduled_date: e.target.value }))} className="w-full border border-slate-200 rounded-xl p-3 text-sm" />
                                    </div>
                                    <div>
                                        <label className="text-xs font-medium text-slate-600 mb-1.5 block">Sesi Ujian</label>
                                        <select required value={scheduleForm.session_id} onChange={e => setScheduleForm(p => ({ ...p, session_id: e.target.value }))} className="w-full border border-slate-200 rounded-xl p-3 text-sm">
                                            <option value="">Pilih Sesi</option>
                                            {sessions.map((s: any) => (
                                                <option key={s.id} value={s.id}>{s.name} ({s.start_time.substring(0, 5)} - {s.end_time.substring(0, 5)})</option>
                                            ))}
                                        </select>
                                    </div>
                                </div>
                                <p className="text-xs text-slate-400 -mt-1">Siswa bebas buka kapan saja dalam window. Durasi mulai saat siswa klik mulai.</p>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <div>
                                        <label className="text-xs font-medium text-slate-600 mb-1.5 block">Durasi (menit)</label>
                                        <input type="number" value={scheduleForm.duration_minutes} onChange={e => setScheduleForm(p => ({ ...p, duration_minutes: parseInt(e.target.value) }))} className="w-full border border-slate-200 rounded-xl p-3 text-sm" />
                                    </div>
                                    <div>
                                        <label className="text-xs font-medium text-slate-600 mb-1.5 block">Ruang (opsional)</label>
                                        <input type="text" value={scheduleForm.room} onChange={e => setScheduleForm(p => ({ ...p, room: e.target.value }))} placeholder="101" className="w-full border border-slate-200 rounded-xl p-3 text-sm" />
                                    </div>
                                </div>
                                <button type="submit" disabled={isSubmitting} className="w-full py-3 bg-primary text-white rounded-xl font-medium disabled:opacity-50 flex items-center justify-center gap-2">
                                    {isSubmitting ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                                    {isSubmitting ? 'Menyimpan...' : `Simpan — ${scheduleForm.class_ids.length} kelas`}
                                </button>
                            </form>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>

            {/* ─── ROOM & SESSION MANAGEMENT MODAL ─── */}
            <AnimatePresence>
                {isRoomManagementOpen && orgId && (
                    <RoomManagementModal
                        period={period}
                        orgId={orgId}
                        onClose={() => {
                            setIsRoomManagementOpen(false);
                            loadData(); // Reload sessions in case they changed
                        }}
                    />
                )}
            </AnimatePresence>
        </div>
    );
}
