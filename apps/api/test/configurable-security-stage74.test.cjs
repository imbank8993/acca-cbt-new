// Run from repository root: node --test apps/api/test/configurable-security-stage74.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

require('ts-node').register({
    project: path.resolve(__dirname, '../tsconfig.json'),
    transpileOnly: true,
});

const { fixtureDb } = require('./fixture-db.cjs');
const { ProctoringService } = require('../src/proctoring/proctoring.service.ts');

const user = { id: 'student-security', isPlatformAdmin: false };

function makeService(metadata) {
    const db = fixtureDb({
        cbt_exams: [{ id: 'exam-security', metadata }],
        cbt_exam_attempts: [{
            id: 'attempt-security',
            user_id: user.id,
            exam_id: 'exam-security',
            organization_id: 'org-1',
            status: 'in_progress',
            warning_count: 0,
            tab_switch_count: 0,
        }],
        cbt_attempt_security_logs: [],
    }, [], { now: '2026-09-29T06:00:00.000Z' });
    const grading = {
        gradeAttemptFromSavedAnswers: async () => null,
        applyRelativeQuizScoringIfQuiz: async () => undefined,
    };
    return { db, service: new ProctoringService(db, {}, grading) };
}

test('SEC-74: server menutup attempt tepat saat batas pelanggaran tercapai', async () => {
    const { db, service } = makeService({ is_safe_mode: true, max_violations: 2 });

    const first = await service.logViolation(user, 'attempt-security', 'tab_switch', {}, 'event-1');
    const second = await service.logViolation(user, 'attempt-security', 'exit_fullscreen', {}, 'event-2');

    assert.equal(first.terminated, false);
    assert.equal(first.maxViolations, 2);
    assert.equal(second.warningCount, 2);
    assert.equal(second.terminated, true);
    assert.equal(db.tables.cbt_exam_attempts[0].status, 'auto_submitted');
    assert.equal(
        db.tables.cbt_attempt_security_logs.filter((row) => row.event_type === 'FORCE_TERMINATED').length,
        1,
    );

    // Respons terminasi yang hilang boleh dikirim ulang tanpa membuat log baru.
    const retry = await service.logViolation(user, 'attempt-security', 'exit_fullscreen', {}, 'event-2');
    assert.equal(retry.duplicate, true);
    assert.equal(retry.terminated, true);
});

test('SEC-74: mode tanpa batas tetap merekam semua pelanggaran tanpa menutup ujian', async () => {
    const { db, service } = makeService({ is_safe_mode: true, max_violations: null });

    for (let index = 1; index <= 5; index++) {
        const result = await service.logViolation(
            user,
            'attempt-security',
            index % 2 ? 'tab_switch' : 'restricted_shortcut',
            {},
            `unlimited-${index}`,
        );
        assert.equal(result.maxViolations, null);
        assert.equal(result.terminated, false);
    }

    assert.equal(db.tables.cbt_exam_attempts[0].status, 'in_progress');
    assert.equal(db.tables.cbt_exam_attempts[0].warning_count, 5);
    assert.equal(db.tables.cbt_attempt_security_logs.length, 5);
});

test('SEC-74: mode aman nonaktif tidak menutup attempt dan ujian lama tetap berbatas tiga', async () => {
    const disabled = makeService({ is_safe_mode: false, max_violations: 1 });
    const disabledResult = await disabled.service.logViolation(
        user, 'attempt-security', 'tab_switch', {}, 'disabled-1',
    );
    assert.equal(disabledResult.maxViolations, null);
    assert.equal(disabled.db.tables.cbt_exam_attempts[0].status, 'in_progress');

    const legacy = makeService({ is_safe_mode: true });
    const legacyResult = await legacy.service.logViolation(
        user, 'attempt-security', 'tab_switch', {}, 'legacy-1',
    );
    assert.equal(legacyResult.maxViolations, 3);
});

test('SEC-74: form menyediakan batas angka dan pilihan tanpa batas', () => {
    const form = fs.readFileSync(
        path.resolve(__dirname, '../../web/components/exams/CreateExamModal.tsx'),
        'utf8',
    );
    const page = fs.readFileSync(
        path.resolve(__dirname, '../../web/app/components/questions/ExamPage.tsx'),
        'utf8',
    );
    assert.match(form, /maxViolations: number \| null/);
    assert.match(form, /Tanpa batas/);
    assert.match(form, /Batas jumlah pelanggaran/);
    assert.doesNotMatch(page, /const MAX_VIOLATIONS = 3/);
    assert.match(page, /result\.terminated/);
});
