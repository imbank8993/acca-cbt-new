// Run from repository root: node --test apps/api/test/attempt-start-stage15.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });

const { fixtureDb } = require('./fixture-db.cjs');
const { ExamAttemptsService } = require('../src/students/exam-attempts.service.ts');

const user = { id: 'student', isPlatformAdmin: false };

function tables() {
    return {
        cbt_exams: [{
            id: 'exam', organization_id: 'school', question_bank_id: 'bank',
            is_published: true, start_time: '2026-09-19T23:00:00Z',
            end_time: '2026-09-20T01:00:00Z', duration_minutes: 60,
            metadata: { is_public: true },
        }],
        cbt_exam_attempts: [],
        cbt_answers: [],
        cbt_attempt_security_logs: [],
        cbt_organization_members: [
            { user_id: user.id, organization_id: 'school', is_active: true },
        ],
        cbt_class_members: [],
        cbt_additional_class_members: [],
        cbt_exam_participants: [],
    };
}

function service(db) {
    return new ExamAttemptsService(
        db,
        { post: async () => ({ items: [], scaled_score: 0, needs_manual_grading: false, dimension_scores: {} }) },
        { gradeAttemptFromSavedAnswers: async () => null },
    );
}

/** Fixture tidak mempunyai lock PostgreSQL; antrekan ini meniru serialisasi transaksi advisory lock. */
function serializeTransactions(db) {
    const original = db.transaction.bind(db);
    let tail = Promise.resolve();
    db.transaction = async work => {
        const previous = tail;
        let release;
        tail = new Promise(resolve => { release = resolve; });
        await previous;
        try {
            return await original(work);
        } finally {
            release();
        }
    };
    return db;
}

test('ANS-05: dua start bersamaan dari perangkat sama memakai satu attempt', async () => {
    const db = serializeTransactions(fixtureDb(tables()));
    const rawCalls = [];
    const originalRaw = db.raw.bind(db);
    db.raw = async (sql, ...params) => {
        rawCalls.push({ sql, params });
        return originalRaw(sql, ...params);
    };

    const attempts = service(db);
    const [first, second] = await Promise.all([
        attempts.start(user, 'exam', 'device-one'),
        attempts.start(user, 'exam', 'device-one'),
    ]);

    assert.equal(first.started, true);
    assert.equal(second.started, true);
    assert.equal(first.attempt.id, second.attempt.id);
    assert.equal(db.tables.cbt_exam_attempts.length, 1);
    assert.ok(rawCalls.some(call => /pg_advisory_xact_lock/.test(call.sql)));
    assert.ok(rawCalls.some(call => call.params[0] === 'exam:student'));
});

test('ANS-05: perangkat kedua tidak membuat attempt lain ketika start bersamaan', async () => {
    const db = serializeTransactions(fixtureDb(tables()));
    const [one, two] = await Promise.all([
        service(db).start(user, 'exam', 'device-one'),
        service(db).start(user, 'exam', 'device-two'),
    ]);

    assert.equal(db.tables.cbt_exam_attempts.length, 1);
    assert.deepEqual([one.started, two.started].sort(), [false, true]);
    const refused = one.started ? two : one;
    assert.match(refused.error, /sudah dibuka di perangkat lain/i);
    assert.equal(db.tables.cbt_attempt_security_logs.length, 1);
});

test('ANS-05: migrasi menolak data ganda lalu memasang unique index parsial', () => {
    const migration = fs.readFileSync(
        path.resolve(__dirname, '../../../database/migrations/20260926_01_unique_active_exam_attempt.sql'),
        'utf8',
    );

    assert.match(migration, /HAVING COUNT\(\*\) > 1/i);
    assert.match(migration, /RAISE EXCEPTION/i);
    assert.match(migration, /CREATE UNIQUE INDEX[\s\S]+\(exam_id, user_id\)[\s\S]+WHERE status = 'in_progress'/i);
});
