import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

@Module({
    controllers: [NotificationsController],
    providers: [NotificationsService],
    // Diekspor supaya modul lain bisa mengirim notifikasi lewat create/createBulk
    // tanpa endpoint HTTP yang terbuka.
    exports: [NotificationsService],
})
export class NotificationsModule {}
