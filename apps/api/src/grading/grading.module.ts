import { Module } from '@nestjs/common';
import { GradingController } from './grading.controller';
import { GradingService } from './grading.service';
import { GradingRetryWorker } from './grading-retry.worker';

@Module({
    controllers: [GradingController],
    providers: [GradingService, GradingRetryWorker],
    exports: [GradingService],
})
export class GradingModule {}
