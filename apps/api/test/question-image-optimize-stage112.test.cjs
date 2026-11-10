// Run from repository root: node --test apps/api/test/question-image-optimize-stage112.test.cjs
// Gambar soal diperkecil (≤1600 px) dan diubah ke WebP sebelum diunggah.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });
const {
    planQuestionImage, preferConverted, isAnimatedImageHeader, renameExtension, optimizeQuestionImage,
    QUESTION_IMAGE_MAX_SIDE, QUESTION_PHOTO_QUALITY, QUESTION_GRAPHIC_QUALITY,
} = require('../../web/lib/question-image-optimize.ts');

const web = (relative) => fs.readFileSync(path.resolve(__dirname, '../../web', relative), 'utf8');

test('QIMG-01: foto besar diperkecil ke 1600 px dengan kualitas foto; diagram memakai kualitas grafis', () => {
    assert.deepEqual(planQuestionImage({ type: 'image/jpeg', size: 4_800_000, width: 4000, height: 3000 }),
        { action: 'convert', width: 1600, height: 1200, quality: QUESTION_PHOTO_QUALITY, resized: true });
    assert.deepEqual(planQuestionImage({ type: 'image/png', size: 900_000, width: 1200, height: 2400 }),
        { action: 'convert', width: 800, height: 1600, quality: QUESTION_GRAPHIC_QUALITY, resized: true });
    assert.equal(QUESTION_IMAGE_MAX_SIDE, 1600);
});

test('QIMG-02: gambar kecil, SVG, GIF, dan non-gambar tidak disentuh; BMP selalu dikonversi', () => {
    assert.deepEqual(planQuestionImage({ type: 'image/png', size: 40_000, width: 800, height: 600 }), { action: 'keep', reason: 'small' });
    assert.deepEqual(planQuestionImage({ type: 'image/svg+xml', size: 900_000, width: 4000, height: 4000 }), { action: 'keep', reason: 'format' });
    assert.deepEqual(planQuestionImage({ type: 'image/gif', size: 2_000_000, width: 3000, height: 3000 }), { action: 'keep', reason: 'format' });
    assert.deepEqual(planQuestionImage({ type: 'application/pdf', size: 2_000_000, width: 0, height: 0 }), { action: 'keep', reason: 'format' });
    assert.equal(planQuestionImage({ type: 'image/bmp', size: 40_000, width: 200, height: 100 }).action, 'convert');
    // Tidak perlu diperkecil tetapi besar: dicoba dikonversi.
    assert.equal(planQuestionImage({ type: 'image/png', size: 600_000, width: 1280, height: 800 }).action, 'convert');
});

test('QIMG-03: hasil konversi dipakai hanya bila lebih kecil, kecuali resolusinya memang diperkecil', () => {
    assert.equal(preferConverted(600_000, 590_000, false), false, 'kurang dari 5% lebih kecil: tetap asli');
    assert.equal(preferConverted(600_000, 300_000, false), true);
    assert.equal(preferConverted(600_000, 700_000, false), false);
    assert.equal(preferConverted(200_000, 250_000, true), true);
    assert.equal(preferConverted(200_000, 0, true), false);
});

test('QIMG-04: PNG/WebP beranimasi dikenali dari penandanya dan dibiarkan', () => {
    const withMarker = (marker) => { const bytes = new Uint8Array(200); bytes.set([...marker].map(c => c.charCodeAt(0)), 37); return bytes; };
    assert.equal(isAnimatedImageHeader(withMarker('acTL'), 'image/png'), true);
    assert.equal(isAnimatedImageHeader(withMarker('ANIM'), 'image/webp'), true);
    assert.equal(isAnimatedImageHeader(new Uint8Array(200), 'image/png'), false);
    assert.equal(isAnimatedImageHeader(withMarker('acTL'), 'image/jpeg'), false);
});

test('QIMG-05: nama berkas mengikuti format baru; di luar peramban berkas asli dikembalikan', async () => {
    assert.equal(renameExtension('IMG_20261110.JPG', 'webp'), 'IMG_20261110.webp');
    assert.equal(renameExtension('grafik.png', 'jpg'), 'grafik.jpg');
    assert.equal(renameExtension('', 'webp'), 'gambar-soal.webp');
    const file = new File([new Uint8Array(10)], 'a.png', { type: 'image/png' });
    assert.equal(await optimizeQuestionImage(file), file);
});

test('QIMG-06: semua unggahan gambar soal lewat optimasi; folder lain tidak', () => {
    const uploader = web('lib/uploader.ts');
    assert.match(uploader, /if \(folder === 'questions' && file\.type\.startsWith\('image\/'\)\) \{\s+file = await optimizeQuestionImage\(file\);/);
    assert.ok(uploader.indexOf('optimizeQuestionImage(file)') < uploader.indexOf("formData.append('file', file)"));
    // Editor, stimulus, petunjuk, modal soal, dan import Word mengunggah ke folder `questions`.
    for (const file of ['app/components/questions/TipTapEditorCore.tsx', 'app/components/questions/StimulusManager.tsx',
        'app/components/questions/InstructionManager.tsx', 'app/components/questions/QuestionEditorModal.tsx', 'lib/api/imports.ts']) {
        assert.match(web(file), /uploadToHosting\(file, 'questions'\)/, file);
    }
    // Potongan gambar disimpan sebagai PNG agar latar transparan tidak menjadi hitam.
    const editor = web('app/components/questions/ImageEditorModal.tsx');
    assert.match(editor, /canvas\.toDataURL\('image\/png'\)/);
    assert.doesNotMatch(editor, /toDataURL\('image\/jpeg'/);
});
