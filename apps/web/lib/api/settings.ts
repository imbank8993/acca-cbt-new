import { apiGet,apiSend,type ApiResult } from './client';

export interface SettingRow {
    id: string;
    key: string;
    value: unknown;
    created_at: string;
    updated_at: string;
}

/**
 * Kolom `value` bertipe jsonb dan isinya berbeda-beda per key, jadi tipenya
 * dideklarasikan di titik PEMAKAIAN lewat `getSetting<T>()` — bukan dilonggarkan
 * menjadi `any` di sini. Bentuk yang sudah dipakai didaftarkan di bawah supaya
 * tidak ditebak ulang di setiap halaman.
 */

/** key: 'app_config' */
export interface AppConfig {
    app_name?: string;
    app_short_name?: string;
    app_subtitle?: string;
    maintenance_mode?: boolean;
}

/** key: 'announcement_config' — bisa satu objek, bisa array. */
export interface Announcement {
    id?: string;
    title?: string;
    content?: string;
    created_at?: string;
    is_active?: boolean;
    show_proktor?: boolean;
    show_siswa?: boolean;
    [field: string]: unknown;
}

/** Normalkan announcement_config menjadi daftar yang aktif untuk peran tertentu. */
export function pickAnnouncements(
    value: Announcement | Announcement[] | null,
    audience: 'show_proktor' | 'show_siswa',
): Announcement[] {
    if (!value) return [];
    const list = Array.isArray(value) ? value : [value];
    return list.filter((item) => item?.is_active && item?.[audience]);
}

/**
 * Pengaturan jarang berubah tetapi dibaca di hampir setiap halaman — sidebar
 * mengambil nama aplikasi dari sini. Tanpa penyimpanan sementara, setiap
 * perpindahan halaman menembak satu permintaan yang hasilnya selalu sama.
 *
 * Disimpan per muat halaman saja (variabel modul), jadi refresh biasa sudah
 * cukup untuk mengambil nilai terbaru.
 */
let cached: Promise<ApiResult<{ settings: SettingRow[] }>> | null = null;

export function getSettings(options: { refresh?: boolean } = {}) {
    if (options.refresh) cached = null;
    if (!cached) {
        cached = apiGet<{ settings: SettingRow[] }>('/api/settings');
    }
    return cached;
}

/** Ambil satu pengaturan, dibaca dari hasil yang sudah tersimpan sementara. */
export async function getSetting<T = unknown>(key: string): Promise<T | null> {
    const result = await getSettings();
    if (!result.success) return null;
    return (result.settings.find((s) => s.key === key)?.value as T) ?? null;
}

export async function updateSetting(key: string, value: unknown) {
    const result = await apiSend<{ key: string }>('/api/settings', { key, value }, 'PUT');
    // Nilai yang tersimpan sementara sudah tidak sesuai setelah penulisan.
    if (result.success) cached = null;
    return result;
}
