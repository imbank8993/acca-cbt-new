const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });
const { fixtureDb } = require('./fixture-db.cjs');
const { ExamAttemptsService } = require('../src/students/exam-attempts.service.ts');
const { ProctoringService } = require('../src/proctoring/proctoring.service.ts');
const { attemptHealth } = require('../src/common/attempt-health.ts');

// Siswa tidak tahu ujiannya pernah dibuka di perangkat lain. Pesan harus netral
// dan menyebut perangkatnya; pengawas harus bisa melihat perangkat pemegang dan
// perangkat yang ditolak; dua perangkat yang membuka bersamaan tidak boleh sama-sama lolos.
const user = { id: 'student', isPlatformAdmin: false };
const grading = { gradeAttemptFromSavedAnswers: async () => null };
const laptop = { browser: 'Chrome 120', os: 'Windows', ip_address: '10.0.0.5' };
const phone = { browser: 'Samsung Internet 23', os: 'Android', ip_address: '10.0.0.9' };
const web = file => fs.readFileSync(path.resolve(__dirname, '../../web', file), 'utf8');

function fixture(attempts = []) {
    return fixtureDb({
        cbt_exams: [{ id: 'exam', organization_id: 'school', question_bank_id: 'bank', is_published: true,
            start_time: '2026-10-24T00:00:00Z', end_time: '2026-10-24T04:00:00Z', duration_minutes: 120,
            metadata: { is_public: true } }],
        cbt_organization_members: [{ user_id: user.id, organization_id: 'school', is_active: true }],
        cbt_exam_question_snapshots: [{ exam_id: 'exam', question_snapshot: { id: 'q1', type: 'essay', bank_question_options: [] } }],
        cbt_exam_attempts: attempts, cbt_answers: [], cbt_attempt_security_logs: [],
    }, [], { now: '2026-10-24T00:10:00Z' });
}
const service = db => new ExamAttemptsService(db, {}, grading, { getSchoolTimeZone: async () => 'Asia/Makassar' });

test('the first device is recorded and a second device gets a neutral message naming it', async () => {
    const db = fixture();
    const attempts = service(db);
    const first = await attempts.start(user, 'exam', 'device-laptop', false, laptop);
    assert.equal(first.started, true, first.error);
    assert.deepEqual(db.tables.cbt_exam_attempts[0].metadata.device_bound,
        { ...laptop, at: '2026-10-24T00:10:00.000Z' });

    const refused = await attempts.start(user, 'exam', 'device-phone', false, phone);
    assert.equal(refused.started, false);
    assert.match(refused.error, /sudah dibuka di perangkat lain \(Chrome 120 · Windows, sejak pukul 08:10/);
    assert.match(refused.error, /Jika Anda tidak pernah membukanya di perangkat tersebut, segera lapor pengawas/);
    assert.doesNotMatch(refused.error, /10\.0\.0\.5/, 'IP tidak ditampilkan ke siswa');
    const log = db.tables.cbt_attempt_security_logs.find(entry => entry.event_type === 'DEVICE_SWITCH_BLOCKED');
    assert.deepEqual(log.metadata.attempted_context, phone);
    assert.equal(log.metadata.bound_context.browser, 'Chrome 120');
});

test('two devices opening an unbound attempt at the same time: only one wins', async () => {
    const db = fixture([{ id: 'attempt', exam_id: 'exam', user_id: user.id, status: 'in_progress',
        started_at: '2026-10-24T00:05:00Z', personal_end_time: '2026-10-24T02:05:00Z', device_fingerprint: null,
        metadata: { makeup_exam: true, proctor_recovery_until: '2026-10-24T02:05:00Z' } }]);
    // Kedua permintaan sudah membaca attempt yang belum terikat sebelum salah
    // satunya sempat mengikat: tulisan pengikatan ditahan sampai keduanya tiba.
    const originalFrom = db.from.bind(db);
    let updates = 0, release;
    const gate = new Promise(resolve => { release = resolve; });
    db.from = table => {
        const builder = originalFrom(table);
        if (table !== 'cbt_exam_attempts') return builder;
        let isUpdate = false;
        const wrapped = new Proxy({}, { get(_, prop) {
            if (prop === 'then') return (resolve, reject) =>
                (isUpdate ? gate : Promise.resolve()).then(() => builder.then(resolve, reject));
            return (...args) => {
                if (prop === 'update') { isUpdate = true; if (++updates === 2) release(); }
                builder[prop](...args);
                return wrapped;
            };
        } });
        return wrapped;
    };
    const attempts = service(db);
    const results = await Promise.all([attempts.start(user, 'exam', 'device-laptop', false, laptop),
        attempts.start(user, 'exam', 'device-phone', false, phone)]);
    db.from = originalFrom;
    assert.deepEqual(results.map(result => result.started).sort(), [false, true]);
    const winner = results[0].started ? 'device-laptop' : 'device-phone';
    assert.equal(db.tables.cbt_exam_attempts[0].device_fingerprint, winner);
    assert.match(results.find(result => !result.started).error, /sudah dibuka di perangkat lain/);
});

test('monitoring shows the holder and the rejected device; releasing the device forgets the old holder', async () => {
    const db = fixture();
    const attempts = service(db);
    await attempts.start(user, 'exam', 'device-laptop', false, laptop);
    await attempts.start(user, 'exam', 'device-phone', false, phone);
    const row = db.tables.cbt_exam_attempts[0];
    const health = attemptHealth({ ...row, last_seen_at: '2026-10-24T00:09:00Z' }, {}, [], new Date('2026-10-24T00:10:00Z'), 1,
        db.tables.cbt_attempt_security_logs.map(entry => ({ ...entry, created_at: '2026-10-24T00:10:00Z' })));
    assert.equal(health.device_holder.browser, 'Chrome 120');
    assert.equal(health.device_holder.since, '2026-10-24T00:10:00.000Z');
    assert.deepEqual(health.offline_review.other_device_attempts.last_context, phone);

    const proctor = new ProctoringService(db, { assertExamStaff: async () => {} }, grading);
    await proctor.resetAttempt({ id: 'proctor' }, row.id, 'Perangkat bukan milik siswa', 30, true);
    assert.equal(db.tables.cbt_exam_attempts[0].metadata.device_bound, undefined);
    const moved = await attempts.start(user, 'exam', 'device-phone', false, phone);
    assert.equal(moved.started, true, moved.error);
    assert.equal(db.tables.cbt_exam_attempts[0].metadata.device_bound.browser, 'Samsung Internet 23');
});

test('the raw device ID is not sent to the monitoring browser', () => {
    const monitoring = fs.readFileSync(path.resolve(__dirname, '../src/proctor/exam-monitoring.service.ts'), 'utf8');
    assert.match(monitoring, /device_fingerprint: undefined,/);
});

test('the reset dialog guides the decision and history names the rejected device', () => {
    const modal = web('app/components/monitoring/ResetExamModal.tsx');
    assert.match(modal, /Ujian dibuka dari lebih dari satu perangkat/);
    assert.match(modal, /Tanyakan siswa apakah perangkat ujian itu miliknya/);
    assert.match(modal, /handleModeSelect\('PULIHKAN'\); setReleaseDevice\(true\);/);
    assert.match(modal, /handleModeSelect\('SUSULAN'\)/);
    const history = web('app/components/monitoring/AttemptHistoryModal.tsx');
    assert.match(history, /Perangkat ditolak:/);
    assert.match(history, /'Perangkat ujian'/);
});
