import { BadRequestException, ConflictException } from '@nestjs/common';
import type { DbService, DbSession } from '../prisma/prisma-db-adapter';

type DeleteDb = Pick<DbService, 'from'> | DbSession;

/** Tolak penghapusan ujian yang sudah menjadi rekam akademik siswa. */
export async function assertExamsHaveNoHistory(db: DeleteDb, examIds: string[]): Promise<void> {
    const ids = [...new Set(examIds.filter(Boolean))];
    if (ids.length === 0) return;

    for (const [table, label] of [
        ['cbt_exam_attempts', 'pengerjaan siswa'],
        ['cbt_certificates', 'sertifikat'],
    ] as const) {
        const { data, error } = await db
            .from(table)
            .select('id')
            .in('exam_id', ids)
            .limit(1);
        if (error) throw new BadRequestException(`Gagal memeriksa riwayat ujian: ${error.message}`);
        if (((data as Array<{ id: string }>) || []).length > 0) {
            throw new ConflictException(
                `Ujian tidak dapat dihapus karena sudah memiliki ${label}. Arsipkan atau batalkan publikasi ujian sebagai gantinya.`,
            );
        }
    }
}

/** Kunci baris ujian agar attempt/sertifikat baru tidak masuk setelah pemeriksaan. */
export async function lockExamsForDeletion(db: DbSession, examIds: string[]): Promise<void> {
    const ids = [...new Set(examIds.filter(Boolean))].sort();
    if (ids.length === 0) return;
    await db.raw(
        'SELECT id FROM public.cbt_exams WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE',
        ids,
    );
}

/** Hapus ujian tanpa mengabaikan kegagalan database. */
export async function deleteExamsWithoutHistory(db: DbSession, examIds: string[]): Promise<void> {
    const ids = [...new Set(examIds.filter(Boolean))];
    if (ids.length === 0) return;
    await lockExamsForDeletion(db, ids);
    await assertExamsHaveNoHistory(db, ids);
    const { error } = await db.from('cbt_exams').delete().in('id', ids);
    if (error) throw new BadRequestException(`Gagal menghapus ujian: ${error.message}`);
}
