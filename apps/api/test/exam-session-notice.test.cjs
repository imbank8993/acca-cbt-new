const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });
const { examSessionNotice, examSessionNoticeText, formatSchoolClock } = require('../../web/lib/exam-session-notice.ts');

const NOW = Date.parse('2026-11-18T02:00:00Z');
const until = '2026-11-18T02:45:00Z';
const tz = 'Asia/Makassar';

test('the student sees the proctor action that actually happened, never "pemulihan" for makeup or extra time', () => {
    assert.equal(examSessionNotice({ proctor_recovery_until: until, makeup_activated_at: '2026-11-18T01:59:00Z' }, NOW).kind, 'makeup');
    assert.deepEqual(examSessionNotice({ proctor_recovery_until: until, time_extended_at: '2026-11-18T01:58:00Z', time_extended_minutes: 10 }, NOW),
        { kind: 'extended', until, minutes: 10 });
    assert.equal(examSessionNotice({ proctor_recovery_until: until, active_reset_at: '2026-11-18T01:50:00Z' }, NOW).kind, 'resumed');
    assert.equal(examSessionNotice({ proctor_recovery_until: until, resume_activated_at: '2026-11-18T01:50:00Z' }, NOW).kind, 'resumed');
    assert.equal(examSessionNotice({ proctor_recovery_until: until, recovery_submit_only: true }, NOW).kind, 'submit');
    // Tindakan TERAKHIR yang menentukan: susulan lalu tambah waktu → tambah waktu.
    assert.equal(examSessionNotice({ proctor_recovery_until: until, makeup_activated_at: '2026-11-18T01:00:00Z',
        time_extended_at: '2026-11-18T01:30:00Z', time_extended_minutes: 5 }, NOW).kind, 'extended');
    // Batas yang sudah lewat atau tidak ada: tidak ada pesan.
    assert.equal(examSessionNotice({ proctor_recovery_until: '2026-11-18T01:00:00Z', makeup_activated_at: '2026-11-18T00:59:00Z' }, NOW), null);
    assert.equal(examSessionNotice({}, NOW), null);
});

test('notice texts are calm, use school time, and carry no technical answer counts', () => {
    assert.equal(formatSchoolClock(until, tz, 'WITA'), '10.45 WITA');
    const texts = ['makeup', 'extended', 'resumed', 'submit'].map(kind => examSessionNoticeText({ kind, until, minutes: 10 }, tz, 'WITA'));
    assert.equal(texts[0].text, 'Ujian susulan dimulai');
    assert.equal(texts[1].text, 'Waktu ditambah 10 menit');
    assert.equal(texts[2].text, 'Ujian dibuka kembali oleh pengawas');
    assert.equal(texts[3].text, 'Mengirim jawaban dari perangkat ini');
    for (const { text, details } of texts) {
        assert.match(details, /10\.45 WITA/);
        assert.doesNotMatch(`${text} ${details}`, /Lokal:|Server:|pemulihan pengumpulan/i);
    }
});

test('extend marks the attempt so the student sees "Waktu ditambah", and screens avoid alarming wording', async () => {
    const { fixtureDb } = require('./fixture-db.cjs');
    const { ProctoringService } = require('../src/proctoring/proctoring.service.ts');
    const db = fixtureDb({
        cbt_exams: [{ id: 'exam', end_time: '2026-11-18T03:00:00Z', duration_minutes: 90 }],
        cbt_exam_attempts: [{ id: 'a1', exam_id: 'exam', user_id: 's', status: 'in_progress', started_at: '2026-11-18T01:00:00Z',
            personal_end_time: '2026-11-18T02:30:00Z', metadata: {} }],
        cbt_attempt_security_logs: [],
    }, [], { now: '2026-11-18T02:00:00Z' });
    await new ProctoringService(db, { assertExamStaff: async () => {} }, {}).extendAttemptTime({ id: 'p' }, 'a1', 10, 'Listrik padam');
    const notice = examSessionNotice(db.tables.cbt_exam_attempts[0].metadata, NOW);
    assert.deepEqual(notice, { kind: 'extended', until: '2026-11-18T02:40:00.000Z', minutes: 10 });

    const page = fs.readFileSync(path.resolve(__dirname, '../../web/app/components/questions/ExamPage.tsx'), 'utf8');
    assert.doesNotMatch(page, /Pemulihan pengumpulan aktif/);
    assert.doesNotMatch(page, /Pengumpulan belum dapat dikonfirmasi/);
    assert.doesNotMatch(page, /\$\{localCount\} jawaban tersimpan di perangkat ini/, 'tidak menyebut semua jawaban lokal sebagai tertahan');
    // Tanpa salinan lokal, pemulihan kirim-saja tidak menawarkan pengumpulan jawaban server saja.
    assert.match(page, /Salinan Jawaban Tidak Ditemukan/);
    assert.match(page, /Jawaban yang sudah sampai di server tetap aman/);
});

test('submit-only without a local copy locks the exam screen instead of leaving questions editable', () => {
    const page = fs.readFileSync(path.resolve(__dirname, '../../web/app/components/questions/ExamPage.tsx'), 'utf8');
    // Pemulihan yang dibuka dari daftar jadwal maupun yang diubah proktor saat sesi berjalan.
    assert.match(page, /setMissingRecoveryCopy\(recoverySubmitOnly && !hasRecoveryCopy\)/);
    assert.match(page, /if \(Object\.keys\(answersRef\.current\)\.length > 0\) setWaitingForSyncAndSubmit\(true\);\s*else setMissingRecoveryCopy\(true\);/);
    assert.match(page, /if \(submissionOnly && missingRecoveryCopy\) return;/, 'tidak mengumpulkan jawaban server saja');
});
