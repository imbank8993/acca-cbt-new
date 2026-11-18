/**
 * Pesan untuk siswa setelah pengawas mengubah sesi ujiannya.
 *
 * Dulu setiap `proctor_recovery_until` ditampilkan sebagai "Pemulihan pengumpulan
 * aktif · Lokal: x · Server: y", padahal kolom itu juga diisi oleh susulan, tambah
 * waktu, dan pemulihan untuk melanjutkan. Siswa susulan melihat "Lokal: 0 ·
 * Server: 0" dan mengira jawabannya hilang. Di sini jenis tindakan TERAKHIR
 * pengawas dipakai untuk memilih pesan yang benar, tanpa angka teknis.
 */
export type ExamSessionKind = 'makeup' | 'extended' | 'resumed' | 'submit';

export interface ExamSessionNotice {
    kind: ExamSessionKind;
    /** Batas waktu baru (ISO). */
    until: string;
    /** Menit tambahan, untuk `extended`. */
    minutes?: number;
}

const time = (value: unknown): number => typeof value === 'string' ? Date.parse(value) : NaN;

/** Jenis tindakan pengawas yang masih berlaku untuk pengerjaan ini, atau null. */
export function examSessionNotice(metadata: Record<string, unknown> | null | undefined, nowMs = Date.now()): ExamSessionNotice | null {
    const until = metadata?.proctor_recovery_until;
    if (typeof until !== 'string' || !(Date.parse(until) > nowMs)) return null;
    if (metadata?.recovery_submit_only === true) return { kind: 'submit', until };
    const actions: Array<[ExamSessionKind, number]> = [
        ['makeup', time(metadata?.makeup_activated_at)],
        ['resumed', time(metadata?.active_reset_at)],
        ['resumed', time(metadata?.resume_activated_at)],
        ['extended', time(metadata?.time_extended_at)],
    ];
    const latest = actions.filter(([, at]) => Number.isFinite(at)).sort((a, b) => b[1] - a[1])[0];
    const kind = latest?.[0] ?? 'resumed';
    const minutes = Number(metadata?.time_extended_minutes);
    return kind === 'extended' && Number.isInteger(minutes) && minutes > 0 ? { kind, until, minutes } : { kind, until };
}

/**
 * Jam dalam zona waktu sekolah, mis. "10.45 WITA" (bukan jam perangkat siswa).
 * `zoneLabel` dari getSchoolTimeZoneLabel (lib/school-time).
 */
export function formatSchoolClock(value: string, timeZone: string, zoneLabel: string): string {
    const clock = new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit', timeZone }).format(new Date(value));
    return `${clock} ${zoneLabel}`;
}

/** Teks pemberitahuan singkat untuk siswa, sesuai tindakan pengawas. */
export function examSessionNoticeText(notice: ExamSessionNotice, timeZone: string, zoneLabel: string): { text: string; details: string } {
    const until = formatSchoolClock(notice.until, timeZone, zoneLabel);
    switch (notice.kind) {
        case 'makeup':
            return { text: 'Ujian susulan dimulai',
                details: `Pengawas membuka ujian susulan dari awal untuk Anda. Kerjakan sampai pukul ${until}.` };
        case 'extended':
            return { text: notice.minutes ? `Waktu ditambah ${notice.minutes} menit` : 'Waktu ujian ditambah',
                details: `Pengawas menambah waktu ujian Anda. Batas baru pukul ${until}. Jawaban Anda tetap tersimpan.` };
        case 'submit':
            return { text: 'Mengirim jawaban dari perangkat ini',
                details: `Jawaban yang tersimpan di perangkat ini sedang dikirim. Jangan tutup halaman sebelum pukul ${until}.` };
        default:
            return { text: 'Ujian dibuka kembali oleh pengawas',
                details: `Lanjutkan mengerjakan sampai pukul ${until}. Jawaban Anda sebelumnya tetap tersimpan.` };
    }
}
