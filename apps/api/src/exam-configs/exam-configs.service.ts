import {
    BadRequestException,
    ConflictException,
    Injectable,
    Logger,
    NotFoundException,
} from '@nestjs/common';
import type { AuthUser } from '@acca-cbt/shared';
import { AuthorizationService } from '../auth/authorization.service';
import { wibDateTimeToUtc } from '../common/wib-time';
import { deleteExamsWithoutHistory } from '../common/exam-deletion';
import { DbService, type DbSession } from '../prisma/prisma-db-adapter';
import {
    deriveRequestUuid,
    insertIdempotently,
    insertIdempotentlyWithStatus,
} from '../common/idempotent-create';
import type {
    AddExamConfigBankDto,
    AddExamConfigExamDto,
    CreateExamConfigDto,
    UpdateExamConfigBankDto,
    UpdateExamConfigDto,
} from './dto/exam-configs.dto';

/**
 * "Ujian folder" — konfigurasi ujian massal PAS/PAT.
 *
 * Satu `exam_configs` memuat beberapa bank soal (`exam_config_banks`), dan tiap
 * bank dijadwalkan untuk beberapa kelas (`exam_config_exams`). Baris jadwal itu
 * belum berupa ujian; ia menjadi `cbt_exams` sungguhan hanya setelah proktor
 * menekan "Generate".
 *
 * Dipindahkan dari `apps/web/app/actions/exam-config.ts`. Dua perbedaan yang
 * disengaja dengan versi lama:
 *
 *  - `listExamConfigs` dan `getExamConfig` DULU tidak memeriksa apa pun. Keduanya
 *    hanya menerima id dari browser, jadi seluruh jadwal ujian sekolah lain bisa
 *    dibaca hanya dengan menukar UUID. Sekarang keduanya lewat otorisasi staf.
 *  - `generateExamsFromConfigAction` hanya memeriksa id PERTAMA dari daftar,
 *    lalu membangkitkan sisanya tanpa pemeriksaan. Sekarang tiap id diperiksa.
 */
@Injectable()
export class ExamConfigsService {
    private readonly logger = new Logger(ExamConfigsService.name);

    constructor(
        private readonly db: DbService,
        private readonly authz: AuthorizationService,
    ) {}

    // ── Konfigurasi ──────────────────────────────────────────────────────────

    async list(user: AuthUser, organizationId: string) {
        await this.authz.assertOrgStaff(user, organizationId);

        const { data, error } = await this.db
            .from('exam_configs')
            .select('*, _count:exam_config_banks(count)')
            .eq('organization_id', organizationId)
            .order('created_at', { ascending: false });

        if (error) {
            this.logger.error(`Gagal membaca daftar konfigurasi: ${error.message}`);
            return [];
        }

        return ((data as any[]) || []).map((config) => ({
            ...config,
            _count: {
                exam_config_banks: config._count?.exam_config_banks || 0,
                exam_config_exams: 0,
            },
        }));
    }

    async get(user: AuthUser, configId: string) {
        await this.authz.assertStaffByRecord(user, 'exam_configs', configId);

        const { data: config } = await this.db
            .from('exam_configs')
            .select('*')
            .eq('id', configId)
            .maybeSingle();

        if (!config) throw new NotFoundException('Konfigurasi ujian tidak ditemukan.');

        const [{ data: banks }, { data: configExams }] = await Promise.all([
            this.db
                .from('exam_config_banks')
                .select(
                    `*,
                     question_banks:cbt_question_banks(id, title, is_published),
                     subjects:cbt_subjects(id, name)`,
                )
                .eq('exam_config_id', configId),
            this.db
                .from('exam_config_exams')
                .select(
                    `*,
                     classes:cbt_classes(id, name),
                     exams:cbt_exams(id, title, is_published, status)`,
                )
                .eq('exam_config_id', configId),
        ]);

        const schedules = (configExams as any[]) || [];

        return {
            ...(config as object),
            exam_config_banks: ((banks as any[]) || []).map((bank) => ({
                ...bank,
                exam_config_exams: schedules.filter((e) => e.exam_config_bank_id === bank.id),
            })),
        };
    }

    async create(user: AuthUser, organizationId: string, dto: CreateExamConfigDto) {
        await this.authz.assertProktor(user, organizationId);

        const data = await insertIdempotently<{ id: string }>(this.db, {
            table: 'exam_configs',
            organizationId,
            clientRequestId: dto.clientRequestId,
            fingerprint: dto,
            select: 'id',
            payload: {
                organization_id: organizationId,
                name: dto.name.trim(),
                school_year: dto.school_year || null,
                semester: dto.semester || null,
                start_date: dto.start_date || null,
                end_date: dto.end_date || null,
                // Identitas dari token, bukan `userId` kiriman browser seperti
                // pada versi server action.
                created_by: user.id,
                is_locked: false,
            },
        });

        return { id: data.id };
    }

    async update(user: AuthUser, configId: string, dto: UpdateExamConfigDto) {
        await this.authz.assertProktorByRecord(user, 'exam_configs', configId);

        // Hanya bidang yang benar-benar dikirim yang ditulis: mengirim seluruh
        // objek akan mengosongkan bidang yang tidak disentuh formulir.
        const payload: Record<string, unknown> = {};
        for (const field of [
            'name',
            'school_year',
            'semester',
            'start_date',
            'end_date',
            'is_locked',
        ] as const) {
            if (dto[field] !== undefined) payload[field] = dto[field];
        }

        if (Object.keys(payload).length === 0) return { id: configId };

        const { error } = await this.db
            .from('exam_configs')
            .update(payload)
            .eq('id', configId);

        if (error) throw new BadRequestException(error.message);

        return { id: configId };
    }

    async setLock(user: AuthUser, configId: string, lock: boolean) {
        await this.authz.assertProktorByRecord(user, 'exam_configs', configId);

        const { error } = await this.db
            .from('exam_configs')
            .update({ is_locked: lock })
            .eq('id', configId);

        if (error) throw new BadRequestException(error.message);

        return { id: configId, is_locked: lock };
    }

    async remove(user: AuthUser, configId: string) {
        await this.authz.assertProktorByRecord(user, 'exam_configs', configId);

        return this.db.transaction(async (db) => {
            await this.lockConfig(db, configId);
            await this.assertUnlocked(configId, '', db);

            const schedules = await this.configSchedules(db, 'exam_config_id', configId);
            await this.lockConfigSchedules(db, schedules.map((row) => row.id));
            const current = await this.configSchedules(db, 'exam_config_id', configId);
            await deleteExamsWithoutHistory(
                db,
                current.map((row) => row.exam_id).filter((id): id is string => Boolean(id)),
            );

            const { error } = await db.from('exam_configs').delete().eq('id', configId);
            if (error) throw new BadRequestException(`Gagal menghapus konfigurasi: ${error.message}`);

            return { id: configId };
        });
    }

    // ── Bank soal di dalam konfigurasi ───────────────────────────────────────

    async addBank(user: AuthUser, dto: AddExamConfigBankDto) {
        await this.authz.assertProktorByRecord(user, 'exam_configs', dto.exam_config_id);
        await this.assertUnlocked(dto.exam_config_id, 'Tidak bisa menambah bank soal.');

        const { data: config } = await this.db
            .from('exam_configs')
            .select('organization_id')
            .eq('id', dto.exam_config_id)
            .maybeSingle();
        if (!config) throw new NotFoundException('Konfigurasi ujian tidak ditemukan.');

        const { data: bank } = await this.db
            .from('cbt_question_banks')
            .select('id')
            .eq('id', dto.bank_id)
            .eq('organization_id', (config as { organization_id: string }).organization_id)
            .maybeSingle();

        if (!bank) throw new NotFoundException('Bank soal tidak ditemukan pada sekolah ini.');

        const data = await insertIdempotently<{ id: string }>(this.db, {
            table: 'exam_config_banks',
            scope: { column: 'exam_config_id', value: dto.exam_config_id },
            clientRequestId: dto.clientRequestId,
            fingerprint: dto,
            select: 'id',
            payload: {
                exam_config_id: dto.exam_config_id,
                bank_id: dto.bank_id,
                subject_id: dto.subject_id || null,
                duration_minutes: dto.duration_minutes || 90,
            },
            mapError: (error) => error.code === '23505'
                ? new ConflictException('Bank soal sudah ada di konfigurasi ini.')
                : new BadRequestException(
                    error.message,
                ),
        });

        return { id: data.id };
    }

    async updateBank(user: AuthUser, bankRowId: string, dto: UpdateExamConfigBankDto) {
        await this.authz.assertProktorByParent(
            user,
            'exam_config_banks',
            bankRowId,
            'exam_config_id',
            'exam_configs',
        );

        const payload: Record<string, unknown> = {};
        if (dto.subject_id !== undefined) payload.subject_id = dto.subject_id;
        if (dto.duration_minutes !== undefined) payload.duration_minutes = dto.duration_minutes;

        if (Object.keys(payload).length === 0) return { id: bankRowId };

        const { error } = await this.db
            .from('exam_config_banks')
            .update(payload)
            .eq('id', bankRowId);

        if (error) throw new BadRequestException(error.message);

        return { id: bankRowId };
    }

    async removeBank(user: AuthUser, bankRowId: string) {
        await this.authz.assertProktorByParent(
            user,
            'exam_config_banks',
            bankRowId,
            'exam_config_id',
            'exam_configs',
        );

        const { data: bankRow } = await this.db.from('exam_config_banks')
            .select('exam_config_id').eq('id', bankRowId).maybeSingle();
        if (!bankRow) throw new NotFoundException('Bank konfigurasi tidak ditemukan.');
        const configId = (bankRow as { exam_config_id: string }).exam_config_id;

        return this.db.transaction(async (db) => {
            await this.lockConfig(db, configId);
            await this.assertUnlocked(configId, 'Tidak bisa menghapus bank soal.', db);

            const schedules = await this.configSchedules(db, 'exam_config_bank_id', bankRowId);
            await this.lockConfigSchedules(db, schedules.map((row) => row.id));
            const current = await this.configSchedules(db, 'exam_config_bank_id', bankRowId);
            await deleteExamsWithoutHistory(
                db,
                current.map((row) => row.exam_id).filter((id): id is string => Boolean(id)),
            );

            const { error } = await db.from('exam_config_banks').delete()
                .eq('id', bankRowId).eq('exam_config_id', configId);
            if (error) throw new BadRequestException(`Gagal menghapus bank konfigurasi: ${error.message}`);

            return { id: bankRowId };
        });
    }

    // ── Jadwal per kelas ─────────────────────────────────────────────────────

    async addSchedule(user: AuthUser, dto: AddExamConfigExamDto) {
        await this.authz.assertProktorByRecord(user, 'exam_configs', dto.exam_config_id);
        await this.assertUnlocked(dto.exam_config_id);

        const [{ data: config }, { data: bankRow }] = await Promise.all([
            this.db.from('exam_configs').select('organization_id').eq('id', dto.exam_config_id).maybeSingle(),
            this.db.from('exam_config_banks').select('id').eq('id', dto.exam_config_bank_id)
                .eq('exam_config_id', dto.exam_config_id).maybeSingle(),
        ]);
        if (!config) throw new NotFoundException('Konfigurasi ujian tidak ditemukan.');
        if (!bankRow) throw new NotFoundException('Bank soal tidak berada dalam konfigurasi ini.');

        const { data: cls } = await this.db.from('cbt_classes').select('id')
            .eq('id', dto.class_id)
            .eq('organization_id', (config as { organization_id: string }).organization_id)
            .maybeSingle();
        if (!cls) throw new NotFoundException('Kelas tidak ditemukan pada sekolah ini.');

        const data = await insertIdempotently<{ id: string }>(this.db, {
            table: 'exam_config_exams',
            scope: { column: 'exam_config_id', value: dto.exam_config_id },
            clientRequestId: dto.clientRequestId,
            fingerprint: dto,
            select: 'id',
            payload: {
                exam_config_id: dto.exam_config_id,
                exam_config_bank_id: dto.exam_config_bank_id,
                class_id: dto.class_id,
                scheduled_date: dto.scheduled_date || null,
                scheduled_time: dto.scheduled_time || null,
                window_end_time: dto.window_end_time || null,
                status: 'scheduled',
            },
            mapError: (error) => error.code === '23505'
                ? new ConflictException('Kelas sudah punya jadwal untuk bank soal ini.')
                : new BadRequestException(error.message),
        });

        return { id: data.id };
    }

    async removeSchedule(user: AuthUser, configExamId: string) {
        await this.authz.assertProktorByParent(
            user,
            'exam_config_exams',
            configExamId,
            'exam_config_id',
            'exam_configs',
        );

        const { data: schedule } = await this.db
            .from('exam_config_exams')
            .select('exam_config_id')
            .eq('id', configExamId)
            .maybeSingle();
        if (!schedule) throw new NotFoundException('Jadwal konfigurasi tidak ditemukan.');
        const configId = (schedule as { exam_config_id: string }).exam_config_id;

        return this.db.transaction(async (db) => {
            await this.lockConfig(db, configId);
            await db.raw(
                'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
                `config-exam-generation:${configExamId}`,
            );
            await this.assertUnlocked(configId, 'Tidak bisa menghapus jadwal.', db);

            const { data: current } = await db.from('exam_config_exams')
                .select('exam_id').eq('id', configExamId).eq('exam_config_id', configId).maybeSingle();
            if (!current) throw new NotFoundException('Jadwal konfigurasi tidak ditemukan.');
            const examId = (current as { exam_id: string | null }).exam_id;
            await deleteExamsWithoutHistory(db, examId ? [examId] : []);

            const { error } = await db.from('exam_config_exams').delete().eq('id', configExamId);
            if (error) throw new BadRequestException(`Gagal menghapus jadwal: ${error.message}`);

            return { id: configExamId };
        });
    }

    // ── Pembangkitan ujian ───────────────────────────────────────────────────

    /**
     * Ubah baris jadwal menjadi `cbt_exams` sungguhan.
     *
     * Satu jadwal yang gagal tidak menghentikan sisanya: proktor membangkitkan
     * puluhan kelas sekaligus, dan berhenti di tengah akan meninggalkan sebagian
     * kelas tanpa ujian tanpa penjelasan. Yang dilewati dikembalikan di `skipped`
     * beserta alasannya.
     */
    async generate(user: AuthUser, configExamIds: string[]) {
        let created = 0;
        const skipped: string[] = [];

        for (const configExamId of [...new Set(configExamIds)]) {
            try {
                // Diperiksa per id, bukan hanya id pertama seperti versi lama:
                // satu daftar bisa saja memuat jadwal milik organisasi lain.
                await this.authz.assertProktorByParent(
                    user,
                    'exam_config_exams',
                    configExamId,
                    'exam_config_id',
                    'exam_configs',
                );

                const reason = await this.generateOne(configExamId);
                if (reason) skipped.push(reason);
                else created++;
            } catch (err) {
                skipped.push(`${configExamId}: ${(err as Error).message}`);
            }
        }

        return { created, skipped };
    }

    /** Mengembalikan alasan jika dilewati, atau `null` bila ujian berhasil dibuat. */
    private async generateOne(configExamId: string): Promise<string | null> {
        const { data: source } = await this.db.from('exam_config_exams')
            .select('exam_config_id').eq('id', configExamId).maybeSingle();
        if (!source) return `${configExamId}: jadwal tidak ditemukan`;
        const sourceConfigId = (source as { exam_config_id: string }).exam_config_id;

        return this.db.transaction(async (db) => {
            await this.lockConfig(db, sourceConfigId);
            await db.raw(
                'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
                `config-exam-generation:${configExamId}`,
            );

            const { data } = await db
                .from('exam_config_exams')
                .select(
                    `*,
                     exam_configs!inner(id, organization_id, name, school_year, semester, is_locked),
                     exam_config_banks!inner(id, exam_config_id, bank_id, subject_id, duration_minutes),
                     classes:cbt_classes!inner(id, name, organization_id)`,
                )
                .eq('id', configExamId)
                .maybeSingle();

            if (!data) return `${configExamId}: jadwal tidak ditemukan`;

            const schedule = data as any;
            if (schedule.exam_id) return `${configExamId}: ujian sudah pernah dibangkitkan`;
            if (schedule.exam_configs?.is_locked) return `${configExamId}: konfigurasi terkunci`;
            if (schedule.exam_config_banks?.exam_config_id !== schedule.exam_config_id) {
                return `${configExamId}: bank soal bukan bagian dari konfigurasi`;
            }

            const organizationId = schedule.exam_configs?.organization_id;
            if (!organizationId || schedule.classes?.organization_id !== organizationId) {
                return `${configExamId}: kelas bukan milik sekolah konfigurasi`;
            }

            const bankId = schedule.exam_config_banks?.bank_id;
            if (!bankId) return `${configExamId}: bank soal belum dipilih`;

            const { data: bank } = await db
                .from('cbt_question_banks')
                .select('title')
                .eq('id', bankId)
                .eq('organization_id', organizationId)
                .maybeSingle();
            if (!bank) return `${configExamId}: bank soal bukan milik sekolah konfigurasi`;

            const startTime = wibDateTimeToUtc(schedule.scheduled_date, schedule.scheduled_time);
            const endTime = wibDateTimeToUtc(schedule.scheduled_date, schedule.window_end_time);
            if (!startTime || !endTime || new Date(endTime) <= new Date(startTime)) {
                return `${configExamId}: jendela waktu ujian tidak valid`;
            }

            const className = schedule.classes?.name || 'N/A';
            const configName = schedule.exam_configs?.name;
            const schoolYear = schedule.exam_configs?.school_year;
            const payload = {
                organization_id: organizationId,
                question_bank_id: bankId,
                subject_id: schedule.exam_config_banks?.subject_id || null,
                title: (bank as { title?: string }).title || 'Ujian',
                description: `Kelas ${className} | ${configName}${schoolYear ? ` | ${schoolYear}` : ''}`,
                duration_minutes: schedule.exam_config_banks?.duration_minutes || 90,
                start_time: startTime,
                end_time: endTime,
                randomize_questions: true,
                randomize_options: true,
                show_results: false,
                is_published: false,
                status: 'scheduled',
                exam_type: 'daily',
                metadata: {
                    is_safe_mode: true,
                    is_folder_exam: true,
                    exam_config_id: schedule.exam_config_id,
                    exam_config_bank_id: schedule.exam_config_bank_id,
                    exam_config_exam_id: configExamId,
                },
            };

            const { data: exam } = await insertIdempotentlyWithStatus<{ id: string }>(db, {
                table: 'cbt_exams',
                organizationId,
                clientRequestId: deriveRequestUuid(configExamId, 2902),
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
                .from('exam_config_exams')
                .update({ exam_id: exam.id })
                .eq('id', configExamId);
            if (linkError) throw new BadRequestException(`Gagal menautkan ujian: ${linkError.message}`);

            return null;
        });
    }

    // ── Pembantu ─────────────────────────────────────────────────────────────

    private async assertUnlocked(
        configId: string,
        detail = '',
        db: Pick<DbService, 'from'> | DbSession = this.db,
    ): Promise<void> {
        const { data } = await db
            .from('exam_configs')
            .select('is_locked')
            .eq('id', configId)
            .maybeSingle();

        if (!data) throw new NotFoundException('Konfigurasi ujian tidak ditemukan.');
        if ((data as { is_locked: boolean }).is_locked) {
            throw new ConflictException(
                `Konfigurasi sudah dikunci.${detail ? ` ${detail}` : ''}`.trim(),
            );
        }
    }

    private lockConfig(db: DbSession, configId: string): Promise<unknown> {
        return db.raw(
            'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
            `exam-config:${configId}`,
        );
    }

    private async lockConfigSchedules(db: DbSession, ids: string[]): Promise<void> {
        for (const id of [...new Set(ids)].sort()) {
            await db.raw(
                'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
                `config-exam-generation:${id}`,
            );
        }
    }

    private async configSchedules(
        db: DbSession,
        column: 'exam_config_id' | 'exam_config_bank_id',
        value: string,
    ): Promise<Array<{ id: string; exam_id: string | null }>> {
        const { data, error } = await db
            .from('exam_config_exams')
            .select('id, exam_id')
            .eq(column, value);
        if (error) throw new BadRequestException(`Gagal membaca jadwal konfigurasi: ${error.message}`);
        return (data as Array<{ id: string; exam_id: string | null }>) || [];
    }

}
