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
