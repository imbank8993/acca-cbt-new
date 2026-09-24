import {
    BadRequestException,
    ForbiddenException,
    Injectable,
    Logger,
    NotFoundException,
} from '@nestjs/common';
import type { AuthUser } from '@acca-cbt/shared';
import { AuthorizationService } from '../auth/authorization.service';
import { CbtRolesService } from '../auth/cbt-roles.service';
import { chunk } from '../common/chunk';
import { DbService } from '../prisma/prisma-db-adapter';

/** Sisipan anggota kelas dipecah agar satu pernyataan tidak menjadi raksasa. */
const MEMBER_INSERT_BATCH = 500;

/**
 * Kelas: daftar, pembuatan, penyuntingan, dan sinkronisasi dari master data
 * acca-app.
 *
 * Dipindahkan dari `apps/web/app/actions/proktor.ts`.
 *
 * Ada DUA tabel kelas yang bentuknya mirip dan mudah tertukar:
 *  - `cbt_classes` — kelas reguler, cerminan data induk sekolah. Hanya
 *    Proktor/Admin yang boleh menyentuhnya; isinya datang dari sinkronisasi.
 *  - `cbt_additional_classes` — kelas tambahan yang dibuat guru sendiri, punya
 *    kode undangan. Guru boleh mengelola yang ia buat.
 *
 * Keduanya punya tabel keanggotaan sendiri. Setiap fungsi di sini yang menerima
 * `classId` harus mencari di kedua tabel, karena layar mengirim id dari daftar
 * gabungan.
 */
@Injectable()
export class ClassesService {
    private readonly logger = new Logger(ClassesService.name);

    constructor(
        private readonly db: DbService,
        private readonly authz: AuthorizationService,
        private readonly roles: CbtRolesService,
    ) {}

    /**
     * Daftar kelas gabungan (reguler + tambahan) beserta jumlah siswanya.
     *
     * Menjalankan sinkronisasi master data lebih dulu supaya kelas dan
     * keanggotaan selalu mencerminkan tahun ajaran aktif di acca-app.
     */
    async list(user: AuthUser, organizationId: string, activeYearOnly: boolean) {
        await this.authz.assertOrgStaff(user, organizationId);

        const resolvedOrgId = await this.resolveOrganizationId(organizationId);
        if (resolvedOrgId) await this.syncFromMasterData(resolvedOrgId);

        const activeYears = activeYearOnly ? await this.activeSchoolYears() : [];

        let regularQuery = this.db
            .from('cbt_classes')
            .select('*, class_members:cbt_class_members(count)');

        let additionalQuery = this.db
            .from('cbt_additional_classes')
            .select('*, class_members:cbt_additional_class_members(count)');

        if (organizationId !== 'all') {
            regularQuery = regularQuery.eq('organization_id', organizationId);
            additionalQuery = additionalQuery.eq('organization_id', organizationId);
        }

        // Hanya kelas reguler yang disaring per tahun: kelas tambahan bersifat
        // sesaat dan tidak terikat tahun ajaran.
        if (activeYears.length > 0) {
            regularQuery = regularQuery.in('school_year', activeYears);
        }

        const [regular, additional] = await Promise.all([
            regularQuery.order('created_at', { ascending: false }),
            additionalQuery.order('created_at', { ascending: false }),
        ]);

        if (regular.error) {
            this.logger.error(`Gagal membaca kelas reguler: ${regular.error.message}`);
        }
        if (additional.error) {
            this.logger.error(`Gagal membaca kelas tambahan: ${additional.error.message}`);
        }

        // Saat lebih dari satu tahun ajaran aktif, nama kelas yang sama muncul
        // sekali per tahun — tahunnya ditempelkan supaya bisa dibedakan.
        const multiYear = activeYears.length > 1;

        const regularClasses = ((regular.data as any[]) || []).map((cls) => ({
            ...cls,
            name: multiYear && cls.school_year ? `${cls.name} (${cls.school_year})` : cls.name,
            type: 'reguler',
            studentCount: cls.class_members?.[0]?.count || 0,
            canEdit: false,
            canDelete: false,
        }));

        const additionalRows = (additional.data as any[]) || [];
        const elevatedCreators = await this.creatorsWithElevatedRole(
            additionalRows,
            organizationId,
        );

        const additionalClasses = additionalRows.map((cls) => {
            // Kelas tanpa pembuat berarti buatan sistem, jadi dianggap milik
            // proktor dan tetap bisa dikelola.
            const managedByStaff = cls.created_by ? elevatedCreators.has(cls.created_by) : true;

            return {
                ...cls,
                type: 'tambahan',
                studentCount: cls.class_members?.[0]?.count || 0,
                canEdit: managedByStaff,
                canDelete: managedByStaff,
            };
        });

        const combined = [...regularClasses, ...additionalClasses].sort(compareClasses);

        // Pemilih kelas pada penjadwalan menyembunyikan kelas kosong:
        // keanggotaan mencerminkan data siswa acca-app, jadi kelas kosong di
        // sini berarti memang tidak ada siswa terdaftar untuk tahun itu.
        return activeYearOnly ? combined.filter((c) => c.studentCount > 0) : combined;
    }

    private async creatorsWithElevatedRole(
        rows: any[],
        organizationId: string,
    ): Promise<Set<string>> {
        const creatorIds = [
            ...new Set(rows.map((c) => c.created_by).filter(Boolean) as string[]),
        ];
        if (creatorIds.length === 0) return new Set();

        let query = this.db
            .from('cbt_organization_members')
            .select('user_id, member_roles:cbt_member_roles(roles:cbt_roles(name))')
            .in('user_id', creatorIds)
            .eq('is_active', true);

        if (organizationId !== 'all') {
            query = query.eq('organization_id', organizationId);
        }

        const { data } = await query;

        const elevated = new Set<string>();
        for (const member of (data as any[]) || []) {
            const names = (member.member_roles || []).map((mr: any) => mr?.roles?.name);
            if (names.includes('Proktor') || names.includes('Admin')) {
                elevated.add(member.user_id);
            }
        }
        return elevated;
    }

    /** Siswa per kelas untuk sekumpulan id, dalam bentuk peta classId → siswa. */
    async listMembers(
        user: AuthUser,
        classIds: string[],
    ): Promise<Record<string, any[]>> {
        if (classIds.length === 0) return {};

        // Diperiksa per kelas: satu permintaan bisa memuat kelas dari organisasi
        // lain di antara kelas milik pemanggil.
        for (const classId of classIds) {
            await this.authz.assertStaffByRecord(user, 'cbt_classes', classId);
        }

        const { data, error } = await this.db
            .from('cbt_class_members')
            .select('class_id, student:cbt_profiles(id, full_name, identity_number)')
            .in('class_id', classIds);

        if (error) {
            this.logger.error(`Gagal membaca anggota kelas: ${error.message}`);
            return {};
        }

        const byClass: Record<string, any[]> = {};
        for (const row of (data as any[]) || []) {
            if (!row.student) continue;
            (byClass[row.class_id] ||= []).push(row.student);
        }
        return byClass;
    }

    /** Siswa satu kelas, reguler maupun tambahan. */
    async listStudents(user: AuthUser, classId: string, isAdditional: boolean) {
        const table = isAdditional ? 'cbt_additional_classes' : 'cbt_classes';
        await this.authz.assertStaffByRecord(user, table, classId);

        const memberTable = isAdditional
            ? 'cbt_additional_class_members'
            : 'cbt_class_members';

        const { data, error } = await this.db
            .from(memberTable)
            .select('user_id, profiles:cbt_profiles!inner(id, full_name, identity_number)')
            .eq('class_id', classId);

        if (error) {
            this.logger.error(`Gagal membaca siswa kelas ${classId}: ${error.message}`);
            return [];
        }

        return ((data as any[]) || []).map((member) => ({
            id: member.profiles.id,
            name: member.profiles.full_name,
            identity_number: member.profiles.identity_number,
        }));
    }

    async create(
        user: AuthUser,
        organizationId: string,
        input: { name: string; type: 'reguler' | 'tambahan'; schoolYear?: string },
    ) {
        await this.authz.assertProktor(user, organizationId);

        if (input.type === 'tambahan') {
            const { data, error } = await this.db
                .from('cbt_additional_classes')
                .insert({
                    organization_id: organizationId,
                    name: input.name,
                    join_code: generateJoinCode(),
                    created_by: user.id,
                })
                .select()
                .single();

            if (error) throw new BadRequestException(error.message);
            return { ...(data as object), type: 'tambahan' };
        }

        const { data, error } = await this.db
            .from('cbt_classes')
            .insert({
                organization_id: organizationId,
                name: input.name,
                type: input.type,
                school_year: input.schoolYear || null,
                // Kelas manual selalu Reguler; program lain datang dari
                // sinkronisasi master data.
                program: 'Reguler',
            })
            .select()
            .single();

        if (error) throw new BadRequestException(error.message);
        return { ...(data as object), type: 'reguler' };
    }

    /**
     * Impor banyak kelas sekaligus.
     *
     * Satu kelas yang gagal tidak menghentikan sisanya: berkas impor biasanya
     * memuat puluhan baris, dan berhenti di tengah meninggalkan sebagian sudah
     * terbuat tanpa keterangan apa pun.
     */
    async importMany(
        user: AuthUser,
        organizationId: string,
        classes: Array<{ name: string; type: 'reguler' | 'tambahan'; schoolYear?: string }>,
    ) {
        await this.authz.assertProktor(user, organizationId);

        let successCount = 0;
        const errors: Array<{ name: string; error: string }> = [];

        for (const cls of classes) {
            try {
                await this.create(user, organizationId, cls);
                successCount++;
            } catch (err) {
                errors.push({ name: cls.name, error: (err as Error).message });
            }
        }

        return { successCount, failedCount: errors.length, errors };
    }

    async update(
        user: AuthUser,
        classId: string,
        input: { name: string; type: 'reguler' | 'tambahan'; schoolYear?: string },
    ) {
        const { table, createdBy, organizationId } = await this.locate(classId);

        if (table === 'cbt_additional_classes') {
            await this.assertAdditionalClassOwner(user, organizationId, createdBy);

            // Hanya nama yang bisa diubah: kelas tambahan tidak punya tahun
            // ajaran maupun jenis.
            const { error } = await this.db
                .from('cbt_additional_classes')
                .update({ name: input.name })
                .eq('id', classId);

            if (error) throw new BadRequestException(error.message);
            return { id: classId };
        }

        await this.authz.assertProktorByRecord(user, table, classId);

        const { error } = await this.db
            .from('cbt_classes')
            .update({
                name: input.name,
                type: input.type,
                school_year: input.schoolYear || null,
            })
            .eq('id', classId);

        if (error) throw new BadRequestException(error.message);
        return { id: classId };
    }

    async remove(user: AuthUser, classId: string) {
        const { table } = await this.locate(classId);

        // Kelas utama/reguler berasal dari data master acca-new dan tidak boleh dihapus dari CBT.
        if (table === 'cbt_classes') {
            throw new BadRequestException(
                'Kelas utama disinkronkan dari data master acca-new dan tidak dapat dihapus di sini.',
            );
        }

        await this.authz.assertProktorByRecord(user, table, classId);

        // Bersihkan data relasi terlebih dahulu agar tidak memicu foreign key violation.
        await this.db.from('cbt_additional_class_members').delete().eq('class_id', classId);
        await this.db.from('cbt_exam_targets').delete().eq('additional_class_id', classId);

        const { error } = await this.db.from('cbt_additional_classes').delete().eq('id', classId);
        if (error) throw new BadRequestException(error.message);

        return { id: classId };
    }

    /** Di tabel mana sebuah id kelas berada. */
    private async locate(classId: string): Promise<{
        table: 'cbt_classes' | 'cbt_additional_classes';
        organizationId: string | null;
        createdBy: string | null;
    }> {
        const { data: regular } = await this.db
            .from('cbt_classes')
            .select('organization_id')
            .eq('id', classId)
            .maybeSingle();

        if (regular) {
            return {
                table: 'cbt_classes',
                organizationId: (regular as { organization_id: string }).organization_id,
                createdBy: null,
            };
        }

        const { data: additional } = await this.db
            .from('cbt_additional_classes')
            .select('organization_id, created_by')
            .eq('id', classId)
            .maybeSingle();

        if (additional) {
            const row = additional as { organization_id: string; created_by: string | null };
            return {
                table: 'cbt_additional_classes',
                organizationId: row.organization_id,
                createdBy: row.created_by,
            };
        }

        throw new NotFoundException('Kelas tidak ditemukan.');
    }

    /** Guru hanya boleh mengubah kelas tambahan yang ia buat sendiri. */
    private async assertAdditionalClassOwner(
        user: AuthUser,
        organizationId: string | null,
        createdBy: string | null,
    ): Promise<void> {
        await this.authz.assertOrgStaff(user, organizationId);

        const elevated =
            user.isPlatformAdmin ||
            user.resolved?.superadmin === true ||
            (await this.roles.hasOrgRole(user.id, organizationId, ['Proktor', 'Admin']));

        if (!elevated && createdBy !== user.id) {
            throw new ForbiddenException(
                'Anda hanya dapat mengubah kelas yang Anda buat sendiri.',
            );
        }
    }

    // ── Sinkronisasi master data ─────────────────────────────────────────────

    /** Tahun ajaran yang sedang aktif; bisa lebih dari satu saat masa transisi. */
    private async activeSchoolYears(): Promise<string[]> {
        const { data } = await this.db
            .from('master_tahun_ajaran')
            .select('tahun_ajaran')
            .eq('is_active', true)
            .order('tahun_ajaran', { ascending: false });

        return [
            ...new Set(
                ((data as Array<{ tahun_ajaran: string | null }>) || [])
                    .map((row) => row.tahun_ajaran)
                    .filter((y): y is string => Boolean(y)),
            ),
        ];
    }

    /**
     * Dasbor admin platform mengirim `'all'`; sinkronisasi butuh organisasi
     * sungguhan karena nilainya ditulis ke kolom uuid. Pemasangan ini satu
     * sekolah, jadi yang tertua adalah satu-satunya.
     */
    private async resolveOrganizationId(organizationId: string): Promise<string | null> {
        if (organizationId !== 'all') return organizationId;

        const { data } = await this.db
            .from('cbt_organizations')
            .select('id')
            .order('created_at', { ascending: true })
            .limit(1)
            .maybeSingle();

        return (data as { id: string } | null)?.id ?? null;
    }

    /**
     * Salin kelas dan keanggotaan siswa dari master data acca-app ke tabel CBT.
     *
     * Dijalankan saat daftar kelas dibuka, bukan lewat tugas terjadwal: data
     * induknya berubah kapan saja (siswa pindah kelas, kelas baru dibuka), dan
     * daftar yang basi berarti guru menjadwalkan ujian untuk kelas yang salah.
     *
     * Bersifat menambah saja. Kelas dan keanggotaan yang sudah ada tidak
     * disentuh, dan tidak ada yang dihapus — menghapus di sini berarti
     * kehilangan kelas yang dibuat manual.
     */
    private async syncFromMasterData(organizationId: string): Promise<void> {
        try {
            const activeYears = await this.activeSchoolYears();
            if (activeYears.length === 0) return;

            // SELURUH program diambil, bukan hanya Reguler: penyaringan ke
            // 'Reguler' pernah membuang kelas Peminatan dan UTBK diam-diam.
            const { data: masterClasses } = await this.db
                .from('master_kelas')
                .select('*')
                .eq('aktif', true);

            const master = (masterClasses as any[]) || [];
            if (master.length === 0) return;

            const classIdByKey = await this.syncClasses(organizationId, master, activeYears);
            await this.syncMembers(classIdByKey, activeYears);
        } catch (err) {
            // Sinkronisasi adalah pelengkap: kegagalannya tidak boleh membuat
            // daftar kelas gagal dimuat seluruhnya.
            this.logger.error(`Sinkronisasi master data gagal: ${(err as Error).message}`);
        }
    }

    /** Kunci peta: `namaKelas-tahunAjaran`. */
    private async syncClasses(
        organizationId: string,
        master: any[],
        activeYears: string[],
    ): Promise<Map<string, string>> {
        const { data: existing } = await this.db
            .from('cbt_classes')
            .select('id, name, school_year')
            .eq('organization_id', organizationId);

        const byKey = new Map<string, string>(
            ((existing as Array<{ id: string; name: string; school_year: string }>) || []).map(
                (c) => [`${c.name}-${c.school_year}`, c.id],
            ),
        );

        const missing: Record<string, unknown>[] = [];
        for (const year of activeYears) {
            for (const masterClass of master) {
                if (byKey.has(`${masterClass.nama}-${year}`)) continue;
                missing.push({
                    organization_id: organizationId,
                    name: masterClass.nama,
                    type: 'reguler',
                    program: masterClass.program || 'Reguler',
                    school_year: year,
                });
            }
        }

        if (missing.length > 0) {
            const { data: inserted } = await this.db
                .from('cbt_classes')
                .insert(missing)
                .select('id, name, school_year');

            for (const cls of (inserted as Array<{
                id: string;
                name: string;
                school_year: string;
            }>) || []) {
                byKey.set(`${cls.name}-${cls.school_year}`, cls.id);
            }
        }

        return byKey;
    }

    private async syncMembers(
        classIdByKey: Map<string, string>,
        activeYears: string[],
    ): Promise<void> {
        const [{ data: enrolments }, { data: users }, { data: members }] = await Promise.all([
            this.db.from('siswa_kelas').select('*').eq('aktif', true).in('tahun_ajaran', activeYears),
            // Siswa dipetakan lewat NISN → `users.nip` → `auth_id`; hanya akun
            // yang sudah punya identitas yang bisa disinkronkan.
            this.db.from('users').select('auth_id, nip, nama').not('auth_id', 'is', null),
            this.db.from('cbt_class_members').select('class_id, user_id'),
        ]);

        const authIdByNip = new Map(
            ((users as Array<{ auth_id: string; nip: string }>) || []).map((u) => [
                u.nip,
                u.auth_id,
            ]),
        );

        const existingMembers = new Set(
            ((members as Array<{ class_id: string; user_id: string }>) || []).map(
                (m) => `${m.class_id}-${m.user_id}`,
            ),
        );

        const profiles = new Map<string, Record<string, unknown>>();
        const newMembers: Record<string, unknown>[] = [];

        for (const enrolment of (enrolments as any[]) || []) {
            const authId = authIdByNip.get(enrolment.nisn);
            if (!authId) continue;

            const classId = classIdByKey.get(`${enrolment.kelas}-${enrolment.tahun_ajaran}`);
            if (!classId) continue;

            // Peta, bukan array: satu siswa bisa muncul di beberapa baris
            // pendaftaran, dan upsert dengan id kembar akan gagal.
            profiles.set(authId, {
                id: authId,
                full_name: enrolment.nama_siswa,
                identity_number: enrolment.nisn,
            });

            const key = `${classId}-${authId}`;
            if (existingMembers.has(key)) continue;

            newMembers.push({ class_id: classId, user_id: authId });
            existingMembers.add(key);
        }

        if (profiles.size > 0) {
            await this.db
                .from('cbt_profiles')
                .upsert([...profiles.values()], { onConflict: 'id' });
        }

        for (const batch of chunk(newMembers, MEMBER_INSERT_BATCH)) {
            await this.db.from('cbt_class_members').insert(batch);
        }
    }
}

/** Kode undangan kelas tambahan: enam karakter, cukup pendek untuk diketik. */
function generateJoinCode(): string {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

/** Ekstrak tingkatan kelas dari nama kelas (misal: X/10, XI/11, XII/12, VII/7, dsb). */
export function extractGradeLevel(className: string): number {
    if (!className) return 99;
    const name = className.trim().toUpperCase();

    // 1. Angka Romawi di batas kata: XII (12), XI (11), X (10), IX (9), VIII (8), VII (7), dsb.
    const romanMatch =
        name.match(/\b(XII|XI|X|IX|VIII|VII|VI|V|IV|III|II|I)\b/i) ||
        name.match(/^(XII|XI|X|IX|VIII|VII|VI|V|IV|III|II|I)/i);
    if (romanMatch) {
        const r = romanMatch[1].toUpperCase();
        const romanMap: Record<string, number> = {
            XII: 12,
            XI: 11,
            X: 10,
            IX: 9,
            VIII: 8,
            VII: 7,
            VI: 6,
            V: 5,
            IV: 4,
            III: 3,
            II: 2,
            I: 1,
        };
        if (romanMap[r]) return romanMap[r];
    }

    // 2. Angka Arab di batas kata (misal: "10 MIPA", "11-IPS", "Kelas 12", "7A")
    const numMatch =
        name.match(/^(1[0-2]|[1-9])(?=[^0-9]|$)/) ||
        name.match(/(?:KELAS\s+|TINGKAT\s+)?(1[0-2]|[1-9])(?=[^0-9]|$)/);
    if (numMatch) {
        return parseInt(numMatch[1], 10);
    }

    return 99;
}

/**
 * Sortir cerdas untuk daftar kelas:
 * 1. Prioritaskan kelas yang memiliki siswa (> 0) lebih dulu dibanding kelas kosong (0).
 * 2. Kelompokkan per tingkatan kelas secara berurutan (misal: X -> XI -> XII atau 7 -> 8 -> 9).
 * 3. Urutkan alfabetis secara natural (misal: "X MIPA 1" sebelum "X MIPA 2").
 */
export function compareClasses(
    a: { name?: string; studentCount?: number },
    b: { name?: string; studentCount?: number },
): number {
    // 1. Kelas yang memiliki siswa ditaruh di atas
    const hasA = (a.studentCount || 0) > 0 ? 1 : 0;
    const hasB = (b.studentCount || 0) > 0 ? 1 : 0;
    if (hasA !== hasB) {
        return hasB - hasA;
    }

    // 2. Tingkat kelas (misal: X -> XI -> XII)
    const gradeA = extractGradeLevel(a.name || '');
    const gradeB = extractGradeLevel(b.name || '');
    if (gradeA !== gradeB) {
        return gradeA - gradeB;
    }

    // 3. Nama kelas (alfabetis natural)
    return (a.name || '').localeCompare(b.name || '', undefined, {
        numeric: true,
        sensitivity: 'base',
    });
}
