import type { DbSession } from '../prisma/prisma-db-adapter';

/**
 * Ambil advisory lock sampai transaksi selesai.
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
