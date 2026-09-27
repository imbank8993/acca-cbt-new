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
import { DbService } from '../prisma/prisma-db-adapter';
import { insertIdempotently } from '../common/idempotent-create';
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

        const { data: config } = await this.db
            .from('exam_configs')
            .select('is_locked')
            .eq('id', configId)
            .maybeSingle();

        if (!config) throw new NotFoundException('Konfigurasi ujian tidak ditemukan.');
        if ((config as { is_locked: boolean }).is_locked) {
            throw new ConflictException('Konfigurasi yang terkunci tidak bisa dihapus.');
        }

        // Baris `exam_config_*` ikut terhapus lewat ON DELETE CASCADE, tetapi
        // `cbt_exams` TIDAK: relasinya ON DELETE SET NULL, tepat supaya menghapus
        // satu ujian tidak menghapus jadwalnya. Jadi ujian hasil generate harus
        // dihapus lebih dulu di sini, kalau tidak ia tertinggal sebagai ujian
        // yatim yang masih terlihat siswa.
        await this.deleteGeneratedExams('exam_config_id', configId);

        const { error } = await this.db.from('exam_configs').delete().eq('id', configId);
        if (error) throw new BadRequestException(error.message);

        return { id: configId };
    }

    // ── Bank soal di dalam konfigurasi ───────────────────────────────────────

    async addBank(user: AuthUser, dto: AddExamConfigBankDto) {
        await this.authz.assertProktorByRecord(user, 'exam_configs', dto.exam_config_id);
        await this.assertUnlocked(dto.exam_config_id, 'Tidak bisa menambah bank soal.');

        const { data: bank } = await this.db
            .from('cbt_question_banks')
            .select('id')
            .eq('id', dto.bank_id)
            .maybeSingle();

        if (!bank) throw new NotFoundException('Bank soal tidak ditemukan.');

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

        await this.deleteGeneratedExams('exam_config_bank_id', bankRowId);

        const { error } = await this.db.from('exam_config_banks').delete().eq('id', bankRowId);
        if (error) throw new BadRequestException(error.message);

        return { id: bankRowId };
    }

    // ── Jadwal per kelas ─────────────────────────────────────────────────────

    async addSchedule(user: AuthUser, dto: AddExamConfigExamDto) {
        await this.authz.assertProktorByRecord(user, 'exam_configs', dto.exam_config_id);
        await this.assertUnlocked(dto.exam_config_id);

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
            .select('exam_id')
            .eq('id', configExamId)
            .maybeSingle();

        const examId = (schedule as { exam_id: string | null } | null)?.exam_id;
        if (examId) {
            await this.db.from('cbt_exams').delete().eq('id', examId);
        }

        const { error } = await this.db
            .from('exam_config_exams')
            .delete()
            .eq('id', configExamId);

        if (error) throw new BadRequestException(error.message);

        return { id: configExamId };
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

        for (const configExamId of configExamIds) {
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
        const { data } = await this.db
            .from('exam_config_exams')
            .select(
                `*,
                 exam_configs!inner(id, organization_id, name, school_year, semester, is_locked),
                 exam_config_banks!inner(id, bank_id, subject_id, duration_minutes),
                 classes:cbt_classes!inner(id, name)`,
            )
            .eq('id', configExamId)
            .maybeSingle();

        if (!data) return `${configExamId}: jadwal tidak ditemukan`;

        const schedule = data as any;

        if (schedule.exam_id) return `${configExamId}: ujian sudah pernah dibangkitkan`;
        if (schedule.exam_configs?.is_locked) return `${configExamId}: konfigurasi terkunci`;

        const bankId = schedule.exam_config_banks?.bank_id;
        if (!bankId) return `${configExamId}: bank soal belum dipilih`;

        const { data: bank } = await this.db
            .from('cbt_question_banks')
            .select('title')
            .eq('id', bankId)
            .maybeSingle();

        const className = schedule.classes?.name || 'N/A';
        const configName = schedule.exam_configs?.name;
        const schoolYear = schedule.exam_configs?.school_year;

        const { data: exam, error } = await this.db
            .from('cbt_exams')
            .insert({
                organization_id: schedule.exam_configs?.organization_id,
                question_bank_id: bankId,
                subject_id: schedule.exam_config_banks?.subject_id || null,
                title: (bank as { title?: string } | null)?.title || 'Ujian',
                description: `Kelas ${className} | ${configName}${schoolYear ? ` | ${schoolYear}` : ''}`,
                duration_minutes: schedule.exam_config_banks?.duration_minutes || 90,
                start_time: wibDateTimeToUtc(schedule.scheduled_date, schedule.scheduled_time),
                end_time: wibDateTimeToUtc(schedule.scheduled_date, schedule.window_end_time),
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
            })
            .select()
            .maybeSingle();

        if (error || !exam) {
            return `${configExamId}: gagal membuat ujian — ${error?.message ?? 'tidak diketahui'}`;
        }

        const examId = (exam as { id: string }).id;

        await this.db
            .from('exam_config_exams')
            .update({ exam_id: examId })
            .eq('id', configExamId);

        await this.db
            .from('cbt_exam_targets')
            .upsert({ exam_id: examId, class_id: schedule.class_id });

        return null;
    }

    // ── Pembantu ─────────────────────────────────────────────────────────────

    private async assertUnlocked(configId: string, detail = ''): Promise<void> {
        const { data } = await this.db
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

    /** Hapus `cbt_exams` yang dibangkitkan dari jadwal yang cocok dengan filter. */
    private async deleteGeneratedExams(column: string, value: string): Promise<void> {
        const { data } = await this.db
            .from('exam_config_exams')
            .select('exam_id')
            .eq(column, value);

        const examIds = ((data as Array<{ exam_id: string | null }>) || [])
            .map((row) => row.exam_id)
            .filter((id): id is string => Boolean(id));

        if (examIds.length > 0) {
            await this.db.from('cbt_exams').delete().in('id', examIds);
        }
    }

}
