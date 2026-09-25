// Run from repository root: node --test apps/api/test/ui-quality-stage6.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

require('ts-node').register({
    project: path.resolve(__dirname, '../../web/tsconfig.json'),
    transpileOnly: true,
    compilerOptions: { module: 'CommonJS', moduleResolution: 'node' },
});
require('tsconfig-paths').register({
    baseUrl: path.resolve(__dirname, '../../web'),
    paths: { '@/*': ['*'] },
});

const { summarizeAnswerOutcomes } = require('../../web/lib/answer-stats.ts');
const { formatSchoolDateTime, formatSchoolTimeRange } = require('../../web/lib/school-time.ts');
const { formatStudentAnswer } = require('../../web/lib/answer-display.ts');

test('UX-05: esai yang sudah dinilai tidak dihitung sebagai jawaban objektif benar', () => {
    const summary = summarizeAnswerOutcomes([
        { is_correct: true, bank_questions: { type: 'mcq' } },
        { is_correct: false, bank_questions: { type: 'true_false' } },
        { is_correct: true, bank_questions: { type: 'essay' } },
        { is_correct: null, bank_questions: { type: 'uraian' } },
    ]);
    assert.deepEqual(summary, { total: 4, correct: 1, wrong: 1, essays: 2 });
});

test('UX-06: waktu sekolah konsisten dalam WIB di sekitar pergantian hari', () => {
    assert.equal(formatSchoolDateTime('2026-09-19T18:30:00Z'), '20 Sep 2026 01:30 WIB');
    assert.equal(
        formatSchoolTimeRange('2026-09-19T18:30:00Z', '2026-09-19T20:00:00Z'),
        '01:30 — 03:00 WIB',
    );
});

test('UX-11: ekspor dapat mewakili pilihan kompleks dan jawaban terstruktur', () => {
    const options = [
        { id: 'a', option_text: 'Satu' },
        { id: 'b', option_text: 'Dua' },
    ];
    assert.deepEqual(
        formatStudentAnswer({ type: 'mcq_complex', options }, null, '["a","b"]'),
        ['A. Satu', 'B. Dua'],
    );
    assert.deepEqual(
        formatStudentAnswer({ type: 'true_false', options }, null, '{"a":true,"b":false}'),
        ['Satu → TRUE', 'Dua → FALSE'],
    );
});

test('BUG-14/UX-10: hook dan pagination tetap terjaga pada sumber UI', () => {
    const viewer = fs.readFileSync(
        path.resolve(__dirname, '../../web/app/components/questions/ExamViewer.tsx'), 'utf8',
    );
    const earlyReturn = viewer.indexOf('if (!isAssignment &&');
    assert.ok(earlyReturn > 0);
    assert.ok(viewer.indexOf('const [studentDocUrl') < earlyReturn);
    assert.ok(viewer.lastIndexOf('useEffect(') < earlyReturn);

    const notificationPage = fs.readFileSync(
        path.resolve(__dirname, '../../web/app/dashboard/notifications/page.tsx'), 'utf8',
    );
    assert.match(notificationPage, /Muat Lebih Banyak/);
    assert.match(notificationPage, /offset,/);
    const notificationController = fs.readFileSync(
        path.resolve(__dirname, '../src/notifications/notifications.controller.ts'), 'utf8',
    );
    assert.match(notificationController, /offset: Number\.isFinite/);
});
