import { ServiceUnavailableException } from '@nestjs/common';
import type { DbService } from '../prisma/prisma-db-adapter';

/** Resolve assignments through school-owned periods, never client metadata. */
export async function assignedPasExamIds(db: DbService, userId: string, organizationId: string): Promise<string[]> {
    const read = async (query: PromiseLike<any>): Promise<any[]> => {
        const result = await query;
        if (result.error) throw new ServiceUnavailableException('Penugasan pengawas belum dapat diperiksa.');
        return result.data || [];
    };
    const assignments = (await read(db.from('cbt_pas_room_invigilators').select('pas_room_id, session_id').eq('user_id', userId)))
        .filter(row => row.session_id);
    if (!assignments.length) return [];
    const rooms = await read(db.from('cbt_pas_rooms').select('id, name, pas_period_id').in('id', assignments.map(row => row.pas_room_id)));
    if (!rooms.length) return [];
    const periods = await read(db.from('cbt_pas_periods').select('id').eq('organization_id', organizationId)
        .in('id', rooms.map(row => row.pas_period_id)));
    if (!periods.length) return [];
    const schedules = await read(db.from('cbt_pas_class_schedules').select('exam_id, pas_period_id, session_id, room')
        .in('pas_period_id', periods.map(row => row.id)));
    const name = (value: unknown) => String(value || '').trim().toLocaleLowerCase('id-ID');
    return [...new Set<string>(schedules.filter(schedule => assignments.some(assignment => {
        const room = rooms.find(room => room.id === assignment.pas_room_id);
        return room && room.pas_period_id === schedule.pas_period_id &&
            assignment.session_id === schedule.session_id && name(room.name) !== '' && name(room.name) === name(schedule.room);
    })).map(row => row.exam_id).filter(Boolean))];
}
