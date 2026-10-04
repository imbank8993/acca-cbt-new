'use client';

import { getLoginHistory } from '@/lib/api/proctor';
import type { LoginHistoryRecord, LoginStats, RecentLogin } from '@/lib/api/proctor';
import {
    Activity, Loader2, LogIn, Monitor, Smartphone, Tablet, X, RefreshCw,
    Search,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

type LoginUser = RecentLogin & { lastLoginAt: string };

const POLL_INTERVAL_MS = 30_000;

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
            return (
                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wide uppercase bg-[#3083FF]/10 text-[#3083FF] border border-[#3083FF]/20">
                    SSO
                </span>
            );
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
                className={`group flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-all ${
                    record.success
                        ? 'border-transparent hover:border-[#3083FF]/15 hover:bg-[#3083FF]/[0.03]'
                        : 'bg-rose-50/40 border-rose-100/80 hover:bg-rose-50/70'
                }`}
            >
                {/* Avatar + Status Dot */}
                <div className="relative shrink-0">
                    <div className={`w-9 h-9 rounded-full flex items-center justify-center border ${
                        record.success
                            ? 'bg-gradient-to-br from-[#3083FF]/15 to-[#3083FF]/5 border-[#3083FF]/20 text-[#3083FF]'
                            : 'bg-rose-50 border-rose-200 text-rose-500'
                    }`}>
                        <span className="text-xs font-bold">
                            {record.fullName.charAt(0).toUpperCase()}
                        </span>
                    </div>
                    <span
                        className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full ring-2 ring-white ${
                            record.success ? 'bg-[#3083FF]' : 'bg-rose-500'
                        }`}
                    />
                </div>

                {/* Info utama */}
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                        <p className="text-xs font-bold text-slate-800 truncate group-hover:text-[#3083FF] transition-colors">
                            {record.fullName}
                        </p>
                        <MethodBadge method={record.loginMethod} />
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5 text-[11px] text-slate-400 truncate">
                        {record.role && (
                            <span className="font-semibold text-[#3083FF]/80 shrink-0">{record.role}</span>
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
                </div>

                {/* Waktu */}
                <div className="shrink-0 text-right">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold whitespace-nowrap ${
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
            className="group flex items-center gap-3 px-3 py-2.5 rounded-xl border border-transparent hover:border-[#3083FF]/15 hover:bg-[#3083FF]/[0.03] transition-all"
        >
            <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 border ${
                login.isActive
                    ? 'bg-gradient-to-br from-[#3083FF]/15 to-[#3083FF]/5 border-[#3083FF]/20 text-[#3083FF]'
                    : 'bg-slate-50 border-slate-200/80 text-slate-400'
            }`}>
                <span className="text-xs font-bold">
                    {login.fullName.charAt(0).toUpperCase()}
                </span>
            </div>
            <div className="flex-1 min-w-0">
                <p className="text-xs font-bold text-slate-800 truncate group-hover:text-[#3083FF] transition-colors">
                    {login.fullName}
                </p>
                <p className="text-[11px] font-medium text-[#3083FF]/80 mt-0.5">{login.role}</p>
            </div>
            <div className="shrink-0 text-right">
                <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold bg-[#3083FF]/[0.07] text-[#3083FF] whitespace-nowrap">
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

                <div className="flex items-center gap-1.5 shrink-0">
                    <button
                        type="button"
                        onClick={() => void loadHistory()}
                        disabled={refreshing}
                        title={`Muat ulang (Terakhir: ${lastRefresh.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' })})`}
                        className="w-7 h-7 rounded-lg text-[#3083FF]/70 hover:text-[#3083FF] hover:bg-[#3083FF]/10 flex items-center justify-center transition-colors disabled:cursor-wait"
                    >
                        <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
                    </button>
                    <button
                        onClick={openAllModal}
                        className="text-[11px] font-semibold text-[#3083FF] bg-[#3083FF]/[0.08] hover:bg-[#3083FF]/15 border border-[#3083FF]/20 px-3 py-1.5 rounded-lg transition-colors"
                    >
                        Lihat Semua
                    </button>
                </div>
            </div>

            {/* Daftar riwayat */}
            <div className="p-2.5 max-h-80 overflow-y-auto">
                {hasHistoryData && history.length > 0 ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
                        {history.map(renderHistoryRow)}
                    </div>
                ) : fallbackLogins.length > 0 ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
                        {[...fallbackLogins]
                            .sort((a, b) => {
                                const ta = a.lastLoginAt ? new Date(a.lastLoginAt).getTime() : 0;
                                const tb = b.lastLoginAt ? new Date(b.lastLoginAt).getTime() : 0;
                                return tb - ta;
                            })
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
            {showAllModal && (
                <div
                    className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4"
                    onClick={() => setShowAllModal(false)}
                >
                    <div
                        className="bg-white rounded-2xl border border-[#3083FF]/20 shadow-2xl max-w-2xl w-full overflow-hidden flex flex-col max-h-[85dvh]"
                        onClick={e => e.stopPropagation()}
                    >
                        {/* Modal header */}
                        <div className="px-5 py-4 border-b border-[#3083FF]/15 flex items-center justify-between bg-gradient-to-r from-[#3083FF]/[0.06] via-[#3083FF]/[0.02] to-transparent">
                            <div className="flex items-center gap-3">
                                <div className="w-9 h-9 rounded-xl bg-[#3083FF]/10 border border-[#3083FF]/20 flex items-center justify-center text-[#3083FF]">
                                    <LogIn size={17} />
                                </div>
                                <div>
                                    <h3 className="text-sm font-bold text-slate-900">
                                        Riwayat Aktivitas Login
                                    </h3>
                                    {!allLoading && (
                                        <p className="text-[11px] text-slate-500 mt-0.5">
                                            Menampilkan {filteredAllHistory.length} aktivitas tercatat
                                        </p>
                                    )}
                                </div>
                            </div>
                            <button
                                onClick={() => setShowAllModal(false)}
                                className="w-8 h-8 flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-[#3083FF]/10 rounded-lg transition-colors"
                            >
                                <X size={16} />
                            </button>
                        </div>

                        {/* Filter bar */}
                        <div className="px-4 py-3 flex flex-wrap items-center gap-2 border-b border-slate-100 bg-slate-50/50">
                            <div className="flex-1 min-w-[180px] relative">
                                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#3083FF]/60" />
                                <input
                                    type="text"
                                    value={searchAll}
                                    onChange={(e) => setSearchAll(e.target.value)}
                                    placeholder="Cari nama pengguna..."
                                    className="w-full bg-white border border-[#3083FF]/20 text-slate-800 placeholder:text-slate-400 focus:border-[#3083FF] focus:ring-2 focus:ring-[#3083FF]/20 outline-none pl-9 pr-3 py-1.5 rounded-lg text-xs"
                                />
                            </div>
                            <select
                                value={filterMethod}
                                onChange={(e) => setFilterMethod(e.target.value)}
                                className="bg-white border border-[#3083FF]/20 text-slate-700 text-xs font-medium px-3 py-1.5 rounded-lg focus:border-[#3083FF] focus:ring-2 focus:ring-[#3083FF]/20 outline-none"
                            >
                                <option value="all">Semua Metode</option>
                                <option value="password">Password</option>
                                <option value="sso">SSO</option>
                            </select>
                            <select
                                value={filterStatus}
                                onChange={(e) => setFilterStatus(e.target.value)}
                                className="bg-white border border-[#3083FF]/20 text-slate-700 text-xs font-medium px-3 py-1.5 rounded-lg focus:border-[#3083FF] focus:ring-2 focus:ring-[#3083FF]/20 outline-none"
                            >
                                <option value="all">Semua Status</option>
                                <option value="success">Berhasil</option>
                                <option value="failed">Gagal</option>
                            </select>
                        </div>

                        {/* Content */}
                        <div className="p-3 overflow-y-auto flex-1">
                            {allLoading ? (
                                <div className="py-12 flex items-center justify-center">
                                    <Loader2 size={24} className="text-[#3083FF] animate-spin" />
                                </div>
                            ) : filteredAllHistory.length > 0 ? (
                                <div className="space-y-1">
                                    {filteredAllHistory.map((record) => {
                                        const deviceLabel = [record.browser, record.os].filter(Boolean).join(' · ');
                                        return (
                                            <div
                                                key={record.id}
                                                className={`flex items-center gap-3 p-3 rounded-xl border transition-all ${
                                                    record.success
                                                        ? 'border-transparent hover:border-[#3083FF]/15 hover:bg-[#3083FF]/[0.03]'
                                                        : 'bg-rose-50/40 border-rose-100/80 hover:bg-rose-50/70'
                                                }`}
                                            >
                                                {/* Avatar */}
                                                <div className="relative shrink-0">
                                                    <div className={`w-9 h-9 rounded-full flex items-center justify-center border ${
                                                        record.success
                                                            ? 'bg-gradient-to-br from-[#3083FF]/15 to-[#3083FF]/5 border-[#3083FF]/20 text-[#3083FF]'
                                                            : 'bg-rose-50 border-rose-200 text-rose-500'
                                                    }`}>
                                                        <span className="text-xs font-bold">
                                                            {record.fullName.charAt(0).toUpperCase()}
                                                        </span>
                                                    </div>
                                                    <span
                                                        className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full ring-2 ring-white ${
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
                                                            <span className="text-[10px] bg-[#3083FF]/[0.06] text-[#3083FF] px-1.5 py-0.5 rounded font-semibold">
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
                                                </div>

                                                {/* Waktu */}
                                                <div className="shrink-0 text-right">
                                                    <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold bg-[#3083FF]/[0.07] text-[#3083FF]">
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
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

