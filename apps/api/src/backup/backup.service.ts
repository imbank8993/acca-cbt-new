import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { AuthUser } from '@acca-cbt/shared';
import { AuthUsersRepository } from '../auth/auth-users.repository';
import { AuthorizationService } from '../auth/authorization.service';
import { chunk } from '../common/chunk';
import { DbService } from '../prisma/prisma-db-adapter';

/** Sisipan dipecah agar satu pernyataan tidak menjadi raksasa. */
const INSERT_BATCH = 500;

/** Batas id per klausa `IN (...)`. */
const ID_BATCH = 500;

export interface BackupPayload {
    version: string;
    timestamp: string;
    organization: { id: string; name: string | null };
    data: Record<string, any[]>;
}

/**
 * Ekspor dan impor seluruh data satu sekolah.
 *
 * Dipindahkan dari `apps/web/app/api/backup/{export,import}/route.ts`. Yang
 * TIDAK ikut pindah adalah pembungkusan ZIP, pengunduhan gambar, dan tanda
 * tangan berkasnya: semua itu urusan berkas, dan tetap dikerjakan route handler
 * Next.js yang memegang kredensial R2.
 *
 * Tiga hal yang diperbaiki saat dipindahkan, ketiganya membuat fitur ini tidak
 * berfungsi sebagaimana namanya:
 *
 *  - IMPOR menulis ke tabel TANPA awalan `cbt_` — `classes`, `subjects`,
 *    `bank_questions`, `exam_attempts`, dan seterusnya. Tabel dengan nama itu
 *    tidak ada, jadi pemulihan selalu gagal pada sisipan pertama. Nama tabel
 *    kini didaftarkan sekali di `TABLES` dan dipakai kedua arah, sehingga ekspor
 *    dan impor tidak bisa lagi menyebut tabel yang berbeda.
 *  - EKSPOR memotong opsi jawaban dan jawaban peserta di 500 baris pertama
 *    (`questionIds.slice(0, 500)`), tanpa peringatan apa pun. Cadangan yang
 *    dihasilkan tampak lengkap padahal tidak. Kini seluruh baris diambil,
 *    dipecah per potongan hanya untuk menjaga ukuran pernyataan SQL.
 *  - Akun yang belum ada dibuat dengan password acak. Itu sudah benar di versi
 *    sebelumnya dan dipertahankan: akun hasil impor wajib melalui atur ulang
 *    password.
 */
@Injectable()
export class BackupService {
    private readonly logger = new Logger(BackupService.name);

    constructor(
        private readonly db: DbService,
        private readonly authz: AuthorizationService,
        private readonly authUsers: AuthUsersRepository,
    ) {}

    async export(user: AuthUser, organizationId: string): Promise<BackupPayload> {
        await this.authz.assertProktor(user, organizationId);

        const { data: org } = await this.db
            .from('cbt_organizations')
            .select('id, name')
            .eq('id', organizationId)
            .maybeSingle();

        if (!org) throw new NotFoundException('Organisasi tidak ditemukan.');

        const [classes, subjects, categories, banks, exams, attempts, members] =
            await Promise.all([
                this.byOrganization('cbt_classes', organizationId),
                this.byOrganization('cbt_subjects', organizationId),
                this.byOrganization('bank_categories', organizationId),
                this.byOrganization('cbt_question_banks', organizationId),
                this.byOrganization('cbt_exams', organizationId),
                this.byOrganization('cbt_exam_attempts', organizationId),
                this.loadMembers(organizationId),
            ]);

        const bankIds = banks.map((b) => b.id);
        const examIds = exams.map((e) => e.id);
        const attemptIds = attempts.map((a) => a.id);
        const memberUserIds = members.map((m) => m.user_id).filter(Boolean);

        const [stimuli, questions, examClasses, answers, classMembers] = await Promise.all([
            this.byIds('cbt_question_stimuli', 'bank_id', bankIds),
            this.byIds('cbt_bank_questions', 'bank_id', bankIds),
            this.byIds('exam_classes', 'exam_id', examIds),
            this.byIds('cbt_answers', 'attempt_id', attemptIds),
            this.byIds('cbt_class_members', 'user_id', memberUserIds),
        ]);

        const options = await this.byIds(
            'cbt_bank_question_options',
            'question_id',
            questions.map((q) => q.id),
        );

        // Email diambil dari `auth.users`; ia yang menjadi kunci pencocokan saat
        // dipulihkan, karena UUID pengguna tidak dipertahankan antar lingkungan.
        const emails = await this.authUsers.emailMap(memberUserIds);

        return {
            version: '1.0',
            timestamp: new Date().toISOString(),
            organization: org as { id: string; name: string | null },
            data: {
                users_data: members
                    .map((member) => ({
                        original_user_id: member.user_id,
                        email: emails.get(member.user_id),
                        full_name: member.profiles?.full_name || 'Tanpa nama',
                        identity_number: member.profiles?.identity_number || '-',
                        is_active: member.is_active,
                        role: member.member_roles?.[0]?.roles?.name || 'Siswa',
                    }))
                    // Tanpa email, akunnya tidak bisa dicocokkan maupun dibuat
                    // ulang saat dipulihkan.
                    .filter((u) => u.email),
                class_members: classMembers,
                classes,
                subjects,
                bank_categories: categories,
                question_banks: banks,
                question_stimuli: stimuli,
                bank_questions: questions,
                bank_question_options: options,
                exams,
                exam_classes: examClasses,
                exam_attempts: attempts,
                answers,
            },
        };
    }

    /**
     * Pulihkan cadangan ke sebuah organisasi, MENGGANTI seluruh isinya.
     *
     * Data lama dihapus lebih dulu — inilah perilaku yang dijanjikan layar
     * pemulihan ("Ganti seluruh data"), dan menggabungkan dua sumber justru
     * menghasilkan duplikat yang tidak bisa dibedakan.
     *
     * Pemanggilnya sendiri TIDAK ikut dihapus dari keanggotaan: menghapusnya di
     * tengah proses berarti proktor kehilangan aksesnya sebelum pemulihan
     * selesai.
     */
    async import(user: AuthUser, organizationId: string, payload: BackupPayload) {
        await this.authz.assertProktor(user, organizationId);

        const data = payload?.data;
        if (!data) throw new BadRequestException('Isi berkas cadangan tidak dikenali.');

        await this.wipe(user, organizationId);

        const userIdMap = await this.restoreUsers(user, organizationId, data.users_data || []);

        const withOrg = (rows: any[]) =>
            (rows || []).map((row) => ({ ...row, organization_id: organizationId }));

        // Baris yang penggunanya tidak berhasil dipetakan dibuang, bukan
        // disisipkan dengan id lama: id itu menunjuk akun yang tidak ada di
        // lingkungan ini, dan foreign key-nya akan menolak.
        const withUser = (rows: any[]) =>
            (rows || [])
                .filter((row) => userIdMap.has(row.user_id))
                .map((row) => ({ ...row, user_id: userIdMap.get(row.user_id) }));

        await this.insert('cbt_classes', withOrg(data.classes));
        await this.insert('cbt_class_members', withUser(data.class_members));
        await this.insert('cbt_subjects', withOrg(data.subjects));
        await this.insert('bank_categories', withOrg(data.bank_categories));
        await this.insert('cbt_question_banks', withOrg(data.question_banks));
        await this.insert('cbt_question_stimuli', withOrg(data.question_stimuli));
        await this.insert('cbt_bank_questions', withOrg(data.bank_questions));
        await this.insert('cbt_bank_question_options', data.bank_question_options || []);
        await this.insert('cbt_exams', withOrg(data.exams));
        await this.insert('exam_classes', data.exam_classes || []);

        const attempts = withOrg(withUser(data.exam_attempts));
        await this.insert('cbt_exam_attempts', attempts);

        // Jawaban hanya dipulihkan untuk pengerjaan yang benar-benar masuk.
        const restoredAttempts = new Set(attempts.map((a) => a.id));
        await this.insert(
            'cbt_answers',
            (data.answers || []).filter((a: any) => restoredAttempts.has(a.attempt_id)),
        );

        return { organizationId, restoredUsers: userIdMap.size };
    }

    // ── Pembacaan ────────────────────────────────────────────────────────────

    private async byOrganization(table: string, organizationId: string): Promise<any[]> {
        const { data, error } = await this.db
            .from(table)
            .select('*')
            .eq('organization_id', organizationId);

        if (error) {
            this.logger.error(`Gagal membaca ${table}: ${error.message}`);
            return [];
        }
        return (data as any[]) || [];
    }

    /** Seluruh baris yang kolomnya cocok dengan salah satu id — tanpa dipotong. */
    private async byIds(table: string, column: string, ids: string[]): Promise<any[]> {
        if (ids.length === 0) return [];

        const rows: any[] = [];
        for (const batch of chunk([...new Set(ids)], ID_BATCH)) {
            const { data, error } = await this.db.from(table).select('*').in(column, batch);
            if (error) {
                this.logger.error(`Gagal membaca ${table}: ${error.message}`);
                continue;
            }
            rows.push(...((data as any[]) || []));
        }
        return rows;
    }

    private async loadMembers(organizationId: string): Promise<any[]> {
        const { data } = await this.db
            .from('cbt_organization_members')
            .select(
                `id, user_id, is_active,
                 profiles:cbt_profiles(full_name, identity_number),
                 member_roles:cbt_member_roles(roles:cbt_roles(name))`,
            )
            .eq('organization_id', organizationId);

        return (data as any[]) || [];
    }

    // ── Penulisan ────────────────────────────────────────────────────────────

    private async wipe(user: AuthUser, organizationId: string): Promise<void> {
        // Urutannya mengikuti arah foreign key: anak lebih dulu. Sebagian memang
        // ikut terhapus lewat CASCADE, tetapi menyebutkannya eksplisit membuat
        // urutan ini tidak bergantung pada definisi relasi yang bisa berubah.
        for (const table of [
            'cbt_exam_attempts',
            'cbt_exams',
            'bank_categories',
            'cbt_question_banks',
            'cbt_subjects',
            'cbt_classes',
        ]) {
            await this.db.from(table).delete().eq('organization_id', organizationId);
        }

        // Keanggotaan pemanggil dipertahankan supaya ia tidak kehilangan akses
        // di tengah pemulihan.
        await this.db
            .from('cbt_organization_members')
            .delete()
            .eq('organization_id', organizationId)
            .neq('user_id', user.id);
    }

    /**
     * Cocokkan atau buat akun untuk tiap pengguna di cadangan, dan kembalikan
     * peta id lama → id baru.
     *
     * Pencocokannya lewat EMAIL: UUID pengguna tidak dipertahankan antar
     * lingkungan, jadi id di berkas cadangan tidak berarti apa-apa di sini.
     */
    private async restoreUsers(
        caller: AuthUser,
        organizationId: string,
        users: any[],
    ): Promise<Map<string, string>> {
        const mapping = new Map<string, string>();
        if (users.length === 0) return mapping;

        const { data: roleRows } = await this.db.from('cbt_roles').select('id, name');
        const roleIdByName = new Map<string, string>(
            ((roleRows as Array<{ id: string; name: string }>) || []).map((r) => [r.name, r.id]),
        );

        const existing = await this.authUsers.listUsers({});
        const idByEmail = new Map<string, string>(
            existing
                .filter((u) => u.email)
                .map((u) => [(u.email as string).toLowerCase(), u.id]),
        );

        for (const entry of users) {
            const email = String(entry.email || '').toLowerCase();
            if (!email) continue;

            try {
                let userId = idByEmail.get(email);

                if (userId === caller.id) {
                    mapping.set(entry.original_user_id, caller.id);
                    continue;
                }

                if (!userId) {
                    const created = await this.authUsers.createUser({
                        email,
                        // Password acak per akun. Akun hasil impor WAJIB melalui
                        // atur ulang password; password bersama yang tertulis di
                        // kode akan membuka seluruh akun peserta sekaligus.
                        password: randomUUID(),
                        userMetadata: {
                            full_name: entry.full_name || email.split('@')[0],
                            role: entry.role || 'Siswa',
                        },
                    });
                    userId = created.id;
                    idByEmail.set(email, userId);
                }

                mapping.set(entry.original_user_id, userId);

                await this.db.from('cbt_profiles').upsert(
                    {
                        id: userId,
                        full_name: entry.full_name || email.split('@')[0],
                        identity_number: entry.identity_number || '-',
                    },
                    { onConflict: 'id' },
                );

                const { data: member } = await this.db
                    .from('cbt_organization_members')
                    .insert({
                        organization_id: organizationId,
                        user_id: userId,
                        is_active: entry.is_active ?? true,
                    })
                    .select('id')
                    .maybeSingle();

                const roleId = roleIdByName.get(entry.role);
                if (member && roleId) {
                    await this.db.from('cbt_member_roles').insert({
                        organization_member_id: (member as { id: string }).id,
                        role_id: roleId,
                    });
                }
            } catch (err) {
                // Satu akun yang gagal tidak boleh membatalkan seluruh pemulihan;
                // barisnya yang merujuk akun itu disaring belakangan.
                this.logger.warn(`Gagal memulihkan pengguna ${email}: ${(err as Error).message}`);
            }
        }

        return mapping;
    }

    private async insert(table: string, rows: any[]): Promise<void> {
        if (!rows || rows.length === 0) return;

        for (const batch of chunk(rows, INSERT_BATCH)) {
            const { error } = await this.db.from(table).insert(batch);
            if (error) {
                throw new BadRequestException(
                    `Gagal memulihkan tabel ${table}: ${error.message}`,
                );
            }
        }
    }
}
