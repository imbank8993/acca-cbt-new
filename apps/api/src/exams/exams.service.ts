import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import type { AuthUser } from '@acca-cbt/shared';
import { AuthorizationService } from '../auth/authorization.service';
import { chunk } from '../common/chunk';
import { DbService } from '../prisma/prisma-db-adapter';

/** Tabel anak attempt yang dibersihkan lebih dulu sebelum attempt-nya dihapus. */
const ATTEMPT_CHILD_TABLES = [
    'cbt_answers',
    'cbt_attempt_security_logs',
    'cbt_proctoring_snapshots',
    'cbt_exam_attempt_questions',
] as const;

/** Tabel yang merujuk ujian TANPA ON DELETE CASCADE. */
const DETACH_TABLES = ['cbt_certificates', 'cbt_pas_class_schedules'] as const;

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

        // 1. Bersihkan target, partisipan, jadwal, dan sumber soal.
        for (const table of [
            'cbt_exam_targets',
            'cbt_exam_participants',
            'cbt_exam_schedules',
            'cbt_exam_question_sources',
        ]) {
            await this.db.from(table).delete().eq('exam_id', examId);
        }

        // 2. Bersihkan attempt beserta SELURUH anaknya secara eksplisit.
        //
        // Foreign key-nya memang punya ON DELETE CASCADE, tetapi produksi pernah
        // menyimpang dari skema. Penghapusan manual membuat operasi ini tetap
        // berhasil walau cascade-nya tidak aktif.
        const { data: attempts } = await this.db
            .from('cbt_exam_attempts')
            .select('id')
            .eq('exam_id', examId);

        const attemptIds = ((attempts as Array<{ id: string }>) || []).map((a) => a.id);
        if (attemptIds.length > 0) {
            for (const ids of chunk(attemptIds, 300)) {
                for (const table of ATTEMPT_CHILD_TABLES) {
                    await this.db.from(table).delete().in('attempt_id', ids);
                }
            }
            await this.db.from('cbt_exam_attempts').delete().eq('exam_id', examId);
        }

        // 3. Lepaskan rujukan dari tabel tanpa cascade — tanpa ini DELETE ujian
        //    gagal karena pelanggaran foreign key begitu ada sertifikat terbit
        //    atau jadwal PAS. Keduanya TIDAK dihapus (dokumen dan konfigurasi
        //    yang bernilai); `exam_id` cukup dikosongkan agar kode verifikasi
        //    sertifikat tetap berfungsi.
        for (const table of DETACH_TABLES) {
            await this.db.from(table).update({ exam_id: null }).eq('exam_id', examId);
        }

        // 4. Hapus ujiannya.
        const { error } = await this.db.from('cbt_exams').delete().eq('id', examId);
        if (error) {
            this.logger.error(`Gagal menghapus ujian ${examId}: ${error.message}`);
            throw new InternalServerErrorException('Gagal menghapus ujian.');
        }
    }
}
