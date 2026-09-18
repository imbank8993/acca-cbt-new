/**
 * Konversi waktu WIB ↔ UTC.
 *
 * Database menyimpan seluruh waktu dalam UTC, sementara guru mengisi jadwal
 * dalam WIB — dan tidak ada satu pun tempat di aplikasi ini yang memakai zona
 * lain: seluruh sekolah penggunanya ada di WIB. Offsetnya dibuat eksplisit di
 * sini alih-alih tersebar sebagai `7 * 60 * 60 * 1000` di tengah perhitungan.
 *
 * Yang sengaja TIDAK dipakai di berkas ini adalah `new Date('2026-06-01T07:30')`
 * untuk string tanpa zona: hasilnya ditafsirkan menurut zona waktu PROSES, jadi
 * jadwal yang sama menghasilkan jam berbeda di mesin pengembangan dan di server.
 * Semua konversi di sini melewati `Date.UTC` dengan komponen yang sudah diurai.
 */

export const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

/**
 * Gabungkan tanggal `YYYY-MM-DD` dan jam `HH:mm[:ss]` yang keduanya dalam WIB
 * menjadi satu penanda waktu UTC.
 *
 * Bentuk itulah yang dihasilkan `<input type="date">` dan `<input type="time">`,
 * dan yang disimpan kolom `date`/`time` di PostgreSQL.
 */
export function wibDateTimeToUtc(
    date: string | null | undefined,
    time: string | null | undefined,
): string | null {
    if (!date || !time) return null;

    const [year, month, day] = date.split('-').map(Number);
    const [hour, minute, second = 0] = time.split(':').map(Number);

    if ([year, month, day, hour, minute, second].some((n) => !Number.isFinite(n))) return null;

    return new Date(
        Date.UTC(year, month - 1, day, hour, minute, second) - WIB_OFFSET_MS,
    ).toISOString();
}

/**
 * Ubah satu string `datetime-local` WIB (`YYYY-MM-DDTHH:mm[:ss]`) menjadi UTC.
 *
 * Akhiran `Z` ikut diterima dan DIABAIKAN: formulir ujian pernah mengirimkannya
 * meski nilainya tetap waktu lokal WIB, dan menghormatinya akan menggeser
 * seluruh jadwal lama tujuh jam.
 */
export function wibLocalToUtc(value: string | null | undefined): string | null {
    if (!value || value.trim() === '') return null;

    const match = value
        .trim()
        .match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?Z?$/);

    if (match) {
        const [, year, month, day, hour, minute, second] = match;
        return wibDateTimeToUtc(
            `${year}-${month}-${day}`,
            `${hour}:${minute}:${second ?? '00'}`,
        );
    }

    // Bentuk lain yang MEMBAWA zona waktunya sendiri (mis. ISO lengkap dengan
    // offset) sudah tidak ambigu, jadi ia dibaca apa adanya.
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/** Jam dinding WIB (`HH:mm`) dari sebuah penanda waktu UTC. */
export function utcToWibClock(iso: string): string {
    const wib = new Date(new Date(iso).getTime() + WIB_OFFSET_MS);
    return (
        `${String(wib.getUTCHours()).padStart(2, '0')}:` +
        `${String(wib.getUTCMinutes()).padStart(2, '0')}`
    );
}
