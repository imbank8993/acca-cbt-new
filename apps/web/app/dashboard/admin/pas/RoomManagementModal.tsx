"use client";
import { deleteConfirmDialog } from '@/lib/confirm-dialog';
import { PASRoomInput } from "@/app/components/PASRoomInput";
import {
    assignProctorsToRoomAction,
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
    removeStudentFromRoomAction
} from '@/lib/api/pas';
import {
    type ClassStudent,
    getStudentsByClassAction,
    listOrganizationClasses,
    type OrganizationClass,
} from '@/lib/api/proctor';
import type { PASPeriod, PASSession } from '@/app/types/pas';
import { InlineSelect } from '@/components/ui/InlineSelect';
import { MultiSelect } from '@/components/ui/MultiSelect';
import { formatStudentName } from '@/lib/monitoring-health';
import { getSchoolTimeZoneLabel } from '@/lib/school-time';
import { useSchoolTimeZone } from '@/lib/useSchoolTimeZone';
import {
    Check,
    Clock,
    DoorOpen,
    FolderOpen,
    Loader2,
    Plus,
    Save,
    ShieldCheck,
    Trash2,
    UserCheck,
    Users,
    X,
    AlertCircle
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

interface RoomManagementModalProps {
    period: PASPeriod;
    onClose: () => void;
}

export default function RoomManagementModal({ period, onClose }: RoomManagementModalProps) {
    const { timeZone, error: timeZoneError } = useSchoolTimeZone();
    const [rooms, setRooms] = useState<PASRoom[]>([]);
    const [teachers, setTeachers] = useState<PASStaffMember[]>([]);
    const [classes, setClasses] = useState<OrganizationClass[]>([]);
    const [sessions, setSessions] = useState<PASSession[]>([]);
    
    // Tab State
    const [activeTab, setActiveTab] = useState<'rooms' | 'sessions'>('rooms');

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
    const [selectedRoom, setSelectedRoom] = useState<PASRoom | null>(null);

    // State for assignments in the selected room
    const [selectedProctorIds, setSelectedProctorIds] = useState<string[]>([]);
    
    // Student assignment state
    const [selectedClassId, setSelectedClassId] = useState('');
    const [classStudents, setClassStudents] = useState<ClassStudent[]>([]);
    const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>([]);
    
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [isProctorSaved, setIsProctorSaved] = useState(false);

    const assignedStudentIds = new Set<string>(
        selectedRoom?.pas_room_students?.map((student) => student.user_id) || [],
    );
    const remainingCapacity = selectedRoom
        ? Math.max(0, Number(selectedRoom.capacity || 0) - assignedStudentIds.size)
        : 0;
    const newStudentCount = [...new Set(selectedStudentIds)]
        .filter((id) => !assignedStudentIds.has(id)).length;
    const exceedsCapacity = newStudentCount > remainingCapacity;

    const loadData = useCallback(async () => {
        setIsLoading(true);
        try {
            const [roomList, teacherList, classList, sessionList] = await Promise.all([
                listPASRooms(period.id),
                listTeachersAndInvigilators(),
                listOrganizationClasses({ activeYearOnly: true }),
                listPASSessions(period.id)
            ]);
            setRooms(roomList);
            setTeachers(teacherList);
            setClasses(classList);
            setSessions(sessionList);
        } catch (error) {
            console.error('Failed to load room data', error);
        }
        setIsLoading(false);
    }, [period.id]);

    useEffect(() => {
        const initialLoad = window.setTimeout(() => void loadData(), 0);
        return () => window.clearTimeout(initialLoad);
    }, [loadData]);

    const handleCreateRoom = async () => {
        if (!newRoomName.trim()) return;
        setIsSaving(true);
        const result = await createPASRoomAction(period.id, newRoomName.trim(), newRoomCapacity);
        if (result.success) {
            setNewRoomName('');
            setNewRoomCapacity(30);
            setIsCreatingRoom(false);
            await loadData();
            const updatedRooms = await listPASRooms(period.id);
            if (result.id) {
                const found = updatedRooms.find(r => r.id === result.id);
                if (found) handleSelectRoom(found);
            }
        } else {
            alert(result.error);
        }
        setIsSaving(false);
    };

    const handleDeleteRoom = async (roomId: string) => {
        if (!await deleteConfirmDialog('Hapus Ruang Ujian?', 'Hapus ruang ini beserta seluruh pengaturan pengawas dan siswa di dalamnya?')) return;
        setIsSaving(true);
        const result = await deletePASRoomAction(roomId);
        if (result.success) {
            if (selectedRoom?.id === roomId) setSelectedRoom(null);
            await loadData();
        } else {
            alert(result.error);
        }
        setIsSaving(false);
    };

    const handleSelectRoom = (room: PASRoom) => {
        setSelectedRoom(room);
        setSelectedProctorIds(room.pas_room_invigilators?.map((invigilator) => invigilator.user_id) || []);
        setIsProctorSaved(false);
    };

    const handleSaveProctors = async () => {
        if (!selectedRoom) return;
        setIsSaving(true);
        const result = await assignProctorsToRoomAction(selectedRoom.id, selectedProctorIds);
        if (result.success) {
            await loadData();
            const updatedRooms = await listPASRooms(period.id);
            const updatedRoom = updatedRooms.find(r => r.id === selectedRoom.id);
            if (updatedRoom) handleSelectRoom(updatedRoom);
            setIsProctorSaved(true);
            setTimeout(() => setIsProctorSaved(false), 3000);
        } else {
            alert(result.error);
        }
        setIsSaving(false);
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
            await loadData();
            const updatedRooms = await listPASRooms(period.id);
            const updatedRoom = updatedRooms.find(r => r.id === selectedRoom.id);
            if (updatedRoom) handleSelectRoom(updatedRoom);
            setSelectedStudentIds([]);
        } else {
            alert(result.error);
        }
        setIsSaving(false);
    };

    const handleRemoveStudent = async (userId: string) => {
        if (!selectedRoom) return;
        if (!await deleteConfirmDialog({ title: 'Keluarkan Siswa dari Ruang?', text: 'Penempatan siswa di ruang ujian ini akan dihapus. Akun siswa tetap tersedia.', confirmText: 'Ya', cancelText: 'Tidak' })) return;
        setIsSaving(true);
        const result = await removeStudentFromRoomAction(period.id, userId);
        if (result.success) {
            await loadData();
            const updatedRooms = await listPASRooms(period.id);
            const updatedRoom = updatedRooms.find(r => r.id === selectedRoom.id);
            if (updatedRoom) handleSelectRoom(updatedRoom);
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
            await loadData();
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
            await loadData();
        } else {
            alert(result.error);
        }
        setIsSaving(false);
    };

    return (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
            <div className="w-full max-w-4xl bg-white rounded-2xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden border border-slate-200 animate-in zoom-in-95 duration-200">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/50">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shrink-0">
                            <DoorOpen size={20} />
                        </div>
                        <div>
                            <h2 className="text-base font-bold text-slate-900">Manajemen Ruangan & Sesi</h2>
                            <p className="text-xs text-slate-500">Folder: <span className="font-semibold text-slate-700">{period.name}</span></p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-slate-100 rounded-xl text-slate-400 hover:text-slate-600 transition-colors"
                        title="Tutup"
                    >
                        <X size={20} />
                    </button>
                </div>
                
                {/* Tabs */}
                <div className="flex border-b border-slate-200 px-6 pt-2 bg-slate-50/30 gap-2">
                    <button
                        onClick={() => setActiveTab('rooms')}
                        className={`px-4 py-2.5 text-xs font-bold border-b-2 transition-all flex items-center gap-2 ${
                            activeTab === 'rooms'
                                ? 'border-primary text-primary'
                                : 'border-transparent text-slate-500 hover:text-slate-700'
                        }`}
                    >
                        <Users size={15} />
                        Ruangan & Pengawas
                        <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${activeTab === 'rooms' ? 'bg-primary/10 text-primary' : 'bg-slate-200 text-slate-600'}`}>
                            {rooms.length}
                        </span>
                    </button>
                    <button
                        onClick={() => setActiveTab('sessions')}
                        className={`px-4 py-2.5 text-xs font-bold border-b-2 transition-all flex items-center gap-2 ${
                            activeTab === 'sessions'
                                ? 'border-primary text-primary'
                                : 'border-transparent text-slate-500 hover:text-slate-700'
                        }`}
                    >
                        <Clock size={15} />
                        Sesi Ujian
                        <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${activeTab === 'sessions' ? 'bg-primary/10 text-primary' : 'bg-slate-200 text-slate-600'}`}>
                            {sessions.length}
                        </span>
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-6 space-y-6">
                    {timeZoneError && (
                        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700 font-medium">
                            {timeZoneError}
                        </div>
                    )}

                    {/* ─── TAB: RUANGAN & PENGAWAS ─── */}
                    {activeTab === 'rooms' && (
                        <div className="space-y-6">
                            {/* Room Header & Actions */}
                            <div>
                                <div className="flex items-center justify-between mb-3">
                                    <div>
                                        <h3 className="font-bold text-slate-800 text-sm">Daftar Ruang Ujian</h3>
                                        <p className="text-xs text-slate-400">Pilih ruangan di bawah untuk menentukan pengawas dan alokasi siswa.</p>
                                    </div>
                                    <button
                                        onClick={() => setIsCreatingRoom(!isCreatingRoom)}
                                        className="text-xs bg-primary text-white hover:bg-primary/90 px-3.5 py-2 rounded-xl font-semibold flex items-center gap-1.5 shadow-xs transition-all"
                                    >
                                        <Plus size={15} /> Tambah Ruang
                                    </button>
                                </div>

                                {/* Form Buat Ruang */}
                                {isCreatingRoom && (
                                    <div className="p-4 mb-4 bg-slate-50 border border-slate-200 rounded-2xl flex flex-col sm:flex-row gap-3 items-end">
                                        <div className="flex-1 w-full">
                                            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Nama Ruang *</label>
                                            <PASRoomInput value={newRoomName} onChange={setNewRoomName} onCapacityChange={setNewRoomCapacity} />
                                        </div>
                                        <div className="w-full sm:w-32">
                                            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Kapasitas Kursi</label>
                                            <input
                                                type="number"
                                                min="1"
                                                value={newRoomCapacity}
                                                onChange={e => setNewRoomCapacity(parseInt(e.target.value) || 0)}
                                                className="w-full h-[40px] px-3.5 bg-white border border-slate-200 rounded-xl text-sm text-slate-800 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20"
                                            />
                                        </div>
                                        <div className="flex gap-2 w-full sm:w-auto">
                                            <button
                                                type="button"
                                                onClick={() => setIsCreatingRoom(false)}
                                                className="px-3.5 py-2 h-[40px] text-xs font-semibold text-slate-600 hover:bg-slate-200 rounded-xl transition-all"
                                            >
                                                Batal
                                            </button>
                                            <button
                                                type="button"
                                                onClick={handleCreateRoom}
                                                disabled={!newRoomName.trim() || isSaving}
                                                className="px-4 py-2 h-[40px] bg-primary text-white rounded-xl text-xs font-bold hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center gap-1.5 shadow-xs"
                                            >
                                                {isSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                                                Simpan
                                            </button>
                                        </div>
                                    </div>
                                )}

                                {/* Daftar Kartu Ruang */}
                                {isLoading ? (
                                    <div className="text-center py-8 text-slate-400 text-xs flex items-center justify-center gap-2">
                                        <Loader2 size={16} className="animate-spin text-primary" /> Memuat data ruangan...
                                    </div>
                                ) : rooms.length === 0 ? (
                                    <div className="text-center py-10 bg-slate-50 border border-dashed border-slate-200 rounded-2xl p-6">
                                        <DoorOpen size={36} className="mx-auto mb-2 text-slate-300" />
                                        <p className="font-bold text-slate-700 text-sm">Belum ada ruang yang dibuat</p>
                                        <p className="text-xs text-slate-400 mt-0.5 max-w-sm mx-auto">
                                            Tambahkan ruang ujian terlebih dahulu, lalu pilih ruangan untuk menetapkan pengawas dan alokasi siswa.
                                        </p>
                                        <button
                                            onClick={() => setIsCreatingRoom(true)}
                                            className="mt-3.5 px-3.5 py-1.5 text-xs bg-primary text-white rounded-xl hover:bg-primary/90 inline-flex items-center gap-1.5 font-semibold shadow-xs"
                                        >
                                            <Plus size={14} /> Tambah Ruang Baru
                                        </button>
                                    </div>
                                ) : (
                                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                                        {rooms.map(room => {
                                            const isSelected = selectedRoom?.id === room.id;
                                            const studentCount = room.pas_room_students?.length || 0;
                                            const proctorCount = room.pas_room_invigilators?.length || 0;
                                            const isOverCapacity = studentCount > room.capacity;

                                            return (
                                                <div
                                                    key={room.id}
                                                    onClick={() => handleSelectRoom(room)}
                                                    className={`p-3.5 rounded-2xl border cursor-pointer transition-all ${
                                                        isSelected
                                                            ? 'border-primary bg-primary/5 ring-2 ring-primary/20 shadow-xs'
                                                            : 'border-slate-200 bg-white hover:border-slate-300 hover:shadow-2xs'
                                                    }`}
                                                >
                                                    <div className="flex justify-between items-start">
                                                        <div className="flex items-center gap-2 min-w-0">
                                                            <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${isSelected ? 'bg-primary text-white' : 'bg-slate-100 text-slate-600'}`}>
                                                                <DoorOpen size={16} />
                                                            </div>
                                                            <span className="font-bold text-slate-800 text-sm truncate">{room.name}</span>
                                                        </div>
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); void handleDeleteRoom(room.id); }}
                                                            className="text-slate-300 hover:text-red-500 p-1 rounded-lg hover:bg-red-50 transition-colors"
                                                            title="Hapus Ruangan"
                                                        >
                                                            <Trash2 size={14} />
                                                        </button>
                                                    </div>
                                                    
                                                    <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between text-xs">
                                                        <span className={`font-semibold flex items-center gap-1 ${isOverCapacity ? 'text-red-600' : 'text-slate-600'}`}>
                                                            <Users size={12} className="text-slate-400" />
                                                            {studentCount} / {room.capacity} Siswa
                                                        </span>
                                                        <span className="font-semibold text-slate-600 flex items-center gap-1">
                                                            <ShieldCheck size={12} className="text-primary" />
                                                            {proctorCount} Pengawas
                                                        </span>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>

                            {/* ── Detail Ruang Terpilih: Pengawas & Siswa ── */}
                            {selectedRoom && (
                                <div className="border-t border-slate-200 pt-6 space-y-5 animate-in fade-in duration-200">
                                    <div className="flex items-center justify-between flex-wrap gap-2">
                                        <div>
                                            <h3 className="font-bold text-slate-800 text-base flex items-center gap-2">
                                                <span>Pengaturan: {selectedRoom.name}</span>
                                                <span className="px-2 py-0.5 bg-slate-100 text-slate-600 text-[10px] font-bold rounded-md border border-slate-200">
                                                    Kapasitas: {selectedRoom.capacity} Kursi
                                                </span>
                                            </h3>
                                            <p className="text-xs text-slate-400">Atur guru pengawas yang bertugas dan alokasi siswa untuk ruangan ini.</p>
                                        </div>
                                    </div>

                                    {/* 1. Pengawas Ruangan */}
                                    <div className="bg-slate-50/70 border border-slate-200 rounded-2xl p-4.5 space-y-3">
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-2 font-bold text-slate-800 text-xs uppercase tracking-wider">
                                                <ShieldCheck size={15} className="text-primary" />
                                                Pengawas Ruangan
                                                {selectedProctorIds.length > 0 && (
                                                    <span className="text-primary font-normal lowercase">({selectedProctorIds.length} dipilih)</span>
                                                )}
                                            </div>
                                            {isProctorSaved && (
                                                <span className="text-[11px] font-bold text-emerald-600 flex items-center gap-1">
                                                    <Check size={13} /> Pengawas Disimpan
                                                </span>
                                            )}
                                        </div>

                                        <div className="flex flex-col sm:flex-row gap-2.5 items-center">
                                            <div className="flex-1 w-full">
                                                <MultiSelect
                                                    options={teachers.map(t => ({
                                                        value: t.id,
                                                        label: `${t.name}${t.roles?.length ? ` (${t.roles.join(', ')})` : ''}`,
                                                    }))}
                                                    value={selectedProctorIds}
                                                    onChange={setSelectedProctorIds}
                                                    placeholder="— Pilih Guru / Pengawas Ruangan —"
                                                    allSelectedText="Semua Pengawas Terpilih"
                                                    height="40px"
                                                    minWidth="100%"
                                                    showQuickActions={true}
                                                />
                                            </div>
                                            <button
                                                type="button"
                                                onClick={handleSaveProctors}
                                                disabled={isSaving}
                                                className="w-full sm:w-auto h-[40px] px-4 bg-primary text-white text-xs font-bold rounded-xl hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center gap-1.5 shadow-xs shrink-0 transition-all cursor-pointer"
                                            >
                                                {isSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                                                Simpan Pengawas
                                            </button>
                                        </div>
                                    </div>

                                    {/* 2. Alokasi Siswa */}
                                    <div className="bg-slate-50/70 border border-slate-200 rounded-2xl p-4.5 space-y-4">
                                        <div className="flex items-center justify-between flex-wrap gap-2">
                                            <div className="flex items-center gap-2 font-bold text-slate-800 text-xs uppercase tracking-wider">
                                                <UserCheck size={15} className="text-primary" />
                                                Daftar Siswa di Ruangan Ini
                                            </div>
                                            <span className="text-xs font-semibold px-2.5 py-1 bg-white rounded-lg text-slate-600 border border-slate-200 shadow-2xs">
                                                Terisi: <strong className="text-slate-800">{assignedStudentIds.size}</strong> / {selectedRoom.capacity} · Sisa <strong className={remainingCapacity === 0 ? 'text-red-600' : 'text-emerald-600'}>{remainingCapacity}</strong> kursi
                                            </span>
                                        </div>

                                        {/* Pilih Siswa per Kelas */}
                                        <div className="bg-white p-3.5 rounded-xl border border-slate-200 space-y-3">
                                            <p className="text-xs font-semibold text-slate-700">Tambah Siswa ke Ruangan:</p>
                                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                                                <InlineSelect
                                                    value={selectedClassId}
                                                    onChange={val => void handleLoadClassStudents(val)}
                                                    minWidth="100%"
                                                    height="40px"
                                                    title="Pilih Kelas Asal"
                                                    options={[
                                                        { value: '', label: '— Pilih Kelas Asal —' },
                                                        ...classes.map(c => ({ value: c.id, label: c.name })),
                                                    ]}
                                                />
                                                {selectedClassId && (
                                                    <MultiSelect
                                                        options={classStudents.map(s => ({
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
                                                            {selectedStudentIds.length} siswa siap dimasukkan ke ruang ini.
                                                        </span>
                                                    )}
                                                    <button
                                                        type="button"
                                                        onClick={handleAddStudentsToRoom}
                                                        disabled={selectedStudentIds.length === 0 || exceedsCapacity || isSaving}
                                                        className="px-4 py-2 h-[38px] bg-primary text-white rounded-xl text-xs font-bold hover:bg-primary/90 disabled:opacity-50 inline-flex items-center gap-1.5 shadow-xs transition-all ml-auto cursor-pointer"
                                                    >
                                                        {isSaving ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
                                                        Tambahkan ({selectedStudentIds.length}) Siswa
                                                    </button>
                                                </div>
                                            )}
                                        </div>

                                        {/* Daftar Siswa yang Telah Masuk Ruang */}
                                        <div className="max-h-56 overflow-y-auto border border-slate-200 rounded-xl bg-white divide-y divide-slate-100">
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
                                                            title="Keluarkan dari ruang"
                                                        >
                                                            <X size={14} />
                                                        </button>
                                                    </div>
                                                ))
                                            )}
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* ─── TAB: SESI UJIAN ─── */}
                    {activeTab === 'sessions' && (
                        <div className="space-y-4 animate-in fade-in duration-200">
                            <div className="flex items-center justify-between mb-2">
                                <div>
                                    <h3 className="font-bold text-slate-800 text-sm">Daftar Sesi Ujian</h3>
                                    <p className="text-xs text-slate-400">Jam mulai dan selesai sesi ujian pada folder ini.</p>
                                </div>
                                {period.is_locked ? (
                                    <span className="text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-3 py-1.5 rounded-xl">
                                        Periode terkunci
                                    </span>
                                ) : (
                                    <button
                                        onClick={() => setIsCreatingSession(!isCreatingSession)}
                                        className="text-xs bg-primary text-white hover:bg-primary/90 px-3.5 py-2 rounded-xl font-semibold flex items-center gap-1.5 shadow-xs transition-all"
                                    >
                                        <Plus size={15} /> Tambah Sesi
                                    </button>
                                )}
                            </div>

                            {/* Form Tambah Sesi */}
                            {!period.is_locked && isCreatingSession && (
                                <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
                                    <div className="sm:col-span-2">
                                        <label className="block text-xs font-semibold text-slate-700 mb-1.5">Nama Sesi *</label>
                                        <input
                                            type="text"
                                            value={newSessionName}
                                            onChange={e => setNewSessionName(e.target.value)}
                                            placeholder="Misal: Sesi 1, Sesi Pagi"
                                            className="w-full h-[40px] px-3.5 bg-white border border-slate-200 rounded-xl text-sm text-slate-800 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-semibold text-slate-700 mb-1.5">Jam Mulai ({getSchoolTimeZoneLabel(timeZone)}) *</label>
                                        <input
                                            type="time"
                                            value={newSessionStart}
                                            onChange={e => setNewSessionStart(e.target.value)}
                                            className="w-full h-[40px] px-3 bg-white border border-slate-200 rounded-xl text-sm text-slate-800 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-semibold text-slate-700 mb-1.5">Jam Selesai ({getSchoolTimeZoneLabel(timeZone)}) *</label>
                                        <input
                                            type="time"
                                            value={newSessionEnd}
                                            onChange={e => setNewSessionEnd(e.target.value)}
                                            className="w-full h-[40px] px-3 bg-white border border-slate-200 rounded-xl text-sm text-slate-800 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20"
                                        />
                                    </div>
                                    <div className="sm:col-span-4 flex justify-end gap-2 mt-1">
                                        <button
                                            type="button"
                                            onClick={() => setIsCreatingSession(false)}
                                            className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-200 rounded-xl transition-all"
                                        >
                                            Batal
                                        </button>
                                        <button
                                            type="button"
                                            onClick={handleCreateSession}
                                            disabled={!newSessionName.trim() || isSaving}
                                            className="px-4 py-2 bg-primary text-white rounded-xl text-xs font-bold hover:bg-primary/90 disabled:opacity-50 flex items-center gap-1.5 shadow-xs"
                                        >
                                            {isSaving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                                            Simpan Sesi
                                        </button>
                                    </div>
                                </div>
                            )}

                            {/* Daftar Sesi */}
                            {isLoading ? (
                                <div className="text-center py-8 text-slate-400 text-xs flex items-center justify-center gap-2">
                                    <Loader2 size={16} className="animate-spin text-primary" /> Memuat data sesi...
                                </div>
                            ) : sessions.length === 0 ? (
                                <div className="text-center py-10 bg-slate-50 border border-dashed border-slate-200 rounded-2xl p-6">
                                    <Clock size={36} className="mx-auto mb-2 text-slate-300" />
                                    <p className="font-bold text-slate-700 text-sm">Belum ada sesi yang dibuat</p>
                                    <p className="text-xs text-slate-400 mt-0.5">Silakan tambah sesi ujian untuk digunakan saat penjadwalan kelas.</p>
                                </div>
                            ) : (
                                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                                    {sessions.map(session => (
                                        <div
                                            key={session.id}
                                            className="p-4 rounded-2xl border border-slate-200 bg-white hover:border-slate-300 transition-all flex items-center justify-between group shadow-2xs"
                                        >
                                            <div className="flex items-center gap-3">
                                                <div className="w-9 h-9 rounded-xl bg-slate-100 flex items-center justify-center text-slate-600">
                                                    <Clock size={16} className="text-primary" />
                                                </div>
                                                <div>
                                                    <div className="font-bold text-slate-800 text-sm">{session.name}</div>
                                                    <div className="text-xs text-slate-500 font-medium">
                                                        {session.start_time.substring(0, 5)} - {session.end_time.substring(0, 5)} {getSchoolTimeZoneLabel(timeZone)}
                                                    </div>
                                                </div>
                                            </div>
                                            {!period.is_locked && (
                                                <button
                                                    onClick={() => void handleDeleteSession(session.id)}
                                                    className="text-slate-300 hover:text-red-500 p-2 opacity-0 group-hover:opacity-100 transition-opacity rounded-lg hover:bg-red-50"
                                                    title="Hapus Sesi"
                                                >
                                                    <Trash2 size={15} />
                                                </button>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
