// Run from repository root: node apps/api/test/question-content-idempotency-stage28.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });

const { fixtureDb } = require('./fixture-db.cjs');
const { QuestionsService } = require('../src/questions/questions.service.ts');
const { BankContentService } = require('../src/questions/bank-content.service.ts');

const user = { id: 'teacher-1', isPlatformAdmin: false };
const authz = {
    assertBankAccess: async () => 'school-1',
    assertBankAccessByChild: async () => 'school-1',
};

function questionTables() {
    return {
        cbt_question_banks: [{ id: 'bank-1', organization_id: 'school-1' }],
        cbt_bank_questions: [], cbt_bank_question_options: [],
        cbt_exams: [], cbt_exam_question_sources: [], cbt_exam_attempts: [],
    };
}

function questionDto(text = 'Berapa 1 + 1?') {
    return {
        bankId: 'bank-1', clientRequestId: '55555555-5555-4555-8555-555555555555',
        type: 'mcq', questionText: text, difficulty: 'easy', scoreDefault: 1,
        options: [
            { text: '2', isCorrect: true, order: 0, weight: 1 },
            { text: '3', isCorrect: false, order: 1, weight: 1 },
        ],
    };
}

test('QID-01: retry soal baru mengembalikan ID lama tanpa mengganti opsi', async () => {
    const db = fixtureDb(questionTables());
    const service = new QuestionsService(db, authz, { regradeExamAttemptsByQuestion: async () => {} });
    const first = await service.save(user, questionDto());
    const optionIds = db.tables.cbt_bank_question_options.map(row => row.id);
    const retry = await service.save(user, questionDto());
    assert.equal(first.id, retry.id);
    assert.equal(db.tables.cbt_bank_questions.length, 1);
    assert.equal(db.tables.cbt_bank_question_options.length, 2);
    assert.deepEqual(db.tables.cbt_bank_question_options.map(row => row.id), optionIds);
});

test('QID-02: kunci soal sama dengan isi berbeda ditolak atomik', async () => {
    const db = fixtureDb(questionTables());
    const service = new QuestionsService(db, authz, { regradeExamAttemptsByQuestion: async () => {} });
    await service.save(user, questionDto());
    await assert.rejects(service.save(user, questionDto('Isi berubah')), /data yang berbeda/i);
    assert.equal(db.tables.cbt_bank_questions.length, 1);
    assert.equal(db.tables.cbt_bank_question_options.length, 2);
});

test('QID-03: stimulus dan impor konten aman diulang', async () => {
    const db = fixtureDb({ cbt_question_stimuli: [], cbt_question_instructions: [] });
    const service = new BankContentService(db, authz);
    const key = '66666666-6666-4666-8666-666666666666';
    const first = await service.createStimulus(user, 'bank-1', 'Bacaan', '<p>Isi</p>', key);
    const retry = await service.createStimulus(user, 'bank-1', 'Bacaan', '<p>Isi</p>', key);
    assert.equal(first.id, retry.id);
    assert.equal(db.tables.cbt_question_stimuli.length, 1);

    const rows = [{ Judul: 'A', Konten: 'Satu' }, { Judul: 'B', Konten: 'Dua' }];
    await service.importInstructions(user, 'bank-1', rows, key);
    await service.importInstructions(user, 'bank-1', rows, key);
    assert.equal(db.tables.cbt_question_instructions.length, 2);
});

test('QID-04: create soal memakai PUT idempoten, edit tetap PUT biasa', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../web/lib/api/questions.ts'), 'utf8');
    assert.match(source, /data\.id[\s\S]*apiSend<[\s\S]*apiIdempotentMutation</);
    assert.match(source, /apiIdempotentMutation<[\s\S]*questions'[\s\S]*'PUT'/);
    assert.match(source, /apiCreate<\{ id: string \}>\([\s\S]*\/interpretations/);
});

test('QID-05: migrasi melindungi enam tabel isi bank soal', () => {
    const sql = fs.readFileSync(
        path.resolve(__dirname, '../../../database/migrations/20260927_03_idempotent_question_content.sql'),
        'utf8',
    );
    for (const table of [
        'cbt_bank_questions', 'cbt_question_kisi_kisi', 'cbt_question_stimuli',
        'cbt_question_instructions', 'cbt_question_dimensions', 'cbt_dimension_interpretations',
    ]) {
        assert.match(sql, new RegExp(`ALTER TABLE public\\.${table}`));
        assert.match(sql, new RegExp(`${table}_client_request_unique`));
    }
});

test('QID-06: soal dan impor memakai transaksi serta advisory lock', () => {
    const questions = fs.readFileSync(path.resolve(__dirname, '../src/questions/questions.service.ts'), 'utf8');
    const content = fs.readFileSync(path.resolve(__dirname, '../src/questions/bank-content.service.ts'), 'utf8');
    assert.match(questions, /this\.db\.transaction/);
    assert.match(questions, /advisoryTransactionLock/);
    assert.match(content, /content-import:/);
    assert.match(content, /deriveRequestUuid/);
});

test('QID-07: revisi lama dari tab kedua tidak menimpa edit terbaru', async () => {
    const tables = questionTables();
    tables.cbt_bank_questions.push({
        id: 'question-1', bank_id: 'bank-1', organization_id: 'school-1', revision: 1,
        type: 'essay', question_text: 'Versi awal', difficulty: 'easy', score_default: 1,
        metadata: {},
    });
    const db = fixtureDb(tables);
    const service = new QuestionsService(db, authz, { regradeExamAttemptsByQuestion: async () => {} });
    const edit = {
        id: 'question-1', expectedRevision: 1, bankId: 'bank-1', type: 'essay',
        questionText: 'Versi tab pertama', difficulty: 'easy', scoreDefault: 1,
    };
    await service.save(user, edit);
    assert.equal(db.tables.cbt_bank_questions[0].revision, 2);
    await assert.rejects(
        service.save(user, { ...edit, questionText: 'Versi tab kedua' }),
        /tab lain|halaman lain/i,
    );
    assert.equal(db.tables.cbt_bank_questions[0].question_text, 'Versi tab pertama');
});


test('reorder rereads concurrent edits after acquiring row locks', async () => {
    const db = fixtureDb({ cbt_bank_questions: [{ id: 'q', bank_id: 'b', revision: 1, metadata: { explanation: 'old' } }], cbt_question_banks: [{ id: 'b' }] });
    let locked = false;
    db.raw = async sql => {
        assert.match(sql, /FOR UPDATE/);
        locked = true;
        db.tables.cbt_bank_questions[0] = { id: 'q', bank_id: 'b', revision: 2, metadata: { explanation: 'concurrent edit' } };
        return [{ id: 'q' }];
    };
    await new QuestionsService(db, { assertBankAccess: async () => 'school' }, {}).reorder({ id: 'teacher' }, 'b', ['q']);
    assert.equal(locked, true);
    assert.equal(db.tables.cbt_bank_questions[0].metadata.explanation, 'concurrent edit');
    assert.equal(db.tables.cbt_bank_questions[0].revision, 3);
    assert.equal(db.tables.cbt_bank_questions[0].metadata.order_index, 0);
});
