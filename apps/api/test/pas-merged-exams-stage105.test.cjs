const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });
const { fixtureDb } = require('./fixture-db.cjs');
const { PasSchedulesService } = require('../src/pas/pas-schedules.service.ts');
const { loadPasReadiness } = require('../src/pas/pas-readiness.ts');

const user = { id: 'proktor' };
const authz = { assertProktorByParent: async () => {}, assertProktorByRecord: async () => {}, assertBankAccess: async () => {} };
const DAY = '2026-10-05';
const schedule = (id, classId, sessionId = 's1', extra = {}) => ({
    id, pas_period_id: 'p1', bank_id: 'bank-1', class_id: classId, subject_id: null, exam_id: null, session_id: sessionId,
    scheduled_date: DAY, scheduled_time: sessionId === 's1' ? '07:30' : '10:00', window_end_time: sessionId === 's1' ? '09:30' : '12:00',
    duration_minutes: 90, room: null, status: 'scheduled', ...extra,
});

function fixture(schedules = [schedule('sA', 'cA'), schedule('sB', 'cB')], extra = {}) {
    const db = fixtureDb({
        cbt_pas_periods: [{ id: 'p1', organization_id: 'school', name: 'ASAS Ganjil', type: 'pas', school_year: '2026/2027', semester: 'ganjil',
            is_locked: false, screenshot_enabled: false, exam_settings: { defaults: { scoring: 'irt_2pl', show_results: true } },
            start_date: '2026-10-01', end_date: '2026-10-31' }],
        cbt_pas_sessions: [{ id: 's1', pas_period_id: 'p1', start_time: '07:30', end_time: '09:30' }, { id: 's2', pas_period_id: 'p1', start_time: '10:00', end_time: '12:00' }],
        cbt_classes: [{ id: 'cA', organization_id: 'school', name: 'X A' }, { id: 'cB', organization_id: 'school', name: 'X B' }],
        cbt_class_members: [['cA', 'a1'], ['cA', 'a2'], ['cB', 'b1'], ['cB', 'b2']].map(([class_id, user_id]) => ({ class_id, user_id })),
        cbt_pas_rooms: [{ id: 'r1', pas_period_id: 'p1', name: 'Ruang 1', capacity: 10 }],
        cbt_pas_room_students: ['a1', 'a2', 'b1', 'b2'].map(user_id => ({ user_id, pas_period_id: 'p1', pas_room_id: 'r1' })),
        cbt_pas_room_invigilators: ['s1', 's2'].map(session_id => ({ user_id: 'g', pas_room_id: 'r1', session_id, exam_date: DAY })),
        cbt_question_banks: [{ id: 'bank-1', organization_id: 'school', title: 'Matematika' }],
        cbt_bank_questions: [{ bank_id: 'bank-1', metadata: {} }],
        cbt_pas_class_schedules: schedules,
        cbt_exams: [], cbt_exam_targets: [], cbt_exam_attempts: [], cbt_certificates: [],
        ...extra,
    });
    return { db, service: new PasSchedulesService(db, authz, { getSchoolTimeZone: async () => 'Asia/Makassar' }) };
}
const readiness = async db => loadPasReadiness(db, db.tables.cbt_pas_periods[0], db.tables.cbt_pas_class_schedules);

test('MERGE-01: kelas dengan bank, tanggal, dan sesi yang sama berbagi satu ujian; nilai IRT dari pengaturan folder', async () => {
    const { db, service } = fixture();
    assert.deepEqual(await service.generate(user, ['sA', 'sB']), { created: 2, skipped: [] });
    assert.equal(db.tables.cbt_exams.length, 1);
    const [exam] = db.tables.cbt_exams;
    assert.deepEqual(db.tables.cbt_pas_class_schedules.map(row => row.exam_id), [exam.id, exam.id]);
    assert.match(exam.description, /^Matematika • Kelas X A, X B \| 2026\/2027/);
    assert.equal(exam.scoring_type, 'classical,irt_2pl');
    assert.equal(exam.metadata.student_score_type, 'irt_2pl');
    assert.equal(exam.show_results, true);
    assert.equal(exam.is_published, false);
    assert.deepEqual(db.tables.cbt_exam_targets, [], 'belum ada kelas yang diaktifkan');
});

test('MERGE-02: aktivasi per kelas tetap berlaku di ujian gabungan', async () => {
    const { db, service } = fixture();
    await service.generate(user, ['sA', 'sB']);
    await service.setActivation(user, 'sA', true);
    const exam = db.tables.cbt_exams[0];
    assert.equal(exam.is_published, true);
    assert.deepEqual(db.tables.cbt_exam_targets.map(row => row.class_id), ['cA']);
    let state = await readiness(db);
    assert.equal(state.get('sA').activated, true);
    assert.equal(state.get('sB').activated, false);
    assert.equal(state.get('sB').ready, true, state.get('sB').issues.join('; '));

    await service.setActivation(user, 'sB', true);
    db.tables.cbt_exam_attempts.push({ id: 'att', exam_id: exam.id, user_id: 'b1', status: 'in_progress' });
    await assert.rejects(service.setActivation(user, 'sB', false), /kelas ini sedang mengerjakan/);
    await service.setActivation(user, 'sA', false);
    // Transaksi yang ditolak memulihkan tabel dari salinan: baca ulang barisnya.
    assert.deepEqual(db.tables.cbt_exam_targets.map(row => row.class_id), ['cB']);
    assert.equal(db.tables.cbt_exams[0].is_published, true, 'kelas lain tetap dapat mengerjakan');
    db.tables.cbt_exam_attempts = [];
    await service.setActivation(user, 'sB', false);
    assert.equal(db.tables.cbt_exams[0].is_published, false, 'ujian ditutup bila tidak ada kelas aktif');
    state = await readiness(db);
    assert.equal(state.get('sB').activated, false);
});

test('MERGE-03: sesi berbeda tetap ujian terpisah', async () => {
    const { db, service } = fixture([schedule('sA', 'cA', 's1'), schedule('sB', 'cB', 's2')]);
    await service.generate(user, ['sA', 'sB']);
    assert.equal(db.tables.cbt_exams.length, 2);
});

test('MERGE-04: menghapus jadwal satu kelas tidak menghapus ujian kelas lain', async () => {
    const { db, service } = fixture();
    await service.generate(user, ['sA', 'sB']);
    await service.setActivation(user, 'sA', true);
    await service.setActivation(user, 'sB', true);
    const exam = db.tables.cbt_exams[0];
    db.tables.cbt_exam_attempts.push({ id: 'att', exam_id: exam.id, user_id: 'a1', status: 'submitted' });
    await assert.rejects(service.removeSchedule(user, 'sA'), /sudah mengerjakan/);
    await service.removeSchedule(user, 'sB');
    assert.equal(db.tables.cbt_exams.length, 1);
    assert.deepEqual(db.tables.cbt_pas_class_schedules.map(row => row.id), ['sA']);
    assert.deepEqual(db.tables.cbt_exam_targets.map(row => row.class_id), ['cA']);
    assert.match(db.tables.cbt_exams[0].description, /Kelas X A \|/);
});

test('MERGE-05: ujian per kelas lama tanpa riwayat digabung; kelas aktif tetap aktif', async () => {
    const legacy = (id, classId, published) => ({ id, organization_id: 'school', title: 'ASAS Ganjil', question_bank_id: 'bank-1', status: 'scheduled',
        is_published: published, description: `Matematika • Kelas ${classId === 'cA' ? 'X A' : 'X B'} | 2026/2027 | PAS ganjil`,
        show_results: false, randomize_questions: true, randomize_options: true, scoring_type: 'classical', metadata: { is_pas_exam: true, bank_title: 'Matematika' } });
    const { db, service } = fixture([schedule('sA', 'cA', 's1', { exam_id: 'eA' }), schedule('sB', 'cB', 's1', { exam_id: 'eB' })], {
        cbt_exams: [legacy('eA', 'cA', true), legacy('eB', 'cB', false)],
        cbt_exam_targets: [{ exam_id: 'eA', class_id: 'cA' }, { exam_id: 'eB', class_id: 'cB' }],
    });
    const result = await service.mergeExams(user, 'p1');
    assert.deepEqual(result, { merged: 1, groups: 1, kept_separate: [] });
    assert.deepEqual(db.tables.cbt_exams.map(exam => exam.id), ['eA']);
    assert.deepEqual(db.tables.cbt_pas_class_schedules.map(row => row.exam_id), ['eA', 'eA']);
    assert.deepEqual(db.tables.cbt_exam_targets, [{ exam_id: 'eA', class_id: 'cA' }], 'X B belum aktif sehingga belum menjadi target');
    assert.equal(db.tables.cbt_exams[0].is_published, true);
    assert.match(db.tables.cbt_exams[0].description, /Kelas X A, X B/);
});

test('MERGE-06: ujian yang sudah dikerjakan tidak dilebur', async () => {
    const legacy = id => ({ id, organization_id: 'school', question_bank_id: 'bank-1', status: 'scheduled', is_published: true,
        description: `Matematika • Kelas ${id} | 2026/2027`, metadata: {} });
    const { db, service } = fixture([schedule('sA', 'cA', 's1', { exam_id: 'eA' }), schedule('sB', 'cB', 's1', { exam_id: 'eB' })], {
        cbt_exams: [legacy('eA'), legacy('eB')],
        cbt_exam_targets: [{ exam_id: 'eA', class_id: 'cA' }, { exam_id: 'eB', class_id: 'cB' }],
        cbt_exam_attempts: [{ id: 'x', exam_id: 'eA', user_id: 'a1' }, { id: 'y', exam_id: 'eB', user_id: 'b1' }],
    });
    const result = await service.mergeExams(user, 'p1');
    assert.equal(result.merged, 0);
    assert.deepEqual(result.kept_separate, ['Matematika • Kelas eB']);
    assert.equal(db.tables.cbt_exams.length, 2);
});
