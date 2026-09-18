import {
    Body,
    Controller,
    Delete,
    Get,
    HttpCode,
    HttpStatus,
    Param,
    ParseUUIDPipe,
    Patch,
    Post,
    Put,
    Query,
    UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@acca-cbt/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { NotificationsService } from './notifications.service';

/**
 * Seluruh endpoint di sini ter-scope ke pemanggil. Tidak ada satu pun yang
 * menerima `userId` — itulah perbedaan pokoknya dengan versi server action.
 *
 * `create` dan `createBulk` sengaja TIDAK punya endpoint: keduanya mengirim
 * pesan kepada orang lain dan hanya dipanggil dari service.
 */
@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
    constructor(private readonly notifications: NotificationsService) {}

    @Get()
    @ApiOperation({ summary: 'Notifikasi milik pemanggil' })
    async list(
        @CurrentUser() user: AuthUser,
        @Query('limit') limit?: string,
        @Query('unreadOnly') unreadOnly?: string,
        @Query('includeExpired') includeExpired?: string,
    ) {
        const parsed = Number(limit);
        return {
            notifications: await this.notifications.list(user, {
                // Batas atas dipasang supaya satu permintaan tidak bisa menarik
                // seluruh isi tabel.
                limit: Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 100) : 20,
                unreadOnly: unreadOnly === 'true',
                includeExpired: includeExpired === 'true',
            }),
        };
    }

    @Get('unread-count')
    @ApiOperation({ summary: 'Jumlah notifikasi belum dibaca' })
    async unreadCount(@CurrentUser() user: AuthUser) {
        return { count: await this.notifications.unreadCount(user) };
    }

    @Get('preferences')
    @ApiOperation({ summary: 'Preferensi notifikasi pemanggil' })
    async preferences(@CurrentUser() user: AuthUser) {
        return { preferences: await this.notifications.preferences(user) };
    }

    @Put('preferences')
    @ApiOperation({ summary: 'Simpan preferensi notifikasi' })
    async updatePreferences(
        @CurrentUser() user: AuthUser,
        @Body() preferences: Record<string, unknown>,
    ) {
        await this.notifications.updatePreferences(user, preferences);
        return { saved: true };
    }

    @Post('read-all')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Tandai semua notifikasi sudah dibaca' })
    async markAllRead(@CurrentUser() user: AuthUser) {
        await this.notifications.markAllRead(user);
        return { done: true };
    }

    // Didaftarkan SEBELUM ':id' supaya 'read' tidak tertangkap sebagai id.
    @Delete('read')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Hapus semua notifikasi yang sudah dibaca' })
    async removeAllRead(@CurrentUser() user: AuthUser) {
        await this.notifications.removeAllRead(user);
        return { done: true };
    }

    @Patch(':id/read')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Tandai satu notifikasi sudah dibaca' })
    async markRead(
        @CurrentUser() user: AuthUser,
        @Param('id', ParseUUIDPipe) id: string,
    ) {
        await this.notifications.markRead(user, id);
        return { id };
    }

    @Delete(':id')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Hapus satu notifikasi' })
    async remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
        await this.notifications.remove(user, id);
        return { id };
    }
}
