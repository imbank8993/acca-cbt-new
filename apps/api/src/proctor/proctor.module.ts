import { Module } from '@nestjs/common';
import { GradingModule } from '../grading/grading.module';
import { SettingsModule } from '../settings/settings.module';
import { ClassesService } from './classes.service';
import { ExamAdminService } from './exam-admin.service';
import { ExamMonitoringService } from './exam-monitoring.service';
import { ProctorController } from './proctor.controller';
import { ProctorService } from './proctor.service';

/**
 * `GradingModule` diimpor karena layar pemantauan menutup pengerjaan yang
 * tenggatnya lewat, dan penutupan itu harus ikut menilai dari jawaban tersimpan.
 */
@Module({
    imports: [GradingModule, SettingsModule],
    controllers: [ProctorController],
    providers: [ProctorService, ClassesService, ExamAdminService, ExamMonitoringService],
    exports: [ProctorService, ClassesService, ExamAdminService, ExamMonitoringService],
})
export class ProctorModule {}
