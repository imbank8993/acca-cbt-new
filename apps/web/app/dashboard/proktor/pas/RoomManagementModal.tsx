"use client";
import '@/app/components/pas-room-management.css';
import { PASScheduleStatus } from '@/app/components/PASScheduleStatus';

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
import { Button } from '@/app/components/ui/button';
import { formatStudentName } from '@/lib/monitoring-health';
import { getSchoolTimeZoneLabel } from '@/lib/school-time';
import { useSchoolTimeZone } from '@/lib/useSchoolTimeZone';
import {
    Check,
    Clock,
    DoorOpen,
    Loader2,
    Save,
    ShieldCheck,
    Trash2,
    X,
    Calendar,
    AlertTriangle,
    Lock,
    Search,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

interface RoomManagementPanelProps {
    period: PASPeriod;
    view: 'rooms' | 'sessions' | 'invigilators';
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
    const [sessionError, setSessionError] = useState('');

    // State for selected room to manage (Peserta & Jadwal)
    const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
    const [roomDetailTab, setRoomDetailTab] = useState<'students' | 'schedules'>('students');
    const [addingStudents, setAddingStudents] = useState(false);
    const [studentSearch, setStudentSearch] = useState('');
    const [isClassLoading, setIsClassLoading] = useState(false);
    const classRequest = useRef(0);

    // State for invigilator mapping tab (by session & room)
    const [selectedProctorSessionId, setSelectedProctorSessionId] = useState('');
    const selectedProctorSession = sessions.find(session => session.id === selectedProctorSessionId);
    const [savingProctorRoomId, setSavingProctorRoomId] = useState<string | null>(null);
    const [savedProctorRoomId, setSavedProctorRoomId] = useState<string | null>(null);

    // Student assignment state
    const [selectedClassId, setSelectedClassId] = useState('');
    const [classStudents, setClassStudents] = useState<ClassStudent[]>([]);
    const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>([]);

    const [isLoading, setIsLoading] = useState(true);
    const [roomError, setRoomError] = useState('');
    const [isSaving, setIsSaving] = useState(false);

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
    const studentRoomMap = useMemo(() => new Map(rooms.flatMap(room =>
        (room.pas_room_students || []).map(student => [student.user_id, room] as const))), [rooms]);
    const visibleClassStudents = classStudents.filter(student =>
        `${student.name || student.full_name || ''} ${student.identity_number || ''}`.toLocaleLowerCase('id-ID').includes(studentSearch.toLocaleLowerCase('id-ID')));
    const selectableStudents = visibleClassStudents.filter(student => !assignedStudentIds.has(student.id));
    const visibleRoomStudents = (selectedRoom?.pas_room_students || []).filter(student =>
        formatStudentName(student.profiles?.full_name, 'Tanpa Nama').toLocaleLowerCase('id-ID').includes(studentSearch.toLocaleLowerCase('id-ID')));

    const openRoom = (roomId: string) => {
        classRequest.current++;
        setSelectedRoomId(roomId);
        setRoomDetailTab('students');
        setAddingStudents(false);
        setStudentSearch('');
        setSelectedClassId('');
        setClassStudents([]);
        setSelectedStudentIds([]);
        setIsClassLoading(false);
    };

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
        if (activeTab === 'rooms') return;
        const timer = window.setTimeout(() => setSelectedRoomId(null), 0);
        return () => window.clearTimeout(timer);
    }, [activeTab]);

    useEffect(() => {
        const initialLoad = window.setTimeout(() => void loadData(), 0);
        return () => window.clearTimeout(initialLoad);
    }, [loadData]);

    const handleProctorSessionChange = (value: string) => {
        if (isSaving) return;
        setSelectedProctorSessionId(value);
        setSavedProctorRoomId(null);
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

    const handleSaveRoomProctors = async (roomId: string, targetIds: string[]) => {
        if (!selectedProctorSessionId || isSaving) return;
        setIsSaving(true);
        setSavingProctorRoomId(roomId);
        setRoomError('');
        try {
            const result = await assignProctorsToRoomAction(roomId, targetIds, selectedProctorSessionId);
            if (!result.success) throw new Error(result.error || 'Penugasan pengawas belum tersimpan.');
            await refreshRooms();
            setSavedProctorRoomId(roomId);
            setTimeout(() => {
                setSavedProctorRoomId((prev) => (prev === roomId ? null : prev));
            }, 3000);
        } catch (error) {
            setRoomError(error instanceof Error ? error.message : 'Penugasan pengawas belum tersimpan.');
        } finally {
            setIsSaving(false);
            setSavingProctorRoomId(null);
        }
    };

    const handleAddRoomProctor = (room: PASRoom, teacherId: string) => {
        if (!teacherId || !selectedProctorSessionId || isSaving) return;
        const currentIds = getRoomSessionInvigilators(room, selectedProctorSessionId).map((inv) => inv.user_id);
        if (!currentIds.includes(teacherId)) {
            void handleSaveRoomProctors(room.id, [...currentIds, teacherId]);
        }
    };

    const handleRemoveRoomProctor = (room: PASRoom, proctorId: string) => {
        if (!selectedProctorSessionId || isSaving) return;
        const currentIds = getRoomSessionInvigilators(room, selectedProctorSessionId).map((inv) => inv.user_id);
        void handleSaveRoomProctors(
            room.id,
            currentIds.filter((id) => id !== proctorId),
        );
    };

    const handleLoadClassStudents = async (classId: string) => {
        const request = ++classRequest.current;
        setSelectedClassId(classId);
        setSelectedStudentIds([]);
        setClassStudents([]);
        setStudentSearch('');
        if (!classId) {
            setIsClassLoading(false);
            return;
        }
        setIsClassLoading(true);
        try {
            const data = await getStudentsByClassAction(classId);
            if (request === classRequest.current) setClassStudents(data);
        } catch (error) {
            if (request === classRequest.current) setRoomError(error instanceof Error ? error.message : 'Daftar peserta belum dapat dimuat.');
        } finally {
            if (request === classRequest.current) setIsClassLoading(false);
        }
    };

    const handleAddStudentsToRoom = async () => {
        if (!selectedRoom || selectedStudentIds.length === 0 || isSaving || isClassLoading) return;
        if (exceedsCapacity) {
            alert(`Kapasitas ruang tidak mencukupi. Tersedia ${remainingCapacity} kursi.`);
            return;
        }
        setIsSaving(true);
        setRoomError('');
        try {
            const result = await assignStudentsToRoomAction(period.id, selectedRoom.id, selectedStudentIds);
            if (!result.success) throw new Error(result.error || 'Peserta belum berhasil ditambahkan.');
            await refreshRooms();
            setSelectedStudentIds([]);
            setAddingStudents(false);
            setStudentSearch('');
        } catch (error) {
            setRoomError(error instanceof Error ? error.message : 'Peserta belum berhasil ditambahkan.');
        } finally { setIsSaving(false); }
    };

    const handleRemoveStudent = async (userId: string) => {
        if (!selectedRoom || isSaving) return;
        if (!await deleteConfirmDialog({
            title: 'Keluarkan Siswa dari Ruang?',
            text: 'Penempatan siswa di ruang ujian ini akan dihapus. Akun siswa tetap tersedia.',
            confirmText: 'Ya',
            cancelText: 'Tidak',
        })) return;
        setIsSaving(true);
        try {
            const result = await removeStudentFromRoomAction(period.id, userId);
            if (!result.success) throw new Error(result.error || 'Peserta belum berhasil dikeluarkan.');
            await refreshRooms();
        } catch (error) {
            setRoomError(error instanceof Error ? error.message : 'Peserta belum berhasil dikeluarkan.');
        } finally { setIsSaving(false); }
    };

    const handleCreateSession = async () => {
        if (period.is_locked) return;
        if (!newSessionName.trim() || !newSessionStart || !newSessionEnd || isSaving) return;
        if (newSessionEnd <= newSessionStart) {
            setSessionError('Jam selesai harus setelah jam mulai.');
            return;
        }
        setIsSaving(true);
        setSessionError('');
        try {
            const result = await createPASSessionAction(period.id, newSessionName.trim(), newSessionStart, newSessionEnd);
            if (!result.success) throw new Error(result.error || 'Sesi belum berhasil disimpan.');
            setNewSessionName('');
            setIsCreatingSession(false);
            onChange?.();
            try {
                const sessionList = await listPASSessions(period.id);
                setSessions(sessionList);
                setSelectedProctorSessionId(previous => sessionList.some(session => session.id === previous) ? previous : sessionList[0]?.id || '');
            } catch { setRoomError('Sesi sudah tersimpan, tetapi daftar terbaru belum dapat dimuat. Muat ulang daftar.'); }
        } catch (error) {
            setSessionError(error instanceof Error ? error.message : 'Sesi belum berhasil disimpan.');
        } finally { setIsSaving(false); }
    };

    const handleDeleteSession = async (sessionId: string) => {
        if (period.is_locked) return;
        if (isSaving) return;
        if (!await deleteConfirmDialog('Hapus Sesi Ujian?', 'Hapus sesi ini?')) return;
        setIsSaving(true);
        try {
            const result = await deletePASSessionAction(sessionId);
            if (!result.success) throw new Error(result.error || 'Sesi belum berhasil dihapus.');
            setSessions(previous => previous.filter(session => session.id !== sessionId));
            onChange?.();
            const sessionList = await listPASSessions(period.id);
            setSessions(sessionList);
            setSelectedProctorSessionId(previous => sessionList.some(session => session.id === previous) ? previous : sessionList[0]?.id || '');
        } catch (error) {
            setRoomError(error instanceof Error ? error.message : 'Daftar sesi belum dapat diperbarui.');
        } finally { setIsSaving(false); }
    };

    // Schedules in the period
    const allSchedules = useMemo(() => period.pas_class_schedules || [], [period.pas_class_schedules]);

    // Filter schedules for currently selected room
    const roomSchedules = useMemo(() => {
        if (!selectedRoom) return [];
        return allSchedules.filter((sc) => (sc.room || '').trim().toLowerCase() === selectedRoom.name.trim().toLowerCase());
    }, [allSchedules, selectedRoom]);

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
                TAB 1: RUANGAN & PESERTA
               ══════════════════════════════════════════════════════════ */}
            {activeTab === 'rooms' && (
                <div className="space-y-4">
                    {/* Header Section */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div>
                            <h3 className="font-bold text-slate-900 text-sm">Daftar Ruang Ujian</h3>
                            <p className="text-xs text-slate-500 mt-0.5">
                                Atur kapasitas dan penempatan peserta untuk setiap ruang ujian.
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
                            onClose={() => { if (!isSaving) setIsCreatingRoom(false); }} size="md" className="pas-room-management">
                            <ModalBody className="space-y-4 p-4 sm:p-6">
                                {roomError && <div role="alert" className="text-sm text-red-600">{roomError}</div>}
                                <div className="pas-room-create space-y-4">
                                    <div>
                                        <label className="mb-1.5 block text-sm font-medium text-slate-700">Nama Ruang *</label>
                                        <PASRoomInput
                                            value={newRoomName}
                                            onChange={setNewRoomName}
                                            onCapacityChange={setNewRoomCapacity}
                                            existingRooms={rooms}
                                        />
                                    </div>
                                    <div>
                                        <label htmlFor="pas-room-capacity" className="mb-1.5 block text-sm font-medium text-slate-700">Kapasitas (Kursi)</label>
                                        <input
                                            id="pas-room-capacity"
                                            type="number"
                                            min="1"
                                            disabled={isSaving}
                                            value={newRoomCapacity}
                                            onChange={e => setNewRoomCapacity(parseInt(e.target.value) || 0)}
                                            className="w-full h-[40px] px-3.5 bg-white border border-slate-200 rounded-xl text-sm text-slate-800 focus:outline-none focus:border-[#3083FF] focus:ring-1 focus:ring-[#3083FF]/20"
                                        />
                                        <p className="mt-1.5 text-xs text-slate-500">Pilih ruang dari daftar master untuk mengisi kapasitas otomatis, atau atur jumlah kursi secara manual.</p>
                                    </div>
                                </div>
                            </ModalBody>
                            <ModalFooter>
                                <Button
                                    type="button"
                                    variant="cancel"
                                    size="sm"
                                    disabled={isSaving}
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
                            </ModalFooter>
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
                                Tambah ruang untuk mulai mengatur penempatan peserta ujian.
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
                                            onClick={() => openRoom(room.id)}>
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

                    {/* ── DETAIL RUANGAN TERPILIH (PESERTA & JADWAL SAJA) ── */}
                    {selectedRoom && (
                        <Modal open onClose={() => { if (!isSaving) setSelectedRoomId(null); }} size="2xl"
                            title={selectedRoom.name} subtitle={`${assignedStudentIds.size} dari ${selectedRoom.capacity} kursi terisi · ${remainingCapacity} kursi tersedia`} icon="door-open"
                            className="pas-room-management pas-room-detail-modal !max-w-3xl">
                        <div className="pas-room-detail-tabs flex gap-1 px-4 sm:px-6 pt-3" role="tablist" aria-label="Pengaturan ruang">
                            {([{ id: 'students', label: 'Peserta' }, { id: 'schedules', label: 'Jadwal' }] as const).map(tab => (
                                <button key={tab.id} type="button" role="tab" aria-selected={roomDetailTab === tab.id}
                                    id={`room-tab-${tab.id}`} aria-controls={`room-panel-${tab.id}`} disabled={isSaving}
                                    onClick={() => setRoomDetailTab(tab.id)}
                                    className={`px-4 py-2.5 text-sm font-semibold rounded-lg ${roomDetailTab === tab.id ? 'bg-blue-50 text-blue-600' : 'text-slate-500 hover:bg-slate-50'}`}>
                                    {tab.label}
                                </button>
                            ))}
                        </div>
                        <ModalBody className="p-4 sm:p-6">
                            {roomError && <div role="alert" className="text-sm text-red-600">{roomError}</div>}

                            {/* SEKSI JADWAL UJIAN DI RUANG INI */}
                            {roomDetailTab === 'schedules' && <div role="tabpanel" id="room-panel-schedules" aria-labelledby="room-tab-schedules" className="space-y-3">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2 font-bold text-slate-800 text-xs uppercase tracking-wider">
                                        <Calendar size={15} className="text-[#3083FF]" />
                                        Jadwal Ujian di Ruangan Ini ({roomSchedules.length})
                                    </div>
                                    <span className="text-[11px] text-slate-500 font-medium">
                                        Pengawas diatur pada tab Pengawas
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
                                                                <PASScheduleStatus schedule={sc} />
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>}

                            {roomDetailTab === 'students' && <div role="tabpanel" id="room-panel-students" aria-labelledby="room-tab-students" className="space-y-4">
                                <div className="flex items-center justify-between gap-3">
                                    <h3 className="text-sm font-semibold text-slate-900">{addingStudents ? 'Tambah peserta' : `Peserta ruangan (${assignedStudentIds.size})`}</h3>
                                    <Button variant={addingStudents ? 'outline' : 'primary'} size="sm" disabled={isSaving}
                                        onClick={() => { setAddingStudents(!addingStudents); setStudentSearch(''); setSelectedStudentIds([]); }}>
                                        {addingStudents ? 'Kembali ke daftar' : 'Tambah Peserta'}
                                    </Button>
                                </div>

                                {addingStudents && <div className="space-y-3">
                                    <InlineSelect value={selectedClassId} disabled={isSaving} onChange={val => void handleLoadClassStudents(val)}
                                        minWidth="100%" height="40px" title="Kelas asal peserta"
                                        options={[{ value: '', label: 'Pilih kelas asal' }, ...classes.map(c => ({ value: c.id, label: c.name.replace(/^kelas\s+/i, '') }))]} />
                                    <p className="text-xs text-slate-500">Centang peserta yang akan ditempatkan di ruangan ini. Peserta dari ruang lain akan dipindahkan.</p>
                                </div>}

                                {(!addingStudents || selectedClassId) && <label className="pas-room-search flex items-center gap-2 rounded-lg px-3 py-2.5">
                                    <Search size={16} className="shrink-0 text-slate-400" />
                                    <input type="search" value={studentSearch} onChange={e => setStudentSearch(e.target.value)}
                                        aria-label={addingStudents ? 'Cari peserta dari kelas' : 'Cari peserta ruangan'} placeholder="Cari nama peserta..."
                                        className="min-w-0 flex-1 bg-transparent text-sm outline-none" />
                                </label>}

                                {addingStudents ? <>
                                    {isClassLoading ? <p role="status" className="py-8 text-center text-sm text-slate-500">Memuat peserta...</p>
                                    : !selectedClassId ? <p className="py-8 text-center text-sm text-slate-500">Pilih kelas untuk melihat peserta.</p>
                                    : <>
                                        {selectableStudents.length > 0 && <label className="flex items-center gap-3 px-2 text-sm text-slate-600">
                                            <input type="checkbox" disabled={isSaving}
                                                checked={selectableStudents.every(student => selectedStudentIds.includes(student.id))}
                                                onChange={e => setSelectedStudentIds(previous => e.target.checked
                                                    ? [...new Set([...previous, ...selectableStudents.map(student => student.id)])]
                                                    : previous.filter(id => !selectableStudents.some(student => student.id === id)))} />
                                            Pilih semua hasil ({selectableStudents.length})
                                        </label>}
                                        <div className="pas-room-student-list max-h-72 overflow-y-auto divide-y divide-slate-100">
                                            {visibleClassStudents.length === 0 && <p className="py-8 text-center text-sm text-slate-500">Tidak ada peserta yang cocok.</p>}
                                            {visibleClassStudents.map(student => {
                                                const alreadyHere = assignedStudentIds.has(student.id);
                                                const previousRoom = studentRoomMap.get(student.id);
                                                return <label key={student.id} className="flex items-center gap-3 px-2 py-3 text-sm">
                                                    <input type="checkbox" disabled={isSaving || alreadyHere} checked={alreadyHere || selectedStudentIds.includes(student.id)}
                                                        onChange={e => setSelectedStudentIds(previous => e.target.checked ? [...new Set([...previous, student.id])] : previous.filter(id => id !== student.id))} />
                                                    <span className="min-w-0 flex-1">
                                                        <span className="block font-medium text-slate-800">{formatStudentName(student.name || student.full_name, 'Tanpa Nama')}</span>
                                                        {(student.identity_number || previousRoom) && <span className="mt-0.5 block text-xs text-slate-500">
                                                            {[student.identity_number, alreadyHere ? 'Sudah di ruangan ini' : previousRoom ? `Dari ${previousRoom.name}` : ''].filter(Boolean).join(' · ')}
                                                        </span>}
                                                    </span>
                                                </label>;
                                            })}
                                        </div>
                                    </>}
                                    <div className="pas-room-add-footer flex flex-wrap items-center justify-between gap-3 pt-3">
                                        <p className={`text-xs ${exceedsCapacity ? 'text-red-600' : 'text-slate-500'}`} role={exceedsCapacity ? 'alert' : 'status'}>
                                            {exceedsCapacity ? `Pilihan melebihi sisa kapasitas (${remainingCapacity} kursi).` : `${selectedStudentIds.length} dipilih · ${remainingCapacity} kursi tersedia`}
                                        </p>
                                        <Button variant="primary" size="sm" onClick={() => void handleAddStudentsToRoom()}
                                            disabled={selectedStudentIds.length === 0 || exceedsCapacity || isSaving} isLoading={isSaving}>
                                            Tambahkan Peserta{selectedStudentIds.length > 0 ? ` (${selectedStudentIds.length})` : ''}
                                        </Button>
                                    </div>
                                </> : <div className="pas-room-student-list max-h-96 overflow-y-auto divide-y divide-slate-100">
                                    {visibleRoomStudents.length === 0 && <p className="py-10 text-center text-sm text-slate-500">
                                        {assignedStudentIds.size ? 'Tidak ada peserta yang cocok.' : 'Belum ada peserta. Pilih Tambah Peserta untuk mengisi ruangan.'}
                                    </p>}
                                    {visibleRoomStudents.map((student, idx) => <div key={student.user_id} className="flex items-center gap-3 py-3 px-2 text-sm">
                                        <span className="w-6 shrink-0 text-xs text-slate-400">{idx + 1}</span>
                                        <span className="min-w-0 flex-1 font-medium text-slate-800">{formatStudentName(student.profiles?.full_name, 'Tanpa Nama')}</span>
                                        <button type="button" disabled={isSaving} onClick={() => void handleRemoveStudent(student.user_id)}
                                            className="shrink-0 rounded-lg px-2 py-1.5 text-xs text-slate-500 hover:text-red-600 disabled:opacity-50"
                                            aria-label={`Keluarkan ${formatStudentName(student.profiles?.full_name, 'peserta')} dari ruang`}>Keluarkan</button>
                                    </div>)}
                                </div>}
                            </div>}
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
                <div className="space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                            <h3 className="font-semibold text-sm text-slate-900">Sesi Ujian ({sessions.length})</h3>
                            <p className="mt-1 text-xs text-slate-500">Jam pelaksanaan dalam zona waktu {tzLabel}.</p>
                        </div>
                        {period.is_locked ? <span className="flex items-center gap-1.5 text-xs text-slate-500"><Lock size={13} /> Periode terkunci</span>
                        : !period.is_locked && (
                            <Button variant="primary" size="sm" icon="add" disabled={isSaving}
                                onClick={() => { setSessionError(''); setIsCreatingSession(true); }}>
                                Tambah Sesi
                            </Button>
                        )}
                    </div>

                    {!period.is_locked && isCreatingSession && (
                        <Modal open title="Tambah Sesi Ujian" subtitle={`Jam pelaksanaan (${tzLabel})`} icon="clock" size="sm"
                            className="pas-room-management" onClose={() => { if (!isSaving) setIsCreatingSession(false); }}>
                            <ModalBody className="space-y-4 p-4 sm:p-6">
                                {sessionError && <p role="alert" className="text-sm text-red-600">{sessionError}</p>}
                                <div>
                                    <label htmlFor="pas-session-name" className="mb-1.5 block text-sm font-medium text-slate-700">Nama sesi</label>
                                    <input id="pas-session-name" type="text" value={newSessionName} disabled={isSaving}
                                        onChange={e => setNewSessionName(e.target.value)} placeholder="Contoh: Sesi 1"
                                        className="pas-session-input w-full rounded-lg px-3 py-2.5 text-sm" />
                                </div>
                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label htmlFor="pas-session-start" className="mb-1.5 block text-sm font-medium text-slate-700">Jam mulai</label>
                                        <input id="pas-session-start" type="time" value={newSessionStart} disabled={isSaving}
                                            onChange={e => setNewSessionStart(e.target.value)}
                                            className="pas-session-input w-full min-w-0 rounded-lg px-3 py-2.5 text-sm" />
                                    </div>
                                    <div>
                                        <label htmlFor="pas-session-end" className="mb-1.5 block text-sm font-medium text-slate-700">Jam selesai</label>
                                        <input id="pas-session-end" type="time" value={newSessionEnd} disabled={isSaving}
                                            onChange={e => setNewSessionEnd(e.target.value)}
                                            className="pas-session-input w-full min-w-0 rounded-lg px-3 py-2.5 text-sm" />
                                    </div>
                                </div>
                                <p className="text-xs text-slate-500">Tanggal ujian ditentukan saat menjadwalkan bank soal, sesuai periode folder.</p>
                            </ModalBody>
                            <ModalFooter>
                                <Button variant="outline" size="sm" disabled={isSaving} onClick={() => setIsCreatingSession(false)}>Batal</Button>
                                <Button variant="primary" size="sm" onClick={() => void handleCreateSession()}
                                    disabled={!newSessionName.trim() || !newSessionStart || !newSessionEnd || isSaving} isLoading={isSaving}>Simpan Sesi</Button>
                            </ModalFooter>
                        </Modal>
                    )}

                    {isLoading ? <p role="status" className="py-10 text-center text-sm text-slate-500">Memuat sesi ujian...</p>
                    : sessions.length === 0 ? <div className="pas-session-empty rounded-xl py-10 px-4 text-center">
                        <Clock size={28} className="mx-auto mb-3 text-slate-400" />
                        <p className="text-sm font-semibold text-slate-800">Belum ada sesi ujian</p>
                        <p className="mt-1 text-xs text-slate-500">Tambahkan sesi untuk menentukan jam ujian.</p>
                    </div> : <div className="pas-session-list rounded-xl divide-y divide-slate-100">
                        {sessions.map(session => {
                            const isSessionInUse = allSchedules.some(schedule => schedule.session_id === session.id);
                            return <div key={session.id} className="px-4 py-4 sm:px-5">
                                <div className="flex items-center justify-between gap-3">
                                    <div className="min-w-0">
                                        <h4 className="break-words text-sm font-semibold text-slate-900">{session.name}</h4>
                                        <p className="mt-1 text-sm text-slate-600 tabular-nums">{session.start_time.slice(0, 5)} – {session.end_time.slice(0, 5)} {tzLabel}</p>
                                    </div>
                                    {!period.is_locked && (
                                        <button type="button" onClick={() => void handleDeleteSession(session.id)}
                                            disabled={isSaving || isSessionInUse} aria-label={`Hapus sesi ${session.name}`}
                                            title={isSessionInUse ? 'Sesi masih dipakai jadwal dan tidak dapat dihapus' : 'Hapus sesi'}
                                            className="shrink-0 rounded-lg p-2 text-slate-400 hover:text-red-500 disabled:opacity-40 disabled:cursor-not-allowed">
                                            <Trash2 size={15} />
                                        </button>
                                    )}
                                </div>
                            </div>;
                        })}
                    </div>}
                </div>
            )}

            {/* ══════════════════════════════════════════════════════════
                TAB 3: PEMETAAN PENGAWAS (BERDASARKAN RUANG & SESI)
               ══════════════════════════════════════════════════════════ */}
            {activeTab === 'invigilators' && (
                <div className="space-y-4">
                    <div className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-2xs space-y-4">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                            <div>
                                <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                                    <ShieldCheck size={17} className="text-[#3083FF]" />
                                    Pemetaan Pengawas Ruang & Sesi
                                </h3>
                                <p className="text-xs text-slate-500 mt-0.5">
                                    Pilih sesi ujian lalu tetapkan pengawas untuk setiap ruangan ujian.
                                </p>
                            </div>
                            {period.is_locked && (
                                <span className="flex items-center gap-1.5 text-xs text-slate-500">
                                    <Lock size={13} /> Periode terkunci
                                </span>
                            )}
                        </div>

                        {sessions.length === 0 ? (
                            <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-4 text-xs text-amber-800 flex items-center gap-2.5">
                                <AlertTriangle size={16} className="shrink-0 text-amber-600" />
                                <span>Belum ada sesi ujian. Tambahkan sesi terlebih dahulu pada tab <strong>Sesi Ujian</strong>.</span>
                            </div>
                        ) : (
                            <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-slate-100">
                                <span className="text-xs font-semibold text-slate-600 mr-1">Pilih Sesi:</span>
                                {sessions.map((session) => {
                                    const active = selectedProctorSessionId === session.id;
                                    const filledRoomsCount = rooms.filter(
                                        (r) => getRoomSessionInvigilators(r, session.id).length > 0,
                                    ).length;
                                    return (
                                        <button
                                            key={session.id}
                                            type="button"
                                            onClick={() => handleProctorSessionChange(session.id)}
                                            disabled={isSaving}
                                            className={`px-3.5 py-2 rounded-xl text-xs font-semibold border transition-all flex items-center gap-2 ${
                                                active
                                                    ? 'bg-[#3083FF] text-white border-[#3083FF] shadow-xs'
                                                    : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                                            }`}
                                        >
                                            <span>{session.name}</span>
                                            <span className={`text-[10px] font-mono ${active ? 'text-blue-100' : 'text-slate-400'}`}>
                                                ({session.start_time.slice(0, 5)}–{session.end_time.slice(0, 5)})
                                            </span>
                                            <span
                                                className={`px-1.5 py-0.5 rounded-md text-[10px] font-bold ${
                                                    active
                                                        ? 'bg-white/20 text-white'
                                                        : filledRoomsCount === rooms.length && rooms.length > 0
                                                          ? 'bg-emerald-100 text-emerald-700'
                                                          : 'bg-amber-100 text-amber-700'
                                                }`}
                                            >
                                                {filledRoomsCount}/{rooms.length} ruang
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    {isLoading ? (
                        <div className="text-center py-10 text-slate-400 text-xs flex items-center justify-center gap-2">
                            <Loader2 size={18} className="animate-spin text-[#3083FF]" /> Memuat data pemetaan pengawas...
                        </div>
                    ) : rooms.length === 0 ? (
                        <div className="pas-room-empty text-center py-8 text-slate-500 bg-white rounded-2xl border border-slate-200">
                            <DoorOpen size={36} className="mx-auto mb-2.5 text-slate-300" />
                            <p className="font-bold text-slate-800 text-sm">Belum ada ruang ujian</p>
                            <p className="text-xs text-slate-400 mt-0.5 max-w-sm mx-auto">
                                Buat ruang ujian terlebih dahulu pada tab <strong>Ruang</strong> sebelum memetakan pengawas.
                            </p>
                        </div>
                    ) : sessions.length > 0 && (
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                            {rooms.map((room) => {
                                const assignedInvigilators = getRoomSessionInvigilators(room, selectedProctorSessionId);
                                const assignedIds = assignedInvigilators.map((i) => i.user_id);
                                const availableTeachers = teachers.filter((t) => !assignedIds.includes(t.id));
                                const isRoomSaving = savingProctorRoomId === room.id;
                                const isRoomSaved = savedProctorRoomId === room.id;

                                return (
                                    <div
                                        key={room.id}
                                        className="bg-white rounded-2xl border border-slate-200/90 p-4 sm:p-5 shadow-2xs flex flex-col justify-between gap-4"
                                    >
                                        <div className="space-y-3">
                                            <div className="flex items-start justify-between gap-2">
                                                <div>
                                                    <div className="flex items-center gap-2 flex-wrap">
                                                        <h4 className="font-bold text-sm text-slate-900">{room.name}</h4>
                                                        <span className="text-[11px] font-medium text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md">
                                                            {room.pas_room_students?.length || 0}/{room.capacity} peserta
                                                        </span>
                                                    </div>
                                                    <p className="text-xs text-slate-500 mt-0.5">
                                                        Sesi: <strong>{selectedProctorSession?.name || '-'}</strong>
                                                        {selectedProctorSession
                                                            ? ` (${selectedProctorSession.start_time.slice(0, 5)}–${selectedProctorSession.end_time.slice(0, 5)} ${tzLabel})`
                                                            : ''}
                                                    </p>
                                                </div>

                                                <div className="flex items-center gap-1.5 shrink-0">
                                                    {isRoomSaving && (
                                                        <span className="text-[11px] font-semibold text-blue-600 flex items-center gap-1">
                                                            <Loader2 size={12} className="animate-spin" /> Menyimpan...
                                                        </span>
                                                    )}
                                                    {isRoomSaved && !isRoomSaving && (
                                                        <span className="text-[11px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full flex items-center gap-1">
                                                            <Check size={12} /> Tersimpan
                                                        </span>
                                                    )}
                                                    <span
                                                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                                                            assignedIds.length > 0
                                                                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                                                : 'bg-amber-50 text-amber-700 border-amber-200'
                                                        }`}
                                                    >
                                                        {assignedIds.length > 0
                                                            ? `${assignedIds.length} Pengawas`
                                                            : 'Belum Ada Pengawas'}
                                                    </span>
                                                </div>
                                            </div>

                                            {/* Daftar Pengawas di Ruang & Sesi Ini */}
                                            {assignedIds.length === 0 ? (
                                                <div className="p-3 bg-slate-50/70 rounded-xl border border-dashed border-slate-200 text-center">
                                                    <p className="text-xs text-slate-500">
                                                        Belum ada pengawas untuk <strong>{room.name}</strong> pada{' '}
                                                        <strong>{selectedProctorSession?.name || 'sesi ini'}</strong>.
                                                    </p>
                                                </div>
                                            ) : (
                                                <div className="space-y-2">
                                                    {assignedIds.map((proctorId) => {
                                                        const teacher = teachers.find((t) => t.id === proctorId);
                                                        const invRecord = assignedInvigilators.find((i) => i.user_id === proctorId);
                                                        const teacherName =
                                                            teacher?.name || invRecord?.profiles?.full_name || 'Pengawas';
                                                        const roles = teacher?.roles || ['Pengawas'];
                                                        const otherRooms = (teacherAssignmentMap.get(proctorId) || []).filter(
                                                            (rName) => rName.toLowerCase() !== room.name.toLowerCase(),
                                                        );

                                                        return (
                                                            <div
                                                                key={proctorId}
                                                                className="flex items-center justify-between p-2.5 bg-slate-50/80 border border-slate-200/90 rounded-xl"
                                                            >
                                                                <div className="flex items-center gap-2.5 min-w-0 pr-2">
                                                                    <div className="w-7 h-7 rounded-lg bg-blue-50 text-[#3083FF] flex items-center justify-center shrink-0">
                                                                        <ShieldCheck size={14} />
                                                                    </div>
                                                                    <div className="min-w-0">
                                                                        <p className="text-xs font-bold text-slate-800 truncate">
                                                                            {teacherName}
                                                                        </p>
                                                                        <div className="flex items-center gap-1.5 flex-wrap">
                                                                            <span className="text-[10px] text-slate-500">
                                                                                {roles.join(', ')}
                                                                            </span>
                                                                            {otherRooms.length > 0 && (
                                                                                <span className="text-[10px] px-1.5 py-0.2 rounded bg-amber-50 text-amber-700 border border-amber-200 font-semibold">
                                                                                    Juga di: {otherRooms.join(', ')}
                                                                                </span>
                                                                            )}
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                                {!period.is_locked && (
                                                                    <button
                                                                        type="button"
                                                                        disabled={isSaving}
                                                                        onClick={() => handleRemoveRoomProctor(room, proctorId)}
                                                                        className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors shrink-0"
                                                                        title="Hapus pengawas dari ruang dan sesi ini"
                                                                    >
                                                                        <X size={14} />
                                                                    </button>
                                                                )}
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            )}
                                        </div>

                                        {/* Dropdown Tambah Pengawas */}
                                        {!period.is_locked && (
                                            <div className="pt-2 border-t border-slate-100">
                                                <InlineSelect
                                                    disabled={!selectedProctorSessionId || isSaving}
                                                    value=""
                                                    onChange={(teacherId) => handleAddRoomProctor(room, teacherId)}
                                                    minWidth="100%"
                                                    height="36px"
                                                    title={`Tambah Pengawas ke ${room.name}`}
                                                    options={[
                                                        { value: '', label: '+ Tambah Guru / Pengawas ke Ruangan Ini...' },
                                                        ...availableTeachers.map((t) => {
                                                            const otherRooms = (teacherAssignmentMap.get(t.id) || []).filter(
                                                                (rName) => rName.toLowerCase() !== room.name.toLowerCase(),
                                                            );
                                                            const conflictNotice =
                                                                otherRooms.length > 0
                                                                    ? ` (⚠️ Ditugaskan di: ${otherRooms.join(', ')})`
                                                                    : '';
                                                            return {
                                                                value: t.id,
                                                                label: `${t.name}${t.roles?.length ? ` (${t.roles.join(', ')})` : ''}${conflictNotice}`,
                                                            };
                                                        }),
                                                    ]}
                                                />
                                            </div>
                                        )}
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
