import { Module } from '@nestjs/common';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { ExamReviewController } from './exam-review.controller';
import { ExamReviewService } from './exam-review.service';
import { StudentAnalyticsController } from './student-analytics.controller';
import { StudentAnalyticsService } from './student-analytics.service';

/**
 * Tiga sudut pandang atas data yang sama:
 *  - AnalyticsService         → staf melihat satu ujian / satu organisasi
 *  - StudentAnalyticsService  → siswa melihat dirinya sendiri
 *  - ExamReviewService        → siswa melihat satu pengerjaannya, per soal
 *
 * Dipisah karena aturan otorisasinya berbeda, bukan karena datanya berbeda.
 */
@Module({
    controllers: [AnalyticsController, StudentAnalyticsController, ExamReviewController],
    providers: [AnalyticsService, StudentAnalyticsService, ExamReviewService],
})
export class AnalyticsModule {}
