import { nestFetchInternal } from '@/lib/nest-api';
import type { SettingRow } from './settings';

/**
 * Pengaturan aplikasi untuk SERVER COMPONENT.
 *
 * SERVER-ONLY. Jangan diimpor dari komponen `'use client'`: `nestFetchInternal`
 * memegang `INTERNAL_API_KEY` dan menunjuk alamat loopback.
 *
 * `lib/api/settings.ts` memakai `fetch('/api/settings')` yang butuh origin dan
 * cookie browser — keduanya tidak ada saat root layout dirender di server. Di
 * sini permintaan langsung ke NestJS memakai kunci antar-service.
 *
 * Memakai kunci internal (bukan token pengguna) memang tepat di sini: yang
 * dibaca adalah konfigurasi global aplikasi — nama aplikasi dan mode
 * pemeliharaan — dan root layout harus merendernya sebelum ada pengguna yang
 * dikenali.
 */
export async function getSettingsServer(): Promise<SettingRow[]> {
    const { status, body } = await nestFetchInternal<{ settings?: SettingRow[] }>('/settings');
    if (status !== 200) return [];
    return body?.settings || [];
}

export async function getSettingServer<T = unknown>(key: string): Promise<T | null> {
    const settings = await getSettingsServer();
    return (settings.find((s) => s.key === key)?.value as T) ?? null;
}
