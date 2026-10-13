"use client";
import { confirmDialog } from '@/lib/confirm-dialog';
import type { Notification,NotificationType } from '@/app/types/notification';
import {
NOTIFICATION_TYPE_COLORS,
NOTIFICATION_TYPE_LABELS,
getNotificationTimeAgo
} from '@/app/types/notification';
import {
deleteAllReadNotifications,
deleteNotification,
getUnreadNotificationCount,
getUserNotificationsResult,
markAllNotificationsRead,
markNotificationRead
} from '@/lib/api/notifications';
import { getSessionUser } from '@/lib/session';
import { useMemoryState } from '@/lib/useMemoryState';
import { motion } from 'framer-motion';
import {
AlertCircle,
Bell,
Check,
CheckCheck,
CheckCircle2,
ChevronRight,
Clock,
Loader2,
Trash2,
} from 'lucide-react';
import { useCallback,useEffect,useRef,useState } from 'react';

type FilterType = 'all' | 'unread' | NotificationType;
const PAGE_SIZE = 50;

export default function NotificationsPage() {
    const [user, setUser] = useState<Awaited<ReturnType<typeof getSessionUser>>>(null);
    const [notifications, setNotifications] = useMemoryState<Notification[]>('notifications_notifications', []);
    const [unreadCount, setUnreadCount] = useState(0);
    const [isLoading, setIsLoading] = useMemoryState('notifications_isLoading', true);
    const [filter, setFilter] = useState<FilterType>('all');
    const [selectedNotifications, setSelectedNotifications] = useState<Set<string>>(new Set());
    const [isProcessing, setIsProcessing] = useState(false);
    const [hasMore, setHasMore] = useState(false);
    const [isLoadingMore, setIsLoadingMore] = useState(false);
    const [loadError, setLoadError] = useState('');
    const requestGeneration = useRef(0);

    // Fetch user
    useEffect(() => {
        async function fetchUser() {
            const user = await getSessionUser();
            setUser(user);
        }
        fetchUser();
    }, []);

    // Fetch notifications
    const loadNotifications = useCallback(async (offset = 0, append = false) => {
        if (!user) return;
        const generation = append ? requestGeneration.current : ++requestGeneration.current;
        if (append) setIsLoadingMore(true);
        else setIsLoading(true);
        setLoadError('');
        try {
            const [result, count] = await Promise.all([
                getUserNotificationsResult({
                    limit: PAGE_SIZE,
                    offset,
                    unreadOnly: filter === 'unread',
                    type: filter !== 'all' && filter !== 'unread' ? filter : undefined,
                }),
                getUnreadNotificationCount()
            ]);
            if (generation !== requestGeneration.current) return;
            if (!result.success) {
                setLoadError(result.error);
                return;
            }
            setNotifications(current => append ? [...current, ...result.notifications] : result.notifications);
            setHasMore(result.notifications.length === PAGE_SIZE);
            setUnreadCount(count);
        } catch (error) {
            if (generation !== requestGeneration.current) return;
            console.error('[Notifications] Fetch error:', error);
            setLoadError('Notifikasi tidak dapat dimuat. Periksa koneksi lalu coba lagi.');
        } finally {
            if (generation === requestGeneration.current) {
                setIsLoading(false);
                setIsLoadingMore(false);
            }
        }
    }, [filter, user, setIsLoading, setNotifications]);

    useEffect(() => {
        const initialLoad = window.setTimeout(() => void loadNotifications(), 0);
        return () => window.clearTimeout(initialLoad);
    }, [loadNotifications]);

    // Filter notifications
    const filteredNotifications = notifications.filter(notif => {
        if (filter === 'all') return true;
        if (filter === 'unread') return !notif.is_read;
        return notif.type === filter;
    });

    // Get notification icon
    const getNotificationIcon = (type: NotificationType) => {
        switch (type) {
            case 'exam_reminder': return '🔔';
            case 'exam_result': return '📊';
            case 'exam_available': return '✅';
            case 'exam_graded': return '📝';
            case 'exam_submitted': return '📤';
            case 'class_invite': return '👋';
            case 'class_update': return '🔄';
            case 'achievement': return '🏆';
            case 'announcement': return '📢';
            case 'system': return '⚙️';
            default: return '📌';
        }
    };

    // Handle mark as read
    const handleMarkAsRead = async (id: string) => {
        await markNotificationRead(id);
        loadNotifications();
    };

    // Handle mark all as read
    const handleMarkAllAsRead = async () => {
        setIsProcessing(true);
        await markAllNotificationsRead();
        loadNotifications();
        setIsProcessing(false);
    };

    // Handle delete
    const handleDelete = async (id: string) => {
        if (!await confirmDialog({ title: 'Hapus Notifikasi?', text: 'Notifikasi ini akan dihapus dari daftar Anda.', confirmText: 'Ya', cancelText: 'Tidak', variant: 'danger' })) return;
        await deleteNotification(id);
        loadNotifications();
    };

    // Handle delete all read
    const handleDeleteAllRead = async () => {
        if (!await confirmDialog({ title: 'Hapus Semua Notifikasi Terbaca?', text: 'Seluruh notifikasi yang sudah dibaca akan dihapus.', confirmText: 'Ya', cancelText: 'Tidak', variant: 'danger' })) return;
        setIsProcessing(true);
        await deleteAllReadNotifications();
        loadNotifications();
        setIsProcessing(false);
    };

    // Handle bulk selection
    const toggleSelect = (id: string) => {
        const newSelected = new Set(selectedNotifications);
        if (newSelected.has(id)) {
            newSelected.delete(id);
        } else {
            newSelected.add(id);
        }
        setSelectedNotifications(newSelected);
    };

    // Handle bulk mark as read
    const handleBulkMarkAsRead = async () => {
        setIsProcessing(true);
        for (const id of selectedNotifications) {
            await markNotificationRead(id);
        }
        setSelectedNotifications(new Set());
        loadNotifications();
        setIsProcessing(false);
    };

    // Handle bulk delete
    const handleBulkDelete = async () => {
        if (!selectedNotifications.size || isProcessing) return;
        if (!await confirmDialog({ title: 'Hapus Notifikasi Terpilih?', text: `Hapus ${selectedNotifications.size} notifikasi yang dipilih?`, confirmText: 'Ya', cancelText: 'Tidak', variant: 'danger' })) return;
        setIsProcessing(true);
        for (const id of selectedNotifications) {
            await deleteNotification(id);
        }
        setSelectedNotifications(new Set());
        loadNotifications();
        setIsProcessing(false);
    };

    // Filter options
    const filterOptions: { value: FilterType; label: string; count?: number }[] = [
        { value: 'all', label: 'Semua' },
        { value: 'unread', label: 'Belum Dibaca', count: unreadCount },
        { value: 'exam_reminder', label: 'Pengingat Ujian' },
        { value: 'exam_result', label: 'Hasil Ujian' },
        { value: 'class_invite', label: 'Undangan Kelas' },
        { value: 'achievement', label: 'Pencapaian' },
    ];

    return (
        <div className="max-w-7xl mx-auto pb-24 space-y-6">
            {/* Filter Tabs & Bulk Actions */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 px-1">
                <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide">
                {filterOptions.map((option) => (
                    <button
                        key={option.value}
                        onClick={() => setFilter(option.value)}
                        className={`px-4 py-2 rounded-full text-xs font-bold whitespace-nowrap transition-all flex items-center gap-2 border ${
                            filter === option.value
                                ? 'bg-[#3083FF] text-white border-[#3083FF] shadow-md shadow-[#3083FF]/10'
                                : 'bg-white text-slate-600 border-slate-100 hover:border-slate-200 hover:bg-slate-50'
                        }`}
                    >
                        {option.label}
                        {option.count !== undefined && option.count > 0 && (
                            <span className={`px-2 py-0.5 rounded-full text-[10px] ${
                                filter === option.value
                                    ? 'bg-white/20 text-white'
                                    : 'bg-rose-100 text-rose-600'
                            }`}>
                                {option.count}
                            </span>
                        )}
                    </button>
                ))}
                </div>

                {selectedNotifications.size > 0 && (
                    <div className="flex items-center gap-2 shrink-0">
                        <button
                            onClick={handleBulkMarkAsRead}
                            disabled={isProcessing}
                            className="px-3 py-1.5 text-xs font-bold text-[#3083FF] bg-white border border-slate-200 hover:bg-slate-50 rounded-xl transition-all flex items-center gap-1.5 shadow-xs active:scale-95"
                        >
                            <CheckCheck size={14} />
                            Tandai Baca ({selectedNotifications.size})
                        </button>
                        <button
                            onClick={handleBulkDelete}
                            disabled={isProcessing}
                            className="px-3 py-1.5 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-xl transition-all flex items-center gap-1.5 shadow-xs active:scale-95"
                        >
                            <Trash2 size={14} />
                            Hapus ({selectedNotifications.size})
                        </button>
                    </div>
                )}
            </div>

            {/* Content */}
            <div className="space-y-4">
                {isLoading ? (
                    <div className="flex flex-col items-center justify-center py-20 space-y-3">
                        <Loader2 size={36} className="animate-spin text-[#3083FF]" />
                        <p className="text-slate-400 font-bold text-xs tracking-wider uppercase font-sans">Memuat notifikasi...</p>
                    </div>
                ) : loadError ? (
                    <div role="alert" className="py-16 px-6 text-center bg-rose-50 border border-rose-200 rounded-2xl max-w-xl mx-auto w-full flex flex-col items-center">
                        <AlertCircle size={32} className="text-rose-500 mb-3" />
                        <h3 className="text-lg font-bold text-slate-700 mb-1">Notifikasi Belum Dapat Dimuat</h3>
                        <p className="text-slate-600 text-sm max-w-sm mb-5">{loadError}</p>
                        <button type="button" onClick={() => loadNotifications()}
                            className="px-5 py-2.5 rounded-xl bg-[#3083FF] text-white text-xs font-bold hover:bg-[#2563EB]">
                            Coba Lagi
                        </button>
                    </div>
                ) : filteredNotifications.length === 0 ? (
                    <div className="py-20 px-6 text-center bg-white border border-dashed border-slate-200 rounded-2xl max-w-xl mx-auto w-full flex flex-col items-center">
                        <div className="w-16 h-16 bg-slate-50 rounded-2xl flex items-center justify-center mb-4 border border-slate-100">
                            <Bell size={28} className="text-slate-300" />
                        </div>
                        <h3 className="text-lg font-bold text-slate-700 mb-1">
                            {filter === 'unread' ? 'Tidak Ada Notifikasi Belum Dibaca' : 'Tidak Ada Notifikasi'}
                        </h3>
                        <p className="text-slate-500 text-sm max-w-sm mb-0">
                            {filter === 'all'
                                ? 'Semua notifikasi terbaru Anda akan muncul di halaman ini.'
                                : 'Coba ubah opsi filter pencarian Anda di atas.'}
                        </p>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {filteredNotifications.map((notif, index) => {
                            const colors = NOTIFICATION_TYPE_COLORS[notif.type] || { bg: 'bg-slate-100', text: 'text-slate-600' };
                            
                            return (
                                <motion.div
                                    key={notif.id}
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ delay: index * 0.02 }}
                                    className={`group relative bg-white rounded-2xl border transition-all duration-300 hover:shadow-md ${
                                        !notif.is_read 
                                            ? 'border-indigo-100/80 shadow-[0_2px_12px_rgba(99,102,241,0.04)]' 
                                            : 'border-slate-100/50 opacity-80 hover:opacity-100'
                                    }`}
                                >
                                    {/* Unread Indicator Bar */}
                                    {!notif.is_read && (
                                        <div className="absolute top-0 left-0 w-1 h-full bg-[#3083FF] rounded-l-2xl"></div>
                                    )}

                                    <div className="p-4 sm:p-5 flex items-start gap-4 pl-5">
                                        {/* Checkbox */}
                                        <button
                                            onClick={() => toggleSelect(notif.id)}
                                            className={`mt-1 w-5 h-5 rounded-lg border flex items-center justify-center shrink-0 transition-all duration-200 ${
                                                selectedNotifications.has(notif.id)
                                                    ? 'bg-[#3083FF] border-[#3083FF] shadow-inner text-white'
                                                    : 'border-slate-200 bg-slate-50/50 opacity-0 group-hover:opacity-100 hover:border-[#3083FF]'
                                            }`}
                                        >
                                            {selectedNotifications.has(notif.id) && (
                                                <Check size={12} className="stroke-[3]" />
                                            )}
                                        </button>

                                        {/* Icon */}
                                        <div className={`w-10 h-10 rounded-xl ${colors.bg} flex items-center justify-center text-lg shrink-0 border border-white`}>
                                            {getNotificationIcon(notif.type)}
                                        </div>

                                        {/* Content */}
                                        <div className="flex-1 min-w-0">
                                            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                                                <div className="space-y-1">
                                                    <h4 className={`text-sm font-bold tracking-tight ${!notif.is_read ? 'text-slate-900' : 'text-slate-700'}`}>
                                                        {notif.title}
                                                    </h4>
                                                    {notif.message && (
                                                        <p className="text-sm text-slate-500 leading-relaxed pr-4 font-sans font-medium">
                                                            {notif.message}
                                                        </p>
                                                    )}
                                                    <div className="flex items-center gap-3 pt-2">
                                                        <span className="text-[11px] font-medium text-slate-400 flex items-center gap-1.5">
                                                            <Clock size={12} />
                                                            {getNotificationTimeAgo(notif.created_at)}
                                                        </span>
                                                        <span className="w-1 h-1 bg-slate-200 rounded-full"></span>
                                                        <span className={`text-[9px] font-bold tracking-wider uppercase ${colors.text}`}>
                                                            {NOTIFICATION_TYPE_LABELS[notif.type] || 'Notifikasi'}
                                                        </span>
                                                    </div>
                                                </div>

                                                {/* Actions */}
                                                <div className="flex items-center gap-1.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                                                    {!notif.is_read && (
                                                        <button
                                                            onClick={() => handleMarkAsRead(notif.id)}
                                                            className="p-1.5 rounded-lg bg-emerald-50 text-emerald-600 hover:bg-emerald-100 transition-colors"
                                                            title="Tandai sudah dibaca"
                                                        >
                                                            <CheckCircle2 size={15} />
                                                        </button>
                                                    )}
                                                    <button
                                                        onClick={() => handleDelete(notif.id)}
                                                        className="p-1.5 rounded-lg bg-rose-50 text-rose-600 hover:bg-rose-100 transition-colors"
                                                        title="Hapus"
                                                    >
                                                        <Trash2 size={15} />
                                                    </button>
                                                </div>
                                            </div>

                                            {/* Action Button */}
                                            {notif.action_url && (
                                                <div className="mt-3.5 flex">
                                                    <button
                                                        onClick={() => {
                                                            if (notif.action_url) {
                                                                window.location.href = notif.action_url;
                                                            }
                                                        }}
                                                        className="inline-flex items-center gap-1 px-3.5 py-1.5 bg-blue-50 hover:bg-blue-100 text-[#3083FF] rounded-xl text-xs font-bold transition-colors"
                                                    >
                                                        Lihat Detail
                                                        <ChevronRight size={13} />
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </motion.div>
                            );
                        })}
                        {hasMore && (
                            <div className="flex justify-center pt-3">
                                <button type="button" onClick={() => loadNotifications(notifications.length, true)} disabled={isLoadingMore}
                                    className="px-5 py-2.5 rounded-xl bg-white border border-slate-200 text-slate-600 text-xs font-bold hover:bg-slate-50 disabled:opacity-60 flex items-center gap-2">
                                    {isLoadingMore && <Loader2 size={14} className="animate-spin" />}
                                    Muat Lebih Banyak
                                </button>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Quick Actions Floating */}
            {selectedNotifications.size === 0 && (unreadCount > 0 || notifications.some(n => n.is_read)) && (
                <motion.div
                    initial={{ y: 100, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-white/90 backdrop-blur-md rounded-full shadow-[0_8px_30px_rgb(0,0,0,0.08)] border border-slate-200/50 px-2.5 py-2 flex items-center gap-1.5 z-50"
                >
                    {unreadCount > 0 && (
                        <button
                            onClick={handleMarkAllAsRead}
                            disabled={isProcessing}
                            className="flex items-center gap-2 px-4 py-2 text-xs font-bold text-slate-600 hover:text-emerald-600 hover:bg-emerald-50 rounded-full transition-all active:scale-95"
                        >
                            <CheckCheck size={16} />
                            <span className="hidden sm:inline">Tandai Semua Dibaca</span>
                            <span className="sm:hidden">Semua Dibaca</span>
                        </button>
                    )}
                    {unreadCount > 0 && notifications.some(n => n.is_read) && (
                        <div className="w-px h-4 bg-slate-200 mx-1" />
                    )}
                    {notifications.some(n => n.is_read) && (
                        <button
                            onClick={handleDeleteAllRead}
                            disabled={isProcessing}
                            className="flex items-center gap-2 px-4 py-2 text-xs font-bold text-slate-600 hover:text-rose-600 hover:bg-rose-50 rounded-full transition-all active:scale-95"
                        >
                            <Trash2 size={16} />
                            <span className="hidden sm:inline">Hapus Semua Terbaca</span>
                            <span className="sm:hidden">Hapus Terbaca</span>
                        </button>
                    )}
                </motion.div>
            )}
        </div>
    );
}
