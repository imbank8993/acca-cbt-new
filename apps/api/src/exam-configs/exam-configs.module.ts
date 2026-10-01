import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { ExamConfigsController } from './exam-configs.controller';
import { ExamConfigsService } from './exam-configs.service';

@Module({
    imports: [SettingsModule],
    controllers: [ExamConfigsController],
    providers: [ExamConfigsService],
    exports: [ExamConfigsService],
})
export class ExamConfigsModule {}
