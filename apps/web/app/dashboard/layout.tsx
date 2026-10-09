"use client";

import BottomNav from '@/app/components/BottomNav';
import DashboardLoading from '@/app/components/DashboardLoading';
import Header, { type HeaderUser } from '@/app/components/Header';
import Sidebar from '@/app/components/Sidebar';
import { getAccountProfile } from '@/lib/api/account';
import { getSetting, type AppConfig } from '@/lib/api/settings';
import {
    getActiveRoleFromStorage,
    getRoleFromPath,
    getUserRoleContexts,
    isActiveRoleLocked,
    isRoleQualifiedFromList,
    resolveActiveRole,
    ROLE_TO_DASHBOARD_PATH,
    setActiveRoleInStorage,
    unlockActiveRole,
    type DashboardRole,
    type UserRoleContext,
} from '@/lib/rbac';
import { getSessionUser } from '@/lib/session';
import { applyThemeColor } from '@/lib/theme-color';
import { clearMemoryCacheByPrefix } from '@/lib/useMemoryState';
import { usePathname, useRouter } from 'next/navigation';
import React, { useEffect, useMemo, useRef, useState } from 'react';

interface ExtendedUser {
    nama?: string;
    nip?: string;
    roles?: string[];
    photoUrl?: string;
    avatar_url?: string;
    user_metadata?: { avatar_url?: string };
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
    const router = useRouter();
    const pathname = usePathname();
    const [authChecked, setAuthChecked] = useState(false);
    const [authError, setAuthError] = useState<string | null>(null);
    const [activeRoleCtx, setActiveRoleCtx] = useState<UserRoleContext | null>(null);
    const [isCollapsed, setIsCollapsed] = useState(false);
    const [mobileOpen, setMobileOpen] = useState(false);
    const [currentUser, setCurrentUser] = useState<HeaderUser | null>(null);
    const [appSubtitle, setAppSubtitle] = useState('MAN IC Gowa');
    const lastResolvedPath = useRef<string | null>(null);
    const pathRoleRef = useRef<DashboardRole | null>(null);
    const scrollPosRef = useRef(0);

    // Warna chrome browser & simpan/kembalikan posisi scroll saat sidebar mobile buka/tutup
    useEffect(() => {
        applyThemeColor();
        if (mobileOpen) {
            scrollPosRef.current = window.scrollY || window.pageYOffset || 0;
        } else if (scrollPosRef.current > 0) {
            window.scrollTo(0, scrollPosRef.current);
        }
    }, [mobileOpen]);

    const pageTitle = useMemo(() => {
        if (pathname.includes('/learning')) return 'Bahan Ajar';
        if (pathname.includes('/validations')) return 'Validasi Soal';
        if (pathname.includes('/classes')) return 'Kelas';
        if (pathname.includes('/questions')) return 'Bank Soal';
        if (pathname.includes('/exams')) return 'Ujian';
        if (pathname.includes('/monitoring')) return 'Monitoring Ujian';
        if (pathname.includes('/backup')) return 'Backup Data';
        if (pathname.includes('/settings')) return 'Pengaturan Umum';
        if (pathname.includes('/schedule')) return 'Jadwal Ujian';
        if (pathname.includes('/results')) return 'Hasil Ujian';
        if (pathname.includes('/analytics')) return 'Analisis Siswa';
        if (pathname.includes('/notifications')) return 'Notifikasi';
        if (
            pathname === '/dashboard/admin' ||
            pathname === '/dashboard/proktor' ||
            pathname === '/dashboard/guru' ||
            pathname === '/dashboard/siswa' ||
            pathname === '/dashboard/pengawas' ||
            pathname === '/dashboard'
        ) {
            return 'Dashboard';
        }
        const lastSeg = pathname.split('/').filter(Boolean).pop() || '';
        return lastSeg ? lastSeg.charAt(0).toUpperCase() + lastSeg.slice(1) : 'Dashboard';
    }, [pathname]);

    useEffect(() => {
        let cancelled = false;

        const run = async () => {
            // Safety timeout: force show content after 8 seconds even if resolving fails.
            const safetyTimer = setTimeout(() => {
                if (!cancelled && !authChecked) {
                    console.warn('[DashboardLayout] safety timeout — forcing authChecked=true');
                    if (!activeRoleCtx) {
                        const fallbackRole = getActiveRoleFromStorage();
                        if (fallbackRole) {
                            setActiveRoleCtx({ role: fallbackRole });
                            setAuthChecked(true);
                        } else {
                            setAuthError('Pemeriksaan sesi terlalu lama. Periksa koneksi lalu coba lagi.');
                            setAuthChecked(true);
                        }
                    } else {
                        setAuthChecked(true);
                    }
                }
            }, 8000);

            try {
                const user = await getSessionUser();
                if (cancelled) return;

                if (!user) {
                    clearTimeout(safetyTimer);
                    setAuthError('Sesi Anda tidak tersedia atau sudah berakhir.');
                    setAuthChecked(true);
                    router.replace('/');
                    return;
                }

                // Load user profile & app config for Header
                try {
                    const [profileData, appConfig] = await Promise.all([
                        getAccountProfile().catch(() => null),
                        getSetting<AppConfig>('app_config').catch(() => null),
                    ]);
                    if (appConfig?.app_subtitle) setAppSubtitle(appConfig.app_subtitle);
                    const extUser = user as unknown as ExtendedUser;
                    setCurrentUser({
                        id: user.id,
                        nama: profileData?.profile?.full_name || extUser.nama || user.email,
                        email: user.email,
                        nip: profileData?.profile?.identity_number || extUser.nip,
                        roles: extUser.roles || [],
                        photoUrl: profileData?.profile?.avatar_url || extUser.photoUrl || extUser.avatar_url || extUser.user_metadata?.avatar_url,
                    });
                } catch (e) {
                    console.error('[DashboardLayout] profile load error:', e);
                }

                const pathRole = getRoleFromPath(pathname);
                pathRoleRef.current = pathRole;

                const { role } = await resolveActiveRole({ pathname });

                if (cancelled) return;

                const rolePrefixes = ['proktor', 'admin', 'guru', 'siswa', 'pengawas'];
                const keepPrefix = role.toLowerCase();
                const evictPrefixes = rolePrefixes.filter((p) => p !== keepPrefix);
                clearMemoryCacheByPrefix(evictPrefixes);

                const list = getUserRoleContexts(user.resolved);
                if (cancelled) return;

                if (
                    role !== 'None' &&
                    pathRole &&
                    pathRole !== role
                ) {
                    try {
                        const userQualifiedForPath = isRoleQualifiedFromList(list, pathRole);
                        if (!userQualifiedForPath) {
                            const target = ROLE_TO_DASHBOARD_PATH[role];
                            if (target && target !== pathname) {
                                router.replace(target);
                                clearTimeout(safetyTimer);
                                return;
                            }
                        }
                    } catch (e) {
                        console.error('[DashboardLayout] qualification check error:', e);
                    }
                    setActiveRoleInStorage(pathRole);
                }

                const stored = getActiveRoleFromStorage();
                if (!stored && pathRole && !isActiveRoleLocked()) {
                    setActiveRoleInStorage(pathRole);
                }

                const activeRole = pathRole && isRoleQualifiedFromList(list, pathRole)
                    ? pathRole
                    : role;
                const candidates = list.filter(c => c.role === activeRole);
                let active: UserRoleContext | undefined = candidates[0];
                if (!active) active = list[0] ?? { role: activeRole };

                setActiveRoleCtx(active);
                setAuthError(null);
                setAuthChecked(true);
                clearTimeout(safetyTimer);
                lastResolvedPath.current = pathname;
            } catch (err) {
                console.error('[DashboardLayout] Fatal error in role resolution:', err);
                clearTimeout(safetyTimer);
                if (!cancelled) {
                    setAuthError('Akun dan peran tidak dapat dimuat. Periksa koneksi lalu coba lagi.');
                    setAuthChecked(true);
                }
            }
        };

        run();

        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pathname]);

    useEffect(() => {
        const onSignOut = () => unlockActiveRole();
        window.addEventListener('acca:signout', onSignOut);
        return () => window.removeEventListener('acca:signout', onSignOut);
    }, []);

    useEffect(() => {
        const resetNavigation = window.setTimeout(() => {
            setMobileOpen(false);
            scrollPosRef.current = 0;
        }, 0);
        return () => window.clearTimeout(resetNavigation);
    }, [pathname]);

    // Automatic global modal detection: whenever any modal overlay is active anywhere in the dashboard
    useEffect(() => {
        const checkModal = () => {
            const hasActiveModal = !!document.querySelector(
                'main .fixed.inset-0, [role="dialog"], .cbt-modal-open, .cbt-editor-open'
            );
            if (hasActiveModal) {
                document.body.classList.add('cbt-modal-active', 'scroll-locked');
                document.documentElement.classList.add('scroll-locked');
            } else {
                const manualLock = document.querySelector('.cbt-editor-open, .cbt-modal-open');
                if (!manualLock) {
                    document.body.classList.remove('cbt-modal-active', 'scroll-locked');
                    document.documentElement.classList.remove('scroll-locked');
                }
            }
        };

        const observer = new MutationObserver(checkModal);
        observer.observe(document.body, { childList: true, subtree: true });
        checkModal();

        return () => {
            observer.disconnect();
            document.body.classList.remove('cbt-modal-active', 'scroll-locked');
            document.documentElement.classList.remove('scroll-locked');
        };
    }, []);

    if (!authChecked) {
        return <DashboardLoading />;
    }
    if (authError || !activeRoleCtx) {
        return (
            <main className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
                <div role="alert" className="max-w-md w-full rounded-2xl bg-white border border-red-100 shadow-sm p-6 text-center">
                    <h1 className="text-lg font-bold text-slate-900">Dashboard belum dapat dibuka</h1>
                    <p className="mt-2 text-sm text-slate-600">{authError || 'Peran akun tidak tersedia.'}</p>
                    <div className="mt-5 flex justify-center gap-3">
                        <button type="button" onClick={() => window.location.reload()} className="px-4 py-2 rounded-lg bg-[#3083FF] text-white text-sm font-semibold">Coba Lagi</button>
                        <button type="button" onClick={() => router.replace('/')} className="px-4 py-2 rounded-lg border border-slate-300 text-sm font-semibold">Ke Login</button>
                    </div>
                </div>
            </main>
        );
    }

    const isQuestionEditRoute = pathname.includes('/questions/') && pathname.endsWith('/edit');
    const isLearningReaderRoute = /^\/dashboard\/learning\/[^/]+\/?$/.test(pathname);

    if (isLearningReaderRoute) {
        return <div className="bg-white text-slate-900 dark:bg-slate-950 dark:text-slate-100">{children}</div>;
    }

    if (isQuestionEditRoute) {
        return (
            <div className="min-h-screen bg-slate-50 text-slate-900">
                <main className="min-h-screen p-0 m-0">
                    {children}
                </main>
            </div>
        );
    }

    return (
        <div className={`dashboard-layout min-h-screen bg-[#EBECF1] dark:bg-[#020718] text-slate-900 dark:text-slate-100 transition-colors duration-200 ${mobileOpen ? 'sidebar-mobile-open' : ''}`}>
            <Sidebar
                isCollapsed={isCollapsed}
                setIsCollapsed={setIsCollapsed}
                isOpen={mobileOpen}
                setIsOpen={setMobileOpen}
                activeRole={activeRoleCtx}
            />
            <div className="dashboard-content-wrapper">
                <Header
                    user={{
                        id: currentUser?.id,
                        nama: currentUser?.nama,
                        email: currentUser?.email,
                        nip: currentUser?.nip,
                        roles: activeRoleCtx?.role ? [activeRoleCtx.role] : (currentUser?.roles || ['User']),
                        photoUrl: currentUser?.photoUrl,
                    }}
                    onMenuToggle={() => setMobileOpen(!mobileOpen)}
                    isCollapsed={isCollapsed}
                    onCollapse={() => setIsCollapsed(!isCollapsed)}
                    pageTitle={pageTitle}
                    pageSubtitle={appSubtitle}
                />
                <main
                    className={`dashboard-main transition-all duration-300 ${
                        isCollapsed ? 'collapsed' : ''
                    }`}
                >
                    <div className="px-3 sm:px-4 lg:px-6 py-3 sm:py-6 print:p-0!">
                        {children}
                    </div>
                </main>
                <BottomNav
                    user={currentUser}
                    activeRole={activeRoleCtx?.role}
                    onNavigate={(p) => router.push(p)}
                    onOpenMenu={() => setMobileOpen(true)}
                />
                {mobileOpen && (
                    <div
                        className="sidebar-mobile-backdrop"
                        onClick={() => setMobileOpen(false)}
                        aria-label="Tutup Menu"
                    />
                )}
            </div>
            <style jsx global>{`
                :root {
                    --app-sidebar-w: 258px;
                    --app-sidebar-w-collapsed: 85px;
                    --app-header-h: 70px;
                }
                @media (max-width: 1023.98px) {
                    :root {
                        --app-header-h: 56px;
                        --app-sidebar-mobile-w: min(calc(100vw - 64px), 320px);
                    }

                    .dashboard-layout {
                        position: relative !important;
                        inset: auto !important;
                        width: 100% !important;
                        min-height: 100vh !important;
                        min-height: 100dvh !important;
                        height: auto !important;
                        overflow: visible !important;
                        overflow-x: clip !important;
                        background: transparent !important;
                        z-index: 1 !important;
                    }

                    .dashboard-content-wrapper {
                        position: relative;
                        width: 100%;
                        min-height: 100vh;
                        min-height: 100dvh;
                        background: #EBECF1;
                        transform: none !important;
                        border-radius: 0;
                        overflow: visible;
                        z-index: 100;
                        transition: transform .35s cubic-bezier(0.32, 0.72, 0, 1),
                                    border-radius .35s cubic-bezier(0.32, 0.72, 0, 1),
                                    box-shadow .35s cubic-bezier(0.32, 0.72, 0, 1);
                    }

                    :global(.dark) .dashboard-content-wrapper {
                        background: #020718;
                    }

                    /* Push effect (Twitter/X style drawer) */
                    .dashboard-layout.sidebar-mobile-open {
                        position: fixed !important;
                        inset: 0 !important;
                        top: 0 !important;
                        left: 0 !important;
                        right: 0 !important;
                        bottom: 0 !important;
                        width: 100vw !important;
                        height: 100vh !important;
                        height: 100dvh !important;
                        overflow: hidden !important;
                        background: #ffffff !important;
                        touch-action: none;
                        z-index: 1000 !important;
                    }

                    :global(.dark) .dashboard-layout.sidebar-mobile-open {
                        background: #000000 !important;
                    }

                    .dashboard-layout.sidebar-mobile-open .dashboard-content-wrapper {
                        position: absolute !important;
                        inset: 0 !important;
                        top: 0 !important;
                        left: 0 !important;
                        right: 0 !important;
                        bottom: 0 !important;
                        width: 100% !important;
                        height: 100% !important;
                        height: 100dvh !important;
                        transform: translate3d(var(--app-sidebar-mobile-w, min(calc(100vw - 64px), 320px)), 0, 0) !important;
                        border-top-left-radius: 28px !important;
                        border-bottom-left-radius: 28px !important;
                        border: 1px solid rgba(0, 0, 0, 0.08) !important;
                        border-right: none !important;
                        box-shadow: -10px 0 28px rgba(0, 0, 0, 0.16), -1px 0 0 rgba(0, 0, 0, 0.06) !important;
                        overflow: hidden !important;
                        pointer-events: none;
                        -webkit-mask-image: -webkit-radial-gradient(white, black) !important;
                        mask-image: radial-gradient(white, black) !important;
                    }

                    :global(.dark) .dashboard-layout.sidebar-mobile-open .dashboard-content-wrapper {
                        background: #000000 !important;
                        border: 1px solid rgba(255, 255, 255, 0.16) !important;
                        border-right: none !important;
                        box-shadow: -12px 0 32px rgba(0, 0, 0, 0.8), -1px 0 0 rgba(255, 255, 255, 0.12) !important;
                    }

                    .sidebar-mobile-backdrop {
                        position: fixed;
                        inset: 0;
                        background: rgba(15, 23, 42, 0.18);
                        z-index: 1200;
                        cursor: pointer;
                        pointer-events: auto !important;
                        border-top-left-radius: 28px;
                        border-bottom-left-radius: 28px;
                        opacity: 0;
                        animation: fadeInBackdrop 0.25s forwards;
                        -webkit-tap-highlight-color: transparent;
                        touch-action: none;
                    }

                    :global(.dark) .sidebar-mobile-backdrop {
                        background: rgba(0, 0, 0, 0.35);
                    }

                    @keyframes fadeInBackdrop {
                        to {
                            opacity: 1;
                        }
                    }

                    .dashboard-main {
                        padding-top: calc(var(--app-header-h, 56px) + env(safe-area-inset-top) + 4px) !important;
                        padding-bottom: 12px !important;
                        min-height: calc(100vh - var(--app-bottomnav-h, 62px) - env(safe-area-inset-bottom)) !important;
                        min-height: calc(100dvh - var(--app-bottomnav-h, 62px) - env(safe-area-inset-bottom)) !important;
                        box-sizing: border-box !important;
                    }
                }

                @media (min-width: 1024px) {
                    .dashboard-content-wrapper {
                        display: contents;
                    }
                    .sidebar-mobile-backdrop {
                        display: none;
                    }
                    .dashboard-main {
                        margin-left: var(--app-sidebar-w, 258px);
                        padding-top: calc(var(--app-header-h, 70px) + env(safe-area-inset-top));
                        min-height: 100vh;
                        min-height: 100dvh;
                        transition: margin-left 0.35s cubic-bezier(0.4, 0, 0.2, 1);
                    }
                    .dashboard-main.collapsed {
                        margin-left: var(--app-sidebar-w-collapsed, 85px);
                    }
                }
                /* When ANY modal or question editor is active, Header & Sidebar become the background */
                html.cbt-editor-open .header,
                body.cbt-editor-open .header,
                html.cbt-modal-active .header,
                body.cbt-modal-active .header,
                html.scroll-locked .header,
                body.scroll-locked .header,
                html.cbt-editor-open aside.sidebar,
                body.cbt-editor-open aside.sidebar,
                html.cbt-modal-active aside.sidebar,
                body.cbt-modal-active aside.sidebar,
                html.scroll-locked aside.sidebar,
                body.scroll-locked aside.sidebar,
                html.cbt-editor-open .sidebar-overlay,
                body.cbt-editor-open .sidebar-overlay,
                body.cbt-modal-active .sidebar-overlay,
                body.scroll-locked .sidebar-overlay {
                    z-index: 10 !important;
                    pointer-events: none !important;
                    user-select: none !important;
                }

                /* Suppress sidebar tooltips completely when a modal is active */
                html.cbt-editor-open .sidebar-tooltip,
                body.cbt-editor-open .sidebar-tooltip,
                html.cbt-modal-active .sidebar-tooltip,
                body.cbt-modal-active .sidebar-tooltip,
                html.scroll-locked .sidebar-tooltip,
                body.scroll-locked .sidebar-tooltip {
                    display: none !important;
                    opacity: 0 !important;
                    pointer-events: none !important;
                }
            `}</style>
        </div>
    );
}
