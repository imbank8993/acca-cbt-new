const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });
const { fixtureDb } = require('./fixture-db.cjs');
const { createFixtures, signingInput } = require('./pas-administration-fixtures.cjs');
const { AuthorizationService } = require('../src/auth/authorization.service.ts');
const { PasAdministrationService, buildVerificationCodePair } = require('../src/pas/pas-administration.service.ts');
const { PasSchedulesService } = require('../src/pas/pas-schedules.service.ts');
const { PasService } = require('../src/pas/pas.service.ts');
const { PasRoomsService } = require('../src/pas/pas-rooms.service.ts');

function fixture(type = 'pas') {
    const db = fixtureDb(createFixtures());
    db.tables.cbt_pas_periods[0].type = type;
    db.tables.cbt_profiles.push({ id: 'other-proctor', full_name: 'Proktor Pemberi ACC', nis: '2345' });
    const roleByUser = { 'proctor-creator-1': 'Proktor', 'other-proctor': 'Proktor', 'pengawas-1': 'Pengawas', 'unassigned-guard': 'Pengawas', student: 'Siswa' };
    const roles = { hasOrgRole: async (user, org, allowed) => org === 'org-1' && allowed.includes(roleByUser[user]) };
    const auth = new AuthorizationService(db, roles, { assertSchoolId: async id => {
        assert.equal(id, 'org-1'); return id;
    } });
    return { db, auth, admin: new PasAdministrationService(db, auth),
        schedules: new PasSchedulesService(db, auth, { getSchoolTimeZone: async () => 'Asia/Makassar' }),
        periods: new PasService(db, auth), rooms: new PasRoomsService(db, auth) };
}
const guard = { id: 'pengawas-1' }, manager = { id: 'proctor-creator-1' }, otherManager = { id: 'other-proctor' };
const params = { periodId: 'period-1', roomId: 'room-1', sessionId: 'session-1', examDate: '2026-10-17' };

for (const type of ['pas', 'pat', 'am']) {
    test(`${type}: private foreign bank is denied through schedule, generation, and activation`, async () => {
        const f = fixture(type);
        Object.assign(f.db.tables.cbt_question_banks[0], { created_by: 'teacher-owner', is_published: false });
        await assert.rejects(f.auth.assertBankAccess(manager, 'bank-math', 'read'), /bank soal/);
        await assert.rejects(f.schedules.addSchedule(manager, {
            clientRequestId: '00000000-0000-4000-8000-000000000123', pas_period_id: 'period-1', bank_id: 'bank-math',
            class_id: 'class-10a', session_id: 'session-1', scheduled_date: '2026-10-17', duration_override: 90,
        }), /bank soal/);
        f.db.tables.cbt_pas_class_schedules[0].exam_id = null;
        assert.equal((await f.schedules.generate(manager, ['sched-1'])).created, 0);
        await assert.rejects(f.schedules.setActivation(manager, 'sched-1', true), /bank soal/);
        assert.equal(f.db.writes.length, 0);
        for (const allowedBank of [{ created_by: manager.id, is_published: false }, { created_by: 'teacher-owner', is_published: true }]) {
            const permitted = fixture(type);
            Object.assign(permitted.db.tables.cbt_question_banks[0], allowedBank);
            permitted.db.tables.cbt_pas_class_schedules[0].exam_id = null;
            assert.equal((await permitted.schedules.generate(manager, ['sched-1'])).created, 1);
        }
    });

    test(`${type}: pure Pengawas role can administer only the assigned room/session`, async () => {
        const f = fixture(type);
        const slot = await f.admin.getAdministrationSlot(guard, params);
        assert.equal(slot.room.id, 'room-1');
        await f.admin.listMyAssignments(guard, 'org-1');
        await assert.rejects(f.admin.getAdministrationSlot(guard, { ...params, roomId: 'room-2' }), /tidak ditugaskan/);
        await assert.rejects(f.admin.getAdministrationSlot({ id: 'unassigned-guard' }, params), /tidak ditugaskan/);
        await assert.rejects(f.admin.getAdministrationSlot({ id: 'student' }, params), /izin/);
        await assert.rejects(f.admin.saveAdministrationSlot(guard, { ...signingInput(), action: 'approve' }), /izin/);
    });

    test(`${type}: only an intact approved document verifies, ACC preserves creator identity, rejection revokes verification`, async () => {
        const f = fixture(type);
        const draft = await f.admin.saveAdministrationSlot(guard, { ...signingInput(), action: 'save_draft' });
        const code = draft.report.verification_code;
        assert.equal((await f.admin.verifyDocumentByCode(code)).valid, false);
        await assert.rejects(f.admin.approveAdministrationSlot(otherManager, signingInput()), /harus dikirim/);
        await f.admin.saveAdministrationSlot(guard, { ...signingInput(), action: 'submit' });
        assert.equal((await f.admin.verifyDocumentByCode(code)).valid, false);
        const approved = await f.admin.approveAdministrationSlot(otherManager, signingInput());
        assert.equal(approved.report.proctor_id, manager.id);
        assert.equal(approved.report.approved_by, otherManager.id);
        const result = await f.admin.verifyDocumentByCode(code);
        assert.equal(result.valid, true);
        assert.equal(result.proctor_name, 'Budi Santoso, S.Kom.');
        for (const field of ['non_present_students', 'notes', 'incident_summary', 'signature_hash']) assert.equal(field in result, false);
        await assert.rejects(f.admin.saveAdministrationSlot(guard, signingInput()), /dikembalikan/);
        await f.admin.rejectAdministrationSlot(manager, signingInput());
        assert.equal((await f.admin.verifyDocumentByCode(code)).valid, false);
    });

    test(`${type}: every signed body field and individual attendance are hash-protected`, async () => {
        const f = fixture(type);
        const submitted = await f.admin.saveAdministrationSlot(guard, { ...signingInput(), notes: 'Catatan asli', incident_summary: 'Insiden asli' });
        await f.admin.approveAdministrationSlot(otherManager, signingInput());
        const report = f.db.tables.cbt_pas_administration_reports[0];
        const original = structuredClone(report);
        for (const mutate of [
            row => { row.notes = 'Catatan palsu'; },
            row => { row.document_snapshot.report.incident_summary = 'Insiden palsu'; },
            row => {
                const [a, b] = row.document_snapshot.students;
                [a.attendance_status, b.attendance_status] = [b.attendance_status, a.attendance_status];
            },
            row => { row.document_snapshot.students[0].remark = 'Keterangan palsu'; },
            row => { row.document_snapshot.period.name = 'Nama folder palsu'; },
        ]) {
            Object.assign(report, structuredClone(original)); mutate(report);
            assert.equal((await f.admin.verifyDocumentByCode(submitted.report.verification_code)).valid, false);
        }
        Object.assign(report, original);
        // Operational roster changes must not rewrite a previously signed document.
        f.db.tables.cbt_pas_room_students.pop();
        const historical = await f.admin.getAdministrationSlot(guard, params);
        assert.equal(historical.students.length, 3);
        assert.equal((await f.admin.verifyDocumentByCode(submitted.report.verification_code)).valid, true);
    });

    test(`${type}: all folder/room mutations respect period lock; rooms with administration history cannot be deleted`, async () => {
        const operations = [
            f => f.periods.updatePeriod(manager, 'period-1', { name: 'Diubah' }),
            f => f.periods.updateCommitteeChair(manager, 'period-1', { committee_chair_name: 'Diubah' }),
            f => f.rooms.createRoom(manager, 'period-1', { clientRequestId: '00000000-0000-4000-8000-000000000123', name: 'Baru', capacity: 30 }),
            f => f.rooms.removeRoom(manager, 'room-1'),
            f => f.rooms.assignInvigilators(manager, 'room-1', [], 'session-1'),
            f => f.rooms.assignStudents(manager, 'period-1', 'room-1', ['student-1']),
            f => f.rooms.removeStudent(manager, 'period-1', 'student-1'),
            f => f.admin.saveAdministrationSlot(guard, signingInput()),
        ];
        for (const run of operations) {
            const f = fixture(type); f.db.tables.cbt_pas_periods[0].is_locked = true;
            await assert.rejects(run(f), /dikunci/); assert.equal(f.db.writes.length, 0);
        }
        const f = fixture(type);
        await f.admin.saveAdministrationSlot(guard, signingInput());
        await assert.rejects(f.rooms.removeRoom(manager, 'room-1'), /riwayat administrasi/);
        assert.ok(f.db.tables.cbt_pas_rooms.find(room => room.id === 'room-1'));
    });

    test(`${type}: invalid dates, excluding existing schedules, and changing generated exam identity are rejected`, async () => {
        const f = fixture(type);
        for (const update of [
            { start_date: '2026-11-30', end_date: '2026-10-01' },
            { start_date: '2026-02-30' }, { end_date: 'not-a-date' },
            { start_date: '2026-10-18' }, { end_date: '2026-10-16' },
            { name: 'Berubah setelah generate' }, { type: type === 'am' ? 'pas' : 'am' },
        ]) await assert.rejects(f.periods.updatePeriod(manager, 'period-1', update));
        assert.equal(f.db.writes.length, 0);
        await f.periods.updatePeriod(manager, 'period-1', { start_date: '2026-10-01', end_date: '2026-10-31' });
        assert.equal(f.db.tables.cbt_pas_periods[0].start_date, '2026-10-01');
    });
}

test('verification tokens cannot be derived from room/session IDs and do not repeat', () => {
    const first = buildVerificationCodePair('p', 'r', 's', '2026-10-17');
    const second = buildVerificationCodePair('p', 'r', 's', '2026-10-17');
    assert.notEqual(first.beritaAcaraCode, second.beritaAcaraCode);
    assert.match(first.beritaAcaraCode, /^BA-PAS-20261017-[A-F0-9]{32}$/);
});
