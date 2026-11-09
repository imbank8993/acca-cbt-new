import { Logger, ServiceUnavailableException } from '@nestjs/common';
import type { DbSession } from '../prisma/prisma-db-adapter';

/**
 * Pengecualian berbagi layar: per ujian (cbt_exam_screen_share_exceptions) atau
 * per periode ASAS/ASAT/AM (cbt_pas_screen_share_exceptions, berlaku untuk
 * semua ujian yang dijadwalkan di periode itu).
 *
 * Semua pemeriksaan (mulai, lanjut, simpan jawaban, heartbeat, detail ujian,
 * monitoring) memakai helper ini agar kedua cakupan selalu dihormati bersama.
 *
 * Tabel periode datang dari migrasi 20261109_01 yang diterapkan manual. Selama
 * belum diterapkan, pengecualian periode dianggap tidak ada — pengecualian per
 * ujian tetap berjalan — dan tidak ada query ke tabel yang belum ada, karena
 * query gagal di dalam transaksi membatalkan seluruh transaksi.
 */

export type ScreenShareExceptionScope = 'exam' | 'period';

export interface ScreenShareException {
    reason: string;
    scope: ScreenShareExceptionScope;
    created_at: string | null;
    created_by: string | null;
    pas_period_id: string | null;
}

export interface ExamPasPeriod {
    id: string;
    name: string | null;
}

const PERIOD_TABLE = 'cbt_pas_screen_share_exceptions';
const logger = new Logger('ScreenShareExceptions');
let periodTableKnown = false;
let periodTableCheckedAt = 0;

/** Apakah tabel pengecualian periode sudah ada? Hasil positif diingat selamanya. */
export async function periodExceptionsAvailable(db: Pick<DbSession, 'raw'>): Promise<boolean> {
    if (periodTableKnown) return true;
    if (Date.now() - periodTableCheckedAt < 60_000) return false;
    const rows = await db.raw<Array<{ ok: boolean }>>(`SELECT to_regclass('public.${PERIOD_TABLE}') IS NOT NULL AS ok`);
    periodTableCheckedAt = Date.now();
    periodTableKnown = rows[0]?.ok === true;
    if (!periodTableKnown) logger.warn(`Tabel ${PERIOD_TABLE} belum ada; terapkan migrasi 20261109_01 untuk pengecualian per periode.`);
    return periodTableKnown;
}

/** Untuk tes. */
export function resetScreenShareExceptionCache(): void {
    periodTableKnown = false;
    periodTableCheckedAt = 0;
}

function toIso(value: unknown): string | null {
    if (!value) return null;
    return value instanceof Date ? value.toISOString() : String(value);
}

function normalize(row: Record<string, unknown>): ScreenShareException {
    return {
        reason: String(row.reason || ''),
        scope: row.scope === 'period' ? 'period' : 'exam',
        created_at: toIso(row.created_at),
        created_by: row.created_by ? String(row.created_by) : null,
        pas_period_id: row.pas_period_id ? String(row.pas_period_id) : null,
    };
}

/** Periode ASAS/ASAT/AM tempat ujian ini dijadwalkan (biasanya satu). */
export async function examPasPeriods(db: Pick<DbSession, 'from'>, examId: string): Promise<ExamPasPeriod[]> {
    const { data: schedules, error } = await db.from('cbt_pas_class_schedules').select('pas_period_id').eq('exam_id', examId);
    if (error) throw new Error(error.message);
    const ids = [...new Set(((schedules || []) as Array<{ pas_period_id?: string | null }>)
        .map(row => row.pas_period_id).filter((id): id is string => Boolean(id)))].sort();
    if (!ids.length) return [];
    const { data: periods, error: periodError } = await db.from('cbt_pas_periods').select('id, name').in('id', ids);
    if (periodError) throw new Error(periodError.message);
    return ((periods || []) as Array<{ id: string; name?: string | null }>)
        .map(row => ({ id: String(row.id), name: row.name ?? null }))
        .sort((a, b) => a.id.localeCompare(b.id));
}

const PERIOD_EXCEPTION_SQL = `SELECT p.user_id::text AS user_id, 'period' AS scope, p.reason, p.created_at,
       p.created_by::text AS created_by, p.pas_period_id::text AS pas_period_id
  FROM public.${PERIOD_TABLE} p
 WHERE p.pas_period_id IN (SELECT s.pas_period_id FROM public.cbt_pas_class_schedules s WHERE s.exam_id = $1::uuid)`;

/** Pengecualian yang berlaku untuk satu siswa di satu ujian; cakupan ujian didahulukan. */
export async function findScreenShareException(db: Pick<DbSession, 'from' | 'raw'>, examId: string, userId: string): Promise<ScreenShareException | null> {
    const { data: exam, error } = await db.from('cbt_exam_screen_share_exceptions')
        .select('reason, created_at, created_by').eq('exam_id', examId).eq('user_id', userId).maybeSingle();
    if (error) throw new Error(error.message);
    if (exam) return normalize({ ...(exam as Record<string, unknown>), scope: 'exam' });
    if (!(await periodExceptionsAvailable(db))) return null;
    const rows = await db.raw<Array<Record<string, unknown>>>(`${PERIOD_EXCEPTION_SQL} AND p.user_id = $2::uuid LIMIT 1`, examId, userId);
    return rows.length ? normalize(rows[0]) : null;
}

/** Semua pengecualian yang berlaku di satu ujian, per siswa (untuk monitoring). */
export async function loadScreenShareExceptions(db: Pick<DbSession, 'from' | 'raw'>, examId: string): Promise<Map<string, ScreenShareException>> {
    const { data, error } = await db.from('cbt_exam_screen_share_exceptions')
        .select('user_id, reason, created_at, created_by').eq('exam_id', examId);
    if (error) throw new Error(error.message);
    const byUser = new Map<string, ScreenShareException>();
    for (const row of (data || []) as Array<Record<string, unknown>>) byUser.set(String(row.user_id), normalize({ ...row, scope: 'exam' }));
    if (await periodExceptionsAvailable(db)) {
        for (const row of await db.raw<Array<Record<string, unknown>>>(PERIOD_EXCEPTION_SQL, examId)) {
            // Cakupan ujian didahulukan bila siswa punya keduanya.
            if (!byUser.has(String(row.user_id))) byUser.set(String(row.user_id), normalize(row));
        }
    }
    return byUser;
}

/** Pastikan tabel periode tersedia sebelum menulis ke sana. */
export async function assertPeriodExceptionsAvailable(db: Pick<DbSession, 'raw'>): Promise<void> {
    resetScreenShareExceptionCache();
    if (!(await periodExceptionsAvailable(db))) {
        throw new ServiceUnavailableException(
            'Pengecualian per periode belum aktif di server. Terapkan migrasi 20261109_01_pas_screen_share_exceptions.sql lalu coba lagi.',
        );
    }
}
