import { Module } from '@nestjs/common';
import { TeachersController } from './teachers.controller';
import { TeachersService } from './teachers.service';
import { GradingModule } from '../grading/grading.module';

@Module({
    imports: [GradingModule],
    controllers: [TeachersController],
    providers: [TeachersService],
    exports: [TeachersService],
})
export class TeachersModule {}
