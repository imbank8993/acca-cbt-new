// Run from repository root: node --test apps/api/test/server-hardening.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });

const { shouldLogRequest, slowRequestMs, DEFAULT_SLOW_REQUEST_MS } = require('../src/common/interceptors/logging.interceptor.ts');

const root = path.resolve(__dirname, '../../..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('routine exam traffic is logged only when slow; other requests always', () => {
    const routine = [
        '/api/proctoring/attempts/abc/heartbeat',
        '/api/proctoring/attempts/abc/violations',
        '/api/students/attempts/abc/answers',
        '/api/students/attempts/abc/answers/q1',
        '/api/students/attempts/abc/submission-status',
        '/api/storage/file/questions/a.webp?x=1',
        '/api/auth/me',
        '/api/notifications/unread-count',
        '/api/health',
    ];
    for (const url of routine) {
        assert.equal(shouldLogRequest(url, 20), false, url);
        assert.equal(shouldLogRequest(url, DEFAULT_SLOW_REQUEST_MS), true, url);
        assert.equal(shouldLogRequest(url, 20, { logAll: true }), true, url);
    }
    for (const url of ['/api/students/attempts/abc/submit', '/api/auth/sso', '/api/proctoring/attempts/abc/reset']) {
        assert.equal(shouldLogRequest(url, 5), true, url);
    }
    assert.equal(slowRequestMs(undefined), DEFAULT_SLOW_REQUEST_MS);
    assert.equal(slowRequestMs('250'), 250);
    assert.equal(slowRequestMs('x'), DEFAULT_SLOW_REQUEST_MS);
});

test('API container keeps stderr and runs Node as PID 1', () => {
    const dockerfile = read('apps/api/Dockerfile');
    const cmd = dockerfile.split('\n').filter(line => line.startsWith('CMD ')).pop();
    assert.ok(cmd, 'CMD exists');
    assert.doesNotMatch(cmd, /2>\/dev\/null/);
    assert.match(cmd, /exec node/);
    assert.match(cmd, /apps\/api\/dist\/main\.js/);
});

test('compose caps CPU/RAM and rotates logs for every CBT service', () => {
    const yaml = require(require.resolve('js-yaml', { paths: [root] }));
    const compose = yaml.load(read('docker-compose.yml'));
    for (const [name, service] of Object.entries(compose.services)) {
        assert.ok(service.cpus !== undefined, `${name} cpus`);
        assert.ok(service.mem_limit !== undefined, `${name} mem_limit`);
        assert.equal(service.logging?.driver, 'json-file', `${name} logging`);
        assert.ok(service.logging?.options?.['max-size'], `${name} max-size`);
        assert.ok(service.logging?.options?.['max-file'], `${name} max-file`);
    }
});
