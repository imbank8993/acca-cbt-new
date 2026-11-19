const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });
const R = require('../../web/lib/assessment-report.ts');

const close = (actual, expected, eps = 1e-6, msg) => assert.ok(Math.abs(actual - expected) < eps, `${msg || ''} expected ${expected}, got ${actual}`);

// 10 peserta × 5 butir PG (0/1). Kolom = q1..q5.
const RESPONSES = [
    [1, 1, 1, 1, 1], [1, 1, 1, 1, 0], [1, 1, 1, 0, 1], [1, 1, 0, 1, 0], [1, 1, 1, 0, 0],
    [1, 0, 1, 0, 0], [1, 1, 0, 0, 0], [1, 0, 0, 0, 1], [0, 0, 0, 0, 0], [1, 0, 0, 0, 0],
];
const TOPICS = ['Aljabar', 'Aljabar', 'Geometri', 'Geometri', 'Statistika'];
function fixture({ responses = RESPONSES, cells, extraAttempts = [], answers = [], irt = null, scoringType = 'classical' } = {}) {
    const questions = TOPICS.map((topic, i) => ({ id: `q${i + 1}`, number: i + 1, type: 'mcq', score_default: 1, topic,
        question_text: `<p>Soal ${i + 1}</p>`, options: [{ id: `q${i + 1}a`, option_text: 'A', is_correct: true }, { id: `q${i + 1}b`, option_text: 'B' }, { id: `q${i + 1}c`, option_text: 'C' }] }));
    const matrix = responses.map((row, s) => ({ attempt_id: `a${s}`, student_name: `Siswa ${String.fromCharCode(74 - s)}`, class_name: s % 2 ? 'X-2' : 'X-1', status: 'submitted',
        items: Object.fromEntries(row.map((value, i) => [`q${i + 1}`, cells?.(s, i, value) ?? { status: value ? 'correct' : 'wrong', score: value }])) }));
    const attempts = responses.map((row, s) => ({ id: `a${s}`, status: 'submitted', total_score: row.reduce((a, b) => a + b, 0) / row.length * 100,
        metadata: { irt_score_scale: 'theta' }, detailed_scores: { classical: row.reduce((a, b) => a + b, 0) / row.length * 100, irt_2pl: (s - 4.5) / 3 } })).concat(extraAttempts);
    return { questions, matrix, attempts, answers, irt, scoringType };
}

test('KR-20 equals an independent k/(k-1)(1 - Σpq/σ²) computation and SEM uses SD·√(1-α) on the 0–100 scale', () => {
    const report = R.buildAssessmentReport(fixture());
    const k = 5, n = RESPONSES.length;
    const totals = RESPONSES.map(row => row.reduce((a, b) => a + b, 0));
    const mt = totals.reduce((a, b) => a + b, 0) / n;
    const vt = totals.reduce((a, t) => a + (t - mt) ** 2, 0) / n;
    const pq = [0, 1, 2, 3, 4].reduce((sum, i) => { const p = RESPONSES.reduce((a, r) => a + r[i], 0) / n; return sum + p * (1 - p); }, 0);
    const kr20 = k / (k - 1) * (1 - pq / vt);
    assert.equal(report.reliability.method, 'KR-20');
    close(report.reliability.value, kr20, 1e-4, 'KR-20');
    close(report.reliability.sem, Math.sqrt(vt) * Math.sqrt(1 - kr20) / k * 100, 0.01, 'SEM');
    assert.equal(report.reliability.n, 10);
    assert.equal(report.analyzed, 10);
    assert.deepEqual(report.warnings, []);
});

test('item p, corrected item-total correlation and 27% upper-lower D', () => {
    const report = R.buildAssessmentReport(fixture());
    const item = report.items.find(i => i.id === 'q2');
    close(item.p, 0.6, 1e-9);
    assert.equal(item.difficulty, 'Sedang');
    const x = RESPONSES.map(r => r[1]);
    const rest = RESPONSES.map(r => (r.reduce((a, b) => a + b, 0) - r[1]) / 4);
    close(item.ritc, R.pearson(x, rest), 1e-4);
    // round(10 × 0,27) = 3 per kelompok; atas = a0,a1,a2 (semua benar q2), bawah = a8,a9 + a7 (0)
    close(item.d, 1, 1e-9);
    assert.equal(item.discrimination, 'Sangat baik');
    // q1: hampir semua benar → terlalu mudah, keputusan Revisi.
    const easy = report.items.find(i => i.id === 'q1');
    close(easy.p, 0.9, 1e-9);
    assert.equal(report.items.find(i => i.id === 'q1').flags.some(f => f.code === 'easy'), false, 'p = 0,90 belum > 0,90');
    assert.ok(easy.alphaIfDeleted != null);
});

test('ungraded answers are missing data, unanswered counts as zero, partial credit uses score ÷ score_default', () => {
    assert.equal(R.itemCredit({ status: 'ungraded', score: 0 }, 2), null);
    assert.equal(R.itemCredit({ status: 'unanswered' }, 2), 0);
    assert.equal(R.itemCredit(undefined, 2), 0);
    assert.equal(R.itemCredit({ status: 'wrong', score: 1 }, 2), 0.5);
    assert.equal(R.itemCredit({ status: 'correct', score: 5 }, 2), 1);
    const report = R.buildAssessmentReport(fixture({ cells: (s, i, v) => s === 0 && i === 4 ? { status: 'ungraded', score: 0 } : s === 9 && i === 1 ? { status: 'unanswered' } : undefined }));
    const q5 = report.items.find(i => i.id === 'q5');
    assert.equal(q5.graded, 9);
    assert.equal(q5.ungraded, 1);
    close(q5.p, 2 / 9, 1e-4);
    assert.equal(report.items.find(i => i.id === 'q2').omitted, 1);
    assert.equal(report.reliability.n, 9, 'reliabilitas hanya kasus lengkap');
    assert.ok(report.warnings.some(w => w.includes('belum dinilai')));
    assert.equal(report.reliability.method, 'KR-20');
});

test('Cronbach alpha (not KR-20) when partial credit exists', () => {
    const report = R.buildAssessmentReport(fixture({ cells: (s, i, v) => s === 3 && i === 2 ? { status: 'wrong', score: 0.5 } : undefined }));
    assert.equal(report.reliability.method, 'Cronbach Alpha');
    assert.equal(report.students.find(s => s.attemptId === 'a3').partial, 1);
});

test('distractor analysis flags non-functioning and upper-group-attracting options', () => {
    // q4: kunci a; atas memilih c, bawah memilih a? Buat: a0..a2 (kelompok atas) pilih kunci q4a kecuali a2 pilih c, bawah (a7..a9) pilih c ke kosong.
    const answers = [];
    RESPONSES.forEach((row, s) => {
        const option = row[3] ? 'q4a' : s === 2 ? 'q4c' : s >= 7 ? null : 'q4a';
        if (option) answers.push({ attempt_id: `a${s}`, question_id: 'q4', selected_option_id: option });
    });
    const report = R.buildAssessmentReport(fixture({ answers }));
    const q4 = report.items.find(i => i.id === 'q4');
    const [a, b, c] = q4.distractors;
    assert.equal(a.isKey, true);
    assert.equal(b.flag, 'Tidak berfungsi (< 5%)');
    close(c.share, 0.1, 1e-9);
    close(c.upperShare, 1 / 3, 1e-4);
    assert.equal(c.lowerShare, 0);
    assert.equal(c.flag, 'Menarik kelompok atas');
    assert.equal(q4.decision, 'Tinjau ulang');
    assert.ok(q4.flags.some(f => f.code === 'dead_distractor' && f.label.includes('B')));
});

test('KKTP interval bands: 0–40, 41–65, 66–85, 86–100', () => {
    const cases = [[0, 'bimbingan'], [40, 'bimbingan'], [40.01, 'remedial'], [65, 'remedial'], [65.5, 'tuntas'], [85, 'tuntas'], [85.01, 'pengayaan'], [100, 'pengayaan']];
    for (const [score, id] of cases) assert.equal(R.masteryBand(score).id, id, `nilai ${score}`);
    assert.equal(R.masteryBand(null), null);
    assert.equal(R.masteryBand(NaN), null);
});

test('IRT information matches Birnbaum formula and SE uses EAP prior precision', () => {
    const item = { question_id: 'q', b: 0.5, a: 1.2, c: 0.25 };
    // 2PL di θ = b: P = 0,5 → I = (1,7·a)² · 0,25
    close(R.irtItemInformation(0.5, item, 'irt_2pl'), (1.7 * 1.2) ** 2 * 0.25, 1e-9);
    // 1PL memakai D = 1, a = 1
    close(R.irtItemInformation(0.5, item, 'irt_1pl'), 0.25, 1e-9);
    // 3PL
    const theta = 1;
    const p = 0.25 + 0.75 / (1 + Math.exp(-1.7 * 1.2 * (theta - 0.5)));
    close(R.irtItemInformation(theta, item, 'irt_3pl'), (1.7 * 1.2) ** 2 * ((1 - p) / p) * ((p - 0.25) / 0.75) ** 2, 1e-9);
    close(R.thetaStandardError(0.5, [item, item], 'irt_2pl'), 1 / Math.sqrt(2 * (1.7 * 1.2) ** 2 * 0.25 + 1), 1e-9);
    assert.equal(R.calibrationModel(['irt_1pl', 'irt_3pl']), 'irt_3pl');
});

test('IRT summary and per-student θ, scaled score and SE use the highest calibrated model', () => {
    const irt = { models: ['irt_1pl', 'irt_2pl'], items: TOPICS.map((_, i) => ({ question_id: `q${i + 1}`, b: i - 2, a: 1, c: 0 })) };
    const report = R.buildAssessmentReport(fixture({ irt, scoringType: 'classical,irt_1pl,irt_2pl' }));
    assert.equal(report.irt.model, 'irt_2pl');
    assert.equal(report.irt.label, 'IRT 2PL');
    assert.equal(report.irt.curve.length, 33);
    const student = report.students.find(s => s.attemptId === 'a0');
    close(student.theta, -1.5, 1e-9);
    assert.equal(student.scaled, 350);
    close(student.thetaSe, R.thetaStandardError(-1.5, irt.items, 'irt_2pl'), 1e-4);
    // Tanpa kalibrasi: θ tetap ada, SE tidak, plus peringatan.
    const bare = R.buildAssessmentReport(fixture({ scoringType: 'classical,irt_2pl' }));
    assert.equal(bare.irt.hasCalibration, false);
    assert.equal(bare.students[0].thetaSe, null);
    assert.ok(bare.warnings.some(w => w.includes('Kalkulasi IRT')));
});

test('class descriptives, histogram, topic mastery and per-student feedback', () => {
    const report = R.buildAssessmentReport(fixture({ extraAttempts: [{ id: 'z', status: 'belum' }] }));
    assert.equal(report.registered, 11);
    assert.equal(report.completed, 10);
    const scores = RESPONSES.map(r => r.reduce((a, b) => a + b, 0) * 20);
    close(report.descriptives.mean, scores.reduce((a, b) => a + b, 0) / 10, 1e-9);
    assert.equal(report.descriptives.median, 50);
    assert.equal(report.histogram.reduce((a, b) => a + b, 0), 10);
    assert.equal(report.histogram[9], 1, 'nilai 100 masuk kelompok 90–100');
    assert.equal(Object.values(report.bandCounts).reduce((a, b) => a + b, 0), 10);
    const aljabar = report.topics.find(t => t.name === 'Aljabar');
    close(aljabar.percent, 15 / 20 * 100, 1e-9);
    // Siswa a5: [1,0,1,0,0] → Aljabar 50%, Geometri 50%, Statistika 0%.
    const s5 = report.students.find(s => s.attemptId === 'a5');
    assert.equal(s5.score, 40);
    assert.equal(s5.band.id, 'bimbingan');
    assert.deepEqual(s5.needs.map(t => t.name), ['Statistika', 'Aljabar', 'Geometri']);
    assert.deepEqual(s5.strengths, []);
    // q2 p = 0,6 (< 0,75) bukan "mudah"; q1 p = 0,9 dijawab benar oleh a5 → tidak ada soal mudah terlewat.
    assert.deepEqual(s5.missedEasy.map(i => i.number), []);
    const s8 = report.students.find(s => s.attemptId === 'a8');
    assert.deepEqual(s8.missedEasy.map(i => i.number), [1]);
    assert.ok(s8.recommendations.some(text => text.includes('nomor 1')));
    // Urut kelas lalu nama.
    assert.deepEqual(report.students.slice(0, 2).map(s => s.className), ['X-1', 'X-1']);
    assert.ok(report.students[0].name.localeCompare(report.students[1].name, 'id') < 0);
    // Persentil: a0 nilai tertinggi.
    assert.equal(report.students.find(s => s.attemptId === 'a0').percentile, 95);
});

test('non-academic questions are excluded and small classes get a stability warning', () => {
    const data = fixture({ responses: RESPONSES.slice(0, 4) });
    data.questions.push({ id: 'likert', number: 6, type: 'likert', score_default: 1 });
    const report = R.buildAssessmentReport(data);
    assert.equal(report.itemCount, 5);
    assert.ok(report.warnings.some(w => w.includes('belum stabil')));
});

const P = require('../../web/lib/analysis-plain.ts');

test('plain readings: three difficulty bands, discrimination labels and per-type families', () => {
    assert.equal(P.difficultyLabel(0.3), 'Sulit');
    assert.equal(P.difficultyLabel(0.31), 'Sedang');
    assert.equal(P.difficultyLabel(0.71), 'Mudah');
    assert.equal(P.discriminationLabel(-0.1), 'Terbalik');
    assert.equal(P.discriminationLabel(0.19), 'Kurang');
    assert.equal(P.discriminationLabel(0.25), 'Cukup');
    assert.equal(P.discriminationLabel(0.3), 'Baik');
    assert.equal(P.typeInfo('essay').family, 'uraian');
    assert.equal(P.typeInfo('matching').family, 'berbagian');
    assert.equal(P.typeInfo('mcq').label, 'Pilihan ganda');
});

test('plain readings: key problems → Periksa ulang, dead distractors → Perlu diperbaiki, good item → Layak dipakai', () => {
    const answers = [];
    RESPONSES.forEach((row, s) => {
        const option = row[3] ? 'q4a' : s === 2 ? 'q4c' : s >= 7 ? null : 'q4a';
        if (option) answers.push({ attempt_id: `a${s}`, question_id: 'q4', selected_option_id: option });
    });
    const report = R.buildAssessmentReport(fixture({ answers }));
    const read = id => P.readItem(report.items.find(i => i.id === id), report.analyzed);
    const q4 = read('q4');
    assert.equal(q4.conclusion, 'Periksa ulang');
    assert.ok(q4.notes.some(note => note.includes('Pilihan C lebih banyak dipilih siswa berkemampuan tinggi')));
    assert.ok(q4.notes.some(note => note.includes('Pilihan B hampir tidak dipilih')));
    // q2: p = 0,6 dan D = 1 tanpa data pilihan (fixture hanya mencatat pilihan q4).
    const q2 = P.readItem({ ...report.items.find(i => i.id === 'q2'), distractors: [] }, report.analyzed);
    assert.equal(q2.conclusion, 'Layak dipakai');
    assert.equal(q2.notes.length, 0);
    assert.equal(q2.difficulty, 'Sedang');
    assert.equal(q2.discrimination, 'Baik');
});

test('plain readings: partial-credit share for multi-part items and per-type student rows', () => {
    const report = R.buildAssessmentReport(fixture({ cells: (s, i, value) => i === 4 ? { status: s < 5 ? 'wrong' : 'correct', score: s < 5 ? 0.5 : 1 } : undefined }));
    const item = { ...report.items.find(i => i.id === 'q5'), type: 'matching' };
    close(item.partialShare, 0.5, 1e-9);
    assert.ok(P.readItem(item, report.analyzed).notes.some(note => note.startsWith('50% siswa hanya benar sebagian')));
    const student = report.students[0];
    const rows = P.studentTypeRows(student.items.map(i => i.id === 'q5' ? { ...i, type: 'essay' } : i));
    assert.deepEqual(rows.map(row => row.label), ['Pilihan ganda', 'Uraian']);
    assert.equal(rows[0].count + rows[1].count, 5);
    assert.ok(P.studentNarrative(student, 60).includes('dari 100'));
    assert.ok(P.studentAdvice(student).length > 0);
});
