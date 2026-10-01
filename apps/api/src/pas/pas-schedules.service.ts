import {
    BadRequestException,
    ConflictException,
    Injectable,
    Logger,
    NotFoundException,
} from '@nestjs/common';
import type { AuthUser } from '@acca-cbt/shared';
import { AuthorizationService } from '../auth/authorization.service';
import {
    deriveRequestUuid,
    insertIdempotently,
    insertIdempotentlyWithStatus,
} from '../common/idempotent-create';
import { assertExamsHaveNoHistory, lockExamsForDeletion } from '../common/exam-deletion';
import { dateTimeToUtc } from '../common/school-time';
import { advisoryTransactionLock } from '../common/transaction-lock';
import { DbService, type DbSession } from '../prisma/prisma-db-adapter';
import { SettingsService } from '../settings/settings.service';
import type { CreatePASScheduleDto, CreatePASSessionDto } from './dto/pas.dto';

/**
 * Jadwal kelas dan sesi waktu sebuah periode PAS, serta pembangkitan ujiannya.
 *
 * Dipindahkan dari `apps/web/app/actions/pas.ts`. `updatePASScheduleAction`
 * tidak ikut karena tidak punya pemanggil.
 */
@Injectable()
export class PasSchedulesService {
    private readonly logger = new Logger(PasSchedulesService.name);

    constructor(
        private readonly db: DbService,
        private readonly authz: AuthorizationService,
        private readonly settings?: SettingsService,
    ) {}

    // ── Sesi ─────────────────────────────────────────────────────────────────

    async listSessions(user: AuthUser, periodId: string) {
        await this.authz.assertStaffByRecord(user, 'cbt_pas_periods', periodId);

        const { data, error } = await this.db
            .from('cbt_pas_sessions')
            .select('id, name, start_time, end_time')
            .eq('pas_period_id', periodId)
            .order('start_time');

        if (error) {
            this.logger.error(`Gagal membaca daftar sesi: ${error.message}`);
            return [];
        }
        return (data as any[]) || [];
    }

    async createSession(user: AuthUser, periodId: string, dto: CreatePASSessionDto) {
        await this.authz.assertProktorByRecord(user, 'cbt_pas_periods', periodId);

        if (dto.end_time <= dto.start_time) {
            throw new BadRequestException('Jam selesai sesi harus setelah jam mulai.');
        }

        return this.db.transaction(async (db) => {
            await this.lockPeriod(db, periodId);
            await this.assertPeriodUnlocked(db, periodId);

            const name = dto.name.trim();
            if (!name) throw new BadRequestException('Nama sesi wajib diisi.');

            const data = await insertIdempotently<{ id: string }>(db, {
                table: 'cbt_pas_sessions',
                scope: { column: 'pas_period_id', value: periodId },
                clientRequestId: dto.clientRequestId,
                fingerprint: { ...dto, name },
                select: 'id',
                payload: {
                    pas_period_id: periodId,
                    name,
                    start_time: dto.start_time,
                    end_time: dto.end_time,
                },
            });

            return { id: data.id };
        });
    }

    async removeSession(user: AuthUser, sessionId: string) {
        await this.authz.assertProktorByParent(
            user,
            'cbt_pas_sessions',
            sessionId,
            'pas_period_id',
            'cbt_pas_periods',
        );

        const { data: source } = await this.db.from('cbt_pas_sessions')
            .select('pas_period_id').eq('id', sessionId).maybeSingle();
        if (!source) throw new NotFoundException('Sesi tidak ditemukan.');
        const periodId = (source as { pas_period_id: string }).pas_period_id;

        return this.db.transaction(async (db) => {
            await this.lockPeriod(db, periodId);
            await this.assertPeriodUnlocked(db, periodId);

            const { data: session, error: sessionError } = await db.from('cbt_pas_sessions')
                .select('id').eq('id', sessionId).eq('pas_period_id', periodId).maybeSingle();
            if (sessionError) throw new BadRequestException(`Gagal membaca sesi: ${sessionError.message}`);
            if (!session) throw new NotFoundException('Sesi tidak ditemukan.');

            const { data: schedule, error: scheduleError } = await db
                .from('cbt_pas_class_schedules')
                .select('id')
                .eq('session_id', sessionId)
                .limit(1)
                .maybeSingle();
            if (scheduleError) {
                throw new BadRequestException(`Gagal memeriksa pemakaian sesi: ${scheduleError.message}`);
            }
            if (schedule) {
                throw new ConflictException(
                    'Sesi masih dipakai oleh jadwal. Hapus jadwal terkait terlebih dahulu.',
                );
            }

            const { error } = await db.from('cbt_pas_sessions')
                .delete().eq('id', sessionId).eq('pas_period_id', periodId);
            if (error) throw new BadRequestException(`Gagal menghapus sesi: ${error.message}`);

            return { id: sessionId };
        });
    }

    // ── Jadwal kelas ─────────────────────────────────────────────────────────

    async addSchedule(user: AuthUser, dto: CreatePASScheduleDto) {
        await this.authz.assertProktorByRecord(user, 'cbt_pas_periods', dto.pas_period_id);

        return this.db.transaction(async (db) => {
            await this.lockPeriod(db, dto.pas_period_id);
            const { data: period, error: periodError } = await db
                .from('cbt_pas_periods')
                .select('organization_id, is_locked, start_date, end_date')
                .eq('id', dto.pas_period_id)
                .maybeSingle();

            if (periodError) throw new BadRequestException(`Gagal membaca periode: ${periodError.message}`);
            if (!period) throw new NotFoundException('Periode tidak ditemukan.');

            const row = period as {
                organization_id: string;
                is_locked: boolean;
                start_date: string;
                end_date: string;
            };
            if (row.is_locked) throw new ConflictException('Periode sudah dikunci.');

            // Tanggal harus di dalam rentang periode. Batas akhirnya inklusif:
            // kolomnya bertipe `date`, jadi hari terakhir periode tetap sah.
            const scheduled = new Date(dto.scheduled_date);
            const end = new Date(row.end_date);
            end.setHours(23, 59, 59, 999);

            if (scheduled < new Date(row.start_date) || scheduled > end) {
                throw new BadRequestException(
                    `Tanggal harus dalam rentang periode (${row.start_date} s/d ${row.end_date}).`,
                );
            }

            // Jam diturunkan dari sesi. Menyalinnya dari browser membuat sesi
            // dan jadwal dapat menyimpang.
            const { data: session, error: sessionError } = await db
                .from('cbt_pas_sessions')
                .select('start_time, end_time')
                .eq('id', dto.session_id)
                .eq('pas_period_id', dto.pas_period_id)
                .maybeSingle();

            if (sessionError) throw new BadRequestException(`Gagal membaca sesi: ${sessionError.message}`);
            if (!session) throw new NotFoundException('Sesi tidak ditemukan pada periode ini.');

            const [{ data: bank }, { data: cls }, { data: subject }] = await Promise.all([
                db
                    .from('cbt_question_banks')
                    .select('id')
                    .eq('id', dto.bank_id)
                    .eq('organization_id', row.organization_id)
                    .maybeSingle(),
                db
                    .from('cbt_classes')
                    .select('id')
                    .eq('id', dto.class_id)
                    .eq('organization_id', row.organization_id)
                    .maybeSingle(),
                dto.subject_id
                    ? db.from('cbt_subjects').select('id')
                        .eq('id', dto.subject_id)
                        .eq('organization_id', row.organization_id)
                        .eq('is_active', true)
                        .maybeSingle()
                    : Promise.resolve({ data: null }),
            ]);

            if (!bank) throw new NotFoundException('Bank soal tidak ditemukan pada sekolah ini.');
            if (!cls) throw new NotFoundException('Kelas tidak ditemukan pada sekolah ini.');
            if (dto.subject_id && !subject) {
                throw new NotFoundException('Mata pelajaran aktif tidak ditemukan pada sekolah ini.');
            }

            const times = session as { start_time: string; end_time: string };

            const data = await insertIdempotently<{ id: string }>(db, {
                table: 'cbt_pas_class_schedules',
                scope: { column: 'pas_period_id', value: dto.pas_period_id },
                clientRequestId: dto.clientRequestId,
                fingerprint: dto,
                select: 'id',
                payload: {
                    pas_period_id: dto.pas_period_id,
                    bank_id: dto.bank_id,
                    subject_id: dto.subject_id || null,
                    class_id: dto.class_id,
                    scheduled_date: dto.scheduled_date,
                    session_id: dto.session_id,
                    scheduled_time: times.start_time,
                    window_end_time: times.end_time,
                    duration_minutes: dto.duration_override || 90,
                    room: dto.room || null,
                    status: 'scheduled',
                },
                mapError: (error) => error.code === '23505'
                    ? new ConflictException('Kelas sudah punya jadwal untuk bank soal ini.')
                    : new BadRequestException(`Gagal menyimpan jadwal: ${error.message}`),
            });

            return { id: data.id };
        });
    }

    async removeSchedule(user: AuthUser, scheduleId: string) {
        await this.authz.assertProktorByParent(
            user,
            'cbt_pas_class_schedules',
            scheduleId,
            'pas_period_id',
            'cbt_pas_periods',
        );

        const { data: source } = await this.db
            .from('cbt_pas_class_schedules')
            .select('pas_period_id')
            .eq('id', scheduleId)
            .maybeSingle();
        if (!source) throw new NotFoundException('Jadwal tidak ditemukan.');
        const periodId = (source as { pas_period_id: string }).pas_period_id;

        return this.db.transaction(async (db) => {
            await this.lockPeriod(db, periodId);
            await advisoryTransactionLock(db, `pas-exam-generation:${scheduleId}`);

            await this.assertPeriodUnlocked(db, periodId);

            const { data: schedule } = await db
                .from('cbt_pas_class_schedules')
                .select('status, exam_id')
                .eq('id', scheduleId)
                .eq('pas_period_id', periodId)
                .maybeSingle();
            if (!schedule) throw new NotFoundException('Jadwal tidak ditemukan.');

            const row = schedule as { status: string | null; exam_id: string | null };
            if (row.status === 'active') {
                throw new ConflictException('Jadwal sedang aktif. Tidak bisa dihapus.');
            }

            if (row.exam_id) {
                await lockExamsForDeletion(db, [row.exam_id]);
                await assertExamsHaveNoHistory(db, [row.exam_id]);
            }

            const { error } = await db.from('cbt_pas_class_schedules')
                .delete().eq('id', scheduleId);
            if (error) throw new BadRequestException(`Gagal menghapus jadwal: ${error.message}`);

            if (row.exam_id) {
                const { error: examError } = await db.from('cbt_exams').delete().eq('id', row.exam_id);
                if (examError) throw new BadRequestException(`Gagal menghapus ujian: ${examError.message}`);
            }

            return { id: scheduleId };
        });
    }

    // ── Pembangkitan ujian ───────────────────────────────────────────────────

    /**
     * Ubah jadwal terpilih menjadi `cbt_exams` sungguhan.
     *
     * Seperti pada ujian folder, satu jadwal yang gagal tidak menghentikan
     * sisanya. Berbeda dari versi lama, tiap id diperiksa otorisasinya sendiri:
     * dulu hanya id PERTAMA yang diperiksa, sehingga satu daftar bisa memuat
     * jadwal milik sekolah lain dan tetap dibangkitkan.
     */
    async generate(user: AuthUser, scheduleIds: string[]) {
        let created = 0;
        const skipped: string[] = [];

        for (const scheduleId of [...new Set(scheduleIds)]) {
            try {
                await this.authz.assertProktorByParent(
                    user,
                    'cbt_pas_class_schedules',
                    scheduleId,
                    'pas_period_id',
                    'cbt_pas_periods',
                );

                const reason = await this.generateOne(scheduleId);
                if (reason) skipped.push(reason);
                else created++;
            } catch (err) {
                skipped.push(`${scheduleId}: ${(err as Error).message}`);
            }
        }

        return { created, skipped };
    }

    /** Mengembalikan alasan jika dilewati, atau `null` bila ujian berhasil dibuat. */
    private async generateOne(scheduleId: string): Promise<string | null> {
        const { data: source } = await this.db.from('cbt_pas_class_schedules')
            .select('pas_period_id').eq('id', scheduleId).maybeSingle();
        if (!source) return `${scheduleId}: jadwal tidak ditemukan`;
        const sourcePeriodId = (source as { pas_period_id: string }).pas_period_id;

        return this.db.transaction(async (db) => {
            await this.lockPeriod(db, sourcePeriodId);
            await advisoryTransactionLock(db, `pas-exam-generation:${scheduleId}`);

            const { data } = await db
                .from('cbt_pas_class_schedules')
                .select('*')
                .eq('id', scheduleId)
                .maybeSingle();

            if (!data) return `${scheduleId}: jadwal tidak ditemukan`;

            const schedule = data as any;
            if (schedule.exam_id) return `${scheduleId}: ujian sudah pernah dibangkitkan`;

            const { data: period } = await db
                .from('cbt_pas_periods')
                .select('organization_id, name, type, school_year, semester, is_locked')
                .eq('id', schedule.pas_period_id)
                .maybeSingle();

            if (!period) return `${scheduleId}: periode tidak ditemukan`;

            const periodRow = period as any;
            if (periodRow.is_locked) return `${scheduleId}: periode terkunci`;
            const [{ data: bank }, { data: cls }] = await Promise.all([
                schedule.bank_id
                    ? db.from('cbt_question_banks').select('title').eq('id', schedule.bank_id)
                        .eq('organization_id', periodRow.organization_id).maybeSingle()
                    : Promise.resolve({ data: null }),
                schedule.class_id
                    ? db.from('cbt_classes').select('name').eq('id', schedule.class_id)
                        .eq('organization_id', periodRow.organization_id).maybeSingle()
                    : Promise.resolve({ data: null }),
            ]);

            if (!bank) return `${scheduleId}: bank soal bukan milik sekolah periode`;
            if (!cls) return `${scheduleId}: kelas bukan milik sekolah periode`;

            const duration = schedule.duration_minutes || 90;
            const closeTime = schedule.window_end_time || schedule.scheduled_time;
            const timeZone = (await this.settings?.getSchoolTimeZone?.()) || 'Asia/Jakarta';
            const startTime = dateTimeToUtc(schedule.scheduled_date, schedule.scheduled_time, timeZone);
            const endTime = dateTimeToUtc(schedule.scheduled_date, closeTime, timeZone);
            if (!startTime || !endTime || new Date(endTime) <= new Date(startTime)) {
                return `${scheduleId}: jendela waktu ujian tidak valid`;
            }

            const payload = {
                organization_id: periodRow.organization_id,
                question_bank_id: schedule.bank_id,
                subject_id: schedule.subject_id || null,
                title: (bank as { title?: string }).title || 'Ujian',
                description:
                    `Kelas ${(cls as { name?: string }).name || 'N/A'} | ` +
                    `${periodRow.school_year} | ${String(periodRow.type || '').toUpperCase()} ${periodRow.semester}`,
                duration_minutes: duration,
                start_time: startTime,
                end_time: endTime,
                randomize_questions: true,
                randomize_options: true,
                show_results: false,
                is_published: false,
                status: 'scheduled',
                exam_type: periodRow.type || 'pas',
                metadata: {
                    is_safe_mode: true,
                    is_pas_exam: true,
                    pas_schedule_id: scheduleId,
                    window_open: schedule.scheduled_time,
                    window_close: closeTime,
                    exam_duration: duration,
                },
            };

            const { data: exam } = await insertIdempotentlyWithStatus<{ id: string }>(db, {
                table: 'cbt_exams',
                organizationId: periodRow.organization_id,
                clientRequestId: deriveRequestUuid(scheduleId, 2901),
                fingerprint: payload,
                payload,
                select: 'id',
            });

            const { data: existingTarget, error: targetReadError } = await db
                .from('cbt_exam_targets')
                .select('id')
                .eq('exam_id', exam.id)
                .eq('class_id', schedule.class_id)
                .limit(1)
                .maybeSingle();
            if (targetReadError) {
                throw new BadRequestException(`Gagal memeriksa target kelas: ${targetReadError.message}`);
            }
            if (!existingTarget) {
                const { error: targetError } = await db
                    .from('cbt_exam_targets')
                    .insert({ exam_id: exam.id, class_id: schedule.class_id });
                if (targetError) {
                    throw new BadRequestException(`Gagal menetapkan kelas: ${targetError.message}`);
                }
            }

            const { error: linkError } = await db
                .from('cbt_pas_class_schedules')
                .update({ exam_id: exam.id })
                .eq('id', scheduleId);
            if (linkError) throw new BadRequestException(`Gagal menautkan ujian: ${linkError.message}`);

            return null;
        });
    }

    private lockPeriod(db: DbSession, periodId: string): Promise<void> {
        return advisoryTransactionLock(db, `pas-period:${periodId}`);
    }

    private async assertPeriodUnlocked(db: DbSession, periodId: string): Promise<void> {
        const { data: period, error } = await db.from('cbt_pas_periods')
            .select('is_locked').eq('id', periodId).maybeSingle();
        if (error) throw new BadRequestException(`Gagal membaca periode: ${error.message}`);
        if (!period) throw new NotFoundException('Periode tidak ditemukan.');
        if ((period as { is_locked: boolean }).is_locked) {
            throw new ConflictException('Periode sudah dikunci.');
        }
    }

}
