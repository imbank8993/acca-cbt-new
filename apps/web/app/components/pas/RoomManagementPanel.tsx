"use client";
import '@/app/components/pas-room-management.css';
import { PASScheduleStatus } from '@/app/components/PASScheduleStatus';

import { confirmDialog, deleteConfirmDialog } from '@/lib/confirm-dialog';
import { PASRoomInput } from "@/app/components/PASRoomInput";
import {
    assignProctorsToRoomAction,
    copyInvigilatorsAction,
    getRoomSessionInvigilators,
    pasDay,
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
import { Modal, ModalBody, ModalField, ModalFooter } from '@/app/components/ui/modal';
import { InlineSelect } from '@/app/components/ui/inlineselect';
import { Button } from '@/app/components/ui/button';
import { formatStudentName } from '@/lib/monitoring-health';
import { getSchoolTimeZoneLabel, schoolTodayDate } from '@/lib/school-time';
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
    UserPlus,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const isPasDay = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);

/** Label tanggal tugas pengawas, mis. "Sen, 19 Okt 2026". */
function formatProctorDate(date: string): string {
    if (!isPasDay(date)) return date;
    return new Date(`${date}T00:00:00Z`).toLocaleDateString('id-ID', {
        weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
    });
}

interface RoomManagementPanelProps {
    period: PASPeriod;
    view?: 'rooms' | 'sessions' | 'invigilators';
    onViewChange?: (view: 'rooms' | 'sessions' | 'invigilators') => void;
    onChange?: () => void;
    /** Halaman folder ASAS/AM menampilkan Ruang dan Sesi sebagai tab sendiri, tanpa navigasi di dalam panel. */
    hideNav?: boolean;
}

export default function RoomManagementPanel({ period, view, onViewChange, onChange, hideNav = false }: RoomManagementPanelProps) {
    const readOnly = period.canManage === false;
    const { timeZone, error: timeZoneError } = useSchoolTimeZone();
    const [internalTab, setInternalTab] = useState<'rooms' | 'sessions' | 'invigilators'>(view || 'rooms');
    // Ruang dan pengawas berada di satu tampilan; "invigilators" lama diarahkan ke sana.
    const activeTab: 'rooms' | 'sessions' = (view || internalTab) === 'sessions' ? 'sessions' : 'rooms';

    const handleTabChange = (nextTab: 'rooms' | 'sessions' | 'invigilators') => {
        setInternalTab(nextTab);
        onViewChange?.(nextTab);
    };

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

    // State for invigilator mapping tab (by date, session & room).
    // Pengawas bergilir setiap hari, jadi penugasan selalu untuk satu tanggal.
    const [chosenProctorDate, setSelectedProctorDate] = useState('');
    const [isCopyingProctors, setIsCopyingProctors] = useState(false);
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
    // Satu siswa hanya boleh di satu ruang: siswa yang sudah di ruang lain tidak
    // bisa dicentang (termasuk lewat "Pilih semua"); pemindahan lewat tombol Pindahkan.
    const roomElsewhere = (studentId: string) => {
        const room = studentRoomMap.get(studentId);
        return room && room.id !== selectedRoom?.id ? room : null;
    };
    const selectableStudents = visibleClassStudents.filter(student => !assignedStudentIds.has(student.id) && !roomElsewhere(student.id));
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

    // Tanggal tugas: tanggal jadwal ujian di folder ini; bila belum ada jadwal,
    // seluruh tanggal dalam rentang folder.
    const proctorDates = useMemo(() => {
        const dates = new Set((period.pas_class_schedules || [])
            .map(schedule => pasDay(schedule.scheduled_date)).filter(isPasDay));
        const start = pasDay(period.start_date), end = pasDay(period.end_date);
        if (!dates.size && isPasDay(start) && isPasDay(end) && start <= end) {
            for (let cursor = new Date(`${start}T00:00:00Z`);
                cursor.toISOString().slice(0, 10) <= end && dates.size < 62;
                cursor = new Date(cursor.getTime() + 86_400_000)) dates.add(cursor.toISOString().slice(0, 10));
        }
        return [...dates].sort();
    }, [period.pas_class_schedules, period.start_date, period.end_date]);

    // Tanggal terpilih yang tidak lagi tersedia diganti tanggal tugas terdekat (hari ini atau sesudahnya).
    const selectedProctorDate = proctorDates.includes(chosenProctorDate) ? chosenProctorDate
        : proctorDates.find(date => date >= schoolTodayDate(timeZone)) || proctorDates[0] || '';

    const previousProctorDate = proctorDates[proctorDates.indexOf(selectedProctorDate) - 1] || '';

    // Map which teacher is assigned to which other rooms on the selected date & session
    const teacherAssignmentMap = useMemo(() => {
        const map = new Map<string, string[]>();
        for (const r of rooms) {
            const invigilators = getRoomSessionInvigilators(r, selectedProctorSessionId, selectedProctorDate);
            for (const inv of invigilators) {
                const current = map.get(inv.user_id) || [];
                map.set(inv.user_id, [...current, r.name]);
            }
        }
        return map;
    }, [rooms, selectedProctorSessionId, selectedProctorDate]);

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

    const handleProctorDateChange = (value: string) => {
        if (isSaving || !value) return;
        setSelectedProctorDate(value);
        setSavedProctorRoomId(null);
    };

    /** Salin seluruh pengawas (semua ruang & sesi) dari tanggal sebelumnya ke tanggal terpilih. */
    const handleCopyPreviousProctors = async () => {
        if (!previousProctorDate || !selectedProctorDate || isSaving || (period.is_locked || readOnly)) return;
        const targetHasAssignments = rooms.some(room => (room.pas_room_invigilators || [])
            .some(member => pasDay(member.exam_date) === selectedProctorDate));
        if (targetHasAssignments && !await confirmDialog({
            title: 'Ganti Pengawas Tanggal Ini?',
            text: `Pengawas ${formatProctorDate(selectedProctorDate)} untuk semua ruang dan sesi akan diganti dengan susunan ${formatProctorDate(previousProctorDate)}.`,
            confirmText: 'Ya, salin',
            cancelText: 'Batal',
        })) return;
        setIsSaving(true);
        setIsCopyingProctors(true);
        setRoomError('');
        try {
            const result = await copyInvigilatorsAction(period.id, previousProctorDate, selectedProctorDate);
            if (!result.success) throw new Error(result.error || 'Pengawas belum berhasil disalin.');
            await refreshRooms();
        } catch (error) {
            setRoomError(error instanceof Error ? error.message : 'Pengawas belum berhasil disalin.');
        } finally {
            setIsSaving(false);
            setIsCopyingProctors(false);
        }
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
        if (!selectedProctorSessionId || !selectedProctorDate || isSaving) return;
        setIsSaving(true);
        setSavingProctorRoomId(roomId);
        setRoomError('');
        try {
            const result = await assignProctorsToRoomAction(roomId, targetIds, selectedProctorSessionId, selectedProctorDate);
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
        if (!teacherId || !selectedProctorSessionId || !selectedProctorDate || isSaving) return;
        const currentIds = getRoomSessionInvigilators(room, selectedProctorSessionId, selectedProctorDate).map((inv) => inv.user_id);
        if (!currentIds.includes(teacherId)) {
            void handleSaveRoomProctors(room.id, [...currentIds, teacherId]);
        }
    };

    const handleRemoveRoomProctor = (room: PASRoom, proctorId: string) => {
        if (!selectedProctorSessionId || !selectedProctorDate || isSaving) return;
        const currentIds = getRoomSessionInvigilators(room, selectedProctorSessionId, selectedProctorDate).map((inv) => inv.user_id);
        void handleSaveRoomProctors(
            room.id,
            currentIds.filter((id) => id !== proctorId),
        );
    };

    // ── Tambah pengawas (modal) ──
    const [assignTarget, setAssignTarget] = useState<{ roomId: string; teacherId: string } | null>(null);
    const canShowProctors = Boolean(selectedProctorSessionId && selectedProctorDate);
    const canAssignProctor = canShowProctors && rooms.length > 0 && !period.is_locked && !readOnly && !isSaving;
    const openAssignProctor = (roomId: string) => setAssignTarget({ roomId, teacherId: '' });
    const assignRoom = rooms.find(room => room.id === assignTarget?.roomId) || null;
    const assignableTeachers = assignRoom ? (() => {
        const assignedIds = getRoomSessionInvigilators(assignRoom, selectedProctorSessionId, selectedProctorDate).map(inv => inv.user_id);
        // Satu orang hanya boleh di satu ruang pada tanggal & sesi yang sama.
        return teachers.filter(t => !assignedIds.includes(t.id)
            && !(teacherAssignmentMap.get(t.id) || []).some(rName => rName.toLowerCase() !== assignRoom.name.toLowerCase()));
    })() : [];

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
        const studentIds = [...new Set(selectedStudentIds)].filter(id => !roomElsewhere(id));
        if (studentIds.length === 0) {
            setRoomError('Siswa yang dipilih sudah ditempatkan di ruang lain. Satu siswa hanya boleh di satu ruang.');
            return;
        }
        setIsSaving(true);
        setRoomError('');
        try {
            const result = await assignStudentsToRoomAction(period.id, selectedRoom.id, studentIds);
            if (!result.success) throw new Error(result.error || 'Peserta belum berhasil ditambahkan.');
            const updatedRooms = await listPASRooms(period.id);
            const savedIds = new Set(updatedRooms.find(room => room.id === selectedRoom.id)?.pas_room_students?.map(student => student.user_id) || []);
            if (!studentIds.every(id => savedIds.has(id))) {
                throw new Error('Penempatan peserta belum terkonfirmasi di daftar ruang. Muat ulang dan coba lagi.');
            }
            setRooms(updatedRooms);
            onChange?.();
            setSelectedStudentIds([]);
            setAddingStudents(false);
            setStudentSearch('');
        } catch (error) {
            setRoomError(error instanceof Error ? error.message : 'Peserta belum berhasil ditambahkan.');
        } finally { setIsSaving(false); }
    };

    /** Pindahkan satu siswa dari ruang lamanya ke ruang ini, setelah dikonfirmasi. */
    const handleMoveStudent = async (studentId: string, studentName: string) => {
        const fromRoom = roomElsewhere(studentId);
        if (!selectedRoom || !fromRoom || isSaving || isClassLoading) return;
        if (remainingCapacity < 1) {
            setRoomError(`Kapasitas ${selectedRoom.name} sudah penuh.`);
            return;
        }
        if (!await confirmDialog({
            title: 'Pindahkan Siswa?',
            text: `${studentName} sudah ditempatkan di ${fromRoom.name}. Satu siswa hanya boleh di satu ruang, jadi penempatannya di ${fromRoom.name} akan dihapus dan dipindahkan ke ${selectedRoom.name}.`,
            confirmText: 'Pindahkan',
            cancelText: 'Batal',
            variant: 'warning',
        })) return;
        setIsSaving(true);
        setRoomError('');
        try {
            const result = await assignStudentsToRoomAction(period.id, selectedRoom.id, [studentId], { move: true });
            if (!result.success) throw new Error(result.error || 'Siswa belum berhasil dipindahkan.');
            await refreshRooms();
            setSelectedStudentIds(previous => previous.filter(id => id !== studentId));
        } catch (error) {
            setRoomError(error instanceof Error ? error.message : 'Siswa belum berhasil dipindahkan.');
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
        if (readOnly) return;
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
        if (readOnly) return;
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
                    <Button type="button" variant="ghost" size="sm" className="mt-2" onClick={() => void loadData()}>Muat ulang daftar</Button>
                </div>
            )}
            {timeZoneError && (
                <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700 font-medium">
                    {timeZoneError}
                </div>
            )}

            {/* ── Sub-tab Navigation (Ruang & Pengawas, Sesi) ── */}
            {!hideNav && <div className="flex items-center gap-1.5 p-1 bg-slate-100/90 rounded-xl w-fit border border-slate-200/70">
                <button
                    type="button"
                    onClick={() => handleTabChange('rooms')}
                    className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                        activeTab === 'rooms'
                            ? 'bg-white text-[#3083FF] shadow-xs'
                            : 'text-slate-600 hover:text-slate-900'
                    }`}
                >
                    <DoorOpen size={13} />
                    Ruang & Pengawas
                    {rooms.length > 0 && (
                        <span className={`px-1.5 py-0.2 rounded text-[10px] font-bold ${
                            activeTab === 'rooms' ? 'bg-[#3083FF]/10 text-[#3083FF]' : 'bg-slate-200 text-slate-500'
                        }`}>
                            {rooms.length}
                        </span>
                    )}
                </button>
                <button
                    type="button"
                    onClick={() => handleTabChange('sessions')}
                    className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                        activeTab === 'sessions'
                            ? 'bg-white text-[#3083FF] shadow-xs'
                            : 'text-slate-600 hover:text-slate-900'
                    }`}
                >
                    <Clock size={13} />
                    Sesi Ujian
                    {sessions.length > 0 && (
                        <span className={`px-1.5 py-0.2 rounded text-[10px] font-bold ${
                            activeTab === 'sessions' ? 'bg-[#3083FF]/10 text-[#3083FF]' : 'bg-slate-200 text-slate-500'
                        }`}>
                            {sessions.length}
                        </span>
                    )}
                </button>
            </div>}

            {/* ══════════════════════════════════════════════════════════
                TAB 1: RUANGAN & PESERTA
               ══════════════════════════════════════════════════════════ */}
            {activeTab === 'rooms' && (
                <div className="space-y-4">
                    {/* Form Tambah Ruang Baru */}
                    {!period.is_locked && !readOnly && isCreatingRoom && (
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
                                            disabled={isSaving || readOnly}
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
                                    disabled={isSaving || readOnly}
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

                    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                        <div>
                            <h3 className="text-sm font-semibold text-slate-900">Ruang dan Pengawas</h3>
                            <p className="mt-0.5 text-xs text-slate-500">Atur peserta setiap ruang, lalu tugaskan pengawas per tanggal dan sesi. Pengawas bergilir setiap hari.</p>
                        </div>
                        {(period.is_locked || readOnly) ? <span className="flex items-center gap-1.5 text-xs text-slate-500"><Lock size={13} /> {readOnly ? 'Mode lihat saja' : 'Periode terkunci'}</span>
                            : <div className="flex flex-wrap items-center gap-2">
                                <Button variant="outline" size="sm" icon="add" onClick={() => setIsCreatingRoom(true)}>Tambah ruang</Button>
                                <Button variant="primary" size="sm" leftIcon={<UserPlus size={15} />} disabled={!canAssignProctor}
                                    title={canAssignProctor ? 'Tugaskan pengawas ke ruang' : 'Butuh ruang, sesi, dan tanggal tugas'}
                                    onClick={() => openAssignProctor(rooms[0]?.id || '')}>Tambah pengawas</Button>
                            </div>}
                    </div>

                    {sessions.length === 0 ? (
                        <div className="flex items-center gap-2.5 rounded-xl border border-amber-200 bg-amber-50/70 p-3.5 text-xs text-amber-800">
                            <AlertTriangle size={16} className="shrink-0 text-amber-600" />
                            <span>Belum ada sesi ujian. Tambahkan sesi pada tab <strong>Sesi</strong> agar pengawas dapat ditugaskan.</span>
                        </div>
                    ) : proctorDates.length === 0 ? (
                        <div className="flex items-center gap-2.5 rounded-xl border border-amber-200 bg-amber-50/70 p-3.5 text-xs text-amber-800">
                            <AlertTriangle size={16} className="shrink-0 text-amber-600" />
                            <span>Isi tanggal mulai dan selesai folder atau tambahkan jadwal agar tanggal tugas pengawas tersedia.</span>
                        </div>
                    ) : (
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5 rounded-xl border border-slate-200 bg-white px-4 py-3">
                            <label className="pas-proctor-date flex items-center gap-2 text-xs font-medium text-slate-600">
                                <Calendar size={14} className="text-slate-400" aria-hidden="true" />Tanggal
                                <InlineSelect value={selectedProctorDate} onChange={value => handleProctorDateChange(String(value))} disabled={isSaving}
                                    minWidth="240px" aria-label="Tanggal tugas pengawas"
                                    options={proctorDates.map(date => {
                                        const filled = sessions.reduce((total, session) => total + rooms.filter(r => getRoomSessionInvigilators(r, session.id, date).length > 0).length, 0);
                                        return { value: date, label: `${formatProctorDate(date)} · ${filled}/${rooms.length * sessions.length} terisi` };
                                    })} />
                            </label>
                            <div role="group" aria-label="Sesi" className="inline-flex flex-wrap gap-0.5 rounded-full border border-slate-200 bg-slate-100 p-0.5">
                                {sessions.map(session => {
                                    const active = selectedProctorSessionId === session.id;
                                    const filled = rooms.filter(r => getRoomSessionInvigilators(r, session.id, selectedProctorDate).length > 0).length;
                                    return <button key={session.id} type="button" aria-pressed={active} disabled={isSaving}
                                        onClick={() => handleProctorSessionChange(session.id)}
                                        className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${active ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>
                                        {session.name}
                                        <span className="font-normal tabular-nums text-slate-400">{session.start_time.slice(0, 5)}–{session.end_time.slice(0, 5)}</span>
                                        <span className={`rounded-full px-1.5 text-[10px] tabular-nums ${filled === rooms.length && rooms.length > 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{filled}/{rooms.length}</span>
                                    </button>;
                                })}
                            </div>
                            {!period.is_locked && !readOnly && <Button type="button" variant="ghost" size="sm" className="sm:ml-auto" disabled={!previousProctorDate || isSaving}
                                onClick={() => void handleCopyPreviousProctors()}
                                title={previousProctorDate ? `Salin seluruh pengawas ${formatProctorDate(previousProctorDate)} ke ${formatProctorDate(selectedProctorDate)}` : 'Tidak ada tanggal sebelumnya'}>
                                {isCopyingProctors ? 'Menyalin…' : 'Salin dari hari sebelumnya'}
                            </Button>}
                        </div>
                    )}

                    {/* Daftar ruang beserta pengawas sesi terpilih */}
                    {isLoading ? (
                        <div className="text-center py-10 text-slate-400 text-xs flex items-center justify-center gap-2">
                            <Loader2 size={18} className="animate-spin text-[#3083FF]" /> Memuat data ruangan...
                        </div>
                    ) : rooms.length === 0 && !roomError ? (
                        <div className="pas-room-empty rounded-xl border border-dashed border-slate-300 bg-white py-10 text-center text-slate-500">
                            <DoorOpen size={34} className="mx-auto mb-2.5 text-slate-300" />
                            <p className="text-sm font-semibold text-slate-800">Belum ada ruang ujian</p>
                            <p className="mx-auto mt-0.5 max-w-sm text-xs text-slate-400">Tambah ruang untuk mulai menempatkan peserta dan menugaskan pengawas.</p>
                            {!period.is_locked && !readOnly && <Button className="mt-4" variant="outline" size="sm" icon="add" onClick={() => setIsCreatingRoom(true)}>Tambah ruang</Button>}
                        </div>
                    ) : (
                        <div className="pas-room-list overflow-hidden rounded-xl border border-slate-200 bg-white">
                            <div className="overflow-x-auto" role="region" aria-label="Ruang dan pengawas" tabIndex={0}>
                                <table className="w-full min-w-[720px] text-left text-xs">
                                    <thead className="bg-slate-50 text-[11px] text-slate-500">
                                        <tr>
                                            <th scope="col" className="px-4 py-3 font-medium">Ruang</th>
                                            <th scope="col" className="px-4 py-3 font-medium">Peserta</th>
                                            <th scope="col" className="px-4 py-3 font-medium">Pengawas{selectedProctorSession ? ` · ${selectedProctorSession.name}` : ''}</th>
                                            <th scope="col" className="px-4 py-3"><span className="sr-only">Tindakan</span></th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {rooms.map(room => {
                                            const assigned = canShowProctors ? getRoomSessionInvigilators(room, selectedProctorSessionId, selectedProctorDate) : [];
                                            const seated = room.pas_room_students?.length || 0;
                                            const full = room.capacity > 0 && seated >= room.capacity;
                                            return <tr key={room.id} className="align-middle hover:bg-slate-50/60">
                                                <td className="px-4 py-3.5"><span className="font-semibold text-slate-900">{room.name}</span></td>
                                                <td className="px-4 py-3.5 tabular-nums">
                                                    <span className={full ? 'font-semibold text-emerald-700' : 'text-slate-700'}>{seated}</span>
                                                    <span className="text-slate-400"> / {room.capacity} kursi</span>
                                                </td>
                                                <td className="px-4 py-3.5">
                                                    {!canShowProctors ? <span className="text-slate-400">—</span>
                                                        : savingProctorRoomId === room.id ? <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-600"><Loader2 size={12} className="animate-spin" />Menyimpan</span>
                                                        : assigned.length === 0 ? <span className="inline-flex rounded-md bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">Belum ada pengawas</span>
                                                        : <div className="flex flex-wrap items-center gap-1.5">
                                                            {assigned.map(inv => {
                                                                const name = teachers.find(t => t.id === inv.user_id)?.name || inv.profiles?.full_name || 'Pengawas';
                                                                const otherRooms = (teacherAssignmentMap.get(inv.user_id) || []).filter(rName => rName.toLowerCase() !== room.name.toLowerCase());
                                                                return <span key={inv.user_id} className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 py-0.5 pl-2.5 pr-1 text-[11px] font-medium text-slate-700">
                                                                    <ShieldCheck size={12} className="text-blue-600" aria-hidden="true" />{name}
                                                                    {otherRooms.length > 0 && <span className="rounded bg-amber-100 px-1 text-[10px] font-normal text-amber-800">juga di {otherRooms.join(', ')}</span>}
                                                                    {!period.is_locked && !readOnly && <button type="button" disabled={isSaving || readOnly} onClick={() => handleRemoveRoomProctor(room, inv.user_id)}
                                                                        className="rounded-full p-0.5 text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label={`Hapus ${name} dari ${room.name}`}><X size={12} /></button>}
                                                                </span>;
                                                            })}
                                                            {savedProctorRoomId === room.id && <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700"><Check size={11} />Tersimpan</span>}
                                                        </div>}
                                                </td>
                                                <td className="px-4 py-3.5">
                                                    <div className="flex items-center justify-end gap-1.5">
                                                        {!period.is_locked && !readOnly && <Button type="button" variant="ghost" size="sm" disabled={!canAssignProctor}
                                                            leftIcon={<UserPlus size={14} />} onClick={() => openAssignProctor(room.id)} aria-label={`Tambah pengawas ${room.name}`}>Pengawas</Button>}
                                                        <Button variant="outline" size="sm" disabled={isSaving} onClick={() => openRoom(room.id)}>{readOnly ? 'Lihat peserta' : 'Atur peserta'}</Button>
                                                        {!period.is_locked && !readOnly && <Button type="button" variant="ghost" size="sm" disabled={isSaving || readOnly}
                                                            onClick={() => void handleDeleteRoom(room.id)} className="text-slate-500 hover:text-red-600"
                                                            aria-label={`Hapus ruang ${room.name}`} title="Hapus ruang" leftIcon={<Trash2 size={15} />} />}
                                                    </div>
                                                </td>
                                            </tr>;
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}

                    <Modal open={Boolean(assignTarget)} onClose={() => setAssignTarget(null)} size="md" variant="add" title="Tambah pengawas"
                        icon={<UserPlus size={18} />} labelledBy="pas-assign-proctor"
                        subtitle={`${selectedProctorDate ? formatProctorDate(selectedProctorDate) : ''}${selectedProctorSession ? ` · ${selectedProctorSession.name} (${selectedProctorSession.start_time.slice(0, 5)}–${selectedProctorSession.end_time.slice(0, 5)})` : ''}`}>
                        <ModalBody>
                            <div className="space-y-4">
                                <ModalField label="Ruang" required>
                                    <InlineSelect value={assignTarget?.roomId || ''} minWidth="100%" height="40px" aria-label="Ruang"
                                        onChange={roomId => setAssignTarget(target => target ? { roomId, teacherId: '' } : target)}
                                        options={[{ value: '', label: 'Pilih ruang…' }, ...rooms.map(r => ({ value: r.id, label: r.name }))]} />
                                </ModalField>
                                <ModalField label="Pengawas" required hint="Satu pengawas hanya bertugas di satu ruang pada sesi yang sama.">
                                    <InlineSelect value={assignTarget?.teacherId || ''} minWidth="100%" height="40px" aria-label="Pengawas" disabled={!assignRoom}
                                        onChange={teacherId => setAssignTarget(target => target ? { ...target, teacherId } : target)}
                                        options={[{ value: '', label: assignRoom ? 'Pilih pengawas…' : 'Pilih ruang terlebih dahulu' }, ...assignableTeachers.map(t => ({ value: t.id, label: t.name }))]} />
                                </ModalField>
                            </div>
                        </ModalBody>
                        <ModalFooter>
                            <Button type="button" variant="cancel" onClick={() => setAssignTarget(null)}>Batal</Button>
                            <Button type="button" variant="primary" icon="save" disabled={!assignRoom || !assignTarget?.teacherId || isSaving}
                                onClick={() => {
                                    if (!assignRoom || !assignTarget?.teacherId) return;
                                    handleAddRoomProctor(assignRoom, assignTarget.teacherId);
                                    setAssignTarget(null);
                                }}>Tugaskan</Button>
                        </ModalFooter>
                    </Modal>

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
                                    <div className="flex items-center gap-2">
                                        <Button variant={addingStudents ? 'outline' : 'primary'} size="sm" disabled={isSaving || readOnly}
                                            onClick={() => { setAddingStudents(!addingStudents); setStudentSearch(''); setSelectedStudentIds([]); }}>
                                            {addingStudents ? 'Kembali ke daftar' : 'Tambah Peserta'}
                                        </Button>
                                    </div>
                                </div>

                                {addingStudents && <div className="space-y-3">
                                    <InlineSelect value={selectedClassId} disabled={isSaving || readOnly} onChange={val => void handleLoadClassStudents(val)}
                                        minWidth="100%" height="40px" title="Kelas asal peserta"
                                        options={[{ value: '', label: 'Pilih kelas asal' }, ...classes.map(c => ({ value: c.id, label: c.name.replace(/^kelas\s+/i, '') }))]} />
                                    <p className="text-xs text-slate-500">Centang peserta yang akan ditempatkan di ruangan ini. Satu siswa hanya boleh di satu ruang; siswa yang sudah di ruang lain dapat dipindahkan lewat tombol Pindahkan.</p>
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
                                            <input type="checkbox" disabled={isSaving || readOnly}
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
                                                const otherRoom = alreadyHere ? null : roomElsewhere(student.id);
                                                const studentName = formatStudentName(student.name || student.full_name, 'Tanpa Nama');
                                                return <div key={student.id} className="flex items-center gap-3 px-2 py-3 text-sm">
                                                    <label className={`flex min-w-0 flex-1 items-center gap-3 ${otherRoom ? 'cursor-not-allowed' : ''}`}>
                                                        <input type="checkbox" disabled={isSaving || alreadyHere || !!otherRoom} checked={alreadyHere || (!otherRoom && selectedStudentIds.includes(student.id))}
                                                            onChange={e => setSelectedStudentIds(previous => e.target.checked ? [...new Set([...previous, student.id])] : previous.filter(id => id !== student.id))} />
                                                        <span className="min-w-0 flex-1">
                                                            <span className={`block font-medium ${otherRoom ? 'text-slate-400' : 'text-slate-800'}`}>{studentName}</span>
                                                            {(student.identity_number || alreadyHere || otherRoom) && <span className="mt-0.5 block text-xs text-slate-500">
                                                                {[student.identity_number, alreadyHere ? 'Sudah di ruangan ini' : otherRoom ? `Sudah di ${otherRoom.name}` : ''].filter(Boolean).join(' · ')}
                                                            </span>}
                                                        </span>
                                                    </label>
                                                    {otherRoom && <Button type="button" variant="warning" size="sm" className="shrink-0" disabled={isSaving || remainingCapacity < 1}
                                                        onClick={() => void handleMoveStudent(student.id, studentName)}
                                                        title={remainingCapacity < 1 ? 'Ruangan ini sudah penuh' : `Pindahkan dari ${otherRoom.name} ke ruangan ini`}>
                                                        Pindahkan
                                                    </Button>}
                                                </div>;
                                            })}
                                        </div>
                                    </>}
                                    <div className="pas-room-add-footer flex flex-wrap items-center justify-between gap-3 pt-3">
                                        <p className={`text-xs ${exceedsCapacity ? 'text-red-600' : 'text-slate-500'}`} role={exceedsCapacity ? 'alert' : 'status'}>
                                            {exceedsCapacity ? `Pilihan melebihi sisa kapasitas (${remainingCapacity} kursi).` : `${selectedStudentIds.length} dipilih · ${remainingCapacity} kursi tersedia`}
                                        </p>
                                    </div>
                                </> : <div className="pas-room-student-list max-h-96 overflow-y-auto divide-y divide-slate-100">
                                    {visibleRoomStudents.length === 0 && <p className="py-10 text-center text-sm text-slate-500">
                                        {assignedStudentIds.size ? 'Tidak ada peserta yang cocok.' : 'Belum ada peserta. Pilih Tambah Peserta untuk mengisi ruangan.'}
                                    </p>}
                                    {visibleRoomStudents.map((student, idx) => <div key={student.user_id} className="flex items-center gap-3 py-3 px-2 text-sm">
                                        <span className="w-6 shrink-0 text-xs text-slate-400">{idx + 1}</span>
                                        <span className="min-w-0 flex-1 font-medium text-slate-800">{formatStudentName(student.profiles?.full_name, 'Tanpa Nama')}</span>
                                        <Button type="button" variant="ghost" size="sm" className="shrink-0 text-slate-500 hover:text-red-600" disabled={isSaving || readOnly}
                                            onClick={() => void handleRemoveStudent(student.user_id)}
                                            aria-label={`Keluarkan ${formatStudentName(student.profiles?.full_name, 'peserta')} dari ruang`}>Keluarkan</Button>
                                    </div>)}
                                </div>}
                            </div>}
                        </ModalBody>
                        <ModalFooter>
                            {addingStudents ? <>
                                <Button variant="outline" disabled={isSaving || readOnly} onClick={() => { setAddingStudents(false); setSelectedStudentIds([]); }}>Batal</Button>
                                <Button variant="primary" disabled={!selectedStudentIds.length || exceedsCapacity || isSaving || isClassLoading}
                                    isLoading={isSaving} onClick={() => void handleAddStudentsToRoom()}>
                                    Simpan Penempatan{selectedStudentIds.length > 0 ? ` (${selectedStudentIds.length})` : ''}
                                </Button>
                            </> : <Button variant="outline" disabled={isSaving || readOnly} onClick={() => setSelectedRoomId(null)}>Selesai</Button>}
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
                        {(period.is_locked || readOnly) ? <span className="flex items-center gap-1.5 text-xs text-slate-500"><Lock size={13} /> {readOnly ? 'Mode lihat saja' : 'Periode terkunci'}</span>
                        : !period.is_locked && !readOnly && (
                            <Button variant="primary" size="sm" icon="add" disabled={isSaving || readOnly}
                                onClick={() => { setSessionError(''); setIsCreatingSession(true); }}>
                                Tambah Sesi
                            </Button>
                        )}
                    </div>

                    {!period.is_locked && !readOnly && isCreatingSession && (
                        <Modal open title="Tambah Sesi Ujian" subtitle={`Jam pelaksanaan (${tzLabel})`} icon="clock" size="sm"
                            className="pas-room-management" onClose={() => { if (!isSaving) setIsCreatingSession(false); }}>
                            <ModalBody className="space-y-4 p-4 sm:p-6">
                                {sessionError && <p role="alert" className="text-sm text-red-600">{sessionError}</p>}
                                <div>
                                    <label htmlFor="pas-session-name" className="mb-1.5 block text-sm font-medium text-slate-700">Nama sesi</label>
                                    <input id="pas-session-name" type="text" value={newSessionName} disabled={isSaving || readOnly}
                                        onChange={e => setNewSessionName(e.target.value)} placeholder="Contoh: Sesi 1"
                                        className="pas-session-input w-full rounded-lg px-3 py-2.5 text-sm" />
                                </div>
                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label htmlFor="pas-session-start" className="mb-1.5 block text-sm font-medium text-slate-700">Jam mulai</label>
                                        <input id="pas-session-start" type="time" value={newSessionStart} disabled={isSaving || readOnly}
                                            onChange={e => setNewSessionStart(e.target.value)}
                                            className="pas-session-input w-full min-w-0 rounded-lg px-3 py-2.5 text-sm" />
                                    </div>
                                    <div>
                                        <label htmlFor="pas-session-end" className="mb-1.5 block text-sm font-medium text-slate-700">Jam selesai</label>
                                        <input id="pas-session-end" type="time" value={newSessionEnd} disabled={isSaving || readOnly}
                                            onChange={e => setNewSessionEnd(e.target.value)}
                                            className="pas-session-input w-full min-w-0 rounded-lg px-3 py-2.5 text-sm" />
                                    </div>
                                </div>
                                <p className="text-xs text-slate-500">Tanggal ujian ditentukan saat menjadwalkan bank soal, sesuai periode folder.</p>
                            </ModalBody>
                            <ModalFooter>
                                <Button variant="outline" size="sm" disabled={isSaving || readOnly} onClick={() => setIsCreatingSession(false)}>Batal</Button>
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
                                    {!period.is_locked && !readOnly && (
                                        <Button type="button" variant="ghost" size="sm" className="shrink-0 text-slate-500 hover:text-red-600"
                                            onClick={() => void handleDeleteSession(session.id)}
                                            disabled={isSaving || isSessionInUse} aria-label={`Hapus sesi ${session.name}`}
                                            title={isSessionInUse ? 'Sesi masih dipakai jadwal dan tidak dapat dihapus' : 'Hapus sesi'} leftIcon={<Trash2 size={15} />} />
                                    )}
                                </div>
                            </div>;
                        })}
                    </div>}
                </div>
            )}

        </div>
    );
}
