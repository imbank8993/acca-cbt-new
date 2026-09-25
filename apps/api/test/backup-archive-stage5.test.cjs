const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const JSZip = require('jszip');

require('ts-node').register({
    project: path.resolve(__dirname, '../../web/tsconfig.json'),
    transpileOnly: true,
    compilerOptions: { module: 'CommonJS', moduleResolution: 'node' },
});
require('tsconfig-paths').register({
    baseUrl: path.resolve(__dirname, '../../web'),
    paths: { '@/*': ['*'] },
});

const { readArchive, verifyBackupContent } = require('../../web/app/api/backup/import/route.ts');

const secret = 'stage-five-test-secret-that-is-long-enough';

test('BUG-02: image archive manifest is verified in its original signed form', async () => {
    const payload = {
        version: '2.0',
        data: { bank_questions: [{ question_text: '<img src="images/a.png">' }] },
    };
    const signature = crypto.createHmac('sha256', secret)
        .update(JSON.stringify(payload)).digest('hex');
    const manifest = JSON.stringify({ signature, ...payload }, null, 2);
    const zip = new JSZip();
    zip.file('backup.cbtbak', manifest);
    zip.file('images/a.png', Buffer.from([137, 80, 78, 71]));
    const file = new File([await zip.generateAsync({ type: 'nodebuffer' })], 'backup.zip');

    const opened = await readArchive(file);
    assert.equal(opened.content, manifest);
    assert.deepEqual(verifyBackupContent(opened.content, secret), payload);

    const tampered = opened.content.replace('bank_questions', 'bank_questionX');
    assert.throws(() => verifyBackupContent(tampered, secret), /keutuhan gagal/i);
});

test('SEC-12: excessive archive entries are rejected before extraction', async () => {
    const zip = new JSZip();
    zip.file('backup.cbtbak', '{}');
    for (let index = 0; index < 502; index += 1) {
        zip.file(`images/${index}.png`, 'x');
    }
    const file = new File([await zip.generateAsync({ type: 'nodebuffer' })], 'many.zip');
    await assert.rejects(readArchive(file), /Jumlah berkas melewati batas/);
});

test('SEC-12/SEC-13: route ordering prevents pre-auth parsing and URL fetch SSRF', () => {
    const importSource = fs.readFileSync(
        path.resolve(__dirname, '../../web/app/api/backup/import/route.ts'), 'utf8',
    );
    assert.ok(importSource.indexOf('import-authorization') < importSource.indexOf('request.formData()'));

    const exportSource = fs.readFileSync(
        path.resolve(__dirname, '../../web/app/api/backup/export/route.ts'), 'utf8',
    );
    assert.equal(exportSource.includes('fetch(url)'), false);
    assert.equal(exportSource.includes('objectKeyFromUrl(url)'), true);
    assert.equal(exportSource.includes('getObject(key, MAX_IMAGE_BYTES)'), true);
});
