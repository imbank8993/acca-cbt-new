// Run from repository root: node --test --test-isolation=none apps/api/test/makeup-exam-stage75.test.cjs
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

const staff = { id: 'staff-75', isPlatformAdmin: false };
const fixedNow = '2026-09-30T02:00:00.000Z';

function makeService() {
    const db = fixtureDb({
        cbt_exam_attempts: [{
            id: 'attempt-75',
            exam_id: 'exam-75',
            user_id: 'student-75',
            status: 'submitted',
            started_at: '2026-09-29T01:00:00.000Z',
            finished_at: '2026-09-29T02:00:00.000Z',
            personal_end_time: '2026-09-29T02:00:00.000Z',
            total_score: 78,
            score_irt: 64,
            irt_theta: 0.4,
            needs_manual_grading: false,
            warning_count: 2,
            tab_switch_count: 1,
            device_fingerprint: 'old-device',
            metadata: {
                base_score: 78,
                dimension_scores: { literasi: 80 },
                stable_marker: 'tetap',
            },
        }],
        cbt_answers: [
            { id: 'answer-1', attempt_id: 'attempt-75', question_id: 'q-1', answer: 'A' },
            { id: 'answer-2', attempt_id: 'attempt-75', question_id: 'q-2', answer: 'B' },
        ],
        cbt_attempt_security_logs: [],
    }, [], { now: fixedNow });
    const authz = {
        checkedExamIds: [],
        async assertExamStaff(_user, examId) {
            this.checkedExamIds.push(examId);
        },
    };
    const grading = {};
    return { db, authz, service: new ProctoringService(db, authz, grading) };
}

test('SUSULAN-75: susulan penuh menghapus jawaban lama dan memulai waktu khusus pada attempt yang sama', async () => {
    const { db, authz, service } = makeService();

    const result = await service.startMakeupAttempt(
        staff,
        'attempt-75',
        'Siswa mengalami kerusakan perangkat.',
        90,
        '00000000-0000-4000-8000-000000000075',
    );

    const attempt = db.tables.cbt_exam_attempts[0];
    assert.equal(result.attemptId, 'attempt-75');
    assert.equal(attempt.exam_id, 'exam-75');
    assert.equal(authz.checkedExamIds[0], 'exam-75');
    assert.equal(result.deletedAnswerCount, 2);
    assert.deepEqual(db.tables.cbt_answers, []);
    assert.equal(attempt.status, 'in_progress');
    assert.equal(attempt.started_at, fixedNow);
    assert.equal(attempt.finished_at, null);
    assert.equal(attempt.personal_end_time, '2026-09-30T03:30:00.000Z');
    assert.equal(attempt.total_score, null);
    assert.equal(attempt.score_irt, null);
    assert.equal(attempt.irt_theta, null);
    assert.equal(attempt.warning_count, 0);
    assert.equal(attempt.tab_switch_count, 0);
    assert.equal(attempt.device_fingerprint, null);
    assert.equal(attempt.metadata.base_score, undefined);
    assert.equal(attempt.metadata.dimension_scores, undefined);
    assert.equal(attempt.metadata.stable_marker, 'tetap');
    assert.equal(attempt.metadata.makeup_exam, true);
    assert.equal(attempt.metadata.makeup_duration_minutes, 90);

    const audit = db.tables.cbt_attempt_security_logs[0];
    assert.equal(audit.event_type, 'MAKEUP_EXAM_STARTED');
    assert.equal(audit.metadata.deleted_answer_count, 2);
    assert.equal(audit.metadata.previous_status, 'submitted');
    assert.equal(audit.metadata.client_request_id, '00000000-0000-4000-8000-000000000075');

    // Simulasikan respons pertama hilang dan siswa sudah sempat menjawab lagi.
    db.tables.cbt_answers.push({
        id: 'new-answer', attempt_id: 'attempt-75', question_id: 'q-1', answer: 'C',
    });
    const retry = await service.startMakeupAttempt(
        staff,
        'attempt-75',
        'Siswa mengalami kerusakan perangkat.',
        90,
        '00000000-0000-4000-8000-000000000075',
    );
    assert.equal(retry.deletedAnswerCount, 2);
    assert.equal(db.tables.cbt_answers.length, 1);
    assert.equal(db.tables.cbt_answers[0].id, 'new-answer');
    assert.equal(db.tables.cbt_attempt_security_logs.length, 1);
});

test('SUSULAN-75: pemulihan biasa mempertahankan jawaban lama', async () => {
    const { db, service } = makeService();

    const result = await service.resetAttempt(
        staff,
        'attempt-75',
        'Lanjutkan jawaban setelah gangguan jaringan.',
    );

    assert.equal(db.tables.cbt_answers.length, 2);
    assert.equal(result.serverAnswerCount, 2);
    assert.equal(db.tables.cbt_exam_attempts[0].status, 'in_progress');
    assert.equal(db.tables.cbt_attempt_security_logs[0].event_type, 'RESET_BY_PROCTOR');
});

test('SUSULAN-75: durasi tidak valid ditolak sebelum data diubah', async () => {
    const { db, service } = makeService();

    await assert.rejects(
        service.startMakeupAttempt(staff, 'attempt-75', 'Durasi tidak sah.', 0),
        /1–1440 menit/,
    );
    assert.equal(db.tables.cbt_answers.length, 2);
    assert.equal(db.tables.cbt_exam_attempts[0].status, 'submitted');
});

test('SUSULAN-75: route web meneruskan susulan dan heartbeat ke API', () => {
    const webRoot = path.resolve(__dirname, '../../web/app/api/proctoring/attempts/[attemptId]');
    const makeupRoute = fs.readFileSync(path.join(webRoot, 'makeup/route.ts'), 'utf8');
    const heartbeatRoute = fs.readFileSync(path.join(webRoot, 'heartbeat/route.ts'), 'utf8');

    assert.match(makeupRoute, /\/proctoring\/attempts\/\$\{encodeURIComponent\(attemptId\)\}\/makeup/);
    assert.match(heartbeatRoute, /\/proctoring\/attempts\/\$\{encodeURIComponent\(attemptId\)\}\/heartbeat/);
});
