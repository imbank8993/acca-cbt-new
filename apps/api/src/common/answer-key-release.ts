import { ForbiddenException, InternalServerErrorException } from '@nestjs/common';
import type { DbService } from '../prisma/prisma-db-adapter';
import { examDeadline } from './exam-deadline';

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
}
