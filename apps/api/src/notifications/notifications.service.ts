import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import type { AuthUser } from '@acca-cbt/shared';
import { DbService } from '../prisma/prisma-db-adapter';

export interface CreateNotificationInput {
    userId: string;
    organizationId?: string;
    type: string;
    title: string;
    message?: string;
    data?: Record<string, unknown>;
    priority?: string;
    actionUrl?: string;
    expiresInHours?: number;
}

/**
 * Notifikasi pengguna.
 *
 * Dipindahkan dari `apps/web/app/actions/notifications.ts`, di mana 11 dari 14
 * fungsi tidak memeriksa apa pun. Lima di antaranya bisa dipanggil langsung dari
 * browser dengan `userId` pilihan pemanggil — cukup untuk membaca, menandai, dan
 * menghapus notifikasi milik orang lain.
 *
 * Di sini tidak ada satu pun metode yang menerima `userId` dari luar: semuanya
 * ter-scope ke `user.id` hasil verifikasi token. Satu-satunya pengecualian
 * adalah `create` dan `createBulk`, yang memang mengirim notifikasi KEPADA orang
 * lain — keduanya sengaja tidak diekspos sebagai endpoint (lihat catatannya).
 */
@Injectable()
export class NotificationsService {
    private readonly logger = new Logger(NotificationsService.name);

    constructor(private readonly db: DbService) {}

    /** Saring notifikasi yang sudah kedaluwarsa, kecuali diminta sebaliknya. */
    private notExpired(query: any) {
        return query.or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`);
    }

    async list(
        user: AuthUser,
        options: { limit?: number; unreadOnly?: boolean; includeExpired?: boolean } = {},
    ) {
        const { limit = 20, unreadOnly = false, includeExpired = false } = options;

        let query = this.db
            .from('cbt_notifications')
            .select('*')
            .eq('user_id', user.id)
            .order('created_at', { ascending: false });

        if (unreadOnly) query = query.eq('is_read', false);
        if (!includeExpired) query = this.notExpired(query);

        const { data, error } = await query.limit(limit);

        if (error) {
            this.logger.error(`Gagal membaca notifikasi: ${error.message}`);
            // Versi lama mengembalikan array kosong saat gagal, dan layar
            // notifikasi mengandalkan itu untuk menampilkan keadaan kosong.
            return [];
        }
        return (data as unknown[]) || [];
    }

    async unreadCount(user: AuthUser): Promise<number> {
        const { count, error } = await this.notExpired(
            this.db
                .from('cbt_notifications')
                .select('*', { count: 'exact', head: true })
                .eq('user_id', user.id)
                .eq('is_read', false),
        );

        if (error) {
            this.logger.error(`Gagal menghitung notifikasi: ${error.message}`);
            return 0;
        }
        return count || 0;
    }

    async markRead(user: AuthUser, notificationId: string) {
        // `user_id` ikut disaring, jadi id milik orang lain tidak cocok dengan
        // baris mana pun dan tidak ada yang berubah.
        const { error } = await this.db
            .from('cbt_notifications')
            .update({ is_read: true, read_at: new Date().toISOString() })
            .eq('id', notificationId)
            .eq('user_id', user.id);

        if (error) throw new InternalServerErrorException('Gagal menandai notifikasi.');
    }

    async markAllRead(user: AuthUser) {
        const { error } = await this.db
            .from('cbt_notifications')
            .update({ is_read: true, read_at: new Date().toISOString() })
            .eq('user_id', user.id)
            .eq('is_read', false);

        if (error) throw new InternalServerErrorException('Gagal menandai notifikasi.');
    }

    async remove(user: AuthUser, notificationId: string) {
        const { error } = await this.db
            .from('cbt_notifications')
            .delete()
            .eq('id', notificationId)
            .eq('user_id', user.id);

        if (error) throw new InternalServerErrorException('Gagal menghapus notifikasi.');
    }

    async removeAllRead(user: AuthUser) {
        const { error } = await this.db
            .from('cbt_notifications')
            .delete()
            .eq('user_id', user.id)
            .eq('is_read', true);

        if (error) throw new InternalServerErrorException('Gagal menghapus notifikasi.');
    }

    async preferences(user: AuthUser) {
        const { data, error } = await this.db
            .from('cbt_notification_preferences')
            .select('*')
            .eq('user_id', user.id)
            .maybeSingle();

        if (error) {
            this.logger.error(`Gagal membaca preferensi: ${error.message}`);
            return null;
        }
        return data ?? null;
    }

    async updatePreferences(user: AuthUser, preferences: Record<string, unknown>) {
        const { error } = await this.db.from('cbt_notification_preferences').upsert(
            { user_id: user.id, ...preferences, updated_at: new Date().toISOString() },
            { onConflict: 'user_id' },
        );

        if (error) throw new InternalServerErrorException('Gagal menyimpan preferensi.');
    }

    /**
     * Kirim notifikasi kepada seorang pengguna.
     *
     * SENGAJA TIDAK diekspos sebagai endpoint HTTP. Ia mengirim pesan kepada
     * ORANG LAIN, jadi membukanya berarti menyediakan sarana menanam pesan
     * apa pun di kotak notifikasi siapa pun — dan versi lama memang tidak
     * memeriksa apa pun. Dipanggil dari service lain yang sudah memeriksa izin,
     * mis. saat ujian dijadwalkan atau nilai diumumkan.
     */
    async create(input: CreateNotificationInput): Promise<string | null> {
        const expiresAt = input.expiresInHours
            ? new Date(Date.now() + input.expiresInHours * 60 * 60 * 1000).toISOString()
            : null;

        const { data, error } = await this.db
            .from('cbt_notifications')
            .insert({
                user_id: input.userId,
                organization_id: input.organizationId ?? null,
                type: input.type,
                title: input.title,
                message: input.message ?? null,
                data: input.data ?? {},
                priority: input.priority ?? 'normal',
                action_url: input.actionUrl ?? null,
                expires_at: expiresAt,
            })
            .select('id')
            .single();

        if (error) {
            this.logger.error(`Gagal membuat notifikasi: ${error.message}`);
            return null;
        }
        return (data as { id: string }).id;
    }

    /** Kirim notifikasi yang sama kepada banyak pengguna. Internal, seperti `create`. */
    async createBulk(userIds: string[], input: Omit<CreateNotificationInput, 'userId'>) {
        if (userIds.length === 0) return 0;

        const expiresAt = input.expiresInHours
            ? new Date(Date.now() + input.expiresInHours * 60 * 60 * 1000).toISOString()
            : null;

        // Satu pernyataan INSERT multi-baris, bukan perulangan per penerima.
        const { data, error } = await this.db.from('cbt_notifications').insert(
            userIds.map((userId) => ({
                user_id: userId,
                organization_id: input.organizationId ?? null,
                type: input.type,
                title: input.title,
                message: input.message ?? null,
                data: input.data ?? {},
                priority: input.priority ?? 'normal',
                action_url: input.actionUrl ?? null,
                expires_at: expiresAt,
            })),
        );

        if (error) {
            this.logger.error(`Gagal membuat notifikasi massal: ${error.message}`);
            return 0;
        }
        return ((data as unknown[]) || []).length;
    }
}
