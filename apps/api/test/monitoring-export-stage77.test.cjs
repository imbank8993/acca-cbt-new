const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });
const { fixtureDb } = require('./fixture-db.cjs');
const { ProctoringService } = require('../src/proctoring/proctoring.service.ts');
const { ExamMonitoringService } = require('../src/proctor/exam-monitoring.service.ts');
const { attemptHealth } = require('../src/common/attempt-health.ts');
const { buildAnalysisWorkbook } = require('../../web/lib/export-excel-analysis.ts');
const XLSX = require('xlsx-js-style');
const user = { id: 'student' };
const now = '2026-09-20T00:00:00.000Z';
function fixture() {
    return fixtureDb({
        cbt_exams: [{ id: 'exam', duration_minutes: 60, end_time: '2026-09-20T01:00:00Z', question_bank_id: 'bank' }],
        cbt_exam_attempts: [{ id: 'attempt', exam_id: 'exam', user_id: user.id, status: 'in_progress', device_fingerprint: 'device-1', metadata: { retained: true }, personal_end_time: '2026-09-20T01:00:00Z', started_at: now, profiles: { full_name: 'Siswa', identity_number: '001' } }],
        cbt_bank_questions: [{ id: 'q', bank_id: 'bank', type: 'mcq', question_text: 'Edited question', bank_question_options: [] }],
        cbt_exam_question_snapshots: [{ exam_id: 'exam', order_number: 1, question_snapshot: { id: 'q', type: 'mcq', question_text: 'Original question', bank_question_options: [{ id: 'a', option_text: 'Original choice', is_correct: true }] } }],
        cbt_answers: [{ id: 'answer', attempt_id: 'attempt', question_id: 'q', selected_option_id: 'a', essay_answer: null, is_correct: true, metadata: { answer_saved_at: now } }],
        cbt_attempt_security_logs: [],
    }, [], { now });
}
const monitor = db => new ExamMonitoringService(db, { assertExamMonitoring: async () => {}, assertExamStaff: async () => {} },
    { post: async () => ({ items: [], matrix: [] }) }, { retryPendingAutoSubmissions: async () => ({ recovered: 0, failed: 0 }) }, {});

test('export fills missing NISN by account UUID from master and preserves leading zeros', async () => {
    const db = fixture();
    db.tables.cbt_exam_attempts[0].profiles.identity_number = '   ';
    db.tables.users = [{ auth_id: 'student', nip: '0012345678' }, { auth_id: 'other', nip: '999' }];
    const rows = await monitor(db).listAttempts({}, 'exam');
    assert.equal(rows[0].profiles.identity_number, '0012345678');
    const workbook = await buildAnalysisWorkbook({ exam: { id: 'exam', title: 'Ujian' }, attempts: rows, analysis: [] });
    const recap = XLSX.utils.sheet_to_json(workbook.Sheets.Rekap_Hasil)[0];
    assert.equal(recap['NIS / ID'], '0012345678');
    db.tables.cbt_exam_attempts[0].profiles.identity_number = '002';
    assert.equal((await monitor(db).listAttempts({}, 'exam'))[0].profiles.identity_number, '002');
});

test('unstarted students also receive master identity without matching by name', async () => {
    const db = fixture();
    db.tables.cbt_exam_participants = [{ exam_id: 'exam', user_id: 'new' }];
    db.tables.cbt_profiles = [{ id: 'new', full_name: 'Siswa', identity_number: null }];
    db.tables.users = [{ auth_id: 'new', nip: '00012' }];
    const rows = await monitor(db).listAttempts({}, 'exam');
    assert.equal(rows.find(row => row.user_id === 'new').profiles.identity_number, '00012');
    assert.equal(rows.find(row => row.user_id === 'student').profiles.identity_number, '001');
});

test('heartbeat stores only validated client reports stamped by server and preserves metadata', async () => {
    const db = fixture();
    const service = new ProctoringService(db, {}, {});
    const health = { localAnswerCount: 500, pendingAnswerCount: 2, storageState: 'fallback', receivedAt: '2099-01-01' };
    await service.heartbeat(user, 'attempt', 'device-1', health);
    const attempt = db.tables.cbt_exam_attempts[0];
    assert.equal(attempt.metadata.sync_health.receivedAt, now);
    assert.equal(attempt.metadata.retained, true);
    assert.equal(db.tables.cbt_answers.length, 1);
    const rows = await monitor(db).listAttempts({}, 'exam');
    assert.equal(rows[0].saved_answer_count, 1);
    assert.equal(rows[0].sync_health.localAnswerCount, 500);
    assert.equal(rows[0].violation_breakdown.lainnya, 0);
    assert.ok(rows[0].attention_reasons.length > 0);
    await service.heartbeat(user, 'attempt', 'device-1', health);
    assert.equal(db.tables.cbt_attempt_security_logs.length, 1);
});

test('reports require ownership and bound device; malformed counts never reach storage', async () => {
    const db = fixture();
    const service = new ProctoringService(db, {}, {});
    const health = { localAnswerCount: 1, pendingAnswerCount: 0, storageState: 'healthy' };
    await assert.rejects(service.heartbeat({ id: 'other' }, 'attempt', 'device-1', health), e => e.getStatus() === 403);
    await assert.rejects(service.heartbeat(user, 'attempt', 'other', health), e => e.getStatus() === 403);
    await assert.rejects(service.heartbeat(user, 'attempt', 'device-1', { ...health, pendingAnswerCount: -1 }), e => e.getStatus() === 400);
    assert.equal(db.tables.cbt_attempt_security_logs.length, 0);
});

test('connection gaps are observations, not security violations', async () => {
    const db = fixture();
    db.tables.cbt_exam_attempts[0].last_seen_at = '2026-09-19T23:58:00Z';
    const service = new ProctoringService(db, {}, {});
    await service.heartbeat(user, 'attempt', 'device-1', { localAnswerCount: 1, pendingAnswerCount: 0, storageState: 'healthy' });
    const gap = db.tables.cbt_attempt_security_logs.find(row => row.event_type === 'CONNECTION_GAP_DETECTED');
    assert.equal(gap.metadata.gap_seconds, 120);
    assert.equal(gap.metadata.remaining_at_last_seen_seconds, 3720);
    assert.equal(gap.metadata.remaining_at_reconnect_seconds, 3600);
    assert.equal(gap.metadata.observed_again_at, now);
    const result = await service.logViolation(user, 'attempt', 'tab_switch');
    assert.equal(result.warningCount, 1);
});

test('old and absent reports remain unknown; recovery deadline and saved counts are independent', () => {
    const db = fixture();
    const attempt = db.tables.cbt_exam_attempts[0];
    const exam = db.tables.cbt_exams[0];
    const first = attemptHealth(attempt, exam, db.tables.cbt_answers, new Date(now), 3);
    assert.equal(first.sync_health, null);
    assert.equal(first.unanswered_count, 2);
    exam.end_time = '2026-09-19T23:00:00Z';
    attempt.personal_end_time = '2026-09-20T00:10:00Z';
    attempt.metadata.proctor_recovery_until = attempt.personal_end_time;
    attempt.metadata.sync_health = { receivedAt: '2026-09-19T23:58:00Z', localAnswerCount: 3, pendingAnswerCount: 2, storageState: 'healthy' };
    const recovered = attemptHealth(attempt, exam, [], new Date(now), 3);
    assert.equal(recovered.remaining_seconds, 600);
    assert.equal(recovered.sync_health.fresh, false);
    assert.equal(recovered.saved_answer_count, 0);
});

test('monitoring uses frozen questions and never creates a snapshot for an unstarted exam', async () => {
    const db = fixture();
    const result = await monitor(db).getItemAnalysis({}, 'exam');
    assert.equal(result.questions[0].question_text, 'Original question');
    assert.equal(result.detailed.question_version_source, 'frozen');
    db.tables.cbt_exam_question_snapshots = [];
    db.tables.cbt_exam_attempts = [];
    await monitor(db).listAttempts({}, 'exam');
    assert.equal(db.tables.cbt_exam_question_snapshots.length, 0);
});

test('monitoring includes individually assigned unstarted students', async () => {
    const db = fixture();
    db.tables.cbt_exam_participants = [{ exam_id: 'exam', user_id: 'new' }];
    db.tables.cbt_profiles = [{ id: 'new', full_name: 'Belum Mulai', identity_number: '002' }];
    const rows = await monitor(db).listAttempts({}, 'exam');
    const unstarted = rows.find(row => row.user_id === 'new');
    assert.equal(unstarted.status, 'belum');
    assert.equal(unstarted.total_score, null);
    assert.equal(unstarted.profiles.identity_number, '002');
});

test('export roundtrip keeps result and answer sheets without auxiliary summaries or response transcript', async () => {
    const fullAnswer = 'Jawaban panjang '.repeat(40);
    const options = {
        exam: { id: 'exam', title: 'Ujian', start_time: now, end_time: '2026-09-20T01:00:00Z', duration_minutes: 60 },
        attempts: [{ id: 'attempt', status: 'submitted', total_score: null, profiles: { full_name: '=2+2', identity_number: '001' }, saved_answer_count: 1, unanswered_count: 0, server_now: now,
            monitoring_history: [{ type: 'RESET_BY_PROCTOR', at: now, actor_name: 'Proktor', reason: 'Pemulihan jaringan', recovery_until: '2026-09-20T00:15:00Z' }] }],
        analysis: [], timeZone: 'Asia/Makassar',
        questions: [{ id: 'q', type: 'matching', question_text: 'Cocokkan', options: [{ id: 'left', option_text: 'Pernyataan', metadata: { match_texts: [fullAnswer] } }] }],
        answers: [{ attempt_id: 'attempt', question_id: 'q', essay_answer: JSON.stringify({ left: [fullAnswer] }) }],
        detailedAnalysis: { exam_id: 'exam', question_version_source: 'frozen', generated_at: now, items: [{ id: 'q', number: 1, type: 'matching', question_text: 'Cocokkan', score_default: 1, options: [], key_display: '', correct_students: [], wrong_students: [], ungraded_students: [], unanswered_students: [], distractor_distribution: [], difficulty_index: 0, discrimination_index: 0, incorrect_percentage: 0, total_participants: 1, total_answered: 1, total_correct: 0, total_incorrect: 0, total_ungraded: 1, total_unanswered: 0 }],
            matrix: [{ attempt_id: 'attempt', student_name: '=2+2', student_nis: '001', items: { q: { display_answer: 'truncated', score: 0, status: 'ungraded' } } }] },
    };
    const workbook = await buildAnalysisWorkbook(options);
    const bytes = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    const reopened = XLSX.read(bytes, { type: 'buffer' });
    for (const name of ['Rekap_Hasil', 'Jawaban_Siswa']) assert.ok(reopened.SheetNames.includes(name));
    for (const name of ['Ringkasan_Ujian', 'Kendala_Pemulihan', 'Riwayat_Kejadian', 'Detail_Transkrip_Respon']) {
        assert.ok(!reopened.SheetNames.includes(name));
    }
    const recap = XLSX.utils.sheet_to_json(reopened.Sheets.Rekap_Hasil)[0];
    assert.equal(recap['Nilai Klasik'], 'Menunggu penilaian');
    assert.ok(JSON.stringify(reopened.Sheets.Jawaban_Siswa).includes(fullAnswer.trim()));
    assert.ok(JSON.stringify(reopened.Sheets.Jawaban_Siswa).includes('Pernyataan'));
    assert.equal(reopened.Sheets.Rekap_Hasil.B2.t, 's');
    assert.equal(reopened.Sheets.Rekap_Hasil.B2.f, undefined);
    assert.equal(options.detailedAnalysis.matrix[0].items.q.display_answer, 'truncated');
});


test('device interruption report is validated, retried idempotently and never counts as a violation', async () => {
    const db = fixture();
    const service = new ProctoringService(db, {}, {});
    const health = { localAnswerCount: 1, pendingAnswerCount: 1, storageState: 'healthy',
        interruption: { at: '2026-09-19T23:59:00Z', remainingSeconds: 3660, reason: 'browser_offline' } };
    await service.heartbeat(user, 'attempt', 'device-1', health);
    await service.heartbeat(user, 'attempt', 'device-1', health);
    const logs = db.tables.cbt_attempt_security_logs.filter(row => row.event_type === 'CONNECTION_INTERRUPTION_REPORTED');
    assert.equal(logs.length, 1);
    assert.equal(logs[0].created_at, now);
    assert.equal(logs[0].metadata.evidence, 'client_report');
    assert.equal(logs[0].metadata.remaining_at_disconnect_seconds, 3660);
    const rows = await monitor(db).listAttempts({}, 'exam');
    assert.equal(rows[0].violation_breakdown.lainnya, 0);
    assert.equal(rows[0].monitoring_history.find(event => event.type === 'CONNECTION_INTERRUPTION_REPORTED').disconnected_at, health.interruption.at);
    await assert.rejects(service.heartbeat(user, 'attempt', 'device-1', { ...health, interruption: { ...health.interruption, remainingSeconds: -1 } }), e => e.getStatus() === 400);
    await assert.rejects(service.heartbeat(user, 'attempt', 'device-1', { ...health, interruption: { ...health.interruption, at: 'bad' } }), e => e.getStatus() === 400);
});
