const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
require('ts-node').register({ project: path.resolve(__dirname, '../../web/tsconfig.json'), transpileOnly: true,
    compilerOptions: { module: 'CommonJS', moduleResolution: 'node' } });
const { sampleExamNetwork, examNetworkLabel } = require('../../web/lib/exam-network.ts');

test('offline, unreachable server and slow connection use distinct labels', () => {
    assert.equal(examNetworkLabel(true, true, true), 'Koneksi terputus');
    assert.equal(examNetworkLabel(false, true, true), 'Server belum dapat dihubungi');
    assert.equal(examNetworkLabel(false, false, true), 'Jaringan lemah');
    assert.equal(examNetworkLabel(false, false, false), null);
});

test('a transient slow response does not flash a warning; recovery needs two fast responses', () => {
    let state = { weak: false, streak: 0 };
    state = sampleExamNetwork(state, 4000);
    assert.equal(state.weak, false);
    state = sampleExamNetwork(state, 100);
    assert.equal(state.streak, 0);
    state = sampleExamNetwork(state, 4000);
    state = sampleExamNetwork(state, 4000);
    assert.equal(state.weak, true);
    state = sampleExamNetwork(state, 100);
    assert.equal(state.weak, true);
    state = sampleExamNetwork(state, 100);
    assert.equal(state.weak, false);
});
