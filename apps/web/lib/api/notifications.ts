import type { Notification,NotificationPreferences } from '@/app/types/notification';
import { apiGet,apiSend } from './client';

/**
 * Notifikasi pengguna. Menggantikan `app/actions/notifications.ts`.
 *
 * Tidak satu pun fungsi di sini menerima `userId` lagi — NestJS membacanya dari
 * token. Versi lama menerimanya dari browser tanpa verifikasi, sehingga
 * notifikasi milik orang lain bisa dibaca, ditandai, dan dihapus.
 */

export async function getUserNotifications(
    options: { limit?: number; offset?: number; type?: string; unreadOnly?: boolean; includeExpired?: boolean } = {},
): Promise<Notification[]> {
    const result = await getUserNotificationsResult(options);
    return result.success ? result.notifications : [];
}

export async function getUserNotificationsResult(
    options: { limit?: number; offset?: number; type?: string; unreadOnly?: boolean; includeExpired?: boolean } = {},
): Promise<{ success: true; notifications: Notification[] } | { success: false; error: string }> {
    const params = new URLSearchParams();
    if (options.limit) params.set('limit', String(options.limit));
    if (options.offset) params.set('offset', String(options.offset));
    if (options.type) params.set('type', options.type);
    if (options.unreadOnly) params.set('unreadOnly', 'true');
    if (options.includeExpired) params.set('includeExpired', 'true');

    const query = params.toString();
    const res = await apiGet<{ notifications: Notification[] }>(
        `/api/notifications${query ? `?${query}` : ''}`,
    );
    return res.success
        ? { success: true, notifications: res.notifications }
        : { success: false, error: res.error || 'Notifikasi tidak dapat dimuat.' };
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
