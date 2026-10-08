const { test } = require('node:test');
require('reflect-metadata');
const assert = require('node:assert/strict');
const path = require('node:path');
require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });
const { validate } = require('class-validator');
const { UpdateMaterialDto } = require('../src/learning/learning.dto.ts');
const { convertLearningFile } = require('../../web/lib/learning-converter.ts');
const { assertLearningContentSize } = require('../../web/lib/learning-content-limit.ts');
const dto = contentHtml => Object.assign(new UpdateMaterialDto(), { revision: 1, title: 'Materi', description: '', subject: '', status: 'draft', format: 'html', conversionNotes: '', contentHtml });
test('multibyte HTML is rejected before upload and by backend validation', async () => {
 const html = '漢'.repeat(3000000);
 assert.ok(html.length < 6000000);
 assert.throws(() => assertLearningContentSize(html), /8 MB/);
 await assert.rejects(convertLearningFile(new File([html], 'materi.html')), /8 MB/);
 assert.ok((await validate(dto(html))).some(error => error.property === 'contentHtml'));
});
test('frontend and backend accept content below the byte boundary and reject at boundary', async () => {
 const below = '漢'.repeat(2796202); // 8,388,606 bytes
 assert.doesNotThrow(() => assertLearningContentSize(below));
 assert.equal((await validate(dto(below))).length, 0);
 const at = below + 'ab';
 assert.throws(() => assertLearningContentSize(at), /8 MB/);
 assert.ok((await validate(dto(at))).some(error => error.property === 'contentHtml'));
});
test('character limit remains enforced for ASCII', () => {
 assert.doesNotThrow(() => assertLearningContentSize('a'.repeat(6000000)));
 assert.throws(() => assertLearningContentSize('a'.repeat(6000001)), /6 juta/);
});
