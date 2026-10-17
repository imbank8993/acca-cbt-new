import {
    BadRequestException,
    ConflictException,
    Injectable,
    Logger,
    NotFoundException,
} from '@nestjs/common';
import type { AuthUser } from '@acca-cbt/shared';
import { AuthorizationService } from '../auth/authorization.service';
import { DbService } from '../prisma/prisma-db-adapter';
import { assertExamsHaveNoHistory, lockExamsForDeletion } from '../common/exam-deletion';
import { insertIdempotently } from '../common/idempotent-create';
import { listOperationalSubjects } from '../common/subject-catalog';
import { advisoryTransactionLock } from '../common/transaction-lock';
import { normalizeSqlTime } from '../common/school-time';
import type { CreatePASPeriodDto, UpdatePASCommitteeChairDto } from './dto/pas.dto';
import { loadPasReadiness } from './pas-readiness';

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

        const { data: schedules, error: schedulesError } = await this.db
            .from('cbt_pas_class_schedules')
            .select('*, classes:cbt_classes(name), question_banks:cbt_question_banks(id, title)')
            .eq('pas_period_id', periodId);

        if (schedulesError) throw new BadRequestException('Daftar jadwal belum dapat dibaca.');
        const readiness = await loadPasReadiness(this.db, period, schedules || []);

        return { ...(period as object), pas_class_schedules: ((schedules as any[]) || []).map(schedule => ({
            ...schedule,
            readiness: readiness.get(schedule.id),
            is_activated: readiness.get(schedule.id)?.activated ?? null,
            allocated_room_ids: readiness.get(schedule.id)?.room_ids || [],
            scheduled_time: normalizeSqlTime(schedule.scheduled_time),
            window_end_time: normalizeSqlTime(schedule.window_end_time),
        })) };
    }

    async createPeriod(user: AuthUser, organizationId: string, dto: CreatePASPeriodDto) {
        await this.authz.assertProktor(user, organizationId);

        if (new Date(dto.start_date) > new Date(dto.end_date)) {
            throw new BadRequestException('Tanggal mulai harus sebelum tanggal selesai.');
        }

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

        const { error } = await this.db.from('cbt_pas_periods').update({
            committee_chair_name: name,
            committee_chair_nip: nip,
        }).eq('id', periodId);

        if (error) throw new BadRequestException(`Gagal menyimpan Ketua Panitia: ${error.message}`);
        return { id: periodId, committee_chair_name: name, committee_chair_nip: nip };
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
                 profiles:cbt_profiles(full_name),
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
                roles: (member.member_roles || [])
                    .map((mr: any) => mr.roles?.name)
                    .filter(Boolean) as string[],
            }))
            .filter(
                (member) => ['Guru', 'Pengawas', 'Proktor', 'Admin']
                    .some((role) => member.roles.includes(role)),
            );
    }
}
