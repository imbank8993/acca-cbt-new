const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });
const { segmentArabicAndLatin } = require('../../web/lib/arabic-utils.ts');

const read = file => fs.readFileSync(path.resolve(__dirname, '../../web', file), 'utf8').replace(/\r\n/g, '\n');
const pairs = segments => segments.map(s => [s.type, s.text]);

test('punctuation at the edge of an Arabic run follows the sentence, not the RTL span', () => {
    assert.deepEqual(pairs(segmentArabicAndLatin('Sekolah (tempat belajar) — اَلْمَدْرَسَةُ')), [
        ['latin', 'Sekolah '], ['latin_gloss', '(tempat belajar)'], ['neutral', ' — '], ['arabic', 'اَلْمَدْرَسَةُ'],
    ]);
    assert.deepEqual(pairs(segmentArabicAndLatin('اِقْرَأْ!')), [['arabic', 'اِقْرَأْ'], ['neutral', '!']]);
    assert.deepEqual(pairs(segmentArabicAndLatin(' — كِتَابٌ')), [['neutral', ' — '], ['arabic', 'كِتَابٌ']]);
});

test('plain Arabic, plain Latin and Arabic punctuation stay intact', () => {
    assert.deepEqual(pairs(segmentArabicAndLatin('فَاِذَا فَرَغْتَ فَانْصَبْۙ')), [['arabic', 'فَاِذَا فَرَغْتَ فَانْصَبْۙ']]);
    assert.deepEqual(pairs(segmentArabicAndLatin('مَا مَعْنَى؟')), [['arabic', 'مَا مَعْنَى؟']]);
    assert.deepEqual(pairs(segmentArabicAndLatin('Asy-Syarḥ [94]:7-8')), [['latin', 'Asy-Syarḥ [94]:7-8']]);
    assert.deepEqual(pairs(segmentArabicAndLatin('Arti kata كِتَابٌ adalah')), [
        ['latin', 'Arti kata '], ['arabic', 'كِتَابٌ'], ['latin', ' adalah'],
    ]);
});

test('Latin text in questions with Arabic keeps the normal question font and size', () => {
    const renderer = read('app/components/questions/QuestionRenderer.tsx');
    const latin = renderer.match(/\.question-content \.cbt-latin-text,\s*\.cbt-latin-text \{([^}]*)\}/);
    assert.ok(latin, 'aturan .cbt-latin-text ada');
    assert.doesNotMatch(latin[1], /font-family|font-size|line-height/);
    const gloss = renderer.match(/\.question-content \.cbt-latin-gloss,\s*\.cbt-latin-gloss \{([^}]*)\}/);
    assert.doesNotMatch(gloss[1], /font-size/);
    const latex = read('app/components/questions/LatexRenderer.tsx');
    assert.doesNotMatch(latex, /getFontFamilyForText\(/, 'pembungkus tidak berganti font untuk konten Arab');
    assert.doesNotMatch(latex, /lineHeight:\s*'2\.0'/);
});
