import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { DbService } from '../prisma/prisma-db-adapter';
import { GradingService } from './grading.service';

/** Database-backed recovery runs without a browser or monitoring page open. */
@Injectable()
export class GradingRetryWorker implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(GradingRetryWorker.name);
    private timer?: ReturnType<typeof setInterval>;
    private running = false;
    private stopped = false;

    constructor(private readonly db: DbService, private readonly grading: GradingService) {}

    onModuleInit() {
        this.timer = setInterval(() => void this.run(), 30_000);
        this.timer.unref();
        void this.run();
    }

    onModuleDestroy() {
        this.stopped = true;
        if (this.timer) clearInterval(this.timer);
    }

    async run(): Promise<void> {
        if (this.running || this.stopped) return;
        this.running = true;
        try {
            await this.grading.retryPendingAutoSubmissions(undefined, 25);
            if (this.stopped) return;
            await this.grading.retryLiveQuestionRegrades();
            if (this.stopped) return;
            const exams = await this.db.raw<Array<{ exam_id: string }>>(`
                SELECT DISTINCT a.exam_id FROM public.cbt_exam_attempts a
                JOIN public.cbt_exams e ON e.id = a.exam_id
                WHERE a.status IN ('submitted', 'auto_submitted') AND a.total_score IS NOT NULL
                  AND a.metadata->>'relative_scoring_pending' = 'true' AND e.exam_type = 'quiz'
                ORDER BY a.exam_id LIMIT 25`);
            for (const exam of exams) {
                if (this.stopped) break;
                try { await this.grading.applyRelativeQuizScoring(exam.exam_id); }
                catch (error) { this.logger.error(`Nilai relatif masih tertunda: ${(error as Error).message}`); }
            }
        } catch (error) {
            this.logger.error(`Pemulihan nilai tertunda: ${(error as Error).message}`);
        } finally {
            this.running = false;
        }
    }
}
