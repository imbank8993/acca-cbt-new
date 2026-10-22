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
        cbt_exams: [{ id: 'exam-75', show_results: false, end_time: fixedNow, metadata: {} }],
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
            detailed_scores: { irt: 64 },
            irt_theta: 0.4,
            needs_manual_grading: false,
            warning_count: 2,
            tab_switch_count: 1,
            device_fingerprint: 'old-device',
            metadata: {
                base_score: 78,
                teacher_score: 90, teacher_feedback: "old feedback", graded_at: fixedNow,
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
    assert.equal(attempt.detailed_scores, null);
    for (const key of ["teacher_score", "teacher_feedback", "graded_at"]) assert.equal(attempt.metadata[key], undefined);
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

test('Sesi aktif dapat dipulihkan tanpa menghapus jawaban dan tetap mengizinkan pengeditan', async () => {
    const { db, service } = makeService();
    const attempt = db.tables.cbt_exam_attempts[0];
    attempt.status = 'in_progress';
    attempt.finished_at = null;
    attempt.personal_end_time = '2026-09-30T02:15:00.000Z';

    const result = await service.resetAttempt(staff, attempt.id, 'Gangguan saat mengerjakan.', 30);
    assert.equal(result.previousStatus, 'in_progress');
    assert.equal(attempt.status, 'in_progress');
    assert.equal(attempt.personal_end_time, '2026-09-30T02:30:00.000Z');
    assert.equal(attempt.metadata.recovery_submit_only, false);
    assert.equal(attempt.device_fingerprint, 'old-device');
    assert.equal(db.tables.cbt_answers.length, 2);
    assert.equal(db.tables.cbt_attempt_security_logs[0].metadata.previous_status, 'in_progress');
});

test('Memperpanjang sesi pemulihan yang sedang berjalan tidak membuka izin mengubah jawaban', async () => {
    const { db, service } = makeService();
    const attempt = db.tables.cbt_exam_attempts[0];
    attempt.status = 'in_progress';
    attempt.metadata.recovery_submit_only = true;
    await service.resetAttempt(staff, attempt.id, 'Perpanjang pengiriman jawaban.', 15);
    assert.equal(attempt.metadata.recovery_submit_only, true);
    assert.equal(db.tables.cbt_answers.length, 2);
});

test('Sesi aktif dapat dimulai ulang dengan generasi baru dan jawaban server dikosongkan', async () => {
    const { db, service } = makeService();
    const attempt = db.tables.cbt_exam_attempts[0];
    attempt.status = 'in_progress';
    attempt.finished_at = null;
    const oldStart = attempt.started_at;

    const result = await service.startMakeupAttempt(staff, attempt.id, 'Pengujian ulang oleh pengawas.', 60,
        '00000000-0000-4000-8000-000000000076');
    assert.equal(result.previousStatus, 'in_progress');
    assert.equal(attempt.started_at, fixedNow);
    assert.equal(attempt.metadata.active_restart_at, fixedNow);
    assert.deepEqual(db.tables.cbt_answers, []);
    assert.equal(attempt.device_fingerprint, null);
    assert.notEqual(attempt.started_at, oldStart);
});

test('Reset sesi aktif ditolak saat pengumpulan jawaban sedang diproses', async () => {
    const { db, service } = makeService();
    const attempt = db.tables.cbt_exam_attempts[0];
    attempt.status = 'in_progress';
    attempt.metadata.submit_intent_at = fixedNow;
    attempt.metadata.submit_intent_digest = 'a'.repeat(64);
    await assert.rejects(service.resetAttempt(staff, attempt.id, 'Coba pulihkan saat submit.', 30), /sedang diproses/);
    await assert.rejects(service.startMakeupAttempt(staff, attempt.id, 'Coba ulang saat submit.', 30), /sedang diproses/);
    assert.equal(attempt.status, 'in_progress');
    assert.equal(db.tables.cbt_answers.length, 2);
});

test('Heartbeat sesi lama meminta siswa memuat ulang setelah mulai ulang', async () => {
    const { db, service } = makeService();
    const attempt = db.tables.cbt_exam_attempts[0];
    attempt.status = 'in_progress';
    attempt.started_at = fixedNow;
    attempt.metadata.active_restart_at = fixedNow;
    const result = await service.heartbeat({ id: 'student-75' }, attempt.id, 'old-device',
        undefined, undefined, undefined, '2026-09-29T01:00:00.000Z');
    assert.equal(result.restartRequired, true);
    assert.equal(result.startedAt, fixedNow);
});

test('SUSULAN-75: pemulihan biasa mempertahankan jawaban lama', async () => {
    const { db, service } = makeService();

    const result = await service.resetAttempt(
        staff,
        'attempt-75',
        'Lanjutkan jawaban setelah gangguan jaringan.',
        30,
    );

    assert.equal(db.tables.cbt_answers.length, 2);
    assert.equal(result.serverAnswerCount, 2);
    assert.equal(db.tables.cbt_exam_attempts[0].detailed_scores, null);
    for (const key of ["teacher_score", "teacher_feedback", "graded_at"]) assert.equal(db.tables.cbt_exam_attempts[0].metadata[key], undefined);
    assert.equal(result.recoveryUntil, '2026-09-30T02:30:00.000Z');
    assert.equal(db.tables.cbt_exam_attempts[0].status, 'in_progress');
    assert.equal(db.tables.cbt_exam_attempts[0].personal_end_time, '2026-09-30T02:30:00.000Z');
    assert.equal(db.tables.cbt_exam_attempts[0].metadata.proctor_recovery_until, '2026-09-30T02:30:00.000Z');
    assert.equal(db.tables.cbt_attempt_security_logs[0].metadata.recovery_duration_minutes, 30);
    assert.equal(db.tables.cbt_attempt_security_logs[0].event_type, 'RESET_BY_PROCTOR');
});

test('SUSULAN-75: durasi pemulihan di luar batas ditolak tanpa mengubah attempt', async () => {
    const { db, service } = makeService();

    await assert.rejects(
        service.resetAttempt(staff, 'attempt-75', 'Durasi pemulihan tidak sah.', 1441),
        /1–1440 menit/,
    );
    assert.equal(db.tables.cbt_exam_attempts[0].status, 'submitted');
    assert.equal(db.tables.cbt_answers.length, 2);
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
