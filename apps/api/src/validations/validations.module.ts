import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ValidationsController } from './validations.controller';
import { ValidationsService } from './validations.service';

@Module({
    imports: [AuthModule],
    controllers: [ValidationsController],
    providers: [ValidationsService],
    exports: [ValidationsService],
})
export class ValidationsModule {}
