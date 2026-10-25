const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });
const { fixtureDb } = require('./fixture-db.cjs');
const { ExamAttemptsService } = require('../src/students/exam-attempts.service.ts');
const { ExamMonitoringService } = require('../src/proctor/exam-monitoring.service.ts');
const { GradingService } = require('../src/grading/grading.service.ts');
const { ExamClock } = require('../../web/lib/exam-clock.ts');
const { readExamSnapshot, writeExamSnapshot } = require('../../web/lib/exam-durable-storage.ts');
const user = { id: 'student' };
const device = 'audit-device';
function fixture() {
    return fixtureDb({
        cbt_exams: [{ id: 'exam', question_bank_id: 'bank', duration_minutes: 60, end_time: '2026-09-20T01:00:00Z' }],
        cbt_exam_attempts: [{ id: 'attempt', exam_id: 'exam', user_id: 'student', status: 'in_progress', started_at: '2026-09-19T23:30:00Z', personal_end_time: '2026-09-20T01:00:00Z', device_fingerprint: device, metadata: {} }],
        cbt_bank_questions: [{ id: 'q', bank_id: 'bank', type: 'essay', bank_question_options: [] }],
        cbt_exam_question_snapshots: [{ exam_id: 'exam', order_number: 1, question_snapshot: { id: 'q', bank_id: 'bank', type: 'essay', bank_question_options: [] } }],
        cbt_answers: [],
    });
}
const grading = { gradeAttemptFromSavedAnswers: async () => null, retryPendingAutoSubmissions: async () => ({ recovered: 0, failed: 0 }) };
const scoring = { post: async () => ({ items: [], scaled_score: 0, total_score: 0, max_possible_score: 1, needs_manual_grading: true, dimension_scores: {} }) };
const service = (db, scorer = scoring) => new ExamAttemptsService(db, scorer, grading);
const row = (revision, text = 'new') => ({ questionId: 'q', essay_answer: text, revision });

test('delayed bulk retry, unversioned clients and equal-version conflicts cannot overwrite newer answers', async () => {
    const db = fixture();
    const attempts = service(db);
    await attempts.saveAnswer(user, 'attempt', row(2), device);
    // Bulk sync tidak lagi gagal total: versi lama dilewati (server lebih baru),
    // versi sama berisi beda dilaporkan sebagai bentrok — keduanya tidak menimpa.
    for (const revision of [1, undefined]) {
        const result = await attempts.syncAnswers(user, 'attempt', [row(revision, 'old')], device);
        assert.deepEqual(result.superseded, ['q']);
        assert.equal(db.tables.cbt_answers[0].essay_answer, 'new');
    }
    const conflict = await attempts.syncAnswers(user, 'attempt', [row(2, 'old')], device);
    assert.deepEqual(conflict.rejected.map(item => item.code), ['REVISION_CONFLICT']);
    assert.equal(db.tables.cbt_answers[0].essay_answer, 'new');
    await assert.rejects(attempts.saveAnswer(user, 'attempt', row(1, 'old'), device), e => e.getStatus() === 409);
    await attempts.syncAnswers(user, 'attempt', [row(2)], device);
    await attempts.saveAnswer(user, 'attempt', row(3, ''), device);
    assert.equal(db.tables.cbt_answers[0].essay_answer, null);
    assert.equal(db.tables.cbt_answers[0].metadata.answer_revision, 3);
});

test('active restart rejects autosaves from the previous session generation', async () => {
    const db = fixture();
    const attempt = db.tables.cbt_exam_attempts[0];
    const oldStart = attempt.started_at;
    attempt.started_at = '2026-10-22T09:00:00Z';
    attempt.personal_end_time = '2099-10-22T10:00:00Z';
    attempt.metadata = { active_restart_at: attempt.started_at, proctor_recovery_until: attempt.personal_end_time };
    db.tables.cbt_exams[0].end_time = attempt.personal_end_time;
    const attempts = service(db);
    await assert.rejects(attempts.saveAnswer(user, 'attempt', row(1, 'old'), device, oldStart), /dimulai ulang/);
    await assert.rejects(attempts.syncAnswers(user, 'attempt', [row(1, 'old')], device), /dimulai ulang/);
    assert.equal(db.tables.cbt_answers.length, 0);
    await attempts.saveAnswer(user, 'attempt', row(1, 'new'), device, attempt.started_at);
    assert.equal(db.tables.cbt_answers[0].essay_answer, 'new');
});

test('autosave validates against the frozen type and options', async () => {
    const db = fixture();
    db.tables.cbt_bank_questions[0].type = 'mcq';
    await service(db).saveAnswer(user, 'attempt', row(1), device);
    assert.equal(db.tables.cbt_answers[0].essay_answer, 'new');
    const frozen = db.tables.cbt_exam_question_snapshots[0].question_snapshot;
    frozen.type = 'mcq';
    frozen.bank_question_options = [{ id: 'original' }];
    await service(db).saveAnswer(user, 'attempt', { questionId: 'q', selected_option_id: 'original', revision: 2 }, device);
    await assert.rejects(service(db).saveAnswer(user, 'attempt', { questionId: 'q', selected_option_id: 'later-added', revision: 3 }, device));
});

test('monitoring honors recovery after global close and uses database time', async () => {
    const db = fixture();
    db.tables.cbt_exams[0].end_time = '2026-09-19T23:58:00Z';
    const attempt = db.tables.cbt_exam_attempts[0];
    attempt.personal_end_time = '2026-09-20T00:10:00Z';
    attempt.metadata.proctor_recovery_until = attempt.personal_end_time;
    const monitor = new ExamMonitoringService(db, {}, {}, grading, {});
    await monitor.finalizeExpired('exam');
    assert.equal(attempt.status, 'in_progress');
    db.raw = async sql => /clock_timestamp/.test(sql) ? [{ now: new Date('2026-09-20T00:11:01Z') }] : [];
    attempt.metadata.submit_intent_at = '2026-09-20T00:10:00Z';
    await monitor.finalizeExpired('exam');
    assert.equal(attempt.status, 'in_progress');
    delete attempt.metadata.submit_intent_at;
    await monitor.finalizeExpired('exam');
    assert.equal(attempt.status, 'auto_submitted');
});

test('scoring outage leaves a durable submitted answer and an idempotent pending result', async () => {
    const db = fixture();
    const attempts = service(db, { post: async () => { throw new Error('offline'); } });
    const result = await attempts.submit(user, 'exam', { q: 'final' }, undefined, 'attempt', device, { q: 1 });
    assert.equal(result.gradingPending, true);
    assert.equal(result.score, null);
    assert.equal(db.tables.cbt_answers[0].essay_answer, 'final');
    assert.equal(db.tables.cbt_exam_attempts[0].status, 'submitted');
    assert.equal(db.tables.cbt_exam_attempts[0].total_score, null);
    const retry = await attempts.submit(user, 'exam', { q: 'changed' }, undefined, 'attempt', device, { q: 2 });
    assert.equal(retry.alreadySubmitted, true);
    assert.equal(retry.gradingPending, true);
    assert.equal(db.tables.cbt_answers[0].essay_answer, 'final');
    const grader = new GradingService(db, {}, scoring);
    assert.deepEqual(await grader.retryPendingAutoSubmissions('exam'), { recovered: 1, failed: 0 });
    assert.equal(db.tables.cbt_exam_attempts[0].total_score, 0);
});

test('submit intent recorded before deadline keeps the full snapshot receivable after deadline', async () => {
    const db = fixture();
    db.raw = async sql => /clock_timestamp/.test(sql) ? [{ now: new Date('2026-09-20T00:59:30Z') }] : [{ id: 'locked' }];
    const attempts = service(db);
    const committedPayload = { answers: { q: 'final answer' }, answerRevisions: { q: 1 } };
    const intent = await attempts.beginSubmit(user, 'attempt', device, committedPayload);
    assert.equal(intent.startedAt, '2026-09-20T00:59:30.000Z');

    db.raw = async sql => /clock_timestamp/.test(sql)
        ? [{ now: new Date('2026-09-20T01:01:00Z') }]
        : [{ id: 'locked' }];
    assert.deepEqual(
        await attempts.beginSubmit(user, 'attempt', device, committedPayload),
        { attemptId: 'attempt', startedAt: '2026-09-20T00:59:30.000Z' },
    );
    await attempts.autoFinish('attempt', new Date('2026-09-20T01:01:00Z'));
    assert.equal(db.tables.cbt_exam_attempts[0].status, 'in_progress');

    const result = await attempts.submit(
        user, 'exam', { q: 'final answer' }, undefined, 'attempt', device, { q: 1 },
    );
    assert.equal(result.savedAnswersOnly, false);
    assert.equal(db.tables.cbt_answers[0].essay_answer, 'final answer');
    assert.equal(db.tables.cbt_exam_attempts[0].status, 'submitted');
});

test('submit intent cannot be created for the first time after the deadline', async () => {
    const db = fixture();
    db.raw = async sql => /clock_timestamp/.test(sql)
        ? [{ now: new Date('2026-09-20T01:00:01Z') }]
        : [{ id: 'locked' }];

    const intent = await service(db).beginSubmit(user, 'attempt', device);
    assert.equal(intent.savedAnswersOnly, true);
    const result = await service(db).submit(user, 'exam', { q: 'late edit' }, undefined, 'attempt', device, { q: 1 });
    assert.equal(result.savedAnswersOnly, true);
    assert.equal(db.tables.cbt_exam_attempts[0].status, 'auto_submitted');
    assert.equal(db.tables.cbt_answers.length, 0);
    assert.equal(db.tables.cbt_exam_attempts[0].metadata.submit_intent_at, undefined);
});

test('answers and closed status are committed while scoring is still pending', async () => {
    const db = fixture();
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const attempts = service(db, { post: async () => { await gate; return scoring.post(); } });
    const submitting = attempts.submit(user, 'exam', { q: 'last second' }, undefined, 'attempt', device, { q: 1 });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(db.tables.cbt_exam_attempts[0].status, 'submitted');
    assert.equal(db.tables.cbt_answers[0].essay_answer, 'last second');
    release();
    await submitting;
});

test('submit keeps every valid answer when one answer no longer belongs to the exam', async () => {
    const db = fixture();
    db.tables.cbt_attempt_security_logs = [];
    const result = await service(db).submit(user, 'exam', { q: 'final', 'soal-hilang': 'x' }, undefined, 'attempt', device, { q: 1 });
    assert.equal(db.tables.cbt_exam_attempts[0].status, 'submitted');
    assert.deepEqual(db.tables.cbt_answers.map(item => [item.question_id, item.essay_answer]), [['q', 'final']]);
    assert.deepEqual(result.rejectedAnswers.map(item => [item.questionId, item.code]), [['soal-hilang', 'QUESTION_NOT_IN_EXAM']]);
    // Soal yang memang bukan bagian ujian tidak dapat dinilai; sisanya terverifikasi lengkap.
    assert.equal(result.submissionVerified, true);
    const log = db.tables.cbt_attempt_security_logs.find(item => item.event_type === 'ANSWERS_REJECTED');
    assert.equal(log.metadata.stage, 'submit');
});

test('stale submit cannot replace a newer autosave', async () => {
    const db = fixture();
    const attempts = service(db);
    await attempts.saveAnswer(user, 'attempt', row(2), device);
    await assert.rejects(attempts.submit(user, 'exam', { q: 'old' }, undefined, 'attempt', device, { q: 1 }), e => e.getStatus() === 409);
    assert.equal(db.tables.cbt_exam_attempts[0].status, 'in_progress');
    assert.equal(db.tables.cbt_answers[0].essay_answer, 'new');
});

test('relative quiz scoring leaves queued submissions pending', async () => {
    const db = fixture();
    Object.assign(db.tables.cbt_exam_attempts[0], { status: 'submitted', total_score: null });
    db.tables.cbt_exam_attempts.push({ id: 'graded', exam_id: 'exam', status: 'submitted', total_score: 80, metadata: {} });
    let submittedIds;
    const grader = new GradingService(db, {}, { post: async (_, body) => {
        submittedIds = body.attempts.map(attempt => attempt.attempt_id);
        return { scores: { graded: 80 } };
    } });
    await grader.applyRelativeQuizScoring('exam');
    assert.deepEqual(submittedIds, ['graded']);
    assert.equal(db.tables.cbt_exam_attempts[0].total_score, null);
});

test('failed atomic answer persistence never closes a submission', async () => {
    const db = fixture();
    const originalFrom = db.from;
    db.from = table => {
        if (table !== 'cbt_answers') return originalFrom(table);
        const builder = originalFrom(table);
        return new Proxy(builder, { get(target, property) {
            if (property === 'upsert') return () => Promise.resolve({ error: { message: 'write failed' } });
            return target[property];
        } });
    };
    await assert.rejects(service(db).submit(user, 'exam', { q: 'final' }, undefined, 'attempt', device, { q: 1 }));
    assert.equal(db.tables.cbt_exam_attempts[0].status, 'in_progress');
    assert.equal(db.tables.cbt_answers.length, 0);
});

test('expiry still refuses new answer changes', async () => {
    const db = fixture();
    db.tables.cbt_exam_attempts[0].personal_end_time = '2026-09-20T00:00:00Z';
    const result = await service(db).submit(user, 'exam', { q: 'too late' }, undefined, 'attempt', device, { q: 1 });
    assert.equal(result.savedAnswersOnly, true);
    assert.equal(db.tables.cbt_answers.length, 0);
});

test('reset during scoring invalidates the old submission result', async () => {
    const db = fixture();
    const attempts = service(db, { post: async () => {
        db.tables.cbt_exam_attempts[0].status = 'in_progress';
        db.tables.cbt_exam_attempts[0].finished_at = null;
        return scoring.post();
    } });
    await attempts.submit(user, 'exam', { q: 'final' }, undefined, 'attempt', device, { q: 1 });
    assert.equal(db.tables.cbt_exam_attempts[0].total_score, null);
    assert.equal(db.tables.cbt_exam_attempts[0].status, 'in_progress');
    assert.equal(db.tables.cbt_answers[0].score, undefined);
});

test('countdown ignores wall-clock changes and catches up after throttling', () => {
    let monotonic = 1000;
    const clock = new ExamClock(() => monotonic);
    clock.anchor(120);
    const original = Date.now;
    try {
        Date.now = () => 0;
        monotonic += 30_000;
        assert.equal(clock.remainingSeconds(), 90);
        Date.now = () => 9999999999999;
        assert.equal(clock.remainingSeconds(), 90);
        monotonic += 95_000;
        assert.equal(clock.remainingSeconds(), 0);
    } finally { Date.now = original; }
});

test('durable fallback keeps the answer revision through reload', async () => {
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    const data = new Map();
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
        getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value),
    } });
    try {
        const snapshot = { answers: { q: 'latest' }, doubtfulAnswers: [], revisions: { q: 17 } };
        assert.equal((await writeExamSnapshot('version-test', snapshot)).saved, true);
        assert.deepEqual(await readExamSnapshot('version-test'), snapshot);
    } finally {
        if (previous) Object.defineProperty(globalThis, 'localStorage', previous); else delete globalThis.localStorage;
    }
});

test('lost submit response can retry the entire intent and submit sequence', async () => {
    const db = fixture();
    const attempts = service(db);
    await attempts.beginSubmit(user, 'attempt', device);
    await attempts.submit(user, 'exam', { q: 'final' }, undefined, 'attempt', device, { q: 1 });
    assert.equal((await attempts.beginSubmit(user, 'attempt', device)).alreadySubmitted, true);
    const retry = await attempts.submit(user, 'exam', { q: 'changed' }, undefined, 'attempt', device, { q: 2 });
    assert.equal(retry.alreadySubmitted, true);
    assert.equal(db.tables.cbt_answers[0].essay_answer, 'final');
    await assert.rejects(attempts.beginSubmit(user, 'attempt', 'wrong-device'));
    await assert.rejects(attempts.beginSubmit({ id: 'other' }, 'attempt', device));
});

test('abandoned intent expires and monitoring closes the attempt without accepting late edits', async () => {
    const db = fixture();
    const attempts = service(db);
    await attempts.beginSubmit(user, 'attempt', device);
    db.raw = async sql => /clock_timestamp/.test(sql) ? [{ now: new Date('2026-09-21T01:00:00Z') }] : [{ id: 'locked' }];
    const monitor = new ExamMonitoringService(db, {}, {}, grading, {});
    await monitor.finalizeExpired('exam');
    assert.equal(db.tables.cbt_exam_attempts[0].status, 'auto_submitted');
    const intent = await attempts.beginSubmit(user, 'attempt', device);
    assert.equal(intent.alreadySubmitted, true);
    const result = await attempts.submit(user, 'exam', { q: 'late' }, undefined, 'attempt', device, { q: 1 });
    assert.equal(result.savedAnswersOnly, true);
    assert.equal(db.tables.cbt_answers.length, 0);
});

test('browser submit wrapper reaches finalization at zero and recovers a lost response', async () => {
    const { submitExamAction } = require('../../web/lib/api/students.ts');
    const original = { fetch: global.fetch, window: global.window, localStorage: global.localStorage };
    global.window = {};
    global.localStorage = { getItem: () => device, setItem: () => {} };
    try {
        for (const expired of [false, true]) {
            const db = fixture();
            const attempts = service(db);
            if (expired) db.raw = async sql => /clock_timestamp/.test(sql) ? [{ now: new Date('2026-09-20T01:00:00Z') }] : [{ id: 'locked' }];
            let loseResponse = !expired;
            const calls = [];
            global.fetch = async (url, init) => {
                calls.push(url);
                const body = JSON.parse(init.body);
                const intent = url.endsWith('/submit-intent');
                const result = intent
                    ? await attempts.beginSubmit(user, 'attempt', body.deviceId, body.submission)
                    : await attempts.submit(user, 'exam', body.answers, body.assignmentData, body.attemptId, body.deviceId, body.answerRevisions);
                if (!intent && loseResponse) { loseResponse = false; throw new Error('response lost'); }
                return new Response(JSON.stringify({ success: true, ...result }), { status: 200 });
            };
            const result = await submitExamAction('exam', { q: 'final' }, undefined, 'attempt', { q: 1 });
            if (!expired) {
                assert.equal(result.success, true, 'lost acknowledgement is verified automatically');
                assert.equal(db.tables.cbt_exam_attempts[0].status, 'submitted');
                assert.equal(result.alreadySubmitted, true);
                assert.equal(db.tables.cbt_answers[0].essay_answer, 'final');
            }
            assert.equal(result.success, !expired);
            if (expired) assert.match(result.error, /1 jawaban di perangkat ini berbeda dari yang tersimpan di server/);
            else assert.equal(result.submissionVerified, true);
            assert.equal(calls.filter(url => url.endsWith('/submit')).length, expired ? 1 : 2);
        }
    } finally {
        global.fetch = original.fetch;
        if (original.window === undefined) delete global.window; else global.window = original.window;
        if (original.localStorage === undefined) delete global.localStorage; else global.localStorage = original.localStorage;
    }
});

test('essay and short-answer edits reach the parent before any timer or blur', () => {
    const fs = require('node:fs');
    const vm = require('node:vm');
    const ts = require('typescript');
    const source = fs.readFileSync(path.resolve(__dirname, '../../web/app/components/questions/QuestionRenderer.tsx'), 'utf8');
    function render(name, props) {
        const start = source.indexOf('const ' + name + ' = React.memo');
        const end = source.indexOf(name + '.displayName', start);
        const code = ts.transpileModule(source.slice(start, end) + '; globalThis.component = ' + name, {
            compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2020 }, fileName: 'input.tsx',
        }).outputText;
        const context = {
            React: { memo: fn => fn, useId: () => 'test', useMemo: fn => fn(), createElement: (type, props, ...children) => ({ type, props: { ...props, children } }) },
            useState: value => [value, () => {}], useRef: current => ({ current }), useEffect: () => {},
            AlertTriangle: 'alert', QuestionContent: 'content', safeExternalUrl: x => x,
            normalizeShortAnswer: value => String(value || '').trim().toLowerCase(),
            parseAnswer: (value, fallback) => value ? JSON.parse(value) : fallback,
            setTimeout: () => { throw new Error('Answer publication must not wait for a timer'); },
        };
        vm.runInNewContext(code, context);
        return context.component(props);
    }
    function find(tree, type, result = []) {
        if (Array.isArray(tree)) tree.forEach(child => find(child, type, result));
        else if (tree && typeof tree === 'object') {
            if (tree.type === type) result.push(tree);
            find(tree.props?.children, type, result);
        }
        return result;
    }
    const essay = [];
    const tree = render('EssayInput', { answer: '', options: [], metadata: { allow_video_link: true }, onAnswerChange: value => essay.push(JSON.parse(value)) });
    find(tree, 'textarea')[0].props.onChange({ target: { value: 'last keystroke' } });
    assert.equal(essay.at(-1).text, 'last keystroke');
    find(tree, 'input')[0].props.onChange({ target: { value: 'https://example.com/video' } });
    assert.equal(essay.at(-1).text, 'last keystroke');
    assert.equal(essay.at(-1).videoUrl, 'https://example.com/video');
    const short = [];
    const inputs = find(render('ShortAnswerInline', { questionText: '.... plus ....', answer: '', allVariations: [], onAnswerChange: value => short.push(JSON.parse(value)) }), 'input');
    inputs[0].props.onChange({ target: { value: 'one' } });
    inputs[1].props.onChange({ target: { value: 'two' } });
    assert.deepEqual(short.at(-1), ['one', 'two']);
});
