/**
 * Cadangan pemeriksaan pembaruan soal. Pemicu utamanya heartbeat (revisi soal berubah);
 * putaran ini hanya untuk heartbeat yang gagal dan ujian lama tanpa snapshot soal.
 */
export const QUESTION_CHECK_FALLBACK_MS = 120_000;

/**
 * Timer berkala dengan jeda acak (jitter) untuk halaman ujian.
 *
 * Ratusan siswa memulai ujian pada menit yang sama. Dengan `setInterval` biasa, heartbeat
 * dan pemeriksaan berkala mereka berbunyi hampir bersamaan, sehingga server menerima lonjakan
 * setiap 15 detik alih-alih beban yang merata. Di sini putaran pertama ditunda acak di dalam
 * satu periode, dan setiap putaran berikutnya bergeser acak ±`spread` dari periodenya.
 */
export function jitteredInterval(run: () => void, periodMs: number, options: { spread?: number; random?: () => number } = {}): () => void {
    const spread = Math.min(0.5, Math.max(0, options.spread ?? 0.15));
    const random = options.random ?? Math.random;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;
    const schedule = (delay: number) => {
        timer = setTimeout(() => {
            if (stopped) return;
            run();
            schedule(nextDelay(periodMs, spread, random()));
        }, delay);
    };
    schedule(Math.round(periodMs * random()));
    return () => { stopped = true; if (timer) clearTimeout(timer); };
}

/** Jeda putaran berikutnya: periode ± spread (mis. 15 detik ± 15%). */
export function nextDelay(periodMs: number, spread: number, sample: number): number {
    return Math.round(periodMs * (1 - spread + 2 * spread * sample));
}
