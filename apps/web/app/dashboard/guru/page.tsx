"use client";
import { getErrorMessage } from '@/lib/errors';
import { Spinner } from '@/app/components/ui/Spinner';
import {
    getProctorOrganization,
    getRecentLogins,
    listOrganizationExams,
    type OrganizationExam,
    type ProctorOrganization,
    type RecentLogin,
} from '@/lib/api/proctor';
import { getSetting,pickAnnouncements,type Announcement } from '@/lib/api/settings';
import { getGuruOrganizationStats,type GuruStats } from '@/lib/api/teachers';
import { getSessionUser } from '@/lib/session';
import { examTypeLabel } from '@/lib/exam-types';
import { linkifyText } from '@/lib/text-format';
import { REFRESH_INTERVAL,useAutoRefresh } from '@/lib/useAutoRefresh';
import { useMemoryState } from '@/lib/useMemoryState';
import { motion } from 'framer-motion';
import {
Activity,
AlertCircle,
ArrowRight,
BookOpen,CheckCircle2,
ChevronRight,
ClipboardCheck,
Clock,
Eye,
Layers,
Users
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback,useEffect,useState } from 'react';
import { RecentLoginsCard } from '../proktor/RecentLoginsCard';
import { TopScorersCard } from '../admin/TopScorersCard';

type LoggedInUser = RecentLogin & { lastLoginAt: string };
const hasLoginTime = (login: RecentLogin): login is LoggedInUser => typeof login.lastLoginAt === 'string';

export default function GuruDashboard() {
    const router = useRouter();
    const [org, setOrg] = useState<ProctorOrganization | null>(null);
    const [stats, setStats] = useMemoryState<GuruStats>('guru_stats', {
        totalMembers: 0,
        totalBanks: 0,
        ongoingExams: 0,
        draftExams: 0,
        finishedExams: 0
    });
    const [exams, setExams] = useMemoryState<OrganizationExam[]>('guru_dashboard_exams', []);
    const [logins, setLogins] = useMemoryState<LoggedInUser[]>('guru_logins', []);
    const [loading, setLoading] = useMemoryState('guru_loading', true);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [announcements, setAnnouncements] = useMemoryState<Announcement[]>('guru_announcements', []);
    const [showAnnouncementsPopup, setShowAnnouncementsPopup] = useState(false);
    const [showMembersModal, setShowMembersModal] = useState(false);
    const [membersList, setMembersList] = useState<LoggedInUser[]>([]);
    const [membersLoading, setMembersLoading] = useState(false);

    const loadData = useCallback(async () => {
        try {
            const user = await getSessionUser();

            const organization = user ? await getProctorOrganization() : null;

            if (!organization) {
                setErrorMsg('Sekolah belum dikonfigurasi. Silakan hubungi admin.');
                setLoading(false);
                return;
            }

            setOrg({ id: organization.id, name: organization.name });

            const [statData, examData, loginData, announcementConfig] = await Promise.all([
                getGuruOrganizationStats(),
                listOrganizationExams(),
                getRecentLogins(10),
                getSetting<Announcement | Announcement[]>('announcement_config'),
            ]);
            setStats(statData);
            // Guru cannot see ASAS/ASAT exams
            setExams(examData.filter((exam) => exam.exam_type !== 'pas' && exam.exam_type !== 'pat'));
            setLogins(loginData.filter(hasLoginTime));
            
            setAnnouncements(pickAnnouncements(announcementConfig, 'show_proktor'));
        } catch (error) {
            console.error('Load data error:', error);
            setErrorMsg(getErrorMessage(error) || 'Terjadi kesalahan saat memuat data');
        } finally {
            setLoading(false);
        }
    }, [setAnnouncements, setExams, setLoading, setLogins, setStats]);

    useAutoRefresh(loadData, REFRESH_INTERVAL.dashboard);

    useEffect(() => {
        const timer = window.setTimeout(() => void loadData(), 0);
        return () => window.clearTimeout(timer);
    }, [loadData]);


    const openMembers = async () => {
        if (!org?.id) return;
        setShowMembersModal(true);
        setMembersLoading(true);
        try {
            const all = await getRecentLogins(500);
            setMembersList(all.filter(hasLoginTime));
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
            gradient: 'from-[#3083FF] to-[#2563EB]',
            iconBg: 'bg-[#3083FF]/10',
            iconColor: 'text-[#3083FF]',
            borderColor: 'border-[#3083FF]/40',
            valueColor: 'text-[#3083FF]',
            description: 'Guru & Siswa aktif',
            onClick: openMembers,
        },
        {
            label: 'Bank Soal Anda',
            value: stats.totalBanks,
            icon: BookOpen,
            gradient: 'from-[#3083FF] to-[#3083FF]',
            iconBg: 'bg-[#3083FF]/10',
            iconColor: 'text-[#3083FF]',
            borderColor: 'border-[#3083FF]/40',
            valueColor: 'text-[#3083FF]',
            description: 'Koleksi bank soal Anda',
            onClick: () => router.push('/dashboard/guru/questions'),
        },
        {
            label: 'Ujian Mendatang',
            value: stats.draftExams,
            icon: Layers,
            gradient: 'from-[#3083FF] to-[#2563EB]',
            iconBg: 'bg-[#3083FF]/10',
            iconColor: 'text-[#3083FF]',
            borderColor: 'border-[#3083FF]/40',
            valueColor: 'text-[#3083FF]',
            description: 'Ujian terjadwal',
            onClick: () => router.push('/dashboard/guru/exams'),
        },
        {
            label: 'Ujian Aktif',
            value: stats.ongoingExams,
            icon: Clock,
            gradient: 'from-[#3083FF] to-[#3083FF]',
            iconBg: 'bg-[#3083FF]/10',
            iconColor: 'text-[#3083FF]',
            borderColor: 'border-[#3083FF]/40',
            valueColor: 'text-[#3083FF]',
            description: 'Sedang berlangsung',
            onClick: () => router.push('/dashboard/guru/exams'),
        },
        {
            label: 'Selesai',
            value: stats.finishedExams,
            icon: CheckCircle2,
            gradient: 'from-[#3083FF] to-[#1D4ED8]',
            iconBg: 'bg-[#3083FF]/10',
            iconColor: 'text-[#3083FF]',
            borderColor: 'border-[#3083FF]/40',
            valueColor: 'text-[#3083FF]',
            description: 'Telah selesai dikerjakan',
            onClick: () => router.push('/dashboard/guru/exams'),
        },
    ];

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-[60vh]">
                <Spinner variant="buble" size={32} />
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

            {/* ── Hero Header ── */}
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
                        className="group relative bg-white rounded-lg px-4 py-4 border border-[#3083FF]/20 hover:border-[#3083FF] hover:shadow-lg hover:shadow-[#3083FF]/10 transition-all duration-300 cursor-pointer overflow-hidden text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3083FF] focus-visible:ring-offset-2"
                    >
                        <div className={`absolute top-0 left-0 right-0 h-1 bg-gradient-to-r ${item.gradient} opacity-0 group-hover:opacity-100 transition-opacity duration-300`} />
                        <ChevronRight size={14} className="absolute top-2.5 right-2.5 text-[#3083FF]/0 group-hover:text-[#3083FF]/40 transition-colors duration-300" />

                        <div className="relative flex flex-col items-center">
                            <div className="flex items-center gap-2 mb-3">
                                <div className={`w-8 h-8 ${item.iconBg} rounded-lg flex items-center justify-center ${item.borderColor} group-hover:scale-110 transition-transform duration-300`}>
                                    <item.icon size={16} className={item.iconColor} />
                                </div>
                                <p className="text-sm font-semibold text-slate-700">{item.label}</p>
                            </div>
                            <div className="space-y-0.5">
                                <p className={`text-3xl font-extrabold ${item.valueColor} leading-none tabular-nums tracking-tight`}>{(item.value ?? 0).toLocaleString('id-ID')}</p>
                                <p className="text-xs text-slate-400">{item.description}</p>
                            </div>
                        </div>
                    </motion.div>
                ))}
            </div>

            {/* ── Layout: Daftar Ujian (Kiri) dan Nilai Tertinggi & Informasi (Kanan) ── */}
            <div className="grid grid-cols-1 md:grid-cols-5 gap-4">

                {/* ── Left: Daftar Ujian ── */}
                <div className="md:col-span-3 bg-white rounded-lg border border-[#3083FF]/30 overflow-hidden shadow-sm">
                    <div className="px-6 py-4 border-b border-[#3083FF]/20 bg-gradient-to-r from-[#3083FF]/[.02] to-transparent">
                        <div>
                            <h2 className="text-base font-bold text-slate-900">Daftar Ujian</h2>
                            <p className="text-xs text-slate-400 mt-0.5">{exams.length} total ujian</p>
                        </div>
                    </div>

                    {exams.length > 0 ? (
                        <div className="divide-y divide-slate-100">
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
                                        onClick={() => router.push('/dashboard/guru/monitoring?exam=' + exam.id)}
                                    >
                                        <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 transition-all ${
                                            isOngoing
                                                ? 'bg-[#3083FF]/10 group-hover:bg-[#3083FF]/15'
                                                : isPublished
                                                ? 'bg-[#3083FF]/10 group-hover:bg-[#3083FF]/15'
                                                : 'bg-slate-50 group-hover:bg-slate-100'
                                        }`}>
                                            <ClipboardCheck size={18} className={
                                                isOngoing ? 'text-[#3083FF]'
                                                : isPublished ? 'text-[#3083FF]' : 'text-slate-400'
                                            } />
                                        </div>

                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-semibold text-slate-800 truncate group-hover:text-[#3083FF] transition-colors">{exam.title}</p>
                                            <div className="flex flex-wrap items-center gap-2 mt-1.5">
                                                <span className="text-[11px] font-medium text-slate-600 flex items-center gap-1 bg-slate-100 px-2 py-1 rounded-md">
                                                    <Clock size={12} />
                                                    {exam.duration_minutes} mnt
                                                </span>
                                                {exam.exam_type && exam.exam_type !== 'daily' && (
                                                    <span className="text-[10px] text-[#3083FF] font-bold bg-[#3083FF]/10 px-2 py-1 rounded-md">
                                                        {examTypeLabel(exam.exam_type)}
                                                    </span>
                                                )}
                                                {exam.start_time && (
                                                    <span className="text-[11px] font-medium text-slate-600 bg-slate-100 px-2 py-1 rounded-md whitespace-nowrap">
                                                        {new Date(exam.start_time).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })} • {new Date(exam.start_time).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}
                                                    </span>
                                                )}
                                            </div>
                                        </div>

                                        <div className="shrink-0 flex flex-col items-end justify-center">
                                            <div className="flex items-center gap-3">
                                                <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold border ${
                                                    isOngoing
                                                        ? 'bg-[#3083FF]/10 text-[#3083FF] border-[#3083FF]/30'
                                                        : isDraft
                                                        ? 'bg-red-50 text-red-600 border-red-200'
                                                        : isFinished
                                                        ? 'bg-emerald-100 text-emerald-700 border-emerald-200'
                                                        : 'bg-[#3083FF]/10 text-[#3083FF] border-[#3083FF]/20'
                                                }`}>
                                                    <span className={`w-1.5 h-1.5 rounded-full ${
                                                        isOngoing ? 'bg-[#3083FF] animate-pulse'
                                                        : isDraft ? 'bg-red-500'
                                                        : isFinished ? 'bg-emerald-500' : 'bg-[#3083FF]'
                                                    }`} />
                                                    {isOngoing ? 'Aktif' : isDraft ? 'Draft' : isFinished ? 'Selesai' : 'Terjadwal'}
                                                </span>
                                                <ArrowRight size={14} className="text-slate-300 group-hover:text-[#3083FF] group-hover:translate-x-0.5 transition-all" />
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
                            <div className="w-16 h-16 bg-[#3083FF]/5 rounded-2xl flex items-center justify-center mx-auto mb-4">
                                <Activity size={22} className="text-[#3083FF]/40" />
                            </div>
                            <p className="font-bold text-slate-700 mb-1 font-sans">Belum Ada Ujian</p>
                            <p className="text-xs text-slate-400 mb-4 font-semibold font-sans">Tanyakan ke Proktor atau koordinasikan jadwal ujian Anda</p>
                        </div>
                    )}
                </div>

                {/* ── Right: Informasi & Nilai Tertinggi per Ujian ── */}
                <div className="md:col-span-2 space-y-4">
                    {announcements.length > 0 && (
                        <div className="bg-white rounded-lg border border-blue-200 overflow-hidden shadow-sm">
                            <div className="px-5 py-4 border-b border-blue-100 bg-gradient-to-r from-blue-50 to-transparent flex justify-between items-center">
                                <h2 className="text-sm font-bold text-[#3083FF] flex items-center gap-2">
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
                                                <h3 className="font-semibold text-[#3083FF] text-xs line-clamp-1">{ann.title}</h3>
                                                {ann.created_at && (
                                                    <span className="text-[9px] text-slate-400 shrink-0 whitespace-nowrap">
                                                        {new Date(ann.created_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })}
                                                    </span>
                                                )}
                                            </div>
                                            <p className="text-[11px] text-slate-600 line-clamp-2" dangerouslySetInnerHTML={{ __html: linkifyText(ann.content || '') }}></p>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}

                    <TopScorersCard monitoringBasePath="/dashboard/guru/monitoring" />
                </div>
            </div>

            {/* ── Aktivitas Login Pengguna (di bagian bawah) ── */}
            <div className="mt-4">
                <RecentLoginsCard initialLogins={logins} />
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
                                <h2 className="text-lg font-bold text-[#3083FF] flex items-center gap-2">
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
                                                <h3 className="font-bold text-[#3083FF] text-sm">{ann.title}</h3>
                                                {ann.created_at && (
                                                    <span className="text-xs text-slate-400 shrink-0 bg-slate-50 px-2 py-1 rounded-md border border-slate-100">
                                                        {new Date(ann.created_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                                    </span>
                                                )}
                                            </div>
                                            <p className="text-sm text-slate-600 whitespace-pre-wrap leading-relaxed" dangerouslySetInnerHTML={{ __html: linkifyText(ann.content || '', 'text-blue-600 underline font-semibold hover:text-blue-800 transition-colors') }}></p>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                        <div className="p-4 border-t border-slate-100 bg-white flex justify-end">
                            <button 
                                onClick={() => setShowAnnouncementsPopup(false)}
                                className="px-5 py-2.5 bg-[#3083FF] text-white text-sm font-semibold rounded-xl hover:bg-[#0a1a6e] transition-colors"
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
                                <h2 className="text-lg font-bold text-[#3083FF] flex items-center gap-2">
                                    <Users size={20} className="text-[#3083FF]" /> Anggota Pernah Login
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
                                    <Spinner variant="buble" size={32} />
                                </div>
                            ) : membersList.length === 0 ? (
                                <div className="py-12 text-center text-sm text-slate-400">Belum ada anggota yang login.</div>
                            ) : (
                                <div className="space-y-2">
                                    {membersList.map((m) => (
                                        <div key={m.id} className="flex items-center gap-3 bg-white border border-slate-100 rounded-xl p-3">
                                            <div className="w-9 h-9 rounded-full bg-[#3083FF]/10 text-[#3083FF] flex items-center justify-center font-bold shrink-0 uppercase">
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
