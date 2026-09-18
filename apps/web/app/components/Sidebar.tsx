"use client";
import React, { useMemo, memo } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
    LayoutDashboard,
    Users,
    Settings,
    ClipboardCheck,
    BarChart3,
    GraduationCap,
    LogOut,
    BookOpen,
    Eye,
    Activity,
    Calendar,
    Globe,
    ChevronLeft,
    ChevronRight,
    ChevronDown,
    School,
    TrendingUp,
    Bell,
    Search,
    CheckCircle,
    ShieldCheck,
    CreditCard,
    ArrowLeft,
    Wrench,
    Sun,
    Moon,
} from 'lucide-react';

const ACCA_URL = process.env.NEXT_PUBLIC_ACCA_URL || 'https://acca.icgowa.sch.id';

import { getSessionUser } from '@/lib/session';
import { useRouter } from 'next/navigation';
import { getUserRole, type Role } from '@/lib/rbac';
import { getAccountProfile } from '@/lib/api/account';
import { getSetting, type AppConfig } from '@/lib/api/settings';
import { clearMemoryCache } from '@/lib/useMemoryState';

interface SidebarItemProps {
    icon: React.ElementType;
    label: string;
    href: string;
    isActive: boolean;
    isCollapsed: boolean;
    badge?: string | number;
}

const SidebarItem = memo(({ icon: Icon, label, href, isActive, isCollapsed, badge }: SidebarItemProps) => (
    <Link href={href} className="block group relative">
        <motion.div
            whileHover={{ scale: isCollapsed ? 1.05 : 1, x: isCollapsed ? 0 : 2 }}
            whileTap={{ scale: 0.98 }}
            className={`flex items-center rounded-xl transition-all duration-200 ${
                isCollapsed ? 'w-12 h-12 justify-center mx-auto' : 'gap-3 px-4 py-3'
            } ${
                isActive
                    ? 'bg-[#0038A8] text-white shadow-lg shadow-[#0038A8]/25 ml-1'
                    : 'text-slate-500 hover:bg-slate-100 hover:text-[#0038A8]'
            }`}
        >
            <Icon size={18} strokeWidth={isActive ? 2.5 : 2} />
            {!isCollapsed && (
                <span className={`text-sm font-semibold tracking-wide font-sans ${isActive ? 'text-white' : ''}`}>
                    {label}
                </span>
            )}
            {!isCollapsed && badge !== undefined && (
                <span className="ml-auto text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-accent text-white">
                    {badge}
                </span>
            )}
            {isActive && (
                <motion.div
                    layoutId="active-dot"
                    className={`${isCollapsed ? 'absolute top-1.5 right-1.5' : 'ml-auto'} w-1.5 h-1.5 bg-accent rounded-full`}
                />
            )}
        </motion.div>

        {isCollapsed && (
            <div className="absolute left-[calc(100%+16px)] top-1/2 -translate-y-1/2 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto transition-all duration-200 bg-slate-900 text-white text-xs font-semibold px-3 py-2 rounded-lg shadow-xl whitespace-nowrap z-[100] flex items-center gap-1.5 font-sans">
                <span>{label}</span>
                {badge !== undefined && (
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-accent text-white">
                        {badge}
                    </span>
                )}
                {/* Add a tiny triangle pointer */}
                <div className="absolute top-1/2 right-full -translate-y-1/2 border-y-4 border-y-transparent border-r-4 border-r-slate-900" />
            </div>
        )}
    </Link>
));
SidebarItem.displayName = 'SidebarItem';

const SidebarSubItem = memo(({
    label,
    href,
    isActive,
    isCollapsed,
    isFloating
}: {
    label: string;
    href: string;
    isActive: boolean;
    isCollapsed: boolean;
    isFloating?: boolean;
}) => (
    <Link href={href} className="block group relative">
        <div className={`flex items-center gap-3 px-4 py-2.5 ${isFloating ? 'pl-4' : 'pl-10'} rounded-xl text-sm transition-all duration-200 ${
            isActive
                ? 'bg-[#0038A8]/10 text-[#0038A8] font-semibold shadow-sm'
                : 'text-slate-500 hover:bg-slate-100 hover:text-[#0038A8]'
        }`}>
            {isActive && !isFloating && (
                <motion.div 
                    layoutId="active-sub-indicator"
                    className="absolute left-2 w-1 h-5 bg-[#0038A8] rounded-full" 
                />
            )}
            <span className={`text-sm font-semibold tracking-wide font-sans ${isActive ? 'text-[#0038A8]' : ''}`}>
                {label}
            </span>
        </div>
    </Link>
));
SidebarSubItem.displayName = 'SidebarSubItem';

// Dropdown group (Settings)
const SidebarGroup = ({
    icon: Icon,
    label,
    href,
    isActive,
    isCollapsed,
    children,
}: {
    icon: React.ElementType;
    label: string;
    href: string;
    isActive: boolean;
    isCollapsed: boolean;
    children: React.ReactNode;
}) => {
    const pathname = usePathname();
    const isAnyChildActive = React.useMemo(() => {
        if (!Array.isArray(children)) return false;
        return (children as React.ReactElement<{ href?: string }>[]).some(
            (child) => child.props?.href && pathname.startsWith(child.props.href)
        );
    }, [pathname, children]);

    const [isExpanded, setIsExpanded] = React.useState(isAnyChildActive);

    const groupActive = pathname === href || pathname.startsWith(href + '/');

    if (isCollapsed) {
        return (
            <div className="relative group">
                <button
                    className={`w-12 h-12 flex items-center justify-center mx-auto rounded-xl transition-all duration-200 ${
                        groupActive || isAnyChildActive
                            ? 'bg-[#0038A8] text-white shadow-lg shadow-[#0038A8]/25'
                            : 'text-slate-500 hover:bg-slate-100 hover:text-[#0038A8]'
                    }`}
                >
                    <Icon size={18} strokeWidth={groupActive || isAnyChildActive ? 2.5 : 2} />
                    {/* Tiny indicator that there are submenus */}
                    <div className={`absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full ${
                        isAnyChildActive ? 'bg-accent' : 'bg-slate-300'
                    }`} />
                </button>

                {/* Floating Submenu Dropdown */}
                <div className="absolute left-[calc(100%+16px)] top-0 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto transition-all duration-200 bg-white border border-slate-200 shadow-xl rounded-2xl p-2.5 min-w-[180px] z-[110] flex flex-col gap-1">
                    {/* Header */}
                    <div className="px-3 py-1.5 text-[10px] font-bold text-slate-400 border-b border-slate-100 mb-1 tracking-widest uppercase font-heading">
                        {label}
                    </div>
                    {/* Children items */}
                    {React.Children.map(children, (child) => {
                        if (React.isValidElement(child)) {
                            return React.cloneElement(child as React.ReactElement<any>, { isCollapsed: true, isFloating: true });
                        }
                        return child;
                    })}
                    {/* Little triangle arrow pointing to the icon */}
                    <div className="absolute top-4 right-full border-y-[6px] border-y-transparent border-r-[6px] border-r-white drop-shadow-[-1px_0_1px_rgba(0,0,0,0.03)]" />
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-1">
            <button
                onClick={() => setIsExpanded(!isExpanded)}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${
                    groupActive
                        ? 'bg-[#0038A8] text-white shadow-lg shadow-[#0038A8]/25'
                        : isAnyChildActive
                        ? 'bg-slate-100 text-[#0038A8]'
                        : 'text-slate-500 hover:bg-slate-100 hover:text-[#0038A8]'
                }`}
            >
                <Icon size={18} strokeWidth={2} />
                <span className="text-sm font-semibold flex-1 text-left tracking-wide font-sans">{label}</span>
                <ChevronDown
                    size={14}
                    className={`transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
                />
            </button>
            {isExpanded && (
                <div className="ml-2 pl-2 mt-1.5 border-l border-slate-100 space-y-1">
                    {children}
                </div>
            )}
        </div>
    );
};

interface SidebarProps {
    isCollapsed: boolean;
    setIsCollapsed: (v: boolean) => void;
    isOpen?: boolean;
    setIsOpen?: (v: boolean) => void;
    availableRoles?: Array<{ role: Role; orgId: string; orgName: string }>;
    activeRole?: { role: Role; orgId: string; orgName: string } | null;
    onRoleSwitch?: (ctx: { role: Role; orgId: string; orgName: string }) => void;
}

const Sidebar = ({ isCollapsed, setIsCollapsed, isOpen, setIsOpen, availableRoles = [], activeRole, onRoleSwitch }: SidebarProps) => {
    const pathname = usePathname();
    const router = useRouter();

    const [darkMode, setDarkMode] = React.useState(false);

    React.useEffect(() => {
        // Sync local state with document class
        const isDark = document.documentElement.classList.contains("dark") || localStorage.getItem("theme") === "dark";
        setDarkMode(isDark);
    }, []);

    const toggleDarkMode = () => {
        const nextDark = !darkMode;
        setDarkMode(nextDark);
        if (nextDark) {
            document.documentElement.classList.add("dark");
            localStorage.setItem("theme", "dark");
        } else {
            document.documentElement.classList.remove("dark");
            localStorage.setItem("theme", "light");
        }
        window.dispatchEvent(new Event("theme-changed"));
    };

    const [userData, setUserData] = React.useState<any>(null);
    const [dbUserRole, setDbUserRole] = React.useState<string | null>(null);
    const [orgData, setOrgData] = React.useState<any>(null);

    // Global Identity settings
    const [appTitle, setAppTitle] = React.useState('ACCA CBT');
    const [appSubtitle, setAppSubtitle] = React.useState('MAN IC Gowa');

    const loadUserInfo = async () => {
        const [user, appConfig] = await Promise.all([
            getSessionUser(),
            getSetting<AppConfig>('app_config')
        ]);

        if (appConfig?.app_short_name) setAppTitle(appConfig.app_short_name);
        else if (appConfig?.app_name) setAppTitle(appConfig.app_name);
        if (appConfig?.app_subtitle) setAppSubtitle(appConfig.app_subtitle);

        if (!user) return;

        // Profil, sekolah, dan peran datang dari NestJS dalam satu permintaan.
        // Sebelumnya bilah sisi menanyakannya sendiri ke `cbt_profiles` dan
        // `cbt_organization_members` dari BROWSER.
        const [{ profile, organization }, role] = await Promise.all([
            getAccountProfile(),
            getUserRole(),
        ]);

        setUserData({ ...user, profile });
        if (role) setDbUserRole(role);
        if (organization) setOrgData(organization);
    };

    // Load once on mount + refresh when profile is updated
    React.useEffect(() => {
        loadUserInfo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    React.useEffect(() => {
        const handler = () => loadUserInfo();
        window.addEventListener('profile-updated', handler);
        window.addEventListener('branding-updated', handler);
        return () => {
            window.removeEventListener('profile-updated', handler);
            window.removeEventListener('branding-updated', handler);
        };
    }, []);

    React.useEffect(() => {
        if (setIsOpen) setIsOpen(false);
    }, [pathname]);
    
    const getRole = (): Role => {
        // Priority 1: activeRole prop from layout (user explicitly picked a role
        // from the dropdown). This is the AUTHORITATIVE source once a choice
        // has been made — otherwise switching roles would not update the menu.
        if (activeRole?.role && activeRole.role !== 'None') {
            return activeRole.role;
        }
        // Priority 2: URL pathname is the initial landing hint
        if (pathname.includes('/admin')) return 'Admin';
        if (pathname.includes('/proktor')) return 'Proktor';
        if (pathname.includes('/guru')) return 'Guru';
        if (pathname.includes('/siswa')) return 'Siswa';
        if (pathname.includes('/pengawas')) return 'Pengawas';
        // Priority 4: Fallback to database role
        return (dbUserRole as Role) || 'User';
    };

    const role = getRole();

    const menuConfig = useMemo(() => ({
        'Superadmin': [
            { icon: LayoutDashboard, label: 'Dashboard', href: '/dashboard/admin' },
            { icon: Users, label: 'Kelas', href: '/dashboard/admin/classes' },
            { icon: BookOpen, label: 'Bank Soal', href: '/dashboard/admin/questions' },
            { icon: ClipboardCheck, label: 'Ujian', href: '/dashboard/admin/exams' },
            { icon: Activity, label: 'Monitoring', href: '/dashboard/admin/monitoring' },
            { icon: Settings, label: 'Backup Data', href: '/dashboard/admin/backup' },
        ],
        'Admin': [
            { icon: LayoutDashboard, label: 'Dashboard', href: '/dashboard/admin' },
            { icon: Users, label: 'Kelas', href: '/dashboard/admin/classes' },
            { icon: BookOpen, label: 'Bank Soal', href: '/dashboard/admin/questions' },
            { icon: ClipboardCheck, label: 'Ujian', href: '/dashboard/admin/exams' },
            { icon: Activity, label: 'Monitoring', href: '/dashboard/admin/monitoring' },
            { icon: Settings, label: 'Backup Data', href: '/dashboard/admin/backup' },
        ],
        'Proktor': [
            { icon: LayoutDashboard, label: 'Dashboard', href: '/dashboard/proktor' },
            { icon: Users, label: 'Kelas', href: '/dashboard/proktor/classes' },
            { icon: BookOpen, label: 'Bank Soal', href: '/dashboard/proktor/questions' },
            { icon: ClipboardCheck, label: 'Ujian', href: '/dashboard/proktor/exams' },
            { icon: Activity, label: 'Monitoring', href: '/dashboard/proktor/monitoring' },
        ],
        'Guru': [
            { icon: LayoutDashboard, label: 'Dashboard', href: '/dashboard/guru' },
            { icon: Bell, label: 'Notifikasi', href: '/dashboard/notifications' },
            { icon: Users, label: 'Kelas', href: '/dashboard/guru/classes' },
            { icon: BookOpen, label: 'Bank Soal', href: '/dashboard/guru/questions' },
            { icon: ClipboardCheck, label: 'Ujian', href: '/dashboard/guru/exams' },
            { icon: Activity, label: 'Monitoring', href: '/dashboard/guru/monitoring' },
        ],
        'Siswa': [
            { icon: LayoutDashboard, label: 'Dashboard', href: '/dashboard/siswa' },
            { icon: Bell, label: 'Notifikasi', href: '/dashboard/notifications' },
            { icon: Users, label: 'Kelas', href: '/dashboard/siswa/classes' },
            { icon: Calendar, label: 'Jadwal', href: '/dashboard/siswa/schedule' },
            { icon: BarChart3, label: 'Hasil', href: '/dashboard/siswa/results' },
            { icon: TrendingUp, label: 'Analisis', href: '/dashboard/siswa/analytics' },
        ],
        'Pengawas': [
            { icon: LayoutDashboard, label: 'Dashboard', href: '/dashboard/pengawas' },
            { icon: Bell, label: 'Notifikasi', href: '/dashboard/notifications' },
            { icon: Eye, label: 'Monitoring', href: '/dashboard/pengawas/monitoring' },
        ],
    }), []);

    const menuItems = useMemo(() => {
        // Always show only the active role's menu — even when multiple roles are available,
        // the user picks one active role and the sidebar should show only that role's menu.
        const activeRoleName = activeRole?.role ?? role;
        const roleItems = (menuConfig as Record<string, any>)[activeRoleName] || [];
        const seen = new Set<string>();
        return (Array.isArray(roleItems) ? roleItems : []).filter((item: any) => {
            if (item._isGroup) return !seen.has(item.label) && (seen.add(item.label), true);
            if (seen.has(item.label)) return false;
            seen.add(item.label);
            return true;
        });
    }, [menuConfig, role, activeRole]);

    const renderMenuItem = (item: any, index: number) => {
        if (item._isGroup) {
            return (
                <SidebarGroup
                    key={item.label + index}
                    icon={item.icon}
                    label={item.label}
                    href={item.href}
                    isActive={pathname.startsWith(item.href)}
                    isCollapsed={isCollapsed}
                >
                    {(item.children as any[]).map((child, ci) => (
                        <SidebarSubItem
                            key={child.label + ci}
                            label={child.label}
                            href={child.href}
                            isActive={pathname === child.href || pathname.startsWith(child.href + '/')}
                            isCollapsed={isCollapsed}
                        />
                    ))}
                </SidebarGroup>
            );
        }
        return (
            <SidebarItem
                key={item.label + index}
                icon={item.icon}
                label={item.label}
                href={item.href}
                isActive={pathname === item.href}
                isCollapsed={isCollapsed}
            />
        );
    };

    return (
        <>
            <AnimatePresence>
                {isOpen && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={() => setIsOpen && setIsOpen(false)}
                        className="fixed inset-0 bg-black/60 z-40 lg:hidden"
                    />
                )}
            </AnimatePresence>

            <motion.aside
                initial={false}
                animate={{ width: isCollapsed ? 110 : 280 }}
                transition={{ type: "spring", stiffness: 300, damping: 30 }}
                className={`print:hidden fixed left-0 top-0 h-screen bg-white dark:bg-[#0d1221] border-r border-slate-200 dark:border-white/10 z-50 flex flex-col transition-all duration-200 ${
                    isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
                }`}
            >
                {/* Floating Toggle Button on Border */}
                <button
                    type="button"
                    onClick={() => setIsCollapsed(!isCollapsed)}
                    className="hidden lg:flex items-center justify-center absolute -right-3 top-6 z-[60] w-6 h-6 bg-white dark:bg-[#121826] border border-slate-200 dark:border-slate-800 rounded-full shadow-md hover:bg-slate-50 dark:hover:bg-slate-800 hover:text-[#0038A8] active:scale-95 transition-all duration-200 text-slate-500 dark:text-slate-400 cursor-pointer"
                    title={isCollapsed ? "Buka Sidebar" : "Tutup Sidebar"}
                >
                  {isCollapsed ? (
                    <ChevronRight size={14} strokeWidth={2.5} />
                  ) : (
                    <ChevronLeft size={14} strokeWidth={2.5} />
                  )}
                </button>

                {/* Header */}
                <div className="px-4 py-6 border-b border-slate-100 dark:border-slate-800/40 bg-slate-50/30 dark:bg-slate-900/10">
                    <div className="flex items-center justify-center">
                        <div className="flex items-center justify-center gap-3.5">
                            {orgData && orgData.logo_url && orgData.logo_url !== 'default' ? (
                                <Image src={orgData.logo_url} alt="Logo" width={isCollapsed ? 36 : 42} height={isCollapsed ? 36 : 42} className="object-contain rounded-xl shadow-sm" unoptimized />
                            ) : (
                                <div className="relative group/logo drop-shadow-sm">
                                    <div className="absolute inset-0 bg-blue-400/20 rounded-full blur-md opacity-0 group-hover/logo:opacity-100 transition-opacity duration-500"></div>
                                    <Image src="/logo-icon.png" alt="Logo" width={isCollapsed ? 36 : 42} height={isCollapsed ? 36 : 42} className="relative z-10" />
                                </div>
                            )}
                            {!isCollapsed && (
                                <div className="min-w-0 flex flex-col justify-center">
                                    <h1 className="text-[1.2rem] font-heading font-black truncate max-w-[160px] tracking-[0.15em] leading-none pb-0.5 uppercase bg-gradient-to-br from-[#0038A8] to-[#c2185b] bg-clip-text text-transparent" title={orgData && orgData.logo_url && orgData.logo_url !== 'default' ? orgData.name : appTitle}>
                                        {orgData && orgData.logo_url && orgData.logo_url !== 'default' ? orgData.name : appTitle}
                                    </h1>
                                    <p className="text-[10px] font-bold text-slate-400/90 uppercase tracking-[0.2em] mt-1">
                                        {orgData && orgData.logo_url && orgData.logo_url !== 'default' ? 'CBT Portal' : appSubtitle}
                                    </p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Navigation */}
                <nav className={`flex-1 ${isCollapsed ? 'overflow-visible px-3' : 'overflow-y-auto pl-6 pr-3'} pt-2 space-y-1`}>
                    {menuItems.map((item: any, index: number) => renderMenuItem(item, index))}

                    {/* Profile & Logout */}
                    <div className="pt-5 mt-5 mb-2 border-t border-slate-100/80">
                        {/* Role Switcher has been removed based on configuration */}

                        <div className={`flex ${isCollapsed ? 'flex-col items-center gap-3' : 'items-center gap-3'}`}>
                            <div className="block shrink-0 relative group">
                                <motion.div
                                    whileHover={{ scale: 1.05 }}
                                    whileTap={{ scale: 0.95 }}
                                    className={`${isCollapsed ? 'w-12 h-12' : 'w-10 h-10'} rounded-xl overflow-hidden bg-primary flex items-center justify-center text-white font-bold shadow-md ring-2 ring-white dark:ring-slate-800`}
                                >
                                    {userData?.user_metadata?.avatar_url || userData?.profile?.avatar_url ? (
                                        <Image
                                            src={userData?.user_metadata?.avatar_url || userData?.profile?.avatar_url}
                                            alt="Profil"
                                            fill
                                            className="object-cover"
                                            unoptimized
                                            onError={(e) => {
                                                (e.target as HTMLImageElement).style.display = 'none';
                                            }}
                                        />
                                    ) : (
                                        <span className="text-base font-bold">{(role || 'U')[0]}</span>
                                    )}
                                </motion.div>

                                {isCollapsed && (
                                    <div className="absolute left-[calc(100%+16px)] top-1/2 -translate-y-1/2 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto transition-all duration-200 bg-slate-900 text-white text-[11px] font-semibold px-3 py-2 rounded-lg shadow-xl whitespace-nowrap z-[100] font-sans">
                                        <span>Profil</span>
                                        <div className="absolute top-1/2 right-full -translate-y-1/2 border-y-4 border-y-transparent border-r-4 border-r-slate-900" />
                                    </div>
                                )}
                            </div>

                            <div className={`flex ${isCollapsed ? 'flex-col items-center gap-1.5 w-full' : 'items-center gap-1.5 flex-1'}`}>
                                <a
                                    href={ACCA_URL}
                                    title="Kembali ke ACCA"
                                    className={`relative group/btn flex items-center justify-center gap-0.5 border-[1.5px] border-[#0038A8] rounded-xl bg-[#0038A8]/5 dark:bg-blue-500/10 text-[#0038A8] dark:text-blue-400 hover:bg-[#0038A8] hover:text-white hover:shadow-md transition-all duration-200 ${
                                        isCollapsed ? 'w-10 h-10' : 'px-2 py-1.5 text-[10px] font-extrabold whitespace-nowrap'
                                    }`}
                                >
                                    <ArrowLeft size={13} strokeWidth={2.5} />
                                    {!isCollapsed && <span>ACCA</span>}

                                    {isCollapsed && (
                                        <div className="absolute left-[calc(100%+16px)] top-1/2 -translate-y-1/2 opacity-0 pointer-events-none group-hover/btn:opacity-100 group-hover/btn:pointer-events-auto transition-all duration-200 bg-slate-900 text-white text-[11px] font-semibold px-3 py-2 rounded-lg shadow-xl whitespace-nowrap z-[100] font-sans">
                                            <span>Kembali ke ACCA</span>
                                            <div className="absolute top-1/2 right-full -translate-y-1/2 border-y-4 border-y-transparent border-r-4 border-r-slate-900" />
                                        </div>
                                    )}
                                </a>
                                <a
                                    href={`${ACCA_URL}/api/sso/tools`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    title="Buka ACCA TOOLS"
                                    className={`relative group/btn flex items-center justify-center gap-0.5 border-[1.5px] border-[#0038A8] rounded-xl bg-[#0038A8]/5 dark:bg-blue-500/10 text-[#0038A8] dark:text-blue-400 hover:bg-[#0038A8] hover:text-white hover:shadow-md transition-all duration-200 ${
                                        isCollapsed ? 'w-10 h-10' : 'px-2 py-1.5 text-[10px] font-extrabold whitespace-nowrap'
                                    }`}
                                >
                                    <Wrench size={13} strokeWidth={2.5} />
                                    {!isCollapsed && <span>TOOLS</span>}

                                    {isCollapsed && (
                                        <div className="absolute left-[calc(100%+16px)] top-1/2 -translate-y-1/2 opacity-0 pointer-events-none group-hover/btn:opacity-100 group-hover/btn:pointer-events-auto transition-all duration-200 bg-slate-900 text-white text-[11px] font-semibold px-3 py-2 rounded-lg shadow-xl whitespace-nowrap z-[100] font-sans">
                                            <span>Buka ACCA TOOLS</span>
                                            <div className="absolute top-1/2 right-full -translate-y-1/2 border-y-4 border-y-transparent border-r-4 border-r-slate-900" />
                                        </div>
                                    )}
                                </a>
                                <button
                                    type="button"
                                    onClick={toggleDarkMode}
                                    title={darkMode ? "Mode Terang" : "Mode Gelap"}
                                    className={`relative group/btn flex items-center justify-center border-[1.5px] border-[#0038A8]/40 dark:border-blue-500/40 rounded-xl bg-[#0038A8]/5 dark:bg-blue-500/10 text-[#0038A8] dark:text-blue-400 hover:bg-[#0038A8] hover:text-white dark:hover:bg-blue-600 hover:shadow-md transition-all duration-200 ${
                                        isCollapsed ? 'w-10 h-10' : 'w-8.5 h-8.5'
                                    } shrink-0 cursor-pointer`}
                                >
                                    {darkMode ? <Sun size={13} strokeWidth={2.5} /> : <Moon size={13} strokeWidth={2.5} />}

                                    {isCollapsed && (
                                        <div className="absolute left-[calc(100%+16px)] top-1/2 -translate-y-1/2 opacity-0 pointer-events-none group-hover/btn:opacity-100 group-hover/btn:pointer-events-auto transition-all duration-200 bg-slate-900 text-white text-[11px] font-semibold px-3 py-2 rounded-lg shadow-xl whitespace-nowrap z-[100] font-sans">
                                            <span>{darkMode ? "Mode Terang" : "Mode Gelap"}</span>
                                            <div className="absolute top-1/2 right-full -translate-y-1/2 border-y-4 border-y-transparent border-r-4 border-r-slate-900" />
                                        </div>
                                    )}
                                </button>
                            </div>
                        </div>
                    </div>
                </nav>
            </motion.aside>
        </>
    );
};

export default Sidebar;