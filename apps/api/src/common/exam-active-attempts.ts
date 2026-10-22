import { BadRequestException, ConflictException } from '@nestjs/common';
import type { DbSession } from '../prisma/prisma-db-adapter';

/**
 * Tolak tindakan yang memutus akses siswa yang SEDANG mengerjakan.
 *
 * Akses siswa diperiksa ulang pada setiap simpan jawaban dan pengumpulan, jadi
 * menarik terbitan ujian di tengah pengerjaan membuat jawaban mereka tidak bisa
 * dikumpulkan. Staf diarahkan menyelesaikan pengerjaan itu dari Monitoring.
 */
export async function assertNoActiveAttempts(
    db: Pick<DbSession, 'from'>,
    examId: string,
    action: string,
): Promise<void> {
    const { data, error } = await db.from('cbt_exam_attempts')
        .select('id').eq('exam_id', examId).eq('status', 'in_progress');
    if (error) throw new BadRequestException('Status pengerjaan peserta belum dapat diperiksa.');
    const count = ((data as unknown[] | null) || []).length;
    if (count > 0) {
        throw new ConflictException(
            `${count} siswa sedang mengerjakan ujian ini. Tunggu sampai mereka selesai, atau selesaikan ` +
            `pengerjaannya dari Monitoring, sebelum ${action}.`,
        );
    }
}
