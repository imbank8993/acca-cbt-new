import { ServiceUnavailableException } from '@nestjs/common';
import type { DbSession } from '../prisma/prisma-db-adapter';

/**
 * Pembatalan ujian: seluruh pengerjaan sebuah ujian dipindahkan ke arsip
 * (cbt_exam_cancellations + cbt_exam_cancelled_attempts) lalu dihapus, sehingga
 * siswa mengerjakan ulang dari awal dan nilai lama tidak muncul di rekap.
 *
 * Semua SQL di sini memakai `raw` agar dapat diuji langsung terhadap PostgreSQL.
 * Tabel yang merujuk cbt_exam_attempts dibaca dari katalog (pg_constraint), jadi
 * tabel anak baru (log, tangkapan layar, dll.) ikut diarsipkan tanpa perlu
 * mengubah kode ini, dan foreign key tanpa CASCADE tidak menggagalkan pembatalan.
 */

type RawDb = Pick<DbSession, 'raw'>;

export const EXAM_CANCELLED_CODE = 'EXAM_CANCELLED';
export const EXAM_CANCELLED_MESSAGE =
    'Ujian ini dibatalkan oleh pengawas/proktor. Pekerjaan Anda tidak dinilai dan jawaban di perangkat ini sudah dibersihkan. ' +
    'Tunggu informasi jadwal ujian ulang dari pengawas.';

const ATTEMPTS = 'public.cbt_exam_attempts';
const ARCHIVE_TABLES = ['public.cbt_exam_cancellations', 'public.cbt_exam_cancelled_attempts'];

/** Kunci bersama untuk membuat attempt baru; pembatalan memegangnya eksklusif. */
export function examStartLockKey(examId: string): string {
    return `exam-start:${examId}`;
}

let archiveKnown = false;

/** Apakah migrasi 20261110_01 sudah diterapkan? Hasil positif diingat. */
export async function cancellationArchiveAvailable(db: RawDb): Promise<boolean> {
    if (archiveKnown) return true;
    const rows = await db.raw<Array<{ ok: boolean }>>(
        'SELECT (to_regclass($1) IS NOT NULL AND to_regclass($2) IS NOT NULL) AS ok', ...ARCHIVE_TABLES,
    );
    archiveKnown = rows?.[0]?.ok === true;
    return archiveKnown;
}

export async function assertCancellationArchiveAvailable(db: RawDb): Promise<void> {
    if (await cancellationArchiveAvailable(db)) return;
    throw new ServiceUnavailableException(
        'Fitur pembatalan ujian memerlukan migrasi database 20261110_01_exam_cancellations.sql. ' +
        'Minta admin menjalankannya di VPS, lalu coba lagi.',
    );
}

/** Untuk tes. */
export function resetCancellationArchiveCache(): void {
    archiveKnown = false;
}

/** Attempt milik `userId` yang dihapus oleh pembatalan ujian? */
export async function isCancelledAttempt(db: RawDb, attemptId: string, userId: string): Promise<boolean> {
    if (!(await cancellationArchiveAvailable(db))) return false;
    const rows = await db.raw<Array<{ id: string }>>(
        'SELECT attempt_id::text AS id FROM public.cbt_exam_cancelled_attempts WHERE attempt_id = $1::uuid AND user_id = $2::uuid LIMIT 1',
        attemptId, userId,
    );
    return (rows || []).length > 0;
}

interface ReferencingColumn { table: string; column: string }

const quoteIdent = (name: string) => `"${name.replace(/"/g, '""')}"`;

/**
 * Urutan hapus: tabel yang merujuk tabel lain dalam himpunan dihapus lebih dulu
 * (mis. tangkapan layar sebelum log pengawasan yang dirujuknya).
 */
export function deletionOrder(tables: string[], edges: Array<{ child: string; parent: string }>): string[] {
    const remaining = new Set(tables);
    const order: string[] = [];
    while (remaining.size) {
        const sorted = [...remaining].sort();
        const next = sorted.find(table => !edges.some(edge =>
            edge.parent === table && edge.child !== table && remaining.has(edge.child)));
        const pick = next ?? sorted[0];
        order.push(pick);
        remaining.delete(pick);
    }
    return order;
}

async function referencingColumns(db: RawDb): Promise<{ columns: ReferencingColumn[]; order: string[] }> {
    const columns = await db.raw<ReferencingColumn[]>(
        `SELECT c.conrelid::regclass::text AS table, a.attname::text AS column
           FROM pg_constraint c
           JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
          WHERE c.contype = 'f' AND c.confrelid = $1::regclass AND cardinality(c.conkey) = 1
            AND c.conrelid <> c.confrelid
          ORDER BY 1, 2`,
        ATTEMPTS,
    );
    const tables: string[] = [...new Set((columns || []).map(row => row.table))];
    let edges: Array<{ child: string; parent: string }> = [];
    if (tables.length) {
        edges = await db.raw<Array<{ child: string; parent: string }>>(
            `SELECT c.conrelid::regclass::text AS child, c.confrelid::regclass::text AS parent
               FROM pg_constraint c
              WHERE c.contype = 'f' AND c.conrelid = ANY($1::regclass[]) AND c.confrelid = ANY($1::regclass[])`,
            tables,
        );
    }
    return { columns: columns || [], order: deletionOrder(tables, edges || []) };
}

export interface LockedExam {
    id: string;
    title: string | null;
    is_published: boolean | null;
    status: string | null;
}

/**
 * Kunci ujian untuk dibatalkan. Urutan kunci sama dengan jalur lain:
 * kunci mulai (siswa baru tidak dapat membuat attempt), kunci koreksi/penilaian
 * (menunggu pengumpulan yang sedang dinilai), lalu baris ujian.
 */
export async function lockExamForCancellation(db: RawDb, examId: string): Promise<LockedExam | null> {
    for (const key of [examStartLockKey(examId), `exam-key-correction:${examId}`]) {
        await db.raw('SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))::text AS locked', key);
    }
    const rows = await db.raw<LockedExam[]>(
        'SELECT id::text AS id, title, is_published, status FROM public.cbt_exams WHERE id = $1::uuid FOR UPDATE',
        examId,
    );
    return rows?.[0] ?? null;
}

export interface ArchiveAndDeleteInput {
    examId: string;
    cancellationId: string;
    actorId: string;
    reason: string;
    examTitle: string | null;
    previousExam: Record<string, unknown>;
}

export interface ArchiveAndDeleteResult {
    cancellationId: string;
    attemptCount: number;
    inProgressCount: number;
    answerCount: number;
    archivedRows: Record<string, number>;
}

/**
 * Arsipkan lalu hapus SEMUA pengerjaan satu ujian. Wajib dipanggil di dalam
 * transaksi setelah `lockExamForCancellation`. Mengembalikan null bila ujian
 * belum pernah dikerjakan.
 */
export async function archiveAndDeleteAttempts(db: RawDb, input: ArchiveAndDeleteInput): Promise<ArchiveAndDeleteResult | null> {
    const { examId, cancellationId } = input;
    // Tunggu heartbeat/simpan jawaban yang sedang memegang baris attempt.
    const attempts = await db.raw<Array<{ id: string; status: string }>>(
        `SELECT id::text AS id, status FROM ${ATTEMPTS} WHERE exam_id = $1::uuid ORDER BY id FOR UPDATE`,
        examId,
    );
    if (!attempts?.length) return null;
    const inProgressCount = attempts.filter(row => row.status === 'in_progress').length;

    await db.raw(
        `INSERT INTO public.cbt_exam_cancellations
            (id, exam_id, exam_title, reason, cancelled_by, attempt_count, in_progress_count, previous_exam)
         VALUES ($1::uuid, $2::uuid, $3, $4, $5::uuid, $6::int, $7::int, $8::jsonb)`,
        cancellationId, examId, input.examTitle, input.reason, input.actorId,
        attempts.length, inProgressCount, JSON.stringify(input.previousExam),
    );
    await db.raw(
        `INSERT INTO public.cbt_exam_cancelled_attempts (attempt_id, cancellation_id, exam_id, user_id, status, attempt)
         SELECT a.id, $1::uuid, a.exam_id, a.user_id, a.status, to_jsonb(a) FROM ${ATTEMPTS} a WHERE a.exam_id = $2::uuid`,
        cancellationId, examId,
    );

    const archivedRows: Record<string, number> = {};
    const { columns, order } = await referencingColumns(db);
    for (const { table, column } of columns) {
        const col = quoteIdent(column);
        const rows = await db.raw<Array<{ n: number }>>(
            `UPDATE public.cbt_exam_cancelled_attempts ca
                SET related = ca.related || jsonb_build_object($3::text, r.rows)
               FROM (SELECT x.${col} AS attempt_id, jsonb_agg(to_jsonb(x)) AS rows
                       FROM ${table} x
                      WHERE x.${col} IN (SELECT id FROM ${ATTEMPTS} WHERE exam_id = $1::uuid)
                      GROUP BY x.${col}) r
              WHERE ca.attempt_id = r.attempt_id AND ca.cancellation_id = $2::uuid
          RETURNING jsonb_array_length(r.rows)::int AS n`,
            examId, cancellationId, table,
        );
        const count = (rows || []).reduce((sum, row) => sum + Number(row.n || 0), 0);
        if (count) archivedRows[table] = (archivedRows[table] || 0) + count;
    }

    // Sertifikat terikat ke ujian, bukan selalu ke attempt.
    const examRows: Record<string, unknown> = {};
    const [certificates] = await db.raw<Array<{ ok: boolean }>>(
        `SELECT EXISTS (SELECT 1 FROM information_schema.columns
                         WHERE table_schema = 'public' AND table_name = 'cbt_certificates' AND column_name = 'exam_id') AS ok`,
    );
    if (certificates?.ok && !order.includes('cbt_certificates') && !order.includes('public.cbt_certificates')) {
        const [row] = await db.raw<Array<{ rows: unknown[] | null }>>(
            'SELECT jsonb_agg(to_jsonb(c)) AS rows FROM public.cbt_certificates c WHERE c.exam_id = $1::uuid', examId,
        );
        if (row?.rows?.length) {
            examRows.cbt_certificates = row.rows;
            archivedRows.cbt_certificates = row.rows.length;
            await db.raw('DELETE FROM public.cbt_certificates WHERE exam_id = $1::uuid', examId);
        }
    }

    for (const table of order) {
        for (const { column } of columns.filter(item => item.table === table)) {
            await db.raw(
                `DELETE FROM ${table} WHERE ${quoteIdent(column)} IN (SELECT id FROM ${ATTEMPTS} WHERE exam_id = $1::uuid)`,
                examId,
            );
        }
    }
    await db.raw(`DELETE FROM ${ATTEMPTS} WHERE exam_id = $1::uuid`, examId);

    const answerCount = archivedRows.cbt_answers ?? archivedRows['public.cbt_answers'] ?? 0;
    await db.raw(
        `UPDATE public.cbt_exam_cancellations SET answer_count = $2::int, exam_rows = $3::jsonb WHERE id = $1::uuid`,
        cancellationId, answerCount, JSON.stringify(examRows),
    );
    return { cancellationId, attemptCount: attempts.length, inProgressCount, answerCount, archivedRows };
}
