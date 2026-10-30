// Run from repository root: node apps/api/test/exam-deletion-stage31.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });

const { fixtureDb } = require('./fixture-db.cjs');
const { ExamsService } = require('../src/exams/exams.service.ts');
const { PasSchedulesService } = require('../src/pas/pas-schedules.service.ts');
const { PasService } = require('../src/pas/pas.service.ts');
const { ExamConfigsService } = require('../src/exam-configs/exam-configs.service.ts');

const user = { id: 'proctor-1', isPlatformAdmin: false };
const authz = {
    assertResourceOwner: async () => {},
    assertExamStaff: async () => {},
    assertProktorByRecord: async () => {},
    assertPasPeriodManage: async () => {},
    assertProktorByParent: async () => {},
};

function baseTables() {
    return {
        cbt_exams: [{ id: 'exam-1', organization_id: 'school-1' }],
        cbt_exam_attempts: [],
        cbt_certificates: [],
        cbt_pas_periods: [{ id: 'period-1', organization_id: 'school-1', is_locked: false }],
        cbt_pas_class_schedules: [{
            id: 'pas-schedule-1', pas_period_id: 'period-1', exam_id: 'exam-1', status: 'scheduled',
        }],
        exam_configs: [{ id: 'config-1', organization_id: 'school-1', is_locked: false }],
        exam_config_banks: [{ id: 'config-bank-1', exam_config_id: 'config-1' }],
        exam_config_exams: [{
            id: 'config-schedule-1', exam_config_id: 'config-1',
            exam_config_bank_id: 'config-bank-1', exam_id: 'exam-1',
        }],
    };
}

test('DEL-01: hapus ujian langsung ditolak bila sudah mempunyai attempt', async () => {
    const data = baseTables();
    data.cbt_exam_attempts.push({ id: 'attempt-1', exam_id: 'exam-1', user_id: 'student-1' });
    const db = fixtureDb(data);
    const service = new ExamsService(db, authz);

    await assert.rejects(service.remove(user, 'exam-1'), /pengerjaan siswa/i);
    assert.equal(db.tables.cbt_exams.length, 1);
    assert.equal(db.tables.cbt_exam_attempts.length, 1);
    assert.equal(db.tables.cbt_pas_class_schedules[0].exam_id, 'exam-1');
});

test('DEL-02: kegagalan hapus ujian langsung mengembalikan tautan PAS', async () => {
    const db = fixtureDb(baseTables(), [], {
        failMutation: { table: 'cbt_exams', mutation: 'delete' },
    });
    const service = new ExamsService(db, authz);

    await assert.rejects(service.remove(user, 'exam-1'), /gagal menghapus ujian/i);
    assert.equal(db.tables.cbt_exams.length, 1);
    assert.equal(db.tables.cbt_pas_class_schedules[0].exam_id, 'exam-1');
});

test('DEL-03: jadwal PAS dengan riwayat tidak dapat menghapus ujian siswa', async () => {
    const data = baseTables();
    data.cbt_exam_attempts.push({ id: 'attempt-1', exam_id: 'exam-1', user_id: 'student-1' });
    const db = fixtureDb(data);
    const service = new PasSchedulesService(db, authz);

    await assert.rejects(service.removeSchedule(user, 'pas-schedule-1'), /pengerjaan siswa/i);
    assert.equal(db.tables.cbt_pas_class_schedules.length, 1);
    assert.equal(db.tables.cbt_exams.length, 1);
});

test('DEL-04: kegagalan hapus ujian PAS memulihkan jadwal yang sudah dihapus', async () => {
    const db = fixtureDb(baseTables(), [], {
        failMutation: { table: 'cbt_exams', mutation: 'delete' },
    });
    const service = new PasSchedulesService(db, authz);

    await assert.rejects(service.removeSchedule(user, 'pas-schedule-1'), /gagal menghapus ujian/i);
    assert.equal(db.tables.cbt_pas_class_schedules.length, 1);
    assert.equal(db.tables.cbt_exams.length, 1);
});

test('DEL-05: periode PAS dan seluruh ujian rollback bila satu delete gagal', async () => {
    const db = fixtureDb(baseTables(), [], {
        failMutation: { table: 'cbt_exams', mutation: 'delete' },
    });
    const service = new PasService(db, authz);

    await assert.rejects(service.removePeriod(user, 'period-1'), /gagal menghapus ujian periode/i);
    assert.equal(db.tables.cbt_pas_periods.length, 1);
    assert.equal(db.tables.cbt_exams.length, 1);
});

test('DEL-06: jadwal konfigurasi bersejarah ditolak dan kegagalan delete rollback', async () => {
    const historical = baseTables();
    historical.cbt_exam_attempts.push({ id: 'attempt-1', exam_id: 'exam-1', user_id: 'student-1' });
    let db = fixtureDb(historical);
    let service = new ExamConfigsService(db, authz);
    await assert.rejects(service.removeSchedule(user, 'config-schedule-1'), /pengerjaan siswa/i);
    assert.equal(db.tables.exam_config_exams.length, 1);

    db = fixtureDb(baseTables(), [], {
        failMutation: { table: 'exam_config_exams', mutation: 'delete' },
    });
    service = new ExamConfigsService(db, authz);
    await assert.rejects(service.removeSchedule(user, 'config-schedule-1'), /gagal menghapus jadwal/i);
    assert.equal(db.tables.cbt_exams.length, 1);
    assert.equal(db.tables.exam_config_exams.length, 1);
});

test('DEL-07: kegagalan hapus konfigurasi mengembalikan ujian', async () => {
    const db = fixtureDb(baseTables(), [], {
        failMutation: { table: 'exam_configs', mutation: 'delete' },
    });
    const service = new ExamConfigsService(db, authz);

    await assert.rejects(service.remove(user, 'config-1'), /gagal menghapus konfigurasi/i);
    assert.equal(db.tables.exam_configs.length, 1);
    assert.equal(db.tables.cbt_exams.length, 1);
});

test('DEL-08: delete dan generate memakai lock induk serta lock sumber yang sama', () => {
    const deletion = fs.readFileSync(path.resolve(__dirname, '../src/common/exam-deletion.ts'), 'utf8');
    const exams = fs.readFileSync(path.resolve(__dirname, '../src/exams/exams.service.ts'), 'utf8');
    const pas = fs.readFileSync(path.resolve(__dirname, '../src/pas/pas-schedules.service.ts'), 'utf8');
    const periods = fs.readFileSync(path.resolve(__dirname, '../src/pas/pas.service.ts'), 'utf8');
    const config = fs.readFileSync(path.resolve(__dirname, '../src/exam-configs/exam-configs.service.ts'), 'utf8');
    assert.match(deletion, /FOR UPDATE/);
    assert.match(deletion, /cbt_exam_attempts/);
    assert.match(deletion, /cbt_certificates/);
    assert.match(exams, /this\.db\.transaction/);
    assert.match(pas, /pas-period:/);
    assert.match(periods, /pas-exam-generation:/);
    assert.match(config, /exam-config:/);
    assert.match(config, /config-exam-generation:/);
});

test('DEL-09: UI tidak lagi menjanjikan penghapusan hasil dan menampilkan kegagalan', () => {
    const deleteModal = fs.readFileSync(
        path.resolve(__dirname, '../../web/components/exams/DeleteExamModal.tsx'),
        'utf8',
    );
    for (const role of ['admin', 'guru', 'proktor']) {
        const ui = fs.readFileSync(
            path.resolve(__dirname, `../../web/app/dashboard/${role}/exams/page.tsx`),
            'utf8',
        );
        assert.doesNotMatch(ui, /Semua data pengerjaan akan ikut terhapus/);
        assert.match(ui, /DeleteExamModal/);
    }
    assert.match(deleteModal, /hanya dapat dihapus jika belum pernah dikerjakan siswa/);
    assert.match(deleteModal, /setError\(result\.error \|\| 'Ujian gagal dihapus\.'\)/);
    assert.match(deleteModal, /setError\(purge\.error \|\| 'Data uji coba gagal dihapus\.'\)/);
});

test('DEL-10: purge uji coba wajib tidak dipublikasikan dan judul harus sama', async () => {
    const data = baseTables();
    data.cbt_exams[0].title = 'Simulasi Kelas IX';
    data.cbt_exams[0].is_published = true;
    const db = fixtureDb(data);
    const service = new ExamsService(db, authz);

    await assert.rejects(
        service.purgeTrial(user, 'exam-1', 'Simulasi Kelas IX'),
        /batalkan publikasi/i,
    );
    db.tables.cbt_exams[0].is_published = false;
    await assert.rejects(
        service.purgeTrial(user, 'exam-1', 'Judul Salah'),
        /judul konfirmasi/i,
    );
    assert.equal(db.tables.cbt_exams.length, 1);
});

test('DEL-11: purge eksplisit menghapus hasil uji coba secara atomik', async () => {
    const data = baseTables();
    Object.assign(data.cbt_exams[0], { title: 'Simulasi Kelas IX', is_published: false });
    data.cbt_exam_attempts.push({ id: 'attempt-1', exam_id: 'exam-1', user_id: 'student-1' });
    data.cbt_answers = [{ id: 'answer-1', attempt_id: 'attempt-1' }];
    data.cbt_attempt_security_logs = [{ id: 'log-1', attempt_id: 'attempt-1' }];
    data.cbt_proctoring_snapshots = [];
    data.cbt_exam_attempt_questions = [];
    data.cbt_certificates.push({ id: 'certificate-1', exam_id: 'exam-1' });
    const db = fixtureDb(data);
    const service = new ExamsService(db, authz);

    const result = await service.purgeTrial(user, 'exam-1', 'Simulasi Kelas IX');
    assert.deepEqual(result, { id: 'exam-1', purgedAttempts: 1 });
    assert.equal(db.tables.cbt_exams.length, 0);
    assert.equal(db.tables.cbt_exam_attempts.length, 0);
    assert.equal(db.tables.cbt_answers.length, 0);
    assert.equal(db.tables.cbt_certificates.length, 0);
    assert.equal(db.tables.cbt_pas_class_schedules[0].exam_id, null);
});

test('DEL-12: kegagalan akhir purge mengembalikan seluruh hasil uji coba', async () => {
    const data = baseTables();
    Object.assign(data.cbt_exams[0], { title: 'Simulasi', is_published: false });
    data.cbt_exam_attempts.push({ id: 'attempt-1', exam_id: 'exam-1', user_id: 'student-1' });
    data.cbt_answers = [{ id: 'answer-1', attempt_id: 'attempt-1' }];
    const db = fixtureDb(data, [], {
        failMutation: { table: 'cbt_exams', mutation: 'delete' },
    });
    const service = new ExamsService(db, authz);

    await assert.rejects(service.purgeTrial(user, 'exam-1', 'Simulasi'), /gagal menghapus ujian uji coba/i);
    assert.equal(db.tables.cbt_exams.length, 1);
    assert.equal(db.tables.cbt_exam_attempts.length, 1);
    assert.equal(db.tables.cbt_answers.length, 1);
    assert.equal(db.tables.cbt_pas_class_schedules[0].exam_id, 'exam-1');
});

test('DEL-13: purge hanya tersedia untuk Admin/Proktor dan UI memakai konfirmasi judul', () => {
    const controller = fs.readFileSync(path.resolve(__dirname, '../src/exams/exams.controller.ts'), 'utf8');
    const admin = fs.readFileSync(path.resolve(__dirname, '../../web/app/dashboard/admin/exams/page.tsx'), 'utf8');
    const proctor = fs.readFileSync(path.resolve(__dirname, '../../web/app/dashboard/proktor/exams/page.tsx'), 'utf8');
    const deleteModal = fs.readFileSync(path.resolve(__dirname, '../../web/components/exams/DeleteExamModal.tsx'), 'utf8');
    assert.match(controller, /@Roles\('ADMIN', 'PROKTOR'\)/);
    assert.match(controller, /purge-trial/);
    for (const ui of [admin, proctor]) {
        assert.match(ui, /DeleteExamModal/);
    }
    assert.match(deleteModal, /purgeTrialExam/);
    assert.match(deleteModal, /ketik judul berikut/);
    assert.match(deleteModal, /Batalkan publikasi ujian terlebih dahulu/);
});
