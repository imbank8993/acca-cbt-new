const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });
const { fixtureDb } = require('./fixture-db.cjs');
const { ExamAttemptsService } = require('../src/students/exam-attempts.service.ts');
const { ProctoringService } = require('../src/proctoring/proctoring.service.ts');

// Proktor memilih "Kirim ulang jawaban saja" dengan durasi bebas (mis. 120 menit):
// selama itu siswa dapat mengirim salinan perangkat, tetapi tidak mengubah jawaban.
const user = { id: 'student' }, device = 'device-one';
const startedAt = '2026-10-24T00:00:00Z', originalDeadline = '2026-10-24T02:00:00Z';
const grading = { gradeAttemptFromSavedAnswers: async () => null, applyRelativeQuizScoringIfQuiz: async () => {}, retryPendingAutoSubmissions: async () => ({ recovered: 0, failed: 0 }) };
const web = file => fs.readFileSync(path.resolve(__dirname, '../../web', file), 'utf8');

function fixture(status) {
    let now = status === 'in_progress' ? '2026-10-24T01:30:00Z' : '2026-10-24T05:00:00Z';
    const db = fixtureDb({
        cbt_exams: [{ id: 'exam', question_bank_id: 'bank', duration_minutes: 120, end_time: '2026-10-24T04:00:00Z', is_published: true }],
        cbt_exam_attempts: [{ id: 'attempt', exam_id: 'exam', user_id: user.id, status, started_at: startedAt,
            personal_end_time: originalDeadline, device_fingerprint: device,
            metadata: status === 'auto_submitted' ? { closed_by_expiry: true } : {} }],
        cbt_exam_question_snapshots: [
            { exam_id: 'exam', question_snapshot: { id: 'q1', type: 'essay', bank_question_options: [] } },
            { exam_id: 'exam', question_snapshot: { id: 'q2', type: 'essay', bank_question_options: [] } },
        ],
        cbt_answers: [{ attempt_id: 'attempt', question_id: 'q1', essay_answer: 'online', selected_option_id: null,
            metadata: { answer_revision: 1 } }],
        cbt_attempt_security_logs: [],
    });
    db.raw = async sql => /clock_timestamp|select now/i.test(sql) ? [{ now: new Date(now) }] : [{ id: 'locked' }];
    const service = new ExamAttemptsService(db, { post: async () => { throw new Error('scoring offline'); } }, grading);
    const proctor = new ProctoringService(db, { assertExamStaff: async () => {} }, grading);
    return { db, service, proctor, setNow: value => { now = value; } };
}
const local = { q1: 'online', q2: 'written offline' };
const sendLocal = (service, personalEndTime) => service.submit(user, 'exam', local, undefined, 'attempt', device,
    { q1: 1, q2: 1 }, { startedAt, personalEndTime });

test('a running attempt can be switched to "send only" for 120 minutes', async () => {
    const { db, service, proctor, setNow } = fixture('in_progress');
    const result = await proctor.resetAttempt({ id: 'proctor' }, 'attempt', 'Laporan gagal kirim', 120, false, true);
    assert.equal(result.submitOnly, true);
    const row = db.tables.cbt_exam_attempts[0];
    assert.equal(row.metadata.recovery_submit_only, true);
    assert.equal(row.metadata.recovery_source_deadline, originalDeadline);
    assert.equal(row.personal_end_time, '2026-10-24T03:30:00.000Z');
    // Jawaban terkunci.
    await assert.rejects(service.saveAnswer(user, 'attempt', { questionId: 'q2', essay_answer: 'edit', revision: 1 }, device),
        /hanya mengizinkan pengumpulan/);
    // Menit ke-100 masih dalam jendela: salinan lokal (dikunci dengan tenggat lama) diterima.
    setNow('2026-10-24T03:10:00Z');
    const sent = await sendLocal(service, originalDeadline);
    assert.equal(sent.savedAnswersOnly, false);
    assert.equal(db.tables.cbt_exam_attempts[0].status, 'submitted');
    assert.equal(db.tables.cbt_answers.find(answer => answer.question_id === 'q2').essay_answer, 'written offline');
    const log = db.tables.cbt_attempt_security_logs.find(entry => entry.event_type === 'RESET_BY_PROCTOR');
    assert.equal(log.metadata.submit_only, true);
    assert.equal(log.metadata.recovery_duration_minutes, 120);
});

test('after the send-only window the copy is refused', async () => {
    const { service, proctor, setNow } = fixture('auto_submitted');
    await proctor.resetAttempt({ id: 'proctor' }, 'attempt', 'Laporan gagal kirim', 120, false, true);
    setNow('2026-10-24T07:01:00Z');
    await assert.rejects(sendLocal(service, originalDeadline), error => error.getStatus() === 403);
});

test('a running attempt keeps working mode by default', async () => {
    const { db, proctor } = fixture('in_progress');
    await proctor.resetAttempt({ id: 'proctor' }, 'attempt', 'Atur ulang waktu', 30);
    assert.equal(db.tables.cbt_exam_attempts[0].metadata.recovery_submit_only, false);
});

test('a closed attempt cannot silently reopen for editing, and a device move cannot be send-only', async () => {
    const closed = fixture('auto_submitted');
    await assert.rejects(closed.proctor.resetAttempt({ id: 'proctor' }, 'attempt', 'Coba buka kerja', 30, false, false), /hanya dapat dipulihkan untuk mengirim/);
    assert.equal(closed.db.tables.cbt_exam_attempts[0].status, 'auto_submitted');
    await assert.rejects(closed.proctor.resetAttempt({ id: 'proctor' }, 'attempt', 'Pindah perangkat', 30, true, true), /tidak dapat digabung/);
});

test('the reset dialog offers an explicit "send only" recovery and the page sends automatically', () => {
    const modal = web('app/components/monitoring/ResetExamModal.tsx');
    assert.match(modal, /Kirim ulang jawaban saja/);
    assert.match(modal, /Lanjutkan mengerjakan/);
    assert.match(modal, /resetExamAttempt\(attempt\.id, trimmedReason, duration, moveDevice, moveDevice \? undefined : lockAnswers\)/);
    assert.match(modal, /Buka Pengiriman Jawaban/);
    assert.match(web('lib/api/proctoring.ts'), /submitOnly !== undefined \? \{ submitOnly \} : \{\}/);
    assert.match(web('app/components/questions/ExamPage.tsx'),
        /heartbeat\.submissionOnly\) \{\s*setSubmissionOnly\(true\);[\s\S]{0,500}setWaitingForSyncAndSubmit\(true\)/);
});
