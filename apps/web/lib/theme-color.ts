'use client'

/**
 * Warna chrome browser (bilah status baterai/jaringan di HP) disamakan dengan
 * lapisan yang sedang menutupi halaman.
 *
 * Disamakan dengan acca-new.
 */

type Rgba = { r: number; g: number; b: number; a: number }

function parseColor(input: string): Rgba | null {
    const s = (input || '').trim()
    if (!s || s === 'transparent') return null
    const m = s.match(/^rgba?\(([^)]+)\)$/i)
    if (m) {
        const p = m[1].split(/[,/]+/).map(v => v.trim())
        if (p.length < 3) return null
        const r = parseFloat(p[0]), g = parseFloat(p[1]), b = parseFloat(p[2])
        const a = p.length > 3 ? parseFloat(p[3]) : 1
        if ([r, g, b, a].some(Number.isNaN)) return null
        return { r, g, b, a }
    }
    const hex = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)
    if (hex) {
        const h = hex[1]
        const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h
        return {
            r: parseInt(full.slice(0, 2), 16),
            g: parseInt(full.slice(2, 4), 16),
            b: parseInt(full.slice(4, 6), 16),
            a: 1,
        }
    }
    return null
}

/** Tumpuk `top` (boleh semi-transparan) di atas `base` yang sudah opaque. */
function blend(top: Rgba, base: Rgba): Rgba {
    const a = Math.min(Math.max(top.a, 0), 1)
    return {
        r: top.r * a + base.r * (1 - a),
        g: top.g * a + base.g * (1 - a),
        b: top.b * a + base.b * (1 - a),
        a: 1,
    }
}

function toHex({ r, g, b }: Rgba): string {
    const c = (v: number) => Math.round(Math.min(Math.max(v, 0), 255)).toString(16).padStart(2, '0')
    return `#${c(r)}${c(g)}${c(b)}`
}

/** Warna dasar yang harus ditiru chrome browser saat tak ada lapisan apa pun. */
function baseColor(): Rgba {
    const dark = document.documentElement.classList.contains('dark')

    // Paksa browser menghitung ulang gaya SEBELUM membaca --bnav-face.
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    document.documentElement.offsetHeight

    // SIDEBAR MOBILE TERBUKA menang atas segalanya. Saat terbuka, panel itulah
    // yang memenuhi layar dari atas sampai bawah.
    const sidebarTerbuka = document.querySelector('.dashboard-layout.sidebar-mobile-open')
    const sidebar = sidebarTerbuka ? document.querySelector('.sidebar') : null
    const sidebarBg = sidebar ? getComputedStyle(sidebar).backgroundColor : ''

    const nav = document.querySelector('.bnav')
    const navFace = nav ? getComputedStyle(nav).getPropertyValue('--bnav-face') : ''

    const ambient = document.querySelector('.acca-ambient-bg')
    const navDefault = dark ? '#000000' : '#ffffff'
    const candidates = [
        sidebarBg,
        navFace,
        navDefault,
        ambient ? getComputedStyle(ambient).backgroundColor : '',
        getComputedStyle(document.body).backgroundColor,
    ]
    for (const c of candidates) {
        const parsed = parseColor(c)
        if (parsed && parsed.a > 0.95) return parsed
    }
    return dark ? { r: 0, g: 0, b: 0, a: 1 } : { r: 255, g: 255, b: 255, a: 1 }
}

/**
 * Lapisan teratas yang sedang menutupi layar, atau null kalau tidak ada.
 */
function topOverlayColor(): Rgba | null {
    const vw = window.innerWidth
    const vh = window.innerHeight
    let best: { z: number; color: Rgba } | null = null

    const consider = (el: Element) => {
        const cs = getComputedStyle(el)
        if (cs.position !== 'fixed') return
        if (cs.visibility === 'hidden' || cs.display === 'none') return

        const zRaw = parseInt(cs.zIndex, 10)
        if ((Number.isNaN(zRaw) || zRaw <= 0) && cs.pointerEvents === 'none') return

        const rect = el.getBoundingClientRect()
        if (rect.width < vw * 0.9 || rect.height < vh * 0.9) return

        const color = parseColor(cs.backgroundColor)
        if (!color || color.a <= 0.01) return

        const z = parseInt(cs.zIndex, 10)
        const zi = Number.isNaN(z) ? 0 : z

        if (!best || zi >= best.z) best = { z: zi, color }
    }

    for (const el of Array.from(document.body.children)) {
        consider(el)
        if (el.classList.contains('swal2-container')) {
            for (const child of Array.from(el.children)) consider(child)
        }
    }
    return best ? (best as { z: number; color: Rgba }).color : null
}

/**
 * Dapatkan atau buat node <meta name="theme-color"> di <head>.
 */
function getThemeColorMetas(): HTMLMetaElement[] {
    const list = Array.from(document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]'))
    if (list.length > 0) return list

    const meta = document.createElement('meta')
    meta.name = 'theme-color'
    meta.id = 'theme-color-meta'
    meta.content = '#ffffff'
    document.head.appendChild(meta)
    return [meta]
}

/** Sinkronkan <meta name="color-scheme"> */
function syncColorSchemeMeta(dark: boolean): void {
    let cs = document.querySelector<HTMLMetaElement>('meta[name="color-scheme"]')
    if (!cs) {
        cs = document.createElement('meta')
        cs.name = 'color-scheme'
        cs.id = 'color-scheme-meta'
        document.head.appendChild(cs)
    }
    const val = dark ? 'dark' : 'light'
    if (cs.content !== val) {
        cs.content = val
        cs.setAttribute('content', val)
    }
}

/**
 * Hitung ulang dan pasang <meta name="theme-color">, color-scheme, dan latar dokumen.
 */
export function applyThemeColor(): void {
    if (typeof document === 'undefined') return

    const dark = document.documentElement.classList.contains('dark')
    const base = baseColor()
    const overlay = topOverlayColor()
    const next = toHex(overlay ? blend(overlay, base) : base)

    const metas = getThemeColorMetas()
    metas.forEach(meta => {
        if (meta.content !== next) {
            meta.setAttribute('content', next)
            meta.content = next
        }
    })

    syncColorSchemeMeta(dark)
    const schemeVal = dark ? 'dark' : 'light'
    if (document.documentElement.style.colorScheme !== schemeVal) {
        document.documentElement.style.colorScheme = schemeVal
    }

    if (document.documentElement.style.backgroundColor !== next) {
        document.documentElement.style.backgroundColor = next
    }
    if (document.body && document.body.style.backgroundColor !== next) {
        document.body.style.backgroundColor = next
    }
}
