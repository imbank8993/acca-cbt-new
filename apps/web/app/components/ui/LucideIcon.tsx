import React from 'react'
import * as LucideIcons from 'lucide-react'
import type { LucideProps } from 'lucide-react'

// Kamus terjemahan otomatis nama icon dari format Bootstrap Icons / legacy string ke nama Lucide Icon
const ICON_MAP: Record<string, string> = {
    // Navigasi & Umum
    'house': 'Home',
    'house-door': 'Home',
    'house-door-fill': 'Home',
    'home': 'Home',
    'dashboard': 'LayoutDashboard',
    'grid': 'LayoutGrid',
    // Bootstrap menamainya "grid-3x3-gap"; PascalCase-nya (Grid3x3GapFill)
    // tidak ada di lucide, jadi tanpa entri ini ia jatuh ke ikon "?"
    // (LucideIcons.FileQuestion) — itu yang muncul di tab Rekap Nilai.
    'grid-3x3': 'Grid3x3',
    'grid-3x3-gap': 'LayoutGrid',
    'grid-3x3-gap-fill': 'LayoutGrid',
    'menu': 'Menu',
    'list': 'List',
    'bars': 'Menu',
    'search': 'Search',
    'gear': 'Settings',
    'gear-fill': 'Settings',
    'sliders': 'SlidersHorizontal',
    'info-circle': 'Info',
    'info-circle-fill': 'Info',
    'x': 'X',
    'x-lg': 'X',
    'check': 'Check',
    'check2': 'Check',
    'check-lg': 'Check',
    'check-circle': 'CheckCircle2',
    'check-circle-fill': 'CheckCircle2',
    'check2-square': 'CheckSquare',
    'clipboard-check': 'ClipboardCheck',
    'clipboard-check-fill': 'ClipboardCheck',
    'clipboard2-check-fill': 'ClipboardCheck',
    'chevron-right': 'ChevronRight',
    'chevron-left': 'ChevronLeft',
    'chevron-down': 'ChevronDown',
    'chevron-up': 'ChevronUp',
    'arrow-left': 'ArrowLeft',
    'arrow-left-short': 'ArrowLeft',
    'arrow-right': 'ArrowRight',
    'arrow-right-short': 'ArrowRight',
    'arrow-up-short': 'ArrowUp',
    'arrow-down-short': 'ArrowDown',
    'arrow-left-right': 'ArrowLeftRight',

    // Kalender & Waktu
    'calendar': 'Calendar',
    'calendar-fill': 'Calendar',
    'calendar3': 'CalendarDays',
    'calendar-week': 'CalendarRange',
    'calendar-week-fill': 'CalendarRange',
    // Bootstrap punya dua rupa kalender ("calendar2-*" versi tipis). Angka 2 di
    // tengah nama membuat PascalCase-nya jadi "Calendar2Week", yang tidak ada di
    // lucide — tanpa entri ini ia jatuh ke ikon "?" (tab Kelola Sesi di Klinik
    // dan tab jadwal di Kinerja Guru).
    'calendar2-week': 'CalendarRange',
    'calendar2': 'Calendar',
    'calendar2-check': 'CalendarCheck',
    'calendar2-event': 'CalendarDays',
    'calendar-check': 'CalendarCheck',
    'calendar-check-fill': 'CalendarCheck',
    'calendar-x': 'CalendarX',
    'calendar-x-fill': 'CalendarX',
    'calendar-plus': 'CalendarPlus',
    'calendar-event': 'CalendarDays',
    'calendar-event-fill': 'CalendarDays',
    'clock': 'Clock',
    'clock-fill': 'Clock',
    'clock-history': 'History',

    // Pengumuman & Notifikasi
    'bell': 'Bell',
    'bell-fill': 'Bell',
    'megaphone': 'Megaphone',
    'megaphone-fill': 'Megaphone',
    'chat': 'MessageSquare',
    'chat-dots': 'MessageSquareText',
    'chat-heart-fill': 'HeartHandshake',
    'envelope': 'Mail',
    'envelope-paper-fill': 'Mail',
    'send': 'Send',
    'send-fill': 'Send',

    // Akademik, Jadwal, & Jurnal
    'journal': 'BookOpen',
    'journal-text': 'BookOpen',
    'journal-bookmark-fill': 'BookMarked',
    'journal-check': 'BookCheck',
    'book': 'Book',
    'book-fill': 'Book',
    'pencil-square': 'Edit3',
    'pencil': 'Pencil',
    'mortarboard': 'GraduationCap',
    'mortarboard-fill': 'GraduationCap',
    'bar-chart-fill': 'BarChart3',
    'graph-up': 'TrendingUp',
    'graph-up-arrow': 'TrendingUp',
    'award': 'Award',
    'award-fill': 'Award',
    'trophy': 'Trophy',
    'trophy-fill': 'Trophy',
    'shield': 'Shield',
    'shield-fill': 'Shield',
    'shield-check': 'ShieldCheck',
    'shield-check-fill': 'ShieldCheck',
    'shield-fill-check': 'ShieldCheck',
    'speedometer2': 'Gauge',
    'compass-fill': 'Compass',

    // Pengguna, Guru, & Siswa
    'person': 'User',
    'person-fill': 'User',
    'person-plus': 'UserPlus',
    'person-plus-fill': 'UserPlus',
    'person-minus': 'UserMinus',
    'person-minus-fill': 'UserMinus',
    'person-dash': 'UserMinus',
    'person-dash-fill': 'UserMinus',
    'person-gear': 'UserCog',
    'person-badge': 'UserRoundPen',
    'person-badge-fill': 'UserRoundPen',
    'user-round-pen': 'UserRoundPen',
    'user-pen': 'UserRoundPen',
    'user-cog': 'UserCog',
    'upc-scan': 'UserCog',
    'person-check': 'UserCheck',
    'person-check-fill': 'UserCheck',
    'person-x-fill': 'UserX',
    'person-heart': 'HeartHandshake',
    // "orang di dalam bingkai video" — di lucide padanan terdekatnya papan
    // presentasi. Dipakai tab "Sesi Saya" (sesi yang diampu guru ybs).
    'person-video': 'Presentation',
    'person-video2': 'Presentation',
    'person-video3': 'Presentation',
    'person-workspace': 'Presentation',
    'people': 'Users',
    'people-fill': 'Users',
    'users': 'Users',

    // Sekolah, Kelas, & Ekskul
    'school': 'School',
    'grid-1x2': 'School',
    'grid-1x2-fill': 'School',
    'volleyball': 'Volleyball',
    'volleyball-fill': 'Volleyball',
    'list-task': 'Volleyball',
    'ekskul': 'Volleyball',
    'ekstrakurikuler': 'Volleyball',

    // Dokumen & File
    'file-earmark': 'File',
    'file-earmark-text': 'FileText',
    'file-earmark-text-fill': 'FileText',
    'file-earmark-check': 'FileCheck',
    'file-earmark-check-fill': 'FileCheck',
    'file-earmark-arrow-down': 'FileDown',
    'file-earmark-arrow-down-fill': 'FileDown',
    'file-earmark-arrow-up': 'FileUp',
    'file-earmark-arrow-up-fill': 'FileUp',
    'file-earmark-pdf': 'FileText',
    'file-earmark-pdf-fill': 'FileText',
    'file-earmark-person-fill': 'Contact',
    'file-earmark-word-fill': 'FileText',
    'file-text-fill': 'FileText',
    'file-spreadsheet': 'FileSpreadsheet',
    'file-earmark-spreadsheet': 'FileSpreadsheet',
    'file-excel': 'FileSpreadsheet',
    'file-excel-fill': 'FileSpreadsheet',
    'excel': 'FileSpreadsheet',
    'folder': 'Folder',
    'folder-fill': 'Folder',
    'download': 'Download',
    'box-arrow-down': 'Download',
    'upload': 'Upload',
    'cloud-arrow-up': 'UploadCloud',
    'cloud-arrow-up-fill': 'UploadCloud',
    'cloud-upload': 'UploadCloud',
    'cloud-arrow-down': 'DownloadCloud',
    'cloud-arrow-down-fill': 'DownloadCloud',
    'plus': 'Plus',
    'plus-lg': 'Plus',
    'plus-square-fill': 'PlusSquare',
    'trash': 'Trash2',
    'trash-fill': 'Trash2',
    'eye': 'Eye',
    'eye-fill': 'Eye',
    'eye-slash': 'EyeOff',
    'database-fill': 'Database',
    'ui-radios-grid': 'LayoutGrid',
    'card-checklist': 'ListChecks',
    'list-check': 'ListChecks',
    'clipboard-data-fill': 'ClipboardList',
    'clipboard2-pulse-fill': 'Activity',

    // Cuaca & Tema
    'sun': 'Sun',
    'sun-fill': 'Sun',
    'brightness-high-fill': 'SunMedium',
    'sunset-fill': 'Sunset',
    'moon': 'Moon',
    'moon-fill': 'Moon',
    'moon-stars-fill': 'Moon',
    'star': 'Star',
    'star-fill': 'Star',

    // Pengaturan & Modul Umum
    'building': 'Building2',
    'building-fill': 'Building2',
    'menu-button-wide': 'ListFilter',
    'menu-button-wide-fill': 'ListFilter',
    'dropdown': 'ListFilter',
    'whatsapp': 'MessageCircle',

    // Uang & Pembayaran
    'cash-stack': 'Banknote',
    'cash': 'Banknote',
    'cash-coin': 'HandCoins',
    'coin': 'Coins',
    'wallet2': 'Wallet',
    'piggy-bank': 'PiggyBank',
    'receipt': 'ReceiptText',

    // 'file-earmark-word-fill' sudah didaftarkan di bagian "Dokumen & File" —
    // entri kedua di sini membuat TS1117 (kunci ganda di object literal).
    'file-earmark-word': 'FileText',
    'file-word': 'FileText',
    'sparkles': 'Sparkles',

    // ── Ikon tab yang sebelumnya jatuh ke "?" ────────────────────────────────
    // Nama-nama Bootstrap di bawah tidak punya padanan PascalCase di lucide
    // (angka di tengah nama, sufiks "earmark", atau istilah yang berbeda sama
    // sekali), jadi harus dipetakan manual. Semuanya dipakai sebagai ikon tab.
    'ui-checks-grid': 'ListChecks',
    'shield-lock': 'ShieldUser',
    'patch-check': 'BadgeCheck',
    'bookmark-star': 'BookmarkCheck',
    'journal-medical': 'Stethoscope',
    'thermometer-half': 'Thermometer',
    'hand-thumbs-up': 'ThumbsUp',
    'check2-circle': 'CircleCheckBig',
    'journal-plus': 'BookPlus',
    'house-lock': 'DoorClosed',
    'filetype-pdf': 'FileType',
    'file-earmark-diff': 'FileDiff',
    'lightning': 'Zap',
    'person-vcard': 'IdCard',
    'collection': 'Layers',
    'arrow-repeat': 'RefreshCw',
    'diagram-3': 'Network',
    'list-nested': 'ListTree',
    'cone-striped': 'TrafficCone',
    'folder2-open': 'FolderOpen',
    'bar-chart-line': 'ChartLine',
}

// Helper untuk mengubah kebab-case menjadi PascalCase (mis. "calendar-check" -> "CalendarCheck")
function toPascalCase(str: string): string {
    return str
        .replace(/(?:^\w|[A-Z]|\b\w)/g, word => word.toUpperCase())
        .replace(/[\s\-_]+/g, '')
}

// Build a case-insensitive lookup map of LucideIcons once
const LUCIDE_CASE_MAP: Record<string, string> = Object.keys(LucideIcons).reduce((acc, key) => {
    acc[key.toLowerCase()] = key
    return acc
}, {} as Record<string, string>)

export interface DynamicLucideIconProps extends Omit<LucideProps, 'ref'> {
    name?: string
}

export const LucideIcon: React.FC<DynamicLucideIconProps> = ({
    name,
    size = 18,
    strokeWidth = 2,
    className,
    ...props
}) => {
    if (!name) return null

    // Bersihkan prefix jika ada (mis. "bi bi-calendar-check" -> "calendar-check")
    const cleanName = name
        .replace(/^bi\s+bi-/, '')
        .replace(/^bi-/, '')
        .replace(/^fa-solid\s+fa-/, '')
        .replace(/^fa-/, '')
        .trim()
        .toLowerCase()

    // 1. Cek dari kamus pemetaan nama
    const mappedName = ICON_MAP[cleanName] || ICON_MAP[cleanName.replace(/-fill$/, '')]

    // 2. Cari komponen Lucide yang cocok
    let IconComponent: React.ComponentType<LucideProps> | undefined

    if (mappedName) {
        IconComponent = (LucideIcons as Record<string, any>)[mappedName]
    }

    if (!IconComponent) {
        // Coba dari LUCIDE_CASE_MAP (case-insensitive lookup langsung)
        const matchedKey = LUCIDE_CASE_MAP[cleanName] || LUCIDE_CASE_MAP[cleanName.replace(/-fill$/, '')]
        if (matchedKey) {
            IconComponent = (LucideIcons as Record<string, any>)[matchedKey]
        }
    }

    if (!IconComponent) {
        // Coba konversi ke PascalCase
        const pascalName = toPascalCase(cleanName)
        const matchedPascalKey = LUCIDE_CASE_MAP[pascalName.toLowerCase()]
        if (matchedPascalKey) {
            IconComponent = (LucideIcons as Record<string, any>)[matchedPascalKey]
        }
    }

    if (!IconComponent) {
        // Coba tanpa sufiks -fill
        const noFillPascal = toPascalCase(cleanName.replace(/-fill$/, ''))
        const matchedNoFillKey = LUCIDE_CASE_MAP[noFillPascal.toLowerCase()]
        if (matchedNoFillKey) {
            IconComponent = (LucideIcons as Record<string, any>)[matchedNoFillKey]
        }
    }

    if (!IconComponent) {
        // Terakhir: coba entri kamus versi -fill dari nama ini (`-fill`
        // DITAMBAHKAN, bukan dibuang). Banyak entri terlanjur ditulis hanya
        // dalam bentuk isinya, mis. 'clipboard-data-fill', sehingga varian
        // garisnya jatuh ke ikon "?" — padahal lucide tidak punya varian
        // isi/garis terpisah, keduanya menuju glyph yang sama.
        //
        // Sengaja ditaruh SETELAH pencarian langsung ke lucide, bukan di
        // langkah 1: kalau didahulukan, nama yang sudah cocok sendiri ikut
        // tergeser (mis. 'bar-chart' yang tadinya BarChart menjadi BarChart3
        // gara-gara entri 'bar-chart-fill').
        const fillName = ICON_MAP[`${cleanName}-fill`]
        if (fillName) IconComponent = (LucideIcons as Record<string, any>)[fillName]
    }

    // Fallback jika icon tidak ditemukan
    if (!IconComponent) {
        IconComponent = LucideIcons.FileQuestion
    }

    return (
        <IconComponent
            size={size}
            strokeWidth={strokeWidth}
            className={className}
            {...props}
        />
    )
}

export default LucideIcon
