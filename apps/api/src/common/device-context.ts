/**
 * Info perangkat yang dapat dibaca manusia untuk kunci perangkat ujian.
 * ID perangkat sendiri acak; pengawas butuh jenis browser/OS dan waktunya.
 */
/** Ringkasan perangkat dari permintaan (browser, OS, IP); bukan sidik jari. */
export type DeviceContext = { browser: string | null; os: string | null; ip_address: string | null };

export function deviceSummary(context?: DeviceContext | null) {
    return { browser: context?.browser ?? null, os: context?.os ?? null, ip_address: context?.ip_address ?? null };
}

/**
 * Perangkat yang dilepas pengawas lewat "Pindahkan ke perangkat baru".
 * Selama kunci perangkat kosong, perangkat lama tidak boleh mengambilnya kembali
 * (tab lama yang masih terbuka memuat ulang dirinya saat tenggat berubah).
 */
export function isReleasedDevice(metadata: Record<string, any> | null | undefined, device: string | null | undefined): boolean {
    const released = metadata?.released_devices;
    return Boolean(device) && Array.isArray(released) && released.includes(String(device).trim());
}

export const RELEASED_DEVICE_MESSAGE = 'Ujian ini sudah dipindahkan pengawas ke perangkat lain. Lanjutkan di perangkat baru; ' +
    'jawaban yang belum terkirim dari perangkat ini tidak dapat dikirim lagi. Hubungi pengawas bila ada pertanyaan.';

/** Perangkat pemegang ujian: saat diikat, diperbarui oleh heartbeat terakhir. */
export function holderSummary(attempt: { metadata?: Record<string, any> | null; started_at?: string | null; last_seen_at?: string | null }) {
    const bound = attempt.metadata?.device_bound || {};
    const seen = attempt.metadata?.client_context || {};
    return {
        browser: bound.browser ?? seen.browser ?? null,
        os: bound.os ?? seen.os ?? null,
        ip_address: seen.ip_address ?? bound.ip_address ?? null,
        since: bound.at ?? attempt.started_at ?? null,
        last_seen_at: attempt.last_seen_at ?? null,
    };
}
