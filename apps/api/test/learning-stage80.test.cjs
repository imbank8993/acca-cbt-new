const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });
const { ForbiddenException } = require('@nestjs/common');
const { LearningService } = require('../src/learning/learning.service.ts');
const { StorageController } = require('../src/storage/storage.controller.ts');
const { convertLearningLatex } = require('../../web/lib/learning-latex.ts');
const { fixtureDb } = require('./fixture-db.cjs');

const teacher = { id: 'teacher', roles: ['Guru'] }, student = { id: 'student', roles: ['Siswa'] }, admin = { id: 'admin', roles: ['Admin'] };
const material = (overrides = {}) => ({ id: 'material', organization_id: 'school', created_by: 'teacher', title: 'Aljabar', description: '', subject: 'Matematika', status: 'draft', format: 'word', content_html: '<h1>Belajar</h1>', conversion_notes: '', file_key: 'lms-private/school/material/source.bin', file_name: 'materi.docx', file_size: 123, revision: 1, ...overrides });
const authz = { async assertOrgRole(user, org, roles) { if (org !== 'school' || !user.roles.some(role => roles.includes(role))) throw new ForbiddenException(); } };
function setup(rows = [material()], failed = []) {
    const db = fixtureDb({ cbt_learning_materials: rows, cbt_learning_progress: [] }, failed);
    const storage = { put: [], removed: [], read: [], async putObject(...args) { this.put.push(args); return { success: true }; }, async deleteObject(key) { this.removed.push(key); return { success: true }; }, async getObject(key) { this.read.push(key); return { stream: {}, contentType: 'application/octet-stream' }; } };
    return { db, storage, service: new LearningService(db, authz, storage) };
}
const update = (overrides = {}) => ({ title: 'Aljabar baru', description: '', subject: 'Matematika', status: 'published', format: 'word', contentHtml: '<h1>Aljabar</h1>', conversionNotes: '', revision: 1, ...overrides });
test('LMS: siswa hanya melihat materi terbit di sekolahnya', async () => {
    const { service } = setup([material(), material({ id: 'published', status: 'published' }), material({ id: 'other', organization_id: 'another', status: 'published' })]);
    const result = await service.list(student, 'school');
    assert.deepEqual(result.materials.map(row => row.id), ['published']); assert.equal(result.canManage, false);
    await assert.rejects(service.list(student, 'school', true), ForbiddenException);
    await assert.rejects(service.detail(student, 'school', 'material'), ForbiddenException);
    await assert.rejects(service.detail(student, 'school', 'other'), /tidak ditemukan/);
});
test('LMS: guru hanya mengelola miliknya, admin dapat mengelola semua', async () => {
    const { service } = setup([material(), material({ id: 'another', created_by: 'another-teacher' })]);
    assert.equal((await service.list(teacher, 'school', true)).materials.length, 1);
    assert.equal((await service.list(admin, 'school', true)).materials.length, 2);
    await assert.rejects(service.update(teacher, 'school', 'another', update()), ForbiddenException);
    assert.equal((await service.update(admin, 'school', 'another', update())).material.status, 'published');
});
test('LMS: siswa tidak dapat membuat, mengubah, atau mengunggah materi', async () => {
    const { service, storage } = setup();
    await assert.rejects(service.create(student, 'school', { id: 'new', title: 'Test' }), ForbiddenException);
    await assert.rejects(service.update(student, 'school', 'material', update()), ForbiddenException);
    await assert.rejects(service.upload(student, 'school', 'material', { size: 1, buffer: Buffer.from('a'), originalname: 'a.html' }, 1), ForbiddenException);
    assert.equal(storage.put.length, 0);
});
test('LMS: ID create stabil tidak menggandakan draf dan tidak mengambil alih draf orang lain', async () => {
    const { service, db } = setup();
    await service.create(teacher, 'school', { id: 'new', title: 'Test' });
    await service.create(teacher, 'school', { id: 'new', title: 'Test' });
    assert.equal(db.tables.cbt_learning_materials.filter(row => row.id === 'new').length, 1);
    await assert.rejects(service.create(admin, 'school', { id: 'new', title: 'Ambil' }), /sudah digunakan/);
});
test('LMS: publikasi kosong ditolak dan revisi mencegah penimpaan tab lain', async () => {
    const { service, db } = setup([material({ file_key: null, content_html: '' })]);
    await assert.rejects(service.update(teacher, 'school', 'material', update({ contentHtml: '' })), /Unggah/);
    const saved = await service.update(teacher, 'school', 'material', update());
    assert.equal(saved.material.revision, 2);
    await assert.rejects(service.update(teacher, 'school', 'material', update({ title: 'Stale' })), /tab lain/);
    assert.equal(db.tables.cbt_learning_materials[0].title, 'Aljabar baru');
});
test('LMS: unduhan draf memerlukan pemilik/admin dan key tidak diberikan pada pembaca', async () => {
    const { service, storage } = setup();
    await assert.rejects(service.file(student, 'school', 'material'), ForbiddenException);
    assert.equal(storage.read.length, 0);
    const detail = await service.detail(teacher, 'school', 'material');
    assert.equal(detail.material.file_key, undefined); assert.equal(detail.material.hasFile, true);
    await service.file(teacher, 'school', 'material'); assert.equal(storage.read.length, 1);
});
test('LMS: semua ekstensi disimpan binary, bukan HTML publik', async () => {
    const { service, storage } = setup();
    const result = await service.upload(teacher, 'school', 'material', { originalname: '../a.html', size: 4, buffer: Buffer.from('test') }, 1);
    assert.match(storage.put[0][0], /^lms-private\/school\/material\/.+\.bin$/);
    assert.equal(storage.put[0][2], 'application/octet-stream');
    assert.equal(result.material.content_html, ''); assert.equal(result.material.format, 'attachment');
    assert.equal(result.material.revision, 2); assert.equal(result.material.file_name.includes('/'), false);
    assert.deepEqual(storage.removed, ['lms-private/school/material/source.bin']);
});
test('LMS: kegagalan unggah mempertahankan sumber lama', async () => {
    const { service, storage, db } = setup(); storage.putObject = async () => ({ success: false });
    await assert.rejects(service.upload(teacher, 'school', 'material', { originalname: 'a.exe', size: 1, buffer: Buffer.from('x') }, 1), /mengunggah/);
    assert.equal(storage.removed.length, 0); assert.equal(db.tables.cbt_learning_materials[0].file_name, 'materi.docx');
});
test('LMS: berkas terbit tidak bisa diganti sebelum dijadikan draf', async () => {
    const { service, storage } = setup([material({ status: 'published' })]);
    await assert.rejects(service.upload(teacher, 'school', 'material', { originalname: 'a.txt', size: 1, buffer: Buffer.from('x') }, 1), /draf/);
    assert.equal(storage.put.length, 0);
});
test('LMS: galat baca database tidak disalahartikan sebagai izin', async () => {
    const { service } = setup([material()], ['cbt_learning_materials']);
    await assert.rejects(service.detail(student, 'school', 'material'), /migrasi LMS/);
    const db = fixtureDb(); const broken = new LearningService(db, { assertOrgRole: async () => { throw new Error('db offline'); } }, {});
    await assert.rejects(broken.list(teacher, 'school'), /db offline/);
});
test('LMS: progres memakai identitas server dan menolak draf', async () => {
    const { service, db } = setup();
    await assert.rejects(service.progress(student, 'school', 'material', true), /belum diterbitkan/);
    db.tables.cbt_learning_materials[0].status = 'published';
    await service.progress(student, 'school', 'material', true);
    assert.equal(db.tables.cbt_learning_progress[0].user_id, 'student');
    assert.equal((await service.detail(student, 'school', 'material')).completed, true);
    await service.progress(student, 'school', 'material', false);
    assert.equal((await service.detail(student, 'school', 'material')).completed, false);
});
test('LMS: endpoint penyimpanan publik menolak prefix LMS', async () => {
    let calls = 0; const controller = new StorageController({ getObject: async () => { calls++; } });
    await assert.rejects(controller.serveFile({ url: '/storage/file/lms-private/school/x.bin' }, {}), /tidak ditemukan/);
    assert.equal(calls, 0);
});
test('LMS LaTeX: struktur, rumus, daftar, tabel, dan judul dikonversi', () => {
    const source = String.raw`\documentclass{article}\title{Aljabar}\begin{document}\maketitle\section{Rumus}Akar: $\frac{1}{2}$.
\begin{enumerate}\item Satu\item Dua\end{enumerate}
\begin{tabular}{cc}A&B\\1&2\end{tabular}\end{document}`;
    const result = convertLearningLatex(source);
    assert.match(result.html, /<h1>Aljabar<\/h1>/); assert.match(result.html, /<h2>Rumus<\/h2>/);
    assert.match(result.html, /<math/); assert.match(result.html, /<mfrac>/);
    assert.match(result.html, /<ol><li> Satu<\/li><li> Dua<\/li><\/ol>/);
    assert.match(result.html, /<td>2<\/td>/); assert.doesNotMatch(result.html, /documentclass/);
});
test('LMS LaTeX: sumber berbahaya tidak dieksekusi dan fitur tak didukung tetap terlihat', () => {
    const result = convertLearningLatex(String.raw`\section{<script>alert(1)</script>}\input{/etc/passwd}\includegraphics{https://evil.test/x} $\badcommand$`);
    assert.doesNotMatch(result.html, /<script>|<img/); assert.match(result.html, /&lt;script&gt;/);
    assert.match(result.html, /input/); assert.ok(result.notes.length > 0);
    assert.throws(() => convertLearningLatex('a'.repeat(500001)), /terlalu panjang/);
});
test('LMS LaTeX: rumus display, align, komentar dan verbatim tidak kehilangan teks', () => {
    const result = convertLearningLatex(String.raw`\begin{align}x&=2\\y&=3\end{align}
\begin{verbatim}<script>plain text</script>\end{verbatim}
100\% benar % komentar
akhir`);
    assert.match(result.html, /display="block"/); assert.match(result.html, /&lt;script&gt;plain text/);
    assert.match(result.html, /100% benar/); assert.doesNotMatch(result.html, /komentar/); assert.match(result.html, /akhir/);
});
