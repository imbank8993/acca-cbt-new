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

    /** Sembunyikan ujian dari daftar aktif tanpa menghapus hasil atau jawaban. */
    async setArchived(user: AuthUser, examId: string, archived: boolean) {
        await this.authz.assertExamStaff(user, examId);

        return this.db.transaction(async (db) => {
            await db.raw(
                'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
                `exam-archive:${examId}`,
            );

            const { data: exam, error: examError } = await db.from('cbt_exams')
                .select('id, status, is_published, metadata')
                .eq('id', examId)
                .maybeSingle();
            if (examError) throw new BadRequestException(`Gagal membaca ujian: ${examError.message}`);
            if (!exam) throw new NotFoundException('Ujian tidak ditemukan.');

            const row = exam as {
                status: string;
                is_published: boolean | null;
                metadata: Record<string, unknown> | null;
            };
            if ((row.status === 'archived') === archived) {
                return { id: examId, archived };
            }

            if (archived) {
                const { data: activeAttempt, error: attemptError } = await db
                    .from('cbt_exam_attempts')
                    .select('id')
                    .eq('exam_id', examId)
                    .eq('status', 'in_progress')
                    .limit(1)
                    .maybeSingle();
                if (attemptError) {
                    throw new BadRequestException(`Gagal memeriksa pengerjaan aktif: ${attemptError.message}`);
                }
                if (activeAttempt) {
                    throw new ConflictException(
                        'Ujian masih sedang dikerjakan. Tunggu seluruh pengerjaan selesai sebelum mengarsipkan.',
                    );
                }

                const metadata = {
                    ...(row.metadata || {}),
                    archive_previous_status: row.status,
                    archive_previous_published: row.is_published === true,
                    archived_at: new Date().toISOString(),
                    archived_by: user.id,
                };
                const { error } = await db.from('cbt_exams').update({
                    status: 'archived',
                    is_published: false,
                    metadata,
                }).eq('id', examId);
                if (error) throw new BadRequestException(`Gagal mengarsipkan ujian: ${error.message}`);
            } else {
                const metadata = { ...(row.metadata || {}) };
                metadata.last_archived_at = metadata.archived_at;
                metadata.last_archived_by = metadata.archived_by;
                delete metadata.archive_previous_status;
                delete metadata.archive_previous_published;
                delete metadata.archived_at;
                delete metadata.archived_by;

                // Pemulihan selalu menjadi draft. Operator harus meninjau jadwal
                // dan penugasan sebelum menerbitkannya kembali.
                const { error } = await db.from('cbt_exams').update({
                    status: 'draft',
                    is_published: false,
                    metadata,
                }).eq('id', examId);
                if (error) throw new BadRequestException(`Gagal memulihkan arsip: ${error.message}`);
            }

            return { id: examId, archived };
        });
    }

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
