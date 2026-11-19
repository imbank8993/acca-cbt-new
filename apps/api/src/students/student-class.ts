import type { DbService } from '../prisma/prisma-db-adapter';

/**
 * Memilih kelas reguler "saat ini" dari semua keanggotaan kelas siswa.
 *
 * Siswa yang naik kelas tetap tercatat di kelas tahun ajaran lama (mis. X Al Razi
 * 2025/2026) di samping kelas barunya (XI ... 2026/2027). Memilih baris pertama
 * membuat layar ujian kadang menampilkan kelas lama. Urutan prioritas:
 *   1. kelas yang menjadi sasaran ujian ini (paling relevan untuk ujian);
 *   2. kelas di tahun ajaran aktif;
 *   3. kelas dengan tahun ajaran terbaru;
 * dan di setiap langkah kelas di sekolah penyelenggara ujian diutamakan.
 */
export interface StudentClassRow {
    id: string;
    name?: string | null;
    organization_id?: string | null;
    school_year?: string | null;
}

/** "2026/2027" > "2025/2026"; tahun kosong dianggap paling lama. */
function newestFirst(a: StudentClassRow, b: StudentClassRow): number {
    return String(b.school_year || '').localeCompare(String(a.school_year || ''), 'id', { numeric: true });
}

export function pickCurrentClass(
    classes: StudentClassRow[],
    options: { organizationId?: string | null; targetClassIds?: Iterable<string>; activeYears?: Iterable<string> } = {},
): StudentClassRow | null {
    const named = classes.filter(row => (row.name || '').trim());
    const inSchool = options.organizationId ? named.filter(row => row.organization_id === options.organizationId) : [];
    const pool = inSchool.length ? inSchool : named;
    if (pool.length <= 1) return pool[0] || null;

    const targets = new Set(options.targetClassIds || []);
    const targeted = pool.filter(row => targets.has(row.id)).sort(newestFirst);
    if (targeted.length) return targeted[0];

    const active = new Set([...(options.activeYears || [])].map(year => year.trim()).filter(Boolean));
    const current = pool.filter(row => active.has(String(row.school_year || '').trim())).sort(newestFirst);
    if (current.length) return current[0];

    return [...pool].sort(newestFirst)[0];
}

/** Tingkat kelas dari nama kelas: "XI D" → "11", "X Al Razi" → "10", "12 IPA 1" → "12". */
export function gradeFromClassName(name: string | null | undefined): string | null {
    const first = String(name || '').trim().split(/[\s\-_.]+/)[0]?.toUpperCase() || '';
    const roman: Record<string, string> = { VII: '7', VIII: '8', IX: '9', X: '10', XI: '11', XII: '12' };
    if (roman[first]) return roman[first];
    return /^(7|8|9|10|11|12)$/.test(first) ? first : null;
}

type ClassDb = Pick<DbService, 'from'>;

/** Tahun ajaran aktif sekolah (school_years), ditambah master_tahun_ajaran sebagai cadangan. */
export async function readActiveSchoolYears(db: ClassDb, organizationId: string | null): Promise<string[]> {
    const [school, master] = await Promise.all([
        organizationId
            ? db.from('school_years').select('year').eq('organization_id', organizationId).eq('is_active', true)
            : Promise.resolve({ data: [], error: null }),
        db.from('master_tahun_ajaran').select('tahun_ajaran').eq('is_active', true),
    ]);
    const years = [
        ...(school.error ? [] : ((school.data as { year?: string | null }[] | null) || []).map(row => row.year)),
        ...(master.error ? [] : ((master.data as { tahun_ajaran?: string | null }[] | null) || []).map(row => row.tahun_ajaran)),
    ];
    return [...new Set(years.filter((year): year is string => Boolean(year && year.trim())))];
}

/** Kelas reguler siswa saat ini (tanpa konteks ujian). Gagal membaca → null. */
export async function readCurrentClass(db: ClassDb, userId: string, organizationId: string | null): Promise<StudentClassRow | null> {
    try {
        const { data: memberships, error } = await db.from('cbt_class_members').select('class_id').eq('user_id', userId);
        const ids = [...new Set(((memberships as { class_id?: string | null }[] | null) || [])
            .map(row => row.class_id).filter((id): id is string => Boolean(id)))];
        if (error || !ids.length) return null;
        const { data: classes, error: classError } = await db.from('cbt_classes').select('id, name, organization_id, school_year').in('id', ids);
        if (classError) return null;
        const rows = (classes as StudentClassRow[] | null) || [];
        if (rows.filter(row => (row.name || '').trim()).length <= 1) return pickCurrentClass(rows, { organizationId });
        return pickCurrentClass(rows, { organizationId, activeYears: await readActiveSchoolYears(db, organizationId) });
    } catch {
        return null;
    }
}
