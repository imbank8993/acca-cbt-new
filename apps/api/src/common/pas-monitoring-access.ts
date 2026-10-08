import { ServiceUnavailableException } from '@nestjs/common';
import type { DbService } from '../prisma/prisma-db-adapter';

/** Resolve assignments through school-owned periods, never client metadata. */
export async function assignedPasExamIds(db: DbService, userId: string, organizationId: string): Promise<string[]> {
    const read = async (query: PromiseLike<any>): Promise<any[]> => {
        const result = await query;
        if (result.error) throw new ServiceUnavailableException('Penugasan pengawas belum dapat diperiksa.');
        return result.data || [];
    };
    const assignments = await read(db.from('cbt_pas_room_invigilators').select('pas_room_id').eq('user_id', userId));
    if (!assignments.length) return [];
    const rooms = await read(db.from('cbt_pas_rooms').select('pas_period_id').in('id', assignments.map(row => row.pas_room_id)));
    if (!rooms.length) return [];
    const periods = await read(db.from('cbt_pas_periods').select('id').eq('organization_id', organizationId)
        .in('id', rooms.map(row => row.pas_period_id)));
    if (!periods.length) return [];
    const schedules = await read(db.from('cbt_pas_class_schedules').select('exam_id')
        .in('pas_period_id', periods.map(row => row.id)));
    return [...new Set<string>(schedules.map(row => row.exam_id).filter(Boolean))];
}
