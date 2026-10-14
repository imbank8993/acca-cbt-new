import { Module } from '@nestjs/common';
import { GradingController } from './grading.controller';
import { GradingService } from './grading.service';
import { GradingRetryWorker } from './grading-retry.worker';
import { ExamKeyCorrectionService } from './exam-key-correction.service';

@Module({
    controllers: [GradingController],
    providers: [GradingService, GradingRetryWorker, ExamKeyCorrectionService],
    exports: [GradingService],
})
export class GradingModule {}
