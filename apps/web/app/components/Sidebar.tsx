'use client';

import Image from 'next/image';

import { getUserRole,type Role } from '@/lib/rbac';
import { getSessionUser } from '@/lib/session';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback,useEffect,useMemo,useRef,useState } from 'react';
import './sidebar.css';

const ACCA_URL = process.env.NEXT_PUBLIC_ACCA_URL || 'https://acca.icgowa.sch.id';

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

    const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
    const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);

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

    const loadUserInfo = useCallback(async () => {
        const user = await getSessionUser();
        if (!user) return;
        const role = await getUserRole();
        if (role) setDbUserRole(role);
    }, []);

    useEffect(() => {
        const initialLoad = window.setTimeout(() => { void loadUserInfo(); }, 0);
        return () => window.clearTimeout(initialLoad);
    }, [loadUserInfo]);

    useEffect(() => {
        const handler = () => { void loadUserInfo(); };
        window.addEventListener('profile-updated', handler);
        return () => window.removeEventListener('profile-updated', handler);
    }, [loadUserInfo]);

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
            { icon: 'fa-graduation-cap', label: 'Bahan Ajar', href: '/dashboard/learning' },
            { icon: 'fa-users', label: 'Kelas', href: '/dashboard/admin/classes' },
            { icon: 'fa-book-open', label: 'Bank Soal', href: '/dashboard/admin/questions' },
            { icon: 'fa-shield-halved', label: 'Validasi Soal', href: '/dashboard/admin/questions/validations' },
            { icon: 'fa-clipboard-check', label: 'Ujian', href: '/dashboard/admin/exams' },
            { icon: 'fa-chart-line', label: 'Monitoring', href: '/dashboard/admin/monitoring' },
            { icon: 'fa-database', label: 'Backup Data', href: '/dashboard/admin/backup' },
        ],
        'Admin': [
            { icon: 'fa-house', label: 'Dashboard', href: '/dashboard/admin' },
            { icon: 'fa-graduation-cap', label: 'Bahan Ajar', href: '/dashboard/learning' },
            { icon: 'fa-users', label: 'Kelas', href: '/dashboard/admin/classes' },
            { icon: 'fa-book-open', label: 'Bank Soal', href: '/dashboard/admin/questions' },
            { icon: 'fa-shield-halved', label: 'Validasi Soal', href: '/dashboard/admin/questions/validations' },
            { icon: 'fa-clipboard-check', label: 'Ujian', href: '/dashboard/admin/exams' },
            { icon: 'fa-chart-line', label: 'Monitoring', href: '/dashboard/admin/monitoring' },
            { icon: 'fa-database', label: 'Backup Data', href: '/dashboard/admin/backup' },
        ],
        'Proktor': [
            { icon: 'fa-house', label: 'Dashboard', href: '/dashboard/proktor' },
            { icon: 'fa-users', label: 'Kelas', href: '/dashboard/proktor/classes' },
            { icon: 'fa-book-open', label: 'Bank Soal', href: '/dashboard/proktor/questions' },
            { icon: 'fa-shield-halved', label: 'Validasi Soal', href: '/dashboard/proktor/questions/validations' },
            { icon: 'fa-clipboard-check', label: 'Ujian', href: '/dashboard/proktor/exams' },
            { icon: 'fa-chart-line', label: 'Monitoring', href: '/dashboard/proktor/monitoring' },
        ],
        'Guru': [
            { icon: 'fa-house', label: 'Dashboard', href: '/dashboard/guru' },
            { icon: 'fa-graduation-cap', label: 'Bahan Ajar', href: '/dashboard/learning' },
            { icon: 'fa-bell', label: 'Notifikasi', href: '/dashboard/notifications' },
            { icon: 'fa-users', label: 'Kelas', href: '/dashboard/guru/classes' },
            { icon: 'fa-book-open', label: 'Bank Soal', href: '/dashboard/guru/questions' },
            { icon: 'fa-shield-halved', label: 'Validasi Soal', href: '/dashboard/guru/validations' },
            { icon: 'fa-clipboard-check', label: 'Ujian', href: '/dashboard/guru/exams' },
            { icon: 'fa-chart-line', label: 'Monitoring', href: '/dashboard/guru/monitoring' },
        ],
        'Siswa': [
            { icon: 'fa-house', label: 'Dashboard', href: '/dashboard/siswa' },
            { icon: 'fa-graduation-cap', label: 'Bahan Ajar', href: '/dashboard/learning' },
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

    return (
        <>
            <div
                className={`sidebar-overlay ${isOpen ? 'show' : ''}`}
                onClick={() => setIsOpen && setIsOpen(false)}
            />

            <aside className={`sidebar ${isOpen ? 'open' : ''} ${isCollapsed ? 'collapsed' : ''}`}>
                <div className="sidebar-header">
                    <div className="brand-wrapper">
                        <button
                            type="button"
                            className="brand-logo-btn"
                            onClick={() => {
                                if (typeof window !== 'undefined' && window.innerWidth >= 768) {
                                    setIsCollapsed(!isCollapsed);
                                }
                            }}
                            title={isCollapsed ? 'Bentangkan sidebar' : 'Kecilkan sidebar'}
                            aria-label={isCollapsed ? 'Bentangkan sidebar' : 'Kecilkan sidebar'}
                        >
                            <div className="brand-logo">
                                {!isCollapsed ? (
                                    <>
                                        <Image src="/logo-sidebar.png" alt="ACCA Logo" width={180} height={48} className="brand-logo-img light-logo" />
                                        <Image src="/logo-sidebar-dark.png" alt="ACCA Logo" width={180} height={48} className="brand-logo-img dark-logo" />
                                    </>
                                ) : (
                                    <Image src="/logo-sidebar-kecil.webp" alt="ACCA Logo" width={48} height={48} className="brand-logo-img" />
                                )}
                            </div>
                        </button>
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
                            {!isCollapsed && <div className="nav-section-label">Menu Utama</div>}

                            {/* MAIN MENU ITEMS */}
                            {menuItems.map((item, index) => {
                                // Hanya SATU menu yang aktif: yang href-nya paling panjang dan
                                // cocok dengan path. Tanpa ini, tautan Dashboard per peran
                                // (mis. /dashboard/admin) ikut aktif di semua sub-halamannya.
                                const matches = (href: string) =>
                                    !!href && (pathname === href || pathname.startsWith(href.endsWith('/') ? href : `${href}/`));
                                const activeHref = menuItems
                                    .map((m) => m.href)
                                    .filter(matches)
                                    .sort((a, b) => b.length - a.length)[0];
                                const isActive = item.href === activeHref;

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
