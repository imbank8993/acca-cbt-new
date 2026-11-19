// Dijalankan oleh api-cluster.test.cjs sebagai cluster Node sungguhan (3 proses).
// Setiap proses anak memanggil batas laju bersama 10 kali dan melaporkan apakah
// ia membawa pekerjaan latar. Proses induk mencetak ringkasan JSON lalu keluar.
const path = require('node:path');
require('ts-node').register({ project: path.resolve(__dirname, '../../tsconfig.json'), transpileOnly: true });
const cluster = require('node:cluster');
const { SharedRateLimiter, serveClusterRateLimits } = require('../../src/common/rate-limit.ts');
const { runsBackgroundJobs, startApiCluster } = require('../../src/common/api-cluster.ts');

const WORKERS = 3, HITS = 10, LIMIT = 12;

if (cluster.isPrimary) {
    serveClusterRateLimits();
    const reports = [];
    cluster.on('message', (_worker, message) => {
        if (!message || message.probe !== true) return;
        reports.push(message);
        if (reports.length === WORKERS) {
            console.log(JSON.stringify({
                allowed: reports.reduce((sum, report) => sum + report.allowed, 0),
                background: reports.filter(report => report.background).length,
            }));
            process.exit(0);
        }
    });
    startApiCluster(WORKERS, () => undefined);
    setTimeout(() => { console.log(JSON.stringify({ timeout: true, reports })); process.exit(1); }, 20_000).unref();
} else {
    const limiter = new SharedRateLimiter('probe');
    (async () => {
        let allowed = 0;
        for (let i = 0; i < HITS; i++) if ((await limiter.hit('user:a', LIMIT, 60_000)) === 0) allowed++;
        process.send({ probe: true, allowed, background: runsBackgroundJobs() });
    })();
}
