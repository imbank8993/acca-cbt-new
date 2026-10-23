import { SettingsService } from '../settings/settings.service';
import type { DbService } from '../prisma/prisma-db-adapter';

/**
 * Masa berlaku penugasan pengawas ruang.
 *
 * Penugasan adalah tugas harian (ruang × sesi × tanggal), bukan izin permanen.
 * Dulu tanggalnya hanya dipakai untuk mencocokkan jadwal: pengawas hari Senin
 * dapat membuka monitoring ujian Senin itu kapan pun, dan satu penugasan lama
 * membuat menu Pengawas melekat selamanya.
 */
export const PAS_ADMINISTRATION_LEAD_DAYS = 1;
export const PAS_ADMINISTRATION_GRACE_DAYS = 3;

export type PasDutyWindow = 'monitoring' | 'administration_view' | 'administration_write' | 'workspace';

/** Tanggal kalender YYYY-MM-DD di zona waktu sekolah. */
export function localSchoolDate(now: Date, timeZone: string): string {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export function shiftPasDate(date: string, days: number): string {
    const value = new Date(`${date}T00:00:00Z`);
    value.setUTCDate(value.getUTCDate() + days);
    return value.toISOString().slice(0, 10);
}

/** Hari ini menurut jam database dan zona waktu sekolah, bukan jam server aplikasi. */
export async function schoolToday(db: DbService): Promise<string> {
    const [clock] = await db.raw<Array<{ now: Date }>>('SELECT clock_timestamp() AS now');
    const timeZone = await new SettingsService(db).getSchoolTimeZone();
    return localSchoolDate(new Date(clock.now), timeZone);
}

/**
 * - monitoring: hanya pada tanggal tugas.
 * - administration_view: H-1 (persiapan daftar hadir) sampai H+3.
 * - administration_write: H sampai H+3 (berita acara tidak diisi sebelum ujian).
 * - workspace (menu Pengawas): selama ada tugas yang akan datang atau baru lewat ≤3 hari.
 */
export function pasDutyAllowed(examDate: string, today: string, window: PasDutyWindow): boolean {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(examDate) || !/^\d{4}-\d{2}-\d{2}$/.test(today)) return false;
    const graceEnd = shiftPasDate(examDate, PAS_ADMINISTRATION_GRACE_DAYS);
    if (window === 'monitoring') return today === examDate;
    if (window === 'administration_view') return shiftPasDate(examDate, -PAS_ADMINISTRATION_LEAD_DAYS) <= today && today <= graceEnd;
    if (window === 'administration_write') return examDate <= today && today <= graceEnd;
    return today <= graceEnd;
}
