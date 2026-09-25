"use client";

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Bell,
    Check,
    CheckCheck,
    Trash2,
    X,
    Clock,
    ChevronRight,
    Loader2
} from 'lucide-react';
import {
    getUserNotifications,
    getUnreadNotificationCount,
    markNotificationRead,
    markAllNotificationsRead,
    deleteNotification
} from '@/lib/api/notifications';
import type { Notification } from '@/app/types/notification';
import { getNotificationTimeAgo } from '@/app/types/notification';
import { REFRESH_INTERVAL } from '@/lib/useAutoRefresh';

interface NotificationBellProps {
    userId?: string;
}

export function NotificationBell({ userId }: NotificationBellProps = {}) {
    const [isOpen, setIsOpen] = useState(false);
    const [notifications, setNotifications] = useState<Notification[]>([]);
    const [unreadCount, setUnreadCount] = useState(0);
    const [isLoading, setIsLoading] = useState(false);
    const [isMarkingAllRead, setIsMarkingAllRead] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    // Fetch notifications
    const fetchNotifications = useCallback(async () => {
        setIsLoading(true);
        try {
            const [notifs, count] = await Promise.all([
                getUserNotifications({ limit: 10 }),
                getUnreadNotificationCount()
            ]);
            setNotifications(notifs);
            setUnreadCount(count);
        } catch (error) {
            console.error('[NotificationBell] Fetch error:', error);
        }
        setIsLoading(false);
    }, []);

    // Initial fetch + interval refresh
    useEffect(() => {
        fetchNotifications();
        const interval = setInterval(fetchNotifications, REFRESH_INTERVAL.notifications);
        return () => clearInterval(interval);
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

    // Handle mark as read
    const handleMarkAsRead = async (notificationId: string) => {
        await markNotificationRead(notificationId);
        fetchNotifications();
    };

    // Handle mark all as read
    const handleMarkAllAsRead = async () => {
        setIsMarkingAllRead(true);
        await markAllNotificationsRead();
        fetchNotifications();
        setIsMarkingAllRead(false);
    };

    // Handle delete
    const handleDelete = async (notificationId: string) => {
        await deleteNotification(notificationId);
        fetchNotifications();
    };

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
                                            {notif.action_url && (
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        window.location.href = notif.action_url!;
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
