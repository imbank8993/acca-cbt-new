const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');

const launcher = path.resolve(__dirname, '../../web/scripts/cluster-server.cjs');
const dockerfile = path.resolve(__dirname, '../../web/Dockerfile');

/** server.js tiruan: mencetak pid saat siap, dan membalas setiap permintaan dengan pid-nya. */
function fakeServer(dir) {
    const file = path.join(dir, 'server.js');
    fs.writeFileSync(file, `
        const http = require('node:http');
        http.createServer((req, res) => { res.setHeader('Connection', 'close'); res.end(String(process.pid)); })
            .listen(Number(process.env.PORT), '127.0.0.1', () => console.log('ready ' + process.pid));
    `);
    return file;
}

function freePort() {
    return new Promise(resolve => {
        const server = net.createServer().listen(0, '127.0.0.1', () => {
            const { port } = server.address();
            server.close(() => resolve(port));
        });
    });
}

async function runLauncher(workers, t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'web-cluster-'));
    const port = await freePort();
    const child = spawn(process.execPath, [launcher], {
        env: { ...process.env, WEB_WORKERS: String(workers), WEB_SERVER_ENTRY: fakeServer(dir), PORT: String(port) },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    t.after(() => { child.kill(); fs.rmSync(dir, { recursive: true, force: true }); });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    const ready = new Set();
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
        for (const match of output.matchAll(/ready (\d+)/g)) ready.add(match[1]);
        if (ready.size >= workers) break;
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    return { port, ready, output };
}

test('WEB_WORKERS=1 runs server.js directly in a single process', async t => {
    const { port, ready, output } = await runLauncher(1, t);
    assert.equal(ready.size, 1, output);
    assert.doesNotMatch(output, /web-cluster/);
    const body = await (await fetch(`http://127.0.0.1:${port}/`)).text();
    assert.ok(ready.has(body));
});

test('WEB_WORKERS=3 starts three server.js processes sharing one port', async t => {
    const { port, ready, output } = await runLauncher(3, t);
    assert.equal(ready.size, 3, output);
    assert.match(output, /Web berjalan dalam 3 proses/);
    const pids = new Set();
    for (let i = 0; i < 30; i++) pids.add(await (await fetch(`http://127.0.0.1:${port}/`)).text());
    for (const pid of pids) assert.ok(ready.has(pid), 'setiap jawaban berasal dari proses anak');
    // Linux membagi koneksi bergiliran; Windows menyerahkan ke OS, jadi tidak dijamin merata.
    if (process.platform === 'linux') assert.ok(pids.size > 1, 'koneksi dibagi ke lebih dari satu proses');
});

test('web image starts through the cluster launcher', () => {
    const text = fs.readFileSync(dockerfile, 'utf8');
    assert.match(text, /COPY .*apps\/web\/scripts\/cluster-server\.cjs \.\/apps\/web\/cluster-server\.cjs/);
    assert.match(text, /CMD \["node", "apps\/web\/cluster-server\.cjs"\]/);
});
