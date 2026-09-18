"use client";

import React, { useEffect, useState, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Menu } from 'lucide-react';
import Image from 'next/image';
import { getSessionUser } from '@/lib/session';
import Sidebar from '@/app/components/Sidebar';
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
    const lastResolvedPath = useRef<string | null>(null);
    const pathRoleRef = useRef<DashboardRole | null>(null);

    useEffect(() => {
        let cancelled = false;

        const run = async () => {
            // Safety timeout: force show content after 8 seconds even if resolving fails.
            // Use the resolved role or current path as a fallback so we don't loop on
            // DashboardLoading forever when the DB is slow.
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

                const pathRole = getRoleFromPath(pathname);
                // Store in ref so the safety timeout (which runs in a different
                // closure) can still access it.
                pathRoleRef.current = pathRole;

                const { role } = await resolveActiveRole({ pathname });

                if (cancelled) return;

                // Evict stale memory cache from other roles' dashboards so the
                // page we are about to render does not display data from a
                // previous role (e.g. Proktor stats showing up on /dashboard/admin
                // because the user switched role without a full reload).
                const rolePrefixes = ['proktor', 'admin', 'guru', 'siswa', 'pengawas'];
                const keepPrefix = role.toLowerCase();
                const evictPrefixes = rolePrefixes.filter((p) => p !== keepPrefix);
                clearMemoryCacheByPrefix(evictPrefixes);

                // Load the user's available role contexts (with org info) so the
                // sidebar switcher can show them.
                let list: UserRoleContext[] = [];
                try {
                    list = await getUserRolesWithOrg();
                } catch (listErr) {
                    console.error('[DashboardLayout] getUserRolesWithOrg error:', listErr);
                }
                if (cancelled) return;
                setRolesWithOrg(list);

                // Reconcile the URL with the resolved active role.
                if (
                    role !== 'None' &&
                    pathRole &&
                    pathRole !== role
                ) {
                    try {
                        const userQualifiedForPath = isRoleQualifiedFromList(list, pathRole);
                        if (!userQualifiedForPath) {
                            // User is NOT qualified for the path role (e.g. trying to
                            // open /dashboard/admin as a plain Guru). Force-redirect to
                            // their best qualified dashboard regardless of lock state.
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
                    // User IS qualified for the path role but the resolved role differs
                    // (typical case: Superadmin whose path is /dashboard/admin, but the
                    // resolver returns 'Superadmin' while pathRole is 'Admin' because both
                    // share the same URL). Trust the URL when qualified — do NOT redirect,
                    // even if a stale role lock is set. Just sync storage to the path role
                    // so subsequent refreshes stay consistent.
                    setActiveRoleInStorage(pathRole);
                }

                // If no stored role and we have a path role, set it as the default
                // unless a role lock is in place.
                const stored = getActiveRoleFromStorage();
                if (!stored && pathRole && !isActiveRoleLocked()) {
                    setActiveRoleInStorage(pathRole);
                }

                const candidates = list.filter(c => c.role === role);
                let active: UserRoleContext | undefined = candidates[0];
                if (pathRole) {
                    const pathSeg = pathname.split('/')[3] || '';
                    // Use exact match on orgId, not startsWith — otherwise
                    // 'platform-admin' would match 'admin' incorrectly and steal
                    // the active role from a real org-bound user. As a fallback,
                    // also accept the orgName containing the path segment (so
                    // /dashboard/admin/orgs/<some-org> still resolves to the right
                    // org context when present).
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
                // Fallback: show content anyway even if something failed
                if (!cancelled) {
                    setAuthChecked(true);
                }
            }
        };

        run();

        // Tidak ada lagi listener perubahan sesi. Sesi CBT adalah cookie
        // httpOnly yang tidak terlihat dari JavaScript, jadi tidak ada peristiwa
        // yang bisa disimak di sini. Sesi yang habis ditangkap dua lapis:
        // `middleware.ts` mengalihkan permintaan berikutnya ke '/', dan `run()`
        // di atas mengalihkan saat `getSessionUser()` mengembalikan null.

        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pathname]);

    // Release the role lock when the user explicitly signs out from the sidebar.
    useEffect(() => {
        const onSignOut = () => unlockActiveRole();
        window.addEventListener('acca:signout', onSignOut);
        return () => window.removeEventListener('acca:signout', onSignOut);
    }, []);

    if (!authChecked || !activeRoleCtx) {
        return <DashboardLoading />;
    }

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-[#090d16] text-slate-900 dark:text-slate-100 transition-colors duration-205">
            <Sidebar
                isCollapsed={isCollapsed}
                setIsCollapsed={setIsCollapsed}
                isOpen={mobileOpen}
                setIsOpen={setMobileOpen}
                activeRole={activeRoleCtx}
                availableRoles={rolesWithOrg}
            />
            <main className={`min-h-screen pb-6 lg:pb-0 print:ml-0! print:pb-0 transition-all duration-200 ${isCollapsed ? 'lg:ml-[110px]' : 'lg:ml-[280px]'}`}>
                {/* Mobile top bar — hamburger to open the sidebar drawer (below lg) */}
                <header className="lg:hidden print:hidden! sticky top-0 z-30 flex items-center gap-1.5 bg-white/95 dark:bg-[#0d1221]/95 backdrop-blur border-b border-slate-200 dark:border-white/10 px-2.5 h-16 pt-[env(safe-area-inset-top)]">
                    <button
                        type="button"
                        onClick={() => setMobileOpen(true)}
                        aria-label="Buka menu navigasi"
                        className="inline-flex items-center justify-center w-11 h-11 shrink-0 rounded-lg text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 active:scale-95 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#030C4D]"
                    >
                        <Menu size={22} />
                    </button>

                    {/* Brand lockup: logo + name + subtitle */}
                    <div className="flex items-center gap-2.5 min-w-0">
                        <Image src="/logo-icon.png" alt="" width={30} height={30} className="shrink-0" />
                        <div className="min-w-0 flex flex-col justify-center">
                            <span className="text-[0.95rem] font-extrabold leading-none text-[#030C4D] dark:text-slate-100 uppercase tracking-[0.16em] truncate">
                                ACCA CBT
                            </span>
                            <span className="mt-1 text-[8.5px] font-bold leading-none text-slate-400 dark:text-slate-500 uppercase tracking-[0.22em] truncate">
                                MAN IC Gowa
                            </span>
                        </div>
                    </div>
                </header>
                <div className="px-3 sm:px-4 lg:px-6 py-6 print:p-0!">
                    {children}
                </div>
            </main>
        </div>
    );
}
