import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { PasAdministrationService } from './pas-administration.service';
import { PasMonitoringService } from './pas-monitoring.service';
import { PasRoomsService } from './pas-rooms.service';
import { PasSchedulesService } from './pas-schedules.service';
import { PasController, PasPublicVerificationController } from './pas.controller';
import { PasService } from './pas.service';

@Module({
    imports: [SettingsModule],
    controllers: [PasController, PasPublicVerificationController],
    providers: [PasService, PasSchedulesService, PasRoomsService, PasAdministrationService, PasMonitoringService],
    exports: [PasService, PasSchedulesService, PasAdministrationService],
})
export class PasModule {}

