const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

function loadModule(file, imports, globals = {}) {
    const source = fs.readFileSync(path.resolve(__dirname, '../../web', file), 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: {
        module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    } }).outputText;
    const module = { exports: {} };
    new Function('require', 'module', 'exports', ...Object.keys(globals), code)(
        name => {
            if (!(name in imports)) throw new Error(`Unexpected import: ${name}`);
            return imports[name];
        }, module, module.exports, ...Object.values(globals),
    );
    return module.exports;
}

const screenshots = loadModule('lib/exam-screenshots.ts', {});
const evidence = (id = 'event-1', attemptId = 'attempt-1') => ({
    id, attemptId, eventType: 'tab_switch', createdAt: '2026-10-20T01:00:00Z',
    metadata: { client_captured_at: '2026-10-20T01:00:00Z' }, screenshotBase64: 'c2NyZWVu',
});

function fixture(entries = [evidence()]) {
    const queue = entries.map(entry => ({ ...entry }));
    const calls = { read: [], log: [], upload: [], remove: [] };
    const navigator = { onLine: true };
    const handlers = {
        log: async () => ({ success: true, warningCount: 3, terminated: true, duplicate: true }),
        upload: async () => ({ success: true, saved: true }),
    };
    const { retryExamEvidence } = loadModule('lib/exam-evidence-outbox.ts', {
        './api/client': { apiSend: async (...args) => { calls.upload.push(args); return handlers.upload(...args); } },
        './api/proctoring': { logSecurityViolation: async (...args) => { calls.log.push(args); return handlers.log(...args); } },
        './device-id': { getDeviceId: () => 'bound-device' },
        './exam-durable-storage': {
            readSecurityEvents: async attemptId => {
                calls.read.push(attemptId);
                return queue.filter(entry => entry.attemptId === attemptId).map(entry => ({ ...entry }));
            },
            removeSecurityEvent: async (attemptId, id, expected) => {
                calls.remove.push([attemptId, id, expected]);
                const index = queue.findIndex(entry => entry.attemptId === attemptId && entry.id === id);
                if (index >= 0) queue.splice(index, 1);
            },
        },
        './exam-screenshots': { sendScreenshotWithRetry: send => screenshots.sendScreenshotWithRetry(send, async () => {}) },
    }, { navigator });
    return { queue, calls, handlers, navigator, retryExamEvidence };
}

test('completed evidence logs its original ID before upload and only removes an acknowledged image', async () => {
    const entry = evidence();
    const f = fixture([entry]);
    f.handlers.upload = async () => {
        assert.equal(f.calls.log.length, 1);
        assert.equal(f.queue.length, 1);
        return { success: true, saved: true };
    };
    await f.retryExamEvidence(entry.attemptId);
    assert.deepEqual(f.calls.log, [[entry.attemptId, entry.eventType, entry.metadata, entry.id]]);
    assert.deepEqual(f.calls.upload[0], [
        '/api/proctoring/attempts/attempt-1/screenshots',
        { clientEventId: entry.id, deviceId: 'bound-device', imageBase64: entry.screenshotBase64 },
        'POST', { timeoutMs: 20_000 },
    ]);
    assert.equal(f.queue.length, 0);
    // A duplicate acknowledgement may report terminated. It must not trigger
    // any logout/reload or alter the already completed exam.
    assert.deepEqual(f.calls.remove, [[entry.attemptId, entry.id, entry]]);
});

test('capture descriptors and empty queues make no network requests, and other attempts stay untouched', async () => {
    const entry = evidence(); delete entry.screenshotBase64;
    const f = fixture([entry, evidence('other', 'attempt-other')]);
    await f.retryExamEvidence('attempt-1');
    await f.retryExamEvidence('attempt-empty');
    assert.equal(f.calls.log.length, 0);
    assert.equal(f.calls.upload.length, 0);
    assert.equal(f.queue.length, 2);
});

test('a lost image response retains evidence and resends exactly the same event and payload', async () => {
    const f = fixture();
    const receivedImages = new Map();
    f.handlers.upload = async (_path, payload) => {
        receivedImages.set(payload.clientEventId, payload.imageBase64);
        return { success: false, retryable: true, error: 'Response lost' };
    };
    await f.retryExamEvidence('attempt-1');
    assert.equal(f.calls.upload.length, 3);
    assert.equal(f.queue.length, 1);
    f.handlers.upload = async (_path, payload) => {
        assert.equal(receivedImages.get(payload.clientEventId), payload.imageBase64);
        return { success: true, saved: true };
    };
    await f.retryExamEvidence('attempt-1');
    assert.equal(f.queue.length, 0);
    assert.equal(receivedImages.size, 1);
    assert.equal(f.calls.log.length, 2);
    assert.ok(f.calls.upload.every(args => JSON.stringify(args) === JSON.stringify(f.calls.upload[0])));
});

test('failed logs and throwing uploads remain durable for a later retry', async () => {
    const f = fixture();
    f.handlers.log = async () => ({ success: false, retryable: true });
    await f.retryExamEvidence('attempt-1');
    assert.equal(f.calls.upload.length, 0);
    assert.equal(f.queue.length, 1);
    f.handlers.log = async () => ({ success: true });
    f.handlers.upload = async () => { throw new Error('offline'); };
    await f.retryExamEvidence('attempt-1');
    assert.equal(f.calls.upload.length, 3);
    assert.equal(f.queue.length, 1);
});

test('acknowledged quota/cooldown and final image rejection remove an already logged entry', async () => {
    for (const response of [
        { success: true, saved: false, reason: 'limit' },
        { success: true, saved: false, reason: 'cooldown' },
        { success: false, retryable: false, error: 'Expired evidence' },
    ]) {
        const f = fixture(); f.handlers.upload = async () => response;
        await f.retryExamEvidence('attempt-1');
        assert.equal(f.queue.length, 0);
        assert.equal(f.calls.upload.length, 1);
        assert.equal(f.calls.log.length, 1);
    }
    const f = fixture(); f.handlers.upload = async () => ({ success: true, saved: false });
    await f.retryExamEvidence('attempt-1');
    assert.equal(f.queue.length, 1, 'an ambiguous acknowledgement must preserve the image');
});

test('overlapping retries share a single flight and allow a new retry after it settles', async () => {
    const f = fixture(); let finish;
    f.handlers.log = () => new Promise(resolve => { finish = resolve; });
    const first = f.retryExamEvidence('attempt-1');
    const overlapping = f.retryExamEvidence('attempt-1');
    assert.equal(first, overlapping);
    await Promise.resolve();
    assert.equal(f.calls.read.length, 1);
    finish({ success: true });
    await Promise.all([first, overlapping]);
    assert.equal(f.calls.log.length, 1);
    assert.equal(f.calls.upload.length, 1);
    await f.retryExamEvidence('attempt-1');
    assert.equal(f.calls.read.length, 2);
    assert.equal(f.calls.log.length, 1);
});

test('offline retry performs no reads or requests and resumes when online', async () => {
    const f = fixture(); f.navigator.onLine = false;
    await f.retryExamEvidence('attempt-1');
    assert.equal(f.calls.read.length, 0);
    assert.equal(f.calls.log.length, 0);
    assert.equal(f.queue.length, 1);
    f.navigator.onLine = true;
    await f.retryExamEvidence('attempt-1');
    assert.equal(f.queue.length, 0);
});

function storageFixture({ indexed = true, stripImageMirror = false } = {}) {
    const rows = new Map(), local = new Map(), transactions = [];
    const db = { transaction(storeName, mode) {
        const record = { storeName, mode, operations: [] }; transactions.push(record);
        let pending = 0, completed = false;
        const tx = { objectStore: () => ({
            get: id => request('get', () => rows.has(id) ? structuredClone(rows.get(id)) : undefined),
            put: event => request('put', () => rows.set(event.id, structuredClone(event))),
            delete: id => request('delete', () => rows.delete(id)),
            index: () => ({ getAll: attemptId => request('getAll', () => [...rows.values()]
                .filter(event => event.attemptId === attemptId).map(event => structuredClone(event))) }),
        }) };
        function request(operation, run) {
            record.operations.push(operation); pending++;
            const req = {};
            queueMicrotask(() => {
                req.result = run(); req.onsuccess?.(); pending--;
                queueMicrotask(() => {
                    if (!pending && !completed) { completed = true; tx.oncomplete?.(); }
                });
            });
            return req;
        }
        return tx;
    } };
    const storage = loadModule('lib/exam-durable-storage.ts', {}, {
        indexedDB: indexed ? { open() {
            const req = {};
            queueMicrotask(() => { req.result = db; req.onsuccess?.(); });
            return req;
        } } : undefined,
        localStorage: {
            getItem: key => local.get(key) ?? null,
            setItem: (key, value) => {
                if (stripImageMirror && value.includes('screenshotBase64')) throw new Error('QuotaExceededError');
                local.set(key, value);
            },
            removeItem: key => local.delete(key),
        },
    });
    return { ...storage, rows, local, transactions };
}

test('an old descriptor acknowledgement cannot remove an image attached during the network request', async () => {
    for (const indexed of [true, false]) {
        const f = storageFixture({ indexed });
        const entry = evidence(); const descriptor = { ...entry }; delete descriptor.screenshotBase64;
        await f.enqueueSecurityEvent(descriptor);
        const [inFlight] = await f.readSecurityEvents(entry.attemptId);
        await f.enqueueSecurityEvent(entry);
        await f.removeSecurityEvent(entry.attemptId, entry.id, inFlight);
        assert.equal((await f.readSecurityEvents(entry.attemptId))[0].screenshotBase64, entry.screenshotBase64);
        assert.ok([...f.local.values()].some(value => value.includes(entry.screenshotBase64)));
        if (indexed) assert.equal(f.rows.get(entry.id).screenshotBase64, entry.screenshotBase64);
        await f.removeSecurityEvent(entry.attemptId, entry.id, entry);
        assert.equal((await f.readSecurityEvents(entry.attemptId)).length, 0);
        if (indexed) assert.ok(f.transactions.some(tx => tx.mode === 'readwrite' && tx.operations.join() === 'get,delete'),
            'compare and delete must share one readwrite transaction');
    }
});

test('changed images survive old acknowledgements; unconditional removal remains available', async () => {
    const f = storageFixture(); const entry = evidence();
    await f.enqueueSecurityEvent(entry);
    await f.enqueueSecurityEvent({ ...entry, screenshotBase64: 'bmV3LWltYWdl' });
    await f.removeSecurityEvent(entry.attemptId, entry.id, entry);
    assert.equal((await f.readSecurityEvents(entry.attemptId))[0].screenshotBase64, 'bmV3LWltYWdl');
    await f.removeSecurityEvent(entry.attemptId, entry.id);
    assert.equal((await f.readSecurityEvents(entry.attemptId)).length, 0);
});

test('acknowledging an IndexedDB image also clears its text-only quota fallback mirror', async () => {
    const f = storageFixture({ stripImageMirror: true }); const entry = evidence();
    await f.enqueueSecurityEvent(entry);
    assert.equal((await f.readSecurityEvents(entry.attemptId))[0].screenshotBase64, entry.screenshotBase64);
    assert.ok([...f.local.values()].every(value => !value.includes('screenshotBase64')));
    await f.removeSecurityEvent(entry.attemptId, entry.id, entry);
    assert.equal(f.rows.size, 0);
    assert.equal((await f.readSecurityEvents(entry.attemptId)).length, 0);
});

test('actual submission transport freezes descriptor-only evidence with the final answers before the delivery lock', async () => {
    let releaseDelivery;
    const deliveryGate = new Promise(resolve => { releaseDelivery = resolve; });
    const locks = loadModule('lib/exam-submission-lock.ts', {}, {
        navigator: { locks: { request: async (_key, send) => { await deliveryGate; return send(); } } },
    });
    const calls = [];
    const attemptId = 'attempt-transport';
    const { submitExamAction } = loadModule('lib/api/students.ts', {
        '../exam-submission-lock': locks,
        '../device-id': { getDeviceId: () => 'bound-device' },
        './client': {
            apiGet: () => { throw new Error('Unexpected read during submission'); },
            apiSend: async (url, body, method, options) => {
                calls.push({ url, body, method, options });
                return url.endsWith('/submit-intent')
                    ? { success: true, attemptId }
                    : { success: true, score: null, submissionVerified: true, verifiedAttemptId: attemptId };
            },
        },
    });
    const answers = { question1: 'option-a', question2: 'final essay' };
    const revisions = { question1: 7, question2: 12 };
    const assignment = { textSubmission: 'Final document', fileUrls: ['https://example.test/final.pdf'] };
    const frozenSubmission = { startedAt: '2026-10-20T01:00:00Z', personalEndTime: '2026-10-20T02:00:00Z' };
    const securityEvents = [{
        id: '9da09e7f-24b1-4d96-a938-cf4a02ad4a47', eventType: 'tab_switch',
        createdAt: '2026-10-20T01:59:59Z', metadata: { timestamp: '2026-10-20T01:59:59Z', context: { action: 'leave' } },
    }];
    const expected = structuredClone({ answers, answerRevisions: revisions, assignmentData: assignment,
        attemptId, deviceId: 'bound-device', frozenSubmission, securityEvents });

    const submission = submitExamAction('exam-transport', answers, assignment, attemptId, revisions, frozenSubmission, securityEvents);
    // The caller may keep changing its objects while another tab owns the
    // delivery lock. None of those mutations belong in the frozen request.
    answers.question1 = 'option-b'; delete answers.question2;
    revisions.question1 = 99;
    assignment.textSubmission = 'Changed'; assignment.fileUrls.push('https://example.test/changed.pdf');
    frozenSubmission.personalEndTime = '2099-01-01T00:00:00Z';
    securityEvents[0].metadata.context.action = 'changed';
    securityEvents[0].screenshotBase64 = 'data:image/jpeg;base64,c2NyZWVu';
    securityEvents.push({ ...securityEvents[0], id: 'later-event' });
    assert.equal(calls.length, 0);
    releaseDelivery();
    const result = await submission;

    assert.equal(result.success, true);
    assert.deepEqual(calls.map(call => call.url), [
        `/api/students/attempts/${attemptId}/submit-intent`, '/api/students/exams/exam-transport/submit',
    ]);
    assert.deepEqual(calls[0].body, { deviceId: 'bound-device', submission: expected });
    assert.deepEqual(calls[1].body, expected);
    assert.equal(calls[0].body.submission, calls[1].body, 'intent and final delivery reuse the same frozen payload');
    assert.deepEqual(calls[1].body.securityEvents, expected.securityEvents);
    assert.deepEqual(calls[1].body.answers, { question1: 'option-a', question2: 'final essay' });
    assert.deepEqual(calls[1].body.answerRevisions, { question1: 7, question2: 12 });
    assert.ok(calls.every(call => call.method === 'POST'));
    assert.doesNotMatch(JSON.stringify(calls.map(call => call.body)), /screenshotBase64|imageBase64|base64|data:image/);
});
