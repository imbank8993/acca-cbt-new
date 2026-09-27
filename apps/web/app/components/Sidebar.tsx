'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { getSessionUser } from '@/lib/session';
import { getUserRole, type Role } from '@/lib/rbac';
import { getAccountProfile } from '@/lib/api/account';
import { getSetting, type AppConfig } from '@/lib/api/settings';
import './sidebar.css';

const ACCA_URL = process.env.NEXT_PUBLIC_ACCA_URL || 'https://accav2.icgowa.sch.id';

interface MenuItem {
    icon: string;
    label: string;
    href: string;
    badge?: number;
    children?: MenuItem[];
}

export interface SidebarProps {
    isCollapsed: boolean;
    setIsCollapsed: (v: boolean) => void;
    isOpen?: boolean;
    setIsOpen?: (v: boolean) => void;
    activeRole?: { role: Role } | null;
}

export default function Sidebar({
    isCollapsed,
    setIsCollapsed,
    isOpen,
    setIsOpen,
    activeRole,
}: SidebarProps) {
    const pathname = usePathname();
    const router = useRouter();

    const [pinned, setPinned] = useState<string[]>([]);
    const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
    const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    const [userData, setUserData] = useState<any>(null);
    const [dbUserRole, setDbUserRole] = useState<string | null>(null);

    const handleMouseEnter = (idx: number) => {
        if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
        setHoveredIdx(idx);
    };

    const handleMouseLeave = () => {
        hoverTimeoutRef.current = setTimeout(() => {
            setHoveredIdx(null);
        }, 120);
    };

    const loadUserInfo = async () => {
        const user = await getSessionUser();
        if (!user) return;
        const [{ profile }, role] = await Promise.all([
            getAccountProfile(),
            getUserRole(),
        ]);
        setUserData({ ...user, profile });
        if (role) setDbUserRole(role);
    };

    useEffect(() => {
        loadUserInfo();
    }, []);

    useEffect(() => {
        const handler = () => loadUserInfo();
        window.addEventListener('profile-updated', handler);
        return () => window.removeEventListener('profile-updated', handler);
    }, []);

    // Load pinned pages
    useEffect(() => {
        try {
            const userKey = userData?.id || userData?.auth_id || 'default';
            const saved = localStorage.getItem(`acca_cbt_pinned_${userKey}`);
            if (saved) setPinned(JSON.parse(saved));
        } catch { }
    }, [userData]);

    const togglePin = (href: string) => {
        const userKey = userData?.id || userData?.auth_id || 'default';
        const next = pinned.includes(href) ? pinned.filter(h => h !== href) : [...pinned, href];
        setPinned(next);
        try {
            localStorage.setItem(`acca_cbt_pinned_${userKey}`, JSON.stringify(next));
        } catch { }
    };

    const getRole = (): Role => {
        if (activeRole?.role && activeRole.role !== 'None') {
            return activeRole.role;
        }
        if (pathname.includes('/admin')) return 'Admin';
        if (pathname.includes('/proktor')) return 'Proktor';
        if (pathname.includes('/guru')) return 'Guru';
        if (pathname.includes('/siswa')) return 'Siswa';
        if (pathname.includes('/pengawas')) return 'Pengawas';
        return (dbUserRole as Role) || 'User';
    };

    const role = getRole();

    const menuConfig: Record<string, MenuItem[]> = useMemo(() => ({
        'Superadmin': [
            { icon: 'fa-house', label: 'Dashboard', href: '/dashboard/admin' },
            { icon: 'fa-users', label: 'Kelas', href: '/dashboard/admin/classes' },
            { icon: 'fa-book-open', label: 'Bank Soal', href: '/dashboard/admin/questions' },
            { icon: 'fa-clipboard-check', label: 'Ujian', href: '/dashboard/admin/exams' },
            { icon: 'fa-chart-line', label: 'Monitoring', href: '/dashboard/admin/monitoring' },
            { icon: 'fa-database', label: 'Backup Data', href: '/dashboard/admin/backup' },
        ],
        'Admin': [
            { icon: 'fa-house', label: 'Dashboard', href: '/dashboard/admin' },
            { icon: 'fa-users', label: 'Kelas', href: '/dashboard/admin/classes' },
            { icon: 'fa-book-open', label: 'Bank Soal', href: '/dashboard/admin/questions' },
            { icon: 'fa-clipboard-check', label: 'Ujian', href: '/dashboard/admin/exams' },
            { icon: 'fa-chart-line', label: 'Monitoring', href: '/dashboard/admin/monitoring' },
            { icon: 'fa-database', label: 'Backup Data', href: '/dashboard/admin/backup' },
        ],
        'Proktor': [
            { icon: 'fa-house', label: 'Dashboard', href: '/dashboard/proktor' },
            { icon: 'fa-users', label: 'Kelas', href: '/dashboard/proktor/classes' },
            { icon: 'fa-book-open', label: 'Bank Soal', href: '/dashboard/proktor/questions' },
            { icon: 'fa-clipboard-check', label: 'Ujian', href: '/dashboard/proktor/exams' },
            { icon: 'fa-chart-line', label: 'Monitoring', href: '/dashboard/proktor/monitoring' },
        ],
        'Guru': [
            { icon: 'fa-house', label: 'Dashboard', href: '/dashboard/guru' },
            { icon: 'fa-bell', label: 'Notifikasi', href: '/dashboard/notifications' },
            { icon: 'fa-users', label: 'Kelas', href: '/dashboard/guru/classes' },
            { icon: 'fa-book-open', label: 'Bank Soal', href: '/dashboard/guru/questions' },
            { icon: 'fa-clipboard-check', label: 'Ujian', href: '/dashboard/guru/exams' },
            { icon: 'fa-chart-line', label: 'Monitoring', href: '/dashboard/guru/monitoring' },
        ],
        'Siswa': [
            { icon: 'fa-house', label: 'Dashboard', href: '/dashboard/siswa' },
            { icon: 'fa-bell', label: 'Notifikasi', href: '/dashboard/notifications' },
            { icon: 'fa-users', label: 'Kelas', href: '/dashboard/siswa/classes' },
            { icon: 'fa-calendar', label: 'Jadwal', href: '/dashboard/siswa/schedule' },
            { icon: 'fa-chart-column', label: 'Hasil', href: '/dashboard/siswa/results' },
            { icon: 'fa-arrow-trend-up', label: 'Analisis', href: '/dashboard/siswa/analytics' },
        ],
        'Pengawas': [
            { icon: 'fa-house', label: 'Dashboard', href: '/dashboard/pengawas' },
            { icon: 'fa-bell', label: 'Notifikasi', href: '/dashboard/notifications' },
            { icon: 'fa-eye', label: 'Monitoring', href: '/dashboard/pengawas/monitoring' },
        ],
    }), []);

    const menuItems = useMemo(() => {
        const activeRoleName = activeRole?.role ?? role;
        return menuConfig[activeRoleName] || menuConfig['Admin'] || [];
    }, [menuConfig, role, activeRole]);

    const handleItemClick = () => {
        if (typeof window !== 'undefined' && window.innerWidth < 768 && setIsOpen) {
            setIsOpen(false);
        }
    };

    const pinnedItems = useMemo(() => {
        return menuItems.filter(item => pinned.includes(item.href));
    }, [menuItems, pinned]);

    return (
        <>
            <div
                className={`sidebar-overlay ${isOpen ? 'show' : ''}`}
                onClick={() => setIsOpen && setIsOpen(false)}
            />

            <aside className={`sidebar ${isOpen ? 'open' : ''} ${isCollapsed ? 'collapsed' : ''}`}>
                <div className="sidebar-header">
                    <div className="brand-wrapper">
                        <div className="brand-logo">
                            {!isCollapsed ? (
                                <>
                                    <img src="/logo-sidebar.png" alt="ACCA Logo" className="brand-logo-img light-logo" />
                                    <img src="/logo-sidebar-dark.png" alt="ACCA Logo" className="brand-logo-img dark-logo" />
                                </>
                            ) : (
                                <img src="/logo-sidebar-kecil.webp" alt="ACCA Logo" className="brand-logo-img" />
                            )}
                        </div>
                    </div>
                </div>

                <div className="sidebar-nav-fixed">
                    {/* SSO App Links — Kembali ke ACCA + ACCA TOOLS */}
                    <div className="sso-cbt-container">
                        <a
                            href={ACCA_URL}
                            className="sso-cbt-btn"
                            title="Kembali ke Portal ACCA"
                        >
                            <i className="fa-solid fa-arrow-left btn-icon"></i>
                            {!isCollapsed && <span className="btn-label">ACCA</span>}
                        </a>
                        <a
                            href={`${ACCA_URL}/api/sso/tools`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="sso-cbt-btn"
                            title="Buka ACCA TOOLS"
                        >
                            <i className="fa-solid fa-toolbox btn-icon"></i>
                            {!isCollapsed && <span className="btn-label">TOOLS</span>}
                        </a>
                    </div>
                </div>

                <nav className="sidebar-nav">
                    {/* PINNED */}
                    {!isCollapsed && pinnedItems.length > 0 && (
                                <>
                                    <div className="nav-section-label">Disematkan</div>
                                    {pinnedItems.map(p => {
                                        const isActive = pathname === p.href || (p.href !== '/dashboard' && pathname.startsWith(p.href));
                                        return (
                                            <div key={p.href} className="submenu-row pinned-row">
                                                <Link
                                                    href={p.href}
                                                    className={`submenu-btn pinned-btn ${isActive ? 'active' : ''}`}
                                                    onClick={handleItemClick}
                                                >
                                                    <i
                                                        className={`fa-solid ${p.icon} pinned-ico pin-ico active`}
                                                        title="Lepas dari pinned"
                                                        aria-label="Lepas dari pinned"
                                                        role="button"
                                                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); togglePin(p.href); }}
                                                    ></i>
                                                    <span className="menu-label">{p.label}</span>
                                                </Link>
                                            </div>
                                        );
                                    })}
                                    <div className="nav-divider"></div>
                                </>
                            )}

                            {!isCollapsed && <div className="nav-section-label">Menu Utama</div>}

                            {/* MAIN MENU ITEMS */}
                            {menuItems.map((item, index) => {
                                const isActive = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href));

                                return (
                                    <div
                                        key={item.href || index}
                                        className="menu-group"
                                        onMouseEnter={() => handleMouseEnter(index)}
                                        onMouseLeave={handleMouseLeave}
                                    >
                                        <Link
                                            href={item.href}
                                            className={`menu-btn ${isActive ? 'active' : ''}`}
                                            onClick={handleItemClick}
                                        >
                                            <div className="menu-content">
                                                <i className={`fa-solid ${item.icon} menu-icon`}></i>
                                                {!isCollapsed && (
                                                    <span className="menu-label">{item.label}</span>
                                                )}
                                            </div>
                                        </Link>

                                        {/* Pin Star on hover (Expanded only) */}
                                        {!isCollapsed && (
                                            <button
                                                className={`pin-star ${pinned.includes(item.href) ? 'active' : ''}`}
                                                style={{ left: 'auto', right: 10 }}
                                                title={pinned.includes(item.href) ? 'Lepas dari pinned' : 'Sematkan'}
                                                aria-label={pinned.includes(item.href) ? 'Lepas dari pinned' : 'Sematkan'}
                                                type="button"
                                                onClick={(e) => { e.preventDefault(); e.stopPropagation(); togglePin(item.href); }}
                                            >
                                                <i className="fa-solid fa-star"></i>
                                            </button>
                                        )}

                                        {/* Tooltip for Collapsed State */}
                                        {isCollapsed && hoveredIdx === index && (
                                            <div
                                                className="sidebar-tooltip"
                                                onMouseEnter={() => handleMouseEnter(index)}
                                                onMouseLeave={handleMouseLeave}
                                            >
                                                <div className="tooltip-header">
                                                    <i className={`fa-solid ${item.icon}`}></i>
                                                    <span>{item.label}</span>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                </nav>
            </aside>
        </>
    );
}
