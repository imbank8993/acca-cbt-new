const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });
const { irtRecalculationStatus, hasIrtScore, usesIrtScoring } = require('../../web/lib/irt-status.ts');
const web = file => fs.readFileSync(path.resolve(__dirname, '../../web', file), 'utf8');

test('IRT scores are recognised only when finite', () => {
    assert.equal(hasIrtScore({ score_irt: 61.2 }), true);
    assert.equal(hasIrtScore({ score_irt: '0' }), true);
    for (const score_irt of [null, undefined, '', 'abc']) assert.equal(hasIrtScore({ score_irt }), false);
    assert.equal(usesIrtScoring('classical, irt_2pl'), true);
    assert.equal(usesIrtScoring('classical'), false);
});

test('a participant restored after IRT was calculated is reported until IRT is recalculated', () => {
    const scored = { status: 'submitted', score_irt: 70, metadata: { irt_score_scale: 'theta' } };
    // Selama jendela pemulihan.
    assert.deepEqual(irtRecalculationStatus([scored, { status: 'in_progress', score_irt: null,
        metadata: { proctor_recovery_until: '2026-10-24T08:00:00Z' } }], 'irt_2pl'), { calculated: true, missing: 0, recovering: 1 });
    // Sudah mengirim ulang, IRT belum dihitung ulang.
    assert.deepEqual(irtRecalculationStatus([scored, { status: 'submitted', score_irt: null }], 'irt_2pl'),
        { calculated: true, missing: 1, recovering: 0 });
    // Sudah dihitung ulang.
    assert.deepEqual(irtRecalculationStatus([scored, { status: 'submitted', score_irt: 55, metadata: { irt_score_scale: 'theta' } }], 'irt_2pl'),
        { calculated: true, missing: 0, recovering: 0 });
});

test('no notice before IRT was ever calculated or for classical exams', () => {
    const rows = [{ status: 'submitted', score_irt: null }, { status: 'in_progress', metadata: { proctor_recovery_until: 'x' } }];
    assert.deepEqual(irtRecalculationStatus(rows, 'irt_2pl'), { calculated: false, missing: 0, recovering: 0 });
    assert.deepEqual(irtRecalculationStatus([{ status: 'submitted', score_irt: 70, metadata: { irt_score_scale: 'theta' } }, ...rows], 'classical'),
        { calculated: false, missing: 0, recovering: 0 });
});

test('legacy 0–100 IRT results require recalculation while negative theta is complete', () => {
    assert.deepEqual(irtRecalculationStatus([{ status:'submitted', score_irt:80 }], 'irt_1pl'),
        { calculated:true, missing:1, recovering:0 });
    assert.deepEqual(irtRecalculationStatus([{ status:'submitted', score_irt:-1.75, metadata:{irt_score_scale:'theta'} }], 'irt_1pl'),
        { calculated:true, missing:0, recovering:0 });
});

test('reset dialog warns when the participant already has an IRT score, including bulk reset', () => {
    const modal = web('app/components/monitoring/ResetExamModal.tsx');
    assert.match(modal, /const irtScored = irtScoredCount \?\? \(hasIrtScore\(attempt\) \? 1 : 0\);/);
    assert.match(modal, /Skor IRT sudah dihitung/);
    assert.match(modal, /tekan <strong>Kalkulasi IRT<\/strong> lagi/);
    assert.match(web('app/components/monitoring/BulkResetPanel.tsx'), /irtScoredCount=\{batch\.filter\(hasIrtScore\)\.length\}/);
});

test('every monitoring page that can calculate IRT shows the recalculation notice', () => {
    for (const role of ['admin', 'guru', 'proktor']) {
        const page = web(`app/dashboard/${role}/monitoring/page.tsx`);
        assert.match(page, /<IrtRecalculationNotice/, role);
        assert.match(page, /selectedExamId && hasIRTScoring && \(/, role);
    }
});
