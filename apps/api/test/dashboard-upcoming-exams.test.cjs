const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });
const { fixtureDb } = require('./fixture-db.cjs');
const { ProctorService } = require('../src/proctor/proctor.service.ts');
const { TeachersService } = require('../src/teachers/teachers.service.ts');

for (const [label, Service, method] of [
    ['admin/proctor', ProctorService, 'getStats'],
    ['teacher', TeachersService, 'stats'],
]) {
    test(`${label}: upcoming excludes drafts, past schedules and finished exams`, async () => {
        const future = '2099-07-31T19:30:00+08:00';
        const past = '2020-07-31T19:30:00+08:00';
        const cases = [
            [{ start_time: future }, 1],
            [{ start_time: future, is_published: false, status: 'draft' }, 0],
            [{ start_time: past, is_published: false, status: 'draft' }, 0],
            [{ start_time: future, status: 'draft' }, 0],
            [{ start_time: past, end_time: past }, 0],
            [{ start_time: past, end_time: future }, 0],
            [{ start_time: future, end_time: past }, 0],
            [{ start_time: future, status: 'finished' }, 0],
            [{ start_time: null }, 0],
            [{ start_time: 'invalid' }, 0],
            [{ start_time: future, organization_id: 'other' }, 0],
        ];
        for (const [overrides, expected] of cases) {
            const db = fixtureDb({ cbt_exams: [{
                organization_id: 'school', created_by: 'teacher',
                is_published: true, status: 'active', end_time: null,
                exam_type: 'quiz', ...overrides,
            }] });
            const service = new Service(db, {
                assertOrgMonitoring: async () => {}, assertOrgStaff: async () => {},
                isRestrictedProctor: async () => false,
            });
            const result = await service[method]({ id: 'teacher' }, 'school');
            assert.equal(result.draftExams, expected, JSON.stringify(overrides));
            assert.equal(db.writes.length, 0);
        }
    });
}
