'use client';

import { useEffect, useRef } from 'react';

/**
 * Muat ulang data secara berkala, dan segera saat tab kembali dibuka.
 *
 * Menggantikan langganan realtime Supabase (`supabase.channel(...).on('postgres_changes', …)`)
 * yang dipakai belasan layar sebelum cutover. Penggantinya bukan pilihan estetika:
 * Supabase sudah tidak ada, jadi seluruh langganan itu berhenti mengirim apa pun —
 * dan sebagiannya bahkan sudah mati lebih dulu karena masih menyebut nama tabel
 * lama (`exams`, `exam_attempts`) yang sekarang berawalan `cbt_`.
 *
 * Ini memang penurunan kemampuan dibanding dorongan langsung dari basis data:
 * perubahan baru terlihat pada penyegaran berikutnya, bukan seketika. Rencana
 * penggantinya adalah SSE dari NestJS; sampai itu ada, jeda yang jujur lebih
 * baik daripada layar yang diam karena menunggu peristiwa yang tidak akan datang.
 * Lihat docs/MIGRASI_BACKEND.md.
 *
 * @param refresh  Fungsi pemuat data. Boleh berubah tiap render — ia disimpan di
 *                 ref, jadi pemicunya tidak ikut dipasang ulang.
 * @param intervalMs  Jarak antar penyegaran. Nol atau kurang mematikan interval,
 *                    menyisakan penyegaran saat tab difokuskan.
 */
export function useAutoRefresh(refresh: () => void, intervalMs: number): void {
    const latest = useRef(refresh);
    latest.current = refresh;

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
