const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });
const { ForbiddenException } = require('@nestjs/common');
const { LearningService } = require('../src/learning/learning.service.ts');
const { fixtureDb } = require('./fixture-db.cjs');
const { learningStateKey } = require('../../web/lib/learning-state.ts');
const teacher = { id: 'teacher', roles: ['Guru'] }, student = { id: 'student', roles: ['Siswa'] };
const row = { id: 'material', organization_id: 'school', created_by: 'teacher', title: 'Materi', status: 'published', format: 'html', content_html: '<input>', content_version: 1, revision: 1, file_key: 'old' };
const dto = { revision: 1, title: 'Materi', description: '', subject: '', status: 'published', format: 'html', contentHtml: '<input>', conversionNotes: '' };
function fixture(extra = {}, options = {}) {
    const db = fixtureDb({ cbt_learning_materials: [{ ...row }], cbt_learning_progress: [], cbt_learning_activity: [], cbt_profiles: [], ...extra }, [], options);
    const storage = { removed: [], async putObject() { return { success: true }; }, async deleteObject(key) { this.removed.push(key); return { success: true }; } };
    const auth = { async assertOrgRole(user, org, roles) { if (org !== 'school' || !user.roles.some(role => roles.includes(role))) throw new ForbiddenException(); } };
    return { db, storage, service: new LearningService(db, auth, storage) };
}
test('LMS resilience: failed metadata commit retains both original file and HTML', async () => {
    const { db, service, storage } = fixture({ cbt_learning_materials: [{ ...row, status: 'draft' }] }, { failMutation: { table: 'cbt_learning_materials', mutation: 'update' } });
    await assert.rejects(service.upload(teacher, 'school', 'material', { originalname: 'new.html', size: 10, buffer: Buffer.from('new') }, 1, { ...dto, status: 'draft', contentHtml: '<p>new</p>' }), /lampiran/);
    assert.equal(db.tables.cbt_learning_materials[0].content_html, '<input>');
    assert.equal(db.tables.cbt_learning_materials[0].file_key, 'old');
    assert.equal(storage.removed.length, 1); assert.notEqual(storage.removed[0], 'old');
});
test('LMS resilience: incomplete upload cannot blank existing material', async () => {
    const { service, db } = fixture({ cbt_learning_materials: [{ ...row, status: 'draft' }] });
    await assert.rejects(service.upload(teacher, 'school', 'material', { originalname: 'a', size: 1 }, 1), /konversi/);
    assert.equal(db.tables.cbt_learning_materials[0].content_html, '<input>');
});
test('LMS resilience: metadata edit preserves completion; content edit marks updated', async () => {
    const { service } = fixture();
    await service.progress(student, 'school', 'material', true, 1);
    await service.update(teacher, 'school', 'material', { ...dto, title: 'Judul baru' });
    assert.equal((await service.detail(student, 'school', 'material')).completed, true);
    await service.update(teacher, 'school', 'material', { ...dto, revision: 2, contentHtml: '<input><p>Isi baru</p>' });
    const detail = await service.detail(student, 'school', 'material');
    assert.equal(detail.completed, false); assert.equal(detail.materialUpdated, true);
    await assert.rejects(service.progress(student, 'school', 'material', true, 1), /diperbarui/);
    await service.progress(student, 'school', 'material', true, 2);
    assert.equal((await service.detail(student, 'school', 'material')).completed, true);
});
test('LMS resilience: activity identity comes from session and stale versions cannot overwrite', async () => {
    const { service, db } = fixture();
    await service.saveActivity(student, 'school', 'material', { contentVersion: 1, revision: 0, state: { fields: [{ key: 'a', value: '42' }] } });
    assert.equal(db.tables.cbt_learning_activity[0].user_id, student.id);
    assert.equal((await service.activity(student, 'school', 'material')).revision, 1);
    const other = { ...student, id: 'other' };
    assert.equal((await service.activity(other, 'school', 'material')).revision, 0);
    await assert.rejects(service.saveActivity(other, 'school', 'material', { contentVersion: 1, revision: 1, state: {} }), /tab lain/);
    await assert.rejects(service.saveActivity(student, 'school', 'material', { contentVersion: 2, revision: 1, state: {} }), /diperbarui/);
    await service.saveActivity(student, 'school', 'material', { contentVersion: 1, revision: 1, state: { answer: 43 } });
    await assert.rejects(service.saveActivity(student, 'school', 'material', { contentVersion: 1, revision: 1, state: {} }), /tab lain/);
});
test('LMS resilience: activity results restricted to owner/admin', async () => {
    const { service } = fixture();
    await assert.rejects(service.activityResults(student, 'school', 'material'), ForbiddenException);
    await assert.rejects(service.activityResults({ ...teacher, id: 'other' }, 'school', 'material'), ForbiddenException);
    assert.deepEqual((await service.activityResults(teacher, 'school', 'material')).results, []);
});
test('LMS resilience: drafts and oversized activity states rejected', async () => {
    const { service, db } = fixture();
    await assert.rejects(service.saveActivity(student, 'school', 'material', { contentVersion: 1, revision: 0, state: { answer: 'x'.repeat(131073) } }), /128 KB/);
    db.tables.cbt_learning_materials[0].status = 'draft';
    await assert.rejects(service.activity(student, 'school', 'material'), ForbiddenException);
    await assert.rejects(service.saveActivity(student, 'school', 'material', { contentVersion: 1, revision: 0, state: {} }), ForbiddenException);
});
test('LMS resilience: lost-response comparison ignores jsonb key ordering', () => {
    assert.equal(learningStateKey({ fields: [{ key: 'x', value: 'a' }], custom: { b: 2, a: 1 } }), learningStateKey({ custom: { a: 1, b: 2 }, fields: [{ value: 'a', key: 'x' }] }));
});

test('LMS classification: metadata survives upload and does not invalidate completion', async () => {
    const { service, db } = fixture();
    await service.progress(student, 'school', 'material', true, 1);
    const saved = await service.update(teacher, 'school', 'material', { ...dto, gradeLevel: '10', topic: ' Aljabar ', subtopic: ' Akar ' });
    assert.equal(saved.material.grade_level, '10'); assert.equal(saved.material.topic, 'Aljabar');
    assert.equal((await service.detail(student, 'school', 'material')).completed, true);
    assert.equal((await service.list(student, 'school')).materials[0].subtopic, 'Akar');
    db.tables.cbt_learning_materials[0].status = 'draft';
    const uploaded = await service.upload(teacher, 'school', 'material', { originalname: 'a.html', size: 1, buffer: Buffer.from('a') }, 2, { ...dto, revision: 2, status: 'draft' });
    assert.equal(uploaded.material.grade_level, '10'); assert.equal(uploaded.material.subtopic, 'Akar');
});
