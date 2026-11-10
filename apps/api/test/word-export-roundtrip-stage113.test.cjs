// Run from repository root: node --test apps/api/test/word-export-roundtrip-stage113.test.cjs
// Ekspor Word bank soal harus dapat diimpor kembali tanpa kehilangan tabel dan
// tanpa menurunkan kualitas gambar; kepala layar ujian menampilkan Nama | NISN | Kelas.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const JSZip = require('jszip');
const mammoth = require('mammoth');
require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });
const { load } = require('../../../tools/question-test-loader.cjs');
const { fixtureDb } = require('./fixture-db.cjs');
const { StudentsService } = require('../src/students/students.service.ts');

const root = path.resolve(__dirname, '../../..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const exp = load('apps/web/lib/export-template.ts');
const wordImages = load('apps/web/lib/word-images.ts');
const parser = load('apps/web/lib/doc-parser.ts');

// Tabel seperti hasil editor soal (TipTap): <th>/<td> berisi <p> rata tengah.
const cell = (tag, text) => `<${tag} colspan="1" rowspan="1" style="text-align: center;"><p style="text-align: center;">${text}</p></${tag}>`;
const TABLE_HTML = '<p>Tabel berikut menunjukkan tarif taksi daring \\(f(x)\\).</p><p style="text-align: center;">Tarif Taksi Daring</p>'
    + '<table class="border-collapse w-full my-4 border border-slate-300" style="width: 100%;"><colgroup><col><col><col><col></colgroup><tbody>'
    + `<tr>${cell('th', 'Jarak (km)')}${cell('th', '\\(2\\)')}${cell('th', '\\(4\\)')}${cell('th', '\\(6\\)')}</tr>`
    + `<tr>${cell('td', 'Tarif (Rp)')}${cell('td', '\\(17.000\\)')}${cell('td', '\\(26.000\\)')}${cell('td', '\\(35.000\\)')}</tr>`
    + '</tbody></table><p>Tarif untuk perjalanan sejauh \\(15\\) km adalah ....</p>';

const mcq = (text) => ({
    id: 'q2', type: 'mcq', question_text: text, score_default: 1,
    bank_question_options: ['62.000', '67.500', '71.000', '72.500', '75.500'].map((value, i) => ({
        id: `o${i}`, option_text: `Rp\\(${value}\\)`, order: i, is_correct: i === 4,
    })),
});

/** Dokumen seperti setelah disunting di Word: arsip JSON tersembunyi tidak lagi dipakai. */
async function withoutArchive(blob) {
    const zip = await JSZip.loadAsync(Buffer.from(await blob.arrayBuffer()));
    zip.remove('cbt/questions.json');
    return zip.generateAsync({ type: 'nodebuffer' });
}

function png(width, height) {
    const crcTable = Array.from({ length: 256 }, (_, n) => {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        return c >>> 0;
    });
    const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
    const chunk = (type, data) => {
        const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
        const body = Buffer.concat([Buffer.from(type), data]);
        const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body));
        return Buffer.concat([len, body, sum]);
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
    const raw = Buffer.alloc((width * 3 + 1) * height);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) raw[y * (width * 3 + 1) + 1 + x * 3] = (x * 7 + y) & 255;
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

test('WORD-113-01: tabel HTML pada soal diekspor sebagai tabel Word, bukan teks per baris', async () => {
    const blob = await exp.buildAkademikDoc([mcq(TABLE_HTML)], { title: 'Audit Tabel' });
    const html = (await mammoth.convertToHtml({ buffer: await withoutArchive(blob) })).value;
    const nested = /<td>(?:(?!<\/td>).)*?<table>([\s\S]*?)<\/table>/.exec(html);
    assert.ok(nested, 'tabel data harus berada di dalam sel soal');
    assert.match(nested[1], /<td><p><strong>Jarak \(km\)<\/strong><\/p><\/td>/);
    assert.match(nested[1], /\\\(17\.000\\\)/);
    assert.equal((nested[1].match(/<tr>/g) || []).length, 2);
});

test('WORD-113-02: dokumen ekspor yang disunting di Word diimpor kembali dengan tabel utuh', async () => {
    const blob = await exp.buildAkademikDoc([mcq(TABLE_HTML)], { title: 'Audit Tabel' });
    const buffer = await withoutArchive(blob);
    const file = new File([buffer], 'bank.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    const [question, ...rest] = await parser.parseDocxToQuestions(file);
    assert.equal(rest.length, 0, 'tabel bersarang tidak boleh terbaca sebagai tabel template tersendiri');
    assert.equal(question.type, 'mcq');
    assert.equal(question.options.length, 5);
    assert.equal(question.options.findIndex(o => o.isCorrect), 4);
    assert.match(question.question_text, /<table>/);
    assert.match(question.question_text, /Jarak \(km\)/);
    assert.match(question.question_text, /\\\(35\.000\\\)/);
    assert.match(question.question_text, /adalah \.\.\.\./);
});

test('WORD-113-03: gambar ditanam dengan resolusi asli dan ukuran tampil dari editor', async () => {
    const source = png(1600, 400);
    const images = new Map([['/api/storage/file/a.png', { data: new Uint8Array(source), type: 'png', width: 1600, height: 400 }]]);
    const q = mcq('<p>Perhatikan gambar!</p><p><img src="/api/storage/file/a.png" width="403.2" height="100.8"></p>');
    const blob = await exp.buildAkademikDoc([q], { title: 'Audit Gambar' }, [], [], [], { images });
    const zip = await JSZip.loadAsync(Buffer.from(await blob.arrayBuffer()));
    const media = Object.keys(zip.files).filter(name => name.startsWith('word/media/') && !zip.files[name].dir);
    const embedded = await Promise.all(media.map(name => zip.file(name).async('nodebuffer')));
    assert.ok(embedded.some(buf => buf.equals(source)), 'byte gambar asli harus ditanam tanpa diperkecil');
    const xml = await zip.file('word/document.xml').async('string');
    assert.match(xml, new RegExp(`<wp:extent cx="${403 * 9525}" cy="${101 * 9525}"/>`));
});

test('WORD-113-04: ukuran tampil gambar dibatasi lebar kolom dan rasionya tetap', () => {
    const { displaySize, imageTagSize } = wordImages;
    assert.deepEqual(displaySize({ width: 2071, height: 600 }), { width: 420, height: 122 });
    assert.deepEqual(displaySize({ width: 200, height: 100 }), { width: 200, height: 100 });
    assert.deepEqual(displaySize({ width: 1600, height: 400 }, { width: 300 }), { width: 300, height: 75 });
    assert.deepEqual(displaySize({ width: 1600, height: 400 }, {}, 100), { width: 100, height: 25 });
    assert.deepEqual(imageTagSize('<img src="a.png" style="width:350px;max-width:100%;height:auto">'), { width: 350 });
    assert.deepEqual(imageTagSize('<img src="a.png" width="403.2" height="100.8">'), { width: 403.2, height: 100.8 });
    assert.deepEqual(imageTagSize('<img src="a.png">'), {});
    assert.doesNotMatch(read('apps/web/lib/word-images.ts'), /MAX_IMAGE_WIDTH \/ image\.width/);
});

test('EXAM-113-05: kepala layar ujian siswa memuat Nama | NISN | Kelas reguler', async () => {
    const db = fixtureDb({
        cbt_exams: [{ id: 'exam', organization_id: 'school', is_published: true, duration_minutes: 90,
            start_time: '2026-09-19T23:00:00Z', end_time: '2026-09-20T02:00:00Z', metadata: { is_public: true } }],
        cbt_organization_members: [{ user_id: 'student', organization_id: 'school', is_active: true }],
        cbt_profiles: [{ id: 'student', full_name: 'Siswa Uji', identity_number: '0012345678' }],
        cbt_class_members: [{ user_id: 'student', class_id: 'other' }, { user_id: 'student', class_id: 'xi' }],
        cbt_classes: [{ id: 'other', name: 'X-1', organization_id: 'lain' }, { id: 'xi', name: 'XI IPA 1', organization_id: 'school' }],
        cbt_exam_attempts: [],
    });
    const detail = await new StudentsService(db).getExamForAttempt({ id: 'student' }, 'exam');
    assert.equal(detail.profile.full_name, 'Siswa Uji');
    assert.equal(detail.profile.identity_number, '0012345678');
    assert.equal(detail.profile.class_name, 'XI IPA 1', 'kelas di sekolah penyelenggara diutamakan');

    const failing = fixtureDb({
        cbt_exams: [{ id: 'exam', organization_id: 'school', is_published: true, duration_minutes: 90,
            start_time: '2026-09-19T23:00:00Z', end_time: '2026-09-20T02:00:00Z', metadata: { is_public: true } }],
        cbt_organization_members: [{ user_id: 'student', organization_id: 'school', is_active: true }],
        cbt_profiles: [{ id: 'student', full_name: 'Siswa Uji', identity_number: null }],
        cbt_class_members: [{ user_id: 'student', class_id: 'xi' }],
    }, ['cbt_classes']);
    assert.equal((await new StudentsService(failing).getExamForAttempt({ id: 'student' }, 'exam')).profile.class_name, null,
        'kelas yang gagal dibaca tidak boleh menghalangi ujian');

    const page = read('apps/web/app/components/questions/ExamPage.tsx');
    const viewer = read('apps/web/app/components/questions/ExamViewer.tsx');
    assert.match(page, /studentClass=\{profile\?\.class_name \|\| ''\}/);
    assert.match(viewer, /\[nisn\?\.trim\(\) \? `NISN \$\{nisn\.trim\(\)\}` : '', className\?\.trim\(\) \|\| ''\]\.filter\(Boolean\)\.join\(' \| '\)/);
    assert.match(viewer, /studentIdentityLine\(studentNisn, studentClass\) \|\| examTitle/);
});
