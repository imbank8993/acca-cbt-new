import {
    BadRequestException,
    ConflictException,
    Injectable,
    Logger,
    NotFoundException,
    ServiceUnavailableException,
} from '@nestjs/common';
import type { AuthUser } from '@acca-cbt/shared';
import { AuthorizationService } from '../auth/authorization.service';
import { DbService } from '../prisma/prisma-db-adapter';
import { assertExamsHaveNoHistory, lockExamsForDeletion } from '../common/exam-deletion';
import { insertIdempotently } from '../common/idempotent-create';
import { listOperationalSubjects } from '../common/subject-catalog';
import { advisoryTransactionLock } from '../common/transaction-lock';
import { normalizeSqlTime } from '../common/school-time';
import type { CreatePASPeriodDto, UpdatePASCommitteeChairDto, UpdatePASExamSettingsDto, UpdatePASPeriodDto } from './dto/pas.dto';
import { writablePasPeriod, pasDateRange, storedPasDate } from '../common/pas-period-policy';
import { loadPasReadiness } from './pas-readiness';
import {
    normalizePasExamSettings,
    pasExamLabel,
    pasExamSettingsUpdate,
    resolvePasExamSettings,
    storedPasExamSettings,
    type PasExamRow,
} from '../common/pas-exam-settings';

/**
 * Periode PAS/PAT dan data pendukungnya.
 *
 * Dipindahkan dari `apps/web/app/actions/pas.ts`. Sembilan dari 29 aksi di
 * berkas itu TIDAK ikut pindah karena tidak punya satu pun pemanggil, dan
 * sebagian memang rusak sejak awal:
 *
 *  - `getPASDashboardStats` memakai `{ head: true }` lalu membaca `.data`, yang
 *    selalu null dalam mode itu — seluruh angka selain total selalu 0. Filternya
 *    (`.eq('pas_periods.organization_id', …)`) juga menunjuk relasi yang tidak
 *    disertakan dalam select.
 *  - `deleteSubjectAction` membaca `.count` pada objek data, bukan pada hasil
 *    query, sehingga penjagaan "mapel masih dipakai" tidak pernah aktif.
 *  - `removePASSubjectAction` mencari jadwal dengan `.eq('pas_period_id', subjectId)`
 *    — id mapel dipakai sebagai id periode.
 *  - `createSubjectAction`/`updateSubjectAction`/`deleteSubjectAction` kembar
 *    dengan versi di `proktor.ts`; yang dipakai halaman adalah versi proktor.
 *
 * Membawa serta kode mati yang rusak hanya memindahkan masalahnya, jadi
 * semuanya dihapus. Riwayatnya tetap ada di git bila suatu saat dibutuhkan.
 */
@Injectable()
export class PasService {
    private readonly logger = new Logger(PasService.name);

    constructor(
        private readonly db: DbService,
        private readonly authz: AuthorizationService,
    ) {}

    // ── Periode ──────────────────────────────────────────────────────────────

    async listPeriods(user: AuthUser, organizationId: string) {
        await this.authz.assertOrgStaff(user, organizationId);

        const { data, error } = await this.db
            .from('cbt_pas_periods')
            .select('*, schedules:cbt_pas_class_schedules(id, bank_id, exam_id), _count:cbt_pas_class_schedules(count)')
            .eq('organization_id', organizationId)
            .order('created_at', { ascending: false });

        if (error) {
            this.logger.error(`Gagal membaca daftar periode: ${error.message}`);
            return [];
        }

        return ((data as any[]) || []).map(({ schedules, ...period }) => {
            const scheduleRows = Array.isArray(schedules) ? schedules : [];
            const rawCount = Array.isArray(period._count)
                ? period._count[0]?.count
                : period._count?.pas_class_schedules;
            const scheduleCount = scheduleRows.length || Number(rawCount) || 0;
            const uniqueBankCount = new Set(
                scheduleRows.map((s: any) => s.bank_id).filter(Boolean),
            ).size;
            return {
                ...period,
                _count: {
                    pas_subjects: uniqueBankCount,
                    pas_class_schedules: scheduleCount,
                },
            };
        });
    }

    async getPeriod(user: AuthUser, periodId: string) {
        await this.authz.assertStaffByRecord(user, 'cbt_pas_periods', periodId);

        const { data: period } = await this.db
            .from('cbt_pas_periods')
            .select('*')
            .eq('id', periodId)
            .maybeSingle();

        if (!period) throw new NotFoundException('Periode tidak ditemukan.');

        const [{ data: schedules, error: schedulesError }, { data: schoolProfile }, { data: organization }] = await Promise.all([
            this.db.from('cbt_pas_class_schedules')
                .select('*, classes:cbt_classes(name), subjects:cbt_subjects(name), question_banks:cbt_question_banks(id, title)')
                .eq('pas_period_id', periodId),
            this.db.from('profil_sekolah')
                .select('nama, jenjang, jenis, alamat, desa_kelurahan, kecamatan, kabupaten_kota, provinsi, kode_pos, telepon, email, website, logo_url, kepala_sekolah_nama, kepala_sekolah_nip')
                .limit(1)
                .maybeSingle(),
            this.db.from('cbt_organizations')
                .select('name, logo_url')
                .eq('id', (period as any).organization_id)
                .maybeSingle(),
        ]);

        if (schedulesError) throw new BadRequestException('Daftar jadwal belum dapat dibaca.');
        const readiness = await loadPasReadiness(this.db, period, schedules || []);

        return { ...(period as object), exam_settings: storedPasExamSettings(period as { exam_settings?: unknown; screenshot_enabled?: boolean }), profil_sekolah: {
            ...(schoolProfile || {}),
            nama: schoolProfile?.nama || organization?.name || 'MADRASAH',
            logo_url: schoolProfile?.logo_url || organization?.logo_url || null,
        }, pas_class_schedules: ((schedules as any[]) || []).map(schedule => ({
            ...schedule,
            readiness: readiness.get(schedule.id),
            is_activated: readiness.get(schedule.id)?.activated ?? null,
            allocated_room_ids: readiness.get(schedule.id)?.room_ids || [],
            allocated_room_counts: readiness.get(schedule.id)?.room_counts || {},
            unallocated_student_count: readiness.get(schedule.id)?.unassigned_count ?? 0,
            scheduled_time: normalizeSqlTime(schedule.scheduled_time),
            window_end_time: normalizeSqlTime(schedule.window_end_time),
        })) };
    }

    async createPeriod(user: AuthUser, organizationId: string, dto: CreatePASPeriodDto) {
        await this.authz.assertProktor(user, organizationId);

        pasDateRange(dto.start_date, dto.end_date);

        const data = await insertIdempotently<{ id: string }>(this.db, {
            table: 'cbt_pas_periods',
            organizationId,
            clientRequestId: dto.clientRequestId,
            fingerprint: dto,
            select: 'id',
            payload: {
                organization_id: organizationId,
                name: dto.name,
                type: dto.type || 'pas',
                school_year: dto.school_year,
                semester: dto.semester || 'ganjil',
                start_date: dto.start_date,
                end_date: dto.end_date,
                screenshot_enabled: dto.screenshot_enabled === true,
                committee_chair_name: dto.committee_chair_name?.trim() || null,
                committee_chair_nip: dto.committee_chair_nip?.trim() || null,
                created_by: user.id,
                is_locked: false,
            },
        });

        return { id: data.id };
    }

    async updateCommitteeChair(user: AuthUser, periodId: string, dto: UpdatePASCommitteeChairDto) {
        await this.authz.assertProktorByRecord(user, 'cbt_pas_periods', periodId);
        const name = dto.committee_chair_name?.trim() || '';
        const nip = dto.committee_chair_nip?.trim() || null;
        if (!name) throw new BadRequestException('Nama Ketua Panitia wajib diisi.');

        await this.updatePeriod(user, periodId, { committee_chair_name: name, committee_chair_nip: nip || '' });
        return { id: periodId, committee_chair_name: name, committee_chair_nip: nip };
    }

    async updatePeriod(user: AuthUser, periodId: string, dto: UpdatePASPeriodDto) {
        await this.authz.assertProktorByRecord(user, 'cbt_pas_periods', periodId);
        return this.db.transaction(async db => {
            const period = await writablePasPeriod(db, periodId);
            const range = pasDateRange(dto.start_date ?? storedPasDate(period.start_date), dto.end_date ?? storedPasDate(period.end_date));
            if (dto.type !== undefined && !['pas', 'pat', 'am', 'pts', 'pkn'].includes(dto.type)) throw new BadRequestException('Jenis ujian tidak valid.');
            if (dto.semester !== undefined && !['ganjil', 'genap'].includes(dto.semester)) throw new BadRequestException('Semester tidak valid.');
            const { data: schedules, error } = await db.from('cbt_pas_class_schedules')
                .select('exam_id, scheduled_date').eq('pas_period_id', periodId);
            if (error) throw new BadRequestException('Jadwal periode belum dapat diperiksa.');
            if ((schedules || []).some((row: { scheduled_date: string; exam_id?: string }) => { const date = storedPasDate(row.scheduled_date); return date < range.start || date > range.end; })) {
                throw new ConflictException('Rentang tanggal baru tidak mencakup seluruh jadwal ujian. Sesuaikan jadwal terlebih dahulu.');
            }
            const updateData: Record<string, unknown> = {};
            for (const key of ['name', 'type', 'school_year', 'semester', 'committee_chair_name', 'committee_chair_nip'] as const) {
                if (dto[key] !== undefined) updateData[key] = dto[key]!.trim();
            }
            if (updateData.name === '' || updateData.school_year === '') throw new BadRequestException('Nama folder dan tahun ajaran wajib diisi.');
            const identityChanged = ['name', 'type', 'school_year', 'semester'].some(key => updateData[key] !== undefined && updateData[key] !== period[key]);
            const { data: reports, error: reportError } = await db.from('cbt_pas_administration_reports').select('id').eq('pas_period_id', periodId).limit(1);
            if (reportError) throw new BadRequestException('Riwayat administrasi belum dapat diperiksa.');
            if (identityChanged && ((schedules || []).some((row: { scheduled_date: string; exam_id?: string }) => row.exam_id) || reports?.length)) {
                throw new ConflictException('Identitas folder tidak dapat diubah setelah ujian dibangkitkan atau administrasi tersimpan.');
            }
            if (dto.start_date !== undefined) updateData.start_date = range.start;
            if (dto.end_date !== undefined) updateData.end_date = range.end;
            if (!Object.keys(updateData).length) return period;
            const { data, error: updateError } = await db.from('cbt_pas_periods').update(updateData).eq('id', periodId).select().single();
            if (updateError) throw new BadRequestException('Folder ujian belum berhasil diperbarui.');
            return data;
        });
    }

    /**
     * Simpan pengaturan ujian folder (bawaan + per bank soal) dan terapkan ke
     * ujian yang sudah dibangkitkan.
     *
     * - Nilai & pembahasan selalu ikut diperbarui, kecuali ujian yang sedang
     *   dalam koreksi kunci (rilisnya menunggu penilaian ulang selesai).
     * - Acak soal/opsi, mode aman, batas pelanggaran, dan berbagi layar tidak
     *   diubah pada ujian yang sudah dikerjakan siswa, supaya peserta dalam satu
     *   ujian tidak mendapat aturan berbeda. Ujian itu dilaporkan kembali.
     */
    async updateExamSettings(user: AuthUser, periodId: string, dto: UpdatePASExamSettingsDto) {
        await this.authz.assertProktorByRecord(user, 'cbt_pas_periods', periodId);
        return this.db.transaction(async db => {
            await writablePasPeriod(db, periodId);
            const { data: scheduleRows, error: scheduleError } = await db.from('cbt_pas_class_schedules')
                .select('id, bank_id, exam_id').eq('pas_period_id', periodId);
            if (scheduleError) throw new BadRequestException('Jadwal folder belum dapat dibaca.');
            const schedules = (scheduleRows || []) as Array<{ id: string; bank_id: string | null; exam_id: string | null }>;
            const config = normalizePasExamSettings(dto, new Set(schedules.map(row => row.bank_id).filter((id): id is string => Boolean(id))));

            const { error: saveError } = await db.from('cbt_pas_periods')
                .update({ exam_settings: config, screenshot_enabled: config.defaults.screenshot_enabled })
                .eq('id', periodId);
            if (saveError) throw new BadRequestException('Pengaturan ujian belum berhasil disimpan.');

            const examIds = [...new Set(schedules.map(row => row.exam_id).filter((id): id is string => Boolean(id)))];
            const result = { exam_settings: config, updated: 0, security_locked: [] as string[], results_locked: [] as string[] };
            if (!examIds.length) return result;

            // Serialize with new attempts and other exam updates before checking
            // history or merging metadata, so concurrent requests cannot undo each other.
            await lockExamsForDeletion(db, examIds);

            const [{ data: examRows, error: examError }, { data: attemptRows, error: attemptError }] = await Promise.all([
                db.from('cbt_exams').select('id, title, description, show_results, randomize_questions, randomize_options, scoring_type, metadata').in('id', examIds),
                db.from('cbt_exam_attempts').select('exam_id').in('exam_id', examIds),
            ]);
            if (examError || attemptError) throw new BadRequestException('Ujian folder belum dapat diperiksa.');
            const started = new Set(((attemptRows || []) as Array<{ exam_id: string }>).map(row => row.exam_id));
            // Ujian gabungan dipakai beberapa jadwal kelas dari bank yang sama: terapkan sekali per ujian.
            const bankByExam = new Map(schedules.filter(row => row.exam_id).map(row => [row.exam_id as string, row.bank_id]));
            const now = new Date().toISOString();

            for (const exam of ((examRows || []) as PasExamRow[])) {
                const label = pasExamLabel(exam as PasExamRow & { description?: string; title?: string });
                const change = pasExamSettingsUpdate(exam, resolvePasExamSettings(config, bankByExam.get(exam.id)), started.has(exam.id));
                if (change.resultsLocked) result.results_locked.push(label);
                if (change.securityLocked) result.security_locked.push(label);
                const { error } = await db.from('cbt_exams').update({ ...change.update, updated_at: now }).eq('id', exam.id);
                if (error) throw new BadRequestException(`Pengaturan ${label} belum berhasil diterapkan.`);
                result.updated += 1;
            }
            return result;
        });
    }

    async setPeriodLock(user: AuthUser, periodId: string, lock: boolean) {
        await this.authz.assertProktorByRecord(user, 'cbt_pas_periods', periodId);

        return this.db.transaction(async (db) => {
            await advisoryTransactionLock(db, `pas-period:${periodId}`);
            const { data: period, error: readError } = await db.from('cbt_pas_periods')
                .select('id').eq('id', periodId).maybeSingle();
            if (readError) throw new BadRequestException(`Gagal membaca periode: ${readError.message}`);
            if (!period) throw new NotFoundException('Periode tidak ditemukan.');

            const { error } = await db.from('cbt_pas_periods')
                .update({ is_locked: lock }).eq('id', periodId);
            if (error) throw new BadRequestException(`Gagal mengubah kunci periode: ${error.message}`);

            return { id: periodId, is_locked: lock };
        });
    }

    async removePeriod(user: AuthUser, periodId: string) {
        await this.authz.assertProktorByRecord(user, 'cbt_pas_periods', periodId);

        return this.db.transaction(async (db) => {
            await advisoryTransactionLock(db, `pas-period:${periodId}`);

            const { data: period } = await db.from('cbt_pas_periods')
                .select('is_locked').eq('id', periodId).maybeSingle();
            if (!period) throw new NotFoundException('Periode tidak ditemukan.');
            if ((period as { is_locked: boolean }).is_locked) {
                throw new ConflictException('Periode yang terkunci tidak bisa dihapus.');
            }

            const { data: scheduleData, error: scheduleError } = await db
                .from('cbt_pas_class_schedules')
                .select('id, exam_id')
                .eq('pas_period_id', periodId);
            if (scheduleError) throw new BadRequestException(`Gagal membaca jadwal: ${scheduleError.message}`);
            const schedules = (scheduleData as Array<{ id: string; exam_id: string | null }>) || [];
            for (const scheduleId of schedules.map((row) => row.id).sort()) {
                await advisoryTransactionLock(db, `pas-exam-generation:${scheduleId}`);
            }

            const { data: currentData, error: currentError } = await db
                .from('cbt_pas_class_schedules')
                .select('exam_id')
                .eq('pas_period_id', periodId);
            if (currentError) throw new BadRequestException(`Gagal membaca ujian periode: ${currentError.message}`);
            const examIds = ((currentData as Array<{ exam_id: string | null }>) || [])
                .map((row) => row.exam_id)
                .filter((id): id is string => Boolean(id));
            await lockExamsForDeletion(db, examIds);
            await assertExamsHaveNoHistory(db, examIds);
            const { data: reports, error: reportError } = await db.from('cbt_pas_administration_reports').select('id').eq('pas_period_id', periodId).limit(1);
            if (reportError) throw new BadRequestException('Riwayat administrasi belum dapat diperiksa.');
            if (reports?.length) throw new ConflictException('Periode memiliki riwayat administrasi dan tidak dapat dihapus.');

            const { error } = await db.from('cbt_pas_periods').delete().eq('id', periodId);
            if (error) throw new BadRequestException(`Gagal menghapus periode: ${error.message}`);

            if (examIds.length > 0) {
                const { error: examError } = await db.from('cbt_exams').delete().in('id', examIds);
                if (examError) throw new BadRequestException(`Gagal menghapus ujian periode: ${examError.message}`);
            }

            return { id: periodId };
        });
    }

    // ── Data pendukung ───────────────────────────────────────────────────────

    /** Master data diselaraskan ke UUID operasional yang dipakai foreign key CBT. */
    async listSubjects(user: AuthUser, organizationId: string) {
        await this.authz.assertOrgStaff(user, organizationId);
        return listOperationalSubjects(this.db, organizationId);
    }

    /**
     * Kelas satu organisasi, dengan jumlah siswanya.
     *
     * `activeYearOnly` dipakai pemilih kelas pada penjadwalan: tanpa itu, kelas
     * dengan nama sama dari tahun ajaran lama ikut muncul dan tidak bisa
     * dibedakan. Saat lebih dari satu tahun ajaran aktif, tahunnya ikut
     * ditempelkan ke nama supaya tetap bisa dibedakan.
     */
    async listClasses(user: AuthUser, organizationId: string, activeYearOnly: boolean) {
        await this.authz.assertOrgStaff(user, organizationId);

        let activeYears: string[] = [];
        if (activeYearOnly) {
            const { data: years } = await this.db
                .from('master_tahun_ajaran')
                .select('tahun_ajaran')
                .eq('is_active', true)
                .order('tahun_ajaran', { ascending: false });

            activeYears = [
                ...new Set(
                    ((years as Array<{ tahun_ajaran: string | null }>) || [])
                        .map((y) => y.tahun_ajaran)
                        .filter((y): y is string => Boolean(y)),
                ),
            ];
        }

        let query = this.db
            .from('cbt_classes')
            .select('*, _count:cbt_class_members(count)')
            .eq('organization_id', organizationId)
            .order('name');

        if (activeYears.length > 0) query = query.in('school_year', activeYears);

        const { data, error } = await query;

        if (error) {
            this.logger.error(`Gagal membaca daftar kelas: ${error.message}`);
            return [];
        }

        const multiYear = activeYears.length > 1;
        const classes = ((data as any[]) || []).map((row) => ({
            id: row.id,
            name: multiYear && row.school_year ? `${row.name} (${row.school_year})` : row.name,
            type: row.type,
            // Bentuk agregat PostgREST: `_count` adalah array satu elemen.
            studentCount: row._count?.[0]?.count || 0,
        }));

        // Pemilih penjadwalan menyembunyikan kelas kosong; menjadwalkan ujian
        // untuk kelas tanpa siswa hanya menghasilkan ujian yang tak seorang pun
        // bisa mengerjakannya.
        return activeYearOnly ? classes.filter((c) => c.studentCount > 0) : classes;
    }

    /** Master Guru ACCA juga mencakup guru yang belum memiliki keanggotaan CBT. */
    async listCommitteeTeachers(user: AuthUser, organizationId: string) {
        await this.authz.assertProktor(user, organizationId);
        // Seperti master_ruangan, master_guru dipakai bersama oleh instalasi satu sekolah ini.
        const { data, error } = await this.db.from('master_guru')
            .select('id, nama_lengkap, nip, jenis_pegawai, aktif')
            .order('nama_lengkap');
        if (error) {
            throw new ServiceUnavailableException('Master guru belum dapat dimuat. Nama dan NIP tetap dapat diisi manual.');
        }
        return ((data || []) as Array<{ id: string | number; nama_lengkap: string | null; nip: string | null; jenis_pegawai: string | null; aktif: boolean | null }>)
            .filter(teacher => teacher.aktif !== false && teacher.nama_lengkap?.trim()
                && ['', 'GURU'].includes(String(teacher.jenis_pegawai || '').trim().toUpperCase()))
            .map(teacher => ({ id: String(teacher.id), name: teacher.nama_lengkap!.trim(), nip: teacher.nip?.trim() || null }));
    }

    /**
     * Guru dan pengawas satu organisasi, untuk penugasan ruang.
     *
     * Peran disaring di sini, bukan di SQL, karena relasinya dua lompatan
     * (anggota → peran anggota → peran) dan jumlah anggota per sekolah masih
     * dalam ratusan.
     */
    async listStaff(user: AuthUser, organizationId: string) {
        await this.authz.assertProktor(user, organizationId);

        const { data, error } = await this.db
            .from('cbt_organization_members')
            .select(
                `user_id,
                 profiles:cbt_profiles(full_name, identity_number),
                 member_roles:cbt_member_roles(roles:cbt_roles(name))`,
            )
            .eq('organization_id', organizationId);

        if (error) {
            this.logger.error(`Gagal membaca daftar staf: ${error.message}`);
            return [];
        }

        return ((data as any[]) || [])
            .map((member) => ({
                id: member.user_id,
                name: member.profiles?.full_name || 'Tanpa nama',
                nip: member.profiles?.identity_number || null,
                roles: (member.member_roles || [])
                    .map((mr: any) => mr.roles?.name)
                    .filter(Boolean) as string[],
            }))
            .filter(
                (member) => member.roles.length === 0 || ['Guru', 'Pengawas', 'Proktor', 'Admin']
                    .some((role) => member.roles.includes(role)),
            );
    }
}
