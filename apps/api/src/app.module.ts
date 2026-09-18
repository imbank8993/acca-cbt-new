import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AiModule } from './ai/ai.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { AuthModule } from './auth/auth.module';
import { BackupModule } from './backup/backup.module';
import { ExamConfigsModule } from './exam-configs/exam-configs.module';
import { ExamsModule } from './exams/exams.module';
import { GradingModule } from './grading/grading.module';
import { HealthModule } from './health/health.module';
import { ImportsModule } from './imports/imports.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PasModule } from './pas/pas.module';
import { PrismaModule } from './prisma/prisma.module';
import { ProctorModule } from './proctor/proctor.module';
import { ProctoringModule } from './proctoring/proctoring.module';
import { QuestionsModule } from './questions/questions.module';
import { ScoringModule } from './scoring/scoring.module';
import { SettingsModule } from './settings/settings.module';
import { StorageModule } from './storage/storage.module';
import { StudentsModule } from './students/students.module';
import { TeachersModule } from './teachers/teachers.module';

/**
 * Modul domain ditambahkan bertahap seiring server action dipindahkan.
 * Urutannya dicatat di docs/MIGRASI_BACKEND.md agar aplikasi tetap bisa
 * dijalankan di setiap langkah.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),
    PrismaModule,
    AuthModule,
    HealthModule,
    ScoringModule,
    SettingsModule,
    StorageModule,
    ExamsModule,
    ExamConfigsModule,
    ImportsModule,
    PasModule,
    StudentsModule,
    QuestionsModule,
    ProctorModule,
    BackupModule,
    TeachersModule,
    AiModule,
    GradingModule,
    ProctoringModule,
    NotificationsModule,
    AnalyticsModule,
  ],
})
export class AppModule {}
