import { BadRequestException, Injectable } from '@nestjs/common';
import type { AuthUser } from '@acca-cbt/shared';
import { AuthorizationService } from '../auth/authorization.service';
import { DbService } from '../prisma/prisma-db-adapter';
import { chunk } from '../common/chunk';
import { pasDate } from '../common/pas-period-policy';
import { normalizeSqlTime } from '../common/school-time';

const FINISHED = new Set(['submitted', 'auto_submitted', 'finished', 'completed', 'selesai']);
const ACTIVE = new Set(['in_progress', 'sedang']);

export interface PasMonitoringSlot {
    key: string;
    date: string;
    period: { id: string; name: string; type: string };
    room: { id: string; name: string; capacity: number | null };
    session: { id: string; name: string; start_time: string; end_time: string };
    invigilators: Array<{ user_id: string; full_name: string }>;
    is_mine: boolean;
    exams: Array<{ exam_id: string; schedule_id: string; bank_title: string; class_name: string; student_count: number }>;
    student_ids: string[];
    counts: { total: number; in_progress: number; finished: number; not_started: number };
}

/**
 * Monitoring ASAS/ASAT/AM per SLOT = ruang × sesi × tanggal.
 *
 * Satu slot berisi beberapa ujian (satu per kelas/bank soal yang siswanya duduk
 * di ruang itu). Daftar slot ini hanya peta; data peserta tetap diambil dari
 * endpoint peserta per ujian yang sudah ada, sehingga otorisasi, kesehatan
 * koneksi, dan tindakan pengawas tidak diduplikasi.
 */
@Injectable()
export class PasMonitoringService {
    constructor(
        private readonly db: DbService,
        private readonly authz: AuthorizationService,
    ) {}

    private async isManager(user: AuthUser, organizationId: string): Promise<boolean> {
        try {
            await this.authz.assertProktor(user, organizationId);
            return true;
        } catch {
            return false;
        }
    }

    async listSlots(user: AuthUser, organizationId: string, rawDate: string | undefined, periodId?: string) {
        await this.authz.assertOrgMonitoring(user, organizationId);
        const isManager = await this.isManager(user, organizationId);

        const read = async (query: PromiseLike<any>): Promise<any[]> => {
            const result = await query;
            if (result.error) throw new BadRequestException('Data monitoring ruang belum dapat dimuat.');
            return result.data || [];
        };
        const readIds = async (table: string, columns: string, key: string, ids: string[], extra?: (query: any) => any) => {
            const rows: any[] = [];
            for (const batch of chunk([...new Set(ids.filter(Boolean))], 300)) {
                let query = this.db.from(table).select(columns).in(key, batch);
                if (extra) query = extra(query);
                rows.push(...await read(query));
            }
            return rows;
        };
        const day = (value: unknown) => value instanceof Date ? value.toISOString().slice(0, 10) : String(value || '').slice(0, 10);

        let periodQuery = this.db.from('cbt_pas_periods').select('id, name, type').eq('organization_id', organizationId);
        if (periodId) periodQuery = periodQuery.eq('id', periodId);
        const periods = await read(periodQuery);
        const periodIds = periods.map(row => row.id);

        // Tanggal yang dapat dipilih: proktor/admin = tanggal jadwal folder;
        // pengawas = tanggal tugasnya sendiri yang memiliki jadwal.
        const allSchedules = periodIds.length
            ? await readIds('cbt_pas_class_schedules', 'id, pas_period_id, session_id, class_id, bank_id, exam_id, scheduled_date', 'pas_period_id', periodIds)
            : [];
        const scheduleDates = [...new Set(allSchedules.filter(row => row.exam_id).map(row => day(row.scheduled_date)))].filter(Boolean).sort();
        let myAssignments: any[] = [];
        if (!isManager) {
            myAssignments = (await read(this.db.from('cbt_pas_room_invigilators')
                .select('pas_room_id, session_id, exam_date').eq('user_id', user.id)))
                .filter(row => row.session_id && row.exam_date);
        }
        const availableDates = isManager
            ? scheduleDates
            : [...new Set(myAssignments.map(row => day(row.exam_date)))].filter(date => scheduleDates.includes(date)).sort();

        const date = rawDate ? pasDate(rawDate) : '';
        if (!date) return { date: '', is_manager: isManager, available_dates: availableDates, slots: [] as PasMonitoringSlot[] };

        const schedules = allSchedules.filter(row => row.exam_id && day(row.scheduled_date) === date);
        if (!schedules.length) return { date, is_manager: isManager, available_dates: availableDates, slots: [] as PasMonitoringSlot[] };

        const activePeriodIds = [...new Set(schedules.map(row => row.pas_period_id))];
        const [rooms, sessions, allocations, members, banks, classes] = await Promise.all([
            readIds('cbt_pas_rooms', 'id, name, capacity, pas_period_id', 'pas_period_id', activePeriodIds),
            readIds('cbt_pas_sessions', 'id, name, start_time, end_time, pas_period_id', 'pas_period_id', activePeriodIds),
            readIds('cbt_pas_room_students', 'pas_room_id, pas_period_id, user_id', 'pas_period_id', activePeriodIds),
            readIds('cbt_class_members', 'class_id, user_id', 'class_id', schedules.map(row => row.class_id)),
            readIds('cbt_question_banks', 'id, title', 'id', schedules.map(row => row.bank_id)),
            readIds('cbt_classes', 'id, name', 'id', schedules.map(row => row.class_id)),
        ]);
        const invigilatorRows = (await readIds('cbt_pas_room_invigilators', 'pas_room_id, session_id, exam_date, user_id', 'pas_room_id', rooms.map(row => row.id)))
            .filter(row => row.session_id && day(row.exam_date) === date);
        const [profiles, attempts] = await Promise.all([
            readIds('cbt_profiles', 'id, full_name', 'id', invigilatorRows.map(row => row.user_id)),
            readIds('cbt_exam_attempts', 'exam_id, user_id, status', 'exam_id', schedules.map(row => row.exam_id)),
        ]);

        const nameById = new Map(profiles.map(row => [row.id, row.full_name || 'Pengawas']));
        const bankTitle = new Map(banks.map(row => [row.id, row.title || 'Bank soal']));
        const className = new Map(classes.map(row => [row.id, row.name || 'Kelas']));
        const classMembers = new Map<string, Set<string>>();
        for (const row of members) {
            if (!classMembers.has(row.class_id)) classMembers.set(row.class_id, new Set());
            classMembers.get(row.class_id)!.add(row.user_id);
        }
        const attemptState = new Map<string, 'active' | 'finished'>();
        for (const row of attempts) {
            const key = `${row.exam_id}:${row.user_id}`;
            if (ACTIVE.has(row.status)) attemptState.set(key, 'active');
            else if (FINISHED.has(row.status) && attemptState.get(key) !== 'active') attemptState.set(key, 'finished');
        }

        const slots: PasMonitoringSlot[] = [];
        for (const period of periods.filter(row => activePeriodIds.includes(row.id))) {
            const periodSchedules = schedules.filter(row => row.pas_period_id === period.id);
            const periodSessions = sessions.filter(row => row.pas_period_id === period.id);
            for (const session of periodSessions) {
                const sessionSchedules = periodSchedules.filter(row => row.session_id === session.id);
                if (!sessionSchedules.length) continue;
                for (const room of rooms.filter(row => row.pas_period_id === period.id)) {
                    const occupants = new Set(allocations
                        .filter(row => row.pas_room_id === room.id && row.pas_period_id === period.id)
                        .map(row => row.user_id));
                    const exams: PasMonitoringSlot['exams'] = [];
                    const studentExam = new Map<string, string>();
                    for (const schedule of sessionSchedules) {
                        const seated = [...(classMembers.get(schedule.class_id) || [])].filter(id => occupants.has(id));
                        if (!seated.length) continue;
                        for (const id of seated) if (!studentExam.has(id)) studentExam.set(id, schedule.exam_id);
                        exams.push({
                            exam_id: schedule.exam_id,
                            schedule_id: schedule.id,
                            bank_title: bankTitle.get(schedule.bank_id) || 'Bank soal',
                            class_name: className.get(schedule.class_id) || 'Kelas',
                            student_count: seated.length,
                        });
                    }
                    if (!exams.length) continue;
                    const invigilators = invigilatorRows
                        .filter(row => row.pas_room_id === room.id && row.session_id === session.id)
                        .map(row => ({ user_id: row.user_id as string, full_name: nameById.get(row.user_id) || 'Pengawas' }));
                    const isMine = invigilators.some(row => row.user_id === user.id);
                    if (!isManager && !isMine) continue;
                    const studentIds = [...studentExam.keys()].sort();
                    let active = 0, finished = 0;
                    for (const [id, examId] of studentExam) {
                        const state = attemptState.get(`${examId}:${id}`);
                        if (state === 'active') active++;
                        else if (state === 'finished') finished++;
                    }
                    slots.push({
                        key: `${period.id}:${room.id}:${session.id}:${date}`,
                        date,
                        period: { id: period.id, name: period.name || 'Folder ujian', type: period.type || 'pas' },
                        room: { id: room.id, name: room.name, capacity: room.capacity ?? null },
                        session: {
                            id: session.id,
                            name: session.name,
                            start_time: normalizeSqlTime(session.start_time) || '',
                            end_time: normalizeSqlTime(session.end_time) || '',
                        },
                        invigilators,
                        is_mine: isMine,
                        exams,
                        student_ids: studentIds,
                        counts: { total: studentIds.length, in_progress: active, finished, not_started: studentIds.length - active - finished },
                    });
                }
            }
        }
        slots.sort((a, b) => a.session.start_time.localeCompare(b.session.start_time)
            || a.session.name.localeCompare(b.session.name, 'id')
            || a.room.name.localeCompare(b.room.name, 'id', { numeric: true }));
        return { date, is_manager: isManager, available_dates: availableDates, slots };
    }
}
