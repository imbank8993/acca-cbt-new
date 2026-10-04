'use client';

import { getLoginHistory } from '@/lib/api/proctor';
import type { LoginHistoryRecord, LoginStats, RecentLogin } from '@/lib/api/proctor';
import {
    Activity, Check, ChevronDown, ChevronUp, Clock, Globe, KeyRound,
    Loader2, LogIn, Monitor, Smartphone, Tablet, X, Shield, RefreshCw,
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
    const [showStats, setShowStats] = useState(true);
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
                hour: '2-digit', minute: '2-digit', second: '2-digit',
            });
        } catch { return '-'; }
    };

    const getTimeAgo = (dateString: string) => {
        const now = new Date();
        const past = new Date(dateString);
        const diffMs = now.getTime() - past.getTime();
        const diffSecs = Math.floor(diffMs / 1000);
        if (diffSecs < 60) return `${diffSecs} dtk lalu`;
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
            case 'mobile': return <Smartphone size={12} className="text-slate-400" />;
            case 'tablet': return <Tablet size={12} className="text-slate-400" />;
            default: return <Monitor size={12} className="text-slate-400" />;
        }
    };

    // Badge metode login
    const MethodBadge = ({ method }: { method: string }) => {
        if (method === 'sso') {
            return (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold bg-purple-50 text-purple-600 border border-purple-200">
                    <Shield size={9} /> SSO
                </span>
            );
        }
        return (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold bg-blue-50 text-[#3083FF] border border-blue-200">
                <KeyRound size={9} /> Password
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
    const renderHistoryRow = (record: LoginHistoryRecord) => (
        <div
            key={record.id}
            className={`flex items-start gap-3 p-2.5 rounded-lg transition-colors ${
                record.success
                    ? 'hover:bg-slate-50'
                    : 'bg-red-50/50 hover:bg-red-50'
            }`}
        >
            {/* Avatar + Status */}
            <div className="relative shrink-0">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                    record.success ? 'bg-[#3083FF]/10' : 'bg-red-100'
                }`}>
                    <span className={`text-xs font-bold ${
                        record.success ? 'text-[#3083FF]' : 'text-red-500'
                    }`}>
                        {record.fullName.charAt(0).toUpperCase()}
                    </span>
                </div>
                <div className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full flex items-center justify-center border-2 border-white ${
                    record.success ? 'bg-emerald-500' : 'bg-red-500'
                }`}>
                    {record.success
                        ? <Check size={7} className="text-white" strokeWidth={3} />
                        : <X size={7} className="text-white" strokeWidth={3} />
                    }
                </div>
            </div>

            {/* Info utama */}
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                    <p className="text-xs font-semibold text-slate-800 truncate">{record.fullName}</p>
                    <MethodBadge method={record.loginMethod} />
                </div>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                    {record.role && (
                        <span className="text-[10px] text-slate-500 font-medium">{record.role}</span>
                    )}
                    {record.browser && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] text-slate-400">
                            <DeviceIcon type={record.deviceType} />
                            {record.browser}
                            {record.os ? ` · ${record.os}` : ''}
                        </span>
                    )}
                    {record.ipAddress && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] text-slate-400">
                            <Globe size={9} /> {record.ipAddress}
                        </span>
                    )}
                </div>
                {!record.success && record.failureReason && (
                    <p className="text-[10px] text-red-500 mt-0.5">⚠ {record.failureReason}</p>
                )}
            </div>

            {/* Waktu */}
            <div className="shrink-0 text-right">
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-bold border bg-slate-100 text-slate-500 border-slate-200">
                    <Clock size={9} />
                    {getTimeAgo(record.createdAt)}
                </span>
            </div>
        </div>
    );

    // Fallback: render baris lama (data dari getRecentLogins)
    const renderFallbackRow = (login: LoginUser) => (
        <div key={login.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-slate-50 transition-colors">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                login.isActive ? 'bg-[#3083FF]/10' : 'bg-slate-100'
            }`}>
                <span className={`text-xs font-bold ${
                    login.isActive ? 'text-[#3083FF]' : 'text-slate-400'
                }`}>
                    {login.fullName.charAt(0).toUpperCase()}
                </span>
            </div>
            <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-slate-800 truncate">{login.fullName}</p>
                <p className="text-[10px] text-slate-400">{login.role}</p>
            </div>
            <div className="shrink-0 text-right">
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-bold border bg-slate-100 text-slate-500 border-slate-200">
                    {getTimeAgo(login.lastLoginAt)}
                </span>
            </div>
        </div>
    );

    if (loading) {
        return (
            <div className="bg-white rounded-lg border border-[#3083FF]/30 overflow-hidden shadow-sm">
                <div className="px-5 py-4 border-b border-[#3083FF]/20 bg-gradient-to-r from-[#3083FF]/[.02] to-transparent">
                    <h2 className="text-sm font-bold text-slate-900">Aktivitas Login</h2>
                </div>
                <div className="py-10 flex items-center justify-center">
                    <Loader2 size={24} className="text-[#3083FF] animate-spin" />
                </div>
            </div>
        );
    }

    return (
        <div className="bg-white rounded-lg border border-[#3083FF]/30 overflow-hidden shadow-sm">
            {/* Header */}
            <div className="px-5 py-3 border-b border-[#3083FF]/20 bg-gradient-to-r from-[#3083FF]/[.02] to-transparent flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <h2 className="text-sm font-bold text-slate-900">Aktivitas Login</h2>
                    <button
                        type="button"
                        onClick={() => void loadHistory()}
                        disabled={refreshing}
                        title="Muat ulang aktivitas login"
                        className="text-[9px] text-slate-400 hover:text-[#3083FF] flex items-center gap-1 transition-colors disabled:cursor-wait"
                    >
                        <RefreshCw size={9} className={refreshing ? 'animate-spin' : ''} />
                        {lastRefresh.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </button>
                </div>
                <div className="flex items-center gap-2">
                    {hasHistoryData && (
                        <button
                            onClick={() => setShowStats(!showStats)}
                            className="text-[10px] text-slate-400 hover:text-slate-600 transition-colors"
                        >
                            {showStats ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        </button>
                    )}
                    <button
                        onClick={openAllModal}
                        className="text-[11px] font-bold text-[#3083FF] hover:text-[#3083FF] px-2.5 py-1 rounded-lg border border-[#3083FF]/30 hover:bg-[#3083FF]/5 transition-colors"
                    >
                        Lihat Semua
                    </button>
                </div>
            </div>

            {/* Statistik */}
            {hasHistoryData && stats && showStats && (
                <div className="grid grid-cols-4 gap-0 border-b border-slate-100">
                    <div className="px-3 py-2.5 text-center border-r border-slate-100">
                        <p className="text-base font-extrabold text-[#3083FF] tabular-nums">{stats.todayTotal}</p>
                        <p className="text-[9px] text-slate-400 font-medium">Hari Ini</p>
                    </div>
                    <div className="px-3 py-2.5 text-center border-r border-slate-100">
                        <p className="text-base font-extrabold text-[#3083FF] tabular-nums">{stats.todayUnique}</p>
                        <p className="text-[9px] text-slate-400 font-medium">Unik</p>
                    </div>
                    <div className="px-3 py-2.5 text-center border-r border-slate-100">
                        <p className="text-base font-extrabold text-slate-600 tabular-nums">{stats.weekTotal}</p>
                        <p className="text-[9px] text-slate-400 font-medium">7 Hari</p>
                    </div>
                    <div className="px-3 py-2.5 text-center">
                        <p className={`text-base font-extrabold tabular-nums ${
                            stats.todayFailed > 0 ? 'text-red-500' : 'text-slate-400'
                        }`}>{stats.todayFailed}</p>
                        <p className="text-[9px] text-slate-400 font-medium">Gagal</p>
                    </div>
                </div>
            )}

            {/* Daftar riwayat */}
            <div className="p-3 max-h-80 overflow-y-auto">
                {hasHistoryData && history.length > 0 ? (
                    <div className="space-y-1">
                        {history.map(renderHistoryRow)}
                    </div>
                ) : fallbackLogins.length > 0 ? (
                    <div className="space-y-2">
                        {[...fallbackLogins]
                            .sort((a, b) => {
                                const ta = a.lastLoginAt ? new Date(a.lastLoginAt).getTime() : 0;
                                const tb = b.lastLoginAt ? new Date(b.lastLoginAt).getTime() : 0;
                                return tb - ta;
                            })
                            .map(renderFallbackRow)}
                    </div>
                ) : (
                    <div className="py-8 text-center">
                        <div className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-3">
                            <Activity size={20} className="text-slate-400" />
                        </div>
                        <p className="text-xs text-slate-500">Belum ada aktivitas login</p>
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
                        className="bg-white rounded-xl shadow-2xl max-w-2xl w-full overflow-hidden flex flex-col max-h-[85dvh]"
                        onClick={e => e.stopPropagation()}
                    >
                        {/* Modal header */}
                        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
                            <div>
                                <h3 className="font-bold text-slate-800 flex items-center gap-2">
                                    <LogIn size={18} className="text-[#3083FF]" />
                                    Riwayat Aktivitas Login
                                </h3>
                                {!allLoading && (
                                    <p className="text-[11px] text-slate-500 mt-0.5">
                                        {filteredAllHistory.length} catatan
                                    </p>
                                )}
                            </div>
                            <button onClick={() => setShowAllModal(false)} className="w-8 h-8 flex items-center justify-center text-slate-400 hover:bg-slate-200 rounded-lg transition-colors">
                                <X size={16} />
                            </button>
                        </div>

                        {/* Filter bar */}
                        <div className="px-4 pt-3 pb-2 flex items-center gap-2 border-b border-slate-100">
                            <div className="flex-1 relative">
                                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                <input
                                    type="text"
                                    value={searchAll}
                                    onChange={(e) => setSearchAll(e.target.value)}
                                    placeholder="Cari nama..."
                                    className="w-full bg-white border border-slate-200 text-slate-800 placeholder:text-slate-400 focus:ring-2 focus:ring-[#3083FF]/40 outline-none pl-9 pr-3 py-2 rounded-lg text-sm"
                                />
                            </div>
                            <select
                                value={filterMethod}
                                onChange={(e) => setFilterMethod(e.target.value)}
                                className="bg-white border border-slate-200 text-slate-700 text-xs font-medium px-3 py-2 rounded-lg focus:ring-2 focus:ring-[#3083FF]/40 outline-none"
                            >
                                <option value="all">Semua Metode</option>
                                <option value="password">Password</option>
                                <option value="sso">SSO</option>
                            </select>
                            <select
                                value={filterStatus}
                                onChange={(e) => setFilterStatus(e.target.value)}
                                className="bg-white border border-slate-200 text-slate-700 text-xs font-medium px-3 py-2 rounded-lg focus:ring-2 focus:ring-[#3083FF]/40 outline-none"
                            >
                                <option value="all">Semua Status</option>
                                <option value="success">Berhasil</option>
                                <option value="failed">Gagal</option>
                            </select>
                        </div>

                        {/* Content */}
                        <div className="p-3 overflow-y-auto flex-1">
                            {allLoading ? (
                                <div className="py-10 flex items-center justify-center">
                                    <Loader2 size={24} className="text-[#3083FF] animate-spin" />
                                </div>
                            ) : filteredAllHistory.length > 0 ? (
                                <div className="space-y-1">
                                    {filteredAllHistory.map((record) => (
                                        <div
                                            key={record.id}
                                            className={`flex items-start gap-3 p-3 rounded-lg transition-colors ${
                                                record.success
                                                    ? 'hover:bg-slate-50'
                                                    : 'bg-red-50/50 hover:bg-red-50'
                                            }`}
                                        >
                                            {/* Avatar */}
                                            <div className="relative shrink-0">
                                                <div className={`w-9 h-9 rounded-full flex items-center justify-center ${
                                                    record.success ? 'bg-[#3083FF]/10' : 'bg-red-100'
                                                }`}>
                                                    <span className={`text-sm font-bold ${
                                                        record.success ? 'text-[#3083FF]' : 'text-red-500'
                                                    }`}>
                                                        {record.fullName.charAt(0).toUpperCase()}
                                                    </span>
                                                </div>
                                                <div className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full flex items-center justify-center border-2 border-white ${
                                                    record.success ? 'bg-emerald-500' : 'bg-red-500'
                                                }`}>
                                                    {record.success
                                                        ? <Check size={7} className="text-white" strokeWidth={3} />
                                                        : <X size={7} className="text-white" strokeWidth={3} />
                                                    }
                                                </div>
                                            </div>

                                            {/* Info */}
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    <p className="text-sm font-semibold text-slate-800 truncate">{record.fullName}</p>
                                                    <MethodBadge method={record.loginMethod} />
                                                    {record.role && (
                                                        <span className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded font-medium">{record.role}</span>
                                                    )}
                                                </div>
                                                <div className="flex items-center gap-3 mt-1 flex-wrap">
                                                    {record.browser && (
                                                        <span className="inline-flex items-center gap-1 text-[11px] text-slate-500">
                                                            <DeviceIcon type={record.deviceType} />
                                                            {record.browser}{record.os ? ` · ${record.os}` : ''}
                                                        </span>
                                                    )}
                                                    {record.ipAddress && (
                                                        <span className="inline-flex items-center gap-1 text-[11px] text-slate-500">
                                                            <Globe size={10} /> {record.ipAddress}
                                                        </span>
                                                    )}
                                                </div>
                                                {!record.success && record.failureReason && (
                                                    <p className="text-[11px] text-red-500 mt-1">⚠ {record.failureReason}</p>
                                                )}
                                            </div>

                                            {/* Waktu */}
                                            <div className="shrink-0 text-right">
                                                <p className="text-[11px] font-medium text-slate-600">{getTimeAgo(record.createdAt)}</p>
                                                <p className="text-[10px] text-slate-400">{formatTime(record.createdAt)}</p>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <p className="py-8 text-center text-xs text-slate-400">Tidak ada data yang cocok</p>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
