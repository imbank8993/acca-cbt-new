const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });
const { fixtureDb } = require('./fixture-db.cjs');
const { LearningService } = require('../src/learning/learning.service.ts');
const { groupLearningChapters } = require('../../web/lib/learning-catalog.ts');
const { CreateMaterialDto } = require('../src/learning/learning.dto.ts');
const { validate } = require('class-validator');
const material = (patch = {}) => ({ id: 'one', grade_level: '10', subject: 'Matematika', topic: 'Fungsi', subtopic: 'Definisi fungsi', title: 'Definisi fungsi', subtopic_order: 1, ...patch });

test('catalogue groups files under the same chapter, normalizes spelling, and isolates grades and subjects', () => {
    const groups = groupLearningChapters([material({ id: 'two', subtopic: 'Daerah asal', subtopic_order: 2 }), material({ completed: true }),
        material({ id: 'three', subject: ' matematika ', topic: ' fungsi ', subtopic_order: 3 }),
        material({ id: 'other-grade', grade_level: '11' }), material({ id: 'other-subject', subject: 'Fisika' })]);
    assert.equal(groups.length, 3);
    const functions = groups.find(group => group.grade === '10' && group.subject.toLowerCase().trim() === 'matematika');
    assert.deepEqual(functions.items.map(item => item.id), ['one', 'two', 'three']);
    assert.equal(functions.completed, 1);
});

test('legacy materials remain discoverable and numbering sorts naturally without changing source data', () => {
    const input = [material({ id: 'ten', topic: '', subtopic: 'Bagian 10', subtopic_order: 0 }), material({ id: 'two', topic: '', subtopic: 'Bagian 2', subtopic_order: 0 }), material({ id: 'general', grade_level: '', subject: '', topic: '', subtopic: '' })];
    const before = JSON.stringify(input);
    const groups = groupLearningChapters(input);
    assert.equal(groups[0].title, 'Belum dikelompokkan');
    assert.deepEqual(groups[0].items.map(item => item.id), ['two', 'ten']);
    assert.equal(groups[1].grade, '');
    assert.equal(JSON.stringify(input), before);
});

test('creating a second file reuses chapter classification and preserves its independent order on save and upload', async () => {
    const db = fixtureDb({ cbt_learning_materials: [], cbt_learning_progress: [] });
    const storage = { putObject: async () => ({ success: true }), deleteObject: async () => ({ success: true }) };
    const service = new LearningService(db, { assertOrgRole: async () => {} }, storage);
    const author = { id: 'teacher' };
    for (const [id, subtopic, order] of [['one', 'Definisi fungsi', 1], ['two', 'Daerah asal', 2]]) {
        await service.create(author, 'school', { id, title: subtopic, subtopic, gradeLevel: '10', subject: 'Matematika', topic: 'Fungsi', subtopicOrder: order });
    }
    assert.equal(db.tables.cbt_learning_materials.length, 2);
    assert.ok(db.tables.cbt_learning_materials.every(row => row.topic === 'Fungsi'));
    // Defaults are normally populated by PostgreSQL.
    const row = db.tables.cbt_learning_materials[1];
    Object.assign(row, { revision: 1, content_version: 1, status: 'draft', format: 'html', content_html: '', file_key: null });
    const dto = { revision: 1, title: row.title, description: '', subject: row.subject, gradeLevel: '10', topic: 'Fungsi', subtopic: 'Daerah asal', status: 'draft', format: 'html', contentHtml: '<h1>Daerah asal</h1>', conversionNotes: '', subtopicOrder: 2 };
    await service.update(author, 'school', 'two', dto);
    assert.equal(row.subtopic_order, 2);
    await service.upload(author, 'school', 'two', { originalname: 'daerah-asal.html', size: 4, buffer: Buffer.from('test') }, 2, { ...dto, revision: 2 });
    assert.equal(row.subtopic_order, 2);
    assert.equal(row.topic, 'Fungsi');
    assert.equal(db.tables.cbt_learning_materials[0].subtopic, 'Definisi fungsi');
});

test('order validation rejects fractional, negative, and oversized subchapter positions', async () => {
    for (const order of [-1, 1.5, 10000]) {
        const dto = Object.assign(new CreateMaterialDto(), { id: '00000000-0000-4000-8000-000000000001', title: 'Test', subtopicOrder: order });
        assert.ok((await validate(dto)).some(error => error.property === 'subtopicOrder'));
    }
});
