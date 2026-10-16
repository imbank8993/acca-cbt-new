"use client";
import '@/app/components/pas-room-management.css';

import { deleteConfirmDialog } from '@/lib/confirm-dialog';
import { PASRoomInput } from "@/app/components/PASRoomInput";
import {
    assignProctorsToRoomAction,
    getRoomSessionInvigilators,
    assignStudentsToRoomAction,
    createPASRoomAction,
    createPASSessionAction,
    deletePASRoomAction,
    deletePASSessionAction,
    listPASRooms,
    listPASSessions,
    listTeachersAndInvigilators,
    type PASRoom,
    type PASStaffMember,
    removeStudentFromRoomAction,
} from '@/lib/api/pas';
import {
    type ClassStudent,
    getStudentsByClassAction,
    listOrganizationClasses,
    type OrganizationClass,
} from '@/lib/api/proctor';
import type { PASPeriod, PASSession } from '@/app/types/pas';
import { Modal, ModalBody, ModalFooter } from '@/app/components/ui/modal';
import { InlineSelect } from '@/app/components/ui/inlineselect';
import { MultiSelect } from '@/components/ui/MultiSelect';
import { Button } from '@/app/components/ui/button';
import { formatStudentName } from '@/lib/monitoring-health';
import { getSchoolTimeZoneLabel } from '@/lib/school-time';
import { useSchoolTimeZone } from '@/lib/useSchoolTimeZone';
import {
    Check,
    Clock,
    DoorOpen,
    Loader2,
    Plus,
    Save,
    ShieldCheck,
    Trash2,
    UserCheck,
    X,
    AlertCircle,
    Calendar,
    AlertTriangle,
    Lock,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

interface RoomManagementPanelProps {
    period: PASPeriod;
    view: 'rooms' | 'sessions';
    onChange?: () => void;
}

export default function RoomManagementPanel({ period, view: activeTab, onChange }: RoomManagementPanelProps) {
    const { timeZone, error: timeZoneError } = useSchoolTimeZone();
    const [rooms, setRooms] = useState<PASRoom[]>([]);
    const [teachers, setTeachers] = useState<PASStaffMember[]>([]);
    const [classes, setClasses] = useState<OrganizationClass[]>([]);
    const [sessions, setSessions] = useState<PASSession[]>([]);

    // State for creating a room
    const [isCreatingRoom, setIsCreatingRoom] = useState(false);
    const [newRoomName, setNewRoomName] = useState('');
    const [newRoomCapacity, setNewRoomCapacity] = useState(30);

    // State for creating a session
    const [isCreatingSession, setIsCreatingSession] = useState(false);
    const [newSessionName, setNewSessionName] = useState('');
    const [newSessionStart, setNewSessionStart] = useState('07:30');
    const [newSessionEnd, setNewSessionEnd] = useState('09:30');

    // State for selected room to manage
    const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);

    // State for assignments in the selected room
    const [selectedProctorIds, setSelectedProctorIds] = useState<string[]>([]);
    const [selectedProctorSessionId, setSelectedProctorSessionId] = useState('');
    const selectedProctorSession = sessions.find(session => session.id === selectedProctorSessionId);
    const [quickAddProctorId, setQuickAddProctorId] = useState('');

    // Student assignment state
    const [selectedClassId, setSelectedClassId] = useState('');
    const [classStudents, setClassStudents] = useState<ClassStudent[]>([]);
    const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>([]);

    const [isLoading, setIsLoading] = useState(true);
    const [roomError, setRoomError] = useState('');
    const [isSaving, setIsSaving] = useState(false);
    const [isProctorSaved, setIsProctorSaved] = useState(false);

    const selectedRoom = useMemo(
        () => rooms.find((r) => r.id === selectedRoomId) || null,
        [rooms, selectedRoomId],
    );

    const assignedStudentIds = useMemo(
        () => new Set<string>(selectedRoom?.pas_room_students?.map((student) => student.user_id) || []),
        [selectedRoom],
    );

    const remainingCapacity = useMemo(
        () => (selectedRoom ? Math.max(0, Number(selectedRoom.capacity || 0) - assignedStudentIds.size) : 0),
        [selectedRoom, assignedStudentIds],
    );

    const newStudentCount = useMemo(
        () => [...new Set(selectedStudentIds)].filter((id) => !assignedStudentIds.has(id)).length,
        [selectedStudentIds, assignedStudentIds],
    );

    const exceedsCapacity = newStudentCount > remainingCapacity;

    // Map which teacher is assigned to which other rooms
    const teacherAssignmentMap = useMemo(() => {
        const map = new Map<string, string[]>();
        for (const r of rooms) {
            const invigilators = getRoomSessionInvigilators(r, selectedProctorSessionId);
            for (const inv of invigilators) {
                const current = map.get(inv.user_id) || [];
                map.set(inv.user_id, [...current, r.name]);
            }
        }
        return map;
    }, [rooms, selectedProctorSessionId]);

    const loadData = useCallback(async () => {
        setIsLoading(true);
        try {
            const [roomResult, teacherResult, classResult, sessionResult] = await Promise.allSettled([
                listPASRooms(period.id),
                listTeachersAndInvigilators(),
                listOrganizationClasses({ activeYearOnly: true }),
                listPASSessions(period.id),
            ]);
            if (teacherResult.status === 'fulfilled') setTeachers(teacherResult.value);
            if (classResult.status === 'fulfilled') setClasses(classResult.value);
            if (sessionResult.status === 'fulfilled') {
                setSessions(sessionResult.value);
                setSelectedProctorSessionId(previous => sessionResult.value.some(session => session.id === previous)
                    ? previous : sessionResult.value[0]?.id || '');
            }
            if (roomResult.status === 'rejected') throw roomResult.reason;
            const roomList = roomResult.value;
            setRooms(roomList);
            setRoomError([teacherResult, classResult, sessionResult].some(result => result.status === 'rejected')
                ? 'Daftar ruang sudah dimuat, tetapi sebagian data pengawas, kelas, atau sesi belum tersedia. Coba muat ulang daftar.' : '');

            // The room list opens without selecting a detail dialog.
            setSelectedRoomId((prev) => {
                if (prev && roomList.some((r) => r.id === prev)) return prev;
                return null;
            });
        } catch (error) {
            setRoomError(error instanceof Error ? error.message : 'Data ruang belum dapat dimuat.');
        } finally {
            setIsLoading(false);
        }
    }, [period.id]);

    useEffect(() => {
        if (activeTab !== 'sessions') return;
        const timer = window.setTimeout(() => setSelectedRoomId(null), 0);
        return () => window.clearTimeout(timer);
    }, [activeTab]);

    useEffect(() => {
        const initialLoad = window.setTimeout(() => void loadData(), 0);
        return () => window.clearTimeout(initialLoad);
    }, [loadData]);

    useEffect(() => {
        const timer = window.setTimeout(() => {
            setSelectedProctorIds(getRoomSessionInvigilators(selectedRoom, selectedProctorSessionId).map(inv => inv.user_id));
            setQuickAddProctorId('');
            setIsProctorSaved(false);
        }, 0);
        return () => window.clearTimeout(timer);
    }, [selectedRoom, selectedProctorSessionId]);

    const handleProctorSessionChange = (value: string) => {
        if (isSaving) return;
        setSelectedProctorSessionId(value);
        setSelectedProctorIds(getRoomSessionInvigilators(selectedRoom, value).map(inv => inv.user_id));
        setQuickAddProctorId('');
        setIsProctorSaved(false);
    };

    const handleCreateRoom = async () => {
        const name = newRoomName.trim();
        if (!name || isSaving) return;
        if (!Number.isInteger(newRoomCapacity) || newRoomCapacity < 1) {
            setRoomError('Kapasitas ruang minimal 1 kursi dan harus berupa bilangan bulat.');
            return;
        }
        setIsSaving(true);
        setRoomError('');
        try {
            const result = await createPASRoomAction(period.id, name, newRoomCapacity);
            if (!result.success) throw new Error(result.error || 'Ruang belum berhasil disimpan.');
            setNewRoomName('');
            setNewRoomCapacity(30);
            setIsCreatingRoom(false);
            if (result.id) {
                const savedRoom: PASRoom = { id: result.id, name, capacity: newRoomCapacity,
                    pas_room_invigilators: [], pas_room_students: [] };
                setRooms(previous => previous.some(room => room.id === result.id) ? previous : [...previous, savedRoom]);

            }
            onChange?.();
            try { setRooms(await listPASRooms(period.id)); }
            catch { setRoomError('Ruang sudah tersimpan, tetapi daftar terbaru belum dapat dimuat. Coba muat ulang daftar.'); }
        } catch (error) {
            setRoomError(error instanceof Error ? error.message : 'Ruang belum berhasil disimpan. Silakan coba lagi.');
        } finally {
            setIsSaving(false);
        }
    };

    const refreshRooms = async () => {
        try {
            const updated = await listPASRooms(period.id);
            setRooms(updated);
            setRoomError('');
            onChange?.();
            return updated;
        } catch (error) {
            setRoomError(error instanceof Error ? error.message : 'Daftar ruang belum dapat dimuat.');
            return rooms;
        }
    };

    const handleDeleteRoom = async (roomId: string) => {
        if (!await deleteConfirmDialog('Hapus Ruang Ujian?', 'Hapus ruang ini beserta seluruh pengaturan pengawas dan siswa di dalamnya?')) return;
        setIsSaving(true);
        const result = await deletePASRoomAction(roomId);
        if (result.success) {
            await refreshRooms();
            if (selectedRoomId === roomId) {
                setSelectedRoomId(null);
            }
        } else {
            alert(result.error);
        }
        setIsSaving(false);
    };

    const handleSaveProctors = async (idsToSave?: string[]) => {
        if (!selectedRoom || !selectedProctorSessionId || isSaving) return;
        const targetIds = idsToSave !== undefined ? idsToSave : selectedProctorIds;
        setIsSaving(true);
        setRoomError('');
        try {
            const result = await assignProctorsToRoomAction(selectedRoom.id, targetIds, selectedProctorSessionId);
            if (!result.success) throw new Error(result.error || 'Penugasan pengawas belum tersimpan.');
            await refreshRooms();
            setIsProctorSaved(true);
            setTimeout(() => setIsProctorSaved(false), 3000);
        } catch (error) {
            setRoomError(error instanceof Error ? error.message : 'Penugasan pengawas belum tersimpan.');
            setSelectedProctorIds(getRoomSessionInvigilators(selectedRoom, selectedProctorSessionId).map(inv => inv.user_id));
        } finally {
            setIsSaving(false);
        }
    };

    const handleQuickAddProctor = (teacherId: string) => {
        if (!teacherId || !selectedRoom || !selectedProctorSessionId || isSaving) return;
        if (!selectedProctorIds.includes(teacherId)) {
            const newIds = [...selectedProctorIds, teacherId];
            setSelectedProctorIds(newIds);
            void handleSaveProctors(newIds);
        }
        setQuickAddProctorId('');
    };

    const handleRemoveProctor = (proctorId: string) => {
        if (!selectedRoom || !selectedProctorSessionId || isSaving) return;
        const newIds = selectedProctorIds.filter((id) => id !== proctorId);
        setSelectedProctorIds(newIds);
        void handleSaveProctors(newIds);
    };

    const handleLoadClassStudents = async (classId: string) => {
        setSelectedClassId(classId);
        setSelectedStudentIds([]);
        if (!classId) {
            setClassStudents([]);
            return;
        }
        setIsLoading(true);
        const data = await getStudentsByClassAction(classId);
        setClassStudents(data);
        setIsLoading(false);
    };

    const handleAddStudentsToRoom = async () => {
        if (!selectedRoom || selectedStudentIds.length === 0) return;
        if (exceedsCapacity) {
            alert(`Kapasitas ruang tidak mencukupi. Tersedia ${remainingCapacity} kursi.`);
            return;
        }
        setIsSaving(true);
        const result = await assignStudentsToRoomAction(period.id, selectedRoom.id, selectedStudentIds);
        if (result.success) {
            await refreshRooms();
            setSelectedStudentIds([]);
        } else {
            alert(result.error);
        }
        setIsSaving(false);
    };

    const handleRemoveStudent = async (userId: string) => {
        if (!selectedRoom) return;
        if (!await deleteConfirmDialog({
            title: 'Keluarkan Siswa dari Ruang?',
            text: 'Penempatan siswa di ruang ujian ini akan dihapus. Akun siswa tetap tersedia.',
            confirmText: 'Ya',
            cancelText: 'Tidak',
        })) return;
        setIsSaving(true);
        const result = await removeStudentFromRoomAction(period.id, userId);
        if (result.success) {
            await refreshRooms();
        } else {
            alert(result.error);
        }
        setIsSaving(false);
    };

    const handleCreateSession = async () => {
        if (period.is_locked) return;
        if (!newSessionName.trim() || !newSessionStart || !newSessionEnd) return;
        setIsSaving(true);
        const result = await createPASSessionAction(period.id, newSessionName.trim(), newSessionStart, newSessionEnd);
        if (result.success) {
            setNewSessionName('');
            setIsCreatingSession(false);
            const sessionList = await listPASSessions(period.id);
            setSessions(sessionList);
            onChange?.();
            setSelectedProctorSessionId(previous => sessionList.some(session => session.id === previous) ? previous : sessionList[0]?.id || '');
        } else {
            alert(result.error);
        }
        setIsSaving(false);
    };

    const handleDeleteSession = async (sessionId: string) => {
        if (period.is_locked) return;
        if (!await deleteConfirmDialog('Hapus Sesi Ujian?', 'Hapus sesi ini?')) return;
        setIsSaving(true);
        const result = await deletePASSessionAction(sessionId);
        if (result.success) {
            const sessionList = await listPASSessions(period.id);
            setSessions(sessionList);
            onChange?.();
            setSelectedProctorSessionId(previous => sessionList.some(session => session.id === previous) ? previous : sessionList[0]?.id || '');
        } else {
            alert(result.error);
        }
        setIsSaving(false);
    };

    // Schedules in the period
    const allSchedules = useMemo(() => period.pas_class_schedules || [], [period.pas_class_schedules]);

    // Filter schedules for currently selected room
    const roomSchedules = useMemo(() => {
        if (!selectedRoom) return [];
        return allSchedules.filter((sc) => (sc.room || '').trim().toLowerCase() === selectedRoom.name.trim().toLowerCase());
    }, [allSchedules, selectedRoom]);

    // Available teachers for quick add in selected room
    const availableTeachersForSelectedRoom = useMemo(() => {
        return teachers.filter((t) => !selectedProctorIds.includes(t.id));
    }, [teachers, selectedProctorIds]);

    const tzLabel = getSchoolTimeZoneLabel(timeZone);

    return (
        <div className="pas-room-management pas-room-page space-y-6">
            {roomError && (
                <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">
                    <p>{roomError}</p>
                    <button type="button" className="mt-2 font-semibold underline" onClick={() => void loadData()}>Muat ulang daftar</button>
                </div>
            )}
            {timeZoneError && (
                <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700 font-medium">
                    {timeZoneError}
                </div>
            )}

            {/* ══════════════════════════════════════════════════════════
                TAB 1: RUANGAN & PENGAWAS
               ══════════════════════════════════════════════════════════ */}
            {activeTab === 'rooms' && (
                <div className="space-y-4">
                    {/* Header Section */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div>
                            <h3 className="font-bold text-slate-900 text-sm">Daftar Ruang Ujian</h3>
                            <p className="text-xs text-slate-500 mt-0.5">
                                Atur pengawas dan peserta untuk setiap ruang.
                            </p>
                        </div>
                        {!period.is_locked && (
                            <Button
                                variant="primary"
                                size="sm"
                                icon="add"
                                onClick={() => setIsCreatingRoom(!isCreatingRoom)}
                            >
                                Tambah Ruang Baru
                            </Button>
                        )}
                    </div>

                    {/* Form Tambah Ruang Baru */}
                    {!period.is_locked && isCreatingRoom && (
                        <Modal open title="Tambah Ruang" subtitle={period.name} icon="door-open"
                            onClose={() => { if (!isSaving) setIsCreatingRoom(false); }} size="lg" className="pas-room-management">
                        <ModalBody>
                        {roomError && <div role="alert" className="mb-3 text-sm text-red-600">{roomError}</div>}
                        <div className="pas-room-create grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_120px_auto] gap-3 items-end">
                            <div className="flex-1 w-full">
                                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Nama Ruang *</label>
                                <PASRoomInput
                                    value={newRoomName}
                                    onChange={setNewRoomName}
                                    onCapacityChange={setNewRoomCapacity}
                                    existingRooms={rooms}
                                />
                            </div>
                            <div className="w-full">
                                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Kapasitas</label>
                                <input
                                    type="number"
                                    min="1"
                                    value={newRoomCapacity}
                                    onChange={e => setNewRoomCapacity(parseInt(e.target.value) || 0)}
                                    className="w-full h-[40px] px-3.5 bg-white border border-slate-200 rounded-xl text-sm text-slate-800 focus:outline-none focus:border-[#3083FF] focus:ring-1 focus:ring-[#3083FF]/20"
                                />
                            </div>
                            <div className="flex gap-2 w-full sm:w-auto">
                                <Button
                                    type="button"
                                    variant="cancel"
                                    size="sm"
                                    onClick={() => setIsCreatingRoom(false)}
                                >
                                    Batal
                                </Button>
                                <Button
                                    type="button"
                                    variant="primary"
                                    size="sm"
                                    onClick={handleCreateRoom}
                                    disabled={!newRoomName.trim() || isSaving}
                                    isLoading={isSaving}
                                    leftIcon={<Save size={14} />}
                                >
                                    Simpan
                                </Button>
                            </div>
                        </div>
                        </ModalBody>
                        </Modal>
                    )}

                    {/* Daftar Ruang */}
                    {isLoading ? (
                        <div className="text-center py-10 text-slate-400 text-xs flex items-center justify-center gap-2">
                            <Loader2 size={18} className="animate-spin text-[#3083FF]" /> Memuat data ruangan...
                        </div>
                    ) : rooms.length === 0 && !roomError ? (
                        <div className="pas-room-empty text-center py-8 text-slate-500">
                            <DoorOpen size={36} className="mx-auto mb-2.5 text-slate-300" />
                            <p className="font-bold text-slate-800 text-sm">Belum ada ruang yang dibuat</p>
                            <p className="text-xs text-slate-400 mt-0.5 max-w-sm mx-auto">
                                Tambah ruang untuk mulai mengatur peserta dan pengawas.
                            </p>
                        </div>
                    ) : (
                        <div className="pas-room-list rounded-xl bg-white divide-y divide-slate-100">
                            {rooms.map((room) => (
                                <div key={room.id} className="flex items-center justify-between gap-3 px-4 py-4">
                                    <div className="min-w-0">
                                        <h4 className="font-semibold text-sm text-slate-900 break-words">{room.name}</h4>
                                        <p className="mt-1 text-xs text-slate-500">
                                            {room.capacity} kursi · {room.pas_room_students?.length || 0} siswa
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0">
                                        <Button variant="outline" size="sm" disabled={isSaving}
                                            onClick={() => setSelectedRoomId(room.id)}>
                                            Atur Ruang
                                        </Button>
                                        {!period.is_locked && (
                                            <button type="button" disabled={isSaving}
                                                onClick={() => void handleDeleteRoom(room.id)}
                                                className="p-2 text-slate-400 hover:text-red-500 rounded-lg"
                                                aria-label={`Hapus ruang ${room.name}`}>
                                                <Trash2 size={15} />
                                            </button>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* ── DETAIL RUANGAN TERPILIH ── */}
                    {selectedRoom && (
                        <Modal open onClose={() => { if (!isSaving) setSelectedRoomId(null); }} size="2xl"
                            title={selectedRoom.name} subtitle="Pengawas per sesi dan alokasi siswa" icon="door-open"
                            className="pas-room-management !max-w-5xl">
                        <ModalBody className="p-4 sm:p-6 space-y-6">
                            {roomError && <div role="alert" className="text-sm text-red-600">{roomError}</div>}
                            {/* 1. SEKSI PENGAWAS RUANGAN */}
                            <div className="pas-room-detail-section space-y-3.5">
                                <div className="flex items-center justify-between flex-wrap gap-2">
                                    <div className="flex items-center gap-2 font-bold text-slate-800 text-xs uppercase tracking-wider">
                                        <ShieldCheck size={16} className="text-[#3083FF]" />
                                        Pengawas Ruangan
                                    </div>
                                    {isProctorSaved && (
                                        <span className="text-xs font-bold text-emerald-700 flex items-center gap-1 bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-200 animate-in fade-in">
                                            <Check size={13} /> Penugasan Pengawas Disimpan
                                        </span>
                                    )}
                                </div>

                                <div className="space-y-1.5">
                                    <label className="text-xs font-semibold text-slate-700">Sesi penugasan pengawas</label>
                                    <InlineSelect
                                        value={selectedProctorSessionId}
                                        onChange={handleProctorSessionChange}
                                        disabled={isSaving || sessions.length === 0}
                                        title="Pilih Sesi Pengawas"
                                        minWidth="100%"
                                        options={sessions.map(session => ({ value: session.id,
                                            label: session.name + ' (' + session.start_time.slice(0, 5) + '–' + session.end_time.slice(0, 5) + ' ' + tzLabel + ')' }))}
                                    />
                                    <p className="text-xs text-slate-500">{sessions.length ? 'Pengawas disimpan khusus untuk sesi yang dipilih. Sesi lain dapat memiliki pengawas berbeda.' : 'Buat sesi ujian terlebih dahulu pada tab Sesi Ujian.'}</p>
                                </div>

                                {/* Daftar Pengawas Saat Ini */}
                                <div className="space-y-2">
                                    <p className="text-xs font-semibold text-slate-700">Pengawas {selectedProctorSession?.name || 'pada sesi yang dipilih'}:</p>
                                    {selectedProctorIds.length === 0 ? (
                                        <div className="p-4 bg-white rounded-xl border border-dashed border-amber-200 text-center">
                                            <AlertTriangle size={20} className="mx-auto text-amber-500 mb-1" />
                                            <p className="text-xs font-bold text-slate-700">Belum ada pengawas yang ditugaskan</p>
                                            <p className="text-[11px] text-slate-400 mt-0.5">
                                                Pilih guru/pengawas pada dropdown di bawah untuk menugaskan ke ruangan ini.
                                            </p>
                                        </div>
                                    ) : (
                                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
                                            {selectedProctorIds.map((proctorId) => {
                                                const teacher = teachers.find((t) => t.id === proctorId);
                                                const invigilatorRecord = getRoomSessionInvigilators(selectedRoom, selectedProctorSessionId).find((i) => i.user_id === proctorId);
                                                const teacherName = teacher?.name || invigilatorRecord?.profiles?.full_name || 'Pengawas';
                                                const roles = teacher?.roles || ['Pengawas'];

                                                // Check if this teacher is also assigned to other rooms
                                                const otherRooms = (teacherAssignmentMap.get(proctorId) || []).filter(
                                                    (rName) => rName.toLowerCase() !== selectedRoom.name.toLowerCase(),
                                                );

                                                return (
                                                    <div
                                                        key={proctorId}
                                                        className="flex items-center justify-between p-2.5 bg-white border border-slate-200 rounded-xl shadow-2xs hover:border-slate-300 transition-colors"
                                                    >
                                                        <div className="flex items-center gap-2 min-w-0 pr-1">
                                                            <div className="w-7 h-7 rounded-lg bg-blue-50 text-[#3083FF] flex items-center justify-center shrink-0 font-bold text-xs">
                                                                <ShieldCheck size={14} />
                                                            </div>
                                                            <div className="min-w-0">
                                                                <p className="text-xs font-bold text-slate-800 truncate" title={teacherName}>
                                                                    {teacherName}
                                                                </p>
                                                                <div className="flex items-center gap-1 flex-wrap">
                                                                    <span className="text-[10px] text-slate-400">
                                                                        {roles.join(', ')}
                                                                    </span>
                                                                    {otherRooms.length > 0 && (
                                                                        <span
                                                                            className="text-[9px] px-1 py-0.2 rounded bg-amber-50 text-amber-700 border border-amber-200 font-semibold"
                                                                            title={`Guru ini juga ditugaskan di: ${otherRooms.join(', ')}`}
                                                                        >
                                                                            Juga di: {otherRooms.join(', ')}
                                                                        </span>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        </div>
                                                        <button
                                                            type="button"
                                                            disabled={isSaving}
                                                            onClick={() => handleRemoveProctor(proctorId)}
                                                            className="p-1 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors shrink-0"
                                                            title="Hapus pengawas dari ruangan ini"
                                                        >
                                                            <X size={15} />
                                                        </button>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>

                                {/* Quick Add Pengawas Dropdown menggunakan InlineSelect */}
                                <div className="pt-2 border-t border-slate-200/80 flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
                                    <div className="flex-1">
                                        <label className="text-[11px] font-semibold text-slate-600 mb-1 block">
                                            Pilih Guru / Pengawas untuk Ditambahkan:
                                        </label>
                                        <InlineSelect
                                            disabled={!selectedProctorSessionId || isSaving}
                                            value={quickAddProctorId}
                                            onChange={handleQuickAddProctor}
                                            minWidth="100%"
                                            height="38px"
                                            title="Pilih Guru / Pengawas"
                                            options={[
                                                { value: '', label: '— Pilih Guru / Pengawas untuk Ditambahkan —' },
                                                ...availableTeachersForSelectedRoom.map((t) => {
                                                    const otherRooms = (teacherAssignmentMap.get(t.id) || []).filter(
                                                        (rName) => rName.toLowerCase() !== selectedRoom.name.toLowerCase(),
                                                    );
                                                    const conflictNotice = otherRooms.length > 0 ? ` (⚠️ Ditugaskan di: ${otherRooms.join(', ')})` : '';
                                                    return {
                                                        value: t.id,
                                                        label: `${t.name}${t.roles?.length ? ` (${t.roles.join(', ')})` : ''}${conflictNotice}`,
                                                    };
                                                }),
                                            ]}
                                        />
                                    </div>

                                    <div className="sm:self-end">
                                        <Button
                                            type="button"
                                            variant="primary"
                                            size="sm"
                                            onClick={() => void handleSaveProctors()}
                                            disabled={!selectedProctorSessionId || isSaving}
                                            isLoading={isSaving}
                                            leftIcon={<Save size={13} />}
                                        >
                                            Simpan Pengawas
                                        </Button>
                                    </div>
                                </div>
                            </div>

                            {/* 2. SEKSI JADWAL UJIAN DI RUANG INI */}
                            <div className="pas-room-detail-section space-y-3">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2 font-bold text-slate-800 text-xs uppercase tracking-wider">
                                        <Calendar size={15} className="text-[#3083FF]" />
                                        Jadwal Ujian di Ruangan Ini ({roomSchedules.length})
                                    </div>
                                    <span className="text-[11px] text-slate-500 font-medium">
                                        Diawasi oleh pengawas ruangan di atas
                                    </span>
                                </div>

                                {roomSchedules.length === 0 ? (
                                    <div className="p-4 bg-white rounded-xl border border-slate-200 text-center text-xs text-slate-400">
                                        Belum ada bank soal yang dijadwalkan di ruangan ini. Anda dapat memilih <strong>{selectedRoom.name}</strong> saat menjadwalkan bank soal.
                                    </div>
                                ) : (
                                    <div className="overflow-x-auto border border-slate-200 rounded-xl bg-white">
                                        <table className="w-full text-left text-xs border-collapse">
                                            <thead>
                                                <tr className="bg-slate-50 border-b border-slate-200 text-[10px] uppercase font-bold text-slate-500">
                                                    <th className="py-2 px-3">Tanggal & Sesi</th>
                                                    <th className="py-2 px-3">Bank Soal / Mapel</th>
                                                    <th className="py-2 px-3">Kelas</th>
                                                    <th className="py-2 px-3">Durasi</th>
                                                    <th className="py-2 px-3">Status</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-slate-100">
                                                {roomSchedules.map((sc) => {
                                                    const sessionObj = sessions.find((s) => s.id === sc.session_id);
                                                    const timeLabel = sessionObj
                                                        ? `${sessionObj.name} (${sessionObj.start_time.substring(0, 5)} - ${sessionObj.end_time.substring(0, 5)})`
                                                        : sc.scheduled_time || '-';

                                                    return (
                                                        <tr key={sc.id} className="hover:bg-slate-50/70">
                                                            <td className="py-2.5 px-3">
                                                                <div className="font-semibold text-slate-800">{sc.scheduled_date || '-'}</div>
                                                                <div className="text-[10px] text-slate-400 font-mono">{timeLabel}</div>
                                                            </td>
                                                            <td className="py-2.5 px-3">
                                                                <div className="font-bold text-slate-800">
                                                                    {sc.question_banks?.title || 'Bank Soal'}
                                                                </div>
                                                            </td>
                                                            <td className="py-2.5 px-3">
                                                                <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 text-[11px] font-semibold">
                                                                    Kelas {sc.classes?.name || 'Semua'}
                                                                </span>
                                                            </td>
                                                            <td className="py-2.5 px-3 font-medium text-slate-600">
                                                                {sc.duration_minutes || 90} mnt
                                                            </td>
                                                            <td className="py-2.5 px-3">
                                                                {sc.status === 'active' ? (
                                                                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-green-50 text-green-700 border border-green-200">
                                                                        SEDANG UJIAN
                                                                    </span>
                                                                ) : sc.exam_id ? (
                                                                    <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                                                        Siap
                                                                    </span>
                                                                ) : (
                                                                    <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                                                                        Belum Aktif
                                                                    </span>
                                                                )}
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>

                            {/* 3. SEKSI ALOKASI SISWA */}
                            <div className="pas-room-detail-section space-y-4">
                                <div className="flex items-center justify-between flex-wrap gap-2">
                                    <div className="flex items-center gap-2 font-bold text-slate-800 text-xs uppercase tracking-wider">
                                        <UserCheck size={16} className="text-[#3083FF]" />
                                        Alokasi Siswa di Ruangan Ini
                                    </div>
                                    <span className="text-xs font-semibold px-2.5 py-1 bg-white rounded-lg text-slate-600 border border-slate-200 shadow-2xs">
                                        Terisi: <strong className="text-slate-900">{assignedStudentIds.size}</strong> / {selectedRoom.capacity} · Sisa <strong className={remainingCapacity === 0 ? 'text-red-600' : 'text-emerald-600'}>{remainingCapacity}</strong> kursi
                                    </span>
                                </div>

                                {/* Pilih Siswa per Kelas */}
                                <div className="bg-white p-3.5 rounded-xl border border-slate-200 space-y-3">
                                    <p className="text-xs font-semibold text-slate-700">Tambah Siswa dari Kelas:</p>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                                        <InlineSelect
                                            value={selectedClassId}
                                            onChange={(val) => void handleLoadClassStudents(val)}
                                            minWidth="100%"
                                            height="40px"
                                            title="Pilih Kelas Asal"
                                            options={[
                                                { value: '', label: '— Pilih Kelas Asal —' },
                                                ...classes.map((c) => ({ value: c.id, label: `Kelas ${c.name}` })),
                                            ]}
                                        />
                                        {selectedClassId && (
                                            <MultiSelect
                                                options={classStudents.map((s) => ({
                                                    value: s.id,
                                                    label: formatStudentName(s.name, 'Tanpa Nama'),
                                                }))}
                                                value={selectedStudentIds}
                                                onChange={setSelectedStudentIds}
                                                placeholder="— Pilih Siswa —"
                                                allSelectedText="Semua Siswa Terpilih"
                                                height="40px"
                                                minWidth="100%"
                                                showQuickActions={true}
                                            />
                                        )}
                                    </div>

                                    {selectedClassId && selectedStudentIds.length > 0 && (
                                        <div className="flex items-center justify-between pt-1 flex-wrap gap-2">
                                            {exceedsCapacity ? (
                                                <span className="text-xs text-red-600 font-semibold flex items-center gap-1">
                                                    <AlertCircle size={13} /> Pilihan melebihi sisa kapasitas ({remainingCapacity} kursi tersisa).
                                                </span>
                                            ) : (
                                                <span className="text-xs text-slate-500 font-medium">
                                                    {selectedStudentIds.length} siswa siap dimasukkan ke ruangan ini.
                                                </span>
                                            )}
                                            <Button
                                                type="button"
                                                variant="primary"
                                                size="sm"
                                                onClick={handleAddStudentsToRoom}
                                                disabled={selectedStudentIds.length === 0 || exceedsCapacity || isSaving}
                                                isLoading={isSaving}
                                                leftIcon={<Plus size={13} />}
                                            >
                                                Tambahkan ({selectedStudentIds.length}) Siswa
                                            </Button>
                                        </div>
                                    )}
                                </div>

                                {/* Daftar Siswa yang Telah Masuk Ruangan */}
                                <div className="max-h-52 overflow-y-auto border border-slate-200 rounded-xl bg-white divide-y divide-slate-100">
                                    {(!selectedRoom.pas_room_students || selectedRoom.pas_room_students.length === 0) ? (
                                        <div className="text-xs text-slate-400 p-6 text-center">
                                            Belum ada siswa yang dialokasikan ke ruangan ini.
                                        </div>
                                    ) : (
                                        selectedRoom.pas_room_students.map((student, idx) => (
                                            <div key={student.user_id} className="flex items-center justify-between px-3.5 py-2 hover:bg-slate-50/80 transition-colors">
                                                <div className="flex items-center gap-2.5 text-xs text-slate-700">
                                                    <span className="text-[10px] text-slate-400 font-bold w-5">{idx + 1}.</span>
                                                    <span className="font-semibold">{formatStudentName(student.profiles?.full_name, 'Tanpa Nama')}</span>
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() => void handleRemoveStudent(student.user_id)}
                                                    className="text-slate-300 hover:text-red-500 p-1 rounded-lg hover:bg-red-50 transition-colors"
                                                    title="Keluarkan siswa dari ruang"
                                                >
                                                    <X size={14} />
                                                </button>
                                            </div>
                                        ))
                                    )}
                                </div>
                            </div>
                        </ModalBody>
                        <ModalFooter>
                            <Button variant="outline" disabled={isSaving} onClick={() => setSelectedRoomId(null)}>Selesai</Button>
                        </ModalFooter>
                        </Modal>
                    )}
                </div>
            )}

            {/* ══════════════════════════════════════════════════════════
                TAB 2: SESI UJIAN
               ══════════════════════════════════════════════════════════ */}
            {activeTab === 'sessions' && (
                <div className="space-y-6">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div>
                            <h3 className="font-bold text-slate-900 text-sm">Daftar Sesi Ujian</h3>
                            <p className="text-xs text-slate-500 mt-0.5">
                                Atur slot waktu pelaksanaan ujian dalam folder ini.
                            </p>
                        </div>
                        {period.is_locked ? (
                            <span className="text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-3 py-1.5 rounded-xl flex items-center gap-1.5">
                                <Lock size={13} /> Periode terkunci
                            </span>
                        ) : (
                            !period.is_locked && (
                                <Button
                                    variant="primary"
                                    size="sm"
                                    icon="add"
                                    onClick={() => setIsCreatingSession(!isCreatingSession)}
                                >
                                    Tambah Sesi Baru
                                </Button>
                            )
                        )}
                    </div>

                    {/* Form Tambah Sesi */}
                    {!period.is_locked && isCreatingSession && (
                        <div className="p-4 bg-slate-50/90 border border-slate-200 rounded-2xl grid grid-cols-1 sm:grid-cols-4 gap-3 items-end shadow-2xs">
                            <div className="sm:col-span-2">
                                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Nama Sesi *</label>
                                <input
                                    type="text"
                                    value={newSessionName}
                                    onChange={e => setNewSessionName(e.target.value)}
                                    placeholder="Misal: Sesi 1, Sesi Pagi"
                                    className="w-full h-[40px] px-3.5 bg-white border border-slate-200 rounded-xl text-sm text-slate-800 focus:outline-none focus:border-[#3083FF] focus:ring-1 focus:ring-[#3083FF]/20"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Jam Mulai ({tzLabel}) *</label>
                                <input
                                    type="time"
                                    value={newSessionStart}
                                    onChange={e => setNewSessionStart(e.target.value)}
                                    className="w-full h-[40px] px-3 bg-white border border-slate-200 rounded-xl text-sm text-slate-800 focus:outline-none focus:border-[#3083FF] focus:ring-1 focus:ring-[#3083FF]/20"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Jam Selesai ({tzLabel}) *</label>
                                <input
                                    type="time"
                                    value={newSessionEnd}
                                    onChange={e => setNewSessionEnd(e.target.value)}
                                    className="w-full h-[40px] px-3 bg-white border border-slate-200 rounded-xl text-sm text-slate-800 focus:outline-none focus:border-[#3083FF] focus:ring-1 focus:ring-[#3083FF]/20"
                                />
                            </div>
                            <div className="sm:col-span-4 flex justify-end gap-2 mt-1">
                                <Button
                                    type="button"
                                    variant="cancel"
                                    size="sm"
                                    onClick={() => setIsCreatingSession(false)}
                                >
                                    Batal
                                </Button>
                                <Button
                                    type="button"
                                    variant="primary"
                                    size="sm"
                                    onClick={handleCreateSession}
                                    disabled={!newSessionName.trim() || isSaving}
                                    isLoading={isSaving}
                                    leftIcon={<Save size={13} />}
                                >
                                    Simpan Sesi
                                </Button>
                            </div>
                        </div>
                    )}

                    {/* Daftar Sesi */}
                    {isLoading ? (
                        <div className="text-center py-10 text-slate-400 text-xs flex items-center justify-center gap-2">
                            <Loader2 size={18} className="animate-spin text-[#3083FF]" /> Memuat data sesi...
                        </div>
                    ) : sessions.length === 0 ? (
                        <div className="text-center py-12 bg-slate-50 border border-dashed border-slate-200 rounded-2xl p-6">
                            <Clock size={36} className="mx-auto mb-2 text-slate-300" />
                            <p className="font-bold text-slate-800 text-sm">Belum ada sesi yang dibuat</p>
                            <p className="text-xs text-slate-400 mt-0.5">
                                Silakan tambah sesi ujian untuk digunakan saat penjadwalan kelas.
                            </p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3.5">
                            {sessions.map((session) => {
                                const sessionSchedules = allSchedules.filter((s) => s.session_id === session.id);
                                const isSessionInUse = sessionSchedules.length > 0;

                                // Find active rooms and invigilators in this session
                                const activeRooms = [...new Set(sessionSchedules.map((s) => s.room).filter(Boolean))];
                                const onDutyProctors = new Set<string>();
                                for (const rName of activeRooms) {
                                    const r = rooms.find((room) => room.name.toLowerCase() === (rName || '').toLowerCase());
                                    if (r?.pas_room_invigilators) {
                                        for (const inv of r.pas_room_invigilators) {
                                            if (inv.session_id === session.id && inv.profiles?.full_name) onDutyProctors.add(inv.profiles.full_name);
                                        }
                                    }
                                }

                                return (
                                    <div
                                        key={session.id}
                                        className="p-4 rounded-2xl border border-slate-200 bg-white hover:border-slate-300 transition-all flex flex-col justify-between shadow-2xs group"
                                    >
                                        <div>
                                            <div className="flex items-start justify-between">
                                                <div className="flex items-center gap-2.5">
                                                    <div className="w-9 h-9 rounded-xl bg-blue-50 flex items-center justify-center text-[#3083FF]">
                                                        <Clock size={16} />
                                                    </div>
                                                    <div>
                                                        <div className="font-bold text-slate-900 text-sm">{session.name}</div>
                                                        <div className="text-xs text-slate-500 font-mono font-medium">
                                                            {session.start_time.substring(0, 5)} - {session.end_time.substring(0, 5)} {tzLabel}
                                                        </div>
                                                    </div>
                                                </div>
                                                {!period.is_locked && (
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            if (isSessionInUse) {
                                                                alert(`Sesi tidak dapat dihapus karena masih digunakan oleh ${sessionSchedules.length} jadwal.`);
                                                                return;
                                                            }
                                                            void handleDeleteSession(session.id);
                                                        }}
                                                        disabled={isSessionInUse}
                                                        className={`p-1.5 rounded-lg transition-colors ${
                                                            isSessionInUse
                                                                ? 'text-slate-300 cursor-not-allowed opacity-50'
                                                                : 'text-slate-400 hover:text-red-500 hover:bg-red-50'
                                                        }`}
                                                        title={isSessionInUse ? `Dipakai ${sessionSchedules.length} jadwal` : 'Hapus Sesi'}
                                                    >
                                                        <Trash2 size={14} />
                                                    </button>
                                                )}
                                            </div>

                                            {/* Pengawas & Jadwal di Sesi Ini */}
                                            <div className="mt-3 pt-2.5 border-t border-slate-100 space-y-1.5">
                                                <div className="flex items-center justify-between text-[11px]">
                                                    <span className="text-slate-500 font-medium">Jadwal Kelas:</span>
                                                    <span className={`font-bold ${isSessionInUse ? 'text-[#3083FF]' : 'text-slate-400'}`}>
                                                        {sessionSchedules.length} Jadwal
                                                    </span>
                                                </div>

                                                {isSessionInUse && (
                                                    <div className="text-[10px] text-slate-600 bg-slate-50 p-2 rounded-lg border border-slate-100 space-y-1">
                                                        <div>
                                                            <strong className="text-slate-700">Ruangan: </strong>
                                                            {activeRooms.length > 0 ? activeRooms.join(', ') : 'Belum diatur'}
                                                        </div>
                                                        {onDutyProctors.size > 0 && (
                                                            <div className="text-emerald-700 font-medium">
                                                                <strong>Pengawas: </strong>
                                                                {Array.from(onDutyProctors).join(', ')}
                                                            </div>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        </div>

                                        <div className="mt-3 pt-2 border-t border-slate-100 flex items-center justify-between">
                                            {isSessionInUse ? (
                                                <span className="text-[10px] font-bold text-[#3083FF] bg-blue-50 px-2 py-0.5 rounded-md border border-blue-200">
                                                    Aktif ({sessionSchedules.length} jadwal)
                                                </span>
                                            ) : (
                                                <span className="text-[10px] font-medium text-slate-400">
                                                    Belum ada jadwal
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}

        </div>
    );
}
