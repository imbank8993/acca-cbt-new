import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { PasRoomsService } from './pas-rooms.service';
import { PasSchedulesService } from './pas-schedules.service';
import { PasController } from './pas.controller';
import { PasService } from './pas.service';

@Module({
    imports: [SettingsModule],
    controllers: [PasController],
    providers: [PasService, PasSchedulesService, PasRoomsService],
    exports: [PasService, PasSchedulesService],
})
export class PasModule {}
