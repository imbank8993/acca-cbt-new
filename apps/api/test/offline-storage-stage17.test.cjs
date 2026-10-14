// Run from repository root: node --test apps/api/test/offline-storage-stage17.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

require('ts-node').register({
    project: path.resolve(__dirname, '../../web/tsconfig.json'),
    transpileOnly: true,
    compilerOptions: { module: 'CommonJS', moduleResolution: 'node' },
});

const { createSerializedWriter, inspectExamStorage } = require('../../web/lib/exam-durable-storage.ts');

function replaceGlobal(name, value) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
    return () => {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else delete globalThis[name];
    };
}

test('ANS-06: penulisan snapshot cepat tetap selesai sesuai urutan perubahan', async () => {
    const events = [];
    let releaseFirst;
    const firstGate = new Promise(resolve => { releaseFirst = resolve; });
    const writer = createSerializedWriter(async value => {
        events.push(`${value}:start`);
        if (value === 'first') await firstGate;
        events.push(`${value}:end`);
        return value;
    });

    const first = writer('first');
    const second = writer('second');
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(events, ['first:start']);
    releaseFirst();
    assert.deepEqual(await Promise.all([first, second]), ['first', 'second']);
    assert.deepEqual(events, ['first:start', 'first:end', 'second:start', 'second:end']);
});

test('ANS-06: localStorage menjadi fallback terdeteksi ketika IndexedDB tidak tersedia', async () => {
    const values = new Map();
    const restoreIdb = replaceGlobal('indexedDB', undefined);
    const restoreLocal = replaceGlobal('localStorage', {
        getItem: key => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, value),
        removeItem: key => values.delete(key),
    });
    try {
        const health = await inspectExamStorage();
        assert.equal(health.available, true);
        assert.equal(health.mode, 'localstorage');
        assert.match(health.warning, /IndexedDB tidak tersedia/i);
    } finally {
        restoreLocal();
        restoreIdb();
    }
});

test('ANS-06: warning persistence disembunyikan, tetapi peringatan kapasitas tetap ada', () => {
    const source = fs.readFileSync(
        path.resolve(__dirname, '../../web/lib/exam-durable-storage.ts'),
        'utf8',
    );
    const warningLogic = source.slice(source.indexOf('const warning ='), source.indexOf('return { available: true, mode:'));

    assert.match(warningLogic, /freeBytes !== null && freeBytes < MIN_FREE_BYTES/);
    assert.doesNotMatch(warningLogic, /!persistent/);
});

test('ANS-06: ujian diblokir bila IndexedDB dan fallback sama-sama ditolak', async () => {
    const restoreIdb = replaceGlobal('indexedDB', undefined);
    const restoreLocal = replaceGlobal('localStorage', {
        getItem: () => null,
        setItem: () => { throw new Error('storage denied'); },
        removeItem: () => {},
    });
    try {
        const health = await inspectExamStorage();
        assert.equal(health.available, false);
        assert.equal(health.mode, 'unavailable');
        assert.match(health.warning, /mode privat|browser lain/i);
    } finally {
        restoreLocal();
        restoreIdb();
    }
});

test('ANS-06: halaman ujian memakai preflight, restore, write, dan cleanup durable', () => {
    const source = fs.readFileSync(
        path.resolve(__dirname, '../../web/app/components/questions/ExamPage.tsx'),
        'utf8',
    );
    const storage = fs.readFileSync(
        path.resolve(__dirname, '../../web/lib/exam-durable-storage.ts'),
        'utf8',
    );

    assert.ok(source.indexOf('inspectExamStorage()') < source.indexOf('startExamAttemptAction('));
    assert.match(source, /readExamSnapshot\(result\.attempt\.id\)/);
    assert.match(source, /writeExamSnapshot\(att\.id/);
    assert.match(source, /removeExamSnapshot\(attempt\.id\)/);
    assert.ok(source.indexOf('resolveDurableDeviceId(getDeviceId())') < source.indexOf('startExamAttemptAction('));
    assert.match(storage, /mergeExamSnapshots\(durable, legacy\)/);
    assert.match(storage, /navigator\.storage\.persist/);
    assert.match(storage, /MIN_FREE_BYTES/);
    assert.match(storage, /db\.transaction\(SETTINGS_STORE, 'readwrite'\)/);
});

// Run the real storage module in an isolated browser-like context. The fake IDB
// models committed rows separately from transactions that fail or are delayed.
function storageFixture() {
    const vm = require('node:vm');
    const ts = require('typescript');
    const rows = new Map(), local = new Map();
    const faults = { idb: false, local: false, hold: false };
    const releases = [];
    const db = { transaction() {
        const tx = { objectStore() { return {
            get(key) { const req = {}; queueMicrotask(() => { req.result = rows.get(key); req.onsuccess?.(); }); return req; },
            put(value) {
                const req = {};
                const finish = () => {
                    if (faults.idb) { req.error = new Error('QuotaExceededError'); req.onerror?.(); }
                    else { rows.set(value.attemptId, structuredClone(value)); tx.oncomplete?.(); }
                };
                queueMicrotask(() => { if (faults.hold) releases.push(finish); else finish(); });
                return req;
            },
            delete(key) { const req = {}; queueMicrotask(() => { rows.delete(key); tx.oncomplete?.(); }); return req; },
        }; } };
        return tx;
    } };
    const sandbox = { exports: {}, indexedDB: { open() {
        const req = {}; queueMicrotask(() => { req.result = db; req.onsuccess(); }); return req;
    } }, localStorage: {
        getItem: key => local.get(key) ?? null,
        setItem: (key, value) => { if (faults.local) throw new Error('Storage denied'); local.set(key, value); },
        removeItem: key => local.delete(key),
    } };
    const code = ts.transpileModule(fs.readFileSync(path.resolve(__dirname, '../../web/lib/exam-durable-storage.ts'), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText;
    vm.runInNewContext(code, sandbox);
    return { api: sandbox.exports, rows, local, faults, releases };
}
const draft = (revision, answer = 'answer-' + revision) => ({ answers: { q: answer }, revisions: { q: revision }, doubtfulAnswers: [] });

test('reload chooses newer fallback over readable but stale IndexedDB, including cleared answers', async () => {
    const { api, rows, faults } = storageFixture();
    await api.writeExamSnapshot('a', draft(1));
    faults.idb = true;
    const result = await api.writeExamSnapshot('a', draft(2, ''));
    assert.equal(result.mode, 'localstorage');
    assert.equal(rows.get('a').answers.q, 'answer-1');
    const restored = await api.readExamSnapshot('a');
    assert.equal(restored.answers.q, '');
    assert.equal(restored.revisions.q, 2);
});

test('last edit is mirrored synchronously and an older pending transaction cannot replace it', async () => {
    const { api, local, faults, releases } = storageFixture();
    faults.hold = true;
    const first = api.writeExamSnapshot('a', draft(1));
    assert.equal(JSON.parse(local.get('exam_answers_a')).answers.q, 'answer-1');
    await new Promise(resolve => setImmediate(resolve));
    const second = api.writeExamSnapshot('a', draft(2));
    assert.equal(JSON.parse(local.get('exam_answers_a')).answers.q, 'answer-2');
    let readFinished = false;
    const reading = api.readExamSnapshot('a').then(snapshot => { readFinished = true; return snapshot; });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(readFinished, false);
    faults.hold = false;
    releases.shift()();
    await Promise.all([first, second]);
    assert.equal(JSON.parse(local.get('exam_answers_a')).answers.q, 'answer-2');
    assert.equal((await reading).answers.q, 'answer-2');
});

test('reconciliation keeps independent newer answers and doubtful revisions from both copies', async () => {
    const { api, rows, local } = storageFixture();
    rows.set('a', { answers: { q: 'new', r: 'old' }, revisions: { q: 5, r: 1 }, doubtfulAnswers: ['q'] });
    local.set('exam_answers_a', JSON.stringify({ answers: { q: 'old', r: 'new' }, revisions: { q: 1, r: 4 }, doubtfulAnswers: [] }));
    const restored = await api.readExamSnapshot('a');
    assert.equal(restored.answers.q, 'new');
    assert.equal(restored.answers.r, 'new');
    assert.equal(restored.doubtfulAnswers.includes('q'), true);
});

test('frozen fallback survives a failed IDB write and cannot be changed by later edits', async () => {
    const { api, faults, local } = storageFixture();
    await api.writeExamSnapshot('a', draft(1));
    faults.idb = true;
    const frozenSubmission = { startedAt: '2026-10-10T00:00:00Z', personalEndTime: '2026-10-10T01:00:00Z' };
    const frozen = api.freezeExamSnapshot('a', { ...draft(2), frozenSubmission });
    assert.equal(JSON.parse(local.get('exam_answers_a')).answers.q, 'answer-2');
    await frozen;
    await api.writeExamSnapshot('a', draft(3));
    const restored = await api.readExamSnapshot('a');
    assert.equal(restored.answers.q, 'answer-2');
    assert.ok(restored.frozenSubmission);
});

test('assignment attachments, URL and notes survive localStorage failure and unrelated answer writes', async () => {
    const { api, faults } = storageFixture();
    faults.local = true;
    const assignmentData = { fileUrls: ['/uploaded.pdf'], documentUrl: 'https://example.com/task', textSubmission: 'latest note' };
    assert.equal((await api.writeExamSnapshot('a', { ...draft(1), assignmentData, assignmentRevision: 2 })).mode, 'indexeddb');
    await api.writeExamSnapshot('a', { ...draft(2), assignmentData: { textSubmission: 'stale' }, assignmentRevision: 1 });
    let restored = await api.readExamSnapshot('a');
    assert.equal(restored.assignmentData.documentUrl, assignmentData.documentUrl);
    assert.equal(restored.assignmentData.fileUrls[0], '/uploaded.pdf');
    assert.equal(restored.assignmentData.textSubmission, 'latest note');
    await api.writeExamSnapshot('a', { ...draft(2), assignmentData: { fileUrls: [], textSubmission: '', documentUrl: '' }, assignmentRevision: 3 });
    restored = await api.readExamSnapshot('a');
    assert.equal(restored.assignmentData.fileUrls.length, 0);
    assert.equal(restored.assignmentData.textSubmission, '');
});

test('failure of both stores is reported and freezing never claims durable success', async () => {
    const { api, faults } = storageFixture();
    faults.local = faults.idb = true;
    assert.equal((await api.writeExamSnapshot('a', draft(1))).saved, false);
    await assert.rejects(api.freezeExamSnapshot('a', draft(1)), /belum tersimpan/);
});


function assignmentHandlers(api) {
    const vm = require('node:vm');
    const ts = require('typescript');
    const source = fs.readFileSync(path.resolve(__dirname, '../../web/app/components/questions/ExamPage.tsx'), 'utf8');
    const start = source.indexOf('    const restoreAssignment =');
    const end = source.indexOf('    const collectPendingRows =', start);
    const state = {};
    const sandbox = {
        useCallback: fn => fn, ownsEditorLockRef: { current: true },
        assignmentRef: { current: {} }, assignmentRevisionRef: { current: 0 },
        pendingAssignmentRef: { current: undefined }, attemptRef: { current: { id: 'a' } },
        frozenSnapshotRef: { current: null }, submitInFlightRef: { current: false },
        clockRef: { current: { remainingSeconds: () => 60 } },
        answersRef: { current: { q: 'answer' } }, revisionsRef: { current: { q: 1 } },
        doubtfulRef: { current: new Set() }, storageStateRef: { current: 'unknown' },
        setAssignmentFileUrls: value => { state.files = value; },
        setAssignmentTextNote: value => { state.note = value; },
        setAssignmentDocumentUrl: value => { state.url = value; },
        setStorageWarning: value => { state.warning = value; },
        writeExamSnapshot: api.writeExamSnapshot,
        localStorage: { getItem: () => { throw new Error('localStorage denied'); } },
    };
    vm.runInNewContext(ts.transpileModule(source.slice(start, end) + '; globalThis.handlers = {restoreAssignment, updateAssignment};', {
        compilerOptions: { target: ts.ScriptTarget.ES2020 },
    }).outputText, sandbox);
    return { ...sandbox.handlers, state, sandbox };
}

test('task form restores from IndexedDB, preserves rapid changes, and displays storage failures', async () => {
    const { api, faults } = storageFixture();
    faults.local = true;
    const first = assignmentHandlers(api);
    first.updateAssignment({ documentUrl: 'https://example.com/doc' });
    first.updateAssignment({ textSubmission: 'note' });
    first.updateAssignment({ fileUrls: ['/file.pdf'] });
    const saved = await api.readExamSnapshot('a');
    const reopened = assignmentHandlers(api);
    reopened.restoreAssignment('a', saved);
    assert.equal(reopened.state.url, 'https://example.com/doc');
    assert.equal(reopened.state.note, 'note');
    assert.equal(reopened.state.files[0], '/file.pdf');
    assert.equal(reopened.sandbox.assignmentRef.current.textSubmission, 'note');
    faults.idb = true;
    reopened.updateAssignment({ textSubmission: 'unsaved note' });
    await api.readExamSnapshot('a');
    await new Promise(resolve => setImmediate(resolve));
    assert.match(reopened.state.warning, /belum tersimpan/);
    reopened.sandbox.frozenSnapshotRef.current = saved;
    reopened.updateAssignment({ textSubmission: 'edit after freeze' });
    assert.equal(reopened.sandbox.assignmentRef.current.textSubmission, 'unsaved note');
});


test('a second tab cannot silently replace its newer answer with an older frozen payload', async () => {
    const { api, local } = storageFixture();
    const frozenSubmission = { startedAt: '2026-10-10T00:00:00Z', personalEndTime: '2026-10-10T01:00:00Z' };
    const first = { ...draft(1), frozenSubmission };
    await api.freezeExamSnapshot('a', first);
    await assert.rejects(api.freezeExamSnapshot('a', { ...draft(2), frozenSubmission }), e => e.code === 'EXAM_SNAPSHOT_CONFLICT');
    assert.equal((await api.readExamSnapshot('a')).answers.q, 'answer-1');
    const backup = [...local.entries()].find(([key]) => key.startsWith('exam_answers_a:conflict:'));
    assert.equal(JSON.parse(backup[1]).answers.q, 'answer-2');
    assert.equal((await api.freezeExamSnapshot('a', first)).answers.q, 'answer-1');
});

test('a stale background freeze cannot discard a newer draft revision', async () => {
    const { api } = storageFixture();
    await api.writeExamSnapshot('a', draft(3));
    await assert.rejects(api.freezeExamSnapshot('a', { ...draft(2), frozenSubmission: {
        startedAt: '2026-10-10T00:00:00Z', personalEndTime: '2026-10-10T01:00:00Z',
    } }), e => e.code === 'EXAM_SNAPSHOT_CONFLICT');
    assert.equal((await api.readExamSnapshot('a')).answers.q, 'answer-3');
});

test('single-tab ordinary exam can freeze after restoring empty assignment defaults', async () => {
    const { api } = storageFixture();
    const frozenSubmission = { startedAt: '2026-10-10T00:00:00Z', personalEndTime: '2026-10-10T01:00:00Z' };
    const answer = draft(3);
    // ExamPage.restoreAssignment used to add these fields to every ordinary exam.
    await api.writeExamSnapshot('ordinary', { ...answer, assignmentData: { fileUrls: [], textSubmission: '', documentUrl: undefined } });
    const frozen = await api.freezeExamSnapshot('ordinary', { ...answer, frozenSubmission });
    assert.deepEqual(frozen.answers, answer.answers);
    assert.deepEqual(frozen.frozenSubmission, frozenSubmission);
});

test('empty assignment fields are equivalent on retry but actual text and attachments cannot be discarded', async () => {
    const { api } = storageFixture();
    const frozenSubmission = { startedAt: '2026-10-10T00:00:00Z', personalEndTime: '2026-10-10T01:00:00Z' };
    const answer = draft(3);
    const first = { ...answer, frozenSubmission, assignmentData: { fileUrls: [], textSubmission: '' } };
    await api.freezeExamSnapshot('empty-frozen', first);
    const retry = await api.freezeExamSnapshot('empty-frozen', { ...answer, frozenSubmission });
    assert.deepEqual(retry.assignmentData, first.assignmentData); // Reuse exact previously frozen delivery.
    for (const assignmentData of [{ textSubmission: 'actual note' }, { fileUrls: ['/file.pdf'] }]) {
        await api.writeExamSnapshot('real-assignment', { ...answer, assignmentData });
        await assert.rejects(api.freezeExamSnapshot('real-assignment', { ...answer, frozenSubmission }), e => e.code === 'EXAM_SNAPSHOT_CONFLICT');
        assert.deepEqual(JSON.parse(JSON.stringify((await api.readExamSnapshot('real-assignment')).assignmentData)), assignmentData);
        await api.removeExamSnapshot('real-assignment');
    }
});

test('editor ownership excludes a second tab and becomes available after release', async () => {
    const { acquireExamEditorLock } = require('../../web/lib/exam-editor-lock.ts');
    const held = new Set();
    const restore = replaceGlobal('navigator', { locks: { async request(key, options, run) {
        assert.equal(options.ifAvailable, true);
        if (held.has(key)) return run(null);
        held.add(key);
        try { return await run({ name: key }); } finally { held.delete(key); }
    } } });
    try {
        const release = await acquireExamEditorLock('exam');
        assert.equal(typeof release, 'function');
        assert.equal(await acquireExamEditorLock('exam'), null);
        release();
        await new Promise(resolve => setImmediate(resolve));
        const next = await acquireExamEditorLock('exam');
        assert.equal(typeof next, 'function');
        next();
    } finally { restore(); }
});

test('unsupported tab locking fails closed instead of allowing competing editors', async () => {
    const { acquireExamEditorLock } = require('../../web/lib/exam-editor-lock.ts');
    const restore = replaceGlobal('navigator', {});
    try { await assert.rejects(acquireExamEditorLock('exam'), /pengamanan satu tab/); } finally { restore(); }
});


test('the exam page stops before sending or deleting data when freezing detects a conflict', async () => {
    const vm = require('node:vm');
    const ts = require('typescript');
    const { ExamSnapshotConflictError } = require('../../web/lib/exam-durable-storage.ts');
    const source = fs.readFileSync(path.resolve(__dirname, '../../web/app/components/questions/ExamPage.tsx'), 'utf8');
    const start = source.indexOf('    const handleSubmitExam = useCallback(');
    const end = source.indexOf('    // Simpan referensi terbaru', start);
    const state = { sent: 0, removed: 0, completed: false };
    const snapshot = { answers: { q: 'newer' }, revisions: { q: 2 }, doubtfulAnswers: [] };
    const context = {
        useCallback: fn => fn, user: { id: 'student' }, examId: 'exam', exam: {}, attempt: { id: 'a' },
        ownsEditorLockRef: { current: true }, submitInFlightRef: { current: false }, terminationReasonRef: { current: null },
        frozenSnapshotRef: { current: snapshot }, attemptRef: { current: { id: 'a' } },
        pendingAssignmentRef: { current: undefined }, storageStateRef: { current: 'healthy' },
        autoRetryCountRef: { current: 0 },
        freezeExamSnapshot: async () => { throw new ExamSnapshotConflictError(); }, ExamSnapshotConflictError,
        setSubmissionOnly: () => {}, setWaitingForSyncAndSubmit: () => {}, setAccessDenied: value => { state.denied = value; },
        setSubmissionIssue: () => {},
        setAccessError: value => { state.message = value; }, setStorageWarning: () => {},
        navigator: { onLine: true }, submitExamAction: async () => { state.sent++; return { success: true }; },
        removeExamSnapshot: async () => { state.removed++; }, setIsCompleted: value => { state.completed = value; },
        router: {}, toast: {}, scheduleAutoRetry: () => {},
    };
    vm.runInNewContext(ts.transpileModule(source.slice(start, end) + '; globalThis.submit = handleSubmitExam;', {
        compilerOptions: { target: ts.ScriptTarget.ES2020 },
    }).outputText, context);
    await context.submit();
    assert.equal(state.sent, 0);
    assert.equal(state.removed, 0);
    assert.equal(state.completed, false);
    assert.equal(state.denied, true);
    assert.match(state.message, /Salinan jawaban berbeda/);
    assert.equal(context.frozenSnapshotRef.current.answers.q, 'newer');
});

test('submit-only reload preserves the original local snapshot when question content is unavailable', async () => {
    const vm = require('node:vm'), ts = require('typescript');
    const source = fs.readFileSync(path.resolve(__dirname, '../../web/app/components/questions/ExamPage.tsx'), 'utf8');
    const start = source.indexOf('                restoreAssignment(result.attempt.id, localSnapshot);');
    const end = source.indexOf('                const recoveryUntil =', start);
    assert.ok(start >= 0 && end > start);
    for (const frozen of [false, true]) {
        const local = { answers: { q: 'new local answer' }, revisions: { q: 4 }, doubtfulAnswers: ['q'],
            ...(frozen ? { frozenSubmission: { startedAt: 'start', personalEndTime: 'end' } } : {}) };
        const state = {};
        const sandbox = {
            result: { attempt: { id: 'attempt' } }, localSnapshot: local,
            recoverySubmitOnly: !frozen, restoreAssignment: () => {},
            savedA: { q: 'old server answer' }, savedD: new Set(), localAnswerIds: [],
            revisionsRef: { current: { q: 1 } }, answersRef: { current: {} }, doubtfulRef: { current: new Set() },
            assignmentRef: { current: {} }, assignmentRevisionRef: { current: 0 },
            setAnswers: value => { state.answers = value; }, setDoubtfulAnswers: () => {},
            writeExamSnapshot: async () => { state.writes = (state.writes || 0) + 1; },
        };
        const code = '(async () => {' + source.slice(start, end) + '})()';
        await vm.runInNewContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText, sandbox);
        assert.equal(state.answers.q, 'new local answer');
        assert.equal(sandbox.revisionsRef.current.q, 4);
        assert.equal(sandbox.savedD.has('q'), true);
        assert.equal(state.writes || 0, 0);
    }
});

for (const scenario of ['online', 'offline', 'lost-response', 'recovery-required', 'cleanup-failed']) {
    test(`timer expiry freezes and submits ordinary exam without false conflict: ${scenario}`, async () => {
        const vm = require('node:vm'), ts = require('typescript');
        const { api, local } = storageFixture();
        const answer = draft(3, 'last answer before expiry');
        await api.writeExamSnapshot('expiry-attempt', { ...answer, assignmentData: { fileUrls: [], textSubmission: '' } });
        const source = fs.readFileSync(path.resolve(__dirname, '../../web/app/components/questions/ExamPage.tsx'), 'utf8');
        const handlerStart = source.indexOf('    const handleSubmitExam = useCallback(');
        const handlerEnd = source.indexOf('    // Simpan referensi terbaru', handlerStart);
        const timerStart = source.indexOf('    // Auto-submit when timer hits 0.');
        const timerEnd = source.indexOf('    const handleAnswerSelect', timerStart);
        assert.ok(handlerStart >= 0 && handlerEnd > handlerStart && timerStart >= 0 && timerEnd > timerStart);
        const deliveryCall = 'void handleSubmitExam(undefined, { isAuto: true });';
        const timerCode = source.slice(timerStart, timerEnd);
        assert.ok(timerCode.includes(deliveryCall));
        const state = { sent: [], denied: false, completed: false, waiting: false, cleaned: 0, retries: 0 };
        const attempt = { id: 'expiry-attempt', started_at: '2026-10-10T00:00:00Z', personal_end_time: '2026-10-10T01:00:00Z' };
        const sandbox = {
            useCallback: fn => fn, useEffect: fn => fn(),
            user: { id: 'student' }, examId: 'exam', exam: { exam_type: 'daily' }, attempt,
            loading: false, accessDenied: false, isCompleted: false, submitting: false, timeLeft: 0, isOffline: scenario === 'offline',
            ownsEditorLockRef: { current: true }, submitInFlightRef: { current: false }, terminationReasonRef: { current: null },
            frozenSnapshotRef: { current: null }, attemptRef: { current: attempt },
            answersRef: { current: answer.answers }, revisionsRef: { current: answer.revisions }, doubtfulRef: { current: new Set() },
            assignmentRef: { current: { fileUrls: [], textSubmission: '' } }, assignmentRevisionRef: { current: 0 },
            pendingAssignmentRef: { current: undefined }, storageStateRef: { current: 'healthy' },
            autoSubmittedRef: { current: false }, autoRetryTimerRef: { current: null }, autoRetryCountRef: { current: 0 }, offlineRecoveryRef: { current: false },
            freezeExamSnapshot: api.freezeExamSnapshot, ExamSnapshotConflictError: api.ExamSnapshotConflictError,
            setSubmissionOnly: () => {}, setWaitingForSyncAndSubmit: value => { state.waiting = value; },
            setSubmissionIssue: value => { state.issue = value; },
            setAccessDenied: value => { state.denied = value; }, setAccessError: value => { state.error = value; },
            setStorageWarning: () => {}, setSubmitting: () => {}, getErrorMessage: error => error.message,
            navigator: { onLine: scenario !== 'offline' },
            submitExamAction: async (_examId, answers, assignmentData, _attemptId, revisions, frozenSubmission) => {
                state.sent.push(JSON.parse(JSON.stringify({ answers, assignmentData, revisions, frozenSubmission })));
                if (scenario === 'recovery-required') return { success: false, retryable: false, error: 'Pemulihan diperlukan' };
                return scenario === 'lost-response' && state.sent.length === 1
                    ? { success: false, retryable: true, error: 'Response lost' }
                    : { success: true, submissionVerified: true };
            },
            removeExamSnapshot: async id => {
                state.cleaned++;
                if (scenario === 'cleanup-failed') throw new Error('Cache unavailable');
                await api.removeExamSnapshot(id);
            },
            removeExamSubmissionRegistration: async () => {}, removeExamRecoverySession: async () => {}, removeExamOfflineShell: async () => {},
            setIsCompleted: value => { state.completed = value; }, router: { push: () => {} },
            toast: { success: () => {}, error: () => {}, warning: () => {} }, scheduleAutoRetry: () => { state.retries++; },
        };
        const code = source.slice(handlerStart, handlerEnd) + '\n' + timerCode.replace(deliveryCall, 'globalThis.autoDelivery = handleSubmitExam(undefined, { isAuto: true });') + '\nglobalThis.retry = handleSubmitExam;';
        vm.runInNewContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText, sandbox);
        await sandbox.autoDelivery;
        assert.equal(state.denied, false);
        if (scenario === 'recovery-required') {
            assert.equal(state.completed, false);
            assert.equal(state.cleaned, 0);
            assert.equal(state.retries, 0);
            assert.match(state.issue, /Pemulihan diperlukan/);
            assert.ok((await api.readExamSnapshot(attempt.id)).frozenSubmission);
            return;
        }
        if (scenario === 'offline' || scenario === 'lost-response') {
            assert.equal(state.completed, false); assert.equal(state.cleaned, 0); assert.equal(state.waiting, true);
            const retained = await api.readExamSnapshot(attempt.id);
            assert.equal(retained.answers.q, answer.answers.q); assert.ok(retained.frozenSubmission);
            sandbox.navigator.onLine = true;
            // A retry must reuse the frozen answer, even if a stale UI callback changed its draft.
            sandbox.answersRef.current = { q: 'different after expiry' };
            await sandbox.retry(undefined, { isAuto: true });
        }
        assert.equal(state.completed, true); assert.equal(state.cleaned, 1);
        assert.ok(state.sent.every(payload => payload.answers.q === answer.answers.q));
        assert.ok(state.sent.every(payload => payload.assignmentData === undefined));
        assert.equal(local.has('exam_answers_' + attempt.id), scenario === 'cleanup-failed');
    });
}
