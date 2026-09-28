'use client';

import Image from 'next/image';

import { Activity,ArrowUp,Home,Undo2 } from 'lucide-react';
import { usePathname,useRouter } from 'next/navigation';
import { useMemo } from 'react';
import './bottom-nav.css';

interface BottomNavProps {
    onOpenMenu: () => void;
    activeRole?: string | null;
}

export default function BottomNav({ onOpenMenu, activeRole }: BottomNavProps) {
    const router = useRouter();
    const pathname = usePathname();

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

    // Tentukan rute monitoring berdasarkan peran
    const monitoringPath = useMemo(() => {
        const r = (activeRole || '').toLowerCase();
        if (r.includes('siswa')) return '/dashboard/siswa/analytics';
        if (r.includes('guru')) return '/dashboard/guru/monitoring';
        if (r.includes('proktor')) return '/dashboard/proktor/monitoring';
        if (r.includes('admin')) return '/dashboard/admin/monitoring';
        if (r.includes('pengawas')) return '/dashboard/pengawas/monitoring';

        if (pathname.includes('/siswa')) return '/dashboard/siswa/analytics';
        if (pathname.includes('/guru')) return '/dashboard/guru/monitoring';
        if (pathname.includes('/proktor')) return '/dashboard/proktor/monitoring';
        if (pathname.includes('/admin')) return '/dashboard/admin/monitoring';
        if (pathname.includes('/pengawas')) return '/dashboard/pengawas/monitoring';
        return '/dashboard/admin/monitoring';
    }, [activeRole, pathname]);

    const isDashboardActive =
        pathname === dashboardPath ||
        pathname === '/dashboard' ||
        pathname === '/dashboard/admin' ||
        pathname === '/dashboard/proktor' ||
        pathname === '/dashboard/guru' ||
        pathname === '/dashboard/siswa' ||
        pathname === '/dashboard/pengawas';

    const isMonitoringActive =
        pathname.includes('/monitoring') ||
        (pathname.includes('/siswa') && pathname.includes('/analytics'));

    const handleBack = () => {
        if (typeof window !== 'undefined') {
            if (window.history.length > 1) {
                router.back();
            } else {
                router.push(dashboardPath);
            }
        }
    };

    const handleScrollTop = () => {
        if (typeof window !== 'undefined') {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
    };

    return (
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

            {/* 3. Tombol Tengah Menonjol (FAB) — Membuka Menu Sidebar */}
            <div className="bnav__center-wrapper">
                <button
                    type="button"
                    className="bnav__fab"
                    onClick={onOpenMenu}
                    aria-label="Buka Menu"
                    title="Buka Menu"
                >
                    <Image src="/bottomnav.svg" alt="ACCA" width={48} height={48} className="bnav__fab-logo" />
                </button>
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

            {/* 5. Monitoring */}
            <button
                type="button"
                className={`bnav__item ${isMonitoringActive ? 'isActive' : ''}`}
                onClick={() => router.push(monitoringPath)}
                title="Monitoring"
                aria-label="Monitoring"
            >
                <span className="bnav__iconWrap">
                    <Activity size={22} strokeWidth={1.5} className="bnav__icon" aria-hidden="true" />
                </span>
                <span className="bnav__label">Monitoring</span>
            </button>
        </nav>
    );
}