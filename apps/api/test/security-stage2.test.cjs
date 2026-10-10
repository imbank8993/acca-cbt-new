const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });
const { fixtureDb } = require('./fixture-db.cjs');
const { NotificationsService } = require('../src/notifications/notifications.service.ts');
const { QuestionsService } = require('../src/questions/questions.service.ts');
const { TeachersService } = require('../src/teachers/teachers.service.ts');
const { ImportsService } = require('../src/imports/imports.service.ts');
const { ProctoringService, STUDENT_SECURITY_EVENTS } = require('../src/proctoring/proctoring.service.ts');
const { StorageController } = require('../src/storage/storage.controller.ts');
const { StorageService } = require('../src/storage/storage.service.ts');
const user = { id: 'user-A', isPlatformAdmin: false };
const rejected = error => [400,403,404].includes(error.getStatus?.());

test('SEC-05: preference identity and timestamps cannot be overridden', async () => {
    const db = fixtureDb();
    await new NotificationsService(db).updatePreferences(user, { user_id: 'victim', id: 'victim-pref',
        email_enabled: false, updated_at: 'yesterday', injected_column: true });
    const saved = db.tables.cbt_notification_preferences[0];
    assert.equal(saved.user_id, user.id);
    assert.notEqual(saved.id, 'victim-pref');
    assert.equal(saved.email_enabled, false);
    assert.notEqual(saved.updated_at, 'yesterday');
    assert.equal(saved.injected_column, undefined);
});
for (const preferences of [{ email_enabled: 'false' }, { exam_reminder_minutes: -1 },
    { exam_reminder_minutes: 1.5 }, { quiet_hours_start: '25:00' }]) {
    test(`SEC-05: rejects invalid preference ${JSON.stringify(preferences)}`, async () => {
        const db = fixtureDb();
        await assert.rejects(new NotificationsService(db).updatePreferences(user, preferences), rejected);
        assert.equal(db.writes.length, 0);
    });
}
test('SEC-05: valid legacy quiet-hours and clearing values are accepted', async () => {
    const db = fixtureDb();
    await new NotificationsService(db).updatePreferences(user, { quiet_hours_start: '22:00:00', quiet_hours_end: '', exam_reminder_minutes: 30 });
    assert.equal(db.tables.cbt_notification_preferences[0].quiet_hours_start, '22:00:00');
    assert.equal(db.tables.cbt_notification_preferences[0].quiet_hours_end, null);
});

const questionDto = { id: 'q', bankId: 'own-bank', type: 'essay', questionText: 'Updated', scoreDefault: 10 };
function questionService(db) {
    return new QuestionsService(db, { assertBankAccess: async () => 'school' }, { regradeExamAttemptsByQuestion: async () => {} });
}
test('SEC-07: foreign question ID rejected before any write', async () => {
    const db = fixtureDb({ cbt_bank_questions: [{ id: 'q', bank_id: 'foreign-bank' }] });
    await assert.rejects(questionService(db).save(user, questionDto), rejected);
    assert.equal(db.writes.length, 0);
});
test('SEC-07: foreign option ID rejected before question changes', async () => {
    const db = fixtureDb({ cbt_bank_questions: [{ id: 'q', bank_id: 'own-bank' }],
        cbt_bank_question_options: [{ id: 'foreign-option', question_id: 'other-q' }] });
    await assert.rejects(questionService(db).save(user, { ...questionDto, options: [{ id: 'foreign-option', text: 'X', isCorrect: true }] }), rejected);
    assert.equal(db.writes.length, 0);
});
test('SEC-07: cross-bank stimulus rejected before question changes', async () => {
    const db = fixtureDb({ cbt_bank_questions: [{ id: 'q', bank_id: 'own-bank' }],
        cbt_question_stimuli: [{ id: 'stimulus', bank_id: 'foreign-bank' }] });
    await assert.rejects(questionService(db).save(user, { ...questionDto, stimulusId: 'stimulus' }), rejected);
    assert.equal(db.writes.length, 0);
});
test('SEC-07 / BUG-07: own question and option update preserves zero weight', async () => {
    const db = fixtureDb({ cbt_bank_questions: [{ id: 'q', bank_id: 'own-bank' }],
        cbt_bank_question_options: [{ id: 'option', question_id: 'q', weight: 2 }] });
    const result = await questionService(db).save(user, { ...questionDto, options: [{ id: 'option', text: 'X', isCorrect: false, weight: 0 }] });
    assert.equal(result.id, 'q');
    assert.equal(db.tables.cbt_bank_question_options[0].weight, 0);
    assert.equal(db.tables.cbt_bank_questions[0].question_text, 'Updated');
});
test('SEC-07: creating question cannot reuse an existing option ID', async () => {
    const db = fixtureDb();
    await assert.rejects(questionService(db).save(user, { ...questionDto, id: undefined,
        options: [{ id: 'foreign', text: 'X', isCorrect: false }] }), rejected);
    assert.equal(db.writes.length, 0);
});
test('SEC-11: both permission check and bulk import use bank ownership policy', async () => {
    let calls = 0;
    const service = new ImportsService(fixtureDb(), { assertBankAccess: async (_, id) => {
        assert.equal(id, 'foreign-bank'); calls++; throw Error('bank denied');
    }});
    await assert.rejects(service.assertCanImport(user, 'foreign-bank'), /bank denied/);
    await assert.rejects(service.bulkImport(user, 'foreign-bank', []), /bank denied/);
    assert.equal(calls, 2);
});

function gradingFixture(options = {}) {
    const db = fixtureDb({
        cbt_exam_attempts: [{ id: 'attempt', exam_id: 'exam', status: 'submitted' }],
        cbt_exams: [{ id: 'exam', question_bank_id: 'bank' }],
        cbt_bank_questions: [
            { id: 'essay-1', bank_id: 'bank', type: 'essay', score_default: 10 },
            { id: 'essay-2', bank_id: 'bank', type: 'essay', score_default: 10 },
            { id: 'mcq', bank_id: 'bank', type: 'mcq', score_default: 10 },
            { id: 'personality', bank_id: 'bank', type: 'sjt', score_default: 100 },
        ],
        cbt_answers: [
            { id: 'a1', question_id: 'essay-1', attempt_id: 'attempt', score: 0, is_correct: null },
            { id: 'a2', question_id: 'essay-2', attempt_id: 'attempt', score: 0, is_correct: null },
            { id: 'a3', question_id: 'mcq', attempt_id: 'attempt', score: 10, is_correct: true },
            { id: 'a4', question_id: 'personality', attempt_id: 'attempt', score: 999, is_correct: null },
            { id: 'foreign', question_id: 'essay-1', attempt_id: 'other', score: 0, is_correct: null },
        ],
    }, [], options);
    const service = new TeachersService(db, { assertExamStaff: async () => {} }, {},
        { applyRelativeQuizScoringIfQuiz: async () => ({}) });
    return { db, service };
}
for (const [name, grades] of [['foreign answer', { a1: 5, foreign: 5 }], ['objective answer', { a3: 5 }],
    ['excess score', { a1: 999 }], ['negative', { a1: -1 }], ['NaN', { a1: NaN }],
    ['string', { a1: '5' }], ['empty', {}]]) {
    test(`SEC-08 / BUG-06: ${name} rejected without partial writes`, async () => {
        const { db, service } = gradingFixture();
        await assert.rejects(service.submitEssayGrades(user, 'attempt', grades), rejected);
        assert.equal(db.writes.length, 0);
    });
}
test('BUG-06: partial grading stays pending; completing includes zero scores and excludes personality maximum', async () => {
    const { db, service } = gradingFixture();
    const first = await service.submitEssayGrades(user, 'attempt', { a1: 5 });
    assert.equal(first.totalScore, 50);
    assert.equal(db.tables.cbt_exam_attempts[0].needs_manual_grading, true);
    const second = await service.submitEssayGrades(user, 'attempt', { a2: 0 });
    assert.equal(second.totalScore, 50);
    assert.equal(db.tables.cbt_exam_attempts[0].needs_manual_grading, false);
    assert.equal(db.tables.cbt_answers.find(a => a.id === 'foreign').score, 0);
});
test('essay grading rolls back every answer when final attempt update fails', async () => {
    const { db, service } = gradingFixture({ failMutation: { table: 'cbt_exam_attempts', mutation: 'update' } });
    await assert.rejects(service.submitEssayGrades(user, 'attempt', { a1: 5, a2: 4 }), rejected);
    assert.equal(db.tables.cbt_answers.find(a => a.id === 'a1').score, 0);
    assert.equal(db.tables.cbt_answers.find(a => a.id === 'a2').score, 0);
});

for (const event of ['RESET_BY_PROCTOR', 'FORCE_TERMINATED', 'LATE_ANSWER_SYNC', 'unexpected']) {
    test(`SEC-09: rejects student event ${event}`, async () => {
        const db = fixtureDb();
        await assert.rejects(new ProctoringService(db, {}, {}).logViolation(user, 'attempt', event), rejected);
        assert.equal(db.writes.length, 0);
    });
}
test('SEC-09: valid event records server-controlled actor/source', async () => {
    const db = fixtureDb({ cbt_exam_attempts: [{ id: 'attempt', user_id: user.id, status: 'in_progress' }] });
    await new ProctoringService(db, {}, {}).logViolation(user, 'attempt', 'tab_switch', { actor_id: 'proctor', source: 'admin' });
    assert.equal(db.tables.cbt_attempt_security_logs[0].metadata.actor_id, user.id);
    assert.equal(db.tables.cbt_attempt_security_logs[0].metadata.source, 'student');
    assert.ok(STUDENT_SECURITY_EVENTS.includes('tab_close'));
});

for (const key of ['questions/legacy.png', 'users/victim/questions/a.png', 'assignments/exam/victim/a.png', 'backup-restores/a.png', 'users/user-A/../victim/a.png']) {
    test(`SEC-06: refuses deletion of ${key}`, async () => {
        let deleted = false;
        const controller = new StorageController({ objectKeyFromUrl: () => key, deleteObject: async () => { deleted = true; } });
        await assert.rejects(controller.remove(user, { url: 'https://files.example.test/object' }), rejected);
        assert.equal(deleted, false);
    });
}
test('SEC-06 / BUG-01: upload assigns owner and upload/delete return explicit success', async () => {
    let uploadedKey, deletedKey;
    const storage = { resolveContentType: () => 'image/png', generateFileName: () => 'new.png',
        putObject: async key => { uploadedKey = key; return { success: true, key, url: `https://files.example.test/${key}` }; },
        objectKeyFromUrl: () => uploadedKey,
        deleteObject: async key => { deletedKey = key; return { success: true }; },
    };
    const controller = new StorageController(storage);
    const result = await controller.upload(user, { originalname: 'new.png', size: 1, buffer: Buffer.from('x') }, 'questions');
    assert.equal(uploadedKey, 'users/user-A/questions/new.png');
    assert.equal(result.success, true);
    const deleted = await controller.remove(user, { url: result.url });
    assert.equal(deleted.success, true);
    assert.equal(deletedKey, uploadedKey);
});
test('SEC-06: unconfigured r2.dev host refused; configured host accepted', () => {
    const service = Object.create(StorageService.prototype);
    Object.assign(service, { publicUrl: 'https://configured.r2.dev', accountId: 'account', bucket: 'bucket' });
    assert.equal(service.objectKeyFromUrl('https://evil.r2.dev/users/user-A/a.png'), null);
    assert.equal(service.objectKeyFromUrl('https://configured.r2.dev/users/user-A/a.png'), 'users/user-A/a.png');
});
