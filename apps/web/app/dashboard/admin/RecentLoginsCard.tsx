'use client';

import './recent-logins.css';

import { getLoginHistory } from '@/lib/api/proctor';
import type { LoginHistoryRecord, LoginStats, RecentLogin } from '@/lib/api/proctor';
import {
    Activity, Eye, Loader2, LogIn, Monitor, Smartphone, Tablet, X,
    Search,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, ModalBody } from '@/components/ui/modal';
import { InlineSelect } from '@/components/ui/InlineSelect';

type LoginUser = RecentLogin & { lastLoginAt: string };

const POLL_INTERVAL_MS = 30_000;

function UserAvatar({
    fullName,
    avatarUrl,
    success = true,
}: {
    fullName: string;
    avatarUrl?: string | null;
    success?: boolean;
}) {
    const [imgError, setImgError] = useState(false);
    const initial = fullName ? fullName.charAt(0).toUpperCase() : '?';

    useEffect(() => {
        setImgError(false);
    }, [avatarUrl]);

    if (avatarUrl && !imgError) {
        return (
            <div
                data-login-success={success}
                className={`login-activity-avatar w-9 h-9 rounded-full overflow-hidden shrink-0 border ${
                    success ? 'border-[#3083FF]/20 bg-slate-100' : 'border-rose-200 bg-rose-50'
                }`}
            >
                <img
                    src={avatarUrl}
                    alt={fullName}
                    className="w-full h-full object-cover"
                    onError={() => setImgError(true)}
                    loading="lazy"
                />
            </div>
        );
    }

    return (
        <div
            data-login-success={success}
            className={`login-activity-avatar w-9 h-9 rounded-full flex items-center justify-center shrink-0 border ${
                success
                    ? 'bg-gradient-to-br from-[#3083FF]/15 to-[#3083FF]/5 border-[#3083FF]/20 text-[#3083FF]'
                    : 'bg-rose-50 border-rose-200 text-rose-500'
            }`}
        >
            <span className="text-xs font-bold select-none">{initial}</span>
        </div>
    );
}

export function RecentLoginsCard({ initialLogins }: { initialLogins: LoginUser[] }) {
    const [history, setHistory] = useState<LoginHistoryRecord[]>([]);
    const [stats, setStats] = useState<LoginStats | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [showAllModal, setShowAllModal] = useState(false);
    const [allHistory, setAllHistory] = useState<LoginHistoryRecord[]>([]);
    const [allLoading, setAllLoading] = useState(false);
    const [searchAll, setSearchAll] = useState('');
    const [filterMethod, setFilterMethod] = useState<string>('all');
    const [filterStatus, setFilterStatus] = useState<string>('all');
    const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
    const inFlightRef = useRef(false);

    // Fallback: data lama (last_sign_in_at) bila riwayat detail tidak tersedia
    const fallbackLogins = initialLogins;
    const hasHistoryData = history.length > 0 || stats !== null;

    const loadHistory = useCallback(async () => {
        if (inFlightRef.current) return;
        inFlightRef.current = true;
        setRefreshing(true);
        try {
            const data = await getLoginHistory(15);
            setHistory(data.history);
            setStats(data.stats);
            setLastRefresh(new Date());
        } catch {
            // API belum tersedia / tidak berizin: pakai data lama
            setHistory([]);
            setStats(null);
        } finally {
            inFlightRef.current = false;
            setRefreshing(false);
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void loadHistory();
        const interval = setInterval(() => {
            // Jangan membebani server saat tab tidak sedang dilihat
            if (document.visibilityState === 'visible') void loadHistory();
        }, POLL_INTERVAL_MS);
        const onVisible = () => {
            if (document.visibilityState === 'visible') void loadHistory();
        };
        document.addEventListener('visibilitychange', onVisible);
        return () => {
            clearInterval(interval);
            document.removeEventListener('visibilitychange', onVisible);
        };
    }, [loadHistory]);

    const openAllModal = async () => {
        setShowAllModal(true);
        setAllLoading(true);
        try {
            const data = await getLoginHistory(200);
            setAllHistory(data.history);
        } catch {
            setAllHistory([]);
        } finally {
            setAllLoading(false);
        }
    };

    // Helper: format waktu
    const formatTime = (iso: string) => {
        try {
            const d = new Date(iso);
            return d.toLocaleString('id-ID', {
                day: '2-digit', month: 'short', year: 'numeric',
                hour: '2-digit', minute: '2-digit',
            });
        } catch { return '-'; }
    };

    const getTimeAgo = (dateString: string) => {
        const now = new Date();
        const past = new Date(dateString);
        const diffMs = now.getTime() - past.getTime();
        const diffSecs = Math.floor(diffMs / 1000);
        if (diffSecs < 60) return 'Baru saja';
        const diffMins = Math.floor(diffSecs / 60);
        if (diffMins < 60) return `${diffMins} mnt lalu`;
        const diffHours = Math.floor(diffMins / 60);
        if (diffHours < 24) return `${diffHours} jam lalu`;
        const diffDays = Math.floor(diffHours / 24);
        return `${diffDays} hari lalu`;
    };

    // Icon perangkat
    const DeviceIcon = ({ type }: { type: string | null }) => {
        switch (type) {
            case 'mobile': return <Smartphone size={11} className="text-[#3083FF]/60" />;
            case 'tablet': return <Tablet size={11} className="text-[#3083FF]/60" />;
            default: return <Monitor size={11} className="text-[#3083FF]/60" />;
        }
    };

    // Badge metode login — senada nuansa biru
    const MethodBadge = ({ method }: { method: string }) => {
        if (method === 'sso') {
            return null;
        }
        return (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-semibold bg-sky-50 text-sky-600 border border-sky-200/70">
                Password
            </span>
        );
    };

    // Filter riwayat
    const filteredAllHistory = allHistory.filter(h => {
        if (searchAll.trim() && !h.fullName.toLowerCase().includes(searchAll.trim().toLowerCase())) return false;
        if (filterMethod !== 'all' && h.loginMethod !== filterMethod) return false;
        if (filterStatus === 'success' && !h.success) return false;
        if (filterStatus === 'failed' && h.success) return false;
        return true;
    });

    // Render satu baris riwayat login
    const renderHistoryRow = (record: LoginHistoryRecord) => {
        const deviceLabel = [record.browser, record.os].filter(Boolean).join(' · ');
        return (
            <div
                key={record.id}
                data-login-success={record.success}
                className={`login-activity-row group flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-all ${
                    record.success
                        ? 'border-transparent hover:border-[#3083FF]/15 hover:bg-[#3083FF]/[0.03]'
                        : 'bg-rose-50/40 border-rose-100/80 hover:bg-rose-50/70'
                }`}
            >
                {/* Avatar + Status Dot */}
                <div className="relative shrink-0">
                    <UserAvatar
                        fullName={record.fullName}
                        avatarUrl={record.avatarUrl}
                        success={record.success}
                    />
                    <span
                        className={`login-activity-status-dot absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full ring-2 ring-white ${
                            record.success ? 'bg-[#3083FF]' : 'bg-rose-500'
                        }`}
                    />
                </div>

                {/* Info utama */}
                <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold text-slate-800 truncate group-hover:text-[#3083FF] transition-colors">
                        {record.fullName}
                    </p>
                    <div className="flex items-center gap-1.5 mt-0.5 text-[11px] text-slate-400 truncate">
                        {record.role && (
                            <span className="login-activity-role font-semibold text-[#3083FF]/80 shrink-0">{record.role}</span>
                        )}
                        {record.role && (deviceLabel || record.ipAddress) && (
                            <span className="text-slate-300">•</span>
                        )}
                        {deviceLabel && (
                            <span className="truncate">{deviceLabel}</span>
                        )}
                        {record.ipAddress && (
                            <>
                                {deviceLabel && <span className="text-slate-300">•</span>}
                                <span className="text-slate-400/90 tabular-nums shrink-0">{record.ipAddress}</span>
                            </>
                        )}
                    </div>
                    {!record.success && record.failureReason && (
                        <p className="text-[10px] text-rose-500 font-medium mt-0.5 truncate">
                            {record.failureReason}
                        </p>
                    )}
                    <p className="sm:hidden text-[10px] text-slate-400 mt-0.5">
                        {getTimeAgo(record.createdAt)}
                    </p>
                </div>

                {/* Waktu (desktop) */}
                <div className="hidden sm:block shrink-0 text-right">
                    <span data-login-success={record.success} className={`login-activity-time inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold whitespace-nowrap ${
                        record.success
                            ? 'bg-[#3083FF]/[0.07] text-[#3083FF]'
                            : 'bg-rose-100/70 text-rose-600'
                    }`}>
                        {getTimeAgo(record.createdAt)}
                    </span>
                </div>
            </div>
        );
    };

    // Fallback: render baris lama (data dari getRecentLogins)
    const renderFallbackRow = (login: LoginUser) => (
        <div
            key={login.id}
            data-login-success="true"
            className="login-activity-row group flex items-center gap-3 px-3 py-2.5 rounded-xl border border-transparent hover:border-[#3083FF]/15 hover:bg-[#3083FF]/[0.03] transition-all"
        >
            <div className="relative shrink-0">
                <UserAvatar
                    fullName={login.fullName}
                    avatarUrl={login.avatarUrl}
                    success={login.isActive}
                />
                <span
                    className={`login-activity-status-dot absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full ring-2 ring-white ${
                        login.isActive ? 'bg-[#3083FF]' : 'bg-slate-300'
                    }`}
                />
            </div>
            <div className="flex-1 min-w-0">
                <p className="text-xs font-bold text-slate-800 truncate group-hover:text-[#3083FF] transition-colors">
                    {login.fullName}
                </p>
                <p className="login-activity-role text-[11px] font-medium text-[#3083FF]/80 mt-0.5">{login.role}</p>
                <p className="sm:hidden text-[10px] text-slate-400 mt-0.5">
                    {getTimeAgo(login.lastLoginAt)}
                </p>
            </div>
            <div className="hidden sm:block shrink-0 text-right">
                <span data-login-success="true" className="login-activity-time inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold bg-[#3083FF]/[0.07] text-[#3083FF] whitespace-nowrap">
                    {getTimeAgo(login.lastLoginAt)}
                </span>
            </div>
        </div>
    );

    if (loading) {
        return (
            <div className="bg-white rounded-lg border border-[#3083FF]/30 overflow-hidden shadow-sm">
                <div className="px-5 py-4 border-b border-[#3083FF]/15 bg-gradient-to-r from-[#3083FF]/[0.05] via-[#3083FF]/[0.02] to-transparent flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-lg bg-[#3083FF]/10 border border-[#3083FF]/20 flex items-center justify-center text-[#3083FF]">
                        <Activity size={15} />
                    </div>
                    <div>
                        <h2 className="text-sm font-bold text-slate-900 leading-tight">Aktivitas Login</h2>
                        <p className="text-[11px] text-slate-400 mt-0.5">Memuat riwayat masuk...</p>
                    </div>
                </div>
                <div className="py-12 flex items-center justify-center">
                    <Loader2 size={22} className="text-[#3083FF] animate-spin" />
                </div>
            </div>
        );
    }

    return (
        <div className="bg-white rounded-lg border border-[#3083FF]/30 overflow-hidden shadow-sm">
            {/* Header */}
            <div className="px-5 py-3.5 border-b border-[#3083FF]/15 bg-gradient-to-r from-[#3083FF]/[0.05] via-[#3083FF]/[0.02] to-transparent flex items-center justify-between gap-2">
                <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-8 h-8 rounded-lg bg-[#3083FF]/10 border border-[#3083FF]/20 flex items-center justify-center text-[#3083FF] shrink-0">
                        <Activity size={15} />
                    </div>
                    <div className="min-w-0">
                        <h2 className="text-sm font-bold text-slate-900 leading-tight truncate">Aktivitas Login</h2>
                        <p className="text-[11px] text-slate-400 mt-0.5 truncate">
                            Diperbarui {lastRefresh.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}
                        </p>
                    </div>
                </div>

                <button
                    type="button"
                    onClick={openAllModal}
                    title="Lihat Detail Riwayat Login"
                    aria-label="Lihat Detail Riwayat Login"
                    className="w-8 h-8 rounded-lg text-[#3083FF] bg-[#3083FF]/[0.08] hover:bg-[#3083FF]/15 border border-[#3083FF]/20 flex items-center justify-center transition-colors shrink-0"
                >
                    <Eye size={15} />
                </button>
            </div>

            {/* Daftar riwayat */}
            <div className="p-3 sm:p-4">
                {hasHistoryData && history.length > 0 ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        {history.slice(0, 10).map(renderHistoryRow)}
                    </div>
                ) : fallbackLogins.length > 0 ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        {[...fallbackLogins]
                            .sort((a, b) => {
                                const ta = a.lastLoginAt ? new Date(a.lastLoginAt).getTime() : 0;
                                const tb = b.lastLoginAt ? new Date(b.lastLoginAt).getTime() : 0;
                                return tb - ta;
                            })
                            .slice(0, 10)
                            .map(renderFallbackRow)}
                    </div>
                ) : (
                    <div className="py-10 text-center">
                        <div className="w-12 h-12 bg-[#3083FF]/5 border border-[#3083FF]/10 rounded-2xl flex items-center justify-center mx-auto mb-3">
                            <Activity size={20} className="text-[#3083FF]/50" />
                        </div>
                        <p className="text-xs font-medium text-slate-500">Belum ada aktivitas login</p>
                    </div>
                )}
            </div>

            {/* MODAL: Semua riwayat login detail */}
            <Modal
                open={showAllModal}
                onClose={() => setShowAllModal(false)}
                size="lg"
                title="Riwayat Aktivitas Login"
                subtitle={!allLoading ? `Menampilkan ${filteredAllHistory.length} aktivitas tercatat` : 'Memuat riwayat masuk...'}
                icon={<LogIn size={18} className="text-[#3083FF]" />}
            >
                {/* Filter bar */}
                <div className="px-4 py-2.5 flex flex-wrap items-center gap-2 border-b border-slate-100 bg-slate-50/70 shrink-0">
                    <div className="flex-1 min-w-[180px] relative">
                        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#3083FF]/60" />
                        <input
                            type="text"
                            value={searchAll}
                            onChange={(e) => setSearchAll(e.target.value)}
                            placeholder="Cari nama pengguna..."
                            className="w-full h-[34px] bg-white border border-[#3083FF]/20 text-slate-800 placeholder:text-slate-400 focus:border-[#3083FF] focus:ring-2 focus:ring-[#3083FF]/20 outline-none pl-9 pr-8 rounded-lg text-xs"
                        />
                        {searchAll && (
                            <button
                                type="button"
                                onClick={() => setSearchAll('')}
                                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                                title="Hapus pencarian"
                            >
                                <X size={13} />
                            </button>
                        )}
                    </div>
                    <InlineSelect
                        value={filterMethod}
                        onChange={setFilterMethod}
                        options={[
                            { value: 'all', label: 'Semua Metode' },
                            { value: 'password', label: 'Password' },
                            { value: 'sso', label: 'SSO' },
                        ]}
                        height="34px"
                        minWidth="135px"
                    />
                    <InlineSelect
                        value={filterStatus}
                        onChange={setFilterStatus}
                        options={[
                            { value: 'all', label: 'Semua Status' },
                            { value: 'success', label: 'Berhasil' },
                            { value: 'failed', label: 'Gagal' },
                        ]}
                        height="34px"
                        minWidth="130px"
                    />
                </div>

                {/* Content */}
                <ModalBody className="p-3 overflow-y-auto flex-1 max-h-[65vh]">
                    {allLoading ? (
                        <div className="py-12 flex items-center justify-center">
                            <Loader2 size={24} className="text-[#3083FF] animate-spin" />
                        </div>
                    ) : filteredAllHistory.length > 0 ? (
                        <div className="space-y-1.5">
                            {filteredAllHistory.map((record) => {
                                const deviceLabel = [record.browser, record.os].filter(Boolean).join(' · ');
                                return (
                                    <div
                                        key={record.id}
                                        data-login-success={record.success}
                                        className={`login-activity-row flex items-center gap-3 p-3 rounded-xl border transition-all ${
                                            record.success
                                                ? 'border-transparent hover:border-[#3083FF]/15 hover:bg-[#3083FF]/[0.03]'
                                                : 'bg-rose-50/40 border-rose-100/80 hover:bg-rose-50/70'
                                        }`}
                                    >
                                        {/* Avatar */}
                                        <div className="relative shrink-0">
                                            <UserAvatar
                                                fullName={record.fullName}
                                                avatarUrl={record.avatarUrl}
                                                success={record.success}
                                            />
                                            <span
                                                className={`login-activity-status-dot absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full ring-2 ring-white ${
                                                    record.success ? 'bg-[#3083FF]' : 'bg-rose-500'
                                                }`}
                                            />
                                        </div>

                                        {/* Info */}
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <p className="text-xs font-bold text-slate-800 truncate">{record.fullName}</p>
                                                <MethodBadge method={record.loginMethod} />
                                                {record.role && (
                                                    <span className="login-activity-role text-[10px] bg-[#3083FF]/[0.06] text-[#3083FF] px-1.5 py-0.5 rounded font-semibold">
                                                        {record.role}
                                                    </span>
                                                )}
                                            </div>
                                            <div className="flex items-center gap-2 mt-1 text-[11px] text-slate-400 flex-wrap">
                                                {deviceLabel && (
                                                    <span className="inline-flex items-center gap-1">
                                                        <DeviceIcon type={record.deviceType} />
                                                        {deviceLabel}
                                                    </span>
                                                )}
                                                {record.ipAddress && (
                                                    <>
                                                        {deviceLabel && <span className="text-slate-300">•</span>}
                                                        <span className="tabular-nums">{record.ipAddress}</span>
                                                    </>
                                                )}
                                            </div>
                                            {!record.success && record.failureReason && (
                                                <p className="text-[11px] text-rose-500 font-medium mt-1">
                                                    {record.failureReason}
                                                </p>
                                            )}
                                            <p className="sm:hidden text-[10px] text-slate-400 mt-1">
                                                {getTimeAgo(record.createdAt)} · {formatTime(record.createdAt)}
                                            </p>
                                        </div>

                                        {/* Waktu */}
                                        <div className="hidden sm:block shrink-0 text-right">
                                            <span data-login-success={record.success} className="login-activity-time inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold bg-[#3083FF]/[0.07] text-[#3083FF]">
                                                {getTimeAgo(record.createdAt)}
                                            </span>
                                            <p className="text-[10px] text-slate-400 mt-1 tabular-nums">{formatTime(record.createdAt)}</p>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    ) : (
                        <p className="py-10 text-center text-xs text-slate-400">Tidak ada data yang cocok</p>
                    )}
                </ModalBody>
            </Modal>
        </div>
    );
}

