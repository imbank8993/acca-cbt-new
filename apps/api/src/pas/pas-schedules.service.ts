import {
    BadRequestException,
    ConflictException,
    Injectable,
    Logger,
    NotFoundException,
} from '@nestjs/common';
import type { AuthUser } from '@acca-cbt/shared';
import { AuthorizationService } from '../auth/authorization.service';
import { insertIdempotently } from '../common/idempotent-create';
import { wibDateTimeToUtc } from '../common/wib-time';
import { DbService } from '../prisma/prisma-db-adapter';
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

        const data = await insertIdempotently<{ id: string }>(this.db, {
            table: 'cbt_pas_sessions',
            scope: { column: 'pas_period_id', value: periodId },
            clientRequestId: dto.clientRequestId,
            fingerprint: dto,
            select: 'id',
            payload: {
                pas_period_id: periodId,
                name: dto.name,
                start_time: dto.start_time,
                end_time: dto.end_time,
            },
        });

        return { id: data.id };
    }

    async removeSession(user: AuthUser, sessionId: string) {
        await this.authz.assertProktorByParent(
            user,
            'cbt_pas_sessions',
            sessionId,
            'pas_period_id',
            'cbt_pas_periods',
        );

        const { error } = await this.db.from('cbt_pas_sessions').delete().eq('id', sessionId);
        if (error) throw new BadRequestException(error.message);

        return { id: sessionId };
    }

    // ── Jadwal kelas ─────────────────────────────────────────────────────────

    async addSchedule(user: AuthUser, dto: CreatePASScheduleDto) {
        await this.authz.assertProktorByRecord(user, 'cbt_pas_periods', dto.pas_period_id);

        const { data: period } = await this.db
            .from('cbt_pas_periods')
            .select('is_locked, start_date, end_date')
            .eq('id', dto.pas_period_id)
            .maybeSingle();

        if (!period) throw new NotFoundException('Periode tidak ditemukan.');

        const row = period as { is_locked: boolean; start_date: string; end_date: string };
        if (row.is_locked) throw new ConflictException('Periode sudah dikunci.');

        // Tanggal harus di dalam rentang periode. Batas akhirnya inklusif: kolomnya
        // bertipe `date`, jadi jadwal pada hari terakhir periode tetap sah.
        const scheduled = new Date(dto.scheduled_date);
        const end = new Date(row.end_date);
        end.setHours(23, 59, 59, 999);

        if (scheduled < new Date(row.start_date) || scheduled > end) {
            throw new BadRequestException(
                `Tanggal harus dalam rentang periode (${row.start_date} s/d ${row.end_date}).`,
            );
        }

        // Jam jadwal diturunkan dari sesinya, bukan diterima dari formulir: satu
        // sesi dipakai banyak kelas sekaligus, dan menyalin jamnya di sisi klien
        // membuat keduanya bisa menyimpang.
        const { data: session } = await this.db
            .from('cbt_pas_sessions')
            .select('start_time, end_time')
            .eq('id', dto.session_id)
            .maybeSingle();

        if (!session) throw new NotFoundException('Sesi tidak ditemukan.');

        const times = session as { start_time: string; end_time: string };

        const data = await insertIdempotently<{ id: string }>(this.db, {
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
    }

    async removeSchedule(user: AuthUser, scheduleId: string) {
        await this.authz.assertProktorByParent(
            user,
            'cbt_pas_class_schedules',
            scheduleId,
            'pas_period_id',
            'cbt_pas_periods',
        );

        const { data: schedule } = await this.db
            .from('cbt_pas_class_schedules')
            .select('status, exam_id')
            .eq('id', scheduleId)
            .maybeSingle();

        if (!schedule) throw new NotFoundException('Jadwal tidak ditemukan.');

        const row = schedule as { status: string | null; exam_id: string | null };
        if (row.status === 'active') {
            throw new ConflictException('Jadwal sedang aktif. Tidak bisa dihapus.');
        }

        if (row.exam_id) {
            await this.db.from('cbt_exams').delete().eq('id', row.exam_id);
        }

        const { error } = await this.db
            .from('cbt_pas_class_schedules')
            .delete()
            .eq('id', scheduleId);

        if (error) throw new BadRequestException(error.message);

        return { id: scheduleId };
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

        for (const scheduleId of scheduleIds) {
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
        const { data } = await this.db
            .from('cbt_pas_class_schedules')
            .select('*')
            .eq('id', scheduleId)
            .maybeSingle();

        if (!data) return `${scheduleId}: jadwal tidak ditemukan`;

        const schedule = data as any;
        if (schedule.exam_id) return `${scheduleId}: ujian sudah pernah dibangkitkan`;

        const [{ data: period }, { data: bank }, { data: cls }] = await Promise.all([
            this.db
                .from('cbt_pas_periods')
                .select('organization_id, name, type, school_year, semester')
                .eq('id', schedule.pas_period_id)
                .maybeSingle(),
            schedule.bank_id
                ? this.db
                      .from('cbt_question_banks')
                      .select('title')
                      .eq('id', schedule.bank_id)
                      .maybeSingle()
                : Promise.resolve({ data: null }),
            schedule.class_id
                ? this.db
                      .from('cbt_classes')
                      .select('name')
                      .eq('id', schedule.class_id)
                      .maybeSingle()
                : Promise.resolve({ data: null }),
        ]);

        if (!period) return `${scheduleId}: periode tidak ditemukan`;

        const periodRow = period as any;
        const duration = schedule.duration_minutes || 90;
        const closeTime = schedule.window_end_time || schedule.scheduled_time;

        const { data: exam, error } = await this.db
            .from('cbt_exams')
            .insert({
                organization_id: periodRow.organization_id,
                question_bank_id: schedule.bank_id,
                subject_id: schedule.subject_id || null,
                title: (bank as { title?: string } | null)?.title || 'Ujian',
                description:
                    `Kelas ${(cls as { name?: string } | null)?.name || 'N/A'} | ` +
                    `${periodRow.school_year} | ${String(periodRow.type || '').toUpperCase()} ${periodRow.semester}`,
                duration_minutes: duration,
                // Ujian PAS memakai jendela fleksibel: start/end adalah batas
                // jendelanya, bukan jam mulai serentak.
                start_time: wibDateTimeToUtc(schedule.scheduled_date, schedule.scheduled_time),
                end_time: wibDateTimeToUtc(schedule.scheduled_date, closeTime),
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
            })
            .select('id')
            .maybeSingle();

        if (error || !exam) {
            return `${scheduleId}: gagal membuat ujian — ${error?.message ?? 'tidak diketahui'}`;
        }

        const examId = (exam as { id: string }).id;

        await this.db
            .from('cbt_pas_class_schedules')
            .update({ exam_id: examId })
            .eq('id', scheduleId);

        await this.db
            .from('cbt_exam_targets')
            .upsert({ exam_id: examId, class_id: schedule.class_id });

        return null;
    }

}
