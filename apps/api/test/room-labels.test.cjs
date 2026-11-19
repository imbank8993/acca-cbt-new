const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });
const L = require('../../web/lib/room-labels.ts');

test('cleanBankTitle: buang awalan asesmen, garis bawah, dan daftar kelas di ujung nama bank', () => {
    assert.equal(L.cleanBankTitle('ASAS_2026_BAHASA INGGRIS_X (A,B,C,D)'), 'Bahasa Inggris');
    assert.equal(L.cleanBankTitle('ASAS_2026_BAHASA INGGRIS_XI C,D'), 'Bahasa Inggris');
    assert.equal(L.cleanBankTitle('ASAS 2026_BAHASA INGGRIS WAJIB XI A & XI B'), 'Bahasa Inggris Wajib');
    assert.equal(L.cleanBankTitle('ASAS_2026_PJOK_XII'), 'PJOK');
    assert.equal(L.cleanBankTitle('Matematika Peminatan'), 'Matematika Peminatan', 'nama yang sudah rapi tidak diubah');
    assert.equal(L.cleanBankTitle('XI'), 'XI', 'tidak pernah menjadi kosong');
});

test('compactClasses: kelas berurutan menjadi rentang, per tingkat', () => {
    assert.equal(L.compactClasses('X A, X B, X C, X D'), 'X A–D');
    assert.equal(L.compactClasses('XI C, XI D'), 'XI C, D');
    assert.equal(L.compactClasses('XI A, XI C, XII B'), 'XI A, C · XII B');
    assert.equal(L.compactClasses('Kelas Unggulan'), 'Kelas Unggulan');
});

test('sessionStatus: belum dimulai, berlangsung dengan sisa menit, dan selesai', () => {
    assert.deepEqual(L.sessionStatus('2026-11-19', '07:30:00', '09:00:00', '2026-11-19', '07:00'), { phase: 'upcoming', minutesLeft: null, progress: 0 });
    const running = L.sessionStatus('2026-11-19', '07:30', '09:00', '2026-11-19', '08:18');
    assert.equal(running.phase, 'running'); assert.equal(running.minutesLeft, 42);
    assert.ok(Math.abs(running.progress - 48 / 90) < 1e-9);
    assert.equal(L.sessionStatus('2026-11-19', '07:30', '09:00', '2026-11-19', '09:00').phase, 'done');
    assert.equal(L.sessionStatus('2026-11-18', '07:30', '09:00', '2026-11-19', '08:00').phase, 'done');
    assert.equal(L.sessionStatus('2026-11-20', '07:30', '09:00', '2026-11-19', '08:00').phase, 'upcoming');
});
