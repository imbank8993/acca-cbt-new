import { Module } from '@nestjs/common';
import { ExamConfigsController } from './exam-configs.controller';
import { ExamConfigsService } from './exam-configs.service';

@Module({
    controllers: [ExamConfigsController],
    providers: [ExamConfigsService],
    exports: [ExamConfigsService],
})
export class ExamConfigsModule {}
