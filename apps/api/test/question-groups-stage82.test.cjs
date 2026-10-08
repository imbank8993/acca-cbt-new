// Run from repository root: node --test apps/api/test/question-groups-stage82.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });

const {
    orderQuestionsForStudent,
    questionGroupKey,
    examUsesQuestionGroups,
} = require('../src/common/question-order.ts');

const opts = (userId, extra = {}) => ({ userId, examId: 'exam-1', randomize: true, ...extra });

function bank() {
    const qs = [];
    for (let i = 1; i <= 20; i++) qs.push({ id: `q${i}`, bank_id: 'b1', metadata: {} });
    // Grup stimulus: q3-q6
    for (const i of [3, 4, 5, 6]) qs[i - 1].stimulus = { id: 'stim-1' };
    // Grup manual: q10, q11, q15 (tidak berurutan di bank)
    for (const i of [10, 11, 15]) qs[i - 1].metadata = { group_key: 'Soal-5' };
    return qs;
}

function assertContiguous(order, ids) {
    const positions = ids.map(id => order.findIndex(q => q.id === id)).sort((a, b) => a - b);
    assert.equal(positions[positions.length - 1] - positions[0], ids.length - 1, `grup ${ids} terpisah`);
}

test('soal satu grup selalu berdampingan untuk setiap siswa', () => {
    for (let s = 0; s < 50; s++) {
        const order = orderQuestionsForStudent(bank(), opts(`student-${s}`));
        assert.equal(order.length, 20);
        assert.equal(new Set(order.map(q => q.id)).size, 20);
        assertContiguous(order, ['q3', 'q4', 'q5', 'q6']);
        assertContiguous(order, ['q10', 'q11', 'q15']);
    }
});

test('isi grup ikut diacak dan urutan blok bervariasi antar siswa', () => {
    const insideOrders = new Set();
    const firstIds = new Set();
    for (let s = 0; s < 50; s++) {
        const order = orderQuestionsForStudent(bank(), opts(`student-${s}`));
        insideOrders.add(order.filter(q => q.stimulus).map(q => q.id).join(','));
        firstIds.add(order[0].id);
    }
    assert.ok(insideOrders.size > 1, 'isi grup tidak pernah diacak');
    assert.ok(firstIds.size > 3, 'urutan blok tidak bervariasi');
});

test('urutan deterministik untuk siswa yang sama (muat ulang halaman)', () => {
    const a = orderQuestionsForStudent(bank(), opts('student-x')).map(q => q.id);
    const b = orderQuestionsForStudent(bank(), opts('student-x')).map(q => q.id);
    assert.deepEqual(a, b);
});

test('tanpa grup, hasil identik dengan pengacakan lama', () => {
    const plain = () => bank().map(q => ({ id: q.id, bank_id: 'b1', metadata: {} }));
    for (let s = 0; s < 20; s++) {
        const grouped = orderQuestionsForStudent(plain(), opts(`s${s}`)).map(q => q.id);
        const legacy = orderQuestionsForStudent(plain(), opts(`s${s}`, { groups: false })).map(q => q.id);
        assert.deepEqual(grouped, legacy);
    }
});

test('randomize=false tidak mengubah urutan meski ada grup', () => {
    const order = orderQuestionsForStudent(bank(), opts('s', { randomize: false })).map(q => q.id);
    assert.deepEqual(order, bank().map(q => q.id));
});

test('kunci grup: manual didahulukan, dicakup per bank, tanpa beda huruf besar', () => {
    assert.equal(questionGroupKey({ metadata: {} }), null);
    assert.equal(questionGroupKey({ stimulus_id: 's1' }), 'stimulus:s1');
    assert.equal(
        questionGroupKey({ bank_id: 'b1', stimulus: { id: 's1' }, metadata: { group_key: ' A ' } }),
        questionGroupKey({ bank_id: 'b1', metadata: { group_key: 'a' } }),
    );
    assert.notEqual(
        questionGroupKey({ bank_id: 'b1', metadata: { group_key: 'A' } }),
        questionGroupKey({ bank_id: 'b2', metadata: { group_key: 'A' } }),
    );
});

test('ujian bertanda legacy tidak memakai grup', () => {
    assert.equal(examUsesQuestionGroups({ question_order: 'legacy' }), false);
    assert.equal(examUsesQuestionGroups({}), true);
    assert.equal(examUsesQuestionGroups(null), true);
});
