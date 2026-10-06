const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });
const { ForbiddenException } = require('@nestjs/common');
const { LearningService } = require('../src/learning/learning.service.ts');
const { fixtureDb } = require('./fixture-db.cjs');
const teacher = { id: 'teacher', roles: ['Guru'] }, student = { id: 'student', roles: ['Siswa'] };
const dto = { revision: 1, title: 'Materi', description: '', subject: '', status: 'draft', format: 'latex', contentHtml: '<h1>untrusted conversion</h1>', conversionNotes: '' };
const file = { originalname: 'materi.TEX', size: 12, buffer: Buffer.from('fixture tex') };
function setup({ compileFails = false, pdfFails = false, dbFails = false } = {}) {
    const db = fixtureDb({ cbt_learning_materials: [{ id: 'm', created_by: 'teacher', organization_id: 'school', title: 'Old', revision: 1, content_version: 1, status: 'draft', format: 'latex', file_key: 'old-source', rendered_pdf_key: 'old-pdf', content_html: '' }], cbt_learning_progress: [] }, [], dbFails ? { failMutation: { table: 'cbt_learning_materials', mutation: 'update' } } : {});
    const storage = { writes: [], deleted: [], reads: [], async putObject(key, bytes) { this.writes.push({ key, bytes }); return { success: !(pdfFails && this.writes.length === 2) }; }, async deleteObject(key) { this.deleted.push(key); }, async getObject(key) { this.reads.push(key); return { stream: {} }; } };
    const compiler = { calls: 0, async compile(source, project) { this.project = project; this.calls++; if (compileFails) throw Error('compile failed'); return Buffer.from('%PDF-fixture'); } };
    const auth = { async assertOrgRole(user, org, roles) { if (org !== 'school' || !user.roles.some(role => roles.includes(role))) throw new ForbiddenException(); } };
    return { db, storage, compiler, service: new LearningService(db, auth, storage, compiler) };
}
test('TeX upload compiles server-side, stores source and PDF atomically, never exposes storage keys', async () => {
    const { service, storage, compiler } = setup();
    const { material } = await service.upload(teacher, 'school', 'm', file, 1, dto);
    assert.equal(compiler.calls, 1); assert.equal(storage.writes.length, 2);
    assert.equal(material.content_html, ''); assert.equal(material.format, 'latex'); assert.equal(material.hasRenderedPdf, true);
    assert.equal(material.rendered_pdf_key, undefined); assert.equal(material.file_key, undefined);
    assert.deepEqual(storage.deleted, ['old-source', 'old-pdf']);
    await service.file(teacher, 'school', 'm', true);
    assert.equal(storage.reads[0], storage.writes[1].key);
});
test('compile, PDF storage and database failure all preserve old source and rendered PDF', async () => {
    for (const option of ['compileFails', 'pdfFails', 'dbFails']) {
        const { service, db, storage } = setup({ [option]: true });
        await assert.rejects(service.upload(teacher, 'school', 'm', file, 1, dto));
        assert.equal(db.tables.cbt_learning_materials[0].file_key, 'old-source');
        assert.equal(db.tables.cbt_learning_materials[0].rendered_pdf_key, 'old-pdf');
        assert.ok(!storage.deleted.includes('old-source') && !storage.deleted.includes('old-pdf'));
        assert.equal(storage.deleted.length, option === 'compileFails' ? 0 : option === 'pdfFails' ? 1 : 2);
    }
});
test('draft PDF access and compilation require ownership; stale revision cannot compile', async () => {
    const { service, compiler } = setup();
    await assert.rejects(service.file(student, 'school', 'm', true), ForbiddenException);
    await assert.rejects(service.upload(student, 'school', 'm', file, 1, dto), ForbiddenException);
    await assert.rejects(service.upload(teacher, 'school', 'm', file, 2, dto), /berubah/);
    assert.equal(compiler.calls, 0);
});
test('compiled PDF cannot be silently replaced with an HTML edit; source replacement clears old PDF', async () => {
    const { service, storage } = setup();
    await assert.rejects(service.update(teacher, 'school', 'm', dto), /Unggah ulang/);
    const { material } = await service.upload(teacher, 'school', 'm', { ...file, originalname: 'a.html' }, 1, { ...dto, format: 'html' });
    assert.equal(material.hasRenderedPdf, false); assert.equal(material.format, 'html');
    assert.ok(storage.deleted.includes('old-pdf'));
});

test('compiler client rejects missing service, oversized sources and invalid PDF responses', async (t) => {
    const { LearningLatexService } = require('../src/learning/learning-latex.service.ts');
    const compiler = new LearningLatexService();
    const previous = process.env.LATEX_RENDERER_URL;
    try {
        delete process.env.LATEX_RENDERER_URL;
        await assert.rejects(compiler.compile(Buffer.from('a')), /belum diaktifkan/);
        process.env.LATEX_RENDERER_URL = 'http://compiler.invalid';
        await assert.rejects(compiler.compile(Buffer.alloc(500001)), /500 KB/);
        const mock = t.mock.method(globalThis, 'fetch', async () => new Response('not pdf'));
        await assert.rejects(compiler.compile(Buffer.from('a')), /tidak valid/);
        mock.mock.mockImplementation(async () => new Response(JSON.stringify({ error: 'Missing package' }), { status: 422 }));
        await assert.rejects(compiler.compile(Buffer.from('a')), /Missing package/);
        mock.mock.mockImplementation(async () => new Response('%PDF-fixture'));
        assert.equal((await compiler.compile(Buffer.from('a'))).toString(), '%PDF-fixture');
    } finally {
        if (previous === undefined) delete process.env.LATEX_RENDERER_URL; else process.env.LATEX_RENDERER_URL = previous;
    }
});

test('ZIP upload uses project compiler and serves compiled PDF separately from original archive', async () => {
    const { service, compiler, storage } = setup();
    const result = await service.upload(teacher, 'school', 'm', { ...file, originalname: 'proyek.ZIP' }, 1, { ...dto, format: 'attachment' });
    assert.equal(compiler.project, true);
    assert.equal(result.material.format, 'latex');
    assert.equal(result.material.hasRenderedPdf, true);
    assert.equal((await service.file(teacher, 'school', 'm')).name, 'proyek.ZIP');
    assert.equal((await service.file(teacher, 'school', 'm', true)).name, 'proyek.pdf');
    assert.equal(storage.writes.length, 2);
});
