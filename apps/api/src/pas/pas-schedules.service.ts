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
import { dateTimeToUtc, normalizeSqlTime } from '../common/school-time';
import { advisoryTransactionLock } from '../common/transaction-lock';
import { DbService, type DbSession } from '../prisma/prisma-db-adapter';
import { SettingsService } from '../settings/settings.service';
import type { CreatePASScheduleDto, CreatePASSessionDto } from './dto/pas.dto';
import { loadPasReadiness } from './pas-readiness';
import { pasExamLabel, pasExamSettingsColumns, pasExamSettingsUpdate, resolvePasExamSettings, storedPasExamSettings } from '../common/pas-exam-settings';

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
        return ((data as any[]) || []).map(session => ({ ...session,
            start_time: this.sessionClock(session.start_time), end_time: this.sessionClock(session.end_time),
        }));
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
            await this.authz.assertBankAccess?.(user, dto.bank_id, 'read', db);
            if (!cls) throw new NotFoundException('Kelas tidak ditemukan pada sekolah ini.');
            if (dto.subject_id && !subject) {
                throw new NotFoundException('Mata pelajaran aktif tidak ditemukan pada sekolah ini.');
            }

            const times = { start_time: this.sessionClock(session.start_time),
                end_time: this.sessionClock(session.end_time) };

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
                .select('status, exam_id, class_id')
                .eq('id', scheduleId)
                .eq('pas_period_id', periodId)
                .maybeSingle();
            if (!schedule) throw new NotFoundException('Jadwal tidak ditemukan.');

            const row = schedule as { status: string | null; exam_id: string | null; class_id: string };
            if (row.status === 'active') {
                throw new ConflictException('Jadwal sedang aktif. Tidak bisa dihapus.');
            }

            const shared = row.exam_id ? (await this.linkedSchedules(db, row.exam_id)).filter(item => item.id !== scheduleId) : [];
            if (row.exam_id) {
                await lockExamsForDeletion(db, [row.exam_id]);
                // Ujian gabungan tetap dipakai kelas lain: cukup pastikan kelas ini belum mengerjakan.
                if (shared.length) await this.assertClassHasNoHistory(db, row.exam_id, row.class_id);
                else await assertExamsHaveNoHistory(db, [row.exam_id]);
            }

            const { error } = await db.from('cbt_pas_class_schedules')
                .delete().eq('id', scheduleId);
            if (error) throw new BadRequestException(`Gagal menghapus jadwal: ${error.message}`);

            if (row.exam_id && shared.length) {
                await this.removeClassTarget(db, row.exam_id, row.class_id);
                await this.refreshExamClasses(db, row.exam_id);
            } else if (row.exam_id) {
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

                const reason = await this.generateOne(user, scheduleId);
                if (reason) skipped.push(reason);
                else created++;
            } catch (err) {
                skipped.push(`${scheduleId}: ${(err as Error).message}`);
            }
        }

        return { created, skipped };
    }

    async setActivation(user: AuthUser, scheduleId: string, active: boolean) {
        await this.authz.assertProktorByParent(user, 'cbt_pas_class_schedules', scheduleId, 'pas_period_id', 'cbt_pas_periods');
        if (active) {
            const reason = await this.generateOne(user, scheduleId, true);
            if (reason) throw new ConflictException(reason);
            return { id: scheduleId, active: true };
        }
        const { data: source } = await this.db.from('cbt_pas_class_schedules').select('pas_period_id').eq('id', scheduleId).maybeSingle();
        if (!source) throw new NotFoundException('Jadwal tidak ditemukan.');
        return this.db.transaction(async db => {
            await this.lockPeriod(db, source.pas_period_id);
            await advisoryTransactionLock(db, `pas-exam-generation:${scheduleId}`);
            const { data: schedule, error } = await db.from('cbt_pas_class_schedules').select('exam_id, class_id').eq('id', scheduleId).maybeSingle();
            if (error || !schedule) throw new BadRequestException('Jadwal belum dapat dibaca.');
            if (schedule.exam_id) {
                // Menonaktifkan satu kelas tidak menutup ujian gabungan bagi kelas lain.
                await this.assertClassNotWorking(db, schedule.exam_id, schedule.class_id);
                await this.removeClassTarget(db, schedule.exam_id, schedule.class_id);
            }
            return { id: scheduleId, active: false };
        });
    }

    /**
     * Gabungkan ujian per-kelas lama menjadi satu ujian per bank soal × tanggal × sesi.
     *
     * Hanya ujian yang belum punya riwayat (pengerjaan/sertifikat) yang dilebur.
     * Kelas yang sudah aktif tetap aktif di ujian gabungan; kelas yang belum aktif
     * tetap menunggu aktivasi. Ujian yang sudah dikerjakan dibiarkan terpisah dan
     * dilaporkan kembali.
     */
    async mergeExams(user: AuthUser, periodId: string) {
        await this.authz.assertProktorByRecord(user, 'cbt_pas_periods', periodId);
        return this.db.transaction(async (db) => {
            await this.lockPeriod(db, periodId);
            const { data: period, error: periodError } = await db.from('cbt_pas_periods')
                .select('id, organization_id, name, type, school_year, semester, is_locked, screenshot_enabled, exam_settings')
                .eq('id', periodId).maybeSingle();
            if (periodError) throw new BadRequestException('Folder ujian belum dapat dibaca.');
            if (!period) throw new NotFoundException('Folder ujian tidak ditemukan.');
            if ((period as { is_locked?: boolean }).is_locked) throw new ConflictException('Periode sudah dikunci. Buka kunci sebelum menggabungkan ujian.');

            const { data: scheduleRows, error: scheduleError } = await db.from('cbt_pas_class_schedules')
                .select('id, pas_period_id, bank_id, class_id, exam_id, session_id, scheduled_date, scheduled_time, window_end_time, duration_minutes')
                .eq('pas_period_id', periodId);
            if (scheduleError) throw new BadRequestException('Jadwal folder belum dapat dibaca.');
            const groups = new Map<string, any[]>();
            for (const schedule of ((scheduleRows || []) as any[]).filter(row => row.exam_id && row.bank_id)) {
                const key = this.groupKey(schedule);
                groups.set(key, [...(groups.get(key) || []), schedule]);
            }

            const result = { merged: 0, groups: 0, kept_separate: [] as string[] };
            for (const [key, schedules] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
                const examIds = [...new Set(schedules.map(row => row.exam_id as string))].sort();
                if (examIds.length < 2) continue;
                await advisoryTransactionLock(db, `pas-exam-group:${key}`);
                await lockExamsForDeletion(db, examIds);
                const [{ data: examRows, error: examError }, history, { data: targetRows, error: targetError }] = await Promise.all([
                    db.from('cbt_exams').select('id, title, description, is_published, status, question_bank_id, show_results, randomize_questions, randomize_options, scoring_type, metadata').in('id', examIds),
                    this.examsWithHistory(db, examIds),
                    db.from('cbt_exam_targets').select('exam_id, class_id').in('exam_id', examIds),
                ]);
                if (examError || targetError) throw new BadRequestException('Ujian folder belum dapat diperiksa.');
                const exams = ((examRows || []) as any[]).filter(exam => !['archived', 'cancelled'].includes(exam.status));
                if (exams.length < 2) continue;
                const keeper = exams.find(exam => history.has(exam.id)) || exams[0];
                const removable = exams.filter(exam => exam.id !== keeper.id && !history.has(exam.id));
                for (const exam of exams) if (exam.id !== keeper.id && history.has(exam.id)) result.kept_separate.push(pasExamLabel(exam));
                if (!removable.length) continue;

                const targets = (targetRows || []) as Array<{ exam_id: string; class_id: string | null }>;
                const activeClasses = new Set<string>();
                for (const exam of [keeper, ...removable]) {
                    if (exam.is_published !== true) continue;
                    for (const target of targets) if (target.exam_id === exam.id && target.class_id) activeClasses.add(target.class_id);
                }
                // Target ujian lama yang belum aktif bukan aktivasi; tanpa riwayat aman dibersihkan.
                if (!history.has(keeper.id) && keeper.is_published !== true) {
                    const { error } = await db.from('cbt_exam_targets').delete().eq('exam_id', keeper.id);
                    if (error) throw new BadRequestException('Target kelas ujian belum dapat dirapikan.');
                }
                const removableIds = removable.map(exam => exam.id);
                const { error: relinkError } = await db.from('cbt_pas_class_schedules').update({ exam_id: keeper.id }).in('exam_id', removableIds);
                if (relinkError) throw new BadRequestException('Jadwal belum dapat ditautkan ke ujian gabungan.');
                const { error: targetDeleteError } = await db.from('cbt_exam_targets').delete().in('exam_id', removableIds);
                if (targetDeleteError) throw new BadRequestException('Target kelas ujian lama belum dapat dihapus.');
                const { error: examDeleteError } = await db.from('cbt_exams').delete().in('id', removableIds);
                if (examDeleteError) throw new BadRequestException('Ujian per kelas belum dapat dihapus.');
                for (const classId of activeClasses) await this.addClassTarget(db, keeper.id, classId);
                if (activeClasses.size) {
                    const { error } = await db.from('cbt_exams')
                        .update({ is_published: true, ...(keeper.status === 'draft' ? { status: 'scheduled' } : {}) }).eq('id', keeper.id);
                    if (error) throw new BadRequestException('Ujian gabungan belum dapat diaktifkan.');
                }
                // Ujian gabungan yang belum dikerjakan mengikuti pengaturan folder terbaru.
                const settings = resolvePasExamSettings(storedPasExamSettings(period as any), keeper.question_bank_id);
                const change = pasExamSettingsUpdate(keeper, settings, history.has(keeper.id));
                const { error: settingsError } = await db.from('cbt_exams').update(change.update).eq('id', keeper.id);
                if (settingsError) throw new BadRequestException('Pengaturan ujian gabungan belum dapat diterapkan.');
                await this.refreshExamClasses(db, keeper.id);
                result.merged += removable.length;
                result.groups += 1;
            }
            return result;
        });
    }

    /**
     * Bangkitkan (dan bila diminta aktifkan) ujian untuk satu jadwal kelas.
     *
     * Kelas yang memakai bank soal yang sama pada tanggal, sesi, jam, dan durasi
     * yang sama berbagi SATU ujian: monitoring, hasil, analisis butir, dan IRT
     * dihitung dari seluruh peserta bank itu. Sebuah kelas baru dapat masuk
     * setelah jadwalnya diaktifkan (kelas ditambahkan sebagai target ujian).
     * Mengembalikan alasan jika dilewati, atau `null` bila berhasil.
     */
    private async generateOne(user: AuthUser, scheduleId: string, activate = false): Promise<string | null> {
        const { data: source } = await this.db.from('cbt_pas_class_schedules')
            .select('pas_period_id').eq('id', scheduleId).maybeSingle();
        if (!source) return `${scheduleId}: jadwal tidak ditemukan`;
        const sourcePeriodId = (source as { pas_period_id: string }).pas_period_id;

        return this.db.transaction(async (db) => {
            await this.lockPeriod(db, sourcePeriodId);
            await advisoryTransactionLock(db, `pas-exam-generation:${scheduleId}`);
            if (activate) await advisoryTransactionLock(db, `pas-room-students:${sourcePeriodId}`);

            const { data } = await db
                .from('cbt_pas_class_schedules')
                .select('*')
                .eq('id', scheduleId)
                .maybeSingle();

            if (!data) return `${scheduleId}: jadwal tidak ditemukan`;

            const schedule = data as any;
            if (activate) {
                const { data: rooms, error } = await db.from('cbt_pas_rooms').select('id').eq('pas_period_id', sourcePeriodId);
                if (error) throw new BadRequestException('Penugasan pengawas belum dapat diperiksa.');
                for (const roomId of (rooms || []).map((room: { id: string }) => room.id).sort()) {
                    await advisoryTransactionLock(db, `pas-room-invigilators:${roomId}:${schedule.session_id}`);
                }
            }

            const { data: period } = await db
                .from('cbt_pas_periods')
                .select('id, organization_id, name, type, school_year, semester, is_locked, screenshot_enabled, exam_settings, start_date, end_date')
                .eq('id', schedule.pas_period_id)
                .maybeSingle();

            if (!period) return `${scheduleId}: periode tidak ditemukan`;

            const periodRow = period as any;
            if (periodRow.is_locked) return `${scheduleId}: periode terkunci`;
            await this.authz.assertBankAccess?.(user, schedule.bank_id, 'read', db);
            if (activate) {
                const readiness = (await loadPasReadiness(db, { ...periodRow, id: schedule.pas_period_id }, [schedule])).get(scheduleId);
                if (!readiness?.ready) throw new ConflictException(`Jadwal belum siap: ${readiness?.issues.join('; ') || 'kelengkapan belum dapat diperiksa'}`);
            }
            if (schedule.exam_id) {
                if (!activate) return `${scheduleId}: ujian sudah pernah dibangkitkan`;
                await this.activateClass(db, schedule.exam_id, schedule.class_id);
                return null;
            }

            const groupKey = this.groupKey(schedule);
            await advisoryTransactionLock(db, `pas-exam-group:${groupKey}`);
            const sharedExamId = await this.findGroupExam(db, schedule, groupKey);
            if (sharedExamId) {
                await this.linkSchedule(db, scheduleId, sharedExamId);
                await this.refreshExamClasses(db, sharedExamId);
                if (activate) await this.activateClass(db, sharedExamId, schedule.class_id);
                return null;
            }

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
            const openTime = this.sessionClock(schedule.scheduled_time);
            const closeTime = this.sessionClock(schedule.window_end_time || schedule.scheduled_time);
            const timeZone = (await this.settings?.getSchoolTimeZone?.()) || 'Asia/Jakarta';
            const startTime = dateTimeToUtc(schedule.scheduled_date, openTime, timeZone);
            const endTime = dateTimeToUtc(schedule.scheduled_date, closeTime, timeZone);
            if (!startTime || !endTime || new Date(endTime) <= new Date(startTime)) {
                return `${scheduleId}: jendela waktu ujian tidak valid`;
            }

            const bankTitle = (bank as { title?: string }).title || 'Ujian';
            const className = (cls as { name?: string }).name || 'N/A';
            const folderName = String(periodRow.name || '').trim();
            // Pengaturan folder (bawaan + timpaan bank soal), sama dengan bidang ujian biasa.
            const settings = pasExamSettingsColumns(resolvePasExamSettings(storedPasExamSettings(periodRow), schedule.bank_id));

            const payload = {
                organization_id: periodRow.organization_id,
                question_bank_id: schedule.bank_id,
                subject_id: schedule.subject_id || null,
                title: folderName || bankTitle,
                description: this.examDescription(bankTitle, [className], periodRow),
                duration_minutes: duration,
                start_time: startTime,
                end_time: endTime,
                ...settings.columns,
                is_published: false,
                status: 'scheduled',
                exam_type: periodRow.type || 'pas',
                metadata: {
                    ...settings.metadata,
                    is_pas_exam: true,
                    pas_period_id: schedule.pas_period_id,
                    pas_period_name: folderName || null,
                    pas_schedule_id: scheduleId,
                    pas_group_key: groupKey,
                    bank_title: bankTitle,
                    window_open: openTime,
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

            await this.linkSchedule(db, scheduleId, exam.id);
            if (activate) await this.activateClass(db, exam.id, schedule.class_id);
            return null;
        });
    }

    // ── Ujian gabungan per bank soal ─────────────────────────────────────────

    /** Kelas yang memakai bank, tanggal, sesi, jam, dan durasi yang sama berbagi satu ujian. */
    private groupKey(schedule: any): string {
        const day = schedule.scheduled_date instanceof Date
            ? schedule.scheduled_date.toISOString().slice(0, 10) : String(schedule.scheduled_date || '').slice(0, 10);
        return [schedule.pas_period_id, schedule.bank_id, day, schedule.session_id || '',
            normalizeSqlTime(schedule.scheduled_time) || '', normalizeSqlTime(schedule.window_end_time) || '',
            schedule.duration_minutes || 90].join('|');
    }

    private async findGroupExam(db: DbSession, schedule: any, groupKey: string): Promise<string | null> {
        const { data, error } = await db.from('cbt_pas_class_schedules')
            .select('id, pas_period_id, bank_id, exam_id, session_id, scheduled_date, scheduled_time, window_end_time, duration_minutes')
            .eq('pas_period_id', schedule.pas_period_id).eq('bank_id', schedule.bank_id);
        if (error) throw new BadRequestException('Jadwal bank soal belum dapat diperiksa.');
        const examIds = [...new Set(((data || []) as any[])
            .filter(row => row.id !== schedule.id && row.exam_id && this.groupKey(row) === groupKey)
            .map(row => row.exam_id as string))].sort();
        if (!examIds.length) return null;
        const { data: exams, error: examError } = await db.from('cbt_exams')
            .select('id, status, question_bank_id').in('id', examIds);
        if (examError) throw new BadRequestException('Ujian bank soal belum dapat diperiksa.');
        const usable = ((exams || []) as any[]).find(exam => exam.question_bank_id === schedule.bank_id && !['archived', 'cancelled'].includes(exam.status));
        return usable?.id || null;
    }

    private async linkSchedule(db: DbSession, scheduleId: string, examId: string): Promise<void> {
        const { error: linkError } = await db.from('cbt_pas_class_schedules').update({ exam_id: examId }).eq('id', scheduleId);
        if (linkError) throw new BadRequestException(`Gagal menautkan ujian: ${linkError.message}`);
    }

    private async linkedSchedules(db: DbSession, examId: string): Promise<Array<{ id: string; class_id: string }>> {
        const { data, error } = await db.from('cbt_pas_class_schedules').select('id, class_id').eq('exam_id', examId);
        if (error) throw new BadRequestException('Jadwal ujian belum dapat diperiksa.');
        return (data || []) as Array<{ id: string; class_id: string }>;
    }

    private async addClassTarget(db: DbSession, examId: string, classId: string): Promise<void> {
        const { data: existing, error: readError } = await db.from('cbt_exam_targets')
            .select('id').eq('exam_id', examId).eq('class_id', classId).limit(1).maybeSingle();
        if (readError) throw new BadRequestException(`Gagal memeriksa target kelas: ${readError.message}`);
        if (existing) return;
        const { error: targetError } = await db.from('cbt_exam_targets').insert({ exam_id: examId, class_id: classId });
        if (targetError) throw new BadRequestException(`Gagal menetapkan kelas: ${targetError.message}`);
    }

    /** Kelas boleh masuk: jadikan target dan terbitkan ujian. */
    private async activateClass(db: DbSession, examId: string, classId: string): Promise<void> {
        await this.addClassTarget(db, examId, classId);
        const { data: existing } = await db.from('cbt_exams').select('status').eq('id', examId).maybeSingle();
        const { error } = await db.from('cbt_exams')
            .update({ is_published: true, ...(existing?.status === 'draft' ? { status: 'scheduled' } : {}) }).eq('id', examId);
        if (error) throw new BadRequestException('Ujian belum berhasil diaktifkan.');
    }

    /** Lepas kelas dari ujian; ujian ditutup bila tidak ada lagi kelas aktif. */
    private async removeClassTarget(db: DbSession, examId: string, classId: string): Promise<void> {
        const { error } = await db.from('cbt_exam_targets').delete().eq('exam_id', examId).eq('class_id', classId);
        if (error) throw new BadRequestException('Kelas belum berhasil dinonaktifkan.');
        const { data: remaining, error: readError } = await db.from('cbt_exam_targets').select('id').eq('exam_id', examId).limit(1);
        if (readError) throw new BadRequestException('Target kelas ujian belum dapat diperiksa.');
        if (!((remaining || []) as unknown[]).length) {
            const { error: updateError } = await db.from('cbt_exams').update({ is_published: false }).eq('id', examId);
            if (updateError) throw new BadRequestException('Ujian belum berhasil dinonaktifkan.');
        }
    }

    private async classMembers(db: DbSession, classId: string): Promise<string[]> {
        const { data, error } = await db.from('cbt_class_members').select('user_id').eq('class_id', classId);
        if (error) throw new BadRequestException('Anggota kelas belum dapat diperiksa.');
        return ((data || []) as Array<{ user_id: string }>).map(row => row.user_id);
    }

    private async assertClassNotWorking(db: DbSession, examId: string, classId: string): Promise<void> {
        const members = await this.classMembers(db, classId);
        if (!members.length) return;
        const { data, error } = await db.from('cbt_exam_attempts')
            .select('id').eq('exam_id', examId).eq('status', 'in_progress').in('user_id', members);
        if (error) throw new BadRequestException('Status pengerjaan peserta belum dapat diperiksa.');
        const count = ((data as unknown[] | null) || []).length;
        if (count) {
            throw new ConflictException(
                `${count} siswa kelas ini sedang mengerjakan ujian. Tunggu sampai mereka selesai, atau selesaikan ` +
                'pengerjaannya dari Monitoring, sebelum menonaktifkan jadwal.',
            );
        }
    }

    private async assertClassHasNoHistory(db: DbSession, examId: string, classId: string): Promise<void> {
        const members = await this.classMembers(db, classId);
        if (!members.length) return;
        const { data, error } = await db.from('cbt_exam_attempts').select('id').eq('exam_id', examId).in('user_id', members).limit(1);
        if (error) throw new BadRequestException('Riwayat pengerjaan kelas belum dapat diperiksa.');
        if (((data as unknown[] | null) || []).length) {
            throw new ConflictException('Kelas ini sudah mengerjakan ujian, sehingga jadwalnya tidak dapat dihapus.');
        }
    }

    private async examsWithHistory(db: DbSession, examIds: string[]): Promise<Set<string>> {
        const used = new Set<string>();
        for (const table of ['cbt_exam_attempts', 'cbt_certificates']) {
            const { data, error } = await db.from(table).select('exam_id').in('exam_id', examIds);
            if (error) throw new BadRequestException('Riwayat ujian belum dapat diperiksa.');
            for (const row of (data || []) as Array<{ exam_id: string }>) used.add(row.exam_id);
        }
        return used;
    }

    private examDescription(bankTitle: string, classNames: string[], period: any): string {
        const classes = [...new Set(classNames.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'id', { numeric: true }));
        return `${bankTitle} • Kelas ${classes.join(', ') || '-'} | ` +
            `${period.school_year} | ${String(period.type || '').toUpperCase()} ${period.semester}`;
    }

    /** Perbarui deskripsi ujian gabungan dengan semua kelas yang memakainya. */
    private async refreshExamClasses(db: DbSession, examId: string): Promise<void> {
        const { data: exam } = await db.from('cbt_exams').select('id, metadata, description').eq('id', examId).maybeSingle();
        if (!exam) return;
        const schedules = await this.linkedSchedules(db, examId);
        if (!schedules.length) return;
        const { data: classRows } = await db.from('cbt_classes').select('id, name').in('id', schedules.map(row => row.class_id));
        const names = ((classRows || []) as Array<{ name?: string }>).map(row => row.name || '').filter(Boolean);
        const [head, ...rest] = String((exam as any).description || '').split('|');
        const bankTitle = String((exam as any).metadata?.bank_title || head.split('•')[0] || 'Ujian').trim();
        const classes = [...new Set(names)].sort((a, b) => a.localeCompare(b, 'id', { numeric: true }));
        const description = `${bankTitle} • Kelas ${classes.join(', ') || '-'}${rest.length ? ` |${rest.join('|')}` : ''}`;
        if (description === (exam as any).description) return;
        const { error } = await db.from('cbt_exams').update({ description }).eq('id', examId);
        if (error) throw new BadRequestException('Deskripsi ujian gabungan belum dapat diperbarui.');
    }

    private sessionClock(value: string | Date): string {
        const clock = normalizeSqlTime(value);
        if (!clock) throw new BadRequestException('Jam sesi ujian tidak valid. Periksa kembali jam mulai dan selesai.');
        return clock;
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
