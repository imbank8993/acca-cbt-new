// Run from repository root: node --test apps/api/test/exam-print-export-stage102.test.cjs
// Regresi ekspor Bank Soal: Lembar Ujian (PDF) dan Bank Soal (Word).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const mammoth = require('mammoth');
const { load } = require('../../../tools/question-test-loader.cjs');

const root = path.resolve(__dirname, '../../..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const model = load('apps/web/lib/exam-print-model.ts');
const exp = load('apps/web/lib/export-template.ts');

const opt = (id, text, order, extra = {}) => ({ id, option_text: text, order, ...extra });

test('PRINT-01: soal pengurutan tidak pernah tercetak dalam urutan kuncinya', () => {
    for (let n = 2; n <= 8; n++) {
        const q = { id: `ord-${n}`, type: 'ordering', bank_question_options: Array.from({ length: n }, (_, i) => opt(`o${i}`, `Langkah ${i + 1}`, i)) };
        const [item] = model.buildPrintItems([q]);
        assert.notDeepEqual(item.options.map(o => o.id), q.bank_question_options.map(o => o.id), `n=${n}`);
        assert.deepEqual(model.buildPrintItems([q])[0].options.map(o => o.id), item.options.map(o => o.id), 'acak harus stabil');
    }
});

test('PRINT-02: menjodohkan memakai cadangan match_texts dan pilihan kanan diacak', () => {
    const q = {
        id: 'mj', type: 'matching', metadata: {},
        bank_question_options: [
            opt('a', 'Ikan', 0, { metadata: { match_texts: ['Air'] } }),
            opt('b', 'Burung', 1, { metadata: { match_texts: ['Udara'] } }),
            opt('c', 'Cacing', 2, { metadata: { match_texts: ['Tanah'] } }),
        ],
    };
    const [item] = model.buildPrintItems([q]);
    assert.deepEqual([...item.rightItems].sort(), ['Air', 'Tanah', 'Udara']);
    assert.notDeepEqual(item.rightItems, ['Air', 'Udara', 'Tanah']);
    assert.deepEqual(item.options.map(o => o.id), ['a', 'b', 'c'], 'kolom kiri tetap berurutan');
});

test('PRINT-03: opsi kosong dilewati dengan aturan yang sama di PDF dan Word', () => {
    const q = { type: 'mcq', bank_question_options: [opt('1', 'Satu', 0), opt('2', '<p>&nbsp;</p>', 1), opt('3', 'Tiga', 2, { is_correct: true }), opt('4', '<img src="/a.png">', 3)] };
    assert.deepEqual(model.printableOptions(q).map(o => o.id), ['1', '3', '4']);
    assert.equal(model.questionScore({ score_default: 0 }), 0);
    assert.equal(model.questionScore({}), 1);
    assert.equal(model.safeFileName('Paket 2: TKA/B.Indo?'), 'Paket_2_TKA_B.Indo');
    assert.equal(model.formatNumberList([7, 1, 2, 3]), '1–3, 7');
    assert.equal(model.fileDateStamp(new Date(2026, 9, 5)), '2026-10-05');
    assert.equal(model.exportBaseName('sheet', 'PAKET 2 TKA BAHASA INDONESIA'), 'Lembar_Ujian_PAKET_2_TKA_BAHASA_INDONESIA');
    assert.equal(model.exportBaseName('bank', ''), 'Bank_Soal_Tanpa_Judul');
});

test('PRINT-04: opsi pendek disusun berdampingan, opsi panjang/bergambar satu kolom', () => {
    assert.equal(model.optionColumns(['12', '15', '18', '21'].map((t, i) => opt(String(i), t, i))), 4);
    assert.equal(model.optionColumns(['Jakarta Pusat', 'Surabaya Timur', 'Bandung Barat', 'Medan Kota', 'Makassar Utara selatan'].map((t, i) => opt(String(i), t, i))), 2);
    assert.equal(model.optionColumns([opt('a', '<img src="/x.png">', 0), opt('b', 'B', 1)]), 1);
    assert.equal(model.optionColumns([opt('a', 'x'.repeat(60), 0), opt('b', 'B', 1)]), 1);
});

test('PRINT-05: halaman cetak mandiri tanpa navigasi aplikasi', () => {
    const layout = read('apps/web/app/dashboard/layout.tsx');
    assert.match(layout, /isPrintRoute/);
    assert.match(read('apps/web/app/globals.css'), /\.bnav,[\s\S]*display: none !important/);
    for (const role of ['admin', 'guru', 'proktor']) {
        const page = read(`apps/web/app/dashboard/${role}/questions/[bankId]/print/page.tsx`);
        assert.match(page, new RegExp(`QuestionBankPrintPage role="${role}"`));
    }
    const detail = read('apps/web/app/components/questions/QuestionBankDetailPage.tsx');
    assert.match(detail, /\$\{questionsBasePath\}\/\$\{bankId\}\/print/);
    assert.doesNotMatch(detail, /<ExamPrintView/);
    assert.match(read('apps/web/app/components/questions/ExamPrintView.tsx'), /buildPrintItems/);
});

async function wordHtml(blob) {
    return (await mammoth.convertToHtml({ buffer: Buffer.from(await blob.arrayBuffer()) })).value;
}

test('WORD-01: dimensi dari relasi API `dimension` ikut terekspor', async () => {
    const q = { type: 'sjt', question_text: 'Situasi', dimension: { name: 'Integritas' }, bank_question_options: [opt('a', 'Lapor', 0, { weight: 4 })] };
    const html = await wordHtml(await exp.buildKepribadianDoc([q], { title: 'Audit' }, []));
    assert.match(html, /Integritas/);
});

test('WORD-02: kunci B/S yang belum ditentukan ditulis "?" bukan "S"', async () => {
    const q = { type: 'true_false', question_text: 'Pernyataan', bank_question_options: [opt('a', 'Satu', 0, { is_correct: true }), opt('b', 'Dua', 1, { is_correct: null })] };
    const html = await wordHtml(await exp.buildAkademikDoc([q], { title: 'Audit' }));
    assert.match(html, /B\|\?/);
});

test('WORD-03: kunci per baris pengurutan sesuai correct_order', async () => {
    const q = { type: 'ordering', question_text: 'Urutkan', metadata: { correct_order: ['c', 'a', 'b'] }, bank_question_options: [opt('a', 'Pertama', 0), opt('b', 'Kedua', 1), opt('c', 'Ketiga', 2)] };
    const html = await wordHtml(await exp.buildAkademikDoc([q], { title: 'Audit' }));
    const rows = [...html.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map(r => [...r[1].matchAll(/<td>([\s\S]*?)<\/td>/g)].map(c => c[1].replace(/<[^>]+>/g, '')));
    const keyOf = text => rows.find(r => r[2] === text)[3];
    assert.deepEqual(['Pertama', 'Kedua', 'Ketiga'].map(keyOf), ['2', '3', '1']);
});

test('WORD-04: format dasar dan baris baru dipertahankan', async () => {
    const q = { type: 'essay', question_text: '<p>Hitung <strong>luas</strong> x<sup>2</sup></p><p>Baris dua</p>' };
    const html = await wordHtml(await exp.buildAkademikDoc([q], { title: 'Audit' }));
    assert.match(html, /<strong>luas<\/strong>/);
    assert.match(html, /<sup>2<\/sup>/);
    assert.match(html, /<br \/>Baris dua/);
});

test('WORD-05: bank campuran mempertahankan nomor soal asli', async () => {
    const JSZip = require('jszip');
    const questions = [
        { type: 'mcq', question_text: 'Akademik satu', bank_question_options: [opt('a', 'A', 0, { is_correct: true }), opt('b', 'B', 1)] },
        { type: 'likert', question_text: 'Kepribadian dua', bank_question_options: [] },
        { type: 'essay', question_text: 'Akademik tiga' },
    ];
    const result = await exp.exportQuestionsToWord(questions, { title: 'Paket: Campuran' });
    assert.equal(result.kind, 'zip');
    assert.match(result.filename, /^Bank_Soal_Paket_Campuran_\d{4}-\d{2}-\d{2}\.zip$/);
    const zip = await JSZip.loadAsync(await result.blob.arrayBuffer());
    const ak = zip.file(/Pengetahuan/)[0];
    const html = (await mammoth.convertToHtml({ buffer: await ak.async('nodebuffer') })).value;
    const numbers = [...html.matchAll(/<tr><td><p>(\d+)<\/p><\/td><td><p>(PG|ESAI)<\/p>/g)].map(m => m[1]);
    assert.deepEqual(numbers, ['1', '3']);
});

test('WORD-06: nama file Word seragam dengan nama bank dan tanggal', async () => {
    const result = await exp.exportQuestionsToWord([{ type: 'essay', question_text: 'Soal' }], { title: 'PAKET 2 TKA BAHASA INDONESIA' });
    assert.equal(result.kind, 'single');
    assert.match(result.filename, /^Bank_Soal_PAKET_2_TKA_BAHASA_INDONESIA_\d{4}-\d{2}-\d{2}\.docx$/);
    assert.equal(result.filename, `Bank_Soal_PAKET_2_TKA_BAHASA_INDONESIA_${model.fileDateStamp()}.docx`);
});
