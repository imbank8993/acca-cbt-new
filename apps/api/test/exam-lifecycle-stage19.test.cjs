// Run from repository root: node --test apps/api/test/exam-lifecycle-stage19.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });

const { fixtureDb } = require('./fixture-db.cjs');
const { ExamAttemptsService } = require('../src/students/exam-attempts.service.ts');
const { ProctoringService } = require('../src/proctoring/proctoring.service.ts');
const { ExamMonitoringService } = require('../src/proctor/exam-monitoring.service.ts');

const student = { id: 'student-1', isPlatformAdmin: false };
const proctor = { id: 'proctor-1', isPlatformAdmin: false };

function deferred() {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
}

function tables() {
    return {
        cbt_exams: [{
            id: 'exam-1', organization_id: 'school-1', question_bank_id: 'bank-1',
            start_time: '2026-09-19T22:00:00Z', end_time: '2026-09-20T02:00:00Z',
            duration_minutes: 60,
        }],
        cbt_exam_attempts: [{
            id: 'attempt-1', organization_id: 'school-1', exam_id: 'exam-1',
            user_id: student.id, status: 'in_progress', started_at: '2026-09-19T23:00:00Z',
            personal_end_time: '2026-09-20T01:00:00Z', device_fingerprint: 'device-1',
            total_score: 88, score_irt: 1.2, irt_theta: 0.7, needs_manual_grading: true,
            metadata: { base_score: 88, dimension_scores: { verbal: 88 }, keep_me: true },
        }],
        cbt_answers: [],
        cbt_attempt_security_logs: [],
    };
}

function attemptService(db, grading) {
    return new ExamAttemptsService(db, { post: async () => ({
        items: [], scaled_score: 0, needs_manual_grading: false, dimension_scores: {},
    }) }, grading);
}

function proctoringService(db, grading) {
    return new ProctoringService(db, { assertExamStaff: async () => {}, assertProktor: async () => {} }, grading);
}

test('LIF-01: hasil auto-finish lama tidak menimpa attempt yang sudah di-reset', async () => {
    const db = fixtureDb(tables(), [], { now: '2026-09-20T00:00:00Z' });
    const gate = deferred();
    const attempts = attemptService(db, { gradeAttemptFromSavedAnswers: async () => gate.promise });

    const finishing = attempts.autoFinish('attempt-1', new Date('2026-09-20T00:00:00Z'));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(db.tables.cbt_exam_attempts[0].status, 'auto_submitted');

    await proctoringService(db, {}).resetAttempt(proctor, 'attempt-1', 'Pemulihan setelah koneksi terputus');
    assert.equal(db.tables.cbt_exam_attempts[0].status, 'in_progress');
    assert.equal(db.tables.cbt_exam_attempts[0].total_score, null);
    assert.equal(db.tables.cbt_exam_attempts[0].metadata.base_score, undefined);
    assert.equal(db.tables.cbt_exam_attempts[0].metadata.keep_me, true);

    gate.resolve({ finalScore100: 31, hasEssay: false });
    await finishing;
    assert.equal(db.tables.cbt_exam_attempts[0].status, 'in_progress');
    assert.equal(db.tables.cbt_exam_attempts[0].total_score, null);
});

test('LIF-01: terminasi dan audit atomik mendahului reset, grading lama tidak bocor', async () => {
    const db = fixtureDb(tables(), [], { now: '2026-09-20T00:00:00Z' });
    const gate = deferred();
    const proctoring = proctoringService(db, { gradeAttemptFromSavedAnswers: async () => gate.promise });

    const terminating = proctoring.forceTerminate(student, 'attempt-1', 'Batas pelanggaran tercapai');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(db.tables.cbt_exam_attempts[0].status, 'auto_submitted');
    assert.equal(db.tables.cbt_attempt_security_logs[0].event_type, 'FORCE_TERMINATED');

    await proctoring.resetAttempt(proctor, 'attempt-1', 'Izinkan siswa melanjutkan ujian');
    gate.resolve({ finalScore100: 42, hasEssay: false });
    await terminating;

    assert.equal(db.tables.cbt_exam_attempts[0].status, 'in_progress');
    assert.equal(db.tables.cbt_exam_attempts[0].total_score, null);
    assert.deepEqual(
        db.tables.cbt_attempt_security_logs.map(row => row.event_type),
        ['FORCE_TERMINATED', 'RESET_BY_PROCTOR'],
    );
});

test('LIF-02: monitoring menutup status sebelum menunggu layanan penilaian', async () => {
    const data = tables();
    data.cbt_exams[0].end_time = '2020-01-01T00:00:00Z';
    data.cbt_exam_attempts[0].personal_end_time = '2020-01-01T00:00:00Z';
    const db = fixtureDb(data);
    const gate = deferred();
    const monitoring = new ExamMonitoringService(
        db,
        {},
        {},
        {
            gradeAttemptFromSavedAnswers: async () => gate.promise,
            retryPendingAutoSubmissions: async () => ({ recovered: 0, failed: 0 }),
            applyRelativeQuizScoringIfQuiz: async () => ({}),
        },
        {},
    );

    const finalizing = monitoring.finalizeExpired('exam-1');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(db.tables.cbt_exam_attempts[0].status, 'auto_submitted');

    gate.resolve({ finalScore100: 73, hasEssay: true });
    await finalizing;
    assert.equal(db.tables.cbt_exam_attempts[0].total_score, 73);
    assert.equal(db.tables.cbt_exam_attempts[0].needs_manual_grading, true);
});

test('LIF-03: validator migrasi memasukkan seluruh migrasi tahap 15-18', () => {
    const validator = fs.readFileSync(path.resolve(__dirname, '../../../tools/validate-migrations.js'), 'utf8');
    const audit = fs.readFileSync(path.resolve(__dirname, '../../../tools/audit-exam-lifecycle-db.js'), 'utf8');
    for (const file of [
        '20260925_01_add_updated_at_question_banks.sql',
        '20260926_01_unique_active_exam_attempt.sql',
        '20260926_02_offline_proctoring.sql',
    ]) {
        assert.match(validator, new RegExp(file.replaceAll('.', '\\.')));
    }
    assert.match(validator, /cbt_exam_attempts_one_active_per_user_exam/);
    assert.match(validator, /cbt_security_logs_client_event_unique/);
    assert.match(audit, /default_transaction_read_only = on/);
    assert.match(audit, /--expect-db=/);
    assert.match(audit, /file \.env tidak dibaca otomatis/);
});
