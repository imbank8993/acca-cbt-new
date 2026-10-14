const LABELS: Record<string, string> = {
    tab_switch: 'Halaman ujian tersembunyi (layar terkunci atau berpindah aplikasi)',
    window_blur: 'Jendela ujian kehilangan fokus',
    focus_interruption: 'Gangguan fokus perangkat (misalnya notifikasi sistem)',
    blur: 'Jendela ujian kehilangan fokus',
    exit_fullscreen: 'Keluar dari layar penuh',
    restricted_shortcut: 'Menekan pintasan keyboard terlarang',
    copy_paste_attempt: 'Mencoba menyalin atau menempel',
    right_click_attempt: 'Mencoba membuka menu klik kanan',
    tab_close: 'Menutup atau meninggalkan tab ujian',
    RESET_BY_PROCTOR: 'Pelanggaran direset oleh pengawas',
    MAKEUP_EXAM_STARTED: 'Ujian susulan dimulai dari awal',
    FORCE_TERMINATED: 'Ujian diselesaikan otomatis',
    DEVICE_SWITCH_BLOCKED: 'Pergantian perangkat diblokir',
    LATE_ANSWER_SYNC: 'Jawaban terlambat disinkronkan',
    SYNC_HEALTH_CHANGED: 'Status sinkronisasi jawaban berubah',
};

export function securityViolationLabel(eventType: string): string {
    return LABELS[eventType] || eventType.replaceAll('_', ' ');
}
