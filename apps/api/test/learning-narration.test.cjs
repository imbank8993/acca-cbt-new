const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });
const { ForbiddenException } = require('@nestjs/common');
const { LearningService } = require('../src/learning/learning.service.ts');
const { fixtureDb } = require('./fixture-db.cjs');

const teacher = { id: 'teacher', roles: ['Guru'] }, student = { id: 'student', roles: ['Siswa'] }, other = { id: 'other', roles: ['Guru'] };
const material = (overrides = {}) => ({ id: 'material', organization_id: 'school', created_by: 'teacher', title: 'Siklus Air', description: '', subject: 'IPA', status: 'draft', format: 'html', content_html: '<h1>Air</h1>', conversion_notes: '', file_key: 'lms-private/school/material/source.bin', file_name: 'materi.html', file_size: 10, narration_key: null, narration_name: null, narration_size: null, revision: 1, content_version: 1, ...overrides });
const authz = { async assertOrgRole(user, org, roles) { if (org !== 'school' || !user.roles.some(role => roles.includes(role))) throw new ForbiddenException(); } };
function setup(rows = [material()]) {
    const db = fixtureDb({ cbt_learning_materials: rows, cbt_learning_progress: [] });
    const storage = { put: [], removed: [], read: [], async putObject(...args) { this.put.push(args); return { success: true }; }, async deleteObject(key) { this.removed.push(key); return { success: true }; }, async getObject(key) { this.read.push(key); return { stream: {}, contentType: 'application/octet-stream' }; } };
    return { db, storage, service: new LearningService(db, authz, storage) };
}
const mp3 = (name = 'narasi.mp3') => ({ originalname: name, size: 16, buffer: Buffer.concat([Buffer.from('ID3'), Buffer.alloc(13)]) });

test('Narasi: guru pemilik mengunggah audio; key tidak dibocorkan dan isi tidak berubah versi', async () => {
    const { service, storage, db } = setup();
    const { material: saved } = await service.uploadNarration(teacher, 'school', 'material', mp3(), 1);
    assert.equal(saved.hasNarration, true);
    assert.equal(saved.narration_name, 'narasi.mp3');
    assert.equal('narration_key' in saved, false);
    assert.equal(saved.revision, 2);
    assert.equal(db.tables.cbt_learning_materials[0].content_version, 1);
    assert.match(storage.put[0][0], /^lms-private\/school\/material\/.+\.bin$/);
    assert.equal(storage.put[0][2], 'application/octet-stream');
});
test('Narasi: mengganti audio menghapus objek lama setelah baris diperbarui', async () => {
    const { service, storage } = setup([material({ narration_key: 'lms-private/school/material/old.bin', narration_name: 'lama.mp3', narration_size: 5 })]);
    await service.uploadNarration(teacher, 'school', 'material', mp3('baru.mp3'), 1);
    assert.deepEqual(storage.removed, ['lms-private/school/material/old.bin']);
});
test('Narasi: berkas bukan audio, format non-HTML, revisi lama, dan pengguna lain ditolak', async () => {
    const { service, storage } = setup([material(), material({ id: 'word', format: 'word' })]);
    await assert.rejects(service.uploadNarration(teacher, 'school', 'material', { originalname: 'virus.mp3', size: 16, buffer: Buffer.from('<script>alert(1)') }, 1), /MP3/);
    await assert.rejects(service.uploadNarration(teacher, 'school', 'material', { originalname: 'narasi.exe', size: 16, buffer: mp3().buffer }, 1), /MP3/);
    await assert.rejects(service.uploadNarration(teacher, 'school', 'word', mp3(), 1), /hanya tersedia untuk bahan ajar HTML/);
    await assert.rejects(service.uploadNarration(teacher, 'school', 'material', mp3(), 7), /berubah/);
    await assert.rejects(service.uploadNarration(student, 'school', 'material', mp3(), 1), ForbiddenException);
    await assert.rejects(service.uploadNarration(other, 'school', 'material', mp3(), 1), ForbiddenException);
    assert.equal(storage.put.length, 0);
});
test('Narasi: siswa hanya dapat memutar audio materi terbit', async () => {
    const withAudio = { narration_key: 'lms-private/school/material/audio.bin', narration_name: 'narasi.mp3', narration_size: 16 };
    const { service, storage } = setup([material(withAudio), material({ id: 'live', status: 'published', ...withAudio })]);
    await assert.rejects(service.narration(student, 'school', 'material'), ForbiddenException);
    const { name } = await service.narration(student, 'school', 'live');
    assert.equal(name, 'narasi.mp3');
    assert.deepEqual(storage.read, ['lms-private/school/material/audio.bin']);
});
test('Narasi: hapus audio mengosongkan kolom lalu menghapus objek; materi dihapus ikut membersihkan audio', async () => {
    const withAudio = { narration_key: 'lms-private/school/material/audio.bin', narration_name: 'narasi.mp3', narration_size: 16 };
    const { service, storage, db } = setup([material(withAudio)]);
    await assert.rejects(service.removeNarration(teacher, 'school', 'material', 9), /berubah/);
    const { material: saved } = await service.removeNarration(teacher, 'school', 'material', 1);
    assert.equal(saved.hasNarration, false);
    assert.equal(db.tables.cbt_learning_materials[0].narration_key, null);
    assert.deepEqual(storage.removed, ['lms-private/school/material/audio.bin']);

    const second = setup([material(withAudio)]);
    await second.service.delete(teacher, 'school', 'material');
    assert.ok(second.storage.removed.includes('lms-private/school/material/audio.bin'));
});
