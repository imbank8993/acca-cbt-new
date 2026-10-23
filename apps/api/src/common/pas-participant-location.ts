import { BadRequestException } from '@nestjs/common';
import type { DbService } from '../prisma/prisma-db-adapter';
import { chunk } from './chunk';
import { isPasMonitoringExam } from './pas-monitoring-access';
import { pasDate } from './pas-period-policy';

export interface PasParticipantLocation {
    status: 'assigned' | 'unassigned' | 'unavailable';
    room_id: string | null;
    room_name: string | null;
    session_id: string | null;
    session_name: string | null;
    invigilators: Array<{ id: string; full_name: string | null }>;
}

/** Current placement, not the optional room label on a class schedule. Call after monitoring authorization. */
export async function loadPasParticipantLocations(db: DbService, exam: {
    id: string; exam_type?: string | null; organization_id?: string | null;
}, studentIds: string[]): Promise<Map<string, PasParticipantLocation>> {
    const locations = new Map<string, PasParticipantLocation>();
    if (!isPasMonitoringExam(exam) || !studentIds.length) return locations;
    const empty = (status: PasParticipantLocation['status']): PasParticipantLocation => ({
        status, room_id: null, room_name: null, session_id: null, session_name: null, invigilators: [],
    });
    for (const id of studentIds) locations.set(id, empty('unavailable'));
    const read = async (query: PromiseLike<any>): Promise<any[]> => {
        const result = await query;
        if (result.error) throw new BadRequestException('Penempatan ruang belum dapat dibaca.');
        return result.data || [];
    };
    const readIds = async (table: string, columns: string, key: string, ids: string[], periodId?: string) => {
        const rows: any[] = [];
        for (const batch of chunk([...new Set(ids)], 300)) {
            let query = db.from(table).select(columns).in(key, batch);
            if (periodId) query = query.eq('pas_period_id', periodId);
            rows.push(...await read(query));
        }
        return rows;
    };
    // A failed placement read must not hide the monitoring roster or imply that no room was assigned.
    try {
        const schedules = await read(db.from('cbt_pas_class_schedules')
            .select('pas_period_id, session_id, scheduled_date').eq('exam_id', exam.id));
        const contexts = [...new Map(schedules.map(row => [`${row.pas_period_id}:${row.session_id}:${row.scheduled_date}`, row])).values()];
        if (contexts.length !== 1 || !contexts[0].pas_period_id || !contexts[0].session_id || !contexts[0].scheduled_date || !exam.organization_id) return locations;
        const { pas_period_id: periodId, session_id: sessionId } = contexts[0];
        // Pengawas bergilir per hari: ambil yang bertugas pada tanggal ujian ini.
        const examDate = pasDate(contexts[0].scheduled_date);
        const periods = await read(db.from('cbt_pas_periods').select('id').eq('id', periodId).eq('organization_id', exam.organization_id));
        if (!periods.length) return locations;
        const [sessions, rooms, allocations] = await Promise.all([
            read(db.from('cbt_pas_sessions').select('id, name').eq('id', sessionId).eq('pas_period_id', periodId)),
            read(db.from('cbt_pas_rooms').select('id, name').eq('pas_period_id', periodId)),
            readIds('cbt_pas_room_students', 'user_id, pas_room_id', 'user_id', studentIds, periodId),
        ]);
        if (sessions.length !== 1) return locations;
        const roomById = new Map(rooms.map(room => [room.id, room]));
        const relevantRooms = [...new Set<string>(allocations.map(row => row.pas_room_id).filter(id => roomById.has(id)))];
        const assignments: any[] = [];
        for (const batch of chunk(relevantRooms, 300)) assignments.push(...await read(db.from('cbt_pas_room_invigilators')
            .select('pas_room_id, user_id').in('pas_room_id', batch).eq('session_id', sessionId).eq('exam_date', examDate)));
        const profiles = await readIds('cbt_profiles', 'id, full_name', 'id', assignments.map(row => row.user_id));
        const names = new Map(profiles.map(profile => [profile.id, profile.full_name || null]));
        const allocationByStudent = new Map<string, any[]>();
        for (const row of allocations) allocationByStudent.set(row.user_id, [...(allocationByStudent.get(row.user_id) || []), row]);
        const proctorsByRoom = new Map<string, Set<string>>();
        for (const row of assignments) {
            if (!proctorsByRoom.has(row.pas_room_id)) proctorsByRoom.set(row.pas_room_id, new Set());
            proctorsByRoom.get(row.pas_room_id)!.add(row.user_id);
        }
        for (const id of studentIds) {
            const rows = allocationByStudent.get(id) || [];
            const room = rows.length === 1 ? roomById.get(rows[0].pas_room_id) : null;
            locations.set(id, { ...empty(rows.length && !room ? 'unavailable' : room ? 'assigned' : 'unassigned'),
                session_id: sessionId, session_name: sessions[0].name || null,
                room_id: room?.id || null, room_name: room?.name || null,
                invigilators: room ? [...(proctorsByRoom.get(room.id) || [])]
                    .map(id => ({ id, full_name: names.get(id) || null })) : [],
            });
        }
    } catch { /* The UI explicitly shows unavailable instead of an incorrect room/proctor. */ }
    return locations;
}
