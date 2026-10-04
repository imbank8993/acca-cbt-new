'use client';

import Image from 'next/image';
import { usePathname, useRouter } from 'next/navigation';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowUp, CheckCircle2, Home, Pin, Undo2, X } from 'lucide-react';
import { getPageFab, subscribePageFab, type PageFab } from './mobile/page-fab';
import './bottom-nav.css';

interface BottomNavProps {
    onOpenMenu: () => void;
    activeRole?: string | null;
}

const PAGE_LABELS: Record<string, string> = {
    '/learning': 'Bahan Ajar',
    '/dashboard/learning': 'Bahan Ajar',
    '/dashboard': 'Beranda',
    '/classes': 'Kelas',
    '/questions': 'Bank Soal',
    '/exams': 'Ujian',
    '/monitoring': 'Monitoring',
    '/backup': 'Backup Data',
    '/schedule': 'Jadwal Ujian',
    '/results': 'Hasil Ujian',
    '/analytics': 'Analisis',
    '/notifications': 'Notifikasi',
};

export default function BottomNav({ onOpenMenu, activeRole }: BottomNavProps) {
    const router = useRouter();
    const pathname = usePathname();
    const [pageFab, setPageFab] = useState<PageFab | null>(null);
    const [isPinnedOpen, setIsPinnedOpen] = useState(false);
    const [pinned, setPinned] = useState<string[]>([]);

    // Tentukan rute dashboard utama berdasarkan peran
    const dashboardPath = useMemo(() => {
        const r = (activeRole || '').toLowerCase();
        if (r.includes('siswa')) return '/dashboard/siswa';
        if (r.includes('guru')) return '/dashboard/guru';
        if (r.includes('proktor')) return '/dashboard/proktor';
        if (r.includes('admin')) return '/dashboard/admin';
        if (r.includes('pengawas')) return '/dashboard/pengawas';

        if (pathname.includes('/siswa')) return '/dashboard/siswa';
        if (pathname.includes('/guru')) return '/dashboard/guru';
        if (pathname.includes('/proktor')) return '/dashboard/proktor';
        if (pathname.includes('/admin')) return '/dashboard/admin';
        if (pathname.includes('/pengawas')) return '/dashboard/pengawas';
        return '/dashboard';
    }, [activeRole, pathname]);

    const isDashboardActive =
        pathname === dashboardPath ||
        pathname === '/dashboard' ||
        pathname === '/dashboard/admin' ||
        pathname === '/dashboard/proktor' ||
        pathname === '/dashboard/guru' ||
        pathname === '/dashboard/siswa' ||
        pathname === '/dashboard/pengawas';

    // Load pinned pages
    useEffect(() => {
        const loadPinned = () => {
            try {
                const saved = localStorage.getItem('acca_cbt_pinned_default') || localStorage.getItem('acca_pinned_pages_default');
                if (saved) {
                    const parsed = JSON.parse(saved);
                    if (Array.isArray(parsed)) setPinned(parsed);
                }
            } catch {}
        };
        const initialLoad = window.setTimeout(loadPinned, 0);
        window.addEventListener('storage', loadPinned);
        return () => {
            window.clearTimeout(initialLoad);
            window.removeEventListener('storage', loadPinned);
        };
    }, []);

    // Subscribe to pageFab registry
    useEffect(() => {
        const initialLoad = window.setTimeout(() => setPageFab(getPageFab()), 0);
        const unsubscribeFab = subscribePageFab(fab => setPageFab(fab));
        return () => {
            window.clearTimeout(initialLoad);
            unsubscribeFab();
        };
    }, []);

    // Reset sheet saat pindah halaman
    useEffect(() => {
        const closeSheet = window.setTimeout(() => setIsPinnedOpen(false), 0);
        return () => window.clearTimeout(closeSheet);
    }, [pathname]);

    const handleBack = () => {
        if (typeof window !== 'undefined') {
            if (window.history.length > 1) {
                router.back();
            } else {
                router.push(dashboardPath);
            }
        }
    };

    const handleScrollTop = useCallback(() => {
        if (typeof window === 'undefined') return;

        const posOf = (t: Window | HTMLElement) => (t === window ? window.scrollY : (t as HTMLElement).scrollTop);

        const targets: Array<Window | HTMLElement> = [window];
        document.querySelectorAll<HTMLElement>('.dashboard-main, .main-content, .content-area').forEach(el => {
            if (el.scrollTop > 0) targets.push(el);
        });

        const awal = targets.map(posOf);
        targets.forEach(t => t.scrollTo({ top: 0, behavior: 'smooth' }));

        window.setTimeout(() => {
            targets.forEach((t, i) => {
                if (posOf(t) > 0 && posOf(t) === awal[i]) t.scrollTo({ top: 0, behavior: 'auto' });
            });
        }, 400);
    }, []);

    const pinnedItems = useMemo(() => {
        return pinned
            .filter(href => Boolean(href) && typeof href === 'string')
            .map(href => {
                const label = PAGE_LABELS[href] || href.split('/').pop()?.replace('-', ' ') || href;
                return {
                    href,
                    label: label.charAt(0).toUpperCase() + label.slice(1),
                    active: pathname === href,
                };
            });
    }, [pinned, pathname]);

    return (
        <>
            <nav className="bnav" aria-label="Navigasi Utama">
                {/* 1. Kembali */}
                <button
                    type="button"
                    className="bnav__item"
                    onClick={handleBack}
                    title="Kembali ke halaman sebelumnya"
                    aria-label="Kembali"
                >
                    <span className="bnav__iconWrap">
                        <Undo2 size={22} strokeWidth={1.5} className="bnav__icon" aria-hidden="true" />
                    </span>
                    <span className="bnav__label">Kembali</span>
                </button>

                {/* 2. Beranda */}
                <button
                    type="button"
                    className={`bnav__item ${isDashboardActive ? 'isActive' : ''}`}
                    onClick={() => router.push(dashboardPath)}
                    title="Beranda"
                    aria-label="Beranda"
                >
                    <span className="bnav__iconWrap">
                        <Home size={22} strokeWidth={1.5} className="bnav__icon" aria-hidden="true" />
                    </span>
                    <span className="bnav__label">Beranda</span>
                </button>

                {/* 3. Tombol Tengah Menonjol (FAB) */}
                <div className="bnav__center-wrapper">
                    {pageFab ? (
                        <button
                            type="button"
                            className="bnav__fab"
                            onClick={() => pageFab.run()}
                            aria-label={pageFab.label}
                            title={pageFab.label}
                        >
                            <span className="bnav__fab-icon">{pageFab.label.charAt(0)}</span>
                        </button>
                    ) : (
                        <button
                            type="button"
                            className="bnav__fab"
                            onClick={onOpenMenu}
                            aria-label="Buka Menu"
                            title="Buka Menu"
                        >
                            <Image src="/bottomnav.svg" alt="ACCA" width={48} height={48} className="bnav__fab-logo" />
                        </button>
                    )}
                </div>

                {/* 4. Ke Atas */}
                <button
                    type="button"
                    className="bnav__item"
                    onClick={handleScrollTop}
                    title="Kembali ke atas halaman"
                    aria-label="Ke Atas"
                >
                    <span className="bnav__iconWrap">
                        <ArrowUp size={22} strokeWidth={1.5} className="bnav__icon" aria-hidden="true" />
                    </span>
                    <span className="bnav__label">Ke Atas</span>
                </button>

                {/* 5. Pintasan (Pinned Pages Drawer) */}
                <button
                    type="button"
                    className={`bnav__item ${isPinnedOpen ? 'isActive' : ''}`}
                    onClick={() => {
                        if (pinnedItems.length === 1) {
                            router.push(pinnedItems[0].href);
                            return;
                        }
                        setIsPinnedOpen(!isPinnedOpen);
                    }}
                    title="Pintasan Menu"
                    aria-label="Pintasan Menu"
                >
                    <span className="bnav__iconWrap">
                        <Pin size={22} strokeWidth={1.5} className="bnav__icon" aria-hidden="true" />
                        {pinnedItems.length > 0 && (
                            <span className="bnav__badge" style={{ background: '#3083FF' }}>
                                {pinnedItems.length > 9 ? '9+' : pinnedItems.length}
                            </span>
                        )}
                    </span>
                    <span className="bnav__label">Pintasan</span>
                </button>
            </nav>

            {/* Bottom Sheet Drawer: Pintasan Menu (Pinned Pages) */}
            {isPinnedOpen && (
                <div className="bnav__sheet-backdrop" onClick={() => setIsPinnedOpen(false)}>
                    <div className="bnav__sheet" onClick={e => e.stopPropagation()} style={{ display: 'flex', flexDirection: 'column' }}>
                        <div className="bnav__sheet-handle" />
                        <div className="bnav__sheet-header">
                            <div className="bnav__sheet-title-wrap">
                                <h3 className="bnav__sheet-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <Pin size={18} style={{ color: '#3083FF' }} />
                                    <span>Pintasan Menu</span>
                                </h3>
                            </div>
                            <button
                                type="button"
                                className="bnav__sheet-close"
                                onClick={() => setIsPinnedOpen(false)}
                                aria-label="Tutup"
                            >
                                <X size={18} />
                            </button>
                        </div>

                        <div className="bnav__sheet-body" style={{ overflowY: 'auto', padding: '14px 16px 24px' }}>
                            {pinnedItems.length === 0 ? (
                                <div className="text-center py-6" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px', color: '#64748b' }}>
                                    <div style={{ width: 48, height: 48, borderRadius: '50%', background: '#E0ECFF', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#2563eb' }}>
                                        <Pin size={24} />
                                    </div>
                                    <div style={{ maxWidth: 260 }}>
                                        <div style={{ fontWeight: 700, color: '#112E59', fontSize: '0.95rem', marginBottom: 4 }}>Belum Ada Pintasan</div>
                                        <p style={{ margin: 0, fontSize: '0.82rem', color: '#64748b', lineHeight: 1.4 }}>
                                            Buka menu sidebar dan tekan ikon bintang pada menu favorit Anda untuk menambahkannya di sini.
                                        </p>
                                    </div>
                                    <button
                                        type="button"
                                        style={{ marginTop: 6, padding: '8px 18px', background: '#3083FF', color: '#fff', border: 'none', borderRadius: '999px', fontSize: '0.85rem', fontWeight: 700, cursor: 'pointer' }}
                                        onClick={() => {
                                            setIsPinnedOpen(false);
                                            onOpenMenu();
                                        }}
                                    >
                                        Buka Semua Menu
                                    </button>
                                </div>
                            ) : (
                                <div className="bnav__sheet-grid">
                                    {pinnedItems.map(item => (
                                        <button
                                            key={item.href}
                                            type="button"
                                            className={`bnav__sheet-tab-btn ${item.active ? 'is-active' : ''}`}
                                            onClick={() => {
                                                setIsPinnedOpen(false);
                                                router.push(item.href);
                                            }}
                                        >
                                            <div className="bnav__sheet-tab-icon">
                                                <Pin size={18} />
                                            </div>
                                            <div className="bnav__sheet-tab-info">
                                                <span className="bnav__sheet-tab-title">{item.label}</span>
                                            </div>
                                            {item.active && (
                                                <div className="bnav__sheet-tab-check-wrap">
                                                    <CheckCircle2 size={20} className="bnav__sheet-tab-check" />
                                                </div>
                                            )}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
