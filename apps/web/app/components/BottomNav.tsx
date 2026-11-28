'use client'

/**
 * BottomNav — Navigasi utama mobile, menempel di dasar layar.
 * Pola dan implementasi sama persis dengan acca-new.
 *
 * 5 Slot dengan Tombol Tengah Menonjol (Prominent Center FAB):
 * 1. Kembali (Back)
 * 2. Beranda (Dashboard)
 * 3. MENU / FAB (Tengah Menonjol):
 *    - Bila halaman mendaftarkan aksi utama via page-fab (misal: Tambah Soal / Tambah Kelas),
 *      tombol ini mengeksekusi aksi tersebut dengan LucideIcon.
 *    - Bila tidak ada aksi, tombol menampilkan lambang bottomnav.svg secara statis (bukan tombol menu).
 * 4. Ke Atas (Scroll to Top): menggulirkan halaman kembali ke puncak dengan mulus.
 * 5. Pintasan: siswa langsung ke Jadwal; peran lain langsung ke Monitoring.
 */

import React, { useEffect, useMemo, useState, useCallback } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { Undo2, Home, ArrowUp, CalendarDays, LineChart } from 'lucide-react'
import LucideIcon from './ui/LucideIcon'
import { getPageFab, subscribePageFab, type PageFab } from './mobile/page-fab'
import './bottom-nav.css'

interface BottomNavProps {
    onOpenMenu: () => void
    activeRole?: string | null
    onNavigate?: (page: string) => void
    user?: any
    currentPage?: string
    pageTitle?: string
    badges?: Record<string, number>
}

export default function BottomNav({
    activeRole,
    onNavigate,
}: BottomNavProps) {
    const router = useRouter()
    const pathname = usePathname() || '/dashboard'

    const [pageFab, setPageFab] = useState<PageFab | null>(null)

    // Tentukan rute dashboard utama berdasarkan peran (role-based)
    const dashboardPath = useMemo(() => {
        const r = (activeRole || '').toLowerCase()
        if (r.includes('siswa')) return '/dashboard/siswa'
        if (r.includes('guru')) return '/dashboard/guru'
        if (r.includes('proktor')) return '/dashboard/proktor'
        if (r.includes('admin')) return '/dashboard/admin'
        if (r.includes('pengawas')) return '/dashboard/pengawas'

        if (pathname.includes('/siswa')) return '/dashboard/siswa'
        if (pathname.includes('/guru')) return '/dashboard/guru'
        if (pathname.includes('/proktor')) return '/dashboard/proktor'
        if (pathname.includes('/admin')) return '/dashboard/admin'
        if (pathname.includes('/pengawas')) return '/dashboard/pengawas'
        return '/dashboard'
    }, [activeRole, pathname])

    const isDashboardActive =
        pathname === dashboardPath ||
        pathname === '/dashboard' ||
        pathname === '/dashboard/admin' ||
        pathname === '/dashboard/proktor' ||
        pathname === '/dashboard/guru' ||
        pathname === '/dashboard/siswa' ||
        pathname === '/dashboard/pengawas'

    const handleNavigate = useCallback((target: string) => {
        const fullPath = target.startsWith('/') ? target : `/${target}`
        if (onNavigate) {
            onNavigate(fullPath)
        } else {
            router.push(fullPath)
        }
    }, [onNavigate, router])

    // Subscribe to pageFab registry (aksi utama halaman)
    useEffect(() => {
        setPageFab(getPageFab())
        const unsubscribeFab = subscribePageFab(fab => setPageFab(fab))
        return () => {
            unsubscribeFab()
        }
    }, [])

    /* Gulir ke puncak. Di mobile yang menggulir adalah dokumen (window).
       Juga menurunkan scrollTop pada ancestor yang mungkin sedang tergulir. */
    const scrollToTop = useCallback(() => {
        if (typeof window === 'undefined') return

        const posOf = (t: Window | HTMLElement) => (t === window ? window.scrollY : (t as HTMLElement).scrollTop)

        const targets: Array<Window | HTMLElement> = [window]
        document.querySelectorAll<HTMLElement>('.dashboard-main, .main-content, .content-area').forEach(el => {
            if (el.scrollTop > 0) targets.push(el)
        })

        const awal = targets.map(posOf)
        targets.forEach(t => t.scrollTo({ top: 0, behavior: 'smooth' }))

        window.setTimeout(() => {
            targets.forEach((t, i) => {
                if (posOf(t) > 0 && posOf(t) === awal[i]) t.scrollTo({ top: 0, behavior: 'auto' })
            })
        }, 400)
    }, [])

    // Pintasan: siswa → Jadwal Ujian; Guru/Proktor/Admin/Pengawas → Monitoring.
    const isStudent = dashboardPath === '/dashboard/siswa'
    const shortcut = dashboardPath === '/dashboard' ? null : isStudent
        ? { path: '/dashboard/siswa/schedule', label: 'Jadwal', title: 'Jadwal Ujian', Icon: CalendarDays }
        : { path: `${dashboardPath}/monitoring`, label: 'Monitoring', title: 'Monitoring Ujian', Icon: LineChart }
    const isShortcutActive = Boolean(shortcut && pathname.startsWith(shortcut.path))

    return (
        <>
            {/* Bilah Navigasi Bawah */}
            <nav className="bnav" aria-label="Navigasi Utama">
                {/* 1. Kembali */}
                <button
                    type="button"
                    className="bnav__item"
                    onClick={() => {
                        if (typeof window !== 'undefined') {
                            if (window.history.length > 1) {
                                router.back()
                            } else {
                                handleNavigate(dashboardPath)
                            }
                        }
                    }}
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
                    onClick={() => handleNavigate(dashboardPath)}
                    title="Beranda"
                    aria-label="Beranda"
                >
                    <span className="bnav__iconWrap">
                        <Home size={22} strokeWidth={1.5} className="bnav__icon" aria-hidden="true" />
                    </span>
                    <span className="bnav__label">Beranda</span>
                </button>

                {/* 3. TOMBOL TENGAH MENONJOL — aksi utama halaman (Prominent Center FAB) */}
                <div className="bnav__center-wrapper">
                    {pageFab ? (
                        <button
                            type="button"
                            className="bnav__fab"
                            onClick={() => pageFab.run()}
                            aria-label={pageFab.label}
                            title={pageFab.label}
                        >
                            <LucideIcon
                                name={pageFab.icon}
                                size={24}
                                strokeWidth={2}
                                className="bnav__fab-icon"
                                aria-hidden="true"
                            />
                        </button>
                    ) : (
                        /* <div>, bukan <button>: lambang bottomnav.svg statis, tidak ada aksi di sini */
                        <div className="bnav__fab bnav__fab--static" aria-hidden="true">
                            <img src="/bottomnav.svg" alt="" className="bnav__fab-logo" />
                        </div>
                    )}
                </div>

                {/* 4. Ke Atas — gulirkan halaman kembali ke puncak */}
                <button
                    type="button"
                    className="bnav__item"
                    onClick={scrollToTop}
                    title="Kembali ke atas halaman"
                    aria-label="Kembali ke atas halaman"
                >
                    <span className="bnav__iconWrap">
                        <ArrowUp size={22} strokeWidth={1.5} className="bnav__icon" aria-hidden="true" />
                    </span>
                    <span className="bnav__label">Ke Atas</span>
                </button>

                {/* 5. Pintasan — siswa: Jadwal; peran lain: Monitoring */}
                {shortcut && (
                    <button
                        type="button"
                        className={`bnav__item ${isShortcutActive ? 'isActive' : ''}`}
                        onClick={() => handleNavigate(shortcut.path)}
                        title={shortcut.title}
                        aria-label={shortcut.title}
                        aria-current={isShortcutActive ? 'page' : undefined}
                    >
                        <span className="bnav__iconWrap">
                            <shortcut.Icon size={22} strokeWidth={1.5} className="bnav__icon" aria-hidden="true" />
                        </span>
                        <span className="bnav__label">{shortcut.label}</span>
                    </button>
                )}
            </nav>

        </>
    )
}
