import { ServiceUnavailableException } from '@nestjs/common';
import type { DbService } from '../prisma/prisma-db-adapter';
import { chunk } from './chunk';

export function isPasMonitoringExam(exam: { exam_type?: string | null }): boolean {
    return ['pas', 'pat', 'pts', 'pkn'].includes(exam.exam_type || '');
}

/** Resolve rooms and their actual occupants through school-owned periods and sessions. */
export async function assignedPasExamStudents(db: DbService, userId: string, organizationId: string): Promise<Map<string, string[]>> {
    const read = async (query: PromiseLike<any>): Promise<any[]> => {
        const result = await query;
        if (result.error) throw new ServiceUnavailableException('Penugasan pengawas belum dapat diperiksa.');
        return result.data || [];
    };
    const readIds = async (table: string, columns: string, key: string, ids: string[]) => {
        const rows: any[] = [];
        for (const batch of chunk([...new Set(ids)], 300)) rows.push(...await read(db.from(table).select(columns).in(key, batch)));
        return rows;
    };
    const access = new Map<string, string[]>();
    const assignments = (await read(db.from('cbt_pas_room_invigilators').select('pas_room_id, session_id').eq('user_id', userId)))
        .filter(row => row.session_id);
    if (!assignments.length) return access;
    const rooms = await readIds('cbt_pas_rooms', 'id, name, pas_period_id', 'id', assignments.map(row => row.pas_room_id));
    if (!rooms.length) return access;
    const periods = await read(db.from('cbt_pas_periods').select('id').eq('organization_id', organizationId)
        .in('id', [...new Set(rooms.map(row => row.pas_period_id))]));
    if (!periods.length) return access;
    const periodIds = new Set(periods.map(row => row.id));
    const schoolRooms = rooms.filter(room => periodIds.has(room.pas_period_id));
    const schedules = (await readIds('cbt_pas_class_schedules', 'exam_id, pas_period_id, session_id, room', 'pas_period_id', [...periodIds]))
        .filter(row => row.exam_id);
    if (!schedules.length) return access;
    const [allocations, targets, individuals] = await Promise.all([
        readIds('cbt_pas_room_students', 'pas_room_id, pas_period_id, user_id', 'pas_room_id', schoolRooms.map(room => room.id)),
        readIds('cbt_exam_targets', 'exam_id, class_id, additional_class_id', 'exam_id', schedules.map(row => row.exam_id)),
        readIds('cbt_exam_participants', 'exam_id, user_id', 'exam_id', schedules.map(row => row.exam_id)),
    ]);
    const [members, additionalMembers] = await Promise.all([
        readIds('cbt_class_members', 'class_id, user_id', 'class_id', targets.map(row => row.class_id).filter(Boolean)),
        readIds('cbt_additional_class_members', 'class_id, user_id', 'class_id', targets.map(row => row.additional_class_id).filter(Boolean)),
    ]);
    const studentsByExam = new Map<string, Set<string>>();
    for (const schedule of schedules) studentsByExam.set(schedule.exam_id, new Set(individuals.filter(row => row.exam_id === schedule.exam_id).map(row => row.user_id)));
    for (const target of targets) {
        const students = studentsByExam.get(target.exam_id);
        for (const member of members) if (target.class_id && member.class_id === target.class_id) students?.add(member.user_id);
        for (const member of additionalMembers) if (target.additional_class_id && member.class_id === target.additional_class_id) students?.add(member.user_id);
    }
    const name = (value: unknown) => String(value || '').trim().toLocaleLowerCase('id-ID');
    for (const schedule of schedules) {
        for (const assignment of assignments) {
            const room = schoolRooms.find(room => room.id === assignment.pas_room_id);
            if (!room || room.pas_period_id !== schedule.pas_period_id || assignment.session_id !== schedule.session_id) continue;
            const occupants = allocations.filter(row => row.pas_room_id === room.id && row.pas_period_id === room.pas_period_id).map(row => row.user_id);
            const participants = studentsByExam.get(schedule.exam_id)!;
            // A class may span several rooms. Discover its exam via actual occupants,
            // even when the schedule's optional room label names another room.
            const relevant = occupants.filter(id => participants.has(id));
            if (!relevant.length && (!name(room.name) || name(room.name) !== name(schedule.room))) continue;
            access.set(schedule.exam_id, [...new Set([...(access.get(schedule.exam_id) || []), ...occupants])]);
        }
    }
    return access;
}

export async function assignedPasExamIds(db: DbService, userId: string, organizationId: string): Promise<string[]> {
    return [...(await assignedPasExamStudents(db, userId, organizationId)).keys()];
}
