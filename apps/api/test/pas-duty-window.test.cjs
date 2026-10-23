const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });
const { fixtureDb } = require('./fixture-db.cjs');
const { createFixtures, signingInput } = require('./pas-administration-fixtures.cjs');
const { AuthorizationService } = require('../src/auth/authorization.service.ts');
const { PasAdministrationService } = require('../src/pas/pas-administration.service.ts');
const { pasDutyAllowed, localSchoolDate, shiftPasDate } = require('../src/common/pas-duty-window.ts');
const { hasPasInvigilationAssignment, assignedPasExamIds } = require('../src/common/pas-monitoring-access.ts');

const DUTY = '2026-10-17';
const at = (date, hour = '01:00') => `${date}T${hour}:00Z`;

test('duty windows: monitoring on the day only, administration H-1..H+3 (write from H), workspace until H+3', () => {
    const rows = [
        ['2026-10-15', [false, false, false, true]],
        ['2026-10-16', [false, true, false, true]],
        ['2026-10-17', [true, true, true, true]],
        ['2026-10-20', [false, true, true, true]],
        ['2026-10-21', [false, false, false, false]],
    ];
    for (const [today, expected] of rows) {
        assert.deepEqual(['monitoring', 'administration_view', 'administration_write', 'workspace']
            .map(window => pasDutyAllowed(DUTY, today, window)), expected, today);
    }
    assert.equal(pasDutyAllowed('', DUTY, 'workspace'), false);
    assert.equal(shiftPasDate('2026-12-31', 1), '2027-01-01');
    // The school's calendar day, not UTC or the server's: 16:30Z is past midnight in WITA but not in WIB.
    assert.equal(localSchoolDate(new Date('2026-10-16T16:30:00Z'), 'Asia/Makassar'), '2026-10-17');
    assert.equal(localSchoolDate(new Date('2026-10-16T16:30:00Z'), 'Asia/Jakarta'), '2026-10-16');
});

function rosterDb(now) {
    return fixtureDb({
        cbt_pas_periods: [{ id: 'p', organization_id: 'school' }],
        cbt_pas_rooms: [{ id: 'room', name: 'Lab', pas_period_id: 'p' }],
        cbt_pas_sessions: [{ id: 's', pas_period_id: 'p', name: 'Pagi' }],
        cbt_pas_room_invigilators: [{ pas_room_id: 'room', session_id: 's', user_id: 'guard', exam_date: DUTY }],
        cbt_pas_class_schedules: [{ exam_id: 'pas', pas_period_id: 'p', session_id: 's', scheduled_date: DUTY, room: 'Lab' }],
        cbt_pas_room_students: [{ pas_room_id: 'room', pas_period_id: 'p', user_id: 'u1' }],
        cbt_exam_targets: [], cbt_exam_participants: [{ exam_id: 'pas', user_id: 'u1' }],
        cbt_class_members: [], cbt_additional_class_members: [],
    }, [], { now });
}

test('room monitoring opens on the duty day only (Asia/Jakarta default)', async () => {
    assert.deepEqual(await assignedPasExamIds(rosterDb(at('2026-10-16')), 'guard', 'school'), []);
    assert.deepEqual(await assignedPasExamIds(rosterDb(at(DUTY)), 'guard', 'school'), ['pas']);
    assert.deepEqual(await assignedPasExamIds(rosterDb(at('2026-10-18')), 'guard', 'school'), []);
    // Late in the duty day (23:00 WIB) is still the duty day.
    assert.deepEqual(await assignedPasExamIds(rosterDb('2026-10-17T16:00:00Z'), 'guard', 'school'), ['pas']);
});

test('the Pengawas workspace (menu) exists for upcoming and recent duties, then disappears', async () => {
    assert.equal(await hasPasInvigilationAssignment(rosterDb(at('2026-10-01')), 'guard', 'school'), true);
    assert.equal(await hasPasInvigilationAssignment(rosterDb(at('2026-10-20')), 'guard', 'school'), true);
    assert.equal(await hasPasInvigilationAssignment(rosterDb(at('2026-10-21')), 'guard', 'school'), false);
});

function adminFixture(now) {
    const db = fixtureDb(createFixtures(), [], { now });
    const roleByUser = { 'proctor-creator-1': 'Proktor', 'pengawas-1': 'Pengawas' };
    const roles = { hasOrgRole: async (user, org, allowed) => org === 'org-1' && allowed.includes(roleByUser[user]) };
    const auth = new AuthorizationService(db, roles, { assertSchoolId: async id => id });
    return new PasAdministrationService(db, auth);
}
const guard = { id: 'pengawas-1' }, manager = { id: 'proctor-creator-1' };
const params = { periodId: 'period-1', roomId: 'room-1', sessionId: 'session-1', examDate: DUTY };

test('berita acara: view from H-1, save from H through H+3; Proktor is never limited', async () => {
    await assert.rejects(adminFixture(at('2026-10-15')).getAdministrationSlot(guard, params), /sehari sebelum hari tugas/);

    const dayBefore = adminFixture(at('2026-10-16'));
    assert.equal((await dayBefore.getAdministrationSlot(guard, params)).room.id, 'room-1');
    await assert.rejects(dayBefore.saveAdministrationSlot(guard, { ...signingInput(), action: 'save_draft' }), /hanya dapat diisi pada hari tugas/);

    const lastDay = adminFixture(at('2026-10-20'));
    const draft = await lastDay.saveAdministrationSlot(guard, { ...signingInput(), action: 'save_draft' });
    assert.ok(draft.report);

    const afterGrace = adminFixture(at('2026-10-21'));
    await assert.rejects(afterGrace.getAdministrationSlot(guard, params), /3 hari sesudahnya/);
    assert.equal((await afterGrace.getAdministrationSlot(manager, params)).room.id, 'room-1');

    // listMyAssignments reads joined rows (not supported by the fixture); its window uses the same policy.
    const source = fs.readFileSync(path.resolve(__dirname, '../src/pas/pas-administration.service.ts'), 'utf8');
    assert.match(source, /scheduledDates\.filter\(\(date\) => pasDutyAllowed\(date, today, 'administration_view'\)\)/);
});

test('invigilator pages explain the duty-day window instead of offering closed dates', () => {
    const page = fs.readFileSync(path.resolve(__dirname, '../../web/app/dashboard/pengawas/administration/page.tsx'), 'utf8');
    assert.match(page, /item\.open_dates\?\.length \? item\.open_dates : item\.scheduled_dates/);
    const slots = fs.readFileSync(path.resolve(__dirname, '../../web/app/components/monitoring/PASSlotMonitoring.tsx'), 'utf8');
    assert.match(slots, /hanya terbuka pada hari tugas Anda/);
});
