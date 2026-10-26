const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });
const { fixtureDb } = require('./fixture-db.cjs');
const { GradingService } = require('../src/grading/grading.service.ts');
const { buildIrtCalibration, plainSnippet } = require('../src/common/irt-calibration.ts');

const Q1 = '11111111-1111-4111-8111-111111111111';
const Q2 = '22222222-2222-4222-8222-222222222222';
const OPT = '33333333-3333-4333-8333-333333333333';

test('IRT-P01: parameter butir diberi nomor soal, teks polos, dan pernyataan untuk butir pecahan', () => {
    const questions = [
        { id: Q1, type: 'mcq', question_text: '<p>Hasil <strong>2 + 2</strong> adalah&nbsp;…</p>' },
        { id: Q2, type: 'true_false', question_text: 'Tentukan benar atau salah', bank_question_options: [{ id: OPT, option_text: '<p>Air mendidih pada 100 °C</p>' }] },
    ];
    const calibration = buildIrtCalibration(questions, [
        { item_id: `${Q2}_${OPT}`, total: 40, correct: 6, p_value: 0.15, b: 1.7346, a: 0.3, c: 0.2 },
        { item_id: Q1, total: 40, correct: 38, p_value: 0.95, b: -2.9444, a: 1.2, c: 0.25 },
        { item_id: 'tidak-ada', total: 1, correct: 1, p_value: 0.99, b: -4, a: 1, c: 0 },
    ], { calculatedAt: '2026-10-26T06:00:00.000Z', participantCount: 40, models: ['irt_2pl'], warnings: ['sedikit'] });

    assert.equal(calibration.items.length, 2, 'butir tanpa soal dibuang');
    const [first, second] = calibration.items;
    assert.equal(first.number, 1);
    assert.equal(first.text, 'Hasil 2 + 2 adalah …');
    assert.equal(first.part, null);
    assert.deepEqual(first.flags, ['Terlalu mudah']);
    assert.equal(second.number, 2);
    assert.equal(second.option_id, OPT);
    assert.equal(second.part, 'Air mendidih pada 100 °C');
    assert.deepEqual(second.flags, ['Terlalu sulit', 'Daya beda rendah']);
    assert.equal(second.b, 1.735);
    assert.equal(calibration.participant_count, 40);
    assert.deepEqual(calibration.warnings, ['sedikit']);

    const rasch = buildIrtCalibration(questions, [{ item_id: Q1, total: 10, correct: 5, p_value: 0.5, b: 0, a: 0.2, c: 0.2 }],
        { calculatedAt: 'x', participantCount: 10, models: ['irt_1pl'] });
    assert.deepEqual(rasch.items[0].flags, [], 'daya beda tidak dinilai pada 1PL');
    assert.equal(plainSnippet('<script>alert(1)</script>Soal', 50), 'Soal');
});

test('IRT-P02: Kalkulasi IRT menyimpan parameter butir di metadata ujian tanpa menghapus metadata lain', async () => {
    const db = fixtureDb({
        cbt_exams: [{ id: 'exam', question_bank_id: 'bank', scoring_type: 'classical,irt_2pl', metadata: { is_pas_exam: true } }],
        cbt_exam_attempts: [{ id: 'attempt', exam_id: 'exam', status: 'submitted', needs_manual_grading: false,
            answers: [{ question_id: Q1, score: 10, is_correct: true, selected_option_id: 'a' }] }],
        cbt_bank_questions: [{ id: Q1, bank_id: 'bank', type: 'mcq', score_default: 10 }],
        cbt_exam_question_snapshots: [{ exam_id: 'exam', order_number: 1, question_snapshot: { id: Q1, type: 'mcq', score_default: 10, question_text: 'Soal satu' } }],
    }, [], { now: '2026-10-26T06:00:00Z' });
    const scoring = { post: async () => ({ count: 1, warnings: ['IRT 2PL dihitung dari 1 peserta'],
        attempts: [{ id: 'attempt', detailed_scores: { classical: 100, irt_2pl: 80 }, score_irt: 80 }],
        items: [{ item_id: Q1, total: 1, correct: 1, p_value: 0.99, b: -4.5951, a: 1, c: 0.25 }] }) };
    const service = new GradingService(db, { assertExamStaff: async () => {} }, scoring);

    const result = await service.calculateIrt({ id: 'staff' }, 'exam');
    const metadata = db.tables.cbt_exams[0].metadata;
    assert.equal(metadata.is_pas_exam, true);
    assert.equal(metadata.irt_calibration.participant_count, 1);
    assert.deepEqual(metadata.irt_calibration.models, ['irt_2pl']);
    assert.equal(metadata.irt_calibration.calculated_at, '2026-10-26T06:00:00.000Z');
    assert.equal(metadata.irt_calibration.items[0].text, 'Soal satu');
    assert.deepEqual(metadata.irt_calibration.items[0].flags, ['Terlalu mudah']);
    assert.deepEqual(result.calibration, metadata.irt_calibration);
    assert.equal(db.tables.cbt_exam_attempts[0].score_irt, 80);
});

test('IRT-P03: export Excel memuat sheet Parameter_IRT dan kolom nilai per model', async () => {
    const XLSX = require('xlsx-js-style');
    const { buildAnalysisWorkbook, enabledIrtModels } = require('../../web/lib/export-excel-analysis.ts');
    assert.deepEqual(enabledIrtModels('classical,irt_2pl'), ['irt_2pl']);
    assert.deepEqual(enabledIrtModels('irt'), ['irt_1pl']);
    const irt = {
        calculated_at: '2026-10-26T06:00:00.000Z', participant_count: 120, models: ['irt_1pl', 'irt_2pl'], warnings: ['Sampel kecil'],
        items: [{ item_id: Q1, question_id: Q1, option_id: null, number: 1, part: null, type: 'mcq', text: 'Soal satu', total: 120, correct: 114,
            p: 0.95, b: -2.944, a: 0.4, c: 0.25, flags: ['Terlalu mudah', 'Daya beda rendah'] }],
    };
    const attempts = [{ id: 'a1', status: 'submitted', total_score: 80, profiles: { full_name: 'Ani' },
        detailed_scores: { classical: 80, irt_1pl: 61.5, irt_2pl: 63.25 }, score_irt: 63.25 }];
    const workbook = await buildAnalysisWorkbook({ exam: { id: 'e', title: 'ASAS', scoring_type: 'classical,irt_1pl,irt_2pl' }, attempts, analysis: [], detailedAnalysis: null, irt, timeZone: 'Asia/Makassar' });
    const reopened = XLSX.read(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }), { type: 'buffer' });
    const recap = XLSX.utils.sheet_to_json(reopened.Sheets.Rekap_Hasil)[0];
    assert.equal(recap['Nilai IRT 1PL'], '61.50');
    assert.equal(recap['Nilai IRT 2PL'], '63.25');
    assert.equal(recap['Nilai IRT'], undefined, 'kolom tunggal diganti kolom per model');
    assert.ok(reopened.SheetNames.includes('Parameter_IRT'));
    const rows = XLSX.utils.sheet_to_json(reopened.Sheets.Parameter_IRT, { header: 1 });
    assert.equal(rows[0][0], 'Parameter soal IRT');
    assert.deepEqual(rows[4], ['Peringatan', 'Sampel kecil']);
    const headerIndex = rows.findIndex(row => row[0] === 'No Soal');
    assert.deepEqual(rows[headerIndex].slice(6), ['Proporsi benar (p)', 'Kesulitan (b)', 'Kategori kesulitan', 'Daya beda (a)', 'Kategori daya beda', 'Catatan']);
    assert.deepEqual(rows[headerIndex + 1].slice(0, 9), [1, '-', 'PG', 'Soal satu', 120, 114, 0.95, -2.944, 'Mudah']);
    assert.equal(rows[headerIndex + 1][11], 'Terlalu mudah, Daya beda rendah');

    const plain = await buildAnalysisWorkbook({ exam: { id: 'e', title: 'Harian' }, attempts, analysis: [], detailedAnalysis: null });
    assert.ok(!plain.SheetNames.includes('Parameter_IRT'));
    assert.ok('Nilai IRT' in XLSX.utils.sheet_to_json(plain.Sheets.Rekap_Hasil)[0]);
});
