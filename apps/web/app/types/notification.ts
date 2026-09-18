/**
 * Notification types for CBT App
 * Centralized type definitions for notification domain
 */

// ─── Notification Types ───────────────────────────────────────────────────────

export type NotificationType =
    | 'exam_reminder'       // Reminder before exam starts
    | 'exam_available'     // Exam is now available
    | 'exam_started'        // You have started an exam
    | 'exam_submitted'     // Exam has been submitted
    | 'exam_graded'         // Exam has been graded
    | 'exam_result'        // Result is available
    | 'class_invite'        // Invited to join a class
    | 'class_update'       // Class information updated
    | 'assignment_due'      // Assignment deadline reminder
    | 'system'              // System notifications
    | 'achievement'         // Achievement unlocked
    | 'announcement';       // General announcements

export type NotificationPriority = 'low' | 'normal' | 'high' | 'urgent';

// ─── Notification Interface ─────────────────────────────────────────────────────

export interface Notification {
    id: string;
    user_id: string;
    organization_id?: string;
    type: NotificationType;
    title: string;
    message?: string;
    data?: NotificationData;
    is_read: boolean;
    read_at?: string;
    expires_at?: string;
    priority: NotificationPriority;
    action_url?: string;
    created_at: string;
}

// Extended notification with parsed data
export interface NotificationWithDetails extends Notification {
    exam?: {
        id: string;
        title: string;
        subject_name?: string;
        start_time?: string;
        duration_minutes?: number;
    };
    class?: {
        id: string;
        name: string;
    };
}

// ─── Notification Data Types ─────────────────────────────────────────────────

export interface NotificationData {
    exam_id?: string;
    class_id?: string;
    attempt_id?: string;
    score?: number;
    max_score?: number;
    percentage?: number;
    badge_id?: string;
    [key: string]: string | number | boolean | undefined;
}

// ─── Notification Preferences ─────────────────────────────────────────────────

export interface NotificationPreferences {
    id: string;
    user_id: string;
    email_enabled: boolean;
    push_enabled: boolean;
    exam_reminder: boolean;
    exam_reminder_minutes: number;
    class_updates: boolean;
    results_notifications: boolean;
    achievement_notifications: boolean;
    marketing_notifications: boolean;
    quiet_hours_start?: string;
    quiet_hours_end?: string;
    created_at: string;
    updated_at: string;
}

// Default preferences
export const DEFAULT_NOTIFICATION_PREFERENCES: Partial<NotificationPreferences> = {
    email_enabled: true,
    push_enabled: true,
    exam_reminder: true,
    exam_reminder_minutes: 30,
    class_updates: true,
    results_notifications: true,
    achievement_notifications: true,
    marketing_notifications: false,
};

// ─── Notification Type Labels ────────────────────────────────────────────────

export const NOTIFICATION_TYPE_LABELS: Record<NotificationType, string> = {
    exam_reminder: 'Pengingat Ujian',
    exam_available: 'Ujian Tersedia',
    exam_started: 'Ujian Dimulai',
    exam_submitted: 'Ujian Diserahkan',
    exam_graded: 'Ujian Dinilai',
    exam_result: 'Hasil Ujian',
    class_invite: 'Undangan Kelas',
    class_update: 'Update Kelas',
    assignment_due: 'Tugas Akan Jatuh Tempo',
    system: 'Sistem',
    achievement: 'Pencapaian',
    announcement: 'Pengumuman',
};

// ─── Notification Icons ──────────────────────────────────────────────────────

export const NOTIFICATION_TYPE_ICONS: Record<NotificationType, string> = {
    exam_reminder: 'Bell',
    exam_available: 'ClipboardCheck',
    exam_started: 'Play',
    exam_submitted: 'Send',
    exam_graded: 'CheckCircle',
    exam_result: 'BarChart3',
    class_invite: 'UserPlus',
    class_update: 'RefreshCw',
    assignment_due: 'Clock',
    system: 'Settings',
    achievement: 'Trophy',
    announcement: 'Megaphone',
};

// ─── Notification Colors ─────────────────────────────────────────────────────

export const NOTIFICATION_TYPE_COLORS: Record<NotificationType, {
    bg: string;
    text: string;
    border: string;
    icon: string;
}> = {
    exam_reminder: { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200', icon: '🕐' },
    exam_available: { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', icon: '✅' },
    exam_started: { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200', icon: '▶️' },
    exam_submitted: { bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-200', icon: '📤' },
    exam_graded: { bg: 'bg-indigo-50', text: 'text-indigo-700', border: 'border-indigo-200', icon: '📝' },
    exam_result: { bg: 'bg-cyan-50', text: 'text-cyan-700', border: 'border-cyan-200', icon: '📊' },
    class_invite: { bg: 'bg-rose-50', text: 'text-rose-700', border: 'border-rose-200', icon: '👋' },
    class_update: { bg: 'bg-violet-50', text: 'text-violet-700', border: 'border-violet-200', icon: '🔄' },
    assignment_due: { bg: 'bg-pink-50', text: 'text-pink-700', border: 'border-pink-200', icon: '⏰' },
    system: { bg: 'bg-slate-50', text: 'text-slate-700', border: 'border-slate-200', icon: '⚙️' },
    achievement: { bg: 'bg-yellow-50', text: 'text-yellow-700', border: 'border-yellow-200', icon: '🏆' },
    announcement: { bg: 'bg-pink-50', text: 'text-pink-700', border: 'border-pink-200', icon: '📢' },
};

// ─── Priority Levels ─────────────────────────────────────────────────────────

export const PRIORITY_LEVELS: Record<NotificationPriority, {
    label: string;
    color: string;
    order: number;
}> = {
    urgent: { label: 'Urgent', color: 'bg-red-100 text-red-700', order: 0 },
    high: { label: 'High', color: 'bg-amber-100 text-amber-700', order: 1 },
    normal: { label: 'Normal', color: 'bg-blue-100 text-blue-700', order: 2 },
    low: { label: 'Low', color: 'bg-slate-100 text-slate-700', order: 3 },
};

// ─── Helper Functions ─────────────────────────────────────────────────────────

export function isNotificationExpired(notification: Notification): boolean {
    if (!notification.expires_at) return false;
    return new Date(notification.expires_at) < new Date();
}

export function getNotificationTimeAgo(dateStr: string): string {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffMins < 1) return 'Baru saja';
    if (diffMins < 60) return `${diffMins} menit lalu`;
    if (diffHours < 24) return `${diffHours} jam lalu`;
    if (diffDays < 7) return `${diffDays} hari lalu`;

    return date.toLocaleDateString('id-ID', {
        day: 'numeric',
        month: 'short',
        year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
    });
}

export function getNotificationPriorityColor(priority: NotificationPriority): string {
    return PRIORITY_LEVELS[priority]?.color || PRIORITY_LEVELS.normal.color;
}
