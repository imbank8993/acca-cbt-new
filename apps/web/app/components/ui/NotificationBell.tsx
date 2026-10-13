"use client";
import { confirmDialog } from '@/lib/confirm-dialog';

import type { Notification } from '@/app/types/notification';
import { getNotificationTimeAgo } from '@/app/types/notification';
import {
deleteNotification,
getUnreadNotificationCount,
getUserNotificationsResult,
markAllNotificationsRead,
markNotificationRead
} from '@/lib/api/notifications';
import { safeNotificationUrl } from '@/lib/notification-safety';
import { getSessionUser } from '@/lib/session';
import { REFRESH_INTERVAL } from '@/lib/useAutoRefresh';
import { AnimatePresence,motion } from 'framer-motion';
import {
Bell,
Check,
CheckCheck,
ChevronRight,
Clock,
Loader2,
Trash2,
X
} from 'lucide-react';
import { useCallback,useEffect,useRef,useState } from 'react';

interface NotificationBellProps {
    userId?: string;
}

export function NotificationBell({ userId }: NotificationBellProps = {}) {
    return <NotificationBellContent key={userId || 'session'} />;
}
function NotificationBellContent() {
    const [isOpen, setIsOpen] = useState(false);
    const [notifications, setNotifications] = useState<Notification[]>([]);
    const [unreadCount, setUnreadCount] = useState(0);
    const [isLoading, setIsLoading] = useState(true);
    const [isMarkingAllRead, setIsMarkingAllRead] = useState(false);
    const [error, setError] = useState('');
    const generation = useRef(0);
    const busy = useRef(false);
    const owner = useRef<string | null>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);

    // Fetch notifications
    const fetchNotifications = useCallback(async () => {
        const request = ++generation.current;
        try {
            const session = await getSessionUser({ refresh: true });
            if (request !== generation.current) return;
            if (owner.current !== session?.id) { setNotifications([]); setUnreadCount(0); owner.current = session?.id || null; }
            if (!session) throw new Error('Silakan login kembali.');
            const [result, count] = await Promise.all([
                getUserNotificationsResult({ limit: 10 }),
                getUnreadNotificationCount()
            ]);
            if (request !== generation.current) return;
            if (!result.success) throw new Error(result.error);
            if (result.notifications.some(item => item.user_id !== session.id)) { setNotifications([]); setUnreadCount(0); throw new Error('Sesi akun berubah. Muat ulang halaman.'); }
            setError('');
            setNotifications(result.notifications);
            setUnreadCount(count);
        } catch (error) {
            if (request === generation.current) setError(error instanceof Error ? error.message : 'Notifikasi gagal dimuat.');
        }
        if (request === generation.current) setIsLoading(false);
    }, []);

    // Initial fetch + interval refresh
    useEffect(() => {
        const initialFetch = window.setTimeout(() => void fetchNotifications(), 0);
        const refresh = () => { if (!document.hidden && !busy.current) void fetchNotifications(); };
        const interval = setInterval(refresh, REFRESH_INTERVAL.notifications);
        window.addEventListener('notifications-changed', refresh);
        window.addEventListener('focus', refresh);
        return () => {
            window.clearTimeout(initialFetch);
            clearInterval(interval); generation.current++;
            window.removeEventListener('notifications-changed', refresh);
            window.removeEventListener('focus', refresh);
        };
    }, [fetchNotifications]);

    // Close dropdown when clicking outside
    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        }

        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        }

        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [isOpen]);

    const act = async (action: () => Promise<{ success: boolean; error?: string }>, remove = false) => {
        if (busy.current) return;
        busy.current = true; setIsMarkingAllRead(true); setError('');
        try {
            if (remove && !await confirmDialog({ title: 'Hapus Notifikasi?', text: 'Notifikasi ini akan dihapus dari daftar Anda.', confirmText: 'Ya', cancelText: 'Tidak', variant: 'danger' })) return;
            const session = await getSessionUser({ refresh: true });
            if (!session || session.id !== owner.current) { setNotifications([]); setUnreadCount(0); throw new Error('Sesi akun berubah. Muat ulang halaman.'); }
            const result = await action();
            if (!result.success) throw new Error(result.error || 'Tindakan gagal. Coba lagi.');
            await fetchNotifications();
            window.dispatchEvent(new Event('notifications-changed'));
        } catch (err) { setError(err instanceof Error ? err.message : 'Tindakan gagal. Coba lagi.'); }
        finally { busy.current = false; setIsMarkingAllRead(false); }
    };
    const handleMarkAsRead = (id: string) => act(() => markNotificationRead(id));
    const handleMarkAllAsRead = () => act(markAllNotificationsRead);
    const handleDelete = (id: string) => act(() => deleteNotification(id), true);

    // Get notification icon based on type
    const getNotificationIcon = (type: string) => {
        switch (type) {
            case 'exam_reminder': return '🔔';
            case 'exam_result': return '📊';
            case 'exam_available': return '✅';
            case 'class_invite': return '👋';
            case 'achievement': return '🏆';
            default: return '📌';
        }
    };

    return (
        <div className="relative" ref={dropdownRef}>
            {/* Bell Button (Uses header standard button style) */}
            <button
                type="button"
                onClick={() => setIsOpen(!isOpen)}
                className="header-icon-btn"
                title="Notifikasi"
                aria-label="Notifikasi"
            >
                <Bell size={18} />
                <AnimatePresence>
                    {unreadCount > 0 && (
                        <motion.span
                            initial={{ scale: 0 }}
                            animate={{ scale: 1 }}
                            exit={{ scale: 0 }}
                            className="notification-badge"
                        >
                            {unreadCount > 9 ? '9+' : unreadCount}
                        </motion.span>
                    )}
                </AnimatePresence>
            </button>

            {/* Dropdown */}
            <AnimatePresence>
                {isOpen && (
                    <>
                        {/* Backdrop */}
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="fixed inset-0 z-40"
                            onClick={() => setIsOpen(false)}
                        />

                        {/* Dropdown Panel */}
                        <motion.div
                            initial={{ opacity: 0, y: -10, scale: 0.95 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: -10, scale: 0.95 }}
                            transition={{ duration: 0.15 }}
                            className="absolute right-0 top-full mt-2 w-80 md:w-96 bg-white dark:bg-[#0f172a] rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 z-50 overflow-hidden"
                        >
                            {error && <div role="alert" className="p-3 text-sm text-red-700 bg-red-50">{error}<button type="button" className="ml-2 underline" onClick={() => void fetchNotifications()}>Coba lagi</button></div>}
                            {/* Header */}
                            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60">
                                <div>
                                    <h3 className="font-bold text-slate-800 dark:text-slate-100 text-sm">Notifikasi</h3>
                                    <p className="text-xs text-slate-500 dark:text-slate-400">
                                        {unreadCount > 0 ? `${unreadCount} belum dibaca` : 'Semua sudah dibaca'}
                                    </p>
                                </div>
                                <div className="flex items-center gap-1">
                                    {unreadCount > 0 && (
                                        <button
                                            type="button"
                                            onClick={handleMarkAllAsRead}
                                            disabled={isMarkingAllRead}
                                            className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 transition-colors"
                                            title="Tandai semua sudah dibaca"
                                        >
                                            {isMarkingAllRead ? (
                                                <Loader2 size={16} className="animate-spin" />
                                            ) : (
                                                <CheckCheck size={16} />
                                            )}
                                        </button>
                                    )}
                                    <button
                                        type="button"
                                        onClick={() => setIsOpen(false)}
                                        className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 transition-colors"
                                    >
                                        <X size={16} />
                                    </button>
                                </div>
                            </div>

                            {/* Notification List */}
                            <div className="max-h-[380px] overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800/60">
                                {isLoading ? (
                                    <div className="flex items-center justify-center py-12">
                                        <Loader2 size={24} className="animate-spin text-slate-400" />
                                    </div>
                                ) : notifications.length === 0 ? (
                                    <div className="flex flex-col items-center justify-center py-10 px-4">
                                        <div className="w-12 h-12 bg-slate-100 dark:bg-slate-800 rounded-full flex items-center justify-center mb-3 text-slate-400">
                                            <Bell size={20} />
                                        </div>
                                        <p className="text-slate-700 dark:text-slate-300 font-medium text-sm text-center">Tidak ada notifikasi</p>
                                        <p className="text-xs text-slate-400 dark:text-slate-500 text-center mt-0.5">
                                            Notifikasi baru akan muncul di sini
                                        </p>
                                    </div>
                                ) : (
                                    notifications.map((notif) => (
                                        <div
                                            key={notif.id}
                                            className={`px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors ${
                                                !notif.is_read ? 'bg-blue-50/40 dark:bg-blue-950/20' : ''
                                            }`}
                                        >
                                            <div className="flex items-start gap-3">
                                                {/* Icon */}
                                                <div className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-base shrink-0">
                                                    {getNotificationIcon(notif.type)}
                                                </div>

                                                {/* Content */}
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-start justify-between gap-2">
                                                        <p className={`text-xs ${!notif.is_read ? 'font-semibold text-slate-900 dark:text-slate-100' : 'text-slate-600 dark:text-slate-400'}`}>
                                                            {notif.title}
                                                        </p>
                                                        {!notif.is_read && (
                                                            <span className="w-2 h-2 bg-blue-500 rounded-full shrink-0 mt-1" />
                                                        )}
                                                    </div>
                                                    {notif.message && (
                                                        <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 line-clamp-2">
                                                            {notif.message}
                                                        </p>
                                                    )}
                                                    <div className="flex items-center gap-2 mt-1">
                                                        <span className="text-[10px] text-slate-400 dark:text-slate-500 flex items-center gap-1">
                                                            <Clock size={10} />
                                                            {getNotificationTimeAgo(notif.created_at)}
                                                        </span>
                                                    </div>
                                                </div>

                                                {/* Actions */}
                                                <div className="flex items-center gap-1 shrink-0">
                                                    {!notif.is_read && (
                                                        <button
                                                            type="button"
                                                            onClick={() => handleMarkAsRead(notif.id)}
                                                            className="p-1 rounded-md hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
                                                            title="Tandai sudah dibaca"
                                                        >
                                                            <Check size={13} />
                                                        </button>
                                                    )}
                                                    <button
                                                        type="button"
                                                        onClick={() => handleDelete(notif.id)}
                                                        className="p-1 rounded-md hover:bg-red-50 dark:hover:bg-red-950/40 text-slate-400 hover:text-red-500 transition-colors"
                                                        title="Hapus"
                                                    >
                                                        <Trash2 size={13} />
                                                    </button>
                                                </div>
                                            </div>

                                            {/* Action Link */}
                                            {safeNotificationUrl(notif.action_url) && (
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        window.location.href = safeNotificationUrl(notif.action_url)!;
                                                        setIsOpen(false);
                                                    }}
                                                    className="mt-2 w-full flex items-center justify-center gap-1 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 rounded-lg text-xs font-medium text-slate-600 dark:text-slate-300 transition-colors"
                                                >
                                                    Lihat Detail <ChevronRight size={12} />
                                                </button>
                                            )}
                                        </div>
                                    ))
                                )}
                            </div>

                            {/* Footer */}
                            {notifications.length > 0 && (
                                <div className="px-4 py-2.5 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60">
                                    <button
                                        type="button"
                                        onClick={() => {
                                            window.location.href = '/dashboard/notifications';
                                            setIsOpen(false);
                                        }}
                                        className="w-full py-1.5 text-xs font-semibold text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-950/30 rounded-lg transition-colors text-center"
                                    >
                                        Lihat Semua Notifikasi
                                    </button>
                                </div>
                            )}
                        </motion.div>
                    </>
                )}
            </AnimatePresence>
        </div>
    );
}

export default NotificationBell;
