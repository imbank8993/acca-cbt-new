const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });
const { validate } = require('class-validator');
const { plainToInstance } = require('class-transformer');
const { fixtureDb } = require('./fixture-db.cjs');
const { QuestionsService, assertQuestionStructure } = require('../src/questions/questions.service.ts');
const { syncLiveExamQuestion, LIVE_QUESTION_HISTORY_LIMIT } = require('../src/common/live-exam-question-updates.ts');
const { SaveQuestionDto } = require('../src/questions/dto/questions.dto.ts');

const teacher = { id: 'teacher' };
const auth = { assertBankAccess: async () => 'school' };
function fixture({ live = true } = {}) {
    const opts = [
        { id: 'a', question_id: 'q', option_text: '10', is_correct: true, weight: 1, order: 0, metadata: { image_url: 'keep.png' } },
        { id: 'b', question_id: 'q', option_text: '20', is_correct: false, weight: 1, order: 1, metadata: {} },
    ];
    const question = { id: 'q', bank_id: 'bank', type: 'mcq', question_text: 'Pilih 10', score_default: 1, difficulty: 'hard',
        kisi_kisi_id: 'kisi-1', revision: 1, metadata: { order_index: 0 }, stimulus: null, bank_question_options: opts };
    const exam = { id: 'live', question_bank_id: 'bank', organization_id: 'school', status: 'active',
        end_time: '2026-09-20T01:00:00Z', metadata: {} };
    const db = fixtureDb({
        cbt_question_banks: [{ id: 'bank', organization_id: 'school' }],
        cbt_bank_questions: [question], cbt_bank_question_options: opts, cbt_exams: [exam],
        cbt_exam_question_snapshots: live ? [{ exam_id: 'live', question_id: 'q', order_number: 1, question_snapshot: structuredClone(question) }] : [],
        cbt_exam_attempts: [],
    }, [], { now: '2026-09-20T00:30:00Z' });
    const dto = { id: 'q', bankId: 'bank', expectedRevision: 1, type: 'mcq', questionText: 'Pilih 10', scoreDefault: 1,
        metadata: { order_index: 0 },
        options: opts.map(o => ({ id: o.id, text: o.option_text, isCorrect: o.is_correct, order: o.order, weight: o.weight, metadata: o.metadata })) };
    return { db, dto, service: new QuestionsService(db, auth, {}) };
}

test('#2 #3 editing without difficulty/kisi_kisi_id keeps the stored values', async () => {
    const { db, dto, service } = fixture({ live: false });
    await service.save(teacher, { ...dto, questionText: 'Pilih 10 (revisi)' });
    const row = db.tables.cbt_bank_questions[0];
    assert.equal(row.question_text, 'Pilih 10 (revisi)');
    assert.equal(row.difficulty, 'hard');
    assert.equal(row.kisi_kisi_id, 'kisi-1');
    await service.save(teacher, { ...dto, expectedRevision: 2, difficulty: 'easy', kisi_kisi_id: null });
    assert.equal(row.difficulty, 'easy');
    assert.equal(row.kisi_kisi_id, null);
});

test('#7 option metadata sent by the editor is stored as merged', async () => {
    const { db, dto, service } = fixture({ live: false });
    await service.save(teacher, { ...dto, options: dto.options.map(o => ({ ...o, metadata: { ...o.metadata, match_texts: [] } })) });
    assert.equal(db.tables.cbt_bank_question_options.find(o => o.id === 'a').metadata.image_url, 'keep.png');
});

test('#1 an unchanged save does not touch the live exam copy or notify students', async () => {
    const { db } = fixture();
    const before = structuredClone(db.tables.cbt_exam_question_snapshots[0].question_snapshot);
    db.tables.cbt_bank_questions[0].revision = 2; // bank revision bumped by an identical save
    assert.equal(await syncLiveExamQuestion(db, 'q', 'school', 'teacher'), 0);
    assert.deepEqual(db.tables.cbt_exam_question_snapshots[0].question_snapshot, before);
    assert.equal(db.tables.cbt_exams[0].metadata.live_question_revision, undefined);
});

test('#1 a real change still reaches the live exam, and its history is capped', async () => {
    const { db } = fixture();
    db.tables.cbt_exams[0].metadata.live_question_update_history = Array.from({ length: LIVE_QUESTION_HISTORY_LIMIT + 5 }, (_, i) => ({ i }));
    db.tables.cbt_bank_questions[0].question_text = 'Pilih sepuluh';
    db.tables.cbt_bank_questions[0].revision = 2;
    assert.equal(await syncLiveExamQuestion(db, 'q', 'school', 'teacher'), 1);
    assert.equal(db.tables.cbt_exam_question_snapshots[0].question_snapshot.question_text, 'Pilih sepuluh');
    const history = db.tables.cbt_exams[0].metadata.live_question_update_history;
    assert.equal(history.length, LIVE_QUESTION_HISTORY_LIMIT);
    assert.equal(history.at(-1).questionId, 'q');
});

test('#6 server rejects structurally ungradable questions', () => {
    const option = (isCorrect, metadata = {}) => ({ text: 'x', isCorrect, order: 0, weight: 1, metadata });
    const bad = [
        { type: 'mcq', options: [option(false), option(false)] },
        { type: 'mcq', options: [option(true)] },
        { type: 'mcq_complex', options: [option(false), option(false)] },
        { type: 'matching', options: [option(false, { match_texts: [''] })] },
        { type: 'categorization', options: [option(false, { category_names: [] })] },
        { type: 'ordering', options: [option(false)] },
        { type: 'true_false', options: [] },
    ];
    for (const dto of bad) assert.throws(() => assertQuestionStructure(dto), e => e.getStatus() === 400, dto.type);
    assertQuestionStructure({ type: 'mcq', options: [option(true), option(true)] }); // legacy two-key items stay editable
    assertQuestionStructure({ type: 'essay', options: [] });
    assertQuestionStructure({ type: 'mcq' }); // options omitted = keep existing
});

test('#6 DTO bounds: score, lengths, option count; difficulty optional', async () => {
    const base = { id: '11111111-1111-4111-8111-111111111111', expectedRevision: 1, bankId: '22222222-2222-4222-8222-222222222222',
        type: 'essay', questionText: 'Soal', scoreDefault: 1 };
    const errors = async extra => (await validate(plainToInstance(SaveQuestionDto, { ...base, ...extra }))).map(e => e.property);
    assert.deepEqual(await errors({}), []);
    assert.ok((await errors({ scoreDefault: -1 })).includes('scoreDefault'));
    assert.ok((await errors({ scoreDefault: 5000 })).includes('scoreDefault'));
    assert.ok((await errors({ questionText: 'x'.repeat(500_001) })).includes('questionText'));
    assert.ok((await errors({ options: Array.from({ length: 101 }, () => ({ text: 'x', isCorrect: false, order: 0 })) })).includes('options'));
    assert.ok((await errors({ difficulty: 'impossible' })).includes('difficulty'));
});
