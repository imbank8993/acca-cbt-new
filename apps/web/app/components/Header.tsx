'use client';

import Image from 'next/image';

import { clearExamRecoverySessions, forgetExamOfflineOwner } from '@/lib/exam-durable-storage';
import { clearExamOfflineShells } from '@/lib/exam-pwa';
import { clearSessionCache } from '@/lib/session';
import { ArrowLeft,LogOut,Menu,Moon,Sun,User as UserIcon } from 'lucide-react';
import { usePathname,useRouter } from 'next/navigation';
import { useEffect,useRef,useState } from 'react';
import './header.css';

export interface HeaderUser {
    id?: string;
    nama?: string;
    email?: string;
    nip?: string;
    roles?: string[];
    role?: string;
    photoUrl?: string;
    avatar_url?: string;
}

interface HeaderProps {
    user: HeaderUser;
    onMenuToggle: () => void;
    isCollapsed: boolean;
    onCollapse?: () => void;
    pageTitle?: string;
    pageSubtitle?: string;
    onScrollHiddenChange?: (hidden: boolean) => void;
}

export default function Header({
    user,
    onMenuToggle,
    isCollapsed,
    pageTitle,
    pageSubtitle,
}: HeaderProps) {
    const router = useRouter();
    const pathname = usePathname();
    const [showUserMenu, setShowUserMenu] = useState(false);
    const [isDark, setIsDark] = useState(false);
    const userMenuRef = useRef<HTMLDivElement>(null);

    // Dark mode sync
    useEffect(() => {
        const checkDark = () => {
            const dark =
                document.documentElement.classList.contains('dark') ||
                localStorage.getItem('theme') === 'dark' ||
                localStorage.getItem('darkMode') === '1';
            setIsDark(dark);
        };
        checkDark();

        window.addEventListener('theme-changed', checkDark);
        return () => window.removeEventListener('theme-changed', checkDark);
    }, []);

    const toggleDarkMode = () => {
        const nextDark = !isDark;
        setIsDark(nextDark);
        if (nextDark) {
            document.documentElement.classList.add('dark');
            localStorage.setItem('theme', 'dark');
            localStorage.setItem('darkMode', '1');
        } else {
            document.documentElement.classList.remove('dark');
            localStorage.setItem('theme', 'light');
            localStorage.setItem('darkMode', '0');
        }
        window.dispatchEvent(new Event('theme-changed'));
    };

    // Close user menu on click outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
                setShowUserMenu(false);
            }
        };
        if (showUserMenu) {
            document.addEventListener('mousedown', handleClickOutside);
        }
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [showUserMenu]);

    const handleLogout = async () => {
        clearSessionCache();
        forgetExamOfflineOwner();
        await clearExamRecoverySessions().catch(() => undefined);
        await clearExamOfflineShells().catch(() => undefined);
        window.dispatchEvent(new Event('acca:signout'));
        try {
            await fetch('/api/auth/logout', { method: 'POST' });
        } catch { }
        window.location.href = '/';
    };

    const displayName = user?.nama || user?.email || 'User';
    const displayRoles = user?.roles?.length ? user.roles : user?.role ? [user.role] : ['User'];
    const displayRole = displayRoles[0] || 'User';
    const displayNip = user?.nip || 'N/A';
    const avatarImg = user?.photoUrl || user?.avatar_url;
    const isSiswa = displayRoles.some(r => r.toLowerCase() === 'siswa');
    const idLabel = isSiswa ? 'NISN' : 'NIP';

    const isDashboard = !pageTitle || pageTitle === 'Dashboard' || pathname.endsWith('/dashboard') || pathname === '/dashboard/admin' || pathname === '/dashboard/proktor' || pathname === '/dashboard/guru' || pathname === '/dashboard/siswa' || pathname === '/dashboard/pengawas';

    return (
        <header className={`header ${isCollapsed ? 'collapsed' : ''}`}>
            <div className="header-inner content-container">
                <div className="header-left">
                    <button className="menu-toggle" onClick={onMenuToggle} type="button" aria-label="Menu">
                        <Menu size={19} />
                    </button>

                    {!isDashboard && (
                        <button
                            type="button"
                            className="header-back-btn"
                            onClick={() => {
                                if (typeof window !== 'undefined') {
                                    if (window.history.length > 1) {
                                        router.back();
                                    } else {
                                        router.push('/dashboard');
                                    }
                                }
                            }}
                            title="Kembali ke halaman sebelumnya"
                            aria-label="Kembali ke halaman sebelumnya"
                        >
                            <ArrowLeft size={16} />
                        </button>
                    )}

                    <div className="header-title-wrapper">
                        <h1 className="header-title" title={isDashboard ? 'Selamat Datang 👋' : pageTitle}>
                            {isDashboard ? 'Selamat Datang 👋' : (pageTitle || 'ACCA CBT Portal')}
                        </h1>
                        <span
                            className={`header-subtitle ${isDashboard ? 'header-subtitle--name' : ''}`}
                            title={isDashboard ? displayName : (pageSubtitle || 'MAN Insan Cendekia Gowa')}
                        >
                            {isDashboard ? displayName : (pageSubtitle || 'MAN Insan Cendekia Gowa')}
                        </span>
                    </div>

                    {/* Mobile: judul halaman + tombol menu sidebar */}
                    <div className="header-pageTitle-wrap">
                        <button
                            type="button"
                            className="header-mobile-menu-btn"
                            onClick={onMenuToggle}
                            aria-label="Buka Menu Sidebar"
                            title="Buka Menu"
                        >
                            <Menu size={18} />
                        </button>
                        {isDashboard ? (
                            <div className="header-greeting-container">
                                <div className="header-greeting-title">
                                    <h1 className="header-pageTitle header-pageTitle--stacked" title="Selamat Datang 👋">
                                        Selamat Datang 👋
                                    </h1>
                                </div>
                                <span className="header-greeting-name header-pageSubtitle header-pageSubtitle--name" title={displayName}>
                                    {displayName}
                                </span>
                            </div>
                        ) : (
                            <div className="header-greeting-container">
                                <div className="header-greeting-title">
                                    <h1 className="header-pageTitle header-pageTitle--stacked" title={pageTitle || 'ACCA CBT'}>
                                        {pageTitle || 'ACCA CBT'}
                                    </h1>
                                </div>
                                <span className="header-greeting-name header-pageSubtitle" title={pageSubtitle || 'MAN Insan Cendekia Gowa'}>
                                    {pageSubtitle || 'MAN Insan Cendekia Gowa'}
                                </span>
                            </div>
                        )}
                    </div>
                </div>

                <div className="header-right">
                    <button
                        type="button"
                        onClick={toggleDarkMode}
                        className="dark-mode-toggle"
                        title={isDark ? "Mode Terang" : "Mode Gelap"}
                        aria-label="Toggle Theme"
                    >
                        {isDark ? <Sun size={17} /> : <Moon size={17} />}
                    </button>

                    <div className="user-menu-wrapper" ref={userMenuRef}>
                        <button className="user-menu-trigger" onClick={() => setShowUserMenu(!showUserMenu)} type="button">
                            <div className="user-avatar-small">
                                {avatarImg ? (
                                    <Image
                                        src={avatarImg}
                                        alt={displayName}
                                        width={40}
                                        height={40}
                                        unoptimized
                                        onError={(e) => {
                                            e.currentTarget.style.display = 'none';
                                            const parent = e.currentTarget.parentElement;
                                            if (parent) {
                                                const fallback = parent.querySelector('.user-avatar-fallback') as HTMLElement;
                                                if (fallback) fallback.style.display = 'inline-flex';
                                            }
                                        }}
                                    />
                                ) : null}
                                <span
                                    className="user-avatar-fallback"
                                    style={{
                                        display: avatarImg ? 'none' : 'inline-flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        width: '100%',
                                        height: '100%'
                                    }}
                                >
                                    <UserIcon size={16} />
                                </span>
                            </div>
                            <div className="user-info-header">
                                <span className="user-name-header">{displayName}</span>
                                <span className="user-role-header">{displayNip && displayNip !== 'N/A' ? `${idLabel} ${displayNip} • ` : ''}{displayRole}</span>
                            </div>
                        </button>

                        {showUserMenu && (
                            <div className="user-menu-dropdown">
                                <div className="user-menu-info">
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
                                        <div
                                            className="user-menu-profile-avatar shrink-0"
                                            style={{
                                                width: 40,
                                                height: 40,
                                                minWidth: 40,
                                                minHeight: 40,
                                                maxWidth: 40,
                                                maxHeight: 40,
                                                borderRadius: '50%',
                                                overflow: 'hidden',
                                                aspectRatio: '1 / 1',
                                                flex: '0 0 40px'
                                            }}
                                        >
                                            {avatarImg ? (
                                                <Image
                                                    src={avatarImg}
                                                    alt={displayName}
                                                    width={40}
                                                    height={40}
                                                    unoptimized
                                                    style={{
                                                        width: '100%',
                                                        height: '100%',
                                                        objectFit: 'cover',
                                                        borderRadius: '50%',
                                                        aspectRatio: '1 / 1',
                                                        display: 'block'
                                                    }}
                                                    onError={(e) => {
                                                        e.currentTarget.style.display = 'none';
                                                        const parent = e.currentTarget.parentElement;
                                                        if (parent) {
                                                            const fallback = parent.querySelector('.user-avatar-fallback') as HTMLElement;
                                                            if (fallback) fallback.style.display = 'inline-flex';
                                                        }
                                                    }}
                                                />
                                            ) : null}
                                            <span
                                                className="user-avatar-fallback"
                                                style={{
                                                    display: avatarImg ? 'none' : 'inline-flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'center',
                                                    width: '100%',
                                                    height: '100%'
                                                }}
                                            >
                                                <UserIcon size={18} />
                                            </span>
                                        </div>
                                        <div style={{ minWidth: 0, flex: 1 }}>
                                            <div className="user-menu-name" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{displayName}</div>
                                            <div className="user_menu_nip">
                                                {idLabel}: {displayNip && displayNip !== 'N/A' ? displayNip : '-'}
                                            </div>
                                            <div className="user-menu-role">{displayRoles.join(', ')}</div>
                                        </div>
                                    </div>
                                </div>

                                <button
                                    type="button"
                                    className="user-menu-item user-menu-theme-btn"
                                    onClick={toggleDarkMode}
                                >
                                    {isDark ? (
                                        <Sun size={16} style={{ color: '#f59e0b', flexShrink: 0 }} />
                                    ) : (
                                        <Moon size={16} style={{ color: '#3083FF', flexShrink: 0 }} />
                                    )}
                                    <span>{isDark ? "Mode Terang" : "Mode Gelap"}</span>
                                </button>

                                <div className="user-menu-divider" />
                                <button className="user-menu-item" onClick={handleLogout} style={{ color: '#ef4444' }}>
                                    <LogOut size={16} style={{ flexShrink: 0 }} />
                                    <span>Sign Out</span>
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </header>
    );
}
