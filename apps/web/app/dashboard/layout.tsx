"use client";

import React, { useEffect, useState, useRef, useMemo } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { getSessionUser } from '@/lib/session';
import { getAccountProfile } from '@/lib/api/account';
import { getSetting, type AppConfig } from '@/lib/api/settings';
import Sidebar from '@/app/components/Sidebar';
import Header from '@/app/components/Header';
import DashboardLoading from '@/app/components/DashboardLoading';
import { clearMemoryCacheByPrefix } from '@/lib/useMemoryState';
import {
    resolveActiveRole,
    getActiveRoleFromStorage,
    setActiveRoleInStorage,
    unlockActiveRole,
    isActiveRoleLocked,
    isRoleQualifiedFromList,
    ROLE_TO_DASHBOARD_PATH,
    getRoleFromPath,
    getUserRolesWithOrg,
    type UserRoleContext,
    type DashboardRole,
} from '@/lib/rbac';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
    const router = useRouter();
    const pathname = usePathname();
    const [authChecked, setAuthChecked] = useState(false);
    const [activeRoleCtx, setActiveRoleCtx] = useState<UserRoleContext | null>(null);
    const [rolesWithOrg, setRolesWithOrg] = useState<UserRoleContext[]>([]);
    const [isCollapsed, setIsCollapsed] = useState(false);
    const [mobileOpen, setMobileOpen] = useState(false);
    const [currentUser, setCurrentUser] = useState<any>(null);
    const [appSubtitle, setAppSubtitle] = useState('MAN IC Gowa');
    const lastResolvedPath = useRef<string | null>(null);
    const pathRoleRef = useRef<DashboardRole | null>(null);

    const pageTitle = useMemo(() => {
        if (pathname.includes('/classes')) return 'Kelas';
        if (pathname.includes('/questions')) return 'Bank Soal';
        if (pathname.includes('/exams')) return 'Ujian';
        if (pathname.includes('/monitoring')) return 'Monitoring Ujian';
        if (pathname.includes('/backup')) return 'Backup Data';
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
                        const fallbackRole = pathRoleRef.current ?? getActiveRoleFromStorage();
                        if (fallbackRole) {
                            setActiveRoleCtx({ role: fallbackRole, orgId: '', orgName: '' });
                        }
                    }
                    setAuthChecked(true);
                }
            }, 8000);

            try {
                const user = await getSessionUser();
                if (cancelled) return;

                if (!user) {
                    clearTimeout(safetyTimer);
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
                    setCurrentUser({
                        id: user.id,
                        nama: profileData?.profile?.full_name || (user as any).nama || user.email,
                        email: user.email,
                        nip: profileData?.profile?.identity_number || (user as any).nip,
                        roles: (user as any).roles || [],
                        photoUrl: profileData?.profile?.avatar_url || (user as any).user_metadata?.avatar_url,
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

                let list: UserRoleContext[] = [];
                try {
                    list = await getUserRolesWithOrg();
                } catch (listErr) {
                    console.error('[DashboardLayout] getUserRolesWithOrg error:', listErr);
                }
                if (cancelled) return;
                setRolesWithOrg(list);

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

                const candidates = list.filter(c => c.role === role);
                let active: UserRoleContext | undefined = candidates[0];
                if (pathRole) {
                    const pathSeg = pathname.split('/')[3] || '';
                    const byPath = candidates.find(c =>
                        c.orgId === pathSeg ||
                        (pathSeg && c.orgName && c.orgName.toLowerCase() === pathSeg.toLowerCase())
                    );
                    if (byPath) active = byPath;
                }
                if (!active) active = list[0] ?? { role, orgId: '', orgName: '' };

                setActiveRoleCtx(active);
                setAuthChecked(true);
                lastResolvedPath.current = pathname;
            } catch (err) {
                console.error('[DashboardLayout] Fatal error in role resolution:', err);
                if (!cancelled) {
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

    if (!authChecked || !activeRoleCtx) {
        return <DashboardLoading />;
    }

    return (
        <div className="dashboard-layout min-h-screen bg-[#EBECF1] dark:bg-[#020718] text-slate-900 dark:text-slate-100 transition-colors duration-200">
            <Sidebar
                isCollapsed={isCollapsed}
                setIsCollapsed={setIsCollapsed}
                isOpen={mobileOpen}
                setIsOpen={setMobileOpen}
                activeRole={activeRoleCtx}
                availableRoles={rolesWithOrg}
            />
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
                className={`dashboard-main min-h-screen pt-[var(--app-header-h,70px)] transition-all duration-300 ${
                    isCollapsed ? 'collapsed' : ''
                }`}
            >
                <div className="px-3 sm:px-4 lg:px-6 py-6 print:p-0!">
                    {children}
                </div>
            </main>
            <style jsx global>{`
                :root {
                    --app-sidebar-w: 258px;
                    --app-sidebar-w-collapsed: 85px;
                    --app-header-h: 70px;
                }
                @media (max-width: 767.98px) {
                    :root {
                        --app-header-h: 56px;
                    }
                }
                @media (min-width: 768px) {
                    .dashboard-main {
                        margin-left: var(--app-sidebar-w, 258px);
                        transition: margin-left 0.35s cubic-bezier(0.4, 0, 0.2, 1);
                    }
                    .dashboard-main.collapsed {
                        margin-left: var(--app-sidebar-w-collapsed, 85px);
                    }
                }
            `}</style>
        </div>
    );
}
