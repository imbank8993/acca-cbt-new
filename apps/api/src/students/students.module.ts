import { Module } from '@nestjs/common';
import { GradingModule } from '../grading/grading.module';
import { ExamAttemptsService } from './exam-attempts.service';
import { StudentsController } from './students.controller';
import { StudentsService } from './students.service';

/**
 * `GradingModule` diimpor karena jalur ujian memakai penilaiannya di tiga
 * tempat: penutupan otomatis saat waktu habis, penilaian ulang setelah susulan
 * jawaban, dan penalti kecepatan pada kuis. Ketiganya harus memakai implementasi
 * yang sama dengan jalur penilaian ulang milik guru.
 */
@Module({
    imports: [GradingModule],
    controllers: [StudentsController],
    providers: [StudentsService, ExamAttemptsService],
    exports: [StudentsService, ExamAttemptsService],
})
export class StudentsModule {}
