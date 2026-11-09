// Run from repository root: node --test apps/api/test/import-inline-images-stage109.test.cjs
// Import Word bergambar: gambar base64 diunggah dulu agar body impor tidak melewati 10 MB.
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });
const {
    collectInlineImages, replaceInlineImages, clearInlineImageCache, inlineImageBytes,
} = require('../../web/lib/inline-image-upload.ts');

const web = (relative) => fs.readFileSync(path.resolve(__dirname, '../../web', relative), 'utf8');
const png = (seed) => `data:image/png;base64,${Buffer.from(`png-${seed}-`.repeat(50)).toString('base64')}`;
const jpeg = `data:image/jpeg;base64,${Buffer.from('jpeg-bytes'.repeat(40)).toString('base64')}`;
const noSleep = async () => {};

function fakeUploader() {
    const calls = [];
    const upload = async (file) => {
        calls.push(file);
        return `https://files.example/questions/${file.name}`;
    };
    return { upload, calls };
}

const sampleQuestions = () => [
    {
        question_text: `<p>Look at the picture.</p><p><img src="${png('a')}" style="width:200px"></p>`,
        type: 'mcq',
        metadata: { stimulus_html: `<img src="${jpeg}">`, note: 'tanpa gambar' },
        options: [
            { option_text: `<img src="${png('b')}">`, is_correct: true, order: 1, weight: 1 },
            { option_text: `<img src="${png('a')}">`, is_correct: false, order: 2, weight: 0 },
            { option_text: 'Plain answer', is_correct: false, order: 3, weight: 0 },
        ],
    },
];

beforeEach(() => clearInlineImageCache());

test('IMG-01: semua gambar base64 unik ditemukan di soal, opsi, dan metadata', () => {
    const images = collectInlineImages(sampleQuestions());
    assert.equal(images.length, 3);
    assert.ok(images.every(image => image.startsWith('data:image/')));
});

test('IMG-02: gambar diganti URL unggahan, gambar kembar hanya diunggah sekali, isi lain utuh', async () => {
    const original = sampleQuestions();
    const { upload, calls } = fakeUploader();
    const progress = [];
    const result = await replaceInlineImages(original, { upload, onProgress: p => progress.push(p), sleep: noSleep });

    assert.equal(calls.length, 3, 'gambar yang sama di dua tempat cukup diunggah sekali');
    assert.deepEqual(collectInlineImages(result), []);
    assert.match(result[0].question_text, /^<p>Look at the picture\.<\/p><p><img src="https:\/\/files\.example\/questions\/[0-9a-f]{32}\.png" style="width:200px"><\/p>$/);
    assert.equal(result[0].options[1].option_text, `<img src="${result[0].question_text.match(/src="([^"]+)"/)[1]}">`);
    assert.match(result[0].metadata.stimulus_html, /\.jpg">$/);
    assert.equal(result[0].metadata.note, 'tanpa gambar');
    assert.equal(result[0].options[2].option_text, 'Plain answer');
    assert.equal(result[0].options[0].is_correct, true);
    assert.equal(calls.find(file => file.name.endsWith('.jpg')).type, 'image/jpeg');
    assert.deepEqual(progress.at(-1), { done: 3, total: 3 });
    // Muatan asli tidak diubah (pratinjau di modal tetap memakai base64).
    assert.equal(collectInlineImages(original).length, 3);
    assert.ok(JSON.stringify(result).length < JSON.stringify(original).length / 2);
});

test('IMG-03: tanpa gambar, muatan dikembalikan apa adanya tanpa unggahan', async () => {
    const plain = [{ question_text: '<p>2 + 2 = ?</p>', options: [{ option_text: '4' }] }];
    const { upload, calls } = fakeUploader();
    assert.equal(await replaceInlineImages(plain, { upload }), plain);
    assert.equal(calls.length, 0);
});

test('IMG-04: percobaan ulang impor memakai URL yang sama sehingga hash impor tetap identik', async () => {
    const { upload, calls } = fakeUploader();
    const first = await replaceInlineImages(sampleQuestions(), { upload, sleep: noSleep });
    const second = await replaceInlineImages(sampleQuestions(), { upload, sleep: noSleep });
    assert.equal(calls.length, 3);
    assert.equal(JSON.stringify(second), JSON.stringify(first));
});

test('IMG-05: unggahan yang gagal dicoba ulang; gagal permanen memberi pesan jelas dan tidak diingat', async () => {
    let attempts = 0;
    const flaky = async (file) => {
        attempts++;
        if (attempts < 3) throw new Error('Terlalu banyak permintaan');
        return `https://files.example/${file.name}`;
    };
    const waits = [];
    const result = await replaceInlineImages([{ question_text: `<img src="${png('x')}">` }],
        { upload: flaky, retryDelaysMs: [5, 10, 20], sleep: async ms => { waits.push(ms); } });
    assert.match(result[0].question_text, /^<img src="https:\/\/files\.example\/[0-9a-f]{32}\.png">$/);
    assert.deepEqual(waits, [5, 10]);

    clearInlineImageCache();
    let down = 0;
    await assert.rejects(
        replaceInlineImages([{ question_text: `<img src="${png('y')}">` }],
            { upload: async () => { down++; throw new Error('HTTP 503'); }, retryDelaysMs: [1, 1], sleep: noSleep }),
        /Gagal mengunggah gambar soal: HTTP 503/,
    );
    assert.equal(down, 3);
    // Kegagalan tidak di-cache: percobaan berikutnya benar-benar mengunggah lagi.
    const { upload, calls } = fakeUploader();
    await replaceInlineImages([{ question_text: `<img src="${png('y')}">` }], { upload, sleep: noSleep });
    assert.equal(calls.length, 1);
});

test('IMG-06: gambar EMF/WMF dari Word ditolak dengan petunjuk, tanpa mengunggah apa pun', async () => {
    const emf = `data:image/x-emf;base64,${Buffer.from('emf').toString('base64')}`;
    const { upload, calls } = fakeUploader();
    await assert.rejects(
        replaceInlineImages([{ question_text: `<img src="${emf}"><img src="${png('z')}">` }], { upload }),
        /1 gambar di dokumen berformat EMF.*PNG\/JPG/s,
    );
    assert.equal(calls.length, 0);
});

test('IMG-07: dokumen 40 soal bergambar besar menjadi kecil setelah gambar diunggah', async () => {
    const bigImage = (i) => `data:image/jpeg;base64,${Buffer.alloc(300 * 1024, i).toString('base64')}`;
    const questions = Array.from({ length: 40 }, (_, i) => ({ question_text: `<p>Soal ${i + 1}</p><img src="${bigImage(i)}">` }));
    assert.ok(Buffer.byteLength(JSON.stringify({ questions })) > 10 * 1024 * 1024, 'contoh harus melewati 10 MB');
    assert.ok(inlineImageBytes(questions) > 10 * 1024 * 1024);
    const { upload } = fakeUploader();
    const result = await replaceInlineImages(questions, { upload, sleep: noSleep });
    assert.ok(Buffer.byteLength(JSON.stringify({ questions: result })) < 50 * 1024);
});

test('IMG-08: impor massal mengunggah gambar sebelum mengirim, route memberi pesan jelas bila tetap terlalu besar', () => {
    const imports = web('lib/api/imports.ts');
    assert.match(imports, /replaceInlineImages\(questions,/);
    assert.match(imports, /\{ questions: payload, clientRequestId \}/);
    assert.match(imports, /uploadToHosting\(file, 'questions'\)/);

    const route = web('app/api/question-banks/[bankId]/bulk-import/route.ts');
    assert.match(route, /IMPORT_BODY_LIMIT_BYTES = 10 \* 1024 \* 1024/);
    assert.ok(route.indexOf('content-length') < route.indexOf('await request.json()'),
        'ukuran diperiksa sebelum JSON dibaca');
    assert.match(route, /status: 413/);

    const modal = web('app/components/questions/BulkImportModal.tsx');
    assert.equal((modal.match(/onImageProgress: trackImageUpload/g) || []).length, 2,
        'impor file dan impor antar-bank sama-sama mengunggah gambar');
    // Kunci idempotensi dihitung dari isi asli, sebelum gambar diunggah.
    for (const block of modal.split('pendingImportRequest(bankId, questionsToImport)').slice(1)) {
        assert.ok(block.indexOf('bulkImportQuestions(') > -1);
    }
});
