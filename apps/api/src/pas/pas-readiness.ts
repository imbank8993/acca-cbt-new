import type { DbService } from '../prisma/prisma-db-adapter';
import { chunk } from '../common/chunk';
import { normalizeSqlTime } from '../common/school-time';

export interface PasReadiness { ready: boolean; issues: string[]; activated: boolean | null; room_ids?: string[] }

/** Operational completeness is separate from exam generation and live/finished status. */
export async function loadPasReadiness(db: Pick<DbService, 'from'>, period: any, schedules: any[]): Promise<Map<string, PasReadiness>> {
    const results = new Map<string, PasReadiness>();
    if (!schedules.length) return results;
    const read = async (query: PromiseLike<any>) => {
        const result = await query;
        if (result.error) throw new Error('Data kesiapan belum dapat diperiksa');
        return (result.data || []) as any[];
    };
    const readIds = async (table: string, columns: string, key: string, ids: string[], school = false) => {
        const rows: any[] = [];
        for (const batch of chunk([...new Set(ids.filter(Boolean))], 300)) {
            let query = db.from(table).select(columns).in(key, batch);
            if (school) query = query.eq('organization_id', period.organization_id);
            rows.push(...await read(query));
        }
        return rows;
    };
    const date = (value: any) => value instanceof Date ? value.toISOString().slice(0, 10) : String(value || '').slice(0, 10);
    const minutes = (value: any) => {
        const time = normalizeSqlTime(value) || '';
        return /^\d{2}:\d{2}(:\d{2})?$/.test(time || '') ? Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5)) : NaN;
    };
    try {
        const bankIds = schedules.map(row => row.bank_id);
        const [banks, questions, classes, members, sessions, rooms, allocations, exams, targets] = await Promise.all([
            readIds('cbt_question_banks', 'id', 'id', bankIds, true),
            readIds('cbt_bank_questions', 'bank_id, metadata', 'bank_id', bankIds),
            readIds('cbt_classes', 'id', 'id', schedules.map(row => row.class_id), true),
            readIds('cbt_class_members', 'class_id, user_id', 'class_id', schedules.map(row => row.class_id)),
            read(db.from('cbt_pas_sessions').select('id, start_time, end_time').eq('pas_period_id', period.id)),
            read(db.from('cbt_pas_rooms').select('id, name, capacity').eq('pas_period_id', period.id)),
            read(db.from('cbt_pas_room_students').select('user_id, pas_room_id').eq('pas_period_id', period.id)),
            readIds('cbt_exams', 'id, question_bank_id, is_published, status', 'id', schedules.map(row => row.exam_id), true),
            readIds('cbt_exam_targets', 'exam_id, class_id', 'exam_id', schedules.map(row => row.exam_id)),
        ]);
        const assignments = await readIds('cbt_pas_room_invigilators', 'pas_room_id, session_id, user_id', 'pas_room_id', rooms.map(row => row.id));
        const bankSet = new Set(banks.map(row => row.id));
        const nonemptyBanks = new Set(questions.filter(row => !row.metadata?._deleted).map(row => row.bank_id));
        const classSet = new Set(classes.map(row => row.id));
        const roomById = new Map(rooms.map(row => [row.id, row]));
        const studentsByClass = new Map<string, Set<string>>();
        for (const row of members) {
            if (!studentsByClass.has(row.class_id)) studentsByClass.set(row.class_id, new Set());
            studentsByClass.get(row.class_id)!.add(row.user_id);
        }
        const allocationsByUser = new Map<string, any[]>();
        const occupantsByRoom = new Map<string, Set<string>>();
        for (const row of allocations) {
            allocationsByUser.set(row.user_id, [...(allocationsByUser.get(row.user_id) || []), row]);
            if (!occupantsByRoom.has(row.pas_room_id)) occupantsByRoom.set(row.pas_room_id, new Set());
            occupantsByRoom.get(row.pas_room_id)!.add(row.user_id);
        }
        const guarded = new Set(assignments.filter(row => row.session_id && row.user_id).map(row => `${row.pas_room_id}:${row.session_id}`));
        for (const schedule of schedules) {
            const issues: string[] = [];
            if (!bankSet.has(schedule.bank_id)) issues.push('Bank soal belum dipilih atau tidak tersedia');
            else if (!nonemptyBanks.has(schedule.bank_id)) issues.push('Bank soal belum berisi soal');
            if (!classSet.has(schedule.class_id)) issues.push('Kelas tujuan tidak tersedia');
            const students = studentsByClass.get(schedule.class_id) || new Set<string>();
            if (!students.size) issues.push('Kelas belum memiliki peserta');
            const session = sessions.find(row => row.id === schedule.session_id);
            const start = minutes(schedule.scheduled_time), end = minutes(schedule.window_end_time);
            if (!session) issues.push('Sesi ujian belum ditentukan atau tidak tersedia');
            else if (!(start >= minutes(session.start_time) && end <= minutes(session.end_time) && end > start)) issues.push('Waktu ujian tidak sesuai sesi');
            const scheduled = date(schedule.scheduled_date);
            if (!/^\d{4}-\d{2}-\d{2}$/.test(scheduled) || scheduled < date(period.start_date) || scheduled > date(period.end_date)) issues.push('Tanggal ujian di luar periode folder');
            if (!(Number.isInteger(schedule.duration_minutes) && schedule.duration_minutes > 0 && schedule.duration_minutes <= end - start)) issues.push('Durasi ujian tidak sesuai waktu yang tersedia');
            const relevantRooms = new Set<string>();
            let missing = 0;
            for (const userId of students) {
                const rows = allocationsByUser.get(userId) || [];
                if (rows.length !== 1 || !roomById.has(rows[0].pas_room_id)) missing++;
                else relevantRooms.add(rows[0].pas_room_id);
            }
            if (missing) issues.push(`${missing} peserta belum dialokasikan ke ruang ujian. Atur peserta pada tab Ruang`);
            for (const roomId of relevantRooms) {
                const room = roomById.get(roomId)!;
                if (!(Number(room.capacity) > 0) || (occupantsByRoom.get(roomId)?.size || 0) > Number(room.capacity)) issues.push(`Kapasitas ${room.name} tidak mencukupi`);
                if (!guarded.has(`${roomId}:${schedule.session_id}`)) issues.push(`Pengawas ${room.name} belum diatur pada sesi ini`);
            }
            const exam = exams.find(row => row.id === schedule.exam_id);
            if (schedule.exam_id && !exam) issues.push('Data ujian terhubung tidak tersedia');
            if (exam) {
                if (['archived', 'cancelled'].includes(exam.status)) issues.push('Ujian diarsipkan atau dibatalkan');
                if (exam.question_bank_id !== schedule.bank_id || !targets.some(row => row.exam_id === exam.id && row.class_id === schedule.class_id)) issues.push('Bank soal atau target kelas ujian belum sesuai jadwal');
            }
            if (schedule.status === 'cancelled') issues.push('Jadwal dibatalkan');
            results.set(schedule.id, { ready: issues.length === 0, issues, activated: exam?.is_published === true, room_ids: [...relevantRooms] });
        }
    } catch {
        for (const schedule of schedules) results.set(schedule.id, { ready: false, issues: ['Data kelengkapan belum dapat diperiksa. Muat ulang daftar.'], activated: schedule.exam_id ? null : false });
    }
    return results;
}
