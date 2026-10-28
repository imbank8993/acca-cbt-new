import { ForbiddenException, InternalServerErrorException } from '@nestjs/common';
import type { DbService } from '../prisma/prisma-db-adapter';
import { examDeadline } from './exam-deadline';
import { hasThetaIrtScale } from '@acca-cbt/shared';

/** Scores and answer keys have independent release policies. Fail closed on missing schedules. */
export async function assertAnswerKeysReleased(db: DbService, exam: any): Promise<void> {
    if (exam?.show_results !== true || exam?.metadata?.show_answer_keys !== true) {
        throw new ForbiddenException('Kunci jawaban dan pembahasan belum dibuka oleh guru.');
    }
    const [clock] = await db.raw<Array<{ now: Date }>>('SELECT clock_timestamp() AS now');
    const now = new Date(clock.now);
    const end = Date.parse(exam.end_time || '');
    if (!Number.isFinite(end) || now.getTime() < end) {
        throw new ForbiddenException('Pembahasan tersedia setelah jadwal ujian berakhir.');
    }
    const { data: attempts, error } = await db.from('cbt_exam_attempts')
        .select('started_at, personal_end_time, metadata').eq('exam_id', exam.id).eq('status', 'in_progress');
    if (error) throw new InternalServerErrorException('Status pembahasan belum dapat diperiksa.');
    if ((attempts || []).some((attempt: any) => {
        const deadline = examDeadline(attempt, exam).getTime();
        return !Number.isFinite(deadline) || deadline > now.getTime();
    })) throw new ForbiddenException('Pembahasan belum tersedia selama masih ada sesi pengerjaan aktif.');
    await assertScoringFinalized(db, exam);
}

/**
 * Kunci jawaban baru boleh terlihat setelah penilaian ujian benar-benar final.
 *
 * Untuk ujian ber-IRT, nilai siswa sudah tertahan sampai IRT dihitung, tetapi
 * kunci jawaban dulu tidak: begitu hasil dan kunci dicentang serta jadwal
 * berakhir, pembahasan terbuka walaupun IRT belum dihitung, koreksi kunci
 * masih berjalan, atau ada peserta yang mengumpulkan setelah IRT terakhir.
 *
 * `scoring_type` dan status koreksi dibaca ulang dari basis data karena
 * sebagian pemanggil hanya membawa sebagian kolom ujian. Gagal = tertutup.
 */
async function assertScoringFinalized(db: DbService, exam: any): Promise<void> {
    if (!exam?.id) throw new ForbiddenException('Status penilaian ujian belum dapat diperiksa.');
    const { data: fresh, error: examError } = await db.from('cbt_exams')
        .select('scoring_type, metadata').eq('id', exam.id).maybeSingle();
    if (examError) throw new InternalServerErrorException('Status penilaian ujian belum dapat diperiksa.');
    const scoringType = String((fresh ?? exam).scoring_type || 'classical');
    const correction = (fresh ?? exam).metadata?.key_correction;
    if (correction && correction.state !== 'ready') {
        throw new ForbiddenException('Pembahasan ditutup sementara selama koreksi kunci dan penilaian ulang berlangsung.');
    }
    const usesIrt = scoringType.split(',').some(type => type.trim().startsWith('irt_'));
    if (!usesIrt) return;
    const { data: finished, error } = await db.from('cbt_exam_attempts')
        .select('id, score_irt, metadata').eq('exam_id', exam.id).in('status', ['submitted', 'auto_submitted']);
    if (error) throw new InternalServerErrorException('Status nilai IRT belum dapat diperiksa.');
    const pending = (finished || []).filter((attempt: any) =>
        !hasThetaIrtScale(attempt) || attempt.score_irt === null || attempt.score_irt === undefined || !Number.isFinite(Number(attempt.score_irt)));
    if (pending.length) {
        throw new ForbiddenException('Pembahasan dibuka setelah nilai IRT seluruh peserta selesai dihitung.');
    }
}
