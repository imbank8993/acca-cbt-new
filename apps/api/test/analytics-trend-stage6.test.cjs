// Run from repository root: node --test apps/api/test/analytics-trend-stage6.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });

const { calculateTrend } = require('../src/analytics/student-analytics.service.ts');

test('UX-12: tren dua nilai membandingkan nilai lama dengan nilai baru', () => {
    assert.equal(calculateTrend([90, 60]), 'down');
    assert.equal(calculateTrend([60, 90]), 'up');
});

test('UX-12: data tidak cukup dan perubahan kecil tetap stabil', () => {
    assert.equal(calculateTrend([]), 'stable');
    assert.equal(calculateTrend([75]), 'stable');
    assert.equal(calculateTrend([80, 84]), 'stable');
});

test('UX-12: jumlah ganjil tetap memakai kelompok lama dan baru yang tidak kosong', () => {
    assert.equal(calculateTrend([90, 85, 70]), 'down');
    assert.equal(calculateTrend([60, 75, 80]), 'up');
});
