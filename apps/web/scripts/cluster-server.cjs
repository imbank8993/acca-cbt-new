/**
 * Peluncur server Next.js (output standalone) yang bisa memakai beberapa core.
 *
 * Satu proses Node hanya bekerja di satu core. `WEB_WORKERS` (bawaan 1) mengatur
 * berapa proses `server.js` yang dijalankan; semuanya berbagi port yang sama dan
 * Node membagi koneksi masuk di antara mereka. Dengan nilai 1, server berjalan
 * persis seperti `node server.js` biasa.
 *
 * Aman dijalankan berlipat karena server web CBT tidak menyimpan keadaan di
 * memori: ia hanya merender halaman dan meneruskan permintaan ke API.
 *
 * Di image Docker berkas ini disalin ke samping server.js (apps/web/).
 */
/* eslint-disable @typescript-eslint/no-require-imports -- dijalankan langsung oleh node sebagai CommonJS */
const cluster = require('node:cluster');
const fs = require('node:fs');
const path = require('node:path');

function configuredWorkers(raw = process.env.WEB_WORKERS) {
    const count = Math.floor(Number(raw || 1));
    return Number.isFinite(count) && count > 1 ? Math.min(count, 16) : 1;
}

function serverEntry() {
    const candidates = [
        process.env.WEB_SERVER_ENTRY,
        path.join(__dirname, 'server.js'),
        path.join(process.cwd(), 'apps', 'web', 'server.js'),
        path.join(process.cwd(), 'server.js'),
    ].filter(Boolean);
    const found = candidates.find(file => fs.existsSync(file));
    if (!found) throw new Error(`server.js Next.js tidak ditemukan. Dicari di: ${candidates.join(', ')}`);
    return found;
}

function startCluster(workers) {
    let shuttingDown = false;
    const log = message => console.log(`[web-cluster] ${message}`);

    cluster.on('exit', (worker, code, signal) => {
        if (shuttingDown) {
            if (!Object.keys(cluster.workers || {}).length) process.exit(0);
            return;
        }
        log(`Proses web ${worker.process.pid} berhenti (${signal || code}); menyalakan pengganti.`);
        setTimeout(() => { if (!shuttingDown) cluster.fork(); }, 1_000);
    });

    // Docker menghentikan kontainer dengan SIGTERM ke proses induk; teruskan ke
    // proses anak supaya permintaan yang sedang berjalan sempat selesai.
    for (const signal of ['SIGTERM', 'SIGINT']) {
        process.on(signal, () => {
            shuttingDown = true;
            for (const worker of Object.values(cluster.workers || {})) {
                if (worker) worker.process.kill(signal);
            }
            setTimeout(() => process.exit(0), 10_000).unref();
        });
    }

    for (let i = 0; i < workers; i++) cluster.fork();
    log(`Web berjalan dalam ${workers} proses (cluster).`);
}

const workers = configuredWorkers();
if (workers > 1 && cluster.isPrimary) {
    serverEntry(); // gagal cepat di proses induk bila server.js tidak ada
    startCluster(workers);
} else {
    require(serverEntry());
}

