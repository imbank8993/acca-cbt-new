import { cluster } from './node-cluster';

/**
 * Menjalankan API dalam beberapa proses (Node cluster) supaya bisa memakai lebih
 * dari satu core CPU. Satu proses Node hanya bekerja di satu core; saat ujian
 * ramai, proses tunggal itu mentok 100% sementara core lain menganggur.
 *
 * Jumlah proses diatur `API_WORKERS` (bawaan 1 = tanpa cluster, persis seperti
 * sebelumnya). Proses induk tidak melayani HTTP: ia hanya menyalakan proses
 * anak, menggantinya bila mati, dan memegang penghitung batas laju bersama
 * (lihat `rate-limit.ts`).
 */

/** Variabel lingkungan penanda proses anak yang menjalankan pekerjaan latar. */
const BACKGROUND_ENV = 'CBT_BACKGROUND_JOBS';
/** Jangan mengganti proses yang mati berulang kali lebih cepat dari ini. */
const RESPAWN_DELAY_MS = 1_000;

export function configuredApiWorkers(raw = process.env.API_WORKERS): number {
    const count = Math.floor(Number(raw || 1));
    return Number.isFinite(count) && count > 1 ? Math.min(count, 16) : 1;
}

/**
 * Pekerjaan latar (penilaian ulang, pembersihan screenshot) cukup berjalan di
 * SATU proses. Tanpa cluster, proses tunggal itulah yang menjalankannya.
 */
export function runsBackgroundJobs(): boolean {
    return !cluster.isWorker || process.env[BACKGROUND_ENV] === '1';
}

/**
 * Dipanggil di proses induk. Menyalakan `workers` proses anak; tepat satu di
 * antaranya membawa tugas pekerjaan latar, dan tugas itu ikut diwariskan ke
 * pengganti bila proses tersebut mati.
 */
export function startApiCluster(workers: number, log: (message: string) => void): void {
    let shuttingDown = false;
    const background = new Set<number>();

    const fork = (withBackground: boolean) => {
        const worker = cluster.fork({ [BACKGROUND_ENV]: withBackground ? '1' : '0' });
        if (withBackground) background.add(worker.id);
    };

    cluster.on('exit', (worker, code, signal) => {
        const hadBackground = background.delete(worker.id);
        if (shuttingDown) return;
        log(`Proses API ${worker.process.pid} berhenti (${signal || code}); menyalakan pengganti.`);
        setTimeout(() => { if (!shuttingDown) fork(hadBackground); }, RESPAWN_DELAY_MS);
    });

    // Docker menghentikan kontainer dengan SIGTERM ke proses induk; teruskan ke
    // semua proses anak supaya permintaan yang sedang berjalan sempat selesai.
    for (const signal of ['SIGTERM', 'SIGINT'] as const) {
        process.on(signal, () => {
            shuttingDown = true;
            for (const worker of Object.values(cluster.workers || {})) worker?.process.kill(signal);
            setTimeout(() => process.exit(0), 10_000).unref();
            cluster.on('exit', () => {
                if (!Object.keys(cluster.workers || {}).length) process.exit(0);
            });
        });
    }

    for (let i = 0; i < workers; i++) fork(i === 0);
    log(`API berjalan dalam ${workers} proses (cluster).`);
}
