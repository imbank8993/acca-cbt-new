import type { DbSession } from '../prisma/prisma-db-adapter';

/**
 * Ambil advisory lock EKSKLUSIF sampai transaksi selesai.
 *
 * PostgreSQL mengembalikan `void` dari `pg_advisory_xact_lock`. Prisma tidak
 * dapat mendeserialisasi tipe itu melalui `$queryRawUnsafe`, jadi hasilnya
 * dicast ke text. Nilai hasil tidak dipakai; selesainya query berarti lock
 * sudah diperoleh.
 */
export async function advisoryTransactionLock(db: DbSession, key: string): Promise<void> {
    await db.raw(
        'SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))::text AS locked',
        key,
    );
}

/**
 * Ambil advisory lock BERSAMA (shared) pada kunci yang sama sampai transaksi selesai.
 *
 * Banyak pemegang shared lock boleh berjalan bersamaan; mereka hanya saling
 * menunggu dengan pemegang lock eksklusif pada kunci yang sama. Dipakai untuk
 * penilaian satu pengerjaan (submit siswa, auto-submit): ratusan siswa yang
 * mengumpulkan ujian yang sama tidak boleh dinilai satu per satu, tetapi tetap
 * tidak boleh bertabrakan dengan koreksi kunci/regrade yang memakai
 * `advisoryTransactionLock` (eksklusif) pada kunci yang sama.
 */
export async function sharedAdvisoryTransactionLock(db: DbSession, key: string): Promise<void> {
    await db.raw(
        'SELECT pg_advisory_xact_lock_shared(hashtextextended($1::text, 0))::text AS locked',
        key,
    );
}
