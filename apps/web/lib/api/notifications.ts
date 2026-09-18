import type { Notification, NotificationPreferences } from '@/app/types/notification';
import { apiGet, apiSend } from './client';

/**
 * Notifikasi pengguna. Menggantikan `app/actions/notifications.ts`.
 *
 * Tidak satu pun fungsi di sini menerima `userId` lagi — NestJS membacanya dari
 * token. Versi lama menerimanya dari browser tanpa verifikasi, sehingga
 * notifikasi milik orang lain bisa dibaca, ditandai, dan dihapus.
 */

export async function getUserNotifications(
    options: { limit?: number; unreadOnly?: boolean; includeExpired?: boolean } = {},
): Promise<Notification[]> {
    const params = new URLSearchParams();
    if (options.limit) params.set('limit', String(options.limit));
    if (options.unreadOnly) params.set('unreadOnly', 'true');
    if (options.includeExpired) params.set('includeExpired', 'true');

    const query = params.toString();
    const res = await apiGet<{ notifications: Notification[] }>(
        `/api/notifications${query ? `?${query}` : ''}`,
    );
    // Versi lama mengembalikan array kosong saat gagal; layar notifikasi
    // mengandalkan itu untuk menampilkan keadaan kosong.
    return res.success ? res.notifications : [];
}

export async function getUnreadNotificationCount(): Promise<number> {
    const res = await apiGet<{ count: number }>('/api/notifications/unread-count');
    return res.success ? res.count : 0;
}

export function markNotificationRead(notificationId: string) {
    return apiSend<{ id: string }>(
        `/api/notifications/${encodeURIComponent(notificationId)}/read`,
        {},
        'PATCH',
    );
}

export function markAllNotificationsRead() {
    return apiSend<{ done: boolean }>('/api/notifications/read-all', {});
}

export function deleteNotification(notificationId: string) {
    return apiSend<{ id: string }>(
        `/api/notifications/${encodeURIComponent(notificationId)}`,
        undefined,
        'DELETE',
    );
}

export function deleteAllReadNotifications() {
    return apiSend<{ done: boolean }>('/api/notifications/read', undefined, 'DELETE');
}

export async function getNotificationPreferences(): Promise<NotificationPreferences | null> {
    const res = await apiGet<{ preferences: NotificationPreferences | null }>(
        '/api/notifications/preferences',
    );
    return res.success ? res.preferences : null;
}

export function updateNotificationPreferences(preferences: Partial<NotificationPreferences>) {
    return apiSend<{ saved: boolean }>('/api/notifications/preferences', preferences, 'PUT');
}
