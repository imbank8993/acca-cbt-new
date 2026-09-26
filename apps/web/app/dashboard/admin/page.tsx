"use client";
import React, { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
    ClipboardCheck, Users, Clock, BookOpen, CheckCircle2,
    ArrowRight, Plus, Activity, Shield, Layers, Eye, Settings, ChevronRight, Zap, AlertCircle, Crown, School, Building2
} from 'lucide-react';
import { getOrganizationStats, listOrganizationExams, getRecentLogins, getProctorOrganization } from '@/lib/api/proctor';
import { getSetting, pickAnnouncements, type Announcement } from '@/lib/api/settings';
import { getSessionUser } from '@/lib/session';
import { REFRESH_INTERVAL, useAutoRefresh } from '@/lib/useAutoRefresh';
import { useRouter } from 'next/navigation';
import { RecentLoginsCard } from './RecentLoginsCard';
import { useMemoryState } from '@/lib/useMemoryState';
import { linkifyText } from '@/lib/text-format';

export default function AdminDashboard() {
    const router = useRouter();
    const [org, setOrg] = useState<any>(null);
    const [stats, setStats] = useMemoryState('admin_stats', {
        totalMembers: 0,
        totalBanks: 0,
        ongoingExams: 0,
        draftExams: 0,
        finishedExams: 0
    });
    const [exams, setExams] = useMemoryState<any[]>('admin_exams', []);
    const [logins, setLogins] = useMemoryState<any[]>('admin_logins', []);
    const [loading, setLoading] = useMemoryState('admin_loading', true);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [announcements, setAnnouncements] = useMemoryState<any[]>('admin_announcements', []);
    const [showAnnouncementsPopup, setShowAnnouncementsPopup] = useState(false);
    const [showMembersModal, setShowMembersModal] = useState(false);
    const [membersList, setMembersList] = useState<any[]>([]);
    const [membersLoading, setMembersLoading] = useState(false);

    const loadData = useCallback(async () => {
        try {
            const user = await getSessionUser();

            // Single-school: there is one organization and staff roles come from
            // metadata (not membership), so resolve via getProctorOrganization
            // which always returns the one school.
            const organization = user ? await getProctorOrganization() : null;

            if (!organization) {
                setErrorMsg('Sekolah belum dikonfigurasi. Silakan hubungi admin.');
                setLoading(false);
                return;
            }

            const orgId = organization.id;
            setOrg({ id: organization.id, name: organization.name });

            const [statData, examData, loginData, announcementConfig] = await Promise.all([
                getOrganizationStats(),
                listOrganizationExams(),
                getRecentLogins(10),
                getSetting<Announcement | Announcement[]>('announcement_config')
            ]);
            setStats(statData);
            setExams(examData);
            setLogins(loginData);
            
            setAnnouncements(pickAnnouncements(announcementConfig, 'show_proktor'));
        } catch (error: any) {
            console.error('Load data error:', error);
            setErrorMsg(error.message || 'Terjadi kesalahan saat memuat data');
        } finally {
            setLoading(false);
        }
    }, [router]);

    useAutoRefresh(loadData, REFRESH_INTERVAL.dashboard);

    useEffect(() => {
        loadData();
    }, [loadData]);

    const getGreeting = () => {
        const hour = new Date().getHours();
        if (hour < 11) return "Selamat Pagi";
        if (hour < 15) return "Selamat Siang";
        if (hour < 18) return "Selamat Sore";
        return "Selamat Malam";
    };

    const getDay = () => {
        const days = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
        const now = new Date();
        return `${days[now.getDay()]}, ${now.getDate()} ${months[now.getMonth()]} ${now.getFullYear()}`;
    };

    // Buka daftar anggota yang sudah pernah login (punya last_login_at).
    const openMembers = async () => {
        if (!org?.id) return;
        setShowMembersModal(true);
        setMembersLoading(true);
        try {
            const all = await getRecentLogins(500);
            setMembersList((all || []).filter((m: any) => m.lastLoginAt));
        } catch (e) {
            console.error('Load members error:', e);
            setMembersList([]);
        } finally {
            setMembersLoading(false);
        }
    };

    const formatLoginTime = (iso: string | null) => {
        if (!iso) return '-';
        try {
            return new Date(iso).toLocaleString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
        } catch { return '-'; }
    };

    const statCards = [
        {
            label: 'Total Anggota',
            value: stats.totalMembers,
            icon: Users,
            gradient: 'from-[#030C4D] to-[#1a246b]',
            iconBg: 'bg-[#030C4D]/10',
            iconColor: 'text-[#030C4D]',
            borderColor: 'border-[#030C4D]/40',
            valueColor: 'text-[#0038A8]',
            description: 'Guru & Siswa aktif',
            onClick: openMembers,
        },
        {
            label: 'Bank Soal',
            value: stats.totalBanks,
            icon: BookOpen,
            gradient: 'from-[#0038A8] to-[#0038A8]',
            iconBg: 'bg-[#030C4D]/10',
            iconColor: 'text-[#030C4D]',
            borderColor: 'border-[#030C4D]/40',
            valueColor: 'text-[#0038A8]',
            description: 'Koleksi soal tersedia',
            onClick: () => router.push('/dashboard/admin/questions'),
        },
        {
            label: 'Ujian Mendatang',
            value: stats.draftExams,
            icon: Layers,
            gradient: 'from-[#030C4D] to-[#1a246b]',
            iconBg: 'bg-[#030C4D]/10',
            iconColor: 'text-[#030C4D]',
            borderColor: 'border-[#030C4D]/40',
            valueColor: 'text-[#0038A8]',
            description: 'Ujian terjadwal',
            onClick: () => router.push('/dashboard/admin/exams'),
        },
        {
            label: 'Ujian Aktif',
            value: stats.ongoingExams,
            icon: Clock,
            gradient: 'from-[#0038A8] to-[#0038A8]',
            iconBg: 'bg-[#030C4D]/10',
            iconColor: 'text-[#030C4D]',
            borderColor: 'border-[#030C4D]/40',
            valueColor: 'text-[#0038A8]',
            description: 'Sedang berlangsung',
            onClick: () => router.push('/dashboard/admin/exams'),
        },
        {
            label: 'Selesai',
            value: stats.finishedExams,
            icon: CheckCircle2,
            gradient: 'from-[#030C4D] to-[#020510]',
            iconBg: 'bg-[#030C4D]/10',
            iconColor: 'text-[#030C4D]',
            borderColor: 'border-[#030C4D]/40',
            valueColor: 'text-[#0038A8]',
            description: 'Telah selesai dikerjakan',
            onClick: () => router.push('/dashboard/admin/exams'),
        },
    ];

    const quickActions = [
        { label: 'Buat Ujian Baru', icon: Plus, color: 'text-[#030C4D]', bg: 'bg-[#030C4D]/5', border: 'border-[#030C4D]/20', hoverBg: 'hover:bg-[#030C4D]/10', to: '/dashboard/admin/exams' },
        { label: 'Monitoring Ujian', icon: Eye, color: 'text-[#0038A8]', bg: 'bg-[#0038A8]/5', border: 'border-[#0038A8]/20', hoverBg: 'hover:bg-[#0038A8]/10', to: '/dashboard/admin/monitoring' },
        { label: 'Kelola Anggota', icon: Users, color: 'text-[#030C4D]', bg: 'bg-[#030C4D]/5', border: 'border-[#030C4D]/20', hoverBg: 'hover:bg-[#030C4D]/10', to: '/dashboard/admin/members' },
        { label: 'Bank Soal', icon: BookOpen, color: 'text-[#0038A8]', bg: 'bg-[#0038A8]/5', border: 'border-[#0038A8]/20', hoverBg: 'hover:bg-[#0038A8]/10', to: '/dashboard/admin/banks' },
        { label: 'Backup Data', icon: Settings, color: 'text-[#030C4D]', bg: 'bg-[#030C4D]/5', border: 'border-[#030C4D]/20', hoverBg: 'hover:bg-[#030C4D]/10', to: '/dashboard/admin/backup' },
    ];

    const activitySummary = [
        { label: 'Mendatang', value: stats.draftExams, color: 'bg-[#0038A8]', textColor: 'text-[#0038A8]' },
        { label: 'Aktif', value: stats.ongoingExams, color: 'bg-emerald-500', textColor: 'text-emerald-600' },
        { label: 'Selesai', value: stats.finishedExams, color: 'bg-[#030C4D]', textColor: 'text-[#030C4D]' },
    ];

    const totalExams = stats.draftExams + stats.ongoingExams + stats.finishedExams;

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-[60vh]">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#030C4D]"></div>
            </div>
        );
    }

    if (errorMsg) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh]">
                <div className="p-4 bg-red-50 text-red-600 rounded-lg max-w-md w-full border border-red-200">
                    <h3 className="font-bold mb-2 flex items-center gap-2">
                        <AlertCircle size={20} />
                        Gagal Memuat Dashboard
                    </h3>
                    <p className="text-sm">{errorMsg}</p>
                    <button onClick={() => window.location.reload()} className="mt-4 px-4 py-2 bg-red-100 hover:bg-red-200 rounded text-sm font-semibold transition-colors">
                        Coba Lagi
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="max-w-7xl mx-auto pb-24">

            {/* ── Hero Header — Navy Gradient ── */}
            {/* Back to Admin button removed per request */}

            {/* ── Stats Grid ── */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-x-2 mb-8">
                {statCards.map((item, i) => (
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.06, duration: 0.4 }}
                        whileTap={{ scale: 0.97 }}
                        key={i}
                        role="button"
                        tabIndex={0}
                        aria-label={`${item.label}: ${item.value} — ${item.description}`}
                        onClick={() => item.onClick?.()}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); item.onClick?.(); } }}
                        className="group relative bg-white rounded-lg px-4 py-4 border border-[#030C4D]/20 hover:border-[#030C4D] hover:shadow-lg hover:shadow-[#030C4D]/10 transition-all duration-300 cursor-pointer overflow-hidden text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#030C4D] focus-visible:ring-offset-2"
                    >
                        {/* Top accent line */}
                        <div className={`absolute top-0 left-0 right-0 h-1 bg-gradient-to-r ${item.gradient} opacity-0 group-hover:opacity-100 transition-opacity duration-300`} />

                        {/* Affordance: panah muncul saat hover/focus (menandakan bisa diklik) */}
                        <ChevronRight size={14} className="absolute top-2.5 right-2.5 text-[#030C4D]/0 group-hover:text-[#030C4D]/40 transition-colors duration-300" />

                        <div className="relative flex flex-col items-center">
                            {/* Icon dan Label berdampingan */}
                            <div className="flex items-center gap-2 mb-3">
                                <div className={`w-8 h-8 ${item.iconBg} rounded-lg flex items-center justify-center ${item.borderColor} group-hover:scale-110 transition-transform duration-300`}>
                                    <item.icon size={16} className={item.iconColor} />
                                </div>
                                <p className="text-sm font-semibold text-slate-700">{item.label}</p>
                            </div>
                            {/* Angka dan Keterangan */}
                            <div className="space-y-0.5">
                                <p className={`text-3xl font-extrabold ${item.valueColor} leading-none tabular-nums tracking-tight`}>{(item.value ?? 0).toLocaleString('id-ID')}</p>
                                <p className="text-xs text-slate-400">{item.description}</p>
                            </div>
                        </div>
                    </motion.div>
                ))}
            </div>

            {/* ── Layout: Ujian (3 card width) dan Ringkasan (2 card width) ── */}
            <div className="grid grid-cols-1 md:grid-cols-5 gap-4">

                {/* ── Left: Exam List (3/5 width - mengikuti 3 card di atas) ── */}
                <div className="md:col-span-3 bg-white rounded-lg border border-[#0038A8]/30 overflow-hidden shadow-sm">
                    <div className="px-6 py-4 border-b border-[#0038A8]/20 bg-gradient-to-r from-[#030C4D]/[.02] to-transparent">
                        <div>
                            <h2 className="text-base font-bold text-slate-900">Ujian</h2>
                            <p className="text-xs text-slate-400 mt-0.5">{exams.length} total ujian</p>
                        </div>
                    </div>

                    {exams.length > 0 ? (
                        <div className="divide-y divide-slate-50">
                            {exams.slice(0, 6).map((exam, idx) => {
                                const isPublished = !!exam.is_published;
                                const isDraft = !isPublished;
                                const now = new Date();
                                const isFinished = exam.status === 'finished' ||
                                    (isPublished && exam.status === 'active' && exam.end_time && new Date(exam.end_time) < now);
                                const isOngoing = isPublished && exam.status === 'active' &&
                                    (!exam.start_time || new Date(exam.start_time) <= now) &&
                                    (!exam.end_time || new Date(exam.end_time) >= now);

                                return (
                                    <motion.div
                                        initial={{ opacity: 0, x: -10 }}
                                        animate={{ opacity: 1, x: 0 }}
                                        transition={{ delay: idx * 0.05 }}
                                        key={exam.id}
                                        className="group px-6 py-4 flex items-center gap-4 hover:bg-slate-50/80 transition-colors cursor-pointer"
                                        onClick={() => router.push('/dashboard/admin/monitoring?exam=' + exam.id)}
                                    >
                                        {/* Icon */}
                                        <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 transition-all ${
                                            isOngoing
                                                ? 'bg-[#0038A8]/10 group-hover:bg-[#0038A8]/15'
                                                : isPublished
                                                ? 'bg-[#030C4D]/10 group-hover:bg-[#030C4D]/15'
                                                : 'bg-slate-50 group-hover:bg-slate-100'
                                        }`}>
                                            <ClipboardCheck size={18} className={
                                                isOngoing ? 'text-[#0038A8]'
                                                : isPublished ? 'text-[#030C4D]' : 'text-slate-400'
                                            } />
                                        </div>

                                        {/* Info */}
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-semibold text-slate-800 truncate group-hover:text-[#030C4D] transition-colors">{exam.title}</p>
                                            <div className="flex flex-wrap items-center gap-2 mt-1.5">
                                                <span className="text-[11px] font-medium text-slate-600 flex items-center gap-1 bg-slate-100 px-2 py-1 rounded-md">
                                                    <Clock size={12} />
                                                    {exam.duration_minutes} mnt
                                                </span>
                                                {exam.exam_type && exam.exam_type !== 'daily' && (
                                                    <span className="text-[10px] text-[#030C4D] font-bold bg-[#030C4D]/10 px-2 py-1 rounded-md">
                                                        {exam.exam_type.toUpperCase()}
                                                    </span>
                                                )}
                                                {exam.start_time && (
                                                    <span className="text-[11px] font-medium text-slate-600 bg-slate-100 px-2 py-1 rounded-md whitespace-nowrap">
                                                        {new Date(exam.start_time).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })} • {new Date(exam.start_time).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}
                                                    </span>
                                                )}
                                            </div>
                                        </div>

                                        {/* Status & Creator */}
                                        <div className="shrink-0 flex flex-col items-end justify-center">
                                            <div className="flex items-center gap-3">
                                                <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold border ${
                                                    isOngoing
                                                        ? 'bg-[#0038A8]/10 text-[#0038A8] border-[#0038A8]/30'
                                                        : isDraft
                                                        ? 'bg-[#030C4D]/5 text-[#030C4D] border-[#030C4D]/20'
                                                        : isFinished
                                                        ? 'bg-emerald-100 text-emerald-700 border-emerald-200'
                                                        : 'bg-[#030C4D]/10 text-[#030C4D] border-[#030C4D]/20'
                                                }`}>
                                                    <span className={`w-1.5 h-1.5 rounded-full ${
                                                        isOngoing ? 'bg-[#0038A8] animate-pulse shadow-lg shadow-[#0038A8]/50'
                                                        : isDraft ? 'bg-[#030C4D]'
                                                        : isFinished ? 'bg-emerald-500' : 'bg-[#030C4D]'
                                                    }`} />
                                                    {isOngoing ? 'Aktif' : isDraft ? 'Draft' : isFinished ? 'Selesai' : 'Terjadwal'}
                                                </span>
                                                <ArrowRight size={14} className="text-slate-300 group-hover:text-[#030C4D] group-hover:translate-x-0.5 transition-all" />
                                            </div>
                                            
                                            {exam.creatorName && exam.creatorName !== 'Unknown' && (
                                                <span className="text-[10px] text-slate-400 mt-1.5 mr-6 pr-1">
                                                    oleh: <span className="font-semibold text-slate-600">{exam.creatorName}</span>
                                                </span>
                                            )}
                                        </div>
                                    </motion.div>
                                );
                            })}
                        </div>
                    ) : (
                        <div className="py-16 text-center">
                            <div className="w-16 h-16 bg-[#030C4D]/5 rounded-2xl flex items-center justify-center mx-auto mb-4">
                                <Activity size={22} className="text-[#030C4D]/40" />
                            </div>
                            <p className="font-bold text-slate-700 mb-1">Belum Ada Ujian</p>
                            <p className="text-xs text-slate-400 mb-4">Mulai buat ujian pertama Anda</p>
                            <button
                                onClick={() => router.push('/dashboard/admin/exams')}
                                className="inline-flex items-center gap-1.5 text-xs font-bold text-[#030C4D] bg-[#030C4D]/5 hover:bg-[#030C4D]/10 px-4 py-2 rounded-lg transition-colors"
                            >
                                <Plus size={12} /> Buat Ujian
                            </button>
                        </div>
                    )}
                </div>

                {/* ── Right: Ringkasan (2/5 width - mengikuti 2 card di atas) ── */}
                <div className="md:col-span-2 space-y-4">

                    {/* Aktivitas Login Pengguna */}
                    <RecentLoginsCard initialLogins={logins} orgId={org?.id} />
                    {/* Informasi / Pengumuman */}
                    {announcements.length > 0 && (
                        <div className="bg-white rounded-lg border border-blue-200 overflow-hidden shadow-sm">
                            <div className="px-5 py-4 border-b border-blue-100 bg-gradient-to-r from-blue-50 to-transparent flex justify-between items-center">
                                <h2 className="text-sm font-bold text-[#030C4D] flex items-center gap-2">
                                    <AlertCircle size={16} /> Informasi
                                </h2>
                                {announcements.length > 2 && (
                                    <button 
                                        onClick={() => setShowAnnouncementsPopup(true)}
                                        className="text-xs font-semibold text-blue-600 hover:text-blue-800 flex items-center gap-1 transition-colors bg-blue-50 hover:bg-blue-100 px-2.5 py-1.5 rounded-lg"
                                    >
                                        <Eye size={14} /> Lihat Semua
                                    </button>
                                )}
                            </div>
                            <div className="p-3">
                                <div className="space-y-3">
                                    {announcements.slice(0, 2).map((ann, idx) => (
                                        <div key={ann.id || idx} className="bg-blue-50/50 border border-blue-100 rounded-lg p-3">
                                            <div className="flex justify-between items-start gap-2 mb-1">
                                                <h3 className="font-semibold text-[#030C4D] text-xs line-clamp-1">{ann.title}</h3>
                                                {ann.created_at && (
                                                    <span className="text-[9px] text-slate-400 shrink-0 whitespace-nowrap">
                                                        {new Date(ann.created_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })}
                                                    </span>
                                                )}
                                            </div>
                                            <p className="text-[11px] text-slate-600 line-clamp-2" dangerouslySetInnerHTML={{ __html: linkifyText(ann.content) }}></p>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}

                </div>
            </div>

            {/* Popup Modal Informasi */}
            {showAnnouncementsPopup && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm transition-opacity">
                    <motion.div 
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden"
                    >
                        <div className="px-6 py-5 border-b border-slate-100 flex justify-between items-center bg-[#f8fafc]">
                            <div>
                                <h2 className="text-lg font-bold text-[#030C4D] flex items-center gap-2">
                                    <AlertCircle size={20} className="text-blue-600" /> Pusat Informasi
                                </h2>
                                <p className="text-xs text-slate-500 mt-0.5">Semua pengumuman yang sedang tayang.</p>
                            </div>
                            <button 
                                onClick={() => setShowAnnouncementsPopup(false)}
                                className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 hover:text-slate-700 transition-colors"
                            >
                                ✕
                            </button>
                        </div>
                        <div className="p-6 overflow-y-auto bg-slate-50 flex-1 space-y-4">
                            {announcements.map((ann, idx) => (
                                <div key={ann.id || idx} className="bg-white border border-blue-100 rounded-xl p-5 shadow-sm">
                                    <div className="flex items-start gap-3">
                                        <div className="bg-blue-50 text-blue-600 p-2 rounded-lg shrink-0 mt-0.5">
                                            <AlertCircle size={18} />
                                        </div>
                                        <div className="flex-1">
                                            <div className="flex justify-between items-start gap-2 mb-2">
                                                <h3 className="font-bold text-[#030C4D] text-sm">{ann.title}</h3>
                                                {ann.created_at && (
                                                    <span className="text-xs text-slate-400 shrink-0 bg-slate-50 px-2 py-1 rounded-md border border-slate-100">
                                                        {new Date(ann.created_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                                    </span>
                                                )}
                                            </div>
                                            <p className="text-sm text-slate-600 whitespace-pre-wrap leading-relaxed" dangerouslySetInnerHTML={{ __html: linkifyText(ann.content, 'text-blue-600 underline font-semibold hover:text-blue-800 transition-colors') }}></p>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                        <div className="p-4 border-t border-slate-100 bg-white flex justify-end">
                            <button
                                onClick={() => setShowAnnouncementsPopup(false)}
                                className="px-5 py-2.5 bg-[#030C4D] text-white text-sm font-semibold rounded-xl hover:bg-[#0a1a6e] transition-colors"
                            >
                                Tutup
                            </button>
                        </div>
                    </motion.div>
                </div>
            )}

            {/* Modal: Anggota yang sudah pernah login */}
            {showMembersModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm" onClick={() => setShowMembersModal(false)}>
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        onClick={(e) => e.stopPropagation()}
                        className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[85vh] flex flex-col overflow-hidden"
                    >
                        <div className="px-6 py-5 border-b border-slate-100 flex justify-between items-center bg-[#f8fafc]">
                            <div>
                                <h2 className="text-lg font-bold text-[#030C4D] flex items-center gap-2">
                                    <Users size={20} className="text-[#030C4D]" /> Anggota Pernah Login
                                </h2>
                                <p className="text-xs text-slate-500 mt-0.5">{membersList.length} anggota sudah pernah masuk ke ACCA CBT.</p>
                            </div>
                            <button
                                onClick={() => setShowMembersModal(false)}
                                className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 hover:text-slate-700 transition-colors"
                            >
                                ✕
                            </button>
                        </div>
                        <div className="p-4 overflow-y-auto bg-slate-50 flex-1">
                            {membersLoading ? (
                                <div className="py-12 flex justify-center">
                                    <div className="w-8 h-8 border-4 border-[#030C4D] border-t-transparent rounded-full animate-spin" />
                                </div>
                            ) : membersList.length === 0 ? (
                                <div className="py-12 text-center text-sm text-slate-400">Belum ada anggota yang login.</div>
                            ) : (
                                <div className="space-y-2">
                                    {membersList.map((m) => (
                                        <div key={m.id} className="flex items-center gap-3 bg-white border border-slate-100 rounded-xl p-3">
                                            <div className="w-9 h-9 rounded-full bg-[#030C4D]/10 text-[#030C4D] flex items-center justify-center font-bold shrink-0 uppercase">
                                                {(m.fullName?.[0] || 'U')}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <p className="text-sm font-semibold text-slate-800 truncate">{m.fullName}</p>
                                                <p className="text-[11px] text-slate-400">{m.role}</p>
                                            </div>
                                            <div className="text-right shrink-0">
                                                <p className="text-[10px] text-slate-400 uppercase tracking-wider">Login terakhir</p>
                                                <p className="text-xs font-medium text-slate-600">{formatLoginTime(m.lastLoginAt)}</p>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </motion.div>
                </div>
            )}
        </div>
    );
}
