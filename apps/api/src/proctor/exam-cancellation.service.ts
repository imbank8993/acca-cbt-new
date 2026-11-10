import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { AuthUser } from '@acca-cbt/shared';
import { AuthorizationService } from '../auth/authorization.service';
import {
    archiveAndDeleteAttempts,
    assertCancellationArchiveAvailable,
    lockExamForCancellation,
} from '../common/exam-cancellation';
import { DbService } from '../prisma/prisma-db-adapter';

export interface ExamCancellationResult {
    examId: string;
    cancellationId: string;
    attemptCount: number;
    inProgressCount: number;
    answerCount: number;
    isPublished: false;
}

/**
 * Batalkan ujian yang sudah dikerjakan siswa (mis. jadwal salah).
 *
 * Satu transaksi: kunci ujian, arsipkan lalu hapus seluruh pengerjaan, dan tarik
 * ujian ke draf. Siswa yang sedang mengerjakan langsung ditolak pada simpan/
 * heartbeat berikutnya (410) dan keluar dari ujian; setelah jadwal diperbaiki
 * dan ujian diterbitkan lagi, semua siswa mengerjakan dari awal.
 */
@Injectable()
export class ExamCancellationService {
    private readonly logger = new Logger(ExamCancellationService.name);

    constructor(
        private readonly db: DbService,
        private readonly authz: AuthorizationService,
    ) {}

    async cancel(user: AuthUser, examId: string, reason: string, confirmationTitle: string): Promise<ExamCancellationResult> {
        const normalizedReason = String(reason || '').trim();
        if (normalizedReason.length < 5 || normalizedReason.length > 500) {
            throw new BadRequestException('Alasan pembatalan wajib diisi (5–500 karakter).');
        }
        await this.authz.assertResourceOwner(user, 'exam', examId);
        // Proktor/Admin: semua ujian; Guru: hanya ujian non-PAS buatannya sendiri.
        await this.authz.assertExamStaff(user, examId);
        await assertCancellationArchiveAvailable(this.db);

        const result = await this.db.transaction(async db => {
            const exam = await lockExamForCancellation(db, examId);
            if (!exam) throw new NotFoundException('Ujian tidak ditemukan.');
            if (String(confirmationTitle || '').trim() !== String(exam.title || '').trim()) {
                throw new BadRequestException('Judul konfirmasi tidak sama dengan judul ujian.');
            }
            const { data: row, error: readError } = await db.from('cbt_exams').select('metadata').eq('id', examId).maybeSingle();
            if (readError) throw new BadRequestException('Pengaturan ujian belum dapat dibaca.');
            const metadata: Record<string, unknown> = { ...((row as { metadata?: Record<string, unknown> | null } | null)?.metadata || {}) };

            const cancellationId = randomUUID();
            const archived = await archiveAndDeleteAttempts(db, {
                examId, cancellationId, actorId: user.id, reason: normalizedReason, examTitle: exam.title,
                previousExam: { is_published: exam.is_published, status: exam.status, irt_calibration: metadata.irt_calibration ?? null },
            });
            if (!archived) {
                throw new ConflictException('Belum ada siswa yang mengerjakan ujian ini, jadi tidak ada yang perlu dibatalkan. ' +
                    'Gunakan Unpublish untuk menarik ujian.');
            }

            // Kalibrasi IRT dihitung dari pengerjaan yang baru saja dibatalkan.
            delete metadata.irt_calibration;
            metadata.last_cancellation = {
                id: cancellationId, at: new Date().toISOString(), by: user.id, reason: normalizedReason,
                attempt_count: archived.attemptCount,
            };
            const { error: updateError } = await db.from('cbt_exams')
                .update({ is_published: false, status: exam.status === 'archived' ? 'archived' : 'draft', metadata })
                .eq('id', examId);
            if (updateError) throw new BadRequestException('Ujian belum berhasil ditarik ke draf.');

            return {
                examId, cancellationId: archived.cancellationId, attemptCount: archived.attemptCount,
                inProgressCount: archived.inProgressCount, answerCount: archived.answerCount, isPublished: false as const,
            };
        });
        this.logger.warn(`Ujian ${examId} dibatalkan oleh ${user.id}: ${result.attemptCount} pengerjaan ` +
            `(${result.inProgressCount} sedang berjalan) diarsipkan di ${result.cancellationId}.`);
        return result;
    }
}
