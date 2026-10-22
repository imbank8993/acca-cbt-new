import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { AuthUser } from '@acca-cbt/shared';
import { DbService } from '../prisma/prisma-db-adapter';
import { CbtRolesService } from './cbt-roles.service';
import { SingleSchoolService } from './single-school.service';
import { assignedPasExamStudents, isPasMonitoringExam } from '../common/pas-monitoring-access';
import { isSemesterAssessmentExam } from '../common/exam-types';

/**
 * Otorisasi per-organisasi, dipindahkan dari `apps/web/lib/server-authz.ts`.
 *
 * Perbedaan penting dengan versi lama: `user` di sini berasal dari token yang
 * sudah diverifikasi, bukan dari `userId` yang dikirim browser. Versi lama
 * dipanggil oleh 10 aksi saja sementara 62 aksi lain menerima `userId` sebagai
 * parameter biasa dan mempercayainya.
 *
 * Kegagalan dilempar sebagai `ForbiddenException`, bukan dikembalikan sebagai
 * `{ ok: false }`. `AllExceptionsFilter` mengubahnya menjadi
 * `{ success: false, error }` sehingga bentuk yang sampai ke frontend tetap
 * sama seperti sebelumnya.
 */
@Injectable()
export class AuthorizationService {
    constructor(
        private readonly db: DbService,
        private readonly roles: CbtRolesService,
        private readonly schoolScope: SingleSchoolService,
    ) {}

    /** Peran platform tetap istimewa, tetapi terikat pada sekolah instalasi. */
    private isElevatedGlobally(user: AuthUser): boolean {
        return user.isPlatformAdmin || user.resolved?.superadmin === true;
    }

    async isRestrictedProctor(user: AuthUser, organizationId: string): Promise<boolean> {
        if (this.isElevatedGlobally(user) || await this.roles.hasOrgRole(user.id, organizationId, ['Admin'])) return false;
        return this.roles.hasOrgRole(user.id, organizationId, ['Proktor']);
    }

    async assertOrgRole(
        user: AuthUser,
        organizationId: string | null | undefined,
        roles: string[],
        label = 'staf',
    ): Promise<void> {
        const schoolId = await this.schoolScope.assertSchoolId(organizationId);
        if (this.isElevatedGlobally(user)) return;
        if (await this.roles.hasOrgRole(user.id, schoolId, roles)) return;
        throw new ForbiddenException(`Anda tidak memiliki izin (khusus ${label}).`);
    }

    assertProktor(user: AuthUser, organizationId: string | null | undefined): Promise<void> {
        return this.assertOrgRole(user, organizationId, ['Proktor', 'Admin'], 'Proktor/Admin');
    }

    /** Operasi tingkat staf: kelola bank soal, kelas, ujian. */
    assertOrgStaff(user: AuthUser, organizationId: string | null | undefined): Promise<void> {
        return this.assertOrgRole(
            user,
            organizationId,
            ['Proktor', 'Admin', 'Guru'],
            'staf sekolah',
        );
    }

    /**
     * Apakah user LAIN (bukan pemanggil) berperan staf aktif (Guru/Proktor/Admin)
     * di sekolah ini. Dipakai saat menunjuk orang, mis. validator bank soal.
     */
    hasOrgStaffRole(userId: string, organizationId: string): Promise<boolean> {
        return this.roles.hasOrgRole(userId, organizationId, ['Proktor', 'Admin', 'Guru']);
    }

    /** Operasi pemantauan staf sekolah: Proktor, Admin, Guru, dan Pengawas. */
    assertOrgMonitoring(user: AuthUser, organizationId: string | null | undefined): Promise<void> {
        return this.assertOrgRole(
            user,
            organizationId,
            ['Proktor', 'Admin', 'Guru', 'Pengawas'],
            'staf pemantauan sekolah',
        );
    }

    assertPlatformAdmin(user: AuthUser): void {
        if (this.isElevatedGlobally(user)) return;
        throw new ForbiddenException('Anda tidak memiliki izin (khusus Admin Platform).');
    }

    /** Ambil `organization_id` sebuah baris, atau lempar bila barisnya tidak ada. */
    private async organizationOf(
        table: string,
        id: string,
        column = 'organization_id',
    ): Promise<string | null> {
        if (!id) throw new NotFoundException('Data tidak ditemukan.');
        const { data } = await this.db.from(table).select(column).eq('id', id).maybeSingle();
        if (!data) throw new NotFoundException('Data tidak ditemukan.');
        return (data as Record<string, string | null>)[column];
    }

    async assertRoleByRecord(
        user: AuthUser,
        table: string,
        id: string,
        roles: string[],
        label: string,
        column = 'organization_id',
    ): Promise<void> {
        const organizationId = await this.organizationOf(table, id, column);
        await this.assertOrgRole(user, organizationId, roles, label);
    }

    assertProktorByRecord(user: AuthUser, table: string, id: string, column = 'organization_id') {
        return this.assertRoleByRecord(user, table, id, ['Proktor', 'Admin'], 'Proktor/Admin', column);
    }

    assertStaffByRecord(user: AuthUser, table: string, id: string, column = 'organization_id') {
        return this.assertRoleByRecord(
            user, table, id, ['Proktor', 'Admin', 'Guru'], 'staf sekolah', column,
        );
    }

    /**
     * Organisasinya berjarak dua lompatan: baris ini menunjuk induk lewat
     * `foreignKey`, dan induknyalah yang membawa organisasi — mis. sesi PAS →
     * periode PAS → organisasi.
     */
    private async assertByParent(
        user: AuthUser,
        table: string,
        id: string,
        foreignKey: string,
        parentTable: string,
        roles: string[],
        label: string,
        parentColumn: string,
    ): Promise<void> {
        if (!id) throw new NotFoundException('Data tidak ditemukan.');
        const { data } = await this.db.from(table).select(foreignKey).eq('id', id).maybeSingle();
        const parentId = data ? (data as Record<string, string>)[foreignKey] : null;
        if (!parentId) throw new NotFoundException('Data tidak ditemukan.');
        await this.assertRoleByRecord(user, parentTable, parentId, roles, label, parentColumn);
    }

    assertProktorByParent(
        user: AuthUser, table: string, id: string, foreignKey: string,
        parentTable: string, parentColumn = 'organization_id',
    ) {
        return this.assertByParent(
            user, table, id, foreignKey, parentTable,
            ['Proktor', 'Admin'], 'Proktor/Admin', parentColumn,
        );
    }

    assertStaffByParent(
        user: AuthUser, table: string, id: string, foreignKey: string,
        parentTable: string, parentColumn = 'organization_id',
    ) {
        return this.assertByParent(
            user, table, id, foreignKey, parentTable,
            ['Proktor', 'Admin', 'Guru'], 'staf sekolah', parentColumn,
        );
    }

    /**
     * Otorisasi akses ke sebuah bank soal beserta SELURUH isinya — soal, opsi,
     * stimulus, petunjuk, kisi-kisi, dimensi, dan tafsirannya.
     *
     * Admin memiliki akses penuh dalam sekolahnya. Pemilik boleh mengelola bank;
     * proktor hanya boleh membaca bank milik orang lain yang sudah dipublikasikan.
     *
     * Organisasinya diambil dari BARIS BANK-nya, bukan dari parameter pemanggil.
     * Itu yang mencegah id bank milik sekolah lain diselundupkan bersama
     * `organizationId` milik sendiri.
     *
     * Mengembalikan `organization_id` bank tersebut, karena hampir setiap
     * pemanggil membutuhkannya untuk baris yang akan ia tulis — dan mengambilnya
     * dari sini berarti tidak ada jalur yang memakai organisasi kiriman klien.
     */
    async assertBankAccess(user: AuthUser, bankId: string, access: 'read' | 'write' = 'write', db: Pick<DbService, 'from'> = this.db): Promise<string> {
        if (!bankId) throw new NotFoundException('Bank soal tidak ditemukan.');

        const { data } = await db
            .from('cbt_question_banks')
            .select('organization_id, created_by, is_published')
            .eq('id', bankId)
            .maybeSingle();

        if (!data) throw new NotFoundException('Bank soal tidak ditemukan.');

        const bank = data as { organization_id: string; created_by: string | null; is_published?: boolean };

        await this.assertOrgStaff(user, bank.organization_id);

        const elevated =
            this.isElevatedGlobally(user) ||
            (await this.roles.hasOrgRole(user.id, bank.organization_id, ['Admin']));

        if (!elevated && bank.created_by !== user.id && access === 'read' && bank.is_published === true &&
            await this.roles.hasOrgRole(user.id, bank.organization_id, ['Proktor'])) return bank.organization_id;

        if (!elevated && bank.created_by !== user.id) {
            throw new ForbiddenException(
                'Anda hanya dapat mengelola bank soal buatan sendiri.',
            );
        }

        return bank.organization_id;
    }

    /**
     * Varian `assertBankAccess` yang bank-nya ditemukan lewat baris anaknya —
     * mis. satu stimulus, satu dimensi, atau satu soal.
     */
    async assertBankAccessByChild(
        user: AuthUser,
        table: string,
        id: string | null | undefined,
    ): Promise<string> {
        if (!id) throw new NotFoundException('Data tidak ditemukan.');

        const { data } = await this.db.from(table).select('bank_id').eq('id', id).maybeSingle();
        const bankId = (data as { bank_id: string | null } | null)?.bank_id;

        if (!bankId) throw new NotFoundException('Data tidak ditemukan.');
        return this.assertBankAccess(user, bankId);
    }

    /**
     * Otorisasi operasi pada sebuah ujian, dengan aturan kepemilikan:
     *
     *  - PAS/PAT: hanya Proktor/Admin organisasi (atau admin platform).
     *  - Jenis lain: seluruh staf, TETAPI Guru hanya boleh mengelola ujian yang
     *    ia buat sendiri. Proktor/Admin bebas.
     */
    async assertExamStaff(user: AuthUser, examId: string, operation: 'manage' | 'reset' = 'manage', studentId?: string): Promise<void> {
        if (!examId) throw new NotFoundException('Data tidak ditemukan.');

        const { data: exam } = await this.db
            .from('cbt_exams')
            .select('exam_type, created_by, organization_id, is_published')
            .eq('id', examId)
            .maybeSingle();

        if (!exam) throw new NotFoundException('Data tidak ditemukan.');

        const record = exam as {
            exam_type: string | null;
            created_by: string | null;
            organization_id: string | null;
            is_published?: boolean;
        };

        if (operation === 'reset') {
            const scope = await this.getExamResetScope(user, { ...record, id: examId });
            if (scope && (scope.allParticipants || (studentId && scope.studentIds.includes(studentId)))) return;
            throw new ForbiddenException('Reset, pulihkan, dan susulan hanya untuk admin atau pembuat ujian.');
        }
        if (!await this.canManageExam(user, record, operation)) {
            throw new ForbiddenException('Anda hanya dapat mengelola ujian yang Anda buat sendiri. PAS/PAT hanya dapat dikelola Proktor/Admin.');
        }
    }

    /** Ownership of a bank grants monitoring only, never recovery rights. */
    async getExamResetScope(user: AuthUser, record: {
        id?: string; organization_id: string | null; created_by: string | null; exam_type: string | null;
    }, _assignedStudents?: Map<string, string[]>): Promise<{ allParticipants: boolean; studentIds: string[] } | null> {
        const organizationId = await this.schoolScope.assertSchoolId(record.organization_id);
        const full = { allParticipants: true, studentIds: [] };
        if (this.isElevatedGlobally(user) || await this.roles.hasOrgRole(user.id, organizationId, ['Admin'])) return full;
        if (record.created_by !== user.id) return null;
        if (await this.roles.hasOrgRole(user.id, organizationId, ['Proktor', 'Guru', 'Pengawas'])) return full;
        return null;
    }

    /** Same policy for write authorization and monitoring controls. */
    async canManageExam(user: AuthUser, record: {
        id?: string;
        organization_id: string | null;
        created_by: string | null;
        exam_type: string | null;
        is_published?: boolean;
    }, operation: 'manage' | 'reset' = 'manage', assignedStudents?: Map<string, string[]>): Promise<boolean> {
        if (operation === 'reset') return Boolean(await this.getExamResetScope(user, record, assignedStudents));
        await this.schoolScope.assertSchoolId(record.organization_id);
        if (this.isElevatedGlobally(user)) return true;
        if (await this.roles.hasOrgRole(user.id, record.organization_id, ['Admin'])) return true;
        if (await this.roles.hasOrgRole(user.id, record.organization_id, ['Proktor'])) {
            return record.created_by === user.id || record.is_published === true;
        }
        if (isSemesterAssessmentExam(record)) return false;
        return record.created_by === user.id &&
            await this.roles.hasOrgRole(user.id, record.organization_id, ['Guru']);
    }

    /**
     * Otorisasi pemantauan ujian dan log pelanggaran.
     * undefined berarti seluruh peserta; array membatasi peserta pengawas ruang.
     * Pemilik bank soal tetap memantau kelas peserta lintas ruang.
     */
    async assertExamMonitoring(user: AuthUser, examId: string): Promise<string[] | undefined> {
        if (!examId) throw new NotFoundException('Data tidak ditemukan.');

        const { data: exam } = await this.db
            .from('cbt_exams')
            .select('exam_type, created_by, organization_id, question_bank_id, is_published')
            .eq('id', examId)
            .maybeSingle();

        if (!exam) throw new NotFoundException('Data tidak ditemukan.');

        const record = exam as {
            exam_type: string | null;
            created_by: string | null;
            organization_id: string | null;
            question_bank_id: string | null;
            is_published?: boolean;
        };

        await this.schoolScope.assertSchoolId(record.organization_id);
        if (this.isElevatedGlobally(user)) return;

        if (await this.isRestrictedProctor(user, record.organization_id!) && record.created_by !== user.id && record.is_published !== true && !isPasMonitoringExam(record)) {
            throw new ForbiddenException('Ujian milik guru lain belum dipublikasikan.');
        }

        // Admin dan Proktor tetap memantau seluruh peserta.
        const isMonitorStaff = await this.roles.hasOrgRole(
            user.id,
            record.organization_id,
            ['Proktor', 'Admin'],
        );
        if (isMonitorStaff) return;

        // Guru boleh memantau ujian buatannya sendiri
        const isTeacher = await this.roles.hasOrgRole(user.id, record.organization_id, ['Guru']);
        if (isTeacher && record.created_by === user.id) return;

        // Guru boleh memantau ujian yang menggunakan bank soal miliknya
        if (isTeacher && record.question_bank_id) {
            const { data: bank } = await this.db
                .from('cbt_question_banks')
                .select('created_by')
                .eq('id', record.question_bank_id)
                .maybeSingle();
            if ((bank as { created_by?: string } | null)?.created_by === user.id) return;
        }

        const isInvigilator = await this.roles.hasOrgRole(user.id, record.organization_id, ['Pengawas']);
        if (isInvigilator && !isPasMonitoringExam(record)) return;
        if ((isTeacher || isInvigilator) && record.organization_id) {
            const assigned = await assignedPasExamStudents(this.db, user.id, record.organization_id);
            if (assigned.has(examId)) return assigned.get(examId)!;
        }

        throw new ForbiddenException('Anda tidak memiliki izin memantau ujian ini.');
    }
}
