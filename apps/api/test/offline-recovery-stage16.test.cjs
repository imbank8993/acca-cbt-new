// Run from repository root: node --test apps/api/test/offline-recovery-stage16.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });

const { fixtureDb } = require('./fixture-db.cjs');
const { ProctoringService } = require('../src/proctoring/proctoring.service.ts');

const proctor = { id: 'proctor', isPlatformAdmin: false };

function tables() {
    return {
        cbt_exam_attempts: [{
            id: 'attempt', exam_id: 'exam', user_id: 'student', status: 'auto_submitted',
            personal_end_time: '2026-09-19T23:55:00Z', finished_at: '2026-09-20T00:00:00Z',
            warning_count: 2, tab_switch_count: 1, device_fingerprint: 'old-device',
            metadata: { preserved: true, submit_intent_at: '2026-09-19T23:50:00Z' },
        }],
        cbt_answers: [
            { id: 'answer-1', attempt_id: 'attempt', question_id: 'q1' },
            { id: 'answer-2', attempt_id: 'attempt', question_id: 'q2' },
        ],
        cbt_attempt_security_logs: [],
    };
}

function service(db) {
    return new ProctoringService(
        db,
        { assertExamStaff: async () => {} },
        { gradeAttemptFromSavedAnswers: async () => null },
    );
}

test('ANS-03: pemulihan mencatat alasan, aktor, jumlah jawaban, dan deadline dari jam database', async () => {
    const db = fixtureDb(tables(), [], { now: '2026-09-20T00:00:00Z' });
    const result = await service(db).resetAttempt(
        proctor,
        'attempt',
        'Jaringan siswa terputus sampai melewati batas waktu.',
        25,
    );

    assert.equal(result.previousStatus, 'auto_submitted');
    assert.equal(result.serverAnswerCount, 2);
    assert.equal(result.recoveryUntil, '2026-09-20T01:00:00.000Z');
    assert.equal(db.tables.cbt_exam_attempts[0].status, 'in_progress');
    assert.equal(db.tables.cbt_exam_attempts[0].device_fingerprint, 'old-device');
    assert.equal(db.tables.cbt_exam_attempts[0].metadata.recovery_submit_only, true);
    assert.equal(db.tables.cbt_exam_attempts[0].metadata.preserved, true);
    assert.equal(db.tables.cbt_exam_attempts[0].metadata.submit_intent_at, undefined);
    assert.equal(
        db.tables.cbt_exam_attempts[0].metadata.proctor_recovery_until,
        '2026-09-20T01:00:00.000Z',
    );

    const audit = db.tables.cbt_attempt_security_logs[0];
    assert.equal(audit.event_type, 'RESET_BY_PROCTOR');
    assert.equal(audit.metadata.actor_user_id, proctor.id);
    assert.match(audit.metadata.reason, /jaringan siswa/i);
    assert.equal(audit.metadata.server_answer_count, 2);
    assert.equal(audit.metadata.reset_at, '2026-09-20T00:00:00.000Z');
    assert.equal(audit.metadata.recovery_duration_minutes, 60);
    assert.equal(audit.metadata.requested_duration_minutes, 25);
});

test('ANS-03b: reset sesi berjalan tidak pernah memotong sisa waktu (kasus laptop mati)', async () => {
    // Siswa offline dengan sisa 56 menit; proktor memilih 2 menit.
    const data = tables();
    Object.assign(data.cbt_exam_attempts[0], { status: 'in_progress', finished_at: null,
        personal_end_time: '2026-09-20T00:56:00Z', metadata: {} });
    const db = fixtureDb(data, [], { now: '2026-09-20T00:00:00Z' });
    const result = await service(db).resetAttempt(proctor, 'attempt', 'Listrik padam / Laptop mati', 2);
    assert.equal(result.recoveryUntil, '2026-09-20T00:56:00.000Z');
    assert.equal(db.tables.cbt_exam_attempts[0].personal_end_time, '2026-09-20T00:56:00.000Z');
    assert.equal(db.tables.cbt_exam_attempts[0].metadata.recovery_submit_only, false);

    // Sisa waktu sedikit: diperpanjang ke minimum 10 menit, bukan 2 menit.
    const short = tables();
    Object.assign(short.cbt_exam_attempts[0], { status: 'in_progress', finished_at: null,
        personal_end_time: '2026-09-20T00:03:00Z', metadata: {} });
    const db2 = fixtureDb(short, [], { now: '2026-09-20T00:00:00Z' });
    const extended = await service(db2).resetAttempt(proctor, 'attempt', 'Gangguan koneksi internet', 2);
    assert.equal(extended.recoveryUntil, '2026-09-20T00:10:00.000Z');
    assert.equal(db2.tables.cbt_attempt_security_logs[0].metadata.recovery_duration_minutes, 10);
    assert.equal(db2.tables.cbt_attempt_security_logs[0].metadata.requested_duration_minutes, 2);
});

test('ANS-03: alasan kosong atau terlalu pendek ditolak sebelum perubahan data', async () => {
    const db = fixtureDb(tables());
    await assert.rejects(
        service(db).resetAttempt(proctor, 'attempt', '   ', 15),
        error => error.getStatus?.() === 400 && /alasan pemulihan/i.test(error.message),
    );
    assert.equal(db.tables.cbt_exam_attempts[0].status, 'auto_submitted');
    assert.equal(db.writes.length, 0);
});

test('ANS-03: kegagalan menulis audit membatalkan reset secara atomik', async () => {
    const db = fixtureDb(tables(), ['cbt_attempt_security_logs']);
    await assert.rejects(
        service(db).resetAttempt(proctor, 'attempt', 'Gangguan jaringan terverifikasi.', 15),
        error => error.getStatus?.() === 400 && /jejak audit/i.test(error.message),
    );
    assert.equal(db.tables.cbt_exam_attempts[0].status, 'auto_submitted');
    assert.equal(db.tables.cbt_exam_attempts[0].device_fingerprint, 'old-device');
});

test('ANS-03: layar siswa menampilkan jumlah lokal/server dan semua reset mengirim alasan', () => {
    const examPage = fs.readFileSync(
        path.resolve(__dirname, '../../web/app/components/questions/ExamPage.tsx'),
        'utf8',
    );
    const proctoringClient = fs.readFileSync(
        path.resolve(__dirname, '../../web/lib/api/proctoring.ts'),
        'utf8',
    );

    assert.match(examPage, /Lokal:\s*\{recoverySummary\.localCount\}/);
    assert.match(examPage, /Server:\s*\{recoverySummary\.serverCount\}/);
    assert.match(examPage, /jangan hapus data browser atau berpindah perangkat/i);
    assert.match(proctoringClient, /\{ reason, durationMinutes \}/);
    assert.match(proctoringClient, /isRecovery \? '15' : '60'/);
    assert.match(proctoringClient, /Alasan pemulihan minimal 5 karakter/);
});
