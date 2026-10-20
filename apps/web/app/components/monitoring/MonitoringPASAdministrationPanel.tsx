'use client';

import { useEffect, useState } from 'react';
import { AlertCircle, ClipboardCheck, Loader2 } from 'lucide-react';
import PASAdministrationPanel from '@/app/components/pas/PASAdministrationPanel';
import {
    getPASPeriod,
    listMyPASAssignments,
    listPASRooms,
    listPASSessions,
    type PASAssignmentSlotSummary,
    type PASRoom,
} from '@/lib/api/pas';
import type { ExamAttemptRecord, OrganizationExam } from '@/lib/api/proctor';
import type { PASPeriod, PASSession } from '@/app/types/pas';

type StaffRole = 'admin' | 'proktor' | 'pengawas';

interface MonitoringPASAdministrationPanelProps {
    exam: OrganizationExam;
    attempts: ExamAttemptRecord[];
    userRole: StaffRole;
}

type EditorData = {
    period: NonNullable<PASPeriod | PASAssignmentSlotSummary['period']>;
    rooms: Array<Pick<PASRoom, 'id' | 'name' | 'capacity'>>;
    sessions: Array<Pick<PASSession, 'id' | 'name' | 'start_time' | 'end_time'>>;
    initialRoomId?: string;
    initialSessionId?: string;
    initialExamDate?: string;
};

export function MonitoringPASAdministrationPanel({ exam, attempts, userRole }: MonitoringPASAdministrationPanelProps) {
    const [data, setData] = useState<EditorData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const metadata = exam.metadata as Record<string, unknown> | null | undefined;
    const periodId = typeof metadata?.pas_period_id === 'string' ? metadata.pas_period_id : '';
    const scheduleId = typeof metadata?.pas_schedule_id === 'string' ? metadata.pas_schedule_id : '';
    const preferredLocation = attempts.find(item => item.pas_location?.room_id)?.pas_location;
    const preferredRoomId = preferredLocation?.room_id || '';
    const preferredRoomSessionId = preferredLocation?.session_id || '';

    useEffect(() => {
        let active = true;
        const load = async () => {
            setLoading(true);
            setError('');
            setData(null);
            if (!periodId) {
                setError('Periode PAS/AM untuk ujian ini tidak ditemukan.');
                setLoading(false);
                return;
            }

            try {
                let period: PASPeriod | PASAssignmentSlotSummary['period'];
                let rooms: EditorData['rooms'];
                let sessions: EditorData['sessions'];
                let initialRoomId: string | undefined;
                let initialSessionId: string | undefined;
                let initialExamDate: string | undefined;

                if (userRole === 'pengawas') {
                    const assignments = await listMyPASAssignments();
                    const eligible = assignments.filter(item => item.period.id === periodId);
                    if (!eligible.length) throw new Error('Tidak ada penugasan ruang dan sesi untuk ujian PAS/AM ini.');

                    let fullPeriod: PASPeriod | null = null;
                    try { fullPeriod = await getPASPeriod(periodId); } catch { /* Penugasan sendiri tetap cukup untuk membuka absensi. */ }
                    period = fullPeriod || eligible[0].period;
                    const schedule = fullPeriod?.pas_class_schedules?.find(item => item.id === scheduleId);
                    initialExamDate = schedule?.scheduled_date?.split('T')[0] || undefined;
                    initialSessionId = schedule?.session_id || undefined;
                    const sessionAssignments = eligible.filter(item => !initialSessionId || item.session.id === initialSessionId);
                    const datedAssignments = sessionAssignments.filter(item => !initialExamDate || item.scheduled_dates.includes(initialExamDate));
                    const choices = datedAssignments.length ? datedAssignments : sessionAssignments.length ? sessionAssignments : eligible;
                    const participantRoom = preferredRoomId &&
                        (!initialSessionId || !preferredRoomSessionId || preferredRoomSessionId === initialSessionId)
                        ? preferredRoomId : undefined;
                    const selectedAssignment = choices.find(item => item.room.id === participantRoom) || choices[0];
                    initialSessionId = selectedAssignment.session.id;
                    initialRoomId = selectedAssignment.room.id;
                    if (!initialExamDate) initialExamDate = selectedAssignment.scheduled_dates[0];
                    rooms = [...new Map(eligible.map(item => [item.room.id, {
                        id: item.room.id, name: item.room.name, capacity: item.room.capacity,
                    }])).values()];
                    sessions = [...new Map(eligible.map(item => [item.session.id, {
                        id: item.session.id, name: item.session.name,
                        start_time: item.session.start_time, end_time: item.session.end_time,
                    }])).values()];
                } else {
                    const [fullPeriod, periodRooms, periodSessions] = await Promise.all([
                        getPASPeriod(periodId), listPASRooms(periodId), listPASSessions(periodId),
                    ]);
                    if (!fullPeriod) throw new Error('Periode PAS/AM tidak ditemukan.');
                    period = fullPeriod;
                    rooms = periodRooms.map(room => ({ id: room.id, name: room.name, capacity: room.capacity }));
                    sessions = periodSessions.map(session => ({
                        id: session.id, name: session.name, start_time: session.start_time, end_time: session.end_time,
                    }));
                    const schedule = fullPeriod.pas_class_schedules?.find(item => item.id === scheduleId);
                    initialSessionId = schedule?.session_id || undefined;
                    initialExamDate = schedule?.scheduled_date?.split('T')[0] || undefined;
                    const participantRoom = preferredRoomId &&
                        (!initialSessionId || !preferredRoomSessionId || preferredRoomSessionId === initialSessionId)
                        ? preferredRoomId : undefined;
                    const scheduledRoom = schedule?.allocated_room_ids?.find(id => rooms.some(room => room.id === id));
                    initialRoomId = [participantRoom, scheduledRoom].find(id => id && rooms.some(room => room.id === id));
                }

                if (active) setData({ period, rooms, sessions, initialRoomId, initialSessionId, initialExamDate });
            } catch (loadError) {
                if (active) setError(loadError instanceof Error ? loadError.message : 'Data absensi dan berita acara belum dapat dimuat.');
            } finally {
                if (active) setLoading(false);
            }
        };

        const timer = window.setTimeout(() => void load(), 0);
        return () => {
            active = false;
            window.clearTimeout(timer);
        };
    }, [periodId, scheduleId, userRole, preferredRoomId, preferredRoomSessionId]);

    const title = exam.exam_type?.toLowerCase() === 'am' ? 'Administrasi AM' : 'Administrasi ASAS';

    return (
        <section className="mb-5 rounded-xl border border-blue-200 bg-white p-4 shadow-sm sm:p-5">
            <div className="mb-3 flex items-center gap-2">
                <ClipboardCheck size={18} className="text-blue-600" />
                <div>
                    <h2 className="text-sm font-bold text-slate-800">{title}: Absensi & Berita Acara</h2>
                </div>
            </div>
            {loading ? (
                <div className="flex items-center gap-2 rounded-lg bg-slate-50 p-4 text-sm text-slate-500"><Loader2 size={16} className="animate-spin" /> Memuat data administrasi ujian…</div>
            ) : error ? (
                <div role="alert" className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800"><AlertCircle size={16} className="mt-0.5 shrink-0" /> {error}</div>
            ) : data ? (
                <PASAdministrationPanel
                    key={`${exam.id}-${data.initialRoomId || ''}-${data.initialSessionId || ''}`}
                    period={data.period}
                    rooms={data.rooms}
                    sessions={data.sessions}
                    initialRoomId={data.initialRoomId}
                    initialSessionId={data.initialSessionId}
                    initialExamDate={data.initialExamDate}
                    openOnEditor
                    userRole={userRole}
                />
            ) : null}
        </section>
    );
}
