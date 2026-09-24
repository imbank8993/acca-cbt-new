'use client';

import { useEffect, useRef } from 'react';

/**
 * Muat ulang data secara berkala, dan segera saat tab kembali dibuka.
 *
 * Menggantikan langganan realtime Supabase (`supabase.channel(...).on('postgres_changes', …)`)
 * yang dipakai belasan layar sebelum cutover.
 *
 * @param refresh  Fungsi pemuat data. Boleh berubah tiap render — ia disimpan di
 *                 ref, jadi pemicunya tidak ikut dipasang ulang.
 * @param intervalMs  Jarak antar penyegaran. Nol atau kurang mematikan interval,
 *                    menyisakan penyegaran saat tab difokuskan.
 */
export function useAutoRefresh(refresh: () => void, intervalMs: number): void {
    const latest = useRef(refresh);

    useEffect(() => {
        latest.current = refresh;
    });

    useEffect(() => {
        const run = () => latest.current();

        // Menyegarkan saat tab tersembunyi hanya membuang permintaan: tidak ada
        // yang melihat hasilnya, dan layar pemantauan bisa terbuka berjam-jam.
        const tick = () => {
            if (document.visibilityState === 'visible') run();
        };

        const onVisible = () => {
            if (document.visibilityState === 'visible') run();
        };

        const timer = intervalMs > 0 ? setInterval(tick, intervalMs) : null;
        window.addEventListener('focus', run);
        document.addEventListener('visibilitychange', onVisible);

        return () => {
            if (timer) clearInterval(timer);
            window.removeEventListener('focus', run);
            document.removeEventListener('visibilitychange', onVisible);
        };
    }, [intervalMs]);
}

/** Jeda penyegaran baku, dipilih menurut seberapa cepat datanya berubah. */
export const REFRESH_INTERVAL = {
    /** Pemantauan ujian berjalan: pengawas perlu melihat perubahan segera. */
    monitoring: 10_000,
    /** Dasbor dan daftar ujian: berubah dalam hitungan menit. */
    dashboard: 30_000,
    /** Notifikasi: jarang, dan lonceng bukan hal yang mendesak. */
    notifications: 60_000,
} as const;
