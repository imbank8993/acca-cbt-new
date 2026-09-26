"use client";
import React, { useState, useEffect } from 'react';
import { X, Plus, Trash2, Users, AlertCircle, Save, Check } from 'lucide-react';
import {
    listPASRooms,
    createPASRoomAction,
    deletePASRoomAction,
    assignProctorsToRoomAction,
    assignStudentsToRoomAction,
    removeStudentFromRoomAction,
    listTeachersAndInvigilators,
    listPASSessions,
    createPASSessionAction,
    deletePASSessionAction
} from '@/lib/api/pas';
import { listOrganizationClasses, getStudentsByClassAction } from '@/lib/api/proctor';

interface RoomManagementModalProps {
    period: any;
    orgId: string;
    onClose: () => void;
}

export default function RoomManagementModal({ period, orgId, onClose }: RoomManagementModalProps) {
    const [rooms, setRooms] = useState<any[]>([]);
    const [teachers, setTeachers] = useState<any[]>([]);
    const [classes, setClasses] = useState<any[]>([]);
    const [sessions, setSessions] = useState<any[]>([]);
    
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
    const [selectedRoom, setSelectedRoom] = useState<any | null>(null);

    // State for assignments in the selected room
    const [selectedProctorIds, setSelectedProctorIds] = useState<string[]>([]);
    
    // Student assignment state
    const [selectedClassId, setSelectedClassId] = useState('');
    const [classStudents, setClassStudents] = useState<any[]>([]);
    const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>([]);
    
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        loadData();
    }, [period.id, orgId]);

    const loadData = async () => {
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
    };

    const handleCreateRoom = async () => {
        if (!newRoomName.trim()) return;
        setIsSaving(true);
        const result = await createPASRoomAction(period.id, newRoomName, newRoomCapacity);
        if (result.success) {
            setNewRoomName('');
            setNewRoomCapacity(30);
            setIsCreatingRoom(false);
            await loadData();
        } else {
            alert(result.error);
        }
        setIsSaving(false);
    };

    const handleDeleteRoom = async (roomId: string) => {
        if (!confirm('Yakin ingin menghapus ruang ini? Semua pengaturan pengawas dan siswa di dalamnya akan hilang.')) return;
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

    const handleSelectRoom = (room: any) => {
        setSelectedRoom(room);
        setSelectedProctorIds(room.pas_room_invigilators?.map((i: any) => i.user_id) || []);
    };

    const handleSaveProctors = async () => {
        if (!selectedRoom) return;
        setIsSaving(true);
        const result = await assignProctorsToRoomAction(selectedRoom.id, selectedProctorIds);
        if (result.success) {
            await loadData();
            // Update selected room reference
            const updatedRoom = await listPASRooms(period.id).then(res => res.find(r => r.id === selectedRoom.id));
            if (updatedRoom) handleSelectRoom(updatedRoom);
            alert('Pengawas berhasil disimpan!');
        } else {
            alert(result.error);
        }
        setIsSaving(false);
    };

    const handleLoadClassStudents = async (classId: string) => {
        setSelectedClassId(classId);
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
        setIsSaving(true);
        const result = await assignStudentsToRoomAction(period.id, selectedRoom.id, selectedStudentIds);
        if (result.success) {
            await loadData();
            const updatedRoom = await listPASRooms(period.id).then(res => res.find(r => r.id === selectedRoom.id));
            if (updatedRoom) handleSelectRoom(updatedRoom);
            setSelectedStudentIds([]);
            alert('Siswa berhasil ditambahkan!');
        } else {
            alert(result.error);
        }
        setIsSaving(false);
    };

    const handleRemoveStudent = async (userId: string) => {
        if (!selectedRoom) return;
        setIsSaving(true);
        const result = await removeStudentFromRoomAction(period.id, userId);
        if (result.success) {
            await loadData();
            const updatedRoom = await listPASRooms(period.id).then(res => res.find(r => r.id === selectedRoom.id));
            if (updatedRoom) handleSelectRoom(updatedRoom);
        } else {
            alert(result.error);
        }
        setIsSaving(false);
    };

    const handleCreateSession = async () => {
        if (!newSessionName.trim() || !newSessionStart || !newSessionEnd) return;
        setIsSaving(true);
        const result = await createPASSessionAction(period.id, newSessionName, newSessionStart, newSessionEnd);
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
        if (!confirm('Yakin ingin menghapus sesi ini?')) return;
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
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="w-full max-w-4xl bg-white rounded-2xl shadow-2xl flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-300 overflow-hidden">
                <div className="flex items-center justify-between p-4 border-b border-slate-100 bg-slate-50/50">
                    <div>
                        <h2 className="text-lg font-bold text-slate-800">Manajemen Ruangan & Sesi</h2>
                        <p className="text-sm text-slate-500">Periode: {period.name}</p>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-slate-200 rounded-full text-slate-500">
                        <X size={20} />
                    </button>
                </div>
                
                <div className="flex border-b border-slate-200 px-4 pt-2 bg-slate-50/30">
                    <button
                        onClick={() => setActiveTab('rooms')}
                        className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'rooms' ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
                    >
                        Ruangan & Pengawas
                    </button>
                    <button
                        onClick={() => setActiveTab('sessions')}
                        className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'sessions' ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
                    >
                        Sesi Ujian
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-6">
                    {activeTab === 'rooms' && (
                        <>
                            {/* Room List Section */}
                    <div>
                        <div className="flex items-center justify-between mb-3">
                            <h3 className="font-semibold text-slate-700 flex items-center gap-2">
                                <Users size={18} className="text-indigo-500" />
                                Daftar Ruang Ujian
                            </h3>
                            <button
                                onClick={() => setIsCreatingRoom(!isCreatingRoom)}
                                className="text-sm text-indigo-600 hover:text-indigo-700 font-medium flex items-center gap-1"
                            >
                                <Plus size={16} /> Tambah Ruang
                            </button>
                        </div>

                        {isCreatingRoom && (
                            <div className="p-3 mb-4 bg-indigo-50 border border-indigo-100 rounded-xl flex gap-2 items-end">
                                <div className="flex-1">
                                    <label className="block text-xs font-medium text-slate-600 mb-1">Nama Ruang</label>
                                    <input
                                        type="text"
                                        value={newRoomName}
                                        onChange={e => setNewRoomName(e.target.value)}
                                        placeholder="Misal: Ruang 01"
                                        className="w-full border border-slate-200 rounded-lg p-2 text-sm outline-none focus:border-indigo-500"
                                    />
                                </div>
                                <div className="w-24">
                                    <label className="block text-xs font-medium text-slate-600 mb-1">Kapasitas</label>
                                    <input
                                        type="number"
                                        value={newRoomCapacity}
                                        onChange={e => setNewRoomCapacity(parseInt(e.target.value) || 0)}
                                        className="w-full border border-slate-200 rounded-lg p-2 text-sm outline-none focus:border-indigo-500"
                                    />
                                </div>
                                <button
                                    onClick={handleCreateRoom}
                                    disabled={!newRoomName.trim() || isSaving}
                                    className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
                                >
                                    Simpan
                                </button>
                            </div>
                        )}

                        {isLoading ? (
                            <div className="text-center py-4 text-slate-400 text-sm">Memuat data...</div>
                        ) : rooms.length === 0 ? (
                            <div className="text-center py-6 bg-slate-50 border border-dashed border-slate-200 rounded-xl text-slate-500 text-sm">
                                Belum ada ruang yang dibuat.
                            </div>
                        ) : (
                            <div className="grid grid-cols-2 gap-3">
                                {rooms.map(room => (
                                    <div
                                        key={room.id}
                                        onClick={() => handleSelectRoom(room)}
                                        className={`p-3 rounded-xl border cursor-pointer transition-all ${
                                            selectedRoom?.id === room.id
                                                ? 'border-indigo-500 bg-indigo-50 ring-1 ring-indigo-500'
                                                : 'border-slate-200 bg-white hover:border-indigo-300'
                                        }`}
                                    >
                                        <div className="flex justify-between items-start">
                                            <span className="font-semibold text-slate-800">{room.name}</span>
                                            <button
                                                onClick={(e) => { e.stopPropagation(); handleDeleteRoom(room.id); }}
                                                className="text-slate-400 hover:text-red-500 p-1"
                                            >
                                                <Trash2 size={14} />
                                            </button>
                                        </div>
                                        <div className="mt-2 text-xs text-slate-500 space-y-1">
                                            <div>Siswa: <span className={room.pas_room_students?.length > room.capacity ? 'text-red-500 font-bold' : ''}>{room.pas_room_students?.length || 0} / {room.capacity}</span></div>
                                            <div>Pengawas: {room.pas_room_invigilators?.length || 0}</div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Room Details & Assignment */}
                    {selectedRoom && (
                        <div className="border-t border-slate-200 pt-6 animate-in fade-in duration-300">
                            <h3 className="font-semibold text-slate-800 text-lg mb-4">Pengaturan {selectedRoom.name}</h3>

                            {/* Proctor Assignment */}
                            <div className="mb-6 bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
                                <div className="flex items-center justify-between mb-3">
                                    <h4 className="font-medium text-slate-700 text-sm">Pengawas Ruang</h4>
                                    <button
                                        onClick={handleSaveProctors}
                                        disabled={isSaving}
                                        className="text-xs bg-indigo-100 text-indigo-700 px-3 py-1 rounded-full font-medium hover:bg-indigo-200 flex items-center gap-1"
                                    >
                                        <Save size={12} /> Simpan Pengawas
                                    </button>
                                </div>
                                <div className="max-h-40 overflow-y-auto border border-slate-100 rounded-lg p-2 space-y-1">
                                    {teachers.length === 0 ? (
                                        <div className="text-xs text-slate-400 p-2">Tidak ada daftar guru/pengawas.</div>
                                    ) : (
                                        teachers.map(teacher => (
                                            <label key={teacher.id} className="flex items-center gap-2 p-2 hover:bg-slate-50 rounded cursor-pointer">
                                                <input
                                                    type="checkbox"
                                                    checked={selectedProctorIds.includes(teacher.id)}
                                                    onChange={(e) => {
                                                        if (e.target.checked) setSelectedProctorIds([...selectedProctorIds, teacher.id]);
                                                        else setSelectedProctorIds(selectedProctorIds.filter(id => id !== teacher.id));
                                                    }}
                                                    className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                                                />
                                                <span className="text-sm text-slate-700">{teacher.name}</span>
                                                <span className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded uppercase">{teacher.roles.join(', ')}</span>
                                            </label>
                                        ))
                                    )}
                                </div>
                            </div>

                            {/* Student List */}
                            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
                                <div className="flex items-center justify-between mb-3">
                                    <h4 className="font-medium text-slate-700 text-sm">Daftar Siswa di Ruang Ini</h4>
                                    <span className="text-xs font-medium px-2 py-1 bg-slate-100 rounded-full text-slate-600">
                                        Total: {selectedRoom.pas_room_students?.length || 0}
                                    </span>
                                </div>
                                
                                <div className="mb-4 space-y-3 bg-slate-50 p-3 rounded-xl border border-slate-200">
                                    <h5 className="text-xs font-semibold text-slate-600">Tambah Siswa dari Kelas</h5>
                                    <select
                                        value={selectedClassId}
                                        onChange={e => handleLoadClassStudents(e.target.value)}
                                        className="w-full border border-slate-300 rounded-lg p-2 text-sm outline-none focus:border-indigo-500"
                                    >
                                        <option value="">-- Pilih Kelas --</option>
                                        {classes.map(c => (
                                            <option key={c.id} value={c.id}>{c.name}</option>
                                        ))}
                                    </select>
                                    
                                    {selectedClassId && (
                                        <div className="space-y-2">
                                            <div className="max-h-40 overflow-y-auto border border-slate-200 rounded bg-white p-2 text-sm space-y-1">
                                                {classStudents.length === 0 ? (
                                                    <div className="text-slate-400 p-2 text-xs">Tidak ada siswa di kelas ini.</div>
                                                ) : (
                                                    classStudents.map(student => (
                                                        <label key={student.id} className="flex items-center gap-2 p-1 hover:bg-slate-50 cursor-pointer">
                                                            <input
                                                                type="checkbox"
                                                                checked={selectedStudentIds.includes(student.id)}
                                                                onChange={e => {
                                                                    if (e.target.checked) setSelectedStudentIds([...selectedStudentIds, student.id]);
                                                                    else setSelectedStudentIds(selectedStudentIds.filter(id => id !== student.id));
                                                                }}
                                                                className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                                                            />
                                                            <span className="text-slate-700">{student.name}</span>
                                                        </label>
                                                    ))
                                                )}
                                            </div>
                                            <button
                                                onClick={handleAddStudentsToRoom}
                                                disabled={selectedStudentIds.length === 0 || isSaving}
                                                className="w-full bg-indigo-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
                                            >
                                                Tambahkan {selectedStudentIds.length} Siswa ke Ruang
                                            </button>
                                        </div>
                                    )}
                                </div>

                                <div className="max-h-60 overflow-y-auto border border-slate-100 rounded-lg divide-y divide-slate-100">
                                    {(!selectedRoom.pas_room_students || selectedRoom.pas_room_students.length === 0) ? (
                                        <div className="text-xs text-slate-400 p-4 text-center">Belum ada siswa di ruang ini.</div>
                                    ) : (
                                        selectedRoom.pas_room_students.map((student: any) => (
                                            <div key={student.user_id} className="flex items-center justify-between p-2 hover:bg-slate-50">
                                                <span className="text-sm text-slate-700">{student.profiles?.full_name || 'Tanpa Nama'}</span>
                                                <button
                                                    onClick={() => handleRemoveStudent(student.user_id)}
                                                    className="text-slate-400 hover:text-red-500"
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
                    </>
                    )}

                    {activeTab === 'sessions' && (
                        <div className="animate-in fade-in duration-300">
                            <div className="flex items-center justify-between mb-4">
                                <div>
                                    <h3 className="font-semibold text-slate-700">Daftar Sesi Ujian</h3>
                                    <p className="text-xs text-slate-500">Pilih sesi saat membuat jadwal kelas.</p>
                                </div>
                                <button
                                    onClick={() => setIsCreatingSession(!isCreatingSession)}
                                    className="text-sm bg-indigo-600 text-white hover:bg-indigo-700 px-3 py-1.5 rounded-lg font-medium flex items-center gap-1 transition-colors"
                                >
                                    <Plus size={16} /> Tambah Sesi
                                </button>
                            </div>

                            {isCreatingSession && (
                                <div className="p-4 mb-4 bg-indigo-50 border border-indigo-100 rounded-xl grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
                                    <div className="sm:col-span-2">
                                        <label className="block text-xs font-medium text-slate-600 mb-1">Nama Sesi</label>
                                        <input
                                            type="text"
                                            value={newSessionName}
                                            onChange={e => setNewSessionName(e.target.value)}
                                            placeholder="Misal: Sesi 1"
                                            className="w-full border border-slate-200 rounded-lg p-2 text-sm outline-none focus:border-indigo-500"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-medium text-slate-600 mb-1">Jam Mulai</label>
                                        <input
                                            type="time"
                                            value={newSessionStart}
                                            onChange={e => setNewSessionStart(e.target.value)}
                                            className="w-full border border-slate-200 rounded-lg p-2 text-sm outline-none focus:border-indigo-500"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-medium text-slate-600 mb-1">Jam Selesai</label>
                                        <input
                                            type="time"
                                            value={newSessionEnd}
                                            onChange={e => setNewSessionEnd(e.target.value)}
                                            className="w-full border border-slate-200 rounded-lg p-2 text-sm outline-none focus:border-indigo-500"
                                        />
                                    </div>
                                    <div className="sm:col-span-4 flex justify-end gap-2 mt-2">
                                        <button
                                            onClick={() => setIsCreatingSession(false)}
                                            className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800"
                                        >
                                            Batal
                                        </button>
                                        <button
                                            onClick={handleCreateSession}
                                            disabled={!newSessionName.trim() || isSaving}
                                            className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
                                        >
                                            Simpan Sesi
                                        </button>
                                    </div>
                                </div>
                            )}

                            {isLoading ? (
                                <div className="text-center py-4 text-slate-400 text-sm">Memuat data...</div>
                            ) : sessions.length === 0 ? (
                                <div className="text-center py-8 bg-slate-50 border border-dashed border-slate-200 rounded-xl text-slate-500 text-sm">
                                    Belum ada sesi yang dibuat. Silakan tambah sesi ujian.
                                </div>
                            ) : (
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    {sessions.map(session => (
                                        <div
                                            key={session.id}
                                            className="p-4 rounded-xl border border-slate-200 bg-white hover:border-indigo-300 transition-all flex items-center justify-between group"
                                        >
                                            <div>
                                                <div className="font-semibold text-slate-800 mb-1">{session.name}</div>
                                                <div className="text-xs text-slate-500 font-medium">
                                                    {session.start_time.substring(0, 5)} - {session.end_time.substring(0, 5)}
                                                </div>
                                            </div>
                                            <button
                                                onClick={() => handleDeleteSession(session.id)}
                                                className="text-slate-300 hover:text-red-500 p-2 opacity-0 group-hover:opacity-100 transition-opacity"
                                                title="Hapus Sesi"
                                            >
                                                <Trash2 size={16} />
                                            </button>
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
