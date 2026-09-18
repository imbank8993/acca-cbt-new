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
    Settings,
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
import { NOTIFICATION_TYPE_LABELS, getNotificationTimeAgo } from '@/app/types/notification';
import { REFRESH_INTERVAL } from '@/lib/useAutoRefresh';

interface NotificationBellProps {
    userId: string;
}

export function NotificationBell({ userId }: NotificationBellProps) {
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
    }, [userId]);

    // Initial fetch + Supabase Realtime subscription
    // Notifikasi dimuat ulang berkala. Dulu perubahannya didorong langganan
    // realtime Supabase, yang sudah tidak ada — dan langganan itu pun sudah mati
    // lebih dulu karena menyebut tabel `notifications`, bukan `cbt_notifications`.
    useEffect(() => {
        fetchNotifications();
        const interval = setInterval(fetchNotifications, REFRESH_INTERVAL.notifications);
        return () => clearInterval(interval);
    }, [userId, fetchNotifications]);

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
            {/* Bell Button */}
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="relative p-2 rounded-xl hover:bg-slate-100 transition-colors"
            >
                <Bell size={22} className="text-slate-600" />
                <AnimatePresence>
                    {unreadCount > 0 && (
                        <motion.span
                            initial={{ scale: 0 }}
                            animate={{ scale: 1 }}
                            exit={{ scale: 0 }}
                            className="absolute -top-0.5 -right-0.5 w-5 h-5 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center min-w-[20px] h-[20px]"
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
                            className="absolute right-0 top-full mt-2 w-80 md:w-96 bg-white rounded-2xl shadow-2xl border border-slate-200 z-50 overflow-hidden"
                        >
                            {/* Header */}
                            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-slate-50">
                                <div>
                                    <h3 className="font-bold text-slate-800">Notifikasi</h3>
                                    <p className="text-xs text-slate-500">
                                        {unreadCount > 0 ? `${unreadCount} belum dibaca` : 'Semua sudah dibaca'}
                                    </p>
                                </div>
                                <div className="flex items-center gap-1">
                                    {unreadCount > 0 && (
                                        <button
                                            onClick={handleMarkAllAsRead}
                                            disabled={isMarkingAllRead}
                                            className="p-2 rounded-lg hover:bg-slate-200 text-slate-500 transition-colors"
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
                                        onClick={() => setIsOpen(false)}
                                        className="p-2 rounded-lg hover:bg-slate-200 text-slate-500 transition-colors"
                                    >
                                        <X size={16} />
                                    </button>
                                </div>
                            </div>

                            {/* Notification List */}
                            <div className="max-h-[400px] overflow-y-auto">
                                {isLoading ? (
                                    <div className="flex items-center justify-center py-12">
                                        <Loader2 size={24} className="animate-spin text-slate-400" />
                                    </div>
                                ) : notifications.length === 0 ? (
                                    <div className="flex flex-col items-center justify-center py-12 px-4">
                                        <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mb-4">
                                            <Bell size={24} className="text-slate-400" />
                                        </div>
                                        <p className="text-slate-600 font-medium text-center">Tidak ada notifikasi</p>
                                        <p className="text-xs text-slate-400 text-center mt-1">
                                            Notifikasi akan muncul di sini
                                        </p>
                                    </div>
                                ) : (
                                    <div className="divide-y divide-slate-100">
                                        {notifications.map((notif) => (
                                            <div
                                                key={notif.id}
                                                className={`px-4 py-3 hover:bg-slate-50 transition-colors ${
                                                    !notif.is_read ? 'bg-primary/5' : ''
                                                }`}
                                            >
                                                <div className="flex items-start gap-3">
                                                    {/* Icon */}
                                                    <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center text-lg shrink-0">
                                                        {getNotificationIcon(notif.type)}
                                                    </div>

                                                    {/* Content */}
                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex items-start justify-between gap-2">
                                                            <p className={`text-sm ${!notif.is_read ? 'font-semibold text-slate-800' : 'text-slate-600'}`}>
                                                                {notif.title}
                                                            </p>
                                                            {!notif.is_read && (
                                                                <span className="w-2 h-2 bg-primary rounded-full shrink-0 mt-1" />
                                                            )}
                                                        </div>
                                                        {notif.message && (
                                                            <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">
                                                                {notif.message}
                                                            </p>
                                                        )}
                                                        <div className="flex items-center gap-2 mt-1.5">
                                                            <span className="text-[10px] text-slate-400 flex items-center gap-1">
                                                                <Clock size={10} />
                                                                {getNotificationTimeAgo(notif.created_at)}
                                                            </span>
                                                        </div>
                                                    </div>

                                                    {/* Actions */}
                                                    <div className="flex items-center gap-1 shrink-0">
                                                        {!notif.is_read && (
                                                            <button
                                                                onClick={() => handleMarkAsRead(notif.id)}
                                                                className="p-1.5 rounded-lg hover:bg-slate-200 text-slate-400 transition-colors"
                                                                title="Tandai sudah dibaca"
                                                            >
                                                                <Check size={14} />
                                                            </button>
                                                        )}
                                                        <button
                                                            onClick={() => handleDelete(notif.id)}
                                                            className="p-1.5 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500 transition-colors"
                                                            title="Hapus"
                                                        >
                                                            <Trash2 size={14} />
                                                        </button>
                                                    </div>
                                                </div>

                                                {/* Action Link */}
                                                {notif.action_url && (
                                                    <button
                                                        onClick={() => {
                                                            window.location.href = notif.action_url!;
                                                            setIsOpen(false);
                                                        }}
                                                        className="mt-2 w-full flex items-center justify-center gap-1 py-1.5 bg-slate-100 hover:bg-slate-200 rounded-lg text-xs font-medium text-slate-600 transition-colors"
                                                    >
                                                        Lihat Detail <ChevronRight size={12} />
                                                    </button>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {/* Footer */}
                            {notifications.length > 0 && (
                                <div className="px-4 py-3 border-t border-slate-100 bg-slate-50">
                                    <button
                                        onClick={() => {
                                            window.location.href = '/dashboard/notifications';
                                            setIsOpen(false);
                                        }}
                                        className="w-full py-2 text-sm font-medium text-primary hover:bg-primary/10 rounded-lg transition-colors"
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
