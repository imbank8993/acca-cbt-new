import { Module } from '@nestjs/common';
import { PasRoomsService } from './pas-rooms.service';
import { PasSchedulesService } from './pas-schedules.service';
import { PasController } from './pas.controller';
import { PasService } from './pas.service';

@Module({
    controllers: [PasController],
    providers: [PasService, PasSchedulesService, PasRoomsService],
    exports: [PasService, PasSchedulesService],
})
export class PasModule {}
