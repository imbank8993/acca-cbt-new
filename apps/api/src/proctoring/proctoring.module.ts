import { Module } from '@nestjs/common';
import { GradingModule } from '../grading/grading.module';
import { ProctoringController } from './proctoring.controller';
import { ProctoringService } from './proctoring.service';

@Module({
    // Terminasi ikut menilai jawaban yang sudah tersimpan, jadi butuh GradingService.
    imports: [GradingModule],
    controllers: [ProctoringController],
    providers: [ProctoringService],
})
export class ProctoringModule {}
