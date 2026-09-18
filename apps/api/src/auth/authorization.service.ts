import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { AuthUser } from '@acca-cbt/shared';
import { DbService } from '../prisma/prisma-db-adapter';
import { CbtRolesService } from './cbt-roles.service';

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
    ) {}

    /** Admin platform boleh lintas organisasi. */
    private isElevatedGlobally(user: AuthUser): boolean {
        return user.isPlatformAdmin || user.resolved?.superadmin === true;
    }

    async assertOrgRole(
        user: AuthUser,
        organizationId: string | null | undefined,
        roles: string[],
        label = 'staf',
    ): Promise<void> {
        if (this.isElevatedGlobally(user)) return;
        if (await this.roles.hasOrgRole(user.id, organizationId, roles)) return;
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
     * Aturannya sama bentuknya dengan `assertExamStaff`: Proktor/Admin bebas di
     * organisasinya, Guru hanya bank yang ia buat sendiri.
     *
     * Organisasinya diambil dari BARIS BANK-nya, bukan dari parameter pemanggil.
     * Itu yang mencegah id bank milik sekolah lain diselundupkan bersama
     * `organizationId` milik sendiri.
     *
     * Mengembalikan `organization_id` bank tersebut, karena hampir setiap
     * pemanggil membutuhkannya untuk baris yang akan ia tulis — dan mengambilnya
     * dari sini berarti tidak ada jalur yang memakai organisasi kiriman klien.
     */
    async assertBankAccess(user: AuthUser, bankId: string): Promise<string> {
        if (!bankId) throw new NotFoundException('Bank soal tidak ditemukan.');

        const { data } = await this.db
            .from('cbt_question_banks')
            .select('organization_id, created_by')
            .eq('id', bankId)
            .maybeSingle();

        if (!data) throw new NotFoundException('Bank soal tidak ditemukan.');

        const bank = data as { organization_id: string; created_by: string | null };

        await this.assertOrgStaff(user, bank.organization_id);

        const elevated =
            this.isElevatedGlobally(user) ||
            (await this.roles.hasOrgRole(user.id, bank.organization_id, ['Proktor', 'Admin']));

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
    async assertExamStaff(user: AuthUser, examId: string): Promise<void> {
        if (!examId) throw new NotFoundException('Data tidak ditemukan.');

        const { data: exam } = await this.db
            .from('cbt_exams')
            .select('exam_type, created_by, organization_id')
            .eq('id', examId)
            .maybeSingle();

        if (!exam) throw new NotFoundException('Data tidak ditemukan.');

        const record = exam as {
            exam_type: string | null;
            created_by: string | null;
            organization_id: string | null;
        };

        if (record.exam_type === 'pas' || record.exam_type === 'pat') {
            await this.assertOrgRole(
                user, record.organization_id, ['Proktor', 'Admin'], 'Proktor/Admin',
            );
            return;
        }

        await this.assertOrgStaff(user, record.organization_id);

        const elevated =
            this.isElevatedGlobally(user) ||
            (await this.roles.hasOrgRole(user.id, record.organization_id, ['Proktor', 'Admin']));

        if (!elevated && record.created_by !== user.id) {
            throw new ForbiddenException(
                'Anda hanya dapat mengelola ujian yang Anda buat sendiri.',
            );
        }
    }
}
