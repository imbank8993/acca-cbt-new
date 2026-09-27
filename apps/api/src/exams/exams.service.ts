import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { AuthUser } from '@acca-cbt/shared';
import { AuthorizationService } from '../auth/authorization.service';
import { assertExamsHaveNoHistory, lockExamsForDeletion } from '../common/exam-deletion';
import { chunk } from '../common/chunk';
import { DbService } from '../prisma/prisma-db-adapter';

@Injectable()
export class ExamsService {
    private readonly logger = new Logger(ExamsService.name);

    constructor(
        private readonly db: DbService,
        private readonly authz: AuthorizationService,
    ) {}

    /**
     * Hapus ujian permanen beserta data terkaitnya.
     *
     * Dipindahkan dari `deleteExamAction` di `apps/web/app/actions/admin.ts`.
     */
    async remove(user: AuthUser, examId: string): Promise<void> {
        // Proktor/Admin bebas; Guru hanya ujian non-PAS/PAT buatannya sendiri.
        await this.authz.assertExamStaff(user, examId);

        await this.db.transaction(async (db) => {
            await db.raw(
                'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
                `exam-delete:${examId}`,
            );
            await lockExamsForDeletion(db, [examId]);
            await assertExamsHaveNoHistory(db, [examId]);

            // Jadwal PAS dipertahankan agar bisa dibangkitkan ulang. Sertifikat
            // tidak dilepas: keberadaannya sudah membuat penghapusan ditolak.
            const { error: detachError } = await db
                .from('cbt_pas_class_schedules')
                .update({ exam_id: null })
                .eq('exam_id', examId);
            if (detachError) throw new BadRequestException(`Gagal melepaskan jadwal: ${detachError.message}`);

            const { error } = await db.from('cbt_exams').delete().eq('id', examId);
            if (error) {
                this.logger.error(`Gagal menghapus ujian ${examId}: ${error.message}`);
                throw new BadRequestException('Gagal menghapus ujian.');
            }
        });
    }

    /**
     * Jalur eksplisit untuk membersihkan ujian uji coba beserta hasilnya.
     * Hanya Proktor/Admin, wajib sudah tidak dipublikasikan, dan judul harus
     * diketik ulang. Jalur hapus biasa tidak pernah menghapus rekam siswa.
     */
    async purgeTrial(user: AuthUser, examId: string, confirmationTitle: string) {
        await this.authz.assertProktorByRecord(user, 'cbt_exams', examId);

        return this.db.transaction(async (db) => {
            await db.raw(
                'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
                `exam-delete:${examId}`,
            );
            await lockExamsForDeletion(db, [examId]);

            const { data: exam } = await db.from('cbt_exams')
                .select('title, is_published').eq('id', examId).maybeSingle();
            if (!exam) throw new NotFoundException('Ujian tidak ditemukan.');
            const row = exam as { title: string; is_published: boolean | null };
            if (row.is_published) {
                throw new ConflictException(
                    'Batalkan publikasi ujian sebelum menghapus data uji coba.',
                );
            }
            if (confirmationTitle.trim() !== row.title.trim()) {
                throw new BadRequestException('Judul konfirmasi tidak sama dengan judul ujian.');
            }

            const { data: attempts, error: attemptReadError } = await db
                .from('cbt_exam_attempts').select('id').eq('exam_id', examId);
            if (attemptReadError) throw new BadRequestException(`Gagal membaca hasil uji coba: ${attemptReadError.message}`);
            const attemptIds = ((attempts as Array<{ id: string }>) || []).map((item) => item.id);

            for (const ids of chunk(attemptIds, 300)) {
                for (const table of [
                    'cbt_answers',
                    'cbt_attempt_security_logs',
                    'cbt_proctoring_snapshots',
                    'cbt_exam_attempt_questions',
                ]) {
                    const { error } = await db.from(table).delete().in('attempt_id', ids);
                    if (error) throw new BadRequestException(`Gagal membersihkan hasil uji coba: ${error.message}`);
                }
            }

            for (const [table, column] of [
                ['cbt_exam_attempts', 'exam_id'],
                ['cbt_certificates', 'exam_id'],
                ['cbt_exam_targets', 'exam_id'],
                ['cbt_exam_participants', 'exam_id'],
                ['cbt_exam_schedules', 'exam_id'],
                ['cbt_exam_question_sources', 'exam_id'],
            ] as const) {
                const { error } = await db.from(table).delete().eq(column, examId);
                if (error) throw new BadRequestException(`Gagal membersihkan data uji coba: ${error.message}`);
            }

            const { error: detachError } = await db.from('cbt_pas_class_schedules')
                .update({ exam_id: null }).eq('exam_id', examId);
            if (detachError) throw new BadRequestException(`Gagal melepaskan jadwal uji coba: ${detachError.message}`);

            const { error: examError } = await db.from('cbt_exams').delete().eq('id', examId);
            if (examError) throw new BadRequestException(`Gagal menghapus ujian uji coba: ${examError.message}`);

            this.logger.warn(`Ujian uji coba ${examId} dihapus permanen oleh ${user.id}; ${attemptIds.length} attempt dibersihkan.`);
            return { id: examId, purgedAttempts: attemptIds.length };
        });
    }
}
