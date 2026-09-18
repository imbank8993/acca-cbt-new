'use client';

import React, { useState, useEffect } from 'react';
import { Activity, Loader2, X } from 'lucide-react';
import { getRecentLogins } from '@/lib/api/proctor';

interface LoginUser {
    id: string;
    userId: string;
    fullName: string;
    role: string;
    isActive: boolean; // refers to account status
    lastLoginAt: string;
}

export function RecentLoginsCard({ initialLogins, orgId }: { initialLogins: LoginUser[], orgId: string }) {
    const [logins, setLogins] = useState<LoginUser[]>(initialLogins);
    const [showAllModal, setShowAllModal] = useState(false);
    const [allLogins, setAllLogins] = useState<LoginUser[]>([]);
    const [allLoading, setAllLoading] = useState(false);
    const [searchAll, setSearchAll] = useState('');

    useEffect(() => {
        setLogins(initialLogins);
    }, [initialLogins]);

    // Helper to format time ago for offline users
    const getTimeAgo = (dateString: string) => {
        const now = new Date();
        const past = new Date(dateString);
        const diffMs = now.getTime() - past.getTime();
        const diffMins = Math.floor(diffMs / 60000);

        if (diffMins < 1) return 'baru saja';
        if (diffMins < 60) return `${diffMins} mnt lalu`;

        const diffHours = Math.floor(diffMins / 60);
        if (diffHours < 24) return `${diffHours} jam lalu`;

        const diffDays = Math.floor(diffHours / 24);
        return `${diffDays} hari lalu`;
    };

    // Yang paling baru masuk di atas.
    //
    // Dulu pengguna yang SEDANG online diletakkan lebih dulu, memakai presence
    // realtime Supabase. Sumber itu sudah tidak ada, dan satu-satunya penanda
    // aktivitas yang tersisa adalah `last_sign_in_at` — waktu MASUK, bukan waktu
    // aktif. Menyebutnya "online" akan keliru, jadi yang ditampilkan hanya kapan
    // seseorang terakhir masuk.
    const sortByRecent = (list: LoginUser[]) =>
        [...list].sort((a, b) => {
            const ta = a.lastLoginAt ? new Date(a.lastLoginAt).getTime() : 0;
            const tb = b.lastLoginAt ? new Date(b.lastLoginAt).getTime() : 0;
            return tb - ta;
        });

    const openAllModal = async () => {
        setShowAllModal(true);
        setAllLoading(true);
        try {
            const all = await getRecentLogins(orgId, 1000);
            setAllLogins((all || []).filter((m: any) => m.lastLoginAt) as LoginUser[]);
        } catch (e) {
            console.error('Load all logins error:', e);
            setAllLogins([]);
        } finally {
            setAllLoading(false);
        }
    };

    const sortedLogins = sortByRecent(logins);
    const filteredAll = sortByRecent(allLogins).filter(l =>
        !searchAll.trim() || l.fullName.toLowerCase().includes(searchAll.trim().toLowerCase())
    );

    const renderRow = (login: LoginUser) => {
        return (
            <div
                key={login.id}
                className="flex items-center gap-3 p-2 rounded-lg hover:bg-slate-50 transition-colors"
            >
                {/* Avatar */}
                <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                    login.isActive ? 'bg-[#030C4D]/10' : 'bg-slate-100'
                }`}>
                    <span className={`text-xs font-bold ${
                        login.isActive ? 'text-[#030C4D]' : 'text-slate-400'
                    }`}>
                        {login.fullName.charAt(0).toUpperCase()}
                    </span>
                </div>
                {/* Info */}
                <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-slate-800 truncate">{login.fullName}</p>
                    <p className="text-[10px] text-slate-400">{login.role}</p>
                </div>
                {/* Status & Waktu */}
                <div className="shrink-0 text-right flex flex-col items-end">
                    {login.lastLoginAt ? (
                        <span className="inline-flex items-center justify-center px-2 py-0.5 rounded-lg text-[10px] font-bold border bg-slate-100 text-slate-500 border-slate-200">
                            {getTimeAgo(login.lastLoginAt)}
                        </span>
                    ) : (
                        <span className="text-[10px] text-slate-400">Belum pernah masuk</span>
                    )}
                </div>
            </div>
        );
    };

    return (
        <div className="bg-white rounded-lg border border-[#0038A8]/30 overflow-hidden shadow-sm">
            <div className="px-5 py-4 border-b border-[#0038A8]/20 bg-gradient-to-r from-[#030C4D]/[.02] to-transparent flex items-center justify-between">
                <h2 className="text-sm font-bold text-slate-900">Aktivitas Login</h2>
                <button
                    onClick={openAllModal}
                    className="text-[11px] font-bold text-[#0038A8] hover:text-[#030C4D] px-2.5 py-1 rounded-lg border border-[#0038A8]/30 hover:bg-[#0038A8]/5 transition-colors"
                >
                    Lihat Semua
                </button>
            </div>
            <div className="p-3 max-h-72 overflow-y-auto">
                {sortedLogins.length > 0 ? (
                    <div className="space-y-2">
                        {sortedLogins.map(renderRow)}
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

            {/* MODAL: semua pengguna yang pernah login, terbaru paling atas */}
            {showAllModal && (
                <div
                    className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4"
                    onClick={() => setShowAllModal(false)}
                >
                    <div
                        className="bg-white rounded-xl shadow-2xl max-w-lg w-full overflow-hidden flex flex-col max-h-[85dvh]"
                        onClick={e => e.stopPropagation()}
                    >
                        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
                            <div>
                                <h3 className="font-bold text-slate-800">Semua Aktivitas Login</h3>
                                {!allLoading && (
                                    <p className="text-[11px] text-slate-500 mt-0.5">
                                        {allLogins.length} pernah login
                                    </p>
                                )}
                            </div>
                            <button onClick={() => setShowAllModal(false)} className="w-8 h-8 flex items-center justify-center text-slate-400 hover:bg-slate-200 rounded-lg transition-colors">
                                <X size={16} />
                            </button>
                        </div>
                        <div className="px-4 pt-3">
                            <input
                                type="text"
                                value={searchAll}
                                onChange={(e) => setSearchAll(e.target.value)}
                                placeholder="Cari nama..."
                                className="w-full bg-white border border-slate-200 text-slate-800 placeholder:text-slate-400 focus:ring-2 focus:ring-[#0038A8]/40 outline-none px-3 py-2 rounded-lg text-sm"
                            />
                        </div>
                        <div className="p-3 overflow-y-auto flex-1">
                            {allLoading ? (
                                <div className="py-10 flex items-center justify-center">
                                    <Loader2 size={24} className="text-[#0038A8] animate-spin" />
                                </div>
                            ) : filteredAll.length > 0 ? (
                                <div className="space-y-1.5">
                                    {filteredAll.map(renderRow)}
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
