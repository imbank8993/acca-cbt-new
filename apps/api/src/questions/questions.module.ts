import { Module } from '@nestjs/common';
import { GradingModule } from '../grading/grading.module';
import { BankContentService } from './bank-content.service';
import { QuestionBanksService } from './question-banks.service';
import { QuestionsController } from './questions.controller';
import { QuestionsService } from './questions.service';

/**
 * `GradingModule` diimpor karena menyimpan soal harus memicu penilaian ulang
 * pengerjaan yang sudah terlanjur dinilai dengan kunci jawaban lama.
 */
@Module({
    imports: [GradingModule],
    controllers: [QuestionsController],
    providers: [QuestionBanksService, QuestionsService, BankContentService],
    exports: [QuestionBanksService, QuestionsService, BankContentService],
})
export class QuestionsModule {}
