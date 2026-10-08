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
 * 5. Pintasan (Pinned Pages): membuka Bottom Sheet Menu Pintasan.
 */

import React, { useEffect, useMemo, useState, useCallback } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { Undo2, Home, ArrowUp, X, CheckCircle2, Pin } from 'lucide-react'
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

const PAGE_ICONS: Record<string, string> = {
    'dashboard': 'house-door-fill',
    'beranda': 'house-door-fill',
    'learning': 'book-open',
    'classes': 'school',
    'questions': 'journal-text',
    'exams': 'clipboard-check-fill',
    'monitoring': 'eye-fill',
    'backup': 'database-fill',
    'schedule': 'calendar-week-fill',
    'results': 'award-fill',
    'analytics': 'graph-up',
    'notifications': 'bell-fill',
    'settings': 'gear-fill',
    // Indonesian aliases
    'bank-soal': 'journal-text',
    'ujian': 'clipboard-check-fill',
    'kelas': 'school',
    'jadwal': 'calendar-week-fill',
    'bahan-ajar': 'book-open',
    'hasil-ujian': 'award-fill',
    'analisis': 'graph-up',
    'notifikasi': 'bell-fill',
    'pengaturan': 'gear-fill',
}

const PAGE_LABELS: Record<string, string> = {
    'dashboard': 'Beranda',
    'beranda': 'Beranda',
    'learning': 'Bahan Ajar',
    'classes': 'Kelas',
    'questions': 'Bank Soal',
    'exams': 'Ujian',
    'monitoring': 'Monitoring',
    'backup': 'Backup Data',
    'schedule': 'Jadwal Ujian',
    'results': 'Hasil Ujian',
    'analytics': 'Analisis',
    'notifications': 'Notifikasi',
    'settings': 'Pengaturan Umum',
}

export default function BottomNav({
    onOpenMenu,
    activeRole,
    onNavigate,
    user,
    badges = {},
}: BottomNavProps) {
    const router = useRouter()
    const pathname = usePathname() || '/dashboard'

    const [pageFab, setPageFab] = useState<PageFab | null>(null)
    const [isPinnedOpen, setIsPinnedOpen] = useState(false)
    const [pinned, setPinned] = useState<string[]>([])
    const [customMenuLabels, setCustomMenuLabels] = useState<Record<string, string>>({})

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

    // Muat daftar pinned pages dari localStorage & sinkronisasi
    useEffect(() => {
        const userKey = user?.auth_id || user?.id || user?.email || 'default'
        let localPins: string[] = []
        try {
            const keysToTry = [
                `acca_pinned_pages_${userKey}`,
                `acca_cbt_pinned_${userKey}`,
                'acca_cbt_pinned_default',
                'acca_pinned_pages_default',
            ]

            for (const k of keysToTry) {
                const p = localStorage.getItem(k)
                if (p) {
                    const arr = JSON.parse(p)
                    if (Array.isArray(arr) && arr.length > 0) {
                        localPins = arr
                        setPinned(arr)
                        break
                    }
                }
            }

            const lbls = localStorage.getItem('acca_menu_labels')
            if (lbls) {
                const obj = JSON.parse(lbls)
                if (obj && typeof obj === 'object') setCustomMenuLabels(obj)
            }
        } catch {}

        // Bila ada API pinned-pages di server, fetch juga
        fetch('/api/user/pinned-pages')
            .then(r => r.json())
            .then(d => {
                if (d?.ok && Array.isArray(d.data)) {
                    if (d.data.length > 0) {
                        setPinned(d.data)
                        try {
                            localStorage.setItem(`acca_pinned_pages_${userKey}`, JSON.stringify(d.data))
                        } catch {}
                    } else if (localPins.length > 0) {
                        fetch('/api/user/pinned-pages', {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ pinned: localPins }),
                        }).catch(() => {})
                    }
                }
            })
            .catch(() => {})
    }, [user?.auth_id, user?.id, user?.email])

    // Sinkronisasi realtime saat pin diubah
    useEffect(() => {
        const userKey = user?.auth_id || user?.id || user?.email || 'default'
        const handlePinChange = () => {
            try {
                const keysToTry = [
                    `acca_pinned_pages_${userKey}`,
                    `acca_cbt_pinned_${userKey}`,
                    'acca_cbt_pinned_default',
                    'acca_pinned_pages_default',
                ]

                for (const k of keysToTry) {
                    const p = localStorage.getItem(k)
                    if (p) {
                        const arr = JSON.parse(p)
                        if (Array.isArray(arr)) {
                            setPinned(arr)
                            break
                        }
                    }
                }
                const lbls = localStorage.getItem('acca_menu_labels')
                if (lbls) {
                    const obj = JSON.parse(lbls)
                    if (obj && typeof obj === 'object') setCustomMenuLabels(obj)
                }
            } catch {}
        }
        window.addEventListener('acca:pinned-change', handlePinChange)
        window.addEventListener('storage', handlePinChange)
        return () => {
            window.removeEventListener('acca:pinned-change', handlePinChange)
            window.removeEventListener('storage', handlePinChange)
        }
    }, [user?.auth_id, user?.id, user?.email])

    // Subscribe to pageFab registry (aksi utama halaman)
    useEffect(() => {
        setPageFab(getPageFab())
        const unsubscribeFab = subscribePageFab(fab => setPageFab(fab))
        return () => {
            unsubscribeFab()
        }
    }, [])

    // Reset sheet saat pindah halaman
    useEffect(() => {
        setIsPinnedOpen(false)
    }, [pathname])

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

    const labelOf = useCallback((keyOrPath: string) => {
        if (customMenuLabels[keyOrPath]) return customMenuLabels[keyOrPath]
        const cleanKey = keyOrPath.replace(/^\//, '').split('?')[0].split('#')[0]
        const parts = cleanKey.split('/')
        const lastPart = parts[parts.length - 1] || 'dashboard'

        if (PAGE_LABELS[cleanKey]) return PAGE_LABELS[cleanKey]
        if (PAGE_LABELS[lastPart]) return PAGE_LABELS[lastPart]

        return lastPart
            .split('-')
            .map(s => s.charAt(0).toUpperCase() + s.slice(1))
            .join(' ')
    }, [customMenuLabels])

    const iconOf = useCallback((keyOrPath: string) => {
        const cleanKey = keyOrPath.replace(/^\//, '').split('?')[0].split('#')[0]
        const parts = cleanKey.split('/')
        const lastPart = parts[parts.length - 1] || 'dashboard'

        return PAGE_ICONS[cleanKey] || PAGE_ICONS[lastPart] || 'file-earmark-text-fill'
    }, [])

    const pinnedItems = useMemo(() => {
        return pinned
            .filter(id => Boolean(id) && typeof id === 'string')
            .map(id => {
                const targetPath = id.startsWith('/') ? id : `/${id}`
                return {
                    id,
                    targetPath,
                    label: labelOf(id),
                    icon: iconOf(id),
                    active: pathname === targetPath || (targetPath !== '/' && pathname.startsWith(targetPath)),
                }
            })
    }, [pinned, labelOf, iconOf, pathname])

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

                {/* 5. Pintasan (Halaman Disematkan / Pinned Pages) */}
                <button
                    type="button"
                    className={`bnav__item ${isPinnedOpen ? 'isActive' : ''}`}
                    onClick={() => {
                        // Jika hanya 1 menu yang di-pin, langsung navigasi tanpa membuka modal
                        if (pinnedItems.length === 1) {
                            handleNavigate(pinnedItems[0].targetPath)
                            return
                        }
                        setIsPinnedOpen(!isPinnedOpen)
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
                                            Buka menu sidebar dan pilih menu favorit Anda untuk menambahkannya di sini.
                                        </p>
                                    </div>
                                    <button
                                        type="button"
                                        style={{ marginTop: 6, padding: '8px 18px', background: '#3083FF', color: '#fff', border: 'none', borderRadius: '999px', fontSize: '0.85rem', fontWeight: 700, cursor: 'pointer' }}
                                        onClick={() => {
                                            setIsPinnedOpen(false)
                                            onOpenMenu()
                                        }}
                                    >
                                        Buka Semua Menu
                                    </button>
                                </div>
                            ) : (
                                <div className="bnav__sheet-grid">
                                    {pinnedItems.map(item => (
                                        <button
                                            key={item.id}
                                            type="button"
                                            className={`bnav__sheet-tab-btn ${item.active ? 'is-active' : ''}`}
                                            onClick={() => {
                                                setIsPinnedOpen(false)
                                                handleNavigate(item.targetPath)
                                            }}
                                        >
                                            <div className="bnav__sheet-tab-icon">
                                                <LucideIcon name={item.icon || 'file-text'} size={19} />
                                            </div>
                                            <div className="bnav__sheet-tab-info">
                                                <span className="bnav__sheet-tab-title">{item.label}</span>
                                            </div>
                                            {(badges[item.id] || 0) > 0 && (
                                                <span className="bnav__badge" style={{ position: 'static', marginLeft: 'auto', flexShrink: 0 }}>
                                                    {badges[item.id] > 9 ? '9+' : badges[item.id]}
                                                </span>
                                            )}
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
    )
}
