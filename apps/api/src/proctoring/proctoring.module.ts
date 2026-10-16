import { Module } from '@nestjs/common';
import { GradingModule } from '../grading/grading.module';
import { ProctoringController } from './proctoring.controller';
import { ProctoringService } from './proctoring.service';
import { ExamScreenshotsController } from './exam-screenshots.controller';
import { ExamScreenshotsService } from './exam-screenshots.service';

@Module({
    // Terminasi ikut menilai jawaban yang sudah tersimpan, jadi butuh GradingService.
    imports: [GradingModule],
    controllers: [ProctoringController, ExamScreenshotsController],
    providers: [ProctoringService, ExamScreenshotsService],
})
export class ProctoringModule {}
